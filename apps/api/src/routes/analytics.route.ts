import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';
import { publicVideoAccessWhere } from '../security/publicContent';

const analyticsRouter = express.Router();

export interface ViewerTelemetryRepository {
  findPublicVideo(videoId: string): Promise<{ id: string; duration: number | null } | null>;
  findRecentValidView(videoId: string, sessionId: string, userId: string | undefined): Promise<{ id: string } | null>;
  incrementViews(videoId: string): Promise<void>;
  createViewEvent(input: {
    videoId: string;
    userId: string | undefined;
    sessionId: string;
    watchDurationSeconds: number;
    isValidView: boolean;
    ipHash: string;
  }): Promise<void>;
  upsertWatchHistory(input: {
    userId: string;
    videoId: string;
    currentPosition: number;
    completed: boolean;
  }): Promise<void>;
}

analyticsRouter.get('/history/:videoId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = z.object({ videoId: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid video id' });
      return;
    }
    const video = await prisma.video.findFirst({
      where: { id: parsed.data.videoId, ...publicVideoAccessWhere() },
      select: { id: true },
    });
    if (!video) {
      res.status(404).json({ error: 'Video not found or not available' });
      return;
    }
    const history = await prisma.watchHistory.findUnique({
      where: {
        userId_videoId: {
          userId: req.user!.id,
          videoId: parsed.data.videoId,
        },
      },
      select: { lastPositionSeconds: true, completed: true },
    });
    res.status(200).json(history ?? { lastPositionSeconds: 0, completed: false });
  } catch (error) {
    sendDatabaseErrorResponse(res, error, 'Watch history is temporarily unavailable.');
  }
});

const telemetrySchema = z.object({
  videoId: z.string().uuid(),
  sessionId: z.string().trim().min(1).max(128),
  currentPosition: z.number().finite().nonnegative().max(86400),
  durationWatched: z.number().finite().nonnegative().max(86400),
  completed: z.boolean(),
});

analyticsRouter.post('/telemetry', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { videoId, sessionId, currentPosition, durationWatched, completed } = telemetrySchema.parse(req.body);
    const ipHash = req.ip || 'unknown';

    const video = await prisma.video.findFirst({
      where: { id: videoId, ...publicVideoAccessWhere() },
      select: { id: true, duration: true },
    });
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
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    sendDatabaseErrorResponse(res, error, 'Playback activity is temporarily unavailable because the database is unavailable.');
  }
});

export { analyticsRouter };
