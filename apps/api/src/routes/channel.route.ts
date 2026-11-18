import { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';

interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

export interface ChannelSettings {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
}

export interface ChannelUpdateData {
  name?: string;
  handle?: string;
  description?: string | null;
}

export interface ChannelRepository {
  createChannel(input: {
    userId: string;
    name: string;
    handle: string;
    description?: string | null;
  }): Promise<ChannelSettings>;
  findPublicChannel(handle: string): Promise<unknown | null>;
  findOwnedChannel(channelId: string, userId: string): Promise<ChannelSettings | null>;
  handleExists(handle: string, exceptChannelId?: string): Promise<boolean>;
  updateOwnedChannel(
    channelId: string,
    userId: string,
    data: ChannelUpdateData,
  ): Promise<ChannelSettings | null>;
}

export interface ChannelRouteDependencies {
  authenticate: RequestHandler;
  repository: ChannelRepository;
}

const handleSchema = z.string()
  .trim()
  .transform((value) => value.startsWith('@') ? value : `@${value}`)
  .pipe(z.string().regex(/^@[a-zA-Z0-9_]{1,30}$/, 'Use 1-30 letters, numbers, or underscores.'));

const channelCreationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  handle: handleSchema,
  description: z.string().trim().max(1000).nullable().optional(),
}).strict();

const channelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  handle: handleSchema.optional(),
  description: z.string().trim().max(1000).transform((value) => value || null).nullable().optional(),
}).strict().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: 'Provide at least one channel field to update.' },
);

function getUserId(req: Request, res: Response): string | undefined {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return undefined;
  }
  return userId;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002';
}

function sendInternalError(res: Response, error: unknown): void {
  console.error('Channel settings request failed:', error);
  res.status(500).json({ error: 'Internal server error' });
}

export function createChannelRouter(dependencies: ChannelRouteDependencies): Router {
  const router = Router();

  router.post('/', dependencies.authenticate, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const parsed = channelCreationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid channel details' });
      return;
    }

    try {
      if (await dependencies.repository.handleExists(parsed.data.handle)) {
        res.status(409).json({ error: 'Handle already in use.' });
        return;
      }
      const channel = await dependencies.repository.createChannel({
        ...parsed.data,
        userId,
      });
      res.status(201).json(channel);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        res.status(409).json({ error: 'Handle already in use.' });
        return;
      }
      sendInternalError(res, error);
    }
  });

  router.get('/:channelId/settings', dependencies.authenticate, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const channelId = z.string().uuid().safeParse(req.params.channelId);
    if (!channelId.success) {
      res.status(400).json({ error: 'Invalid channel ID' });
      return;
    }

    try {
      const channel = await dependencies.repository.findOwnedChannel(channelId.data, userId);
      if (!channel) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }
      res.status(200).json(channel);
    } catch (error) {
      sendInternalError(res, error);
    }
  });

  router.patch('/:channelId/settings', dependencies.authenticate, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const channelId = z.string().uuid().safeParse(req.params.channelId);
    const parsed = channelUpdateSchema.safeParse(req.body);
    if (!channelId.success || !parsed.success) {
      res.status(400).json({ error: 'Invalid channel update' });
      return;
    }

    try {
      const currentChannel = await dependencies.repository.findOwnedChannel(channelId.data, userId);
      if (!currentChannel) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      if (
        parsed.data.handle
        && parsed.data.handle !== currentChannel.handle
        && await dependencies.repository.handleExists(parsed.data.handle, channelId.data)
      ) {
        res.status(409).json({ error: 'Handle already in use.' });
        return;
      }

      const channel = await dependencies.repository.updateOwnedChannel(
        channelId.data,
        userId,
        parsed.data,
      );
      if (!channel) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }
      res.status(200).json(channel);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        res.status(409).json({ error: 'Handle already in use.' });
        return;
      }
      sendInternalError(res, error);
    }
  });

  router.get('/:handle', async (req: Request, res: Response) => {
    const handle = req.params.handle;
    try {
      const channel = await dependencies.repository.findPublicChannel(handle);
      if (!channel) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }
      res.status(200).json(channel);
    } catch (error) {
      sendInternalError(res, error);
    }
  });

  return router;
}
