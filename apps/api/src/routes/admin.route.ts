import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireAdmin, requireSuperAdmin } from '../middleware/admin';
import { requirePermission } from '../middleware/rbac';
import { recordAuditEvent } from '../services/audit.service';
import { isPlaceholderAdUrl } from '../services/advertising';
import { deletePublishedVideoAssets } from '../services/storage.service';
import { emitPlatformEvent } from '../services/notifications';
import { getEmailOutboxService } from '../services/email';
import { createWtppApplicationsRouter } from './wtpp-applications.route';
import { createWtppReviewRouter } from './wtpp-review.route';
import {
  createShortsMonetizationAdminRouter,
  type ShortsMonetizationRateChangeRecord,
  type ShortsMonetizationSettingRecord,
} from './shorts-monetization-admin.route';
import { adminManagementRouter } from './admin-management.route';
import { supportCasesRouter } from './support-cases.route';
import { approvalRequestsRouter } from './approval-requests.route';
import { ceoDashboardRouter } from './ceo-dashboard.route';
import { adminUsersRouter } from './admin-users.route';

const adminRouter = express.Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.use('/users', adminUsersRouter);
adminRouter.use('/management', adminManagementRouter);
adminRouter.use('/cases', supportCasesRouter);
adminRouter.use('/approvals', approvalRequestsRouter);
adminRouter.use('/', ceoDashboardRouter);

// Global Shorts monetization rate settings are strictly owner-only (SUPER_ADMIN)
adminRouter.use('/monetization', createShortsMonetizationAdminRouter(requireSuperAdmin, {
  async findSetting() {
    const rows = await prisma.$queryRaw<ShortsMonetizationSettingRecord[]>`
      SELECT "rateBasisPoints", "updatedAt", "updatedById"
      FROM "ShortsMonetizationSetting"
      WHERE "id" = 'global'
    `;
    return rows[0] ?? null;
  },
  async listRateChanges(limit) {
    return prisma.$queryRaw<ShortsMonetizationRateChangeRecord[]>`
      SELECT "id", "actorId", "previousRateBasisPoints", "newRateBasisPoints", "changedAt"
      FROM "ShortsMonetizationRateAudit"
      ORDER BY "changedAt" DESC
      LIMIT ${limit}
    `;
  },
  async updateRate({ actorId, newRateBasisPoints }) {
    return prisma.$transaction(async (transaction) => {
      const currentRows = await transaction.$queryRaw<ShortsMonetizationSettingRecord[]>`
        SELECT "rateBasisPoints", "updatedAt", "updatedById"
        FROM "ShortsMonetizationSetting"
        WHERE "id" = 'global'
        FOR UPDATE
      `;
      const current = currentRows[0];
      if (!current) throw new Error('Shorts monetization setting is missing.');
      if (current.rateBasisPoints === newRateBasisPoints) {
        return { setting: current, change: null };
      }

      const updated = await transaction.$executeRaw`
        UPDATE "ShortsMonetizationSetting"
        SET "rateBasisPoints" = ${newRateBasisPoints},
            "updatedById" = ${actorId}::uuid,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'global' AND "rateBasisPoints" = ${current.rateBasisPoints}
      `;
      if (updated !== 1) return null;

      const settingRows = await transaction.$queryRaw<ShortsMonetizationSettingRecord[]>`
        SELECT "rateBasisPoints", "updatedAt", "updatedById"
        FROM "ShortsMonetizationSetting"
        WHERE "id" = 'global'
      `;
      const setting = settingRows[0];
      if (!setting) throw new Error('Shorts monetization setting disappeared during update.');

      const changeRows = await transaction.$queryRaw<ShortsMonetizationRateChangeRecord[]>`
        INSERT INTO "ShortsMonetizationRateAudit"
          ("id", "actorId", "previousRateBasisPoints", "newRateBasisPoints", "changedAt")
        VALUES (gen_random_uuid(), ${actorId}::uuid, ${current.rateBasisPoints}, ${newRateBasisPoints}, CURRENT_TIMESTAMP)
        RETURNING "id", "actorId", "previousRateBasisPoints", "newRateBasisPoints", "changedAt"
      `;
      const change = changeRows[0];
      if (!change) throw new Error('Shorts monetization rate audit was not created.');
      return { setting, change };
    });
  },
  async onRateChanged({ actorId, actorRole, change, req }) {
    await recordAuditEvent({
      actorId,
      actorRole,
      action: 'SHORTS_MONETIZATION_RATE_UPDATED',
      targetResource: 'MONETIZATION_RATE',
      targetId: change.id,
      outcome: 'SUCCESS',
      metadata: {
        previousRateBasisPoints: change.previousRateBasisPoints,
        newRateBasisPoints: change.newRateBasisPoints,
      },
      req,
    });
  },
}));

