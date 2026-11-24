import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';
import {
  InsufficientFundsError,
  LEDGER_CURRENCY,
  LedgerIntegrityError,
  LedgerValidationError,
  PrismaWalletLedgerRepository,
  WalletLedgerService,
} from '../services/finance/ledger.service';
import {
  defaultPaymentOrchestrator,
  defaultPaymentService,
  MobileMoneyProviderName,
  OrchestratorError,
  PaymentOrchestratorService,
  PaymentProviderError,
  PaymentService,
} from '../services/payments';

const walletRouter = express.Router();

export interface PayoutRouterOptions {
  orchestrator?: PaymentOrchestratorService;
  paymentService?: PaymentService;
  prismaClient?: any;
}

const payoutRequestSchema = z.object({
  provider: z.enum(['MTN_MOMO', 'AIRTEL_MONEY']),
  amountCents: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  phoneNumber: z.string().trim().min(9).max(20),
  idempotencyKey: z.string().trim().min(4).max(128).optional(),
  currency: z.literal(LEDGER_CURRENCY).optional(),
  narrative: z.string().trim().max(140).optional(),
}).strict();

export function createPayoutRouter(
  authenticateMiddleware: express.RequestHandler,
  options: PayoutRouterOptions = {}
): express.Router {
  const router = express.Router();

  router.post('/', authenticateMiddleware, async (req: AuthRequest, res: Response) => {
    // If legacy paymentService is explicitly injected by a caller/test, delegate to it
    if (options.paymentService && !options.orchestrator) {
      const { provider, amountCents, phoneNumber, idempotencyKey } = req.body || {};
      const dbClient = options.prismaClient || prisma;

      if (!provider || !options.paymentService.isProviderConfigured(provider as MobileMoneyProviderName)) {
        return res.status(501).json({
          error: 'Payouts are unavailable until a verified payment-provider integration is configured.',
        });
      }

      if (!amountCents || !phoneNumber || !idempotencyKey) {
        return res.status(400).json({
          error: 'Missing required payout fields (amountCents, phoneNumber, idempotencyKey)',
        });
      }

      try {
        const userId = req.user?.id || (req as any).user?.id;
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = await options.paymentService.requestPayout(
          userId,
          { amountCents, provider: provider as MobileMoneyProviderName, phoneNumber, idempotencyKey },
          dbClient
        );

        if (!result.success) {
          const statusCode = result.error === 'INSUFFICIENT_FUNDS' ? 400 : 502;
          return res.status(statusCode).json({
            error: result.failureReason || result.error,
            code: result.error,
          });
        }

        return res.status(200).json({
          success: true,
          transaction: result.transaction,
        });
      } catch (error) {
        return sendDatabaseErrorResponse(
          res,
          error,
          'Payout processing failed due to database unavailability.'
        );
      }
    }

    const orchestrator = options.orchestrator || defaultPaymentOrchestrator;

    const rawProvider = req.body?.provider;
    if (
      (rawProvider === 'MTN_MOMO' || rawProvider === 'AIRTEL_MONEY')
      && !orchestrator.getAdapter(rawProvider).isConfigured()
    ) {
      return res.status(501).json({
        error: 'Payouts are unavailable until a verified payment-provider integration is configured.',
      });
    }
    if (!rawProvider) {
      const anyConfigured =
        orchestrator.getAdapter('MTN_MOMO').isConfigured()
        || orchestrator.getAdapter('AIRTEL_MONEY').isConfigured();
      if (!anyConfigured) {
        return res.status(501).json({
          error: 'Payouts are unavailable until a verified payment-provider integration is configured.',
        });
      }
    }

    const parsed = payoutRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid payout request payload',
        details: parsed.error.issues,
      });
    }

    const headerIdemKey = typeof req.headers['idempotency-key'] === 'string'
      ? req.headers['idempotency-key'].trim()
      : undefined;
    const idempotencyKey = headerIdemKey || parsed.data.idempotencyKey;
    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'Missing idempotencyKey in request body or Idempotency-Key header.',
        code: 'MISSING_IDEMPOTENCY_KEY',
      });
    }

    const userId = req.user?.id || (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const outcome = await orchestrator.initiateCreatorPayout({
        userId,
        provider: parsed.data.provider,
        amountCents: parsed.data.amountCents,
        currency: parsed.data.currency,
        phoneNumber: parsed.data.phoneNumber,
        idempotencyKey,
        narrative: parsed.data.narrative,
      });

      // Payout initiation ALWAYS leaves status as PENDING (202 Accepted) until verified provider settlement
      return res.status(202).json({
        success: true,
        idempotentReplay: outcome.idempotentReplay,
        payoutId: outcome.transaction.transactionId,
        status: outcome.transaction.status,
        provider: outcome.transaction.provider,
        providerReference: outcome.transaction.providerReference,
        amountCents: outcome.transaction.amountCents.toString(),
        currency: outcome.transaction.currency,
        maskedPhone: outcome.transaction.maskedPhone,
        reconciliationRequired: outcome.transaction.reconciliationRequired,
        ...(outcome.balanceAfterCents !== undefined
          ? { balanceAfterCents: outcome.balanceAfterCents.toString() }
          : {}),
      });
    } catch (error) {
      if (error instanceof OrchestratorError || error instanceof PaymentProviderError || error instanceof LedgerValidationError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      if (error instanceof InsufficientFundsError) {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      if (error instanceof LedgerIntegrityError) {
        return res.status(500).json({ error: 'Ledger integrity error detected.', code: error.code });
      }
      return sendDatabaseErrorResponse(
        res,
        error,
        'Payout processing failed due to database unavailability.'
      );
    }
  });

  return router;
}

