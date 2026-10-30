import express, { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const monetizationRouter = express.Router();

const adEventSchema = z.object({
  videoId: z.string().uuid(),
  eventType: z.enum(['AD_REQUEST', 'AD_SERVED', 'AD_VIEWABLE', 'AD_CLICK']),
  provider: z.string(),
  sessionId: z.string()
});

monetizationRouter.post('/ad-event', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { videoId, eventType, provider, sessionId } = adEventSchema.parse(req.body);
    const ipHash = req.ip || 'unknown';

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: { channel: true, copyrightClaims: { where: { status: { in: ['OPEN', 'UNDER_REVIEW', 'DISPUTED'] } } } }
    });

    if (!video || !video.channel.isMonetized) {
      return res.status(400).json({ error: 'Video not eligible for monetization' });
    }

    const estimatedValueCents = eventType === 'AD_VIEWABLE' ? 5 : 0;

    const hasActiveClaim = video.copyrightClaims.length > 0;

    if (hasActiveClaim && estimatedValueCents > 0) {
      const claim = video.copyrightClaims[0];
      await prisma.escrowHold.upsert({
        where: { claimId: claim.id },
        update: { heldAmountCents: { increment: estimatedValueCents } },
        create: {
          videoId,
          claimId: claim.id,
          heldAmountCents: estimatedValueCents,
          status: 'HELD'
        }
      });
    }

    const adEvent = await prisma.adEvent.create({
      data: {
        videoId,
        channelId: video.channelId,
        eventType,
        provider,
        grossRevenueCents: estimatedValueCents,
        ipHash
      }
    });

    res.status(201).json(adEvent);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

monetizationRouter.get('/config', (req: Request, res: Response) => {
  res.status(200).json({
    enabled: true,
    provider: 'GOOGLE_IMA',
    testVastUrl: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator='
  });
});

const reconcileSchema = z.object({
  monthYear: z.string(),
  grossProviderRevenueCents: z.number().positive()
});

monetizationRouter.post('/reconcile', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { monthYear, grossProviderRevenueCents } = reconcileSchema.parse(req.body);

    const existing = await prisma.revenueReconciliation.findFirst({ where: { monthYear, status: 'FINALIZED' } });
    if (existing) {
      return res.status(400).json({ error: 'Month already finalized' });
    }

    const platformShareCents = Math.floor(grossProviderRevenueCents * 0.5);
    const creatorPoolCents = grossProviderRevenueCents - platformShareCents;

    // VERY simplified mock distribution logic for demo
    // In reality, this would group valid VideoViewEvents by channel for the month.
    const eligibleChannels = await prisma.channel.findMany({ where: { isMonetized: true } });

    if (eligibleChannels.length > 0) {
      const splitAmount = Math.floor(creatorPoolCents / eligibleChannels.length);

      await prisma.$transaction(async (tx) => {
        for (const channel of eligibleChannels) {
          const lastTx = await tx.walletTransaction.findFirst({
            where: { channelId: channel.id },
            orderBy: { createdAt: 'desc' }
          });
          const currentBalance = lastTx ? Number(lastTx.balanceAfterCents) : 0;

          await tx.walletTransaction.create({
            data: {
              channelId: channel.id,
              transactionType: 'REVENUE_CREDIT',
              amountCents: BigInt(splitAmount),
              balanceAfterCents: BigInt(currentBalance + splitAmount),
              referenceId: `recon-${monthYear}-${channel.id}`,
              status: 'AVAILABLE'
            }
          });
        }

        await tx.revenueReconciliation.create({
          data: {
            monthYear,
            grossProviderRevenueCents: BigInt(grossProviderRevenueCents),
            platformShareCents: BigInt(platformShareCents),
            creatorPoolCents: BigInt(creatorPoolCents),
            status: 'FINALIZED',
            finalizedAt: new Date()
          }
        });
      });
    }

    res.status(200).json({ success: true, creatorPoolCents });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { monetizationRouter };
