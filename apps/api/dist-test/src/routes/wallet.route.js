"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletRouter = void 0;
exports.createPayoutRouter = createPayoutRouter;
exports.createPaymentWebhookRouter = createPaymentWebhookRouter;
exports.createWalletRouter = createWalletRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const database_1 = require("@watchtube/database");
const auth_1 = require("../middleware/auth");
const databaseErrors_1 = require("../config/databaseErrors");
const ledger_service_1 = require("../services/finance/ledger.service");
const payments_1 = require("../services/payments");
const walletRouter = express_1.default.Router();
exports.walletRouter = walletRouter;
const payoutRequestSchema = zod_1.z.object({
    provider: zod_1.z.enum(['MTN_MOMO', 'AIRTEL_MONEY']),
    amountCents: zod_1.z.union([zod_1.z.number().int().positive(), zod_1.z.string().regex(/^\d+$/)]),
    phoneNumber: zod_1.z.string().trim().min(9).max(20),
    idempotencyKey: zod_1.z.string().trim().min(4).max(128).optional(),
    currency: zod_1.z.literal(ledger_service_1.LEDGER_CURRENCY).optional(),
    narrative: zod_1.z.string().trim().max(140).optional(),
}).strict();
function createPayoutRouter(authenticateMiddleware, options = {}) {
    const router = express_1.default.Router();
    router.post('/', authenticateMiddleware, async (req, res) => {
        // If legacy paymentService is explicitly injected by a caller/test, delegate to it
        if (options.paymentService && !options.orchestrator) {
            const { provider, amountCents, phoneNumber, idempotencyKey } = req.body || {};
            const dbClient = options.prismaClient || database_1.db;
            if (!provider || !options.paymentService.isProviderConfigured(provider)) {
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
                const userId = req.user?.id || req.user?.id;
                if (!userId) {
                    return res.status(401).json({ error: 'Unauthorized' });
                }
                const result = await options.paymentService.requestPayout(userId, { amountCents, provider: provider, phoneNumber, idempotencyKey }, dbClient);
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
            }
            catch (error) {
                return (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Payout processing failed due to database unavailability.');
            }
        }
        const orchestrator = options.orchestrator || payments_1.defaultPaymentOrchestrator;
        const rawProvider = req.body?.provider;
        if ((rawProvider === 'MTN_MOMO' || rawProvider === 'AIRTEL_MONEY')
            && !orchestrator.getAdapter(rawProvider).isConfigured()) {
            return res.status(501).json({
                error: 'Payouts are unavailable until a verified payment-provider integration is configured.',
            });
        }
        if (!rawProvider) {
            const anyConfigured = orchestrator.getAdapter('MTN_MOMO').isConfigured()
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
        const userId = req.user?.id || req.user?.id;
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
        }
        catch (error) {
            if (error instanceof payments_1.OrchestratorError || error instanceof payments_1.PaymentProviderError || error instanceof ledger_service_1.LedgerValidationError) {
                return res.status(error.statusCode).json({ error: error.message, code: error.code });
            }
            if (error instanceof ledger_service_1.InsufficientFundsError) {
                return res.status(409).json({ error: error.message, code: error.code });
            }
            if (error instanceof ledger_service_1.LedgerIntegrityError) {
                return res.status(500).json({ error: 'Ledger integrity error detected.', code: error.code });
            }
            return (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Payout processing failed due to database unavailability.');
        }
    });
    return router;
}
function createPaymentWebhookRouter(options = {}) {
    const router = express_1.default.Router();
    const dbClient = options.prismaClient || database_1.db;
    router.post('/webhooks/:provider', async (req, res) => {
        const rawProvider = (req.params.provider || '').trim().toUpperCase();
        const provider = rawProvider === 'MTN' || rawProvider === 'MTN_MOMO'
            ? 'MTN_MOMO'
            : rawProvider === 'AIRTEL' || rawProvider === 'AIRTEL_MONEY'
                ? 'AIRTEL_MONEY'
                : null;
        if (!provider) {
            return res.status(404).json({ error: 'Unknown payment provider.' });
        }
        const rawBody = Buffer.isBuffer(req.body)
            ? req.body
            : req.rawBody || JSON.stringify(req.body || {});
        let parsedBody = req.body;
        if (Buffer.isBuffer(req.body)) {
            try {
                parsedBody = JSON.parse(req.body.toString('utf8'));
            }
            catch {
                return res.status(400).json({ error: 'Malformed JSON webhook body.', code: 'INVALID_PAYLOAD' });
            }
        }
        // Legacy PaymentService path only when explicitly injected by legacy callers/tests
        if (options.paymentService && !options.orchestrator) {
            const result = await options.paymentService.handleWebhook(provider, req.headers, rawBody, parsedBody, dbClient);
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
        const orchestrator = options.orchestrator || payments_1.defaultPaymentOrchestrator;
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
        }
        catch (error) {
            if (error instanceof payments_1.OrchestratorError || error instanceof ledger_service_1.LedgerValidationError) {
                return res.status(error.statusCode).json({ error: error.message, code: error.code });
            }
            return res.status(500).json({ error: 'Webhook processing failed' });
        }
    });
    return router;
}
function createWalletRouter(options = {}) {
    const router = express_1.default.Router();
    const dbClient = options.prismaClient || database_1.db;
    const ledger = options.ledgerService || new ledger_service_1.WalletLedgerService(new ledger_service_1.PrismaWalletLedgerRepository(dbClient));
    const authMiddleware = options.authenticateMiddleware || auth_1.authenticate;
    router.get('/balance', authMiddleware, async (req, res) => {
        try {
            const userId = req.user.id;
            const channel = await dbClient.channel.findFirst({ where: { userId }, select: { id: true } });
            if (!channel)
                return res.status(404).json({ error: 'Channel not found' });
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
                currency: ledger_service_1.LEDGER_CURRENCY,
            });
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Wallet balance is temporarily unavailable because the database is unavailable.');
        }
    });
    router.get('/ledger', authMiddleware, async (req, res) => {
        try {
            const userId = req.user.id;
            const channel = await dbClient.channel.findFirst({ where: { userId }, select: { id: true } });
            if (!channel)
                return res.status(404).json({ error: 'Channel not found' });
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 20;
            const ledgerPage = await ledger.getChannelLedger(channel.id, { page, limit });
            const serializedLedger = ledgerPage.items.map((tx) => ({
                ...tx,
                amountCents: tx.amountCents.toString(),
                balanceAfterCents: tx.balanceAfterCents.toString(),
            }));
            res.status(200).json(serializedLedger);
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Wallet history is temporarily unavailable because the database is unavailable.');
        }
    });
    router.use('/request-payout', createPayoutRouter(authMiddleware, {
        orchestrator: options.orchestrator,
        prismaClient: dbClient,
    }));
    router.use(createPaymentWebhookRouter({
        orchestrator: options.orchestrator,
        prismaClient: dbClient,
    }));
    return router;
}
walletRouter.use('/', createWalletRouter());