adminRouter.get('/reports', requirePermission('reports.view'), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const reports = await prisma.report.findMany({
      where: { status: 'OPEN' },
      skip,
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: { reporter: { select: { email: true } } }
    });

    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const reportPatchSchema = z.object({
  status: z.enum(['ACTION_TAKEN', 'DISMISSED']),
  strikeUserId: z.string().uuid().optional(),
  strikeReason: z.string().optional(),
  strikeType: z.enum(['WARNING', 'VIDEO_REMOVAL', 'MONETIZATION_HOLD', 'SUSPENSION']).optional()
});

adminRouter.patch('/reports/:id', requirePermission('reports.resolve'), async (req: AuthRequest, res: Response) => {
  try {
    const reportId = req.params.id;
    const { status, strikeUserId, strikeReason, strikeType } = reportPatchSchema.parse(req.body);

    const report = await prisma.report.update({
      where: { id: reportId },
      data: { status, resolvedAt: new Date() }
    });

    if (status === 'ACTION_TAKEN' && strikeUserId && strikeReason && strikeType) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);

      await prisma.userStrike.create({
        data: { userId: strikeUserId, reason: strikeReason, strikeType, expiresAt }
      });

      void emitPlatformEvent({
        eventId: crypto.randomUUID(),
        eventType: 'MODERATION_STRIKE_ISSUED',
        userId: strikeUserId,
        strikeType,
        reason: strikeReason,
        expiresAt,
        timestamp: new Date(),
      });
    }

    if (req.user?.id) {
      await recordAuditEvent({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'REPORT_RESOLVED',
        targetResource: 'REPORT',
        targetId: reportId,
        outcome: 'SUCCESS',
        metadata: { status, strikeUserId, strikeType },
        req,
      });
    }

    res.status(200).json(report);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

adminRouter.use('/wtpp/applications', requirePermission('content.review'), createWtppApplicationsRouter({
  async listPendingApplications() {
    return prisma.wtppApplication.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        channelWatchHours: true,
        subscriberCount: true,
        submittedAt: true,
        channel: { select: { name: true, handle: true } },
      },
    });
  },
  async getApplicationById(id: string) {
    const app = await prisma.wtppApplication.findUnique({
      where: { id },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            handle: true,
            userId: true,
            createdAt: true,
          },
        },
      },
    });
    if (!app) return null;
    return {
      id: app.id,
      channelWatchHours: app.channelWatchHours,
      subscriberCount: app.subscriberCount,
      submittedAt: app.submittedAt,
      status: app.status,
      reviewerNotes: app.reviewerNotes,
      reviewedAt: app.reviewedAt,
      channel: {
        id: app.channel.id,
        name: app.channel.name,
        handle: app.channel.handle,
        userId: app.channel.userId,
        createdAt: app.channel.createdAt,
      },
      hasTaxId: Boolean(app.taxId),
      hasNationalId: Boolean(app.nationalIdOrPassport),
    };
  },
}));

