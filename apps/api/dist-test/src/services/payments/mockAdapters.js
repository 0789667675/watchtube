"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockAirtelMoneySandboxAdapter = exports.MockMtnMoMoSandboxAdapter = exports.BaseMockMobileMoneyAdapter = exports.UnconfiguredMobileMoneyAdapter = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const mtnMoMoAdapter_1 = require("./mtnMoMoAdapter");
const msisdn_1 = require("./msisdn");
const ledger_service_1 = require("../finance/ledger.service");
/**
 * Safe unconfigured adapter used in runtime when official MTN MoMo or Airtel Money
 * sandbox/live specifications and credentials are absent. Always fails closed (501).
 */
class UnconfiguredMobileMoneyAdapter {
    providerId;
    displayName;
    mode = 'UNCONFIGURED';
    capabilities = {
        collections: false,
        disbursements: false,
        statusLookup: false,
        webhooks: false,
        refunds: false,
        reversals: false,
    };
    constructor(providerId, displayName) {
        this.providerId = providerId;
        this.displayName = displayName;
    }
    isConfigured() {
        return false;
    }
    async initiatePayment() {
        throw new Error(`${this.displayName} integration is not configured.`);
    }
    async initiatePayout() {
        throw new Error(`${this.displayName} disbursements are not configured.`);
    }
    async lookupStatus() {
        throw new Error(`${this.displayName} status lookup is not configured.`);
    }
    async verifyAndParseWebhook() {
        return {
            valid: false,
            errorCode: 'UNCONFIGURED_VERIFIER',
            reason: `${this.displayName} webhook verification is not configured.`,
        };
    }
    async initiateRefundOrReversal() {
        throw new Error(`${this.displayName} refund/reversal integration is not configured.`);
    }
}
exports.UnconfiguredMobileMoneyAdapter = UnconfiguredMobileMoneyAdapter;
/**
 * Base test-only sandbox mock adapter for MTN MoMo and Airtel Money orchestration testing.
 * Explicitly forbidden in NODE_ENV === 'production'.
 * Uses test-only header 'x-watchtube-mock-signature' (never claims to be real telco headers).
 */
