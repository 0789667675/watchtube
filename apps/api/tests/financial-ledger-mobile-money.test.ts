import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request, RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { createPaymentsRouter } from '../src/routes/payments.route';
import { createWalletRouter } from '../src/routes/wallet.route';
import {
  hasPermission,
  OWNER_ONLY_PERMISSIONS,
} from '../src/security/permissions';
import {
  RESTRICTED_OWNER_AUDIT_RESOURCES,
  sanitizeAuditMetadata,
} from '../src/services/audit.service';
import {
  InsufficientFundsError,
  InMemoryWalletLedgerRepository,
  LedgerValidationError,
  parsePositiveBigIntAmount,
  WalletLedgerService,
} from '../src/services/finance/ledger.service';
import {
  AirtelMoneyAdapter,
  InMemoryPaymentTransactionStore,
  MockAirtelMoneySandboxAdapter,
  MockMtnMoMoSandboxAdapter,
  MtnMoMoAdapter,
  OrchestratorError,
  PaymentOrchestratorService,
} from '../src/services/payments';

const CREATOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '99999999-9999-4999-8999-999999999999';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

test('Ledger validates RWF BigInt precision strictly, prevents concurrent lost updates, and preserves immutability', async () => {
  assert.throws(() => parsePositiveBigIntAmount(0), LedgerValidationError);
  assert.throws(() => parsePositiveBigIntAmount(-50), LedgerValidationError);
  assert.throws(() => parsePositiveBigIntAmount(12.34), LedgerValidationError);
  assert.throws(() => parsePositiveBigIntAmount('12.50'), LedgerValidationError);
  assert.throws(() => parsePositiveBigIntAmount('abc'), LedgerValidationError);
  assert.equal(parsePositiveBigIntAmount('5000'), 5000n);

  const repo = new InMemoryWalletLedgerRepository([CHANNEL_ID]);
  const ledger = new WalletLedgerService(repo);

  await ledger.creditRevenue({
    channelId: CHANNEL_ID,
    amountCents: 10_000n,
    referenceId: 'rev:opening',
  });

  // Fire 10 concurrent payout reservations of 3,000 each against 10,000 balance
  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, (_, idx) =>
      ledger.reservePayout({
        channelId: CHANNEL_ID,
        payoutId: `p-conc-${idx}`,
        amountCents: 3_000n,
      })
    )
  );

  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(fulfilled.length, 3, 'Only 3 x 3,000 = 9,000 may succeed out of 10,000 balance');
  assert.equal(rejected.length, 7);
  assert.ok(rejected.every((r) => r.status === 'rejected' && r.reason instanceof InsufficientFundsError));

  const bal = await ledger.getChannelBalance(CHANNEL_ID);
  assert.equal(bal.availableBalanceCents, 1_000n);
  assert.equal(bal.pendingPayoutCents, 9_000n);
  assert.equal(bal.totalPaidOutCents, 0n);
  assert.equal(bal.integrityVerified, true);

  // Fail + reverse one payout -> balance restored cleanly to 4,000 without mutating historical rows
  await ledger.failAndReversePayout({ channelId: CHANNEL_ID, payoutId: 'p-conc-0' });
  const afterFail = await ledger.getChannelBalance(CHANNEL_ID);
  assert.equal(afterFail.availableBalanceCents, 4_000n);
  assert.equal(afterFail.pendingPayoutCents, 6_000n);
  assert.equal(afterFail.totalReversedPayoutCents, 3_000n);
  assert.equal(afterFail.integrityVerified, true);

  // Settle another payout -> pending drops by 3,000, totalPaidOut becomes 3,000, available stays 4,000
  await ledger.finalizePayoutSuccess({ channelId: CHANNEL_ID, payoutId: 'p-conc-1' });
  const afterPaid = await ledger.getChannelBalance(CHANNEL_ID);
  assert.equal(afterPaid.availableBalanceCents, 4_000n);
  assert.equal(afterPaid.pendingPayoutCents, 3_000n);
  assert.equal(afterPaid.totalPaidOutCents, 3_000n);
  assert.equal(afterPaid.integrityVerified, true);
});