adminRouter.use('/wtpp/applications', requirePermission('content.review'), createWtppReviewRouter({
  async reviewPendingApplication({ applicationId, status, reviewerNotes, reviewerId, reviewerRole, req }) {
    const outcome = await prisma.$transaction(async (transaction) => {
      const reviewedAt = new Date();
      const updated = await transaction.wtppApplication.updateMany({
        where: { id: applicationId, status: 'PENDING' },
        data: { status, reviewerNotes, reviewedAt },
      });
      if (updated.count !== 1) return null;

      const application = await transaction.wtppApplication.findUnique({
        where: { id: applicationId },
        select: {
          id: true,
          channelId: true,
          reviewerNotes: true,
          reviewedAt: true,
          channel: { select: { userId: true, name: true } },
        },
      });
      if (!application) return null;

      await transaction.channel.update({
        where: { id: application.channelId },
        data: { isMonetized: status === 'APPROVED' },
      });
      return {
        id: application.id,
        status,
        reviewerNotes: application.reviewerNotes,
        reviewedAt: application.reviewedAt,
        channelId: application.channelId,
        channelName: application.channel?.name,
        creatorUserId: application.channel?.userId,
      };
    });

    if (outcome && outcome.creatorUserId) {
      void emitPlatformEvent({
        eventId: crypto.randomUUID(),
        eventType: status === 'APPROVED' ? 'WTPP_APPLICATION_APPROVED' : 'WTPP_APPLICATION_REJECTED',
        userId: outcome.creatorUserId,
        channelId: outcome.channelId,
        channelName: outcome.channelName || 'Your Channel',
        applicationId: outcome.id,
        reviewerNotes: outcome.reviewerNotes,
        timestamp: new Date(),
      });
    }

    if (outcome && reviewerId) {
      await recordAuditEvent({
        actorId: reviewerId,
        actorRole: reviewerRole || 'ADMIN',
        action: status === 'APPROVED' ? 'WTPP_APPLICATION_APPROVED' : 'WTPP_APPLICATION_REJECTED',
        targetResource: 'WTPP_APPLICATION',
        targetId: outcome.id,
        outcome: 'SUCCESS',
        metadata: {
          status,
          reviewerNotes: outcome.reviewerNotes,
          channelId: outcome.channelId,
          channelName: outcome.channelName,
        },
        req,
      });
    }

    return outcome;
  },
}));

