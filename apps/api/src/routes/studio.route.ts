import express, { Request, Response } from 'express';
import { PrismaClient } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();
const studioRouter = express.Router();

studioRouter.get('/analytics', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const channel = await prisma.channel.findFirst({ where: { userId } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const videos = await prisma.video.findMany({ where: { channelId: channel.id } });
    const videoIds = videos.map(v => v.id);

    const totalViews = videos.reduce((acc, v) => acc + v.viewsCount, 0);

    const viewEvents = await prisma.videoViewEvent.findMany({
      where: { videoId: { in: videoIds }, isValidView: true }
    });

    const totalWatchSeconds = viewEvents.reduce((acc, ev) => acc + ev.watchDurationSeconds, 0);
    const totalWatchHours = totalWatchSeconds / 3600;

    const recentPerformance = await prisma.video.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        _count: { select: { likes: true, comments: true } }
      }
    });

    res.status(200).json({
      totalViews,
      totalWatchHours,
      subscriberCount: channel.subscriberCount,
      recentPerformance
    });

  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { studioRouter };
