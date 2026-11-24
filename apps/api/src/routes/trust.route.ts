import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';
import { encryptWtppPii, WtppPiiConfigurationError } from '../security/wtppPii';
import { emitPlatformEvent } from '../services/notifications';

const trustRouter = express.Router();

interface WtppApplicationSummary {
  status: 'NOT_APPLIED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewerNotes: string | null;
  reviewedAt: Date | null;
}

interface WtppChannel {
  id: string;
  name: string;
  handle: string;
  subscriberCount: number;
  isMonetized: boolean;
}

interface WtppApplicationInput {
  channelId: string;
  channelWatchHours: number;
  subscriberCount: number;
  taxId?: string;
  nationalIdOrPassport?: string;
}

export interface WtppApplicationRepository {
  findCreatorChannel(userId: string, channelId?: string): Promise<WtppChannel | null>;
  findApplication(channelId: string): Promise<WtppApplicationSummary | null>;
  getChannelWatchHours(channelId: string): Promise<number>;
  submitApplication(input: WtppApplicationInput): Promise<WtppApplicationSummary | null>;
}

export function createWtppApplicationRouter(
  authenticate: express.RequestHandler,
  repository: WtppApplicationRepository,
): express.Router {
  const router = express.Router();

  router.get('/wtpp/status', authenticate, async (req: AuthRequest, res: Response) => {
    const query = z.object({ channelId: z.string().uuid().optional() }).strict().safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: 'Invalid channel ID' });

    try {
      const channel = await repository.findCreatorChannel(req.user!.id, query.data.channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const application = await repository.findApplication(channel.id);
      const applicationStatus = application?.status ?? 'NOT_APPLIED';
      const canApply = !channel.isMonetized
        && (applicationStatus === 'NOT_APPLIED' || applicationStatus === 'REJECTED');

      res.status(200).json({
        channelId: channel.id,
        channelName: channel.name,
        channelHandle: channel.handle,
        isMonetized: channel.isMonetized,
        applicationStatus,
        canApply,
        reviewerNotes: application?.reviewerNotes ?? null,
        reviewedAt: application?.reviewedAt?.toISOString() ?? null,
      });
    } catch (error) {
      sendDatabaseErrorResponse(res, error, 'Creator program status is temporarily unavailable because the database is unavailable.');
    }
  });

  router.post('/wtpp/apply', authenticate, async (req: AuthRequest, res: Response) => {
    const applySchema = z.object({
      channelId: z.string().uuid().optional(),
      taxId: z.string().max(256).optional(),
      nationalIdOrPassport: z.string().max(256).optional(),
    }).strict();
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    try {
      const { channelId, taxId, nationalIdOrPassport } = parsed.data;
      const applicationDetails = {
        ...(taxId === undefined ? {} : { taxId: encryptWtppPii(taxId, 'taxId') }),
        ...(nationalIdOrPassport === undefined
          ? {}
          : { nationalIdOrPassport: encryptWtppPii(nationalIdOrPassport, 'nationalIdOrPassport') }),
      };
      const channel = await repository.findCreatorChannel(req.user!.id, channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const channelWatchHours = await repository.getChannelWatchHours(channel.id);
      const application = await repository.submitApplication({
        channelId: channel.id,
        channelWatchHours,
        subscriberCount: channel.subscriberCount,
        ...applicationDetails,
      });
      if (!application) {
        return res.status(409).json({ error: 'Application already in progress or approved' });
      }

      void emitPlatformEvent({
        eventId: crypto.randomUUID(),
        eventType: 'WTPP_APPLICATION_RECEIVED',
        userId: req.user!.id,
        channelId: channel.id,
        channelName: channel.name,
        applicationId: (application as any).id || channel.id,
        timestamp: new Date(),
      });

      res.status(201).json(application);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        res.status(409).json({ error: 'Application already in progress or approved' });
        return;
      }
      if (error instanceof WtppPiiConfigurationError) {
        res.status(503).json({ error: 'Sensitive identity encryption is not configured.' });
        return;
      }
      sendDatabaseErrorResponse(res, error, 'Creator program application is temporarily unavailable because the database is unavailable.');
    }
  });

  return router;
}

