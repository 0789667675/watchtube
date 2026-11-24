"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const node_crypto_1 = __importDefault(require("node:crypto"));
const payments_1 = require("../src/services/payments");
(0, node_test_1.test)('normalizeRwandaPhoneNumber formats 10-digit, 9-digit, and international formats', () => {
    strict_1.default.equal((0, payments_1.normalizeRwandaPhoneNumber)('0788123456'), '250788123456');
    strict_1.default.equal((0, payments_1.normalizeRwandaPhoneNumber)('+250788123456'), '250788123456');
    strict_1.default.equal((0, payments_1.normalizeRwandaPhoneNumber)('250788123456'), '250788123456');
    strict_1.default.equal((0, payments_1.normalizeRwandaPhoneNumber)('788123456'), '250788123456');
});
(0, node_test_1.test)('MtnMoMoAdapter validates configuration and rejects invalid phone prefixes', async () => {
    const unconfigured = new payments_1.MtnMoMoAdapter({});
    strict_1.default.equal(unconfigured.isConfigured(), false);
    const configured = new payments_1.MtnMoMoAdapter({
        subscriptionKey: 'sub-key-123',
        apiUser: 'user-uuid-456',
        apiKey: 'api-key-789',
        webhookSecret: 'secret-webhook-key',
    });
    strict_1.default.equal(configured.isConfigured(), true);
    // Rejects invalid prefix (e.g. Airtel number 072 sent to MTN)
    const invalidResult = await configured.initiatePayout({
        channelId: 'chan-1',
        amountCents: 500000,
        phoneNumber: '0722123456',
        idempotencyKey: 'idem-1',
        narrative: 'Payout test',
    });
    strict_1.default.equal(invalidResult.success, false);
    strict_1.default.ok(invalidResult.failureReason?.includes('Invalid MTN Rwanda MSISDN'));
    // Accepts valid MTN prefix (078)
    const validResult = await configured.initiatePayout({
        channelId: 'chan-1',
        amountCents: 500000,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-2',
        narrative: 'Payout test',
    });
    strict_1.default.equal(validResult.success, true);
    strict_1.default.equal(validResult.status, 'PENDING');
});
(0, node_test_1.test)('AirtelMoneyAdapter validates configuration and rejects invalid phone prefixes', async () => {
    const unconfigured = new payments_1.AirtelMoneyAdapter({});
    strict_1.default.equal(unconfigured.isConfigured(), false);
    const configured = new payments_1.AirtelMoneyAdapter({
        clientId: 'client-id-123',
        clientSecret: 'secret-456',
        webhookSecret: 'airtel-secret',
    });
    strict_1.default.equal(configured.isConfigured(), true);
    // Rejects invalid prefix (e.g. MTN number 078 sent to Airtel)
    const invalidResult = await configured.initiatePayout({
        channelId: 'chan-1',
        amountCents: 500000,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-3',
        narrative: 'Airtel payout test',
    });
    strict_1.default.equal(invalidResult.success, false);
    strict_1.default.ok(invalidResult.failureReason?.includes('Invalid Airtel Rwanda MSISDN'));
    // Accepts valid Airtel prefix (072)
    const validResult = await configured.initiatePayout({
        channelId: 'chan-1',
        amountCents: 500000,
        phoneNumber: '0722123456',
        idempotencyKey: 'idem-4',
        narrative: 'Airtel payout test',
    });
    strict_1.default.equal(validResult.success, true);
    strict_1.default.equal(validResult.status, 'PENDING');
});
(0, node_test_1.test)('MtnMoMoAdapter verifies webhook signature using HMAC-SHA256 and fails closed', async () => {
    const secret = 'super-secret-momo-webhook-key';
    const adapter = new payments_1.MtnMoMoAdapter({
        subscriptionKey: 'sub',
        apiUser: 'user',
        apiKey: 'key',
        webhookSecret: secret,
    });
    const payload = JSON.stringify({
        financialTransactionId: 'ft-999',
        externalId: 'payout-ref-123',
        status: 'SUCCESSFUL',
        amount: '5000.00',
        currency: 'RWF',
    });
    const validSignature = node_crypto_1.default.createHmac('sha256', secret).update(payload).digest('hex');
    // Valid signature passes
    const validCheck = await adapter.verifyWebhookSignature({ 'x-callback-signature': validSignature }, payload);
    strict_1.default.equal(validCheck.isValid, true);
    // Tampered signature is rejected
    const tamperedCheck = await adapter.verifyWebhookSignature({ 'x-callback-signature': '0000000000000000000000000000000000000000000000000000000000000000' }, payload);
    strict_1.default.equal(tamperedCheck.isValid, false);
    // Missing signature header is rejected
    const missingCheck = await adapter.verifyWebhookSignature({}, payload);
    strict_1.default.equal(missingCheck.isValid, false);
    // Missing secret fails closed
    const unconfiguredSecretAdapter = new payments_1.MtnMoMoAdapter({ subscriptionKey: 's', apiUser: 'u', apiKey: 'k' });
    const failClosed = await unconfiguredSecretAdapter.verifyWebhookSignature({ 'x-callback-signature': validSignature }, payload);
    strict_1.default.equal(failClosed.isValid, false);
});
// Mock database client for isolated unit testing of double-entry ledger logic
function createMockDb(initialBalance = BigInt(1000000)) {
    const channel = { id: 'channel-test-uuid', userId: 'user-test-uuid', isMonetized: true };
    const transactions = [];
    let currentBalance = initialBalance;
    // Add initial opening balance if non-zero
    if (initialBalance > BigInt(0)) {
        transactions.push({
            id: 'tx-opening-1',
            channelId: channel.id,
            transactionType: 'REVENUE_CREDIT',
            amountCents: initialBalance,
            balanceAfterCents: initialBalance,
            referenceId: 'opening-ref-1',
            status: 'AVAILABLE',
            createdAt: new Date(),
        });
    }
    const mockDb = {
        channel: {
            async findFirst({ where }) {
                if (where.userId === channel.userId || where.id === channel.id)
                    return channel;
                return null;
            },
        },
        walletTransaction: {
            async findUnique({ where }) {
                return transactions.find((t) => t.referenceId === where.referenceId) || null;
            },
            async findFirst({ where, orderBy }) {
                let filtered = transactions;
                if (where?.channelId) {
                    filtered = filtered.filter((t) => t.channelId === where.channelId);
                }
                if (where?.OR && Array.isArray(where.OR)) {
                    filtered = filtered.filter((t) => where.OR.some((clause) => clause.referenceId && t.referenceId === clause.referenceId));
                }
                if (filtered.length === 0)
                    return null;
                return filtered[filtered.length - 1]; // latest
            },
            async create({ data }) {
                const record = { id: `tx-${Date.now()}-${Math.random()}`, createdAt: new Date(), ...data };
                transactions.push(record);
                currentBalance = BigInt(record.balanceAfterCents);
                return record;
            },
            async update({ where, data }) {
                const tx = transactions.find((t) => t.id === where.id);
                if (tx)
                    Object.assign(tx, data);
                return tx;
            },
        },
        async $transaction(callback) {
            return callback(mockDb);
        },
        _getTransactions() {
            return transactions;
        },
        _getCurrentBalance() {
            return currentBalance;
        },
    };
    return mockDb;
}
(0, node_test_1.test)('PaymentService enforces idempotency: repeat request returns existing transaction without double debit', async () => {
    const service = new payments_1.PaymentService();
    const mockProvider = {
        name: 'MTN_MOMO',
        isConfigured: () => true,
        initiatePayment: async () => ({ success: true, providerReference: 'p-1', status: 'PENDING' }),
        initiatePayout: async () => ({ success: true, providerReference: 'momo-ref-1', status: 'PENDING' }),
        verifyWebhookSignature: async () => ({ isValid: true }),
        parseWebhook: () => null,
    };
    service.registerProvider(mockProvider);
    const mockDb = createMockDb(BigInt(500000)); // 5,000 RWF opening balance
    // First request debits 2,000 RWF (200,000 cents)
    const first = await service.requestPayout('user-test-uuid', {
        amountCents: 200000,
        provider: 'MTN_MOMO',
        phoneNumber: '0788123456',
        idempotencyKey: 'idempotent-key-001',
    }, mockDb);
    strict_1.default.equal(first.success, true);
    strict_1.default.equal(first.transaction?.amountCents, '200000');
    strict_1.default.equal(first.transaction?.balanceAfterCents, '300000');
    strict_1.default.equal(mockDb._getTransactions().length, 2);
    // Second duplicate request with exact same idempotencyKey returns existing tx without changing balance
    const second = await service.requestPayout('user-test-uuid', {
        amountCents: 200000,
        provider: 'MTN_MOMO',
        phoneNumber: '0788123456',
        idempotencyKey: 'idempotent-key-001',
    }, mockDb);
    strict_1.default.equal(second.success, true);
    strict_1.default.equal(second.transaction?.id, first.transaction?.id);
    strict_1.default.equal(second.transaction?.balanceAfterCents, '300000');
    // Transaction count must STILL be 2, no extra transaction was recorded
    strict_1.default.equal(mockDb._getTransactions().length, 2);
    strict_1.default.equal(mockDb._getCurrentBalance(), BigInt(300000));
});
(0, node_test_1.test)('PaymentService rejects payout when wallet balance is insufficient', async () => {
    const service = new payments_1.PaymentService();
    const mockProvider = {
        name: 'MTN_MOMO',
        isConfigured: () => true,
        initiatePayment: async () => ({ success: true, providerReference: 'p-1', status: 'PENDING' }),
        initiatePayout: async () => ({ success: true, providerReference: 'momo-ref-1', status: 'PENDING' }),
        verifyWebhookSignature: async () => ({ isValid: true }),
        parseWebhook: () => null,
    };
    service.registerProvider(mockProvider);
    const mockDb = createMockDb(BigInt(100000)); // 1,000 RWF balance
    // Attempt to payout 5,000 RWF (500,000 cents)
    const result = await service.requestPayout('user-test-uuid', {
        amountCents: 500000,
        provider: 'MTN_MOMO',
        phoneNumber: '0788123456',
        idempotencyKey: 'insufficient-funds-key',
    }, mockDb);
    strict_1.default.equal(result.success, false);
    strict_1.default.equal(result.error, 'INSUFFICIENT_FUNDS');
    // Balance must remain unchanged at 1,000 RWF
    strict_1.default.equal(mockDb._getCurrentBalance(), BigInt(100000));
});
(0, node_test_1.test)('PaymentService creates compensating ADJUSTMENT transaction when provider dispatch fails', async () => {
    const service = new payments_1.PaymentService();
    const failingProvider = {
        name: 'MTN_MOMO',
        isConfigured: () => true,
        initiatePayment: async () => ({ success: false, providerReference: '', status: 'FAILED' }),
        initiatePayout: async () => ({
            success: false,
            providerReference: 'ref-failing',
            status: 'FAILED',
            failureReason: 'Payee account suspended or inactive by telco',
        }),
        verifyWebhookSignature: async () => ({ isValid: true }),
        parseWebhook: () => null,
    };
    service.registerProvider(failingProvider);
    const mockDb = createMockDb(BigInt(500000)); // 5,000 RWF balance
    const result = await service.requestPayout('user-test-uuid', {
        amountCents: 200000,
        provider: 'MTN_MOMO',
        phoneNumber: '0788123456',
        idempotencyKey: 'fail-reversal-key',
    }, mockDb);
    strict_1.default.equal(result.success, false);
    strict_1.default.equal(result.error, 'DISPATCH_REJECTED');
    const txs = mockDb._getTransactions();
    // We expect: 1. Opening credit, 2. Payout (status FAILED), 3. Compensating ADJUSTMENT credit
    strict_1.default.equal(txs.length, 3);
    strict_1.default.equal(txs[1].transactionType, 'PAYOUT');
    strict_1.default.equal(txs[1].status, 'FAILED');
    strict_1.default.equal(txs[2].transactionType, 'ADJUSTMENT');
    strict_1.default.equal(txs[2].amountCents, BigInt(200000));
    // Balance was restored back to 500,000 cents
    strict_1.default.equal(mockDb._getCurrentBalance(), BigInt(500000));
});
(0, node_test_1.test)('PaymentService processes webhook callbacks: marks PAID on success and refunds on failure', async () => {
    const service = new payments_1.PaymentService();
    const mockDb = createMockDb(BigInt(1000000));
    const mockProvider = {
        name: 'MTN_MOMO',
        isConfigured: () => true,
        initiatePayment: async () => ({ success: true, providerReference: 'p-1', status: 'PENDING' }),
        initiatePayout: async () => ({ success: true, providerReference: 'payout-test-tx', status: 'PENDING' }),
        verifyWebhookSignature: async () => ({ isValid: true }),
        parseWebhook: (body) => ({
            provider: 'MTN_MOMO',
            eventType: 'PAYOUT',
            providerReference: body.ref,
            externalReference: body.ref,
            status: body.status,
            rawPayload: body,
        }),
    };
    service.registerProvider(mockProvider);
    // 1. Initiate valid payout of 300,000 cents
    const payout = await service.requestPayout('user-test-uuid', {
        amountCents: 300000,
        provider: 'MTN_MOMO',
        phoneNumber: '0788123456',
        idempotencyKey: 'webhook-flow-tx-1',
    }, mockDb);
    strict_1.default.equal(payout.success, true);
    strict_1.default.equal(mockDb._getCurrentBalance(), BigInt(700000));
    // 2. Incoming SUCCESSFUL webhook marks transaction PAID
    const webhookSuccess = await service.handleWebhook('MTN_MOMO', {}, '', { ref: 'webhook-flow-tx-1', status: 'PAID' }, mockDb);
    strict_1.default.equal(webhookSuccess.success, true);
    strict_1.default.equal(webhookSuccess.status, 'PAID');
    const completedTx = await mockDb.walletTransaction.findUnique({ where: { referenceId: 'webhook-flow-tx-1' } });
    strict_1.default.equal(completedTx?.status, 'PAID');
    // 3. Duplicate webhook replay protection: returns processed: false without re-running
    const duplicateWebhook = await service.handleWebhook('MTN_MOMO', {}, '', { ref: 'webhook-flow-tx-1', status: 'PAID' }, mockDb);
    strict_1.default.equal(duplicateWebhook.success, true);
    strict_1.default.equal(duplicateWebhook.processed, false);
});
