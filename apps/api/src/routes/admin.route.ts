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
