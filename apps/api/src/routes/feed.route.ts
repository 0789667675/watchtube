import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db as prisma, type Prisma } from '@watchtube/database';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';

type FindVideos = (query: Prisma.VideoFindManyArgs) => Promise<unknown[]>;
type FindChannels = (query: Prisma.ChannelFindManyArgs) => Promise<unknown[]>;

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

const searchQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100),
});

function parsePageQuery(req: Request, res: Response) {
  const parsed = pageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid pagination parameters' });
    return null;
  }
  return parsed.data;
}

export function createPublicVideosHandler(findVideos: FindVideos) {
  return async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 12;
      const skip = (page - 1) * limit;

      const videos = await findVideos({
        where: { status: { in: ['READY', 'PUBLISHED'] }, visibility: 'PUBLIC' },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          channel: {
            select: { name: true, handle: true, avatarUrl: true, isVerified: true },
          },
        },
      });
      res.status(200).json(videos);
    } catch (error) {
      sendDatabaseErrorResponse(
        res,
        error,
        'Discover videos are temporarily unavailable because the database is unavailable.',
      );
    }
  };
}

export function createFeedRouter(
  findVideos: FindVideos = (query) => prisma.video.findMany(query),
  findChannels: FindChannels = (query) => prisma.channel.findMany(query),
) {
  const feedRouter = express.Router();

  feedRouter.get('/search', async (req: Request, res: Response) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a search term of 1 to 100 characters and valid pagination.' });
      return;
    }

    const { q, page, limit } = parsed.data;
    const skip = (page - 1) * limit;
    try {
      const [videoMatches, channelMatches] = await Promise.all([
        findVideos({
          where: {
            status: { in: ['READY', 'PUBLISHED'] },
            visibility: 'PUBLIC',
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { channel: { name: { contains: q, mode: 'insensitive' } } },
              { channel: { handle: { contains: q, mode: 'insensitive' } } },
            ],
          },
          skip,
          take: limit + 1,
          orderBy: [{ viewsCount: 'desc' }, { createdAt: 'desc' }],
          include: {
            channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
          },
        }),
        findChannels({
          where: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { handle: { contains: q, mode: 'insensitive' } },
            ],
          },
          skip,
          take: limit + 1,
          orderBy: [{ subscriberCount: 'desc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            handle: true,
            avatarUrl: true,
            isVerified: true,
            subscriberCount: true,
          },
        }),
      ]);

      res.status(200).json({
        videos: videoMatches.slice(0, limit),
        channels: channelMatches.slice(0, limit),
        pagination: {
          page,
          limit,
          hasMoreVideos: videoMatches.length > limit,
          hasMoreChannels: channelMatches.length > limit,
        },
      });
    } catch (error) {
      sendDatabaseErrorResponse(
        res,
        error,
        'Search is temporarily unavailable because the database is unavailable.',
      );
    }
  });

  feedRouter.get('/trending', async (req: Request, res: Response) => {
    const pagination = parsePageQuery(req, res);
    if (!pagination) return;
    const { page, limit } = pagination;

    try {
      const videos = await findVideos({
        where: {
          status: { in: ['READY', 'PUBLISHED'] },
          visibility: 'PUBLIC',
          OR: [
            { viewsCount: { gt: 0 } },
            { likes: { some: { isDislike: false } } },
            { comments: { some: {} } },
          ],
        },
        skip: (page - 1) * limit,
        take: limit + 1,
        orderBy: [
          { viewsCount: 'desc' },
          { comments: { _count: 'desc' } },
          { createdAt: 'desc' },
        ],
        include: {
          channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
        },
      });

      res.status(200).json({
        videos: videos.slice(0, limit),
        pagination: { page, limit, hasMore: videos.length > limit },
      });
    } catch (error) {
      sendDatabaseErrorResponse(
        res,
        error,
        'Trending videos are temporarily unavailable because the database is unavailable.',
      );
    }
  });

  return feedRouter;
}

export const feedRouter = createFeedRouter();