test('MTN MoMo and Airtel Money adapters fail closed outside test without official transport and forbid mocks in production', () => {
  // Unconfigured adapters report unconfigured
  const mtnUnconfigured = new MtnMoMoAdapter({ nodeEnv: 'production' });
  assert.equal(mtnUnconfigured.isConfigured(), false);
  const airtelUnconfigured = new AirtelMoneyAdapter({ nodeEnv: 'production' });
  assert.equal(airtelUnconfigured.isConfigured(), false);

  // Even with env-style strings in production, without official HTTP transport isConfigured() is false
  const mtnNoTransportInProd = new MtnMoMoAdapter({
    nodeEnv: 'production',
    subscriptionKey: 'k',
    apiUser: 'u',
    apiKey: 'a',
  });
  assert.equal(mtnNoTransportInProd.isConfigured(), false);

  // Mock adapters refuse instantiation in production
  assert.throws(() => new MockMtnMoMoSandboxAdapter({ nodeEnv: 'production' }), /cannot be instantiated in production/);
  assert.throws(() => new MockAirtelMoneySandboxAdapter({ nodeEnv: 'production' }), /cannot be instantiated in production/);
});

test('PaymentOrchestrator executes MTN MoMo & Airtel Money payouts/payments with idempotency, timeouts, webhooks, and reversals', async () => {
  const repo = new InMemoryWalletLedgerRepository([CHANNEL_ID]);
  const ledger = new WalletLedgerService(repo);
  await ledger.creditRevenue({ channelId: CHANNEL_ID, amountCents: 20_000n, referenceId: 'rev:seed' });

  const mtnMock = new MockMtnMoMoSandboxAdapter({
    simulateTimeoutOnKey: new Set(['idem-timeout-1']),
    simulateOutageOnKey: new Set(['idem-outage-1']),
    simulateSyncFailureOnKey: new Set(['idem-sync-fail-1']),
  });
  const airtelMock = new MockAirtelMoneySandboxAdapter({
    supportsRefunds: false,
    supportsReversals: false,
  });

  const auditEvents: any[] = [];
  const orchestrator = new PaymentOrchestratorService({
    ledger,
    store: new InMemoryPaymentTransactionStore(),
    adapters: { MTN_MOMO: mtnMock, AIRTEL_MONEY: airtelMock },
    eligibilityChecker: {
      async checkEligibility(userId) {
        return userId === CREATOR_ID
          ? { eligible: true, channelId: CHANNEL_ID }
          : { eligible: false, reason: 'Channel not found', statusCode: 404 };
      },
    },
    timeoutMs: 80,
    auditRecorder: async (ev) => {
      auditEvents.push(ev);
    },
  });

  // 1. Payout initiation stays PENDING (never PAID on initiation) & enforces idempotency
  const p1 = await orchestrator.initiateCreatorPayout({
    userId: CREATOR_ID,
    provider: 'MTN_MOMO',
    amountCents: 5_000n,
    phoneNumber: '0788123456',
    idempotencyKey: 'idem-payout-1',
  });
  assert.equal(p1.idempotentReplay, false);
  assert.equal(p1.transaction.status, 'PENDING');
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 15_000n);

  const p1Replay = await orchestrator.initiateCreatorPayout({
    userId: CREATOR_ID,
    provider: 'MTN_MOMO',
    amountCents: 5_000n,
    phoneNumber: '0788123456',
    idempotencyKey: 'idem-payout-1',
  });
  assert.equal(p1Replay.idempotentReplay, true);
  assert.equal(p1Replay.transaction.transactionId, p1.transaction.transactionId);
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 15_000n);

  // Conflicting idempotency key rejected with 409
  await assert.rejects(
    () =>
      orchestrator.initiateCreatorPayout({
        userId: CREATOR_ID,
        provider: 'MTN_MOMO',
        amountCents: 6_000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-payout-1',
      }),
    (err: unknown) => err instanceof OrchestratorError && err.statusCode === 409
  );

  // 2. Webhook signature validation + amount mismatch protection + idempotent duplicate webhook handling
  const badSigPayload = {
    webhookEventId: 'wh-1',
    providerReference: p1.transaction.providerReference,
    internalReference: p1.transaction.transactionId,
    status: 'PAID',
    amountCents: '5000',
    currency: 'RWF',
  };
  await assert.rejects(
    () =>
      orchestrator.processWebhook({
        provider: 'MTN_MOMO',
        headers: { 'x-watchtube-mock-signature': 'tampered' },
        rawBody: JSON.stringify(badSigPayload),
        parsedBody: badSigPayload,
      }),
    (err: unknown) => err instanceof OrchestratorError && err.statusCode === 401
  );

  const tamperedAmtPayload = { ...badSigPayload, webhookEventId: 'wh-amt', amountCents: '9999' };
  const signedTampered = mtnMock.signMockWebhookPayload(tamperedAmtPayload);
  await assert.rejects(
    () =>
      orchestrator.processWebhook({
        provider: 'MTN_MOMO',
        headers: signedTampered.headers,
        rawBody: signedTampered.rawBody,
        parsedBody: tamperedAmtPayload,
      }),
    (err: unknown) => err instanceof OrchestratorError && err.statusCode === 400
  );

  const signedPaid = mtnMock.signMockWebhookPayload(badSigPayload);
  const whFirst = await orchestrator.processWebhook({
    provider: 'MTN_MOMO',
    headers: signedPaid.headers,
    rawBody: signedPaid.rawBody,
    parsedBody: badSigPayload,
  });
  assert.equal(whFirst.status, 'PAID');
  assert.equal(whFirst.idempotent, false);

  const whDup = await orchestrator.processWebhook({
    provider: 'MTN_MOMO',
    headers: signedPaid.headers,
    rawBody: signedPaid.rawBody,
    parsedBody: badSigPayload,
  });
  assert.equal(whDup.status, 'PAID');
  assert.equal(whDup.idempotent, true);
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).totalPaidOutCents, 5_000n);

  // 3. Synchronous rejection immediately restores funds (failed payouts do not permanently remove funds)
  await assert.rejects(
    () =>
      orchestrator.initiateCreatorPayout({
        userId: CREATOR_ID,
        provider: 'MTN_MOMO',
        amountCents: 4_000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-sync-fail-1',
      }),
    (err: unknown) => err instanceof OrchestratorError && err.statusCode === 502
  );
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 15_000n);

  // 4. Provider timeout & outage leave transaction PENDING + reconciliationRequired=true without corrupting balance
  const timedOut = await orchestrator.initiateCreatorPayout({
    userId: CREATOR_ID,
    provider: 'MTN_MOMO',
    amountCents: 2_000n,
    phoneNumber: '0788123456',
    idempotencyKey: 'idem-timeout-1',
  });
  assert.equal(timedOut.transaction.status, 'PENDING');
  assert.equal(timedOut.transaction.reconciliationRequired, true);
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 13_000n);

  const outage = await orchestrator.initiateCreatorPayout({
    userId: CREATOR_ID,
    provider: 'MTN_MOMO',
    amountCents: 1_000n,
    phoneNumber: '0788123456',
    idempotencyKey: 'idem-outage-1',
  });
  assert.equal(outage.transaction.status, 'PENDING');
  assert.equal(outage.transaction.reconciliationRequired, true);
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 12_000n);

  // 5. Airtel Money payout + webhook failure reversal + unsupported refund capability check
  const airtelPayout = await orchestrator.initiateCreatorPayout({
    userId: CREATOR_ID,
    provider: 'AIRTEL_MONEY',
    amountCents: 3_000n,
    phoneNumber: '0722123456',
    idempotencyKey: 'idem-airtel-1',
  });
  assert.equal(airtelPayout.transaction.status, 'PENDING');
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 9_000n);

  const airtelFailPayload = {
    webhookEventId: 'wh-airtel-fail-1',
    providerReference: airtelPayout.transaction.providerReference,
    internalReference: airtelPayout.transaction.transactionId,
    status: 'FAILED',
    amountCents: '3000',
    currency: 'RWF',
    reason: 'Subscriber wallet limit reached',
  };
  airtelMock.setSimulatedStatus(airtelPayout.transaction.providerReference, 'FAILED', 'Subscriber wallet limit reached');
  const signedAirtelFail = airtelMock.signMockWebhookPayload(airtelFailPayload);
  const airtelWhRes = await orchestrator.processWebhook({
    provider: 'AIRTEL_MONEY',
    headers: signedAirtelFail.headers,
    rawBody: signedAirtelFail.rawBody,
    parsedBody: airtelFailPayload,
  });
  assert.equal(airtelWhRes.status, 'FAILED');
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 12_000n);

  // 6. Inbound payment initiation + webhook settlement + refund flow on MTN mock
  const inbound = await orchestrator.initiatePayment({
    userId: CREATOR_ID,
    channelId: CHANNEL_ID,
    provider: 'MTN_MOMO',
    amountCents: 1_000n,
    phoneNumber: '0788123456',
    idempotencyKey: 'idem-inbound-1',
    description: 'Channel sponsorship payment',
  });
  assert.equal(inbound.transaction.status, 'PENDING');
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 12_000n);

  mtnMock.setSimulatedStatus(inbound.transaction.providerReference, 'PAID');
  const inboundPaidPayload = {
    webhookEventId: 'wh-in-paid-1',
    eventType: 'PAYMENT',
    providerReference: inbound.transaction.providerReference,
    internalReference: inbound.transaction.transactionId,
    status: 'PAID',
    amountCents: '1000',
    currency: 'RWF',
  };
  const signedInPaid = mtnMock.signMockWebhookPayload(inboundPaidPayload);
  await orchestrator.processWebhook({
    provider: 'MTN_MOMO',
    headers: signedInPaid.headers,
    rawBody: signedInPaid.rawBody,
    parsedBody: inboundPaidPayload,
  });
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 13_000n);

  const refunded = await orchestrator.initiateRefundOrReversal({
    transactionId: inbound.transaction.transactionId,
    reason: 'Customer requested refund',
    idempotencyKey: 'idem-refund-1',
    actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
  });
  assert.equal(refunded.status, 'REFUNDED');
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 12_000n);

  // Airtel mock configured with supportsRefunds: false returns 501 UNSUPPORTED_OPERATION
  const airtelPay = await orchestrator.initiatePayment({
    userId: CREATOR_ID,
    channelId: CHANNEL_ID,
    provider: 'AIRTEL_MONEY',
    amountCents: 500n,
    phoneNumber: '0733123456',
    idempotencyKey: 'idem-airtel-in-1',
    description: 'Test Airtel pay',
  });
  const airtelPayPaid = {
    webhookEventId: 'wh-airtel-in-paid',
    eventType: 'PAYMENT',
    providerReference: airtelPay.transaction.providerReference,
    internalReference: airtelPay.transaction.transactionId,
    status: 'PAID',
    amountCents: '500',
    currency: 'RWF',
  };
  airtelMock.setSimulatedStatus(airtelPay.transaction.providerReference, 'PAID');
  const signedAirtelInPaid = airtelMock.signMockWebhookPayload(airtelPayPaid);
  await orchestrator.processWebhook({
    provider: 'AIRTEL_MONEY',
    headers: signedAirtelInPaid.headers,
    rawBody: signedAirtelInPaid.rawBody,
    parsedBody: airtelPayPaid,
  });

  // 7. Active status lookup reconciliation flow (when webhook was missed)
  const pollPayout = await orchestrator.initiateCreatorPayout({
    userId: CREATOR_ID,
    provider: 'MTN_MOMO',
    amountCents: 1_500n,
    phoneNumber: '0790123456',
    idempotencyKey: 'idem-poll-1',
  });
  assert.equal(pollPayout.transaction.status, 'PENDING');
  mtnMock.setSimulatedStatus(pollPayout.transaction.providerReference, 'PAID');
  const reconciled = await orchestrator.reconcileTransaction(
    pollPayout.transaction.transactionId,
    { id: OWNER_ID, role: 'SUPER_ADMIN' }
  );
  assert.equal(reconciled.status, 'PAID');
  assert.equal(reconciled.reconciliationRequired, false);
  await assert.rejects(
    () =>
      orchestrator.initiateRefundOrReversal({
        transactionId: airtelPay.transaction.transactionId,
        reason: 'Unsupported refund test',
        idempotencyKey: 'idem-airtel-refund',
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
      }),
    (err: unknown) => err instanceof OrchestratorError && err.code === 'UNSUPPORTED_OPERATION'
  );
  assert.ok(auditEvents.length >= 4);
});

