import express, { Request, Response } from 'express';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';

const walletRouter = express.Router();

export function createPayoutRouter(authenticateMiddleware: express.RequestHandler): express.Router {
  const router = express.Router();
  router.post('/', authenticateMiddleware, (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'Payouts are unavailable until a verified payment-provider integration is configured.',
    });
  });
  return router;
}

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
    sendDatabaseErrorResponse(
      res,
      error,
      'Wallet balance is temporarily unavailable because the database is unavailable.',
    );
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
    sendDatabaseErrorResponse(
      res,
      error,
      'Wallet history is temporarily unavailable because the database is unavailable.',
    );
  }
});

walletRouter.use('/request-payout', createPayoutRouter(authenticate));

export { walletRouter };
