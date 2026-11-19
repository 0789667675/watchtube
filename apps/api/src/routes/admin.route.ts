import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { deletePublishedVideoAssets } from '../services/storage.service';
import { createWtppReviewRouter } from './wtpp-review.route';

const adminRouter = express.Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/reports', async (req: Request, res: Response) => {
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

adminRouter.patch('/reports/:id', async (req: Request, res: Response) => {
  try {
    const reportId = req.params.id;
    const { status, strikeUserId, strikeReason, strikeType } = reportPatchSchema.parse(req.body);

    const report = await prisma.report.update({
      where: { id: reportId },
      data: { status, resolvedAt: new Date() }
    });

    if (status === 'ACTION_TAKEN' && strikeUserId && strikeReason && strikeType) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90); // 90 day expiry

      await prisma.userStrike.create({
        data: { userId: strikeUserId, reason: strikeReason, strikeType, expiresAt }
      });
    }

    res.status(200).json(report);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

adminRouter.get('/wtpp/applications', async (req: Request, res: Response) => {
  try {
    const applications = await prisma.wtppApplication.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      include: { channel: { select: { name: true, handle: true, userId: true } } }
    });
    res.status(200).json(applications);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.use('/wtpp/applications', createWtppReviewRouter({
  async reviewPendingApplication({ applicationId, status, reviewerNotes }) {
    return prisma.$transaction(async (transaction) => {
      const reviewedAt = new Date();
      const updated = await transaction.wtppApplication.updateMany({
        where: { id: applicationId, status: 'PENDING' },
        data: { status, reviewerNotes, reviewedAt },
      });
      if (updated.count !== 1) return null;

      const application = await transaction.wtppApplication.findUnique({
        where: { id: applicationId },
      });
      if (!application) return null;

      await transaction.channel.update({
        where: { id: application.channelId },
        data: { isMonetized: status === 'APPROVED' },
      });
      return application;
    });
  },
}));

adminRouter.get('/copyright/claims', async (req: Request, res: Response) => {
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

adminRouter.get('/copyright/escrows', async (req: Request, res: Response) => {
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

adminRouter.patch('/copyright/claims/:id', async (req: Request, res: Response) => {
  try {
    const claimId = z.string().uuid().parse(req.params.id);
    const { status } = copyrightPatchSchema.parse(req.body);
    const reviewerId = (req as AuthRequest).user?.id;
    if (!reviewerId) return res.status(401).json({ error: 'Unauthorized' });

    const claim = await prisma.$transaction(async (transaction) => {
      const reviewedAt = new Date();
      const result = await transaction.copyrightClaim.update({
        where: { id: claimId },
        data: {
          status,
          reviewerId,
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

    res.status(200).json(claim);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      res.status(500).json({ error: 'Copyright review is temporarily unavailable.' });
      return;
    }
    res.status(400).json({ error: 'Invalid request' });
  }
});

export { adminRouter };

adminRouter.post('/copyright/claims/:id/resolve-escrow', async (req: Request, res: Response) => {
  const decision = z.object({
    decision: z.enum(['RELEASE_TO_CREATOR', 'TRANSFER_TO_CLAIMANT']),
  }).strict().safeParse(req.body);
  if (!decision.success) return res.status(400).json({ error: 'Invalid request' });

  res.status(501).json({
    error: 'Escrow settlement is unavailable until held amounts have a verified allocation and audit trail.',
  });
});

adminRouter.get('/monetization/providers', async (req: Request, res: Response) => {
  try {
    const providers = await prisma.adProviderConfig.findMany({
      orderBy: { priority: 'asc' }
    });
    res.status(200).json(providers);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const adProviderSchema = z.object({
  name: z.string(),
  vastTagUrl: z.string().url(),
  priority: z.number().int().optional(),
  isEnabled: z.boolean().optional(),
  format: z.string().optional()
});

adminRouter.post('/monetization/providers', async (req: Request, res: Response) => {
  try {
    const data = adProviderSchema.parse(req.body);

    const provider = await prisma.adProviderConfig.upsert({
      where: { name: data.name },
      update: data,
      create: { ...data, priority: data.priority || 1, format: data.format || 'PRE_ROLL' }
    });

    res.status(200).json(provider);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

adminRouter.delete('/monetization/providers/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    await prisma.adProviderConfig.delete({ where: { id } });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});
