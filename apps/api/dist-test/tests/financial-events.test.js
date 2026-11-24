"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const node_crypto_1 = __importDefault(require("node:crypto"));
const financialEvents_1 = require("../src/services/finance/financialEvents");
const ledger_service_1 = require("../src/services/finance/ledger.service");
const paymentOrchestrator_service_1 = require("../src/services/payments/paymentOrchestrator.service");
const ledger_service_2 = require("../src/services/finance/ledger.service");
const paymentStore_1 = require("../src/services/payments/paymentStore");
const mockAdapters_1 = require("../src/services/payments/mockAdapters");
(0, node_test_1.test)('Financial Events: Listener registration, event delivery, and deregistration', async () => {
    (0, financialEvents_1.clearFinancialNotificationListeners)();
    const received = [];
    const listener = {
        onFinancialEvent(event) {
            received.push(event);
        },
    };
    const unsubscribe = (0, financialEvents_1.registerFinancialNotificationListener)(listener);
    const testEvent = {
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'PAYMENT_RECEIVED',
        transactionId: 'tx-1001',
        channelId: 'chan-001',
        creatorUserId: 'user-001',
        amountCents: 50000n,
        currency: ledger_service_1.LEDGER_CURRENCY,
        provider: 'MTN_MOMO',
        providerReference: 'momo-ref-123',
        timestamp: new Date(),
    };
    await (0, financialEvents_1.emitFinancialNotificationEvent)(testEvent);
    strict_1.default.equal(received.length, 1);
    strict_1.default.equal(received[0].eventType, 'PAYMENT_RECEIVED');
    strict_1.default.equal(received[0].amountCents, 50000n);
    // Deregister listener
    unsubscribe();
    await (0, financialEvents_1.emitFinancialNotificationEvent)(testEvent);
    strict_1.default.equal(received.length, 1, 'Deregistered listener must not receive further events');
});
(0, node_test_1.test)('Financial Events: Fail-safe isolation ensures broken listeners do not throw', async () => {
    (0, financialEvents_1.clearFinancialNotificationListeners)();
    const healthyReceived = [];
    // Broken sync listener
    (0, financialEvents_1.registerFinancialNotificationListener)({
        onFinancialEvent() {
            throw new Error('Sync catastrophe in notification listener');
        },
    });
    // Broken async listener
    (0, financialEvents_1.registerFinancialNotificationListener)({
        async onFinancialEvent() {
            await Promise.resolve();
            throw new Error('Async rejection in notification listener');
        },
    });
    // Healthy listener
    (0, financialEvents_1.registerFinancialNotificationListener)({
        onFinancialEvent(event) {
            healthyReceived.push(event);
        },
    });
    const event = {
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'WITHDRAWAL_REQUESTED',
        payoutId: 'payout-1002',
        channelId: 'chan-002',
        creatorUserId: 'user-002',
        amountCents: 150000n,
        currency: ledger_service_1.LEDGER_CURRENCY,
        provider: 'AIRTEL_MONEY',
        recipientPhoneMasked: '25073****001',
        idempotencyKey: 'idem-withdrawal-1',
        timestamp: new Date(),
    };
    // Must NOT throw despite broken listeners
    await strict_1.default.doesNotReject(async () => {
        await (0, financialEvents_1.emitFinancialNotificationEvent)(event);
    });
    strict_1.default.equal(healthyReceived.length, 1);
    strict_1.default.equal(healthyReceived[0].eventType, 'WITHDRAWAL_REQUESTED');
    (0, financialEvents_1.clearFinancialNotificationListeners)();
});
(0, node_test_1.test)('Financial Events: PaymentOrchestrator emits financial events on payout lifecycle', async () => {
    (0, financialEvents_1.clearFinancialNotificationListeners)();
    const events = [];
    (0, financialEvents_1.registerFinancialNotificationListener)({
        onFinancialEvent(evt) {
            events.push(evt);
        },
    });
    const ledgerRepo = new ledger_service_2.InMemoryWalletLedgerRepository();
    const ledger = new ledger_service_2.WalletLedgerService(ledgerRepo);
    const store = new paymentStore_1.InMemoryPaymentTransactionStore();
    // Credit channel with funds first
    await ledger.creditRevenue({
        channelId: 'chan-evt-test',
        amountCents: 200000n,
        referenceId: 'ref-initial-credit',
        status: 'AVAILABLE',
    });
    const mockAdapter = new mockAdapters_1.MockMtnMoMoSandboxAdapter();
    const orchestrator = new paymentOrchestrator_service_1.PaymentOrchestratorService({
        ledger,
        store,
        adapters: { MTN_MOMO: mockAdapter },
        eligibilityChecker: {
            async checkEligibility() {
                return { eligible: true, channelId: 'chan-evt-test' };
            },
        },
    });
    // 1. Initiate payout -> emits WITHDRAWAL_REQUESTED
    const payoutRes = await orchestrator.initiateCreatorPayout({
        userId: 'user-payout-creator',
        amountCents: 50000n,
        provider: 'MTN_MOMO',
        phoneNumber: '0788123456',
        idempotencyKey: 'payout-idem-001',
    });
    strict_1.default.equal(payoutRes.transaction.status, 'PENDING');
    const reqEvent = events.find((e) => e.eventType === 'WITHDRAWAL_REQUESTED');
    strict_1.default.ok(reqEvent, 'WITHDRAWAL_REQUESTED event must be emitted');
    strict_1.default.equal(reqEvent.amountCents, 50000n);
    strict_1.default.equal(reqEvent.channelId, 'chan-evt-test');
    // 2. Transition payout to PAID via status reconciliation -> emits WITHDRAWAL_DISPATCHED
    mockAdapter.setSimulatedStatus(payoutRes.transaction.providerReference, 'PAID');
    await orchestrator.reconcileTransaction(payoutRes.transaction.transactionId, {
        id: 'admin-user-id',
        role: 'SUPER_ADMIN',
    });
    const dispatchedEvent = events.find((e) => e.eventType === 'WITHDRAWAL_DISPATCHED');
    strict_1.default.ok(dispatchedEvent, 'WITHDRAWAL_DISPATCHED event must be emitted');
    strict_1.default.equal(dispatchedEvent.amountCents, 50000n);
    // 3. Initiate second payout and transition to FAILED -> emits WITHDRAWAL_FAILED
    const failPayout = await orchestrator.initiateCreatorPayout({
        userId: 'user-payout-creator',
        amountCents: 30000n,
        provider: 'MTN_MOMO',
        phoneNumber: '0788123456',
        idempotencyKey: 'payout-idem-002',
    });
    mockAdapter.setSimulatedStatus(failPayout.transaction.providerReference, 'FAILED', 'Subscriber account blocked');
    await orchestrator.reconcileTransaction(failPayout.transaction.transactionId, {
        id: 'admin-user-id',
        role: 'SUPER_ADMIN',
    });
    const failedEvent = events.find((e) => e.eventType === 'WITHDRAWAL_FAILED');
    strict_1.default.ok(failedEvent, 'WITHDRAWAL_FAILED event must be emitted');
    strict_1.default.equal(failedEvent.amountCents, 30000n);
    (0, financialEvents_1.clearFinancialNotificationListeners)();
});