const reportSchema = z.object({
  targetType: z.enum(['VIDEO', 'COMMENT', 'CHANNEL']),
  targetId: z.string().uuid(),
  reason: z.enum(['SPAM', 'HARASSMENT', 'COPYRIGHT', 'HATE_SPEECH', 'MISLEADING', 'OTHER']),
  details: z.string().optional()
});

trustRouter.post('/reports', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const reporterId = req.user!.id;
    const { targetType, targetId, reason, details } = reportSchema.parse(req.body);

    const report = await prisma.report.create({
      data: { reporterId, targetType, targetId, reason, details, status: 'OPEN' }
    });

    res.status(201).json(report);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      sendDatabaseErrorResponse(res, error, 'Report submission is temporarily unavailable because the database is unavailable.');
      return;
    }
    res.status(400).json({ error: 'Invalid request' });
  }
});

const copyrightSchema = z.object({
  videoId: z.string().uuid(),
  description: z.string().min(10),
  proofUrl: z.string().url().optional()
});

trustRouter.post('/copyright/claims', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const claimantId = req.user!.id;
    const { videoId, description, proofUrl } = copyrightSchema.parse(req.body);

    const claim = await prisma.copyrightClaim.create({
      data: { claimantId, videoId, description, proofUrl, status: 'OPEN' }
    });

    res.status(201).json(claim);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      sendDatabaseErrorResponse(res, error, 'Copyright claim submission is temporarily unavailable because the database is unavailable.');
      return;
    }
    res.status(400).json({ error: 'Invalid request' });
  }
});

trustRouter.use(createWtppApplicationRouter(authenticate, {
  async findCreatorChannel(userId, channelId) {
    return prisma.channel.findFirst({
      where: { userId, ...(channelId ? { id: channelId } : {}) },
      select: { id: true, name: true, handle: true, subscriberCount: true, isMonetized: true },
      orderBy: { createdAt: 'asc' },
    });
  },
  async findApplication(channelId) {
    return prisma.wtppApplication.findUnique({
      where: { channelId },
      select: { status: true, reviewerNotes: true, reviewedAt: true },
    });
  },
  async getChannelWatchHours(channelId) {
    const aggregate = await prisma.videoViewEvent.aggregate({
      where: { video: { channelId }, isValidView: true },
      _sum: { watchDurationSeconds: true },
    });
    return (aggregate._sum.watchDurationSeconds ?? 0) / 3600;
  },
  async submitApplication(input) {
    return prisma.$transaction(async (transaction) => {
      const existing = await transaction.wtppApplication.findUnique({
        where: { channelId: input.channelId },
        select: { id: true, status: true },
      });
      const applicationData = {
        status: 'PENDING' as const,
        channelWatchHours: input.channelWatchHours,
        subscriberCount: input.subscriberCount,
        taxId: input.taxId,
        nationalIdOrPassport: input.nationalIdOrPassport,
        reviewerNotes: null,
        reviewedAt: null,
        submittedAt: new Date(),
      };

      if (!existing) {
        return transaction.wtppApplication.create({
          data: { ...applicationData, channelId: input.channelId },
          select: { status: true, reviewerNotes: true, reviewedAt: true },
        });
      }
      if (existing.status !== 'REJECTED') return null;

      const updated = await transaction.wtppApplication.updateMany({
        where: { id: existing.id, status: 'REJECTED' },
        data: applicationData,
      });
      if (updated.count !== 1) return null;

      return transaction.wtppApplication.findUnique({
        where: { id: existing.id },
        select: { status: true, reviewerNotes: true, reviewedAt: true },
      });
    });
  },
}));

export { trustRouter };
