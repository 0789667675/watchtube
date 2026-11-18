import { Request, RequestHandler, Response, Router } from 'express';
import { sign, verify } from 'jsonwebtoken';
import { z } from 'zod';
import { ChannelSettings } from './channel.route';
import {
  CHANNEL_IMAGE_MAX_FILE_SIZE,
  ChannelImagePurpose,
  InvalidChannelImageError,
} from '../services/channel-image.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

interface ChannelImageUploadInput {
  channelId: string;
  purpose: ChannelImagePurpose;
  contentType: string;
  fileSize: number;
}

interface ChannelImageConfirmationInput extends ChannelImageUploadInput {
  uploadId: string;
}

export interface ChannelImageUploadRepository {
  ownsChannel(channelId: string, userId: string): Promise<boolean>;
  updateOwnedImage(
    channelId: string,
    userId: string,
    purpose: ChannelImagePurpose,
    imageUrl: string,
  ): Promise<ChannelSettings | null>;
}

export interface ChannelImageUploadStorage {
  createUploadTarget(input: ChannelImageUploadInput): Promise<{
    uploadUrl: string;
    uploadId: string;
    expiresIn: number;
  }>;
  publishUploadedImage(input: ChannelImageConfirmationInput): Promise<string | null>;
}

export interface ChannelImageUploadRouteDependencies {
  authenticate: RequestHandler;
  repository: ChannelImageUploadRepository;
  storage: ChannelImageUploadStorage;
  ticketSecret: string;
}

const PURPOSES = ['avatar', 'banner'] as const;
const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const routeParamsSchema = z.object({
  channelId: z.string().uuid(),
  purpose: z.enum(PURPOSES),
});
const intentBodySchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  fileSize: z.number().int().positive(),
}).strict();
const confirmationBodySchema = z.object({
  uploadToken: z.string().min(1).max(4096),
}).strict();
const ticketClaimsSchema = z.object({
  channelId: z.string().uuid(),
  purpose: z.enum(PURPOSES),
  contentType: z.enum(CONTENT_TYPES),
  fileSize: z.number().int().positive(),
  uploadId: z.string().uuid(),
  sub: z.string().uuid(),
});

function getUserId(req: Request, res: Response): string | undefined {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return undefined;
  }
  return userId;
}

function sendRepositoryError(res: Response): void {
  console.error('Channel image settings could not be persisted.');
  res.status(500).json({ error: 'Channel image settings could not be saved.' });
}

function sendStorageError(res: Response): void {
  console.error('Channel image storage operation failed.');
  res.status(503).json({ error: 'Channel image upload is temporarily unavailable.' });
}

function getTicketClaims(
  token: string,
  ticketSecret: string,
): z.infer<typeof ticketClaimsSchema> | null {
  try {
    const payload = verify(token, ticketSecret, {
      algorithms: ['HS256'],
      audience: 'channel-image-upload',
      issuer: 'watchtube-api',
    });
    if (typeof payload === 'string') return null;
    const parsed = ticketClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createChannelImageUploadRouter(
  dependencies: ChannelImageUploadRouteDependencies,
): Router {
  const router = Router();

  router.post(
    '/:channelId/images/:purpose/upload-intent',
    dependencies.authenticate,
    async (req: Request, res: Response) => {
      const userId = getUserId(req, res);
      if (!userId) return;

      const params = routeParamsSchema.safeParse(req.params);
      const body = intentBodySchema.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({ error: 'Invalid channel image upload request.' });
        return;
      }

      const { channelId, purpose } = params.data;
      const { contentType, fileSize } = body.data;
      if (fileSize > CHANNEL_IMAGE_MAX_FILE_SIZE[purpose]) {
        res.status(400).json({ error: 'The selected image exceeds the file size limit.' });
        return;
      }

      let ownsChannel: boolean;
      try {
        ownsChannel = await dependencies.repository.ownsChannel(channelId, userId);
      } catch {
        sendRepositoryError(res);
        return;
      }
      if (!ownsChannel) {
        res.status(404).json({ error: 'Channel not found.' });
        return;
      }

      let target: Awaited<ReturnType<ChannelImageUploadStorage['createUploadTarget']>>;
      try {
        target = await dependencies.storage.createUploadTarget({
          channelId,
          purpose,
          contentType,
          fileSize,
        });
      } catch (error) {
        if (error instanceof InvalidChannelImageError) {
          res.status(400).json({ error: error.message });
          return;
        }
        sendStorageError(res);
        return;
      }

      const uploadToken = sign({
        channelId,
        purpose,
        contentType,
        fileSize,
        uploadId: target.uploadId,
      }, dependencies.ticketSecret, {
        algorithm: 'HS256',
        audience: 'channel-image-upload',
        expiresIn: target.expiresIn,
        issuer: 'watchtube-api',
        subject: userId,
      });

      res.status(201).json({
        uploadUrl: target.uploadUrl,
        uploadToken,
        expiresIn: target.expiresIn,
      });
    },
  );

  router.post(
    '/:channelId/images/:purpose/confirm',
    dependencies.authenticate,
    async (req: Request, res: Response) => {
      const userId = getUserId(req, res);
      if (!userId) return;

      const params = routeParamsSchema.safeParse(req.params);
      const body = confirmationBodySchema.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({ error: 'Invalid channel image confirmation request.' });
        return;
      }

      const { channelId, purpose } = params.data;
      const claims = getTicketClaims(body.data.uploadToken, dependencies.ticketSecret);
      if (
        !claims
        || claims.channelId !== channelId
        || claims.purpose !== purpose
        || claims.sub !== userId
        || claims.fileSize > CHANNEL_IMAGE_MAX_FILE_SIZE[purpose]
      ) {
        res.status(400).json({ error: 'The channel image upload ticket is invalid or expired.' });
        return;
      }

      try {
        if (!(await dependencies.repository.ownsChannel(channelId, userId))) {
          res.status(404).json({ error: 'Channel not found.' });
          return;
        }
      } catch {
        sendRepositoryError(res);
        return;
      }

      let imageUrl: string | null;
      try {
        imageUrl = await dependencies.storage.publishUploadedImage({
          channelId,
          purpose,
          contentType: claims.contentType,
          fileSize: claims.fileSize,
          uploadId: claims.uploadId,
        });
      } catch (error) {
        if (error instanceof InvalidChannelImageError) {
          res.status(400).json({ error: error.message });
          return;
        }
        sendStorageError(res);
        return;
      }

      if (!imageUrl) {
        res.status(409).json({ error: 'The uploaded image was not found. Upload it before confirming.' });
        return;
      }

      try {
        const channel = await dependencies.repository.updateOwnedImage(
          channelId,
          userId,
          purpose,
          imageUrl,
        );
        if (!channel) {
          res.status(404).json({ error: 'Channel not found.' });
          return;
        }
        res.status(200).json({ channel, imageUrl });
      } catch {
        sendRepositoryError(res);
      }
    },
  );

  return router;
}
