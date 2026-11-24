"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const payments_route_1 = require("../src/routes/payments.route");
const wallet_route_1 = require("../src/routes/wallet.route");
const permissions_1 = require("../src/security/permissions");
const audit_service_1 = require("../src/services/audit.service");
const ledger_service_1 = require("../src/services/finance/ledger.service");
const payments_1 = require("../src/services/payments");
const CREATOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '99999999-9999-4999-8999-999999999999';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const activeServers = [];
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.splice(0).map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
});
(0, node_test_1.test)('Ledger validates RWF BigInt precision strictly, prevents concurrent lost updates, and preserves immutability', async () => {
    strict_1.default.throws(() => (0, ledger_service_1.parsePositiveBigIntAmount)(0), ledger_service_1.LedgerValidationError);
    strict_1.default.throws(() => (0, ledger_service_1.parsePositiveBigIntAmount)(-50), ledger_service_1.LedgerValidationError);
    strict_1.default.throws(() => (0, ledger_service_1.parsePositiveBigIntAmount)(12.34), ledger_service_1.LedgerValidationError);
    strict_1.default.throws(() => (0, ledger_service_1.parsePositiveBigIntAmount)('12.50'), ledger_service_1.LedgerValidationError);
    strict_1.default.throws(() => (0, ledger_service_1.parsePositiveBigIntAmount)('abc'), ledger_service_1.LedgerValidationError);
    strict_1.default.equal((0, ledger_service_1.parsePositiveBigIntAmount)('5000'), 5000n);
    const repo = new ledger_service_1.InMemoryWalletLedgerRepository([CHANNEL_ID]);
    const ledger = new ledger_service_1.WalletLedgerService(repo);
    await ledger.creditRevenue({
        channelId: CHANNEL_ID,
        amountCents: 10000n,
        referenceId: 'rev:opening',
    });
    // Fire 10 concurrent payout reservations of 3,000 each against 10,000 balance
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, (_, idx) => ledger.reservePayout({
        channelId: CHANNEL_ID,
        payoutId: `p-conc-${idx}`,
        amountCents: 3000n,
    })));
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    strict_1.default.equal(fulfilled.length, 3, 'Only 3 x 3,000 = 9,000 may succeed out of 10,000 balance');
    strict_1.default.equal(rejected.length, 7);
    strict_1.default.ok(rejected.every((r) => r.status === 'rejected' && r.reason instanceof ledger_service_1.InsufficientFundsError));
    const bal = await ledger.getChannelBalance(CHANNEL_ID);
    strict_1.default.equal(bal.availableBalanceCents, 1000n);
    strict_1.default.equal(bal.pendingPayoutCents, 9000n);
    strict_1.default.equal(bal.totalPaidOutCents, 0n);
    strict_1.default.equal(bal.integrityVerified, true);
    // Fail + reverse one payout -> balance restored cleanly to 4,000 without mutating historical rows
    await ledger.failAndReversePayout({ channelId: CHANNEL_ID, payoutId: 'p-conc-0' });
    const afterFail = await ledger.getChannelBalance(CHANNEL_ID);
    strict_1.default.equal(afterFail.availableBalanceCents, 4000n);
    strict_1.default.equal(afterFail.pendingPayoutCents, 6000n);
    strict_1.default.equal(afterFail.totalReversedPayoutCents, 3000n);
    strict_1.default.equal(afterFail.integrityVerified, true);
    // Settle another payout -> pending drops by 3,000, totalPaidOut becomes 3,000, available stays 4,000
    await ledger.finalizePayoutSuccess({ channelId: CHANNEL_ID, payoutId: 'p-conc-1' });
    const afterPaid = await ledger.getChannelBalance(CHANNEL_ID);
    strict_1.default.equal(afterPaid.availableBalanceCents, 4000n);
    strict_1.default.equal(afterPaid.pendingPayoutCents, 3000n);
    strict_1.default.equal(afterPaid.totalPaidOutCents, 3000n);
    strict_1.default.equal(afterPaid.integrityVerified, true);
});
(0, node_test_1.test)('MTN MoMo and Airtel Money adapters fail closed outside test without official transport and forbid mocks in production', () => {
    // Unconfigured adapters report unconfigured
    const mtnUnconfigured = new payments_1.MtnMoMoAdapter({ nodeEnv: 'production' });
    strict_1.default.equal(mtnUnconfigured.isConfigured(), false);
    const airtelUnconfigured = new payments_1.AirtelMoneyAdapter({ nodeEnv: 'production' });
    strict_1.default.equal(airtelUnconfigured.isConfigured(), false);
    // Even with env-style strings in production, without official HTTP transport isConfigured() is false
    const mtnNoTransportInProd = new payments_1.MtnMoMoAdapter({
        nodeEnv: 'production',
        subscriptionKey: 'k',
        apiUser: 'u',
        apiKey: 'a',
    });
    strict_1.default.equal(mtnNoTransportInProd.isConfigured(), false);
    // Mock adapters refuse instantiation in production
    strict_1.default.throws(() => new payments_1.MockMtnMoMoSandboxAdapter({ nodeEnv: 'production' }), /cannot be instantiated in production/);
    strict_1.default.throws(() => new payments_1.MockAirtelMoneySandboxAdapter({ nodeEnv: 'production' }), /cannot be instantiated in production/);
});
(0, node_test_1.test)('PaymentOrchestrator executes MTN MoMo & Airtel Money payouts/payments with idempotency, timeouts, webhooks, and reversals', async () => {
    const repo = new ledger_service_1.InMemoryWalletLedgerRepository([CHANNEL_ID]);
    const ledger = new ledger_service_1.WalletLedgerService(repo);
    await ledger.creditRevenue({ channelId: CHANNEL_ID, amountCents: 20000n, referenceId: 'rev:seed' });
    const mtnMock = new payments_1.MockMtnMoMoSandboxAdapter({
        simulateTimeoutOnKey: new Set(['idem-timeout-1']),
        simulateOutageOnKey: new Set(['idem-outage-1']),
        simulateSyncFailureOnKey: new Set(['idem-sync-fail-1']),
    });
    const airtelMock = new payments_1.MockAirtelMoneySandboxAdapter({
        supportsRefunds: false,
        supportsReversals: false,
    });
    const auditEvents = [];
    const orchestrator = new payments_1.PaymentOrchestratorService({
        ledger,
        store: new payments_1.InMemoryPaymentTransactionStore(),
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
        amountCents: 5000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-payout-1',
    });
    strict_1.default.equal(p1.idempotentReplay, false);
    strict_1.default.equal(p1.transaction.status, 'PENDING');
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 15000n);
    const p1Replay = await orchestrator.initiateCreatorPayout({
        userId: CREATOR_ID,
        provider: 'MTN_MOMO',
        amountCents: 5000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-payout-1',
    });
    strict_1.default.equal(p1Replay.idempotentReplay, true);
    strict_1.default.equal(p1Replay.transaction.transactionId, p1.transaction.transactionId);
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 15000n);
    // Conflicting idempotency key rejected with 409
    await strict_1.default.rejects(() => orchestrator.initiateCreatorPayout({
        userId: CREATOR_ID,
        provider: 'MTN_MOMO',
        amountCents: 6000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-payout-1',
    }), (err) => err instanceof payments_1.OrchestratorError && err.statusCode === 409);
    // 2. Webhook signature validation + amount mismatch protection + idempotent duplicate webhook handling
    const badSigPayload = {
        webhookEventId: 'wh-1',
        providerReference: p1.transaction.providerReference,
        internalReference: p1.transaction.transactionId,
        status: 'PAID',
        amountCents: '5000',
        currency: 'RWF',
    };
    await strict_1.default.rejects(() => orchestrator.processWebhook({
        provider: 'MTN_MOMO',
        headers: { 'x-watchtube-mock-signature': 'tampered' },
        rawBody: JSON.stringify(badSigPayload),
        parsedBody: badSigPayload,
    }), (err) => err instanceof payments_1.OrchestratorError && err.statusCode === 401);
    const tamperedAmtPayload = { ...badSigPayload, webhookEventId: 'wh-amt', amountCents: '9999' };
    const signedTampered = mtnMock.signMockWebhookPayload(tamperedAmtPayload);
    await strict_1.default.rejects(() => orchestrator.processWebhook({
        provider: 'MTN_MOMO',
        headers: signedTampered.headers,
        rawBody: signedTampered.rawBody,
        parsedBody: tamperedAmtPayload,
    }), (err) => err instanceof payments_1.OrchestratorError && err.statusCode === 400);
    const signedPaid = mtnMock.signMockWebhookPayload(badSigPayload);
    const whFirst = await orchestrator.processWebhook({
        provider: 'MTN_MOMO',
        headers: signedPaid.headers,
        rawBody: signedPaid.rawBody,
        parsedBody: badSigPayload,
    });
    strict_1.default.equal(whFirst.status, 'PAID');
    strict_1.default.equal(whFirst.idempotent, false);
    const whDup = await orchestrator.processWebhook({
        provider: 'MTN_MOMO',
        headers: signedPaid.headers,
        rawBody: signedPaid.rawBody,
        parsedBody: badSigPayload,
    });
    strict_1.default.equal(whDup.status, 'PAID');
    strict_1.default.equal(whDup.idempotent, true);
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).totalPaidOutCents, 5000n);
    // 3. Synchronous rejection immediately restores funds (failed payouts do not permanently remove funds)
    await strict_1.default.rejects(() => orchestrator.initiateCreatorPayout({
        userId: CREATOR_ID,
        provider: 'MTN_MOMO',
        amountCents: 4000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-sync-fail-1',
    }), (err) => err instanceof payments_1.OrchestratorError && err.statusCode === 502);
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 15000n);
    // 4. Provider timeout & outage leave transaction PENDING + reconciliationRequired=true without corrupting balance
    const timedOut = await orchestrator.initiateCreatorPayout({
        userId: CREATOR_ID,
        provider: 'MTN_MOMO',
        amountCents: 2000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-timeout-1',
    });
    strict_1.default.equal(timedOut.transaction.status, 'PENDING');
    strict_1.default.equal(timedOut.transaction.reconciliationRequired, true);
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 13000n);
    const outage = await orchestrator.initiateCreatorPayout({
        userId: CREATOR_ID,
        provider: 'MTN_MOMO',
        amountCents: 1000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-outage-1',
    });
    strict_1.default.equal(outage.transaction.status, 'PENDING');
    strict_1.default.equal(outage.transaction.reconciliationRequired, true);
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 12000n);
    // 5. Airtel Money payout + webhook failure reversal + unsupported refund capability check
    const airtelPayout = await orchestrator.initiateCreatorPayout({
        userId: CREATOR_ID,
        provider: 'AIRTEL_MONEY',
        amountCents: 3000n,
        phoneNumber: '0722123456',
        idempotencyKey: 'idem-airtel-1',
    });
    strict_1.default.equal(airtelPayout.transaction.status, 'PENDING');
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 9000n);
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
    strict_1.default.equal(airtelWhRes.status, 'FAILED');
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 12000n);
    // 6. Inbound payment initiation + webhook settlement + refund flow on MTN mock
    const inbound = await orchestrator.initiatePayment({
        userId: CREATOR_ID,
        channelId: CHANNEL_ID,
        provider: 'MTN_MOMO',
        amountCents: 1000n,
        phoneNumber: '0788123456',
        idempotencyKey: 'idem-inbound-1',
        description: 'Channel sponsorship payment',
    });
    strict_1.default.equal(inbound.transaction.status, 'PENDING');
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 12000n);
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
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 13000n);
    const refunded = await orchestrator.initiateRefundOrReversal({
        transactionId: inbound.transaction.transactionId,
        reason: 'Customer requested refund',
        idempotencyKey: 'idem-refund-1',
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
    });
    strict_1.default.equal(refunded.status, 'REFUNDED');
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 12000n);
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
        amountCents: 1500n,
        phoneNumber: '0790123456',
        idempotencyKey: 'idem-poll-1',
    });
    strict_1.default.equal(pollPayout.transaction.status, 'PENDING');
    mtnMock.setSimulatedStatus(pollPayout.transaction.providerReference, 'PAID');
    const reconciled = await orchestrator.reconcileTransaction(pollPayout.transaction.transactionId, { id: OWNER_ID, role: 'SUPER_ADMIN' });
    strict_1.default.equal(reconciled.status, 'PAID');
    strict_1.default.equal(reconciled.reconciliationRequired, false);
    await strict_1.default.rejects(() => orchestrator.initiateRefundOrReversal({
        transactionId: airtelPay.transaction.transactionId,
        reason: 'Unsupported refund test',
        idempotencyKey: 'idem-airtel-refund',
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
    }), (err) => err instanceof payments_1.OrchestratorError && err.code === 'UNSUPPORTED_OPERATION');
    strict_1.default.ok(auditEvents.length >= 4);
});
(0, node_test_1.test)('HTTP /wallet and /payments endpoints enforce permissions, ownership, webhooks, and unconfigured 501 fail-closed', async () => {
    const repo = new ledger_service_1.InMemoryWalletLedgerRepository([CHANNEL_ID]);
    const ledger = new ledger_service_1.WalletLedgerService(repo);
    await ledger.creditRevenue({ channelId: CHANNEL_ID, amountCents: 10000n, referenceId: 'rev:http' });
    const mtnMock = new payments_1.MockMtnMoMoSandboxAdapter();
    const orchestrator = new payments_1.PaymentOrchestratorService({
        ledger,
        store: new payments_1.InMemoryPaymentTransactionStore(),
        adapters: { MTN_MOMO: mtnMock },
        eligibilityChecker: {
            async checkEligibility(userId) {
                return userId === CREATOR_ID
                    ? { eligible: true, channelId: CHANNEL_ID }
                    : { eligible: false, reason: 'Channel not found', statusCode: 404 };
            },
        },
        auditRecorder: async () => { },
    });
    const app = (0, express_1.default)();
    app.use(express_1.default.json({
        verify: (req, _res, buf) => {
            req.rawBody = buf;
        },
    }));
    const auth = (req, res, next) => {
        const userId = req.get('x-test-user');
        const role = req.get('x-test-role') || 'USER';
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        req.user = { id: userId, role };
        next();
    };
    const mockPrisma = {
        channel: {
            async findFirst({ where }) {
                return where.userId === CREATOR_ID ? { id: CHANNEL_ID } : null;
            },
        },
    };
    app.use('/api/v1/wallet', (0, wallet_route_1.createWalletRouter)({
        prismaClient: mockPrisma,
        ledgerService: ledger,
        orchestrator,
        authenticateMiddleware: auth,
    }));
    const ownerOnly = (req, res, next) => {
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Forbidden. SUPER_ADMIN required.' });
        }
        next();
    };
    app.use('/api/v1/payments', (0, payments_route_1.createPaymentsRouter)({
        orchestrator,
        authenticateMiddleware: auth,
        requireExecuteMiddleware: ownerOnly,
        requireConfigureMiddleware: ownerOnly,
    }));
    const server = (0, node_http_1.createServer)(app);
    activeServers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    // Wallet balance & ledger
    const balRes = await fetch(`${baseUrl}/api/v1/wallet/balance`, {
        headers: { 'x-test-user': CREATOR_ID },
    });
    strict_1.default.equal(balRes.status, 200);
    const balJson = await balRes.json();
    strict_1.default.equal(balJson.balanceCents, '10000');
    strict_1.default.equal(balJson.currency, 'RWF');
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
    strict_1.default.equal(airtelUnconf.status, 501);
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
    strict_1.default.equal(mtnPayout.status, 202);
    const mtnData = await mtnPayout.json();
    strict_1.default.equal(mtnData.status, 'PENDING');
    strict_1.default.equal(mtnData.balanceAfterCents, '7500');
    // Another user cannot view creator's transaction status (403)
    const otherStatus = await fetch(`${baseUrl}/api/v1/payments/${mtnData.payoutId}/status`, {
        headers: { 'x-test-user': OTHER_USER_ID, 'x-test-role': 'USER' },
    });
    strict_1.default.equal(otherStatus.status, 403);
    // Ordinary ADMIN cannot access provider status or reconcile or refund (403)
    const adminProviderStatus = await fetch(`${baseUrl}/api/v1/payments/providers/status`, {
        headers: { 'x-test-user': OTHER_USER_ID, 'x-test-role': 'ADMIN' },
    });
    strict_1.default.equal(adminProviderStatus.status, 403);
    const ownerProviderStatus = await fetch(`${baseUrl}/api/v1/payments/providers/status`, {
        headers: { 'x-test-user': OWNER_ID, 'x-test-role': 'SUPER_ADMIN' },
    });
    strict_1.default.equal(ownerProviderStatus.status, 200);
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
    strict_1.default.equal(unsignedWh.status, 401);
    const signedWh = mtnMock.signMockWebhookPayload(whPayload);
    const okWh = await fetch(`${baseUrl}/api/v1/payments/webhooks/mtn_momo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signedWh.headers },
        body: signedWh.rawBody,
    });
    strict_1.default.equal(okWh.status, 200);
    const okWhJson = await okWh.json();
    strict_1.default.equal(okWhJson.status, 'PAID');
    strict_1.default.equal(okWhJson.idempotent, false);
    const dupWh = await fetch(`${baseUrl}/api/v1/payments/webhooks/mtn_momo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signedWh.headers },
        body: signedWh.rawBody,
    });
    strict_1.default.equal(dupWh.status, 200);
    strict_1.default.equal((await dupWh.json()).idempotent, true);
});
(0, node_test_1.test)('Owner-only permissions and audit log redaction strictly isolate financial secrets and provider credentials', () => {
    const wildcardPartnerAdmin = {
        role: 'ADMIN',
        status: 'GOOD_STANDING',
        positionStatus: 'OCCUPIED',
        permissions: ['*'],
    };
    for (const ownerPerm of permissions_1.OWNER_ONLY_PERMISSIONS) {
        strict_1.default.equal((0, permissions_1.hasPermission)(wildcardPartnerAdmin, ownerPerm), false, `Partner ADMIN even with '*' must be denied owner permission ${ownerPerm}`);
    }
    strict_1.default.equal((0, permissions_1.hasPermission)(wildcardPartnerAdmin, 'monetization.manage_providers'), false);
    strict_1.default.equal((0, permissions_1.hasPermission)(wildcardPartnerAdmin, 'payments.configure'), false);
    strict_1.default.equal((0, permissions_1.hasPermission)(wildcardPartnerAdmin, 'payments.execute'), false);
    strict_1.default.equal((0, permissions_1.hasPermission)(wildcardPartnerAdmin, 'finance.view_company_revenue'), false);
    strict_1.default.equal((0, permissions_1.hasPermission)(wildcardPartnerAdmin, 'monetization.configure_rates'), false);
    // Ordinary ADMIN does NOT automatically get creator financial lookup unless explicitly granted
    const defaultAdmin = {
        role: 'ADMIN',
        status: 'GOOD_STANDING',
        positionStatus: 'OCCUPIED',
        permissions: [],
    };
    strict_1.default.equal((0, permissions_1.hasPermission)(defaultAdmin, 'finance.creator_support_view'), false);
    const supportAdmin = {
        role: 'ADMIN',
        status: 'GOOD_STANDING',
        positionStatus: 'OCCUPIED',
        permissions: ['finance.creator_support_view'],
    };
    strict_1.default.equal((0, permissions_1.hasPermission)(supportAdmin, 'finance.creator_support_view'), true);
    strict_1.default.equal((0, permissions_1.hasPermission)(supportAdmin, 'finance.view_company_revenue'), false);
    // Audit metadata redaction covers payment/provider credentials & phone PII
    const sanitized = (0, audit_service_1.sanitizeAuditMetadata)({
        provider: 'MTN_MOMO',
        subscriptionKey: 'secret-sub-key',
        apiKey: 'secret-api-key',
        webhookSecret: 'secret-wh',
        clientSecret: 'secret-client',
        msisdn: '250788123456',
        phoneNumber: '0788123456',
        amountCents: '5000',
    });
    strict_1.default.equal(sanitized.provider, 'MTN_MOMO');
    strict_1.default.equal(sanitized.amountCents, '5000');
    strict_1.default.equal(sanitized.subscriptionKey, '[REDACTED]');
    strict_1.default.equal(sanitized.apiKey, '[REDACTED]');
    strict_1.default.equal(sanitized.webhookSecret, '[REDACTED]');
    strict_1.default.equal(sanitized.clientSecret, '[REDACTED]');
    strict_1.default.equal(sanitized.msisdn, '[REDACTED]');
    strict_1.default.equal(sanitized.phoneNumber, '[REDACTED]');
    strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('PAYOUT'));
    strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('PAYMENT_TRANSACTION'));
    strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('AdProviderConfig'));
    strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('REVENUE_RECONCILIATION'));
    strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('MONETIZATION_RATE'));
});