export function createPaymentWebhookRouter(
  options: PayoutRouterOptions = {}
): express.Router {
  const router = express.Router();
  const dbClient = options.prismaClient || prisma;

  router.post('/webhooks/:provider', async (req: Request, res: Response) => {
    const rawProvider = (req.params.provider || '').trim().toUpperCase();
    const provider: MobileMoneyProviderName | null =
      rawProvider === 'MTN' || rawProvider === 'MTN_MOMO'
        ? 'MTN_MOMO'
        : rawProvider === 'AIRTEL' || rawProvider === 'AIRTEL_MONEY'
          ? 'AIRTEL_MONEY'
          : null;

    if (!provider) {
      return res.status(404).json({ error: 'Unknown payment provider.' });
    }

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : (req as any).rawBody || JSON.stringify(req.body || {});
    let parsedBody = req.body;
    if (Buffer.isBuffer(req.body)) {
      try {
        parsedBody = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'Malformed JSON webhook body.', code: 'INVALID_PAYLOAD' });
      }
    }

    // Legacy PaymentService path only when explicitly injected by legacy callers/tests
    if (options.paymentService && !options.orchestrator) {
      const result = await options.paymentService.handleWebhook(
        provider,
        req.headers,
        rawBody,
        parsedBody,
        dbClient
      );

      if (!result.success) {
        return res.status(result.code || 400).json({
          error: result.error,
          reason: result.reason,
        });
      }

      return res.status(200).json({
        success: true,
        processed: result.processed,
        status: result.status,
      });
    }

    const orchestrator = options.orchestrator || defaultPaymentOrchestrator;
    try {
      const result = await orchestrator.processWebhook({
        provider,
        headers: req.headers,
        rawBody,
        parsedBody,
      });
      return res.status(200).json({
        success: true,
        processed: !result.idempotent,
        idempotent: result.idempotent,
        status: result.status,
        transactionId: result.transactionId,
      });
    } catch (error) {
      if (error instanceof OrchestratorError || error instanceof LedgerValidationError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  return router;
}

export interface WalletRouterOptions {
  prismaClient?: any;
  ledgerService?: WalletLedgerService;
  orchestrator?: PaymentOrchestratorService;
  authenticateMiddleware?: express.RequestHandler;
}

export function createWalletRouter(options: WalletRouterOptions = {}): express.Router {
  const router = express.Router();
  const dbClient = options.prismaClient || prisma;
  const ledger = options.ledgerService || new WalletLedgerService(new PrismaWalletLedgerRepository(dbClient));
  const authMiddleware = options.authenticateMiddleware || authenticate;

  router.get('/balance', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const channel = await dbClient.channel.findFirst({ where: { userId }, select: { id: true } });
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const balance = await ledger.getChannelBalance(channel.id);
      if (!balance.integrityVerified) {
        console.error('[WalletRouter] Ledger integrity violation detected for channel:', channel.id, balance.integrityError);
        return res.status(500).json({ error: 'Wallet ledger integrity verification failed.' });
      }

      res.status(200).json({
        balanceCents: balance.availableBalanceCents.toString(),
        availableBalanceCents: balance.availableBalanceCents.toString(),
        pendingPayoutCents: balance.pendingPayoutCents.toString(),
        heldEscrowCents: balance.heldEscrowCents.toString(),
        totalEarnedCents: balance.totalEarnedCents.toString(),
        totalPaidOutCents: balance.totalPaidOutCents.toString(),
        totalReversedPayoutCents: balance.totalReversedPayoutCents.toString(),
        currency: LEDGER_CURRENCY,
      });
    } catch (error) {
      sendDatabaseErrorResponse(
        res,
        error,
        'Wallet balance is temporarily unavailable because the database is unavailable.',
      );
    }
  });

  router.get('/ledger', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const channel = await dbClient.channel.findFirst({ where: { userId }, select: { id: true } });
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;

      const ledgerPage = await ledger.getChannelLedger(channel.id, { page, limit });

      const serializedLedger = ledgerPage.items.map((tx) => ({
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

  router.use(
    '/request-payout',
    createPayoutRouter(authMiddleware, {
      orchestrator: options.orchestrator,
      prismaClient: dbClient,
    })
  );

  router.use(
    createPaymentWebhookRouter({
      orchestrator: options.orchestrator,
      prismaClient: dbClient,
    })
  );

  return router;
}

walletRouter.use('/', createWalletRouter());

export { walletRouter };