class BaseMockMobileMoneyAdapter {
    mode = 'MOCK_SANDBOX';
    capabilities;
    webhookSecret;
    idempotencyMap = new Map();
    txByProviderRef = new Map();
    simulateTimeoutOnKey;
    simulateOutageOnKey;
    simulateSyncFailureOnKey;
    constructor(options = {}) {
        const env = Object.prototype.hasOwnProperty.call(options, 'nodeEnv')
            ? options.nodeEnv
            : process.env.NODE_ENV;
        if (env === 'production') {
            throw new Error('[SECURITY] Mock Mobile Money adapters cannot be instantiated in production.');
        }
        this.webhookSecret = options.webhookSecret || 'watchtube-test-mock-webhook-secret-only';
        this.capabilities = {
            collections: true,
            disbursements: true,
            statusLookup: true,
            webhooks: true,
            refunds: options.supportsRefunds ?? true,
            reversals: options.supportsReversals ?? true,
        };
        this.simulateTimeoutOnKey = options.simulateTimeoutOnKey ?? new Set();
        this.simulateOutageOnKey = options.simulateOutageOnKey ?? new Set();
        this.simulateSyncFailureOnKey = options.simulateSyncFailureOnKey ?? new Set();
    }
    isConfigured() {
        return true;
    }
    /** Test helper to control async provider state transitions (for polling/status tests). */
    setSimulatedStatus(providerReference, status, failureReason) {
        const existing = this.txByProviderRef.get(providerReference);
        if (existing) {
            existing.status = status;
            existing.failureReason = failureReason;
        }
    }
    /** Test helper to sign a mock webhook payload with the test-only mock signature scheme. */
    signMockWebhookPayload(payload) {
        const rawBody = JSON.stringify(payload);
        const sig = node_crypto_1.default.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
        return {
            rawBody,
            headers: { 'x-watchtube-mock-signature': sig },
        };
    }
    validatePhonePrefix(phoneNumber) {
        const normalized = (0, mtnMoMoAdapter_1.normalizeRwandaPhoneNumber)(phoneNumber);
        if (normalized.length !== 12 || !normalized.startsWith('250')) {
            return `Invalid Rwanda MSISDN format: ${(0, msisdn_1.maskMsisdn)(normalized)}`;
        }
        const prefix = normalized.slice(3, 5);
        if (!this.allowedPrefixes.includes(prefix)) {
            return `MSISDN prefix 0${prefix} is not valid for ${this.displayName}.`;
        }
        return null;
    }
    async maybeSimulateFault(idempotencyKey) {
        if (this.simulateTimeoutOnKey.has(idempotencyKey)) {
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, 60_000);
                if (typeof timer.unref === 'function')
                    timer.unref();
            });
        }
        if (this.simulateOutageOnKey.has(idempotencyKey)) {
            const err = new Error(`${this.displayName} upstream service temporarily unavailable (503).`);
            err.code = 'PROVIDER_UNAVAILABLE';
            err.retryable = true;
            throw err;
        }
    }
    async initiatePayment(req) {
        (0, ledger_service_1.parsePositiveBigIntAmount)(req.amountCents, 'amountCents');
        await this.maybeSimulateFault(req.idempotencyKey);
        const cached = this.idempotencyMap.get(`PAY:${req.idempotencyKey}`);
        if (cached)
            return { ...cached };
        const phoneErr = this.validatePhonePrefix(req.phoneNumber);
        if (phoneErr || this.simulateSyncFailureOnKey.has(req.idempotencyKey)) {
            const failed = {
                accepted: false,
                status: 'FAILED',
                providerReference: `${this.providerId.toLowerCase()}-fail-${node_crypto_1.default.randomUUID().slice(0, 8)}`,
                failureCode: phoneErr ? 'INVALID_MSISDN' : 'PROVIDER_REJECTED',
                failureReason: phoneErr || `${this.displayName} rejected simulated payment request.`,
            };
            this.idempotencyMap.set(`PAY:${req.idempotencyKey}`, failed);
            return failed;
        }
        const providerReference = `${this.providerId.toLowerCase()}-pay-${node_crypto_1.default.randomUUID()}`;
        const response = {
            accepted: true,
            status: 'PENDING', // Initiation NEVER equals PAID
            providerReference,
            providerTransactionId: `ext-${providerReference}`,
        };
        this.txByProviderRef.set(providerReference, {
            providerReference,
            internalReference: req.internalReference,
            kind: 'PAYMENT',
            amountCents: req.amountCents,
            currency: req.currency,
            status: 'PENDING',
        });
        this.idempotencyMap.set(`PAY:${req.idempotencyKey}`, response);
        return response;
    }
    async initiatePayout(req) {
        (0, ledger_service_1.parsePositiveBigIntAmount)(req.amountCents, 'amountCents');
        await this.maybeSimulateFault(req.idempotencyKey);
        const cached = this.idempotencyMap.get(`PAYOUT:${req.idempotencyKey}`);
        if (cached)
            return { ...cached };
        const phoneErr = this.validatePhonePrefix(req.phoneNumber);
        if (phoneErr || this.simulateSyncFailureOnKey.has(req.idempotencyKey)) {
            const failed = {
                accepted: false,
                status: 'FAILED',
                providerReference: `${this.providerId.toLowerCase()}-fail-${node_crypto_1.default.randomUUID().slice(0, 8)}`,
                failureCode: phoneErr ? 'INVALID_MSISDN' : 'DISBURSEMENT_REJECTED',
                failureReason: phoneErr || `${this.displayName} rejected simulated payout transfer.`,
            };
            this.idempotencyMap.set(`PAYOUT:${req.idempotencyKey}`, failed);
            return failed;
        }
        const providerReference = `${this.providerId.toLowerCase()}-payout-${node_crypto_1.default.randomUUID()}`;
        const response = {
            accepted: true,
            status: 'PENDING', // Initiation NEVER equals PAID
            providerReference,
            providerTransactionId: `ext-${providerReference}`,
        };
        this.txByProviderRef.set(providerReference, {
            providerReference,
            internalReference: req.internalReference,
            kind: 'PAYOUT',
            amountCents: req.amountCents,
            currency: req.currency,
            status: 'PENDING',
        });
        this.idempotencyMap.set(`PAYOUT:${req.idempotencyKey}`, response);
        return response;
    }
    async lookupStatus(providerReference) {
        const state = this.txByProviderRef.get(providerReference);
        if (!state) {
            throw new Error(`Transaction reference "${providerReference}" not found on ${this.displayName} mock.`);
        }
        return {
            providerReference: state.providerReference,
            providerTransactionId: `ext-${state.providerReference}`,
            status: state.status,
            amountCents: state.amountCents,
            currency: state.currency,
            failureReason: state.failureReason,
        };
    }
    async verifyAndParseWebhook(headers, rawBody, parsedBody) {
        const sigRaw = headers['x-watchtube-mock-signature'];
        const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
        if (!signature) {
            return {
                valid: false,
                errorCode: 'MISSING_SIGNATURE',
                reason: 'Missing x-watchtube-mock-signature header.',
            };
        }
        const bodyText = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
        const expected = node_crypto_1.default.createHmac('sha256', this.webhookSecret).update(bodyText).digest('hex');
        if (signature.length !== expected.length
            || !node_crypto_1.default.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'))) {
            return {
                valid: false,
                errorCode: 'INVALID_SIGNATURE',
                reason: 'Mock webhook HMAC-SHA256 signature mismatch.',
            };
        }
        if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
            return {
                valid: false,
                errorCode: 'INVALID_PAYLOAD',
                reason: 'Webhook body must be a JSON object.',
            };
        }
        const data = parsedBody;
        const providerReference = typeof data.providerReference === 'string' ? data.providerReference.trim() : '';
        const internalReference = typeof data.internalReference === 'string' ? data.internalReference.trim() : undefined;
        const webhookEventId = typeof data.webhookEventId === 'string' && data.webhookEventId.trim()
            ? data.webhookEventId.trim()
            : `${providerReference}:${String(data.status || '')}`;
        const rawStatus = String(data.status || '').toUpperCase();
        if (!providerReference) {
            return {
                valid: false,
                errorCode: 'INVALID_PAYLOAD',
                reason: 'providerReference is required.',
            };
        }
        let status;
        if (rawStatus === 'PAID' || rawStatus === 'SUCCESSFUL' || rawStatus === 'SUCCEEDED') {
            status = 'PAID';
        }
        else if (rawStatus === 'FAILED' || rawStatus === 'REJECTED') {
            status = 'FAILED';
        }
        else if (rawStatus === 'REVERSED') {
            status = 'REVERSED';
        }
        else if (rawStatus === 'REFUNDED') {
            status = 'REFUNDED';
        }
        else if (rawStatus === 'PENDING') {
            status = 'PENDING';
        }
        else {
            return {
                valid: false,
                errorCode: 'INVALID_PAYLOAD',
                reason: `Unsupported webhook status "${rawStatus}".`,
            };
        }
        let amountCents;
        if (data.amountCents !== undefined) {
            try {
                amountCents = (0, ledger_service_1.parsePositiveBigIntAmount)(data.amountCents, 'amountCents');
            }
            catch {
                return {
                    valid: false,
                    errorCode: 'INVALID_PAYLOAD',
                    reason: 'Invalid amountCents in webhook payload.',
                };
            }
        }
        const eventType = data.eventType === 'PAYMENT' || data.eventType === 'PAYOUT' || data.eventType === 'REFUND' || data.eventType === 'REVERSAL'
            ? data.eventType
            : 'PAYOUT';
        return {
            valid: true,
            event: {
                webhookEventId,
                provider: this.providerId,
                eventType,
                providerReference,
                internalReference,
                status,
                amountCents,
                currency: typeof data.currency === 'string' ? data.currency : 'RWF',
                failureReason: typeof data.reason === 'string' ? data.reason : undefined,
            },
        };
    }
    async initiateRefundOrReversal(req) {
        if (!this.capabilities.refunds && !this.capabilities.reversals) {
            return {
                accepted: false,
                status: 'FAILED',
                providerReference: '',
                failureReason: `${this.displayName} does not support refunds or reversals in this configuration.`,
            };
        }
        const original = this.txByProviderRef.get(req.originalProviderReference);
        if (!original) {
            return {
                accepted: false,
                status: 'FAILED',
                providerReference: '',
                failureReason: 'Original provider transaction reference not found.',
            };
        }
        if (original.status !== 'PAID') {
            return {
                accepted: false,
                status: 'FAILED',
                providerReference: '',
                failureReason: `Cannot refund/reverse transaction in state ${original.status}.`,
            };
        }
        if (req.amountCents > original.amountCents) {
            return {
                accepted: false,
                status: 'FAILED',
                providerReference: '',
                failureReason: 'Refund amount cannot exceed original transaction amount.',
            };
        }
        const refundRef = `${this.providerId.toLowerCase()}-refund-${node_crypto_1.default.randomUUID()}`;
        original.status = original.kind === 'PAYMENT' ? 'REFUNDED' : 'REVERSED';
        return {
            accepted: true,
            status: original.kind === 'PAYMENT' ? 'REFUNDED' : 'REVERSED',
            providerReference: refundRef,
        };
    }
}
exports.BaseMockMobileMoneyAdapter = BaseMockMobileMoneyAdapter;
class MockMtnMoMoSandboxAdapter extends BaseMockMobileMoneyAdapter {
    providerId = 'MTN_MOMO';
    displayName = 'MTN Mobile Money (Mock Sandbox)';
    allowedPrefixes = ['78', '79'];
}
exports.MockMtnMoMoSandboxAdapter = MockMtnMoMoSandboxAdapter;
class MockAirtelMoneySandboxAdapter extends BaseMockMobileMoneyAdapter {
    providerId = 'AIRTEL_MONEY';
    displayName = 'Airtel Money (Mock Sandbox)';
    allowedPrefixes = ['72', '73'];
}
exports.MockAirtelMoneySandboxAdapter = MockAirtelMoneySandboxAdapter;
