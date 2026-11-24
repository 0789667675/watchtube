import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import {
  FinancialNotificationEvent,
  IFinancialNotificationListener,
  registerFinancialNotificationListener,
  clearFinancialNotificationListeners,
  emitFinancialNotificationEvent,
} from '../src/services/finance/financialEvents';
import { LEDGER_CURRENCY } from '../src/services/finance/ledger.service';
import { PaymentOrchestratorService } from '../src/services/payments/paymentOrchestrator.service';
import { InMemoryWalletLedgerRepository, WalletLedgerService } from '../src/services/finance/ledger.service';
import { InMemoryPaymentTransactionStore } from '../src/services/payments/paymentStore';
import { MockMtnMoMoSandboxAdapter } from '../src/services/payments/mockAdapters';

test('Financial Events: Listener registration, event delivery, and deregistration', async () => {
  clearFinancialNotificationListeners();
  const received: FinancialNotificationEvent[] = [];

  const listener: IFinancialNotificationListener = {
    onFinancialEvent(event) {
      received.push(event);
    },
  };

  const unsubscribe = registerFinancialNotificationListener(listener);

  const testEvent: FinancialNotificationEvent = {
    eventId: crypto.randomUUID(),
    eventType: 'PAYMENT_RECEIVED',
    transactionId: 'tx-1001',
    channelId: 'chan-001',
    creatorUserId: 'user-001',
    amountCents: 50000n,
    currency: LEDGER_CURRENCY,
    provider: 'MTN_MOMO',
    providerReference: 'momo-ref-123',
    timestamp: new Date(),
  };

  await emitFinancialNotificationEvent(testEvent);
  assert.equal(received.length, 1);
  assert.equal(received[0].eventType, 'PAYMENT_RECEIVED');
  assert.equal(received[0].amountCents, 50000n);

  // Deregister listener
  unsubscribe();
  await emitFinancialNotificationEvent(testEvent);
  assert.equal(received.length, 1, 'Deregistered listener must not receive further events');
});

test('Financial Events: Fail-safe isolation ensures broken listeners do not throw', async () => {
  clearFinancialNotificationListeners();
  const healthyReceived: FinancialNotificationEvent[] = [];

  // Broken sync listener
  registerFinancialNotificationListener({
    onFinancialEvent() {
      throw new Error('Sync catastrophe in notification listener');
    },
  });

  // Broken async listener
  registerFinancialNotificationListener({
    async onFinancialEvent() {
      await Promise.resolve();
      throw new Error('Async rejection in notification listener');
    },
  });

  // Healthy listener
  registerFinancialNotificationListener({
    onFinancialEvent(event) {
      healthyReceived.push(event);
    },
  });

  const event: FinancialNotificationEvent = {
    eventId: crypto.randomUUID(),
    eventType: 'WITHDRAWAL_REQUESTED',
    payoutId: 'payout-1002',
    channelId: 'chan-002',
    creatorUserId: 'user-002',
    amountCents: 150000n,
    currency: LEDGER_CURRENCY,
    provider: 'AIRTEL_MONEY',
    recipientPhoneMasked: '25073****001',
    idempotencyKey: 'idem-withdrawal-1',
    timestamp: new Date(),
  };

  // Must NOT throw despite broken listeners
  await assert.doesNotReject(async () => {
    await emitFinancialNotificationEvent(event);
  });

  assert.equal(healthyReceived.length, 1);
  assert.equal(healthyReceived[0].eventType, 'WITHDRAWAL_REQUESTED');
  clearFinancialNotificationListeners();
});

test('Financial Events: PaymentOrchestrator emits financial events on payout lifecycle', async () => {
  clearFinancialNotificationListeners();
  const events: FinancialNotificationEvent[] = [];

  registerFinancialNotificationListener({
    onFinancialEvent(evt) {
      events.push(evt);
    },
  });

  const ledgerRepo = new InMemoryWalletLedgerRepository();
  const ledger = new WalletLedgerService(ledgerRepo);
  const store = new InMemoryPaymentTransactionStore();

  // Credit channel with funds first
  await ledger.creditRevenue({
    channelId: 'chan-evt-test',
    amountCents: 200000n,
    referenceId: 'ref-initial-credit',
    status: 'AVAILABLE',
  });

  const mockAdapter = new MockMtnMoMoSandboxAdapter();

  const orchestrator = new PaymentOrchestratorService({
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

  assert.equal(payoutRes.transaction.status, 'PENDING');
  const reqEvent = events.find((e) => e.eventType === 'WITHDRAWAL_REQUESTED');
  assert.ok(reqEvent, 'WITHDRAWAL_REQUESTED event must be emitted');
  assert.equal(reqEvent.amountCents, 50000n);
  assert.equal(reqEvent.channelId, 'chan-evt-test');

  // 2. Transition payout to PAID via status reconciliation -> emits WITHDRAWAL_DISPATCHED
  mockAdapter.setSimulatedStatus(payoutRes.transaction.providerReference, 'PAID');
  await orchestrator.reconcileTransaction(payoutRes.transaction.transactionId, {
    id: 'admin-user-id',
    role: 'SUPER_ADMIN',
  });

  const dispatchedEvent = events.find((e) => e.eventType === 'WITHDRAWAL_DISPATCHED');
  assert.ok(dispatchedEvent, 'WITHDRAWAL_DISPATCHED event must be emitted');
  assert.equal(dispatchedEvent.amountCents, 50000n);

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
  assert.ok(failedEvent, 'WITHDRAWAL_FAILED event must be emitted');
  assert.equal(failedEvent.amountCents, 30000n);

  clearFinancialNotificationListeners();
});
