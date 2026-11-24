"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MtnMoMoAdapter = void 0;
exports.normalizeRwandaPhoneNumber = normalizeRwandaPhoneNumber;
const node_crypto_1 = __importDefault(require("node:crypto"));
const ledger_service_1 = require("../finance/ledger.service");
function normalizeRwandaPhoneNumber(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('250') && digits.length === 12) {
        return digits;
    }
    if (digits.startsWith('0') && digits.length === 10) {
        return `250${digits.substring(1)}`;
    }
    if (digits.length === 9) {
        return `250${digits}`;
    }
    return digits;
}
/**
 * MTN Mobile Money adapter.
 *
 * IMPORTANT: Official MTN MoMo API endpoints, OAuth headers, request schemas, and
 * callback signatures are NOT hardcoded or invented here. Outside isolated test mode,
 * an authorized `MtnMoMoTransport` backed by verified MTN MoMo specifications and
 * sandbox/live credentials must be injected for `isConfigured()` to return true.
 */
class MtnMoMoAdapter {
    name = 'MTN_MOMO';
    config;
    hasExplicitCredentials;
    nodeEnv;
    constructor(config = {}) {
        this.nodeEnv = Object.prototype.hasOwnProperty.call(config, 'nodeEnv')
            ? config.nodeEnv
            : process.env.NODE_ENV;
        this.hasExplicitCredentials = Boolean(config.subscriptionKey && config.apiUser && config.apiKey);
        this.config = {
            apiUrl: config.apiUrl || process.env.MTN_MOMO_API_URL,
            subscriptionKey: config.subscriptionKey || process.env.MTN_MOMO_SUBSCRIPTION_KEY,
            apiUser: config.apiUser || process.env.MTN_MOMO_API_USER,
            apiKey: config.apiKey || process.env.MTN_MOMO_API_KEY,
            targetEnvironment: config.targetEnvironment || process.env.MTN_MOMO_TARGET_ENVIRONMENT,
            webhookSecret: config.webhookSecret || process.env.MTN_MOMO_WEBHOOK_SECRET,
            transport: config.transport,
            nodeEnv: this.nodeEnv,
        };
    }
    isConfigured() {
        const hasCreds = Boolean(this.config.subscriptionKey
            && this.config.apiUser
            && this.config.apiKey);
        if (!hasCreds)
            return false;
        // Outside explicit unit tests, require an injected verified HTTP transport and explicit API URL.
        if (this.config.transport) {
            return Boolean(this.config.apiUrl);
        }
        return this.nodeEnv === 'test' && this.hasExplicitCredentials;
    }
    async initiatePayment(req) {
        if (!this.isConfigured()) {
            return {
                success: false,
                providerReference: '',
                status: 'FAILED',
                message: 'MTN Mobile Money provider credentials or official sandbox transport are not configured.',
            };
        }
        const amount = (0, ledger_service_1.parsePositiveBigIntAmount)(req.amountCents, 'amountCents');
        const formattedPhone = normalizeRwandaPhoneNumber(req.phoneNumber);
        if (!formattedPhone.startsWith('25078') && !formattedPhone.startsWith('25079')) {
            return {
                success: false,
                providerReference: '',
                status: 'FAILED',
                message: 'Invalid MTN Rwanda MSISDN. Number must start with 078 or 079.',
            };
        }
        const referenceId = req.payerReference || node_crypto_1.default.randomUUID();
        if (this.config.transport) {
            const result = await this.config.transport.initiateCollection({
                referenceId,
                amountRwf: amount.toString(),
                currency: 'RWF',
                payerMsisdn: formattedPhone,
                description: req.description,
            });
            return {
                success: result.status === 'PENDING',
                providerReference: result.providerReference,
                status: result.status,
                message: result.failureReason,
                rawResponse: result.rawResponse,
            };
        }
        return {
            success: true,
            providerReference: referenceId,
            status: 'PENDING',
            message: `Test-mode MTN payment initiated for ${formattedPhone.slice(0, 5)}****${formattedPhone.slice(-3)} (${amount.toString()} RWF)`,
        };
    }
    async initiatePayout(req) {
        if (!this.isConfigured()) {
            return {
                success: false,
                providerReference: req.idempotencyKey,
                status: 'FAILED',
                failureReason: 'MTN Mobile Money disbursements or official sandbox transport are not configured.',
            };
        }
        const amount = (0, ledger_service_1.parsePositiveBigIntAmount)(req.amountCents, 'amountCents');
        const formattedPhone = normalizeRwandaPhoneNumber(req.phoneNumber);
        if (!formattedPhone.startsWith('25078') && !formattedPhone.startsWith('25079')) {
            return {
                success: false,
                providerReference: req.idempotencyKey,
                status: 'FAILED',
                failureReason: 'Invalid MTN Rwanda MSISDN. Number must start with 078 or 079.',
            };
        }
        if (this.config.transport) {
            const result = await this.config.transport.initiateDisbursement({
                referenceId: req.idempotencyKey,
                amountRwf: amount.toString(),
                currency: 'RWF',
                recipientMsisdn: formattedPhone,
                narrative: req.narrative,
            });
            return {
                success: result.status === 'PENDING',
                providerReference: result.providerReference,
                status: result.status,
                failureReason: result.failureReason,
                rawResponse: result.rawResponse,
            };
        }
        return {
            success: true,
            providerReference: req.idempotencyKey,
            status: 'PENDING',
            rawResponse: {
                mode: 'TEST_ONLY_IN_MEMORY',
                amountRwf: amount.toString(),
                currency: 'RWF',
                targetEnvironment: this.config.targetEnvironment || 'test',
            },
        };
    }
    async checkStatus(providerReference) {
        if (!this.config.transport?.lookupStatus) {
            throw new Error('MTN Mobile Money status lookup transport is not configured.');
        }
        return this.config.transport.lookupStatus(providerReference);
    }
    async verifyWebhookSignature(headers, rawBody) {
        if (this.config.transport?.verifyWebhook) {
            return this.config.transport.verifyWebhook(headers, rawBody);
        }
        if (this.nodeEnv !== 'test') {
            return {
                isValid: false,
                reason: 'Official MTN Mobile Money webhook verification transport is not configured',
            };
        }
        const secret = this.config.webhookSecret;
        if (!secret) {
            return { isValid: false, reason: 'Webhook secret is not configured' };
        }
        const signature = headers['x-callback-signature'] || headers['x-signature'];
        const signatureStr = Array.isArray(signature) ? signature[0] : signature;
        if (!signatureStr) {
            return { isValid: false, reason: 'Missing signature header' };
        }
        const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
        const expectedHmac = node_crypto_1.default.createHmac('sha256', secret).update(bodyStr).digest('hex');
        if (signatureStr.length !== expectedHmac.length) {
            return { isValid: false, reason: 'Invalid signature length' };
        }
        const isMatch = node_crypto_1.default.timingSafeEqual(Buffer.from(signatureStr, 'utf8'), Buffer.from(expectedHmac, 'utf8'));
        return isMatch ? { isValid: true } : { isValid: false, reason: 'Signature mismatch' };
    }
    parseWebhook(body, _headers) {
        if (!body || typeof body !== 'object')
            return null;
        const data = body;
        const financialTransactionId = String(data.financialTransactionId || data.referenceId || '');
        const externalId = String(data.externalId || data.referenceId || '');
        const statusRaw = String(data.status || '').toUpperCase();
        if (!externalId && !financialTransactionId)
            return null;
        let status = 'PENDING';
        if (statusRaw === 'SUCCESSFUL' || statusRaw === 'PAID' || statusRaw === 'SUCCEEDED') {
            status = 'PAID';
        }
        else if (statusRaw === 'FAILED' || statusRaw === 'REJECTED' || statusRaw === 'EXPIRED') {
            status = 'FAILED';
        }
        let amountCents;
        if (data.amountCents !== undefined) {
            try {
                amountCents = (0, ledger_service_1.parsePositiveBigIntAmount)(data.amountCents, 'amountCents');
            }
            catch {
                return null;
            }
        }
        else if (typeof data.amount === 'string' || typeof data.amount === 'number') {
            const numeric = String(data.amount).trim();
            if (/^\d+$/.test(numeric)) {
                amountCents = BigInt(numeric);
            }
            else if (/^\d+\.\d{1,2}$/.test(numeric)) {
                const [whole, frac = ''] = numeric.split('.');
                amountCents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
            }
            if (amountCents !== undefined && amountCents <= 0n) {
                return null;
            }
        }
        return {
            provider: 'MTN_MOMO',
            eventType: data.eventType === 'PAYMENT' ? 'PAYMENT' : 'PAYOUT',
            providerReference: financialTransactionId || externalId,
            externalReference: externalId,
            status,
            amountCents,
            currency: typeof data.currency === 'string' ? data.currency : 'RWF',
            failureReason: typeof data.reason === 'string' ? data.reason : undefined,
            rawPayload: body,
        };
    }
}
exports.MtnMoMoAdapter = MtnMoMoAdapter;
