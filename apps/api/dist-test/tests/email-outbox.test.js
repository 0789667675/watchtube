"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const email_1 = require("../src/services/email");
(0, node_test_1.test)('EmailOutbox: durable enqueueing persists message as PENDING and enforces idempotency', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    const service = new email_1.EmailOutboxService(repo, transport);
    const key = 'wtpp-applied-chan-101';
    const res1 = await service.enqueueEmail({
        idempotencyKey: key,
        to: 'creator@example.com',
        subject: 'WTPP Application Received',
        text: 'We have received your application.',
    });
    strict_1.default.equal(res1.status, 'PENDING');
    strict_1.default.equal(res1.duplicate, false);
    // Repeat enqueue with identical idempotencyKey
    const res2 = await service.enqueueEmail({
        idempotencyKey: key,
        to: 'creator@example.com',
        subject: 'WTPP Application Received (Duplicate)',
        text: 'Duplicate payload',
    });
    strict_1.default.equal(res2.outboxId, res1.outboxId);
    strict_1.default.equal(res2.duplicate, true);
    const stats = await service.getHealthStats();
    strict_1.default.equal(stats.total, 1, 'Only one record should exist in outbox');
    strict_1.default.equal(stats.pending, 1);
});
(0, node_test_1.test)('EmailOutbox: claims pending jobs atomically and processes them to SENT via transport', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    const service = new email_1.EmailOutboxService(repo, transport);
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
    strict_1.default.equal(batchResult.claimed, 2);
    strict_1.default.equal(batchResult.sent, 2);
    strict_1.default.equal(batchResult.retried, 0);
    strict_1.default.equal(batchResult.failedPermanently, 0);
    const stats = await service.getHealthStats();
    strict_1.default.equal(stats.sent, 2);
    strict_1.default.equal(stats.pending, 0);
    const sentInTransport = transport.getSentEmails();
    strict_1.default.equal(sentInTransport.length, 2);
});
(0, node_test_1.test)('EmailOutbox: transient failure triggers retry with exponential backoff', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    transport.setSimulateFailure(true); // Transient failure
    const service = new email_1.EmailOutboxService(repo, transport);
    const res = await service.enqueueEmail({
        idempotencyKey: 'msg-transient-1',
        to: 'user@example.com',
        subject: 'Transient Test',
        text: 'Body',
    });
    const batchResult = await service.processPendingBatch(10);
    strict_1.default.equal(batchResult.claimed, 1);
    strict_1.default.equal(batchResult.sent, 0);
    strict_1.default.equal(batchResult.retried, 1);
    const stats = await service.getHealthStats();
    strict_1.default.equal(stats.retryableFailure, 1);
    strict_1.default.equal(stats.sent, 0);
    const job = await repo.findById(res.outboxId);
    strict_1.default.ok(job);
    strict_1.default.equal(job.status, 'RETRYABLE_FAILURE');
    strict_1.default.equal(job.attempts, 1);
    strict_1.default.ok(job.nextAttemptAt.getTime() > Date.now(), 'Next attempt must be set in the future');
});
(0, node_test_1.test)('EmailOutbox: permanent errors transition immediately to PERMANENT_FAILURE without retrying', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    const service = new email_1.EmailOutboxService(repo, transport);
    // 1. Malformed email address at enqueue
    const resMalformed = await service.enqueueEmail({
        idempotencyKey: 'bad-email-1',
        to: 'not-an-email-address',
        subject: 'Bad Email',
        text: 'Body',
    });
    strict_1.default.equal(resMalformed.status, 'PERMANENT_FAILURE');
    // 2. Transport rejects with 550 permanent mailbox error
    class PermanentFailureTransport extends email_1.MockEmailTransport {
        async sendEmail() {
            return {
                success: false,
                error: '550 5.1.1 User unknown or mailbox unavailable',
                timestamp: new Date(),
            };
        }
    }
    const permService = new email_1.EmailOutboxService(repo, new PermanentFailureTransport());
    const res550 = await permService.enqueueEmail({
        idempotencyKey: 'mailbox-not-found-1',
        to: 'ghost@example.com',
        subject: 'Ghost User',
        text: 'Body',
    });
    const batchResult = await permService.processPendingBatch(10);
    strict_1.default.equal(batchResult.failedPermanently, 1);
    const job = await repo.findById(res550.outboxId);
    strict_1.default.ok(job);
    strict_1.default.equal(job.status, 'PERMANENT_FAILURE');
    strict_1.default.equal(job.attempts, 1);
});
(0, node_test_1.test)('EmailOutbox: bounded retry stops at maxAttempts and allows admin manual retry', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    transport.setSimulateFailure(true);
    const service = new email_1.EmailOutboxService(repo, transport);
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
        strict_1.default.ok(job);
        await service.processJob(job);
    }
    const finalJob = await repo.findById(record.id);
    strict_1.default.ok(finalJob);
    strict_1.default.equal(finalJob.status, 'PERMANENT_FAILURE');
    strict_1.default.equal(finalJob.attempts, 3);
    // Admin manual retry
    const retrySuccess = await service.retryFailedJob(record.id);
    strict_1.default.equal(retrySuccess, true);
    const retriedJob = await repo.findById(record.id);
    strict_1.default.ok(retriedJob);
    strict_1.default.equal(retriedJob.status, 'PENDING');
    strict_1.default.equal(retriedJob.attempts, 0);
    strict_1.default.equal(retriedJob.lastError, null);
});
(0, node_test_1.test)('EmailOutbox: helper functions calculate backoff with jitter and detect permanent error codes', () => {
    strict_1.default.equal((0, email_1.isPermanentEmailError)('550 5.1.1 User unknown'), true);
    strict_1.default.equal((0, email_1.isPermanentEmailError)('Invalid recipient email syntax'), true);
    strict_1.default.equal((0, email_1.isPermanentEmailError)('Mailbox unavailable'), true);
    strict_1.default.equal((0, email_1.isPermanentEmailError)('ETIMEDOUT connection timeout'), false);
    strict_1.default.equal((0, email_1.isPermanentEmailError)('421 Service not available'), false);
    const b1 = (0, email_1.calculateBackoffWithJitter)(1, 1000, 30000);
    const b2 = (0, email_1.calculateBackoffWithJitter)(2, 1000, 30000);
    const b3 = (0, email_1.calculateBackoffWithJitter)(3, 1000, 30000);
    strict_1.default.ok(b1.getTime() > Date.now());
    strict_1.default.ok(b2.getTime() > b1.getTime() - 1000);
    strict_1.default.ok(b3.getTime() > b2.getTime() - 1000);
});
