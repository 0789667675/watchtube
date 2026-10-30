import express, { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';

const prisma = new PrismaClient();
const feedRouter = express.Router();

feedRouter.get('/search', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const category = req.query.category as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 12;
    const skip = (page - 1) * limit;

    if (!q) {
      return res.status(400).json({ error: 'Missing query parameter q' });
    }

    const videos = await prisma.video.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { channel: { name: { contains: q, mode: 'insensitive' } } },
          { channel: { handle: { contains: q, mode: 'insensitive' } } }
        ]
      },
      skip,
      take: limit,
      include: {
        channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } }
      }
    });

    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

feedRouter.get('/trending', async (req: Request, res: Response) => {
  try {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Simplistic trending logic for now (mocking velocity with pure viewsCount due to SQLite/Prisma limits in group-by on related tables easily)
    const videos = await prisma.video.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
        createdAt: { gte: fortyEightHoursAgo }
      },
      orderBy: { viewsCount: 'desc' },
      take: 10,
      include: {
        channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } }
      }
    });

    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { feedRouter };