adminRouter.get('/copyright/claims', requirePermission('content.review'), async (req: Request, res: Response) => {
  try {
    const claims = await prisma.copyrightClaim.findMany({
      where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      orderBy: { createdAt: 'asc' },
      include: {
        video: { select: { title: true, channelId: true } },
        claimant: { select: { id: true, email: true } },
        reviewer: { select: { id: true, email: true } },
      }
    });
    res.status(200).json(claims);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global copyright escrow balances are owner-only financial data
adminRouter.get('/copyright/escrows', requirePermission('finance.view_company_revenue'), async (req: Request, res: Response) => {
  try {
    const escrows = await prisma.escrowHold.findMany({
      where: { status: 'HELD' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        claimId: true,
        heldAmountCents: true,
        video: { select: { title: true } }
      }
    });

    res.status(200).json(escrows.map(escrow => ({
      ...escrow,
      heldAmountCents: escrow.heldAmountCents.toString()
    })));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const copyrightPatchSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'APPROVED_TAKEDOWN', 'REJECTED'])
});

adminRouter.patch('/copyright/claims/:id', requirePermission('content.review'), async (req: Request, res: Response) => {
  try {
    const claimId = z.string().uuid().parse(req.params.id);
    const { status } = copyrightPatchSchema.parse(req.body);
    const reviewer = (req as AuthRequest).user;
    if (!reviewer?.id) return res.status(401).json({ error: 'Unauthorized' });

    const claim = await prisma.$transaction(async (transaction) => {
      const reviewedAt = new Date();
      const result = await transaction.copyrightClaim.update({
        where: { id: claimId },
        data: {
          status,
          reviewerId: reviewer.id,
          reviewedAt,
          resolvedAt: status === 'UNDER_REVIEW' ? null : reviewedAt,
        },
      });
      if (status === 'APPROVED_TAKEDOWN') {
        await transaction.video.update({
          where: { id: result.videoId },
          data: {
            status: 'BLOCKED',
            visibility: 'PRIVATE',
            copyrightReviewStatus: 'BLOCKED',
          },
        });
      }
      return result;
    });

    await recordAuditEvent({
      actorId: reviewer.id,
      actorRole: reviewer.role,
      action: 'COPYRIGHT_CLAIM_UPDATED',
      targetResource: 'COPYRIGHT_CLAIM',
      targetId: claimId,
      outcome: 'SUCCESS',
      metadata: { status, videoId: claim.videoId },
      req,
    });

    if (status === 'APPROVED_TAKEDOWN') {
      try {
        await deletePublishedVideoAssets(claim.videoId);
      } catch (error) {
        console.error('Public media cleanup failed after an approved takedown.', {
          name: error instanceof Error ? error.name : 'UnknownError',
        });
        res.status(503).json({
          error: 'The claim was recorded and the video blocked, but public media cleanup is incomplete.',
        });
        return;
      }
    }

    if (claim.videoId && status !== 'UNDER_REVIEW') {
      try {
        const video = await prisma.video.findUnique({
          where: { id: claim.videoId },
          select: { title: true, channel: { select: { userId: true, name: true } } },
        });
        if (video?.channel?.userId) {
          void emitPlatformEvent({
            eventId: crypto.randomUUID(),
            eventType: 'COPYRIGHT_DECISION',
            userId: video.channel.userId,
            videoId: claim.videoId,
            videoTitle: video.title,
            claimId: claim.id,
            status: status === 'APPROVED_TAKEDOWN' ? 'CLAIM_UPHELD' : 'CLAIM_DISMISSED',
            resolutionNotes: status === 'APPROVED_TAKEDOWN' ? 'Video takedown approved.' : 'Claim was reviewed and dismissed.',
            timestamp: new Date(),
          });
        }
      } catch {
        // fail-safe
      }
    }

    res.status(200).json(claim);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      res.status(500).json({ error: 'Copyright review is temporarily unavailable.' });
      return;
    }
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Escrow settlement is strictly owner-only (SUPER_ADMIN) and audited
adminRouter.post(
  '/copyright/claims/:id/resolve-escrow',
  requirePermission('finance.manage_payouts'),
  async (req: AuthRequest, res: Response) => {
    const decision = z.object({
      decision: z.enum(['RELEASE_TO_CREATOR', 'TRANSFER_TO_CLAIMANT']),
    }).strict().safeParse(req.body);
    if (!decision.success) return res.status(400).json({ error: 'Invalid request' });

    if (req.user?.id) {
      await recordAuditEvent({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'ESCROW_RESOLUTION_ATTEMPTED',
        targetResource: 'ESCROW_HOLD',
        targetId: req.params.id,
        outcome: 'DENIED',
        metadata: { decision: decision.data.decision, reason: 'Unconfigured allocation source' },
        req,
      });
    }

    res.status(501).json({
      error: 'Escrow settlement is unavailable until held amounts have a verified allocation and audit trail.',
    });
  }
);

// Ad Provider configuration & credentials are owner-only (monetization.manage_providers is in OWNER_ONLY_PERMISSIONS)
adminRouter.get(
  '/monetization/providers',
  requirePermission('monetization.manage_providers'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const providers = await prisma.adProviderConfig.findMany({
        orderBy: { priority: 'asc' },
      });
      res.status(200).json(providers);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

const adProviderPlacementEnum = z.enum([
  'PRE_ROLL',
  'MID_ROLL',
  'POST_ROLL',
  'DISPLAY_BANNER',
  'DISPLAY_SIDEBAR',
  'NATIVE_FEED',
]);

const adProviderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Provider name is required')
    .max(64, 'Provider name cannot exceed 64 characters')
    .regex(/^[a-zA-Z0-9_\- ]+$/, 'Name must be alphanumeric with spaces, dashes, or underscores'),
  vastTagUrl: z
    .string()
    .url('vastTagUrl must be a valid URL')
    .refine((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:');
      } catch {
        return false;
      }
    }, 'vastTagUrl must use a secure HTTPS protocol')
    .refine(
      (url) => process.env.NODE_ENV === 'test' || !isPlaceholderAdUrl(url),
      'Placeholder or local host URLs are not permitted for ad provider configuration'
    ),
  priority: z.number().int().min(1).max(1000).optional().default(1),
  isEnabled: z.boolean().optional().default(true),
  format: adProviderPlacementEnum.optional().default('PRE_ROLL'),
  providerType: z.enum(['VAST_GENERIC', 'ADSTERRA', 'GOOGLE_IMA', 'DIRECT', 'CUSTOM']).optional().default('VAST_GENERIC'),
  supportedPlacements: z.array(adProviderPlacementEnum).min(1).max(6).optional(),
});

adminRouter.post(
  '/monetization/providers',
  requirePermission('monetization.manage_providers'),
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = adProviderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid provider configuration', details: parsed.error.issues });
      }
      const data = {
        ...parsed.data,
        supportedPlacements: parsed.data.supportedPlacements ?? [parsed.data.format ?? 'PRE_ROLL'],
      };

      const existing = await prisma.adProviderConfig.findUnique({
        where: { name: data.name },
      });

      const provider = await prisma.adProviderConfig.upsert({
        where: { name: data.name },
        update: data,
        create: { ...data, priority: data.priority ?? 1, format: data.format ?? 'PRE_ROLL' },
      });

      await recordAuditEvent({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: existing ? 'AD_PROVIDER_UPDATE' : 'AD_PROVIDER_CREATE',
        targetResource: 'AdProviderConfig',
        targetId: provider.id,
        outcome: 'SUCCESS',
        metadata: {
          name: provider.name,
          priority: provider.priority,
          isEnabled: provider.isEnabled,
          format: provider.format,
          isUpdate: !!existing,
        },
        req,
      });

      res.status(200).json(provider);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  },
);

adminRouter.delete(
  '/monetization/providers/:id',
  requirePermission('monetization.manage_providers'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id;
      const existing = await prisma.adProviderConfig.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: 'Ad provider not found' });
      }

      await prisma.adProviderConfig.delete({ where: { id } });

      await recordAuditEvent({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: 'AD_PROVIDER_DELETE',
        targetResource: 'AdProviderConfig',
        targetId: id,
        outcome: 'SUCCESS',
        metadata: {
          name: existing.name,
          format: existing.format,
        },
        req,
      });

      res.status(200).json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  },
);

