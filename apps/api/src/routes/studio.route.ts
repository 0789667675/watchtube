import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';

export interface StudioPerformance {
  id: string;
  title: string;
  views: number;
  watchHours: number;
  _count: { likes: number; comments: number };
}

interface StudioChannel {
  id: string;
  subscriberCount: number;
}

interface StudioAnalyticsData {
  totalViews: number;
  totalWatchHours: number;
  recentPerformance: StudioPerformance[];
}

interface StudioAnalyticsPeriod {
  from: Date;
  toExclusive: Date;
}

export interface StudioAnalyticsRepository {
  findOwnedChannel(userId: string, channelId?: string): Promise<StudioChannel | null>;
  getAnalytics(channelId: string, period: StudioAnalyticsPeriod): Promise<StudioAnalyticsData>;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid YYYY-MM-DD date.');

const querySchema = z.object({
  channelId: z.string().uuid().optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
}).strict();

function defaultPeriod(now = new Date()): { from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  const from = new Date(`${today}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: today };
}

export function createStudioRouter(
  authenticateMiddleware: express.RequestHandler,
  repository: StudioAnalyticsRepository,
): express.Router {
  const router = express.Router();

  router.get('/analytics', authenticateMiddleware, async (req: AuthRequest, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success || Boolean(parsed.data?.from) !== Boolean(parsed.data?.to)) {
      res.status(400).json({ error: 'Provide a valid channel and a complete date range.' });
      return;
    }

    const defaults = defaultPeriod();
    const from = parsed.data.from ?? defaults.from;
    const to = parsed.data.to ?? defaults.to;
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toExclusive = new Date(`${to}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    if (toExclusive <= fromDate || toExclusive.getTime() - fromDate.getTime() > 366 * 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: 'The date range must be ordered and no longer than 366 days.' });
      return;
    }

    try {
      const channel = await repository.findOwnedChannel(req.user!.id, parsed.data.channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const analytics = await repository.getAnalytics(channel.id, { from: fromDate, toExclusive });
      res.status(200).json({
        period: { from, to },
        subscriberCount: channel.subscriberCount,
        ...analytics,
      });
    } catch (error) {
      sendDatabaseErrorResponse(
        res,
        error,
        'Channel analytics are temporarily unavailable because the database is unavailable.',
      );
    }
  });

  return router;
}

export const studioRouter = createStudioRouter(authenticate, {
  async findOwnedChannel(userId, channelId) {
    return prisma.channel.findFirst({
      where: { userId, ...(channelId ? { id: channelId } : {}) },
      select: { id: true, subscriberCount: true },
      orderBy: { createdAt: 'asc' },
    });
  },
  async getAnalytics(channelId, period) {
    const dateFilter = { gte: period.from, lt: period.toExclusive };
    const views = await prisma.videoViewEvent.groupBy({
      by: ['videoId'],
      where: {
        video: { channelId },
        isValidView: true,
        createdAt: dateFilter,
      },
      _count: { _all: true },
      _sum: { watchDurationSeconds: true },
    });
    const sortedViews = [...views].sort((a, b) => b._count._all - a._count._all).slice(0, 10);
    const videoIds = sortedViews.map((item) => item.videoId);

    const [videos, likes, comments] = videoIds.length
      ? await Promise.all([
        prisma.video.findMany({
          where: { id: { in: videoIds }, channelId },
          select: { id: true, title: true },
        }),
        prisma.videoLike.groupBy({
          by: ['videoId'],
          where: {
            videoId: { in: videoIds },
            isDislike: false,
            createdAt: dateFilter,
          },
          _count: { _all: true },
        }),
        prisma.comment.groupBy({
          by: ['videoId'],
          where: { videoId: { in: videoIds }, createdAt: dateFilter },
          _count: { _all: true },
        }),
      ])
      : [[], [], []];

    const titleById = new Map(videos.map((video) => [video.id, video.title]));
    const likesById = new Map(likes.map((item) => [item.videoId, item._count._all]));
    const commentsById = new Map(comments.map((item) => [item.videoId, item._count._all]));
    const recentPerformance = sortedViews.flatMap((item) => {
      const title = titleById.get(item.videoId);
      if (title === undefined) return [];
      return [{
        id: item.videoId,
        title,
        views: item._count._all,
        watchHours: (item._sum.watchDurationSeconds ?? 0) / 3600,
        _count: {
          likes: likesById.get(item.videoId) ?? 0,
          comments: commentsById.get(item.videoId) ?? 0,
        },
      }];
    });

    return {
      totalViews: views.reduce((total, item) => total + item._count._all, 0),
      totalWatchHours: views.reduce((total, item) => total + (item._sum.watchDurationSeconds ?? 0), 0) / 3600,
      recentPerformance,
    };
  },
});
