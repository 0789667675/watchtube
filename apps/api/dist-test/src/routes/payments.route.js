"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPaymentsRouter = createPaymentsRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ledger_service_1 = require("../services/finance/ledger.service");
const payments_1 = require("../services/payments");
const initiatePaymentSchema = zod_1.z.object({
    provider: zod_1.z.enum(['MTN_MOMO', 'AIRTEL_MONEY']),
    amountCents: zod_1.z.union([zod_1.z.number().int().positive(), zod_1.z.string().regex(/^\d+$/)]),
    currency: zod_1.z.literal(ledger_service_1.LEDGER_CURRENCY).optional(),
    phoneNumber: zod_1.z.string().trim().min(9).max(20),
    description: zod_1.z.string().trim().min(2).max(160),
    channelId: zod_1.z.string().uuid().optional(),
    idempotencyKey: zod_1.z.string().trim().min(4).max(128).optional(),
}).strict();
const refundRequestSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(3).max(250),
    idempotencyKey: zod_1.z.string().trim().min(4).max(128).optional(),
}).strict();
function normalizeWebhookProviderParam(raw) {
    const upper = (raw || '').trim().toUpperCase();
    if (upper === 'MTN' || upper === 'MTN_MOMO')
        return 'MTN_MOMO';
    if (upper === 'AIRTEL' || upper === 'AIRTEL_MONEY')
        return 'AIRTEL_MONEY';
    return null;
}
function createPaymentsRouter(options = {}) {
    const router = express_1.default.Router();
    const orchestrator = options.orchestrator || payments_1.defaultPaymentOrchestrator;
    const authMiddleware = options.authenticateMiddleware || auth_1.authenticate;
    const executeMiddleware = options.requireExecuteMiddleware || (0, rbac_1.requirePermission)('payments.execute');
    const configureMiddleware = options.requireConfigureMiddleware || (0, rbac_1.requirePermission)('payments.configure');
    // Owner-only provider integration status (never exposes secrets or credentials)
    router.get('/providers/status', authMiddleware, configureMiddleware, (_req, res) => {
        res.status(200).json({
            currency: ledger_service_1.LEDGER_CURRENCY,
            providers: orchestrator.getProvidersStatus(),
        });
    });
    // Initiate inbound Mobile Money payment (NEVER marks payment as PAID at initiation)
    router.post('/initiate', authMiddleware, async (req, res) => {
        const rawProvider = req.body?.provider;
        if ((rawProvider === 'MTN_MOMO' || rawProvider === 'AIRTEL_MONEY')
            && !orchestrator.getAdapter(rawProvider).isConfigured()) {
            return res.status(501).json({
                error: 'Mobile Money payments are unavailable until a verified payment-provider integration is configured.',
                code: 'PROVIDER_UNCONFIGURED',
            });
        }
        const parsed = initiatePaymentSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Invalid payment initiation request.',
                details: parsed.error.issues,
            });
        }
        const headerKey = typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key'].trim()
            : undefined;
        const idempotencyKey = headerKey || parsed.data.idempotencyKey;
        if (!idempotencyKey) {
            return res.status(400).json({
                error: 'idempotencyKey or Idempotency-Key header is required.',
                code: 'MISSING_IDEMPOTENCY_KEY',
            });
        }
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        try {
            const result = await orchestrator.initiatePayment({
                userId,
                channelId: parsed.data.channelId,
                provider: parsed.data.provider,
                amountCents: parsed.data.amountCents,
                currency: parsed.data.currency,
                phoneNumber: parsed.data.phoneNumber,
                idempotencyKey,
                description: parsed.data.description,
            });
            return res.status(202).json({
                success: true,
                idempotentReplay: result.idempotentReplay,
                transactionId: result.transaction.transactionId,
                status: result.transaction.status,
                provider: result.transaction.provider,
                providerReference: result.transaction.providerReference,
                amountCents: result.transaction.amountCents.toString(),
                currency: result.transaction.currency,
                maskedPhone: result.transaction.maskedPhone,
                reconciliationRequired: result.transaction.reconciliationRequired,
            });
        }
        catch (error) {
            if (error instanceof payments_1.OrchestratorError || error instanceof payments_1.PaymentProviderError || error instanceof ledger_service_1.LedgerValidationError) {
                return res.status(error.statusCode).json({ error: error.message, code: error.code });
            }
            console.error('[PaymentsRouter] Payment initiation failed:', error);
            return res.status(500).json({ error: 'Payment initiation failed.' });
        }
    });
    // Lookup transaction status (transaction owner or SUPER_ADMIN only)
    router.get('/:transactionId/status', authMiddleware, async (req, res) => {
        const user = req.user;
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const record = await orchestrator.getTransaction(req.params.transactionId);
        if (!record) {
            return res.status(404).json({ error: 'Payment transaction not found.' });
        }
        if (record.userId !== user.id && user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Forbidden. You do not have access to this transaction.' });
        }
        return res.status(200).json({
            transactionId: record.transactionId,
            kind: record.kind,
            provider: record.provider,
            providerReference: record.providerReference,
            status: record.status,
            amountCents: record.amountCents.toString(),
            currency: record.currency,
            maskedPhone: record.maskedPhone,
            reconciliationRequired: record.reconciliationRequired,
            failureReason: record.failureReason ?? null,
            createdAt: record.createdAt.toISOString(),
            updatedAt: record.updatedAt.toISOString(),
            finalizedAt: record.finalizedAt?.toISOString() ?? null,
        });
    });
    // Verified webhook callback endpoint
    router.post('/webhooks/:provider', async (req, res) => {
        const provider = normalizeWebhookProviderParam(req.params.provider);
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
        try {
            const outcome = await orchestrator.processWebhook({
                provider,
                headers: req.headers,
                rawBody,
                parsedBody,
            });
            return res.status(200).json({
                received: true,
                idempotent: outcome.idempotent,
                status: outcome.status,
                transactionId: outcome.transactionId,
            });
        }
        catch (error) {
            if (error instanceof payments_1.OrchestratorError) {
                return res.status(error.statusCode).json({ error: error.message, code: error.code });
            }
            console.error('[PaymentsRouter] Webhook handling failed:', error);
            return res.status(500).json({ error: 'Webhook processing failed.' });
        }
    });
    // Owner-only active reconciliation poll for pending/timed-out transactions
    router.post('/:transactionId/reconcile', authMiddleware, executeMiddleware, async (req, res) => {
        const actor = req.user;
        if (!actor)
            return res.status(401).json({ error: 'Unauthorized' });
        try {
            const updated = await orchestrator.reconcileTransaction(req.params.transactionId, {
                id: actor.id,
                role: actor.role,
            });
            return res.status(200).json({
                transactionId: updated.transactionId,
                status: updated.status,
                reconciliationRequired: updated.reconciliationRequired,
                failureReason: updated.failureReason ?? null,
                finalizedAt: updated.finalizedAt?.toISOString() ?? null,
            });
        }
        catch (error) {
            if (error instanceof payments_1.OrchestratorError || error instanceof payments_1.PaymentProviderError) {
                return res.status(error.statusCode).json({ error: error.message, code: error.code });
            }
            console.error('[PaymentsRouter] Reconciliation failed:', error);
            return res.status(500).json({ error: 'Transaction reconciliation failed.' });
        }
    });
    // Owner-only refund or reversal initiation where supported by the provider adapter
    router.post('/:transactionId/refund', authMiddleware, executeMiddleware, async (req, res) => {
        const actor = req.user;
        if (!actor)
            return res.status(401).json({ error: 'Unauthorized' });
        const parsed = refundRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid refund request.', details: parsed.error.issues });
        }
        const headerKey = typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key'].trim()
            : undefined;
        const idempotencyKey = headerKey || parsed.data.idempotencyKey;
        if (!idempotencyKey) {
            return res.status(400).json({ error: 'idempotencyKey is required.', code: 'MISSING_IDEMPOTENCY_KEY' });
        }
        try {
            const updated = await orchestrator.initiateRefundOrReversal({
                transactionId: req.params.transactionId,
                reason: parsed.data.reason,
                idempotencyKey,
                actor: { id: actor.id, role: actor.role },
            });
            return res.status(200).json({
                transactionId: updated.transactionId,
                status: updated.status,
                amountCents: updated.amountCents.toString(),
                currency: updated.currency,
                finalizedAt: updated.finalizedAt?.toISOString() ?? null,
            });
        }
        catch (error) {
            if (error instanceof payments_1.OrchestratorError || error instanceof payments_1.PaymentProviderError || error instanceof ledger_service_1.LedgerValidationError) {
                return res.status(error.statusCode).json({ error: error.message, code: error.code });
            }
            console.error('[PaymentsRouter] Refund/reversal failed:', error);
            return res.status(500).json({ error: 'Refund/reversal failed.' });
        }
    });
    return router;
}