test('HTTP /wallet and /payments endpoints enforce permissions, ownership, webhooks, and unconfigured 501 fail-closed', async () => {
  const repo = new InMemoryWalletLedgerRepository([CHANNEL_ID]);
  const ledger = new WalletLedgerService(repo);
  await ledger.creditRevenue({ channelId: CHANNEL_ID, amountCents: 10_000n, referenceId: 'rev:http' });

  const mtnMock = new MockMtnMoMoSandboxAdapter();
  const orchestrator = new PaymentOrchestratorService({
    ledger,
    store: new InMemoryPaymentTransactionStore(),
    adapters: { MTN_MOMO: mtnMock },
    eligibilityChecker: {
      async checkEligibility(userId) {
        return userId === CREATOR_ID
          ? { eligible: true, channelId: CHANNEL_ID }
          : { eligible: false, reason: 'Channel not found', statusCode: 404 };
      },
    },
    auditRecorder: async () => {},
  });

  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  const auth: RequestHandler = (req, res, next) => {
    const userId = req.get('x-test-user');
    const role = req.get('x-test-role') || 'USER';
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    (req as any).user = { id: userId, role };
    next();
  };

  const mockPrisma = {
    channel: {
      async findFirst({ where }: any) {
        return where.userId === CREATOR_ID ? { id: CHANNEL_ID } : null;
      },
    },
  };

  app.use(
    '/api/v1/wallet',
    createWalletRouter({
      prismaClient: mockPrisma,
      ledgerService: ledger,
      orchestrator,
      authenticateMiddleware: auth,
    })
  );

  const ownerOnly: RequestHandler = (req, res, next) => {
    if ((req as any).user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden. SUPER_ADMIN required.' });
    }
    next();
  };

  app.use(
    '/api/v1/payments',
    createPaymentsRouter({
      orchestrator,
      authenticateMiddleware: auth,
      requireExecuteMiddleware: ownerOnly,
      requireConfigureMiddleware: ownerOnly,
    })
  );

  const server = createServer(app);
  activeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Wallet balance & ledger
  const balRes = await fetch(`${baseUrl}/api/v1/wallet/balance`, {
    headers: { 'x-test-user': CREATOR_ID },
  });
  assert.equal(balRes.status, 200);
  const balJson = await balRes.json();
  assert.equal(balJson.balanceCents, '10000');
  assert.equal(balJson.currency, 'RWF');

  // Request payout -> 202 PENDING (Airtel unconfigured -> 501)
  const airtelUnconf = await fetch(`${baseUrl}/api/v1/wallet/request-payout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': CREATOR_ID },
    body: JSON.stringify({
      provider: 'AIRTEL_MONEY',
      amountCents: 2000,
      phoneNumber: '0722123456',
      idempotencyKey: 'http-airtel-1',
    }),
  });
  assert.equal(airtelUnconf.status, 501);

  const mtnPayout = await fetch(`${baseUrl}/api/v1/wallet/request-payout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-user': CREATOR_ID,
      'Idempotency-Key': 'http-mtn-1',
    },
    body: JSON.stringify({
      provider: 'MTN_MOMO',
      amountCents: 2500,
      phoneNumber: '0788123456',
    }),
  });
  assert.equal(mtnPayout.status, 202);
  const mtnData = await mtnPayout.json();
  assert.equal(mtnData.status, 'PENDING');
  assert.equal(mtnData.balanceAfterCents, '7500');

  // Another user cannot view creator's transaction status (403)
  const otherStatus = await fetch(`${baseUrl}/api/v1/payments/${mtnData.payoutId}/status`, {
    headers: { 'x-test-user': OTHER_USER_ID, 'x-test-role': 'USER' },
  });
  assert.equal(otherStatus.status, 403);

  // Ordinary ADMIN cannot access provider status or reconcile or refund (403)
  const adminProviderStatus = await fetch(`${baseUrl}/api/v1/payments/providers/status`, {
    headers: { 'x-test-user': OTHER_USER_ID, 'x-test-role': 'ADMIN' },
  });
  assert.equal(adminProviderStatus.status, 403);

  const ownerProviderStatus = await fetch(`${baseUrl}/api/v1/payments/providers/status`, {
    headers: { 'x-test-user': OWNER_ID, 'x-test-role': 'SUPER_ADMIN' },
  });
  assert.equal(ownerProviderStatus.status, 200);

  // Webhook unsigned -> 401, signed -> 200, duplicate -> 200 idempotent
  const whPayload = {
    webhookEventId: 'http-wh-1',
    providerReference: mtnData.providerReference,
    internalReference: mtnData.payoutId,
    status: 'PAID',
    amountCents: '2500',
    currency: 'RWF',
  };
  const unsignedWh = await fetch(`${baseUrl}/api/v1/payments/webhooks/mtn_momo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(whPayload),
  });
  assert.equal(unsignedWh.status, 401);

  const signedWh = mtnMock.signMockWebhookPayload(whPayload);
  const okWh = await fetch(`${baseUrl}/api/v1/payments/webhooks/mtn_momo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signedWh.headers },
    body: signedWh.rawBody,
  });
  assert.equal(okWh.status, 200);
  const okWhJson = await okWh.json();
  assert.equal(okWhJson.status, 'PAID');
  assert.equal(okWhJson.idempotent, false);

  const dupWh = await fetch(`${baseUrl}/api/v1/payments/webhooks/mtn_momo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signedWh.headers },
    body: signedWh.rawBody,
  });
  assert.equal(dupWh.status, 200);
  assert.equal((await dupWh.json()).idempotent, true);
});

test('Owner-only permissions and audit log redaction strictly isolate financial secrets and provider credentials', () => {
  const wildcardPartnerAdmin = {
    role: 'ADMIN',
    status: 'GOOD_STANDING',
    positionStatus: 'OCCUPIED',
    permissions: ['*'],
  };

  for (const ownerPerm of OWNER_ONLY_PERMISSIONS) {
    assert.equal(
      hasPermission(wildcardPartnerAdmin, ownerPerm),
      false,
      `Partner ADMIN even with '*' must be denied owner permission ${ownerPerm}`
    );
  }
  assert.equal(hasPermission(wildcardPartnerAdmin, 'monetization.manage_providers'), false);
  assert.equal(hasPermission(wildcardPartnerAdmin, 'payments.configure'), false);
  assert.equal(hasPermission(wildcardPartnerAdmin, 'payments.execute'), false);
  assert.equal(hasPermission(wildcardPartnerAdmin, 'finance.view_company_revenue'), false);
  assert.equal(hasPermission(wildcardPartnerAdmin, 'monetization.configure_rates'), false);

  // Ordinary ADMIN does NOT automatically get creator financial lookup unless explicitly granted
  const defaultAdmin = {
    role: 'ADMIN',
    status: 'GOOD_STANDING',
    positionStatus: 'OCCUPIED',
    permissions: [],
  };
  assert.equal(hasPermission(defaultAdmin, 'finance.creator_support_view'), false);

  const supportAdmin = {
    role: 'ADMIN',
    status: 'GOOD_STANDING',
    positionStatus: 'OCCUPIED',
    permissions: ['finance.creator_support_view'],
  };
  assert.equal(hasPermission(supportAdmin, 'finance.creator_support_view'), true);
  assert.equal(hasPermission(supportAdmin, 'finance.view_company_revenue'), false);

  // Audit metadata redaction covers payment/provider credentials & phone PII
  const sanitized = sanitizeAuditMetadata({
    provider: 'MTN_MOMO',
    subscriptionKey: 'secret-sub-key',
    apiKey: 'secret-api-key',
    webhookSecret: 'secret-wh',
    clientSecret: 'secret-client',
    msisdn: '250788123456',
    phoneNumber: '0788123456',
    amountCents: '5000',
  }) as Record<string, unknown>;

  assert.equal(sanitized.provider, 'MTN_MOMO');
  assert.equal(sanitized.amountCents, '5000');
  assert.equal(sanitized.subscriptionKey, '[REDACTED]');
  assert.equal(sanitized.apiKey, '[REDACTED]');
  assert.equal(sanitized.webhookSecret, '[REDACTED]');
  assert.equal(sanitized.clientSecret, '[REDACTED]');
  assert.equal(sanitized.msisdn, '[REDACTED]');
  assert.equal(sanitized.phoneNumber, '[REDACTED]');

  assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('PAYOUT'));
  assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('PAYMENT_TRANSACTION'));
  assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('AdProviderConfig'));
  assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('REVENUE_RECONCILIATION'));
  assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('MONETIZATION_RATE'));
});
