import express, { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { db as prisma, type Prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { publicRepliesWhere, publicTopLevelCommentsWhere } from '../security/publicContent';
import { publicVideoWhere } from '../security/publicContent';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';

const interactionRouter = express.Router();

interface SubscriptionFeedRepository {
  findChannelIds(userId: string): Promise<Array<{ channelId: string }>>;
  findVideos(query: Prisma.VideoFindManyArgs): Promise<unknown[]>;
}

export function createSubscriptionFeedRouter(
  authenticateMiddleware: RequestHandler,
  repository: SubscriptionFeedRepository = {
    findChannelIds: async (userId) => prisma.subscription.findMany({
      where: { subscriberId: userId },
      select: { channelId: true },
    }),
    findVideos: (query) => prisma.video.findMany(query),
  },
) {
  const router = express.Router();

  router.get('/feed/subscriptions', authenticateMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 12;
      const skip = (page - 1) * limit;
      const subscriptions = await repository.findChannelIds(userId);
      const channelIds = subscriptions.map((subscription) => subscription.channelId);
      const videos = await repository.findVideos({
        where: {
          channelId: { in: channelIds },
          status: { in: ['READY', 'PUBLISHED'] },
          visibility: 'PUBLIC',
        },
        skip,
        take: limit,
        orderBy: { publishedAt: 'desc' },
        include: {
          channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
        },
      });
      res.status(200).json(videos);
    } catch (error) {
      sendDatabaseErrorResponse(
        res,
        error,
        'Subscriptions are temporarily unavailable because the database is unavailable.',
      );
    }
  });

  return router;
}

interactionRouter.get('/videos/:id/like-status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const video = await prisma.video.findFirst({
      where: publicVideoWhere(videoId),
      select: { id: true },
    });
    if (!video) return res.status(404).json({ error: 'Video not found or not available' });
    const like = await prisma.videoLike.findUnique({
      where: { userId_videoId: { userId: req.user!.id, videoId } },
      select: { isDislike: true },
    });
    res.status(200).json({
      isLiked: like ? !like.isDislike : false,
      isDisliked: like?.isDislike ?? false,
    });
  } catch (error) {
    sendDatabaseErrorResponse(res, error, 'Video reaction status is temporarily unavailable.');
  }
});

interactionRouter.post('/videos/:id/like', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.id;
    const { isDislike } = z.object({ isDislike: z.boolean() }).parse(req.body);
    const video = await prisma.video.findFirst({
      where: publicVideoWhere(videoId),
      select: { id: true },
    });
    if (!video) return res.status(404).json({ error: 'Video not found or not available' });

    const existingLike = await prisma.videoLike.findUnique({
      where: { userId_videoId: { userId, videoId } }
    });

    if (existingLike) {
      if (existingLike.isDislike === isDislike) {
        await prisma.videoLike.delete({ where: { id: existingLike.id } });
      } else {
        await prisma.videoLike.update({
          where: { id: existingLike.id },
          data: { isDislike }
        });
      }
    } else {
      await prisma.videoLike.create({
        data: { userId, videoId, isDislike }
      });
    }

    const updatedLike = await prisma.videoLike.findUnique({
      where: { userId_videoId: { userId, videoId } },
      select: { isDislike: true },
    });
    res.status(200).json({
      success: true,
      isLiked: updatedLike ? !updatedLike.isDislike : false,
      isDisliked: updatedLike?.isDislike ?? false,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    sendDatabaseErrorResponse(res, error, 'Video interaction is temporarily unavailable because the database is unavailable.');
  }
});

interactionRouter.post('/channels/:id/subscribe', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = req.params.id;
    const userId = req.user!.id;

    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.userId === userId) return res.status(400).json({ error: 'Cannot subscribe to own channel' });

    const existingSub = await prisma.subscription.findUnique({
      where: { subscriberId_channelId: { subscriberId: userId, channelId } }
    });

    if (existingSub) {
      await prisma.$transaction([
        prisma.subscription.delete({ where: { id: existingSub.id } }),
        prisma.channel.update({ where: { id: channelId }, data: { subscriberCount: { decrement: 1 } } })
      ]);
      res.status(200).json({ isSubscribed: false });
    } else {
      await prisma.$transaction([
        prisma.subscription.create({ data: { subscriberId: userId, channelId } }),
        prisma.channel.update({ where: { id: channelId }, data: { subscriberCount: { increment: 1 } } })
      ]);
      res.status(200).json({ isSubscribed: true });
    }
  } catch (error) {
    sendDatabaseErrorResponse(res, error, 'Subscription changes are temporarily unavailable because the database is unavailable.');
  }
});

interactionRouter.get('/channels/:id/subscription-status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = req.params.id;
    const userId = req.user!.id;
    const existingSub = await prisma.subscription.findUnique({
      where: { subscriberId_channelId: { subscriberId: userId, channelId } }
    });
    res.status(200).json({ isSubscribed: !!existingSub });
  } catch (error) {
    sendDatabaseErrorResponse(res, error, 'Subscription status is temporarily unavailable because the database is unavailable.');
  }
});

interactionRouter.get('/videos/:id/comments', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.id;
    const cursor = req.query.cursor as string;
    const limit = 20;

    const comments = await prisma.comment.findMany({
      where: publicTopLevelCommentsWhere(videoId),
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { channels: { select: { avatarUrl: true, handle: true, name: true } } } },
        _count: { select: { replies: true } }
      }
    });

    let nextCursor = undefined;
    if (comments.length > limit) {
      const nextItem = comments.pop();
      nextCursor = nextItem!.id;
    }

    res.status(200).json({ comments, nextCursor });
  } catch (error) {
    sendDatabaseErrorResponse(res, error, 'Comments are temporarily unavailable because the database is unavailable.');
  }
});

interactionRouter.get('/comments/:id/replies', async (req: Request, res: Response) => {
  try {
    const parentId = req.params.id;
    const replies = await prisma.comment.findMany({
      where: publicRepliesWhere(parentId),
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { channels: { select: { avatarUrl: true, handle: true, name: true } } } }
      }
    });
    res.status(200).json(replies);
  } catch (error) {
    sendDatabaseErrorResponse(res, error, 'Replies are temporarily unavailable because the database is unavailable.');
  }
});

interactionRouter.post('/videos/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.id;
    const { content, parentId } = z.object({
      content: z.string().min(1).max(1000),
      parentId: z.string().uuid().optional().nullable()
    }).parse(req.body);
    const video = await prisma.video.findFirst({
      where: publicVideoWhere(videoId),
      select: { id: true },
    });
    if (!video) return res.status(404).json({ error: 'Video not found or not available' });
    if (parentId) {
      const parent = await prisma.comment.findFirst({
        where: { id: parentId, videoId, parentId: null },
        select: { id: true },
      });
      if (!parent) return res.status(404).json({ error: 'Parent comment not found' });
    }

    const comment = await prisma.comment.create({
      data: { videoId, userId, content, parentId }
    });

    res.status(201).json(comment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    sendDatabaseErrorResponse(res, error, 'Comment submission is temporarily unavailable because the database is unavailable.');
  }
});

interactionRouter.use(createSubscriptionFeedRouter(authenticate));

export { interactionRouter };
