import express, { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();
const analyticsRouter = express.Router();

const telemetrySchema = z.object({
  videoId: z.string().uuid(),
  sessionId: z.string(),
  currentPosition: z.number().nonnegative(),
  durationWatched: z.number().nonnegative(),
  completed: z.boolean(),
});

analyticsRouter.post('/telemetry', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { videoId, sessionId, currentPosition, durationWatched, completed } = telemetrySchema.parse(req.body);
    const ipHash = req.ip || 'unknown';

    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) return res.status(404).json({ error: 'Video not found' });

    let isValidView = false;

    if (durationWatched >= 15 || (video.duration && durationWatched >= video.duration * 0.5)) {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      const recentView = await prisma.videoViewEvent.findFirst({
        where: {
          videoId,
          OR: [
            { sessionId },
            userId ? { userId } : {}
          ],
          isValidView: true,
          createdAt: { gte: thirtyMinutesAgo }
        }
      });

      if (!recentView) {
        isValidView = true;
        await prisma.video.update({
          where: { id: videoId },
          data: { viewsCount: { increment: 1 } }
        });
      }
    }

    await prisma.videoViewEvent.create({
      data: {
        videoId,
        userId,
        sessionId,
        watchDurationSeconds: durationWatched,
        isValidView,
        ipHash
      }
    });

    if (userId) {
      const watchHistory = await prisma.watchHistory.upsert({
        where: { userId_videoId: { userId, videoId } },
        update: { lastPositionSeconds: currentPosition, completed },
        create: { userId, videoId, lastPositionSeconds: currentPosition, completed }
      });
    }

    res.status(200).json({ success: true, isValidView });
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

export { analyticsRouter };
