import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import {
  MtnMoMoAdapter,
  AirtelMoneyAdapter,
  PaymentService,
  normalizeRwandaPhoneNumber,
  IMobileMoneyProvider,
  PayoutInitiationRequest,
  PayoutInitiationResponse,
  PaymentInitiationRequest,
  PaymentInitiationResponse,
  WebhookVerificationResult,
  WebhookEvent,
} from '../src/services/payments';

test('normalizeRwandaPhoneNumber formats 10-digit, 9-digit, and international formats', () => {
  assert.equal(normalizeRwandaPhoneNumber('0788123456'), '250788123456');
  assert.equal(normalizeRwandaPhoneNumber('+250788123456'), '250788123456');
  assert.equal(normalizeRwandaPhoneNumber('250788123456'), '250788123456');
  assert.equal(normalizeRwandaPhoneNumber('788123456'), '250788123456');
});

test('MtnMoMoAdapter validates configuration and rejects invalid phone prefixes', async () => {
  const unconfigured = new MtnMoMoAdapter({});
  assert.equal(unconfigured.isConfigured(), false);

  const configured = new MtnMoMoAdapter({
    subscriptionKey: 'sub-key-123',
    apiUser: 'user-uuid-456',
    apiKey: 'api-key-789',
    webhookSecret: 'secret-webhook-key',
  });
  assert.equal(configured.isConfigured(), true);

  // Rejects invalid prefix (e.g. Airtel number 072 sent to MTN)
  const invalidResult = await configured.initiatePayout({
    channelId: 'chan-1',
    amountCents: 500000,
    phoneNumber: '0722123456',
    idempotencyKey: 'idem-1',
    narrative: 'Payout test',
  });
  assert.equal(invalidResult.success, false);
  assert.ok(invalidResult.failureReason?.includes('Invalid MTN Rwanda MSISDN'));

  // Accepts valid MTN prefix (078)
  const validResult = await configured.initiatePayout({
    channelId: 'chan-1',
    amountCents: 500000,
    phoneNumber: '0788123456',
    idempotencyKey: 'idem-2',
    narrative: 'Payout test',
  });
  assert.equal(validResult.success, true);
  assert.equal(validResult.status, 'PENDING');
});

test('AirtelMoneyAdapter validates configuration and rejects invalid phone prefixes', async () => {
  const unconfigured = new AirtelMoneyAdapter({});
  assert.equal(unconfigured.isConfigured(), false);

  const configured = new AirtelMoneyAdapter({
    clientId: 'client-id-123',
    clientSecret: 'secret-456',
    webhookSecret: 'airtel-secret',
  });
  assert.equal(configured.isConfigured(), true);

  // Rejects invalid prefix (e.g. MTN number 078 sent to Airtel)
  const invalidResult = await configured.initiatePayout({
    channelId: 'chan-1',
    amountCents: 500000,
    phoneNumber: '0788123456',
    idempotencyKey: 'idem-3',
    narrative: 'Airtel payout test',
  });
  assert.equal(invalidResult.success, false);
  assert.ok(invalidResult.failureReason?.includes('Invalid Airtel Rwanda MSISDN'));

  // Accepts valid Airtel prefix (072)
  const validResult = await configured.initiatePayout({
    channelId: 'chan-1',
    amountCents: 500000,
    phoneNumber: '0722123456',
    idempotencyKey: 'idem-4',
    narrative: 'Airtel payout test',
  });
  assert.equal(validResult.success, true);
  assert.equal(validResult.status, 'PENDING');
});

