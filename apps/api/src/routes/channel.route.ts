import express, { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();
const channelRouter = express.Router();

const channelSchema = z.object({
  name: z.string().min(1),
  handle: z.string().regex(/^@[a-zA-Z0-9_]+$/),
  description: z.string().optional(),
});

channelRouter.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, handle, description } = channelSchema.parse(req.body);

    const existing = await prisma.channel.findUnique({ where: { handle } });
    if (existing) {
      res.status(400).json({ error: 'Handle taken' });
      return;
    }

    const channel = await prisma.channel.create({
      data: {
        userId: req.user!.id,
        name,
        handle,
        description,
      }
    });

    res.status(201).json(channel);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

channelRouter.get('/:handle', async (req: Request, res: Response) => {
  try {
    const handle = req.params.handle;

    const channel = await prisma.channel.findUnique({
      where: { handle },
      include: {
        videos: {
          where: { status: 'READY', visibility: 'PUBLIC' },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.status(200).json(channel);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { channelRouter };
