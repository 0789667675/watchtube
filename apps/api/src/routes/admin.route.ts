import express, { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const prisma = new PrismaClient();
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

const wtppPatchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewerNotes: z.string().optional()
});

adminRouter.patch('/wtpp/applications/:id', async (req: Request, res: Response) => {
  try {
    const appId = req.params.id;
    const { status, reviewerNotes } = wtppPatchSchema.parse(req.body);

    const application = await prisma.wtppApplication.update({
      where: { id: appId },
      data: { status, reviewerNotes, reviewedAt: new Date() }
    });

    if (status === 'APPROVED') {
      await prisma.channel.update({
        where: { id: application.channelId },
        data: { isMonetized: true }
      });
    }

    res.status(200).json(application);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

adminRouter.get('/copyright/claims', async (req: Request, res: Response) => {
  try {
    const claims = await prisma.copyrightClaim.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      include: { video: { select: { title: true, channelId: true } } }
    });
    res.status(200).json(claims);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const copyrightPatchSchema = z.object({
  status: z.enum(['APPROVED_TAKEDOWN', 'REJECTED'])
});

adminRouter.patch('/copyright/claims/:id', async (req: Request, res: Response) => {
  try {
    const claimId = req.params.id;
    const { status } = copyrightPatchSchema.parse(req.body);

    const claim = await prisma.copyrightClaim.update({
      where: { id: claimId },
      data: { status, resolvedAt: new Date() }
    });

    if (status === 'APPROVED_TAKEDOWN') {
      await prisma.video.update({
        where: { id: claim.videoId },
        data: { status: 'REJECTED', visibility: 'PRIVATE' }
      });
    }

    res.status(200).json(claim);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

export { adminRouter };

const resolveEscrowSchema = z.object({
  decision: z.enum(['RELEASE_TO_CREATOR', 'TRANSFER_TO_CLAIMANT'])
});

adminRouter.post('/copyright/claims/:id/resolve-escrow', async (req: Request, res: Response) => {
  try {
    const claimId = req.params.id;
    const { decision } = resolveEscrowSchema.parse(req.body);

    const escrow = await prisma.escrowHold.findUnique({
      where: { claimId },
      include: { claim: true, video: { include: { channel: true } } }
    });

    if (!escrow || escrow.status !== 'HELD') {
      return res.status(400).json({ error: 'No active escrow hold found for this claim' });
    }

    if (decision === 'RELEASE_TO_CREATOR') {
      await prisma.$transaction(async (tx) => {
        const lastTx = await tx.walletTransaction.findFirst({
          where: { channelId: escrow.video.channelId },
          orderBy: { createdAt: 'desc' }
        });
        const currentBalance = lastTx ? Number(lastTx.balanceAfterCents) : 0;
        const amount = Number(escrow.heldAmountCents);

        await tx.walletTransaction.create({
          data: {
            channelId: escrow.video.channelId,
            transactionType: 'REVENUE_CREDIT',
            amountCents: BigInt(amount),
            balanceAfterCents: BigInt(currentBalance + amount),
            referenceId: `escrow-release-${escrow.id}`,
            status: 'AVAILABLE'
          }
        });

        await tx.escrowHold.update({
          where: { id: escrow.id },
          data: { status: 'RELEASED_TO_CREATOR', resolvedAt: new Date() }
        });
      });
    } else {
      await prisma.escrowHold.update({
        where: { id: escrow.id },
        data: { status: 'TRANSFERRED_TO_CLAIMANT', resolvedAt: new Date() }
      });
    }

    res.status(200).json({ success: true, decision });
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
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
