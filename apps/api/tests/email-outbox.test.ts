import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EmailOutboxService,
  InMemoryEmailOutboxRepository,
  MockEmailTransport,
  calculateBackoffWithJitter,
  isPermanentEmailError,
} from '../src/services/email';

test('EmailOutbox: durable enqueueing persists message as PENDING and enforces idempotency', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  const service = new EmailOutboxService(repo, transport);

  const key = 'wtpp-applied-chan-101';
  const res1 = await service.enqueueEmail({
    idempotencyKey: key,
    to: 'creator@example.com',
    subject: 'WTPP Application Received',
    text: 'We have received your application.',
  });

  assert.equal(res1.status, 'PENDING');
  assert.equal(res1.duplicate, false);

  // Repeat enqueue with identical idempotencyKey
  const res2 = await service.enqueueEmail({
    idempotencyKey: key,
    to: 'creator@example.com',
    subject: 'WTPP Application Received (Duplicate)',
    text: 'Duplicate payload',
  });

  assert.equal(res2.outboxId, res1.outboxId);
  assert.equal(res2.duplicate, true);

  const stats = await service.getHealthStats();
  assert.equal(stats.total, 1, 'Only one record should exist in outbox');
  assert.equal(stats.pending, 1);
});

test('EmailOutbox: claims pending jobs atomically and processes them to SENT via transport', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  const service = new EmailOutboxService(repo, transport);

  await service.enqueueEmail({
    idempotencyKey: 'msg-payout-1',
    to: 'creator1@example.com',
    subject: 'Payout 1',
    text: 'Payout 1 text',
  });
  await service.enqueueEmail({
    idempotencyKey: 'msg-payout-2',
    to: 'creator2@example.com',
    subject: 'Payout 2',
    text: 'Payout 2 text',
  });

  const batchResult = await service.processPendingBatch(10);
  assert.equal(batchResult.claimed, 2);
  assert.equal(batchResult.sent, 2);
  assert.equal(batchResult.retried, 0);
  assert.equal(batchResult.failedPermanently, 0);

  const stats = await service.getHealthStats();
  assert.equal(stats.sent, 2);
  assert.equal(stats.pending, 0);

  const sentInTransport = transport.getSentEmails();
  assert.equal(sentInTransport.length, 2);
});

test('EmailOutbox: transient failure triggers retry with exponential backoff', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  transport.setSimulateFailure(true); // Transient failure
  const service = new EmailOutboxService(repo, transport);

  const res = await service.enqueueEmail({
    idempotencyKey: 'msg-transient-1',
    to: 'user@example.com',
    subject: 'Transient Test',
    text: 'Body',
  });

  const batchResult = await service.processPendingBatch(10);
  assert.equal(batchResult.claimed, 1);
  assert.equal(batchResult.sent, 0);
  assert.equal(batchResult.retried, 1);

  const stats = await service.getHealthStats();
  assert.equal(stats.retryableFailure, 1);
  assert.equal(stats.sent, 0);

  const job = await repo.findById(res.outboxId);
  assert.ok(job);
  assert.equal(job.status, 'RETRYABLE_FAILURE');
  assert.equal(job.attempts, 1);
  assert.ok(job.nextAttemptAt.getTime() > Date.now(), 'Next attempt must be set in the future');
});

test('EmailOutbox: permanent errors transition immediately to PERMANENT_FAILURE without retrying', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  const service = new EmailOutboxService(repo, transport);

  // 1. Malformed email address at enqueue
  const resMalformed = await service.enqueueEmail({
    idempotencyKey: 'bad-email-1',
    to: 'not-an-email-address',
    subject: 'Bad Email',
    text: 'Body',
  });
  assert.equal(resMalformed.status, 'PERMANENT_FAILURE');

  // 2. Transport rejects with 550 permanent mailbox error
  class PermanentFailureTransport extends MockEmailTransport {
    async sendEmail() {
      return {
        success: false,
        error: '550 5.1.1 User unknown or mailbox unavailable',
        timestamp: new Date(),
      };
    }
  }

  const permService = new EmailOutboxService(repo, new PermanentFailureTransport());
  const res550 = await permService.enqueueEmail({
    idempotencyKey: 'mailbox-not-found-1',
    to: 'ghost@example.com',
    subject: 'Ghost User',
    text: 'Body',
  });

  const batchResult = await permService.processPendingBatch(10);
  assert.equal(batchResult.failedPermanently, 1);

  const job = await repo.findById(res550.outboxId);
  assert.ok(job);
  assert.equal(job.status, 'PERMANENT_FAILURE');
  assert.equal(job.attempts, 1);
});

test('EmailOutbox: bounded retry stops at maxAttempts and allows admin manual retry', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  transport.setSimulateFailure(true);
  const service = new EmailOutboxService(repo, transport);

  const { record } = await repo.enqueue({
    idempotencyKey: 'bounded-retry-1',
    to: 'user@example.com',
    subject: 'Bounded Test',
    text: 'Body',
    maxAttempts: 3,
  });

  // Simulate 3 failures
  for (let i = 0; i < 3; i++) {
    const job = await repo.findById(record.id);
    assert.ok(job);
    await service.processJob(job);
  }

  const finalJob = await repo.findById(record.id);
  assert.ok(finalJob);
  assert.equal(finalJob.status, 'PERMANENT_FAILURE');
  assert.equal(finalJob.attempts, 3);

  // Admin manual retry
  const retrySuccess = await service.retryFailedJob(record.id);
  assert.equal(retrySuccess, true);

  const retriedJob = await repo.findById(record.id);
  assert.ok(retriedJob);
  assert.equal(retriedJob.status, 'PENDING');
  assert.equal(retriedJob.attempts, 0);
  assert.equal(retriedJob.lastError, null);
});

test('EmailOutbox: helper functions calculate backoff with jitter and detect permanent error codes', () => {
  assert.equal(isPermanentEmailError('550 5.1.1 User unknown'), true);
  assert.equal(isPermanentEmailError('Invalid recipient email syntax'), true);
  assert.equal(isPermanentEmailError('Mailbox unavailable'), true);
  assert.equal(isPermanentEmailError('ETIMEDOUT connection timeout'), false);
  assert.equal(isPermanentEmailError('421 Service not available'), false);

  const b1 = calculateBackoffWithJitter(1, 1000, 30000);
  const b2 = calculateBackoffWithJitter(2, 1000, 30000);
  const b3 = calculateBackoffWithJitter(3, 1000, 30000);

  assert.ok(b1.getTime() > Date.now());
  assert.ok(b2.getTime() > b1.getTime() - 1000);
  assert.ok(b3.getTime() > b2.getTime() - 1000);
});
