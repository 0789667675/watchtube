import express, { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();
const trustRouter = express.Router();

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
    res.status(400).json({ error: 'Invalid request' });
  }
});

trustRouter.get('/wtpp/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const channel = await prisma.channel.findFirst({ where: { userId } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const activeStrikes = await prisma.userStrike.count({
      where: { userId, expiresAt: { gt: new Date() } }
    });

    const videos = await prisma.video.findMany({ where: { channelId: channel.id } });
    const viewEvents = await prisma.videoViewEvent.findMany({
      where: { videoId: { in: videos.map(v => v.id) }, isValidView: true }
    });

    const totalWatchHours = viewEvents.reduce((acc, ev) => acc + ev.watchDurationSeconds, 0) / 3600;

    const application = await prisma.wtppApplication.findUnique({ where: { channelId: channel.id } });

    res.status(200).json({
      subscriberCount: channel.subscriberCount,
      totalWatchHours,
      activeStrikes,
      isMonetized: channel.isMonetized,
      applicationStatus: application ? application.status : 'NOT_APPLIED',
      isEligible: channel.subscriberCount >= 1000 && totalWatchHours >= 4000 && activeStrikes === 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const applySchema = z.object({
  taxId: z.string().optional(),
  nationalIdOrPassport: z.string().optional()
});

trustRouter.post('/wtpp/apply', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { taxId, nationalIdOrPassport } = applySchema.parse(req.body);

    const channel = await prisma.channel.findFirst({ where: { userId } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const existing = await prisma.wtppApplication.findUnique({ where: { channelId: channel.id } });
    if (existing && existing.status !== 'REJECTED') {
      return res.status(400).json({ error: 'Application already in progress or approved' });
    }

    // Recalculate stats for snapshot
    const videos = await prisma.video.findMany({ where: { channelId: channel.id } });
    const viewEvents = await prisma.videoViewEvent.findMany({
      where: { videoId: { in: videos.map(v => v.id) }, isValidView: true }
    });
    const channelWatchHours = viewEvents.reduce((acc, ev) => acc + ev.watchDurationSeconds, 0) / 3600;

    const application = await prisma.wtppApplication.upsert({
      where: { channelId: channel.id },
      update: {
        status: 'PENDING',
        channelWatchHours,
        subscriberCount: channel.subscriberCount,
        taxId,
        nationalIdOrPassport,
        submittedAt: new Date()
      },
      create: {
        channelId: channel.id,
        status: 'PENDING',
        channelWatchHours,
        subscriberCount: channel.subscriberCount,
        taxId,
        nationalIdOrPassport
      }
    });

    res.status(201).json(application);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

export { trustRouter };
