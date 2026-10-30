import express, { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const walletRouter = express.Router();

walletRouter.get('/balance', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const channel = await prisma.channel.findFirst({ where: { userId } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const lastTx = await prisma.walletTransaction.findFirst({
      where: { channelId: channel.id },
      orderBy: { createdAt: 'desc' }
    });

    const balanceCents = lastTx ? lastTx.balanceAfterCents.toString() : '0';
    res.status(200).json({ balanceCents, currency: 'RWF' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

walletRouter.get('/ledger', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const channel = await prisma.channel.findFirst({ where: { userId } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const ledger = await prisma.walletTransaction.findMany({
      where: { channelId: channel.id },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' }
    });

    // BigInt serialization fix
    const serializedLedger = ledger.map(tx => ({
        ...tx,
        amountCents: tx.amountCents.toString(),
        balanceAfterCents: tx.balanceAfterCents.toString(),
    }));

    res.status(200).json(serializedLedger);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const payoutSchema = z.object({
  amountCents: z.number().positive(),
  provider: z.enum(['MTN_MOMO', 'AIRTEL_MONEY']),
  phoneNumber: z.string()
});

walletRouter.post('/request-payout', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { amountCents, provider, phoneNumber } = payoutSchema.parse(req.body);

    const channel = await prisma.channel.findFirst({ where: { userId } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const lastTx = await prisma.walletTransaction.findFirst({
      where: { channelId: channel.id },
      orderBy: { createdAt: 'desc' }
    });

    const currentBalance = lastTx ? Number(lastTx.balanceAfterCents) : 0;

    if (amountCents > currentBalance) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const referenceId = uuidv4();
    const newBalance = currentBalance - amountCents;

    const tx = await prisma.walletTransaction.create({
      data: {
        channelId: channel.id,
        transactionType: 'PAYOUT',
        amountCents: BigInt(-amountCents),
        balanceAfterCents: BigInt(newBalance),
        referenceId,
        status: 'PENDING'
      }
    });

    res.status(201).json({
      id: tx.id,
      status: tx.status,
      referenceId,
      amountCents: tx.amountCents.toString(),
      balanceAfterCents: tx.balanceAfterCents.toString()
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
    } else {
        res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export { walletRouter };
