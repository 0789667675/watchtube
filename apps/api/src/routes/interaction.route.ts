import express, { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();
const interactionRouter = express.Router();

interactionRouter.post('/videos/:id/like', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.id;
    const { isDislike } = z.object({ isDislike: z.boolean() }).parse(req.body);

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

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

interactionRouter.get('/videos/:id/comments', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.id;
    const cursor = req.query.cursor as string;
    const limit = 20;

    const comments = await prisma.comment.findMany({
      where: { videoId, parentId: null },
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

interactionRouter.get('/comments/:id/replies', async (req: Request, res: Response) => {
  try {
    const parentId = req.params.id;
    const replies = await prisma.comment.findMany({
      where: { parentId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { channels: { select: { avatarUrl: true, handle: true, name: true } } } }
      }
    });
    res.status(200).json(replies);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
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

    const comment = await prisma.comment.create({
      data: { videoId, userId, content, parentId }
    });

    res.status(201).json(comment);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

interactionRouter.get('/feed/subscriptions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 12;
    const skip = (page - 1) * limit;

    const subscriptions = await prisma.subscription.findMany({
      where: { subscriberId: userId },
      select: { channelId: true }
    });

    const channelIds = subscriptions.map(s => s.channelId);

    const videos = await prisma.video.findMany({
      where: {
        channelId: { in: channelIds },
        status: 'READY',
        visibility: 'PUBLIC'
      },
      skip,
      take: limit,
      orderBy: { publishedAt: 'desc' },
      include: {
        channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } }
      }
    });

    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { interactionRouter };