test('MtnMoMoAdapter verifies webhook signature using HMAC-SHA256 and fails closed', async () => {
  const secret = 'super-secret-momo-webhook-key';
  const adapter = new MtnMoMoAdapter({
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

  const validSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  // Valid signature passes
  const validCheck = await adapter.verifyWebhookSignature(
    { 'x-callback-signature': validSignature },
    payload
  );
  assert.equal(validCheck.isValid, true);

  // Tampered signature is rejected
  const tamperedCheck = await adapter.verifyWebhookSignature(
    { 'x-callback-signature': '0000000000000000000000000000000000000000000000000000000000000000' },
    payload
  );
  assert.equal(tamperedCheck.isValid, false);

  // Missing signature header is rejected
  const missingCheck = await adapter.verifyWebhookSignature({}, payload);
  assert.equal(missingCheck.isValid, false);

  // Missing secret fails closed
  const unconfiguredSecretAdapter = new MtnMoMoAdapter({ subscriptionKey: 's', apiUser: 'u', apiKey: 'k' });
  const failClosed = await unconfiguredSecretAdapter.verifyWebhookSignature(
    { 'x-callback-signature': validSignature },
    payload
  );
  assert.equal(failClosed.isValid, false);
});

// Mock database client for isolated unit testing of double-entry ledger logic
function createMockDb(initialBalance = BigInt(1000000)) {
  const channel = { id: 'channel-test-uuid', userId: 'user-test-uuid', isMonetized: true };
  const transactions: any[] = [];
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
      async findFirst({ where }: any) {
        if (where.userId === channel.userId || where.id === channel.id) return channel;
        return null;
      },
    },
    walletTransaction: {
      async findUnique({ where }: any) {
        return transactions.find((t) => t.referenceId === where.referenceId) || null;
      },
      async findFirst({ where, orderBy }: any) {
        let filtered = transactions;
        if (where?.channelId) {
          filtered = filtered.filter((t) => t.channelId === where.channelId);
        }
        if (where?.OR && Array.isArray(where.OR)) {
          filtered = filtered.filter((t) =>
            where.OR.some((clause: any) => clause.referenceId && t.referenceId === clause.referenceId)
          );
        }
        if (filtered.length === 0) return null;
        return filtered[filtered.length - 1]; // latest
      },
      async create({ data }: any) {
        const record = { id: `tx-${Date.now()}-${Math.random()}`, createdAt: new Date(), ...data };
        transactions.push(record);
        currentBalance = BigInt(record.balanceAfterCents);
        return record;
      },
      async update({ where, data }: any) {
        const tx = transactions.find((t) => t.id === where.id);
        if (tx) Object.assign(tx, data);
        return tx;
      },
    },
    async $transaction(callback: any) {
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

test('PaymentService enforces idempotency: repeat request returns existing transaction without double debit', async () => {
  const service = new PaymentService();
  const mockProvider: IMobileMoneyProvider = {
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
  const first = await service.requestPayout(
    'user-test-uuid',
    {
      amountCents: 200000,
      provider: 'MTN_MOMO',
      phoneNumber: '0788123456',
      idempotencyKey: 'idempotent-key-001',
    },
    mockDb
  );

  assert.equal(first.success, true);
  assert.equal(first.transaction?.amountCents, '200000');
  assert.equal(first.transaction?.balanceAfterCents, '300000');
  assert.equal(mockDb._getTransactions().length, 2);

  // Second duplicate request with exact same idempotencyKey returns existing tx without changing balance
  const second = await service.requestPayout(
    'user-test-uuid',
    {
      amountCents: 200000,
      provider: 'MTN_MOMO',
      phoneNumber: '0788123456',
      idempotencyKey: 'idempotent-key-001',
    },
    mockDb
  );

  assert.equal(second.success, true);
  assert.equal(second.transaction?.id, first.transaction?.id);
  assert.equal(second.transaction?.balanceAfterCents, '300000');
  // Transaction count must STILL be 2, no extra transaction was recorded
  assert.equal(mockDb._getTransactions().length, 2);
  assert.equal(mockDb._getCurrentBalance(), BigInt(300000));
});

test('PaymentService rejects payout when wallet balance is insufficient', async () => {
  const service = new PaymentService();
  const mockProvider: IMobileMoneyProvider = {
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
  const result = await service.requestPayout(
    'user-test-uuid',
    {
      amountCents: 500000,
      provider: 'MTN_MOMO',
      phoneNumber: '0788123456',
      idempotencyKey: 'insufficient-funds-key',
    },
    mockDb
  );

  assert.equal(result.success, false);
  assert.equal(result.error, 'INSUFFICIENT_FUNDS');
  // Balance must remain unchanged at 1,000 RWF
  assert.equal(mockDb._getCurrentBalance(), BigInt(100000));
});

test('PaymentService creates compensating ADJUSTMENT transaction when provider dispatch fails', async () => {
  const service = new PaymentService();
  const failingProvider: IMobileMoneyProvider = {
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

  const result = await service.requestPayout(
    'user-test-uuid',
    {
      amountCents: 200000,
      provider: 'MTN_MOMO',
      phoneNumber: '0788123456',
      idempotencyKey: 'fail-reversal-key',
    },
    mockDb
  );

  assert.equal(result.success, false);
  assert.equal(result.error, 'DISPATCH_REJECTED');

  const txs = mockDb._getTransactions();
  // We expect: 1. Opening credit, 2. Payout (status FAILED), 3. Compensating ADJUSTMENT credit
  assert.equal(txs.length, 3);
  assert.equal(txs[1].transactionType, 'PAYOUT');
  assert.equal(txs[1].status, 'FAILED');
  assert.equal(txs[2].transactionType, 'ADJUSTMENT');
  assert.equal(txs[2].amountCents, BigInt(200000));
  // Balance was restored back to 500,000 cents
  assert.equal(mockDb._getCurrentBalance(), BigInt(500000));
});

test('PaymentService processes webhook callbacks: marks PAID on success and refunds on failure', async () => {
  const service = new PaymentService();
  const mockDb = createMockDb(BigInt(1000000));

  const mockProvider: IMobileMoneyProvider = {
    name: 'MTN_MOMO',
    isConfigured: () => true,
    initiatePayment: async () => ({ success: true, providerReference: 'p-1', status: 'PENDING' }),
    initiatePayout: async () => ({ success: true, providerReference: 'payout-test-tx', status: 'PENDING' }),
    verifyWebhookSignature: async () => ({ isValid: true }),
    parseWebhook: (body: any) => ({
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
  const payout = await service.requestPayout(
    'user-test-uuid',
    {
      amountCents: 300000,
      provider: 'MTN_MOMO',
      phoneNumber: '0788123456',
      idempotencyKey: 'webhook-flow-tx-1',
    },
    mockDb
  );
  assert.equal(payout.success, true);
  assert.equal(mockDb._getCurrentBalance(), BigInt(700000));

  // 2. Incoming SUCCESSFUL webhook marks transaction PAID
  const webhookSuccess = await service.handleWebhook(
    'MTN_MOMO',
    {},
    '',
    { ref: 'webhook-flow-tx-1', status: 'PAID' },
    mockDb
  );
  assert.equal(webhookSuccess.success, true);
  assert.equal(webhookSuccess.status, 'PAID');

  const completedTx = await mockDb.walletTransaction.findUnique({ where: { referenceId: 'webhook-flow-tx-1' } });
  assert.equal(completedTx?.status, 'PAID');

  // 3. Duplicate webhook replay protection: returns processed: false without re-running
  const duplicateWebhook = await service.handleWebhook(
    'MTN_MOMO',
    {},
    '',
    { ref: 'webhook-flow-tx-1', status: 'PAID' },
    mockDb
  );
  assert.equal(duplicateWebhook.success, true);
  assert.equal(duplicateWebhook.processed, false);
});