// Operational email health inspection (accessible to ADMIN and SUPER_ADMIN via platform.view_health)
adminRouter.get(
  '/email/health',
  requirePermission('platform.view_health'),
  async (_req: Request, res: Response) => {
    try {
      const outbox = getEmailOutboxService();
      const stats = await outbox.getHealthStats();
      res.status(200).json(stats);
    } catch (error) {
      console.error('[Admin] Failed to retrieve email health stats:', error);
      res.status(500).json({ error: 'Email health stats are temporarily unavailable.' });
    }
  }
);

// Manual re-queue of failed email outbox jobs (strictly SUPER_ADMIN only)
adminRouter.post(
  '/email/outbox/:id/retry',
  requireSuperAdmin,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid outbox job ID' });
    }

    try {
      const outbox = getEmailOutboxService();
      const retried = await outbox.retryFailedJob(id);
      if (!retried) {
        return res.status(404).json({ error: 'Outbox job not found or not in a failed state.' });
      }

      await recordAuditEvent({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: 'EMAIL_OUTBOX_JOB_RETRIED',
        targetResource: 'EMAIL_OUTBOX',
        targetId: id,
        outcome: 'SUCCESS',
        req,
      });

      res.status(200).json({
        success: true,
        message: 'Email outbox job re-queued for delivery.',
        outboxId: id,
      });
    } catch (error) {
      console.error(`[Admin] Failed to retry email outbox job ${id}:`, error);
      res.status(500).json({ error: 'Failed to re-queue outbox job.' });
    }
  }
);

export { adminRouter };
