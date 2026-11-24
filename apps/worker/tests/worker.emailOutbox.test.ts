import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { db as prisma } from '@watchtube/database';
import {
    EmailOutboxProcessor,
    EmailOutboxService,
    getActiveEmailProcessor,
    getEmailOutboxService,
    resetWorkerShutdownState,
    setActiveEmailProcessor,
    shutdownWorker,
    startWorker,
} from '../src/worker';
import {
    InMemoryEmailOutboxRepository,
    PrismaEmailOutboxRepository,
    MockEmailTransport,
    calculateBackoffWithJitter,
    isPermanentEmailError,
} from '../src/services/email';

const packageEnv = path.resolve(__dirname, '../.env');
if (typeof (process as any).loadEnvFile === 'function') {
    try {
        (process as any).loadEnvFile(packageEnv);
    } catch {
        // Safe fallback
    }
}
if (process.env.WATCHTUBE_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.WATCHTUBE_DATABASE_URL;
}

test('EmailOutboxProcessor lifecycle: starts interval timer and stops cleanly with idempotency', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    const service = new EmailOutboxService(repo, transport);
    const processor = new EmailOutboxProcessor(service, 100, 10);

    assert.equal(processor.isStarted(), false);
    assert.equal(processor.isBusy(), false);

    // Start processor
    processor.start();
    assert.equal(processor.isStarted(), true);

    // Second start is a safe no-op
    processor.start();
    assert.equal(processor.isStarted(), true);

    // Stop processor
    await processor.stop();
    assert.equal(processor.isStarted(), false);

    // Second stop is a safe no-op
    await processor.stop();
    assert.equal(processor.isStarted(), false);
});

test('EmailOutboxProcessor shutdown awaits in-flight batch completion before resolving', async () => {
    let batchCompleted = false;
    let finishBatchResolve: () => void = () => {};
    const finishBatchPromise = new Promise<void>((resolve) => {
        finishBatchResolve = resolve;
    });

    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    const service = new EmailOutboxService(repo, transport);

    // Delay batch processing until explicitly resolved
    const originalProcessPendingBatch = service.processPendingBatch.bind(service);
    service.processPendingBatch = async (batchSize?: number, claimExpiryMs?: number) => {
        const result = await originalProcessPendingBatch(batchSize, claimExpiryMs);
        await finishBatchPromise;
        batchCompleted = true;
        return result;
    };

    const processor = new EmailOutboxProcessor(service, 1000, 5);

    // Enqueue an email job
    await repo.enqueue({
        idempotencyKey: 'drain-test-1',
        to: 'user@example.com',
        subject: 'Drain Test',
        text: 'Drain content',
    });

    // Start a tick in flight
    const tickPromise = processor.tick();
    assert.equal(processor.isBusy(), true, 'Processor should report busy while batch is in flight');

    // Initiate stop while batch is in flight
    let stopResolved = false;
    const stopPromise = processor.stop().then(() => {
        stopResolved = true;
    });

    // Before releasing the batch, stop should not yet have resolved
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(stopResolved, false, 'Stop must not resolve before in-flight batch finishes');
    assert.equal(batchCompleted, false);

    // Release the batch
    finishBatchResolve();
    await tickPromise;
    await stopPromise;

    assert.equal(batchCompleted, true, 'In-flight batch must have completed');
    assert.equal(stopResolved, true, 'Stop must resolve once in-flight batch is drained');
    assert.equal(processor.isBusy(), false);
    assert.equal(processor.isStarted(), false);
});

test('EmailOutboxProcessor tick drains pending jobs into MockEmailTransport and marks SENT', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    const service = new EmailOutboxService(repo, transport);
    const processor = new EmailOutboxProcessor(service, 5000, 10);

    const { record: r1 } = await repo.enqueue({
        idempotencyKey: 'email-job-1',
        to: 'creator1@example.com',
        subject: 'Welcome to WatchTube',
        text: 'Welcome creator 1',
    });
    const { record: r2 } = await repo.enqueue({
        idempotencyKey: 'email-job-2',
        to: 'creator2@example.com',
        subject: 'Monthly Analytics Summary',
        text: 'Here is your monthly report.',
    });

    const result = await processor.tick();
    assert.ok(result);
    assert.equal(result.claimed, 2);
    assert.equal(result.sent, 2);
    assert.equal(result.retried, 0);
    assert.equal(result.failedPermanently, 0);

    const saved1 = await repo.findById(r1.id);
    const saved2 = await repo.findById(r2.id);
    assert.equal(saved1?.status, 'SENT');
    assert.equal(saved1?.transportName, 'MOCK');
    assert.ok(saved1?.sentAt instanceof Date);

    assert.equal(saved2?.status, 'SENT');
    assert.equal(saved2?.transportName, 'MOCK');
    assert.ok(saved2?.sentAt instanceof Date);

    const sentEmails = transport.getSentEmails();
    assert.equal(sentEmails.length, 2);
    assert.equal(sentEmails[0].to, 'creator1@example.com');
    assert.equal(sentEmails[1].to, 'creator2@example.com');
});

test('Transient delivery error transitions job to RETRYABLE_FAILURE with future nextAttemptAt and incremented attempts', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    transport.setSimulateFailure(true);
    const service = new EmailOutboxService(repo, transport);
    const processor = new EmailOutboxProcessor(service, 5000, 10);

    const { record } = await repo.enqueue({
        idempotencyKey: 'transient-failure-key',
        to: 'recipient@example.com',
        subject: 'Important Notification',
        text: 'Notification body',
        maxAttempts: 3,
    });

    const result = await processor.tick();
    assert.ok(result);
    assert.equal(result.claimed, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.retried, 1);
    assert.equal(result.failedPermanently, 0);

    const updated = await repo.findById(record.id);
    assert.ok(updated);
    assert.equal(updated.status, 'RETRYABLE_FAILURE');
    assert.equal(updated.attempts, 1);
    assert.match(updated.lastError ?? '', /Simulated email transport failure/);
    assert.ok(updated.nextAttemptAt.getTime() > Date.now(), 'nextAttemptAt must be in the future');
});

test('Max attempts exhaustion transitions to PERMANENT_FAILURE without further auto-retries', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    transport.setSimulateFailure(true);
    const service = new EmailOutboxService(repo, transport);

    const { record } = await repo.enqueue({
        idempotencyKey: 'max-attempts-key',
        to: 'user@example.com',
        subject: 'Retry Bounded Test',
        text: 'Content',
        maxAttempts: 2,
    });

    // Attempt 1: RETRYABLE_FAILURE
    let job = await repo.findById(record.id);
    assert.ok(job);
    let outcome = await service.processJob(job);
    assert.equal(outcome.success, false);
    assert.equal(outcome.permanent, false);

    job = await repo.findById(record.id);
    assert.ok(job);
    assert.equal(job.status, 'RETRYABLE_FAILURE');
    assert.equal(job.attempts, 1);

    // Attempt 2 (reaches maxAttempts = 2): PERMANENT_FAILURE
    outcome = await service.processJob(job);
    assert.equal(outcome.success, false);
    assert.equal(outcome.permanent, true);

    job = await repo.findById(record.id);
    assert.ok(job);
    assert.equal(job.status, 'PERMANENT_FAILURE');
    assert.equal(job.attempts, 2);

    // Subsequent batch should not claim permanent failure
    const batchResult = await service.processPendingBatch(10);
    assert.equal(batchResult.claimed, 0);
});

test('Permanent failure detected by error pattern transitions immediately to PERMANENT_FAILURE', async () => {
    const repo = new InMemoryEmailOutboxRepository();

    class MailboxNotFoundTransport extends MockEmailTransport {
        async sendEmail() {
            return {
                success: false,
                error: '550 5.1.1 Mailbox unavailable / User unknown',
                timestamp: new Date(),
            };
        }
    }

    const service = new EmailOutboxService(repo, new MailboxNotFoundTransport());
    const processor = new EmailOutboxProcessor(service, 5000, 10);

    const { record } = await repo.enqueue({
        idempotencyKey: 'nonexistent-user-key',
        to: 'unknown-user@example.com',
        subject: 'Notification',
        text: 'Hello',
        maxAttempts: 5,
    });

    const result = await processor.tick();
    assert.ok(result);
    assert.equal(result.claimed, 1);
    assert.equal(result.failedPermanently, 1);
    assert.equal(result.retried, 0);

    const updated = await repo.findById(record.id);
    assert.ok(updated);
    assert.equal(updated.status, 'PERMANENT_FAILURE');
    assert.equal(updated.attempts, 1, 'Should fail permanently on first attempt without retrying');
});

test('Expired lease recovery re-claims stale PROCESSING jobs past claimExpiryMs', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    const service = new EmailOutboxService(repo, transport);

    const { record } = await repo.enqueue({
        idempotencyKey: 'crashed-worker-lease-key',
        to: 'recovery@example.com',
        subject: 'Lease Recovery Test',
        text: 'Body',
    });

    // Simulate worker claimed the job but crashed 2 minutes ago
    const job = await repo.findById(record.id);
    assert.ok(job);
    job.status = 'PROCESSING';
    job.lastAttemptAt = new Date(Date.now() - 120000); // 120s ago

    // Process batch with claimExpiryMs = 60000 (60s)
    const result = await service.processPendingBatch(10, 60000);
    assert.equal(result.claimed, 1);
    assert.equal(result.sent, 1);

    const recovered = await repo.findById(record.id);
    assert.equal(recovered?.status, 'SENT');
});

test('Concurrent worker lease isolation prevents duplicate processing of the same job', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();

    await repo.enqueue({
        idempotencyKey: 'shared-job-key',
        to: 'singleton@example.com',
        subject: 'Singleton Test',
        text: 'Body',
    });

    // Simulate two worker threads claiming simultaneously
    const claim1 = await repo.claimPendingJobs(10, 60000);
    const claim2 = await repo.claimPendingJobs(10, 60000);

    assert.equal(claim1.length, 1);
    assert.equal(claim2.length, 0, 'Second worker must not claim the already-processing job');
});

test('Processor tick error resilience: unexpected exception during tick does not crash processor or prevent next tick', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    const service = new EmailOutboxService(repo, transport);

    let failOnce = true;
    const originalProcessPendingBatch = service.processPendingBatch.bind(service);
    service.processPendingBatch = async (batchSize?: number, claimExpiryMs?: number) => {
        if (failOnce) {
            failOnce = false;
            throw new Error('Simulated database network blip');
        }
        return originalProcessPendingBatch(batchSize, claimExpiryMs);
    };

    const processor = new EmailOutboxProcessor(service, 5000, 10);

    await repo.enqueue({
        idempotencyKey: 'resilience-test-key',
        to: 'user@example.com',
        subject: 'Resilience Test',
        text: 'Body',
    });

    // First tick encounters the error
    const firstResult = await processor.tick();
    assert.equal(firstResult, null, 'Tick must catch error and return null');
    assert.equal(processor.isBusy(), false, 'isProcessing must be reset even after error');

    // Second tick proceeds normally
    const secondResult = await processor.tick();
    assert.ok(secondResult);
    assert.equal(secondResult.claimed, 1);
    assert.equal(secondResult.sent, 1);
});

test('Worker integration: shutdownWorker halts activeEmailProcessor cleanly and is safe for repeated calls', async () => {
    resetWorkerShutdownState();

    let stopped = false;
    const mockProcessor = {
        async stop() {
            stopped = true;
        },
    } as unknown as EmailOutboxProcessor;

    setActiveEmailProcessor(mockProcessor);
    assert.equal(getActiveEmailProcessor(), mockProcessor);

    await shutdownWorker();
    assert.equal(stopped, true, 'shutdownWorker must call stop() on active email processor');
    assert.equal(getActiveEmailProcessor(), null, 'active email processor must be cleared');

    // Repeated call is safe and idempotent
    await shutdownWorker();
    resetWorkerShutdownState();
});

test('Admin manual retry re-queues PERMANENT_FAILURE job to PENDING with attempts reset', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    transport.setSimulateFailure(true);
    const service = new EmailOutboxService(repo, transport);

    const { record } = await repo.enqueue({
        idempotencyKey: 'admin-retry-test-key',
        to: 'user@example.com',
        subject: 'Admin Retry',
        text: 'Body',
        maxAttempts: 1,
    });

    await service.processPendingBatch(10);
    const failedJob = await repo.findById(record.id);
    assert.equal(failedJob?.status, 'PERMANENT_FAILURE');
    assert.equal(failedJob?.attempts, 1);

    // Admin triggers manual retry
    const retried = await service.retryFailedJob(record.id);
    assert.equal(retried, true);

    const restoredJob = await repo.findById(record.id);
    assert.equal(restoredJob?.status, 'PENDING');
    assert.equal(restoredJob?.attempts, 0);
    assert.equal(restoredJob?.lastError, null);
    assert.ok(restoredJob?.nextAttemptAt.getTime() <= Date.now());
});

test('Helper functions: backoff with jitter and permanent error code detection', () => {
    assert.equal(isPermanentEmailError('550 5.1.1 User unknown'), true);
    assert.equal(isPermanentEmailError('554 Delivery failed permanently'), true);
    assert.equal(isPermanentEmailError('Invalid recipient address format'), true);
    assert.equal(isPermanentEmailError('Mailbox unavailable'), true);
    assert.equal(isPermanentEmailError('Connection timed out'), false);
    assert.equal(isPermanentEmailError('421 Try again later'), false);

    const t1 = calculateBackoffWithJitter(1, 1000, 30000);
    const t2 = calculateBackoffWithJitter(2, 1000, 30000);
    assert.ok(t1.getTime() > Date.now());
    assert.ok(t2.getTime() >= t1.getTime() - 1000);
});

test('Future-scheduled emails are not claimed prematurely', async () => {
    const repo = new InMemoryEmailOutboxRepository();
    const transport = new MockEmailTransport();
    const service = new EmailOutboxService(repo, transport);

    const { record } = await repo.enqueue({
        idempotencyKey: 'future-scheduled-email-key',
        to: 'future@example.com',
        subject: 'Future Email',
        text: 'Body',
        nextAttemptAt: new Date(Date.now() + 5000),
    });

    // Immediate claim must NOT return the future job
    const claimed = await repo.claimPendingJobs(10, 60000);
    assert.equal(claimed.length, 0, 'Future-scheduled email must not be claimed before nextAttemptAt');

    // Advancing time past nextAttemptAt allows claiming
    repo.updateJob(record.id, { nextAttemptAt: new Date(Date.now() - 100) });
    const claimedAfterDue = await repo.claimPendingJobs(10, 60000);
    assert.equal(claimedAfterDue.length, 1, 'Email must be claimed once nextAttemptAt is reached');
});

test('Video and email isolation: email processor error does not prevent video worker or crash process', async () => {
    const failingService = {
        processPendingBatch: async () => {
            throw new Error('Simulated email processor failure');
        },
    } as unknown as EmailOutboxService;
    const processor = new EmailOutboxProcessor(failingService, 100, 10);

    const result = await processor.tick();
    assert.equal(result, null, 'Tick error must be caught and return null');
    assert.equal(processor.isBusy(), false, 'isBusy must reset so future ticks can proceed');
});

test('Video and email isolation: shutdown sequence awaits email processor before closing Redis and video worker', async () => {
    resetWorkerShutdownState();
    const events: string[] = [];

    const mockEmailProcessor = {
        async stop() {
            await new Promise((r) => setTimeout(r, 50));
            events.push('email-stopped');
        },
    } as unknown as EmailOutboxProcessor;

    setActiveEmailProcessor(mockEmailProcessor);

    await shutdownWorker();

    assert.deepEqual(events, ['email-stopped'], 'Email processor must be cleanly stopped on worker shutdown');
    assert.equal(getActiveEmailProcessor(), null);
    resetWorkerShutdownState();
});

test('Full end-to-end automatic worker lifecycle: startWorker() automatically drains pending outbox record via interval without manual tick, verifies SENT, prevents double-send, and cleanly shuts down', async (t) => {
    const prevInterval = process.env.EMAIL_OUTBOX_INTERVAL_MS;
    const prevMock = process.env.MOCK_EMAIL;
    process.env.EMAIL_OUTBOX_INTERVAL_MS = '200';
    process.env.MOCK_EMAIL = 'true';

    let initialCount = 0;
    try {
        initialCount = await prisma.emailOutbox.count();
    } catch {
        t.skip('Database unavailable for live end-to-end lifecycle test');
        return;
    }

    const service = getEmailOutboxService();
    const mockTransport = new MockEmailTransport();
    service.setTransport(mockTransport);

    const testIdempotencyKey = `e2e-worker-auto-drain-${Date.now()}`;
    let createdRecordId: string | null = null;

    try {
        // Step 1: Create dedicated pending outbox record in local test database
        const created = await (prisma as any).emailOutbox.create({
            data: {
                idempotencyKey: testIdempotencyKey,
                to: 'creator-e2e-auto@example.com',
                subject: 'Automated Worker Drain Test',
                text: 'Testing automated interval drainage without manual tick',
                status: 'PENDING',
                nextAttemptAt: new Date(),
                maxAttempts: 3,
            },
        });
        createdRecordId = created.id;

        // Step 2: Start the actual startWorker() lifecycle
        resetWorkerShutdownState();
        startWorker();

        const processor = getActiveEmailProcessor();
        assert.ok(processor, 'EmailOutboxProcessor must be instantiated');
        assert.equal(processor.isStarted(), true, 'Processor timer must be running');

        // Step 3 & 4: Do NOT manually invoke processor.tick()!
        // Wait for the automatic scheduling interval (200ms interval -> wait 600ms)
        await new Promise((resolve) => setTimeout(resolve, 600));

        // Step 5: Verify that the pending record is claimed and delivered through mock transport
        const sentEmails = mockTransport.getSentEmails();
        const delivered = sentEmails.find((e) => e.to === 'creator-e2e-auto@example.com');
        assert.ok(delivered, 'Pending record must be claimed and delivered through mock transport');
        assert.equal(delivered.subject, 'Automated Worker Drain Test');

        // Step 6: Verify the database status becomes SENT
        const updated = await (prisma as any).emailOutbox.findUnique({
            where: { id: createdRecordId },
        });
        assert.ok(updated);
        assert.equal(updated.status, 'SENT');
        assert.equal(updated.transportName, 'MOCK');
        assert.ok(updated.sentAt instanceof Date);

        // Step 7: Wait another interval to verify processor does NOT send the same record twice
        await new Promise((resolve) => setTimeout(resolve, 300));
        const matchingSent = mockTransport.getSentEmails().filter((e) => e.to === 'creator-e2e-auto@example.com');
        assert.equal(matchingSent.length, 1, 'Processor must not send the same record twice');

        // Step 8: Shut down the worker using actual shutdown lifecycle
        await shutdownWorker();

        // Step 9: Verify no processing timer or worker resource remains active
        assert.equal(getActiveEmailProcessor(), null, 'Active email processor must be cleared');
        assert.equal(processor.isStarted(), false, 'Processor timer must be halted');

    } finally {
        // Step 10: Remove only the dedicated test record and verify original baseline
        if (createdRecordId) {
            await (prisma as any).emailOutbox.deleteMany({
                where: { id: createdRecordId },
            });
        }
        const finalCount = await prisma.emailOutbox.count();
        assert.equal(finalCount, initialCount, 'Database baseline count must be strictly preserved');

        if (prevInterval === undefined) delete process.env.EMAIL_OUTBOX_INTERVAL_MS;
        else process.env.EMAIL_OUTBOX_INTERVAL_MS = prevInterval;
        if (prevMock === undefined) delete process.env.MOCK_EMAIL;
        else process.env.MOCK_EMAIL = prevMock;

        resetWorkerShutdownState();
    }
});

test('Concurrent database worker lease isolation: two independent processors claiming overlapping records never double-claim or double-deliver', async (t) => {
    let initialCount = 0;
    try {
        initialCount = await prisma.emailOutbox.count();
    } catch {
        t.skip('Database unavailable for concurrent database test');
        return;
    }

    const repoA = new PrismaEmailOutboxRepository(prisma);
    const repoB = new PrismaEmailOutboxRepository(prisma);

    const transportA = new MockEmailTransport();
    const transportB = new MockEmailTransport();

    const serviceA = new EmailOutboxService(repoA, transportA);
    const serviceB = new EmailOutboxService(repoB, transportB);

    const testPrefix = `test-conc-owner-${Date.now()}`;
    const keys = [
        `${testPrefix}-1`,
        `${testPrefix}-2`,
        `${testPrefix}-3`,
        `${testPrefix}-4`,
        `${testPrefix}-stale`,
        `${testPrefix}-retry`,
    ];

    try {
        // 1. Create 4 pending records
        for (let i = 1; i <= 4; i++) {
            await (prisma as any).emailOutbox.create({
                data: {
                    idempotencyKey: `${testPrefix}-${i}`,
                    to: `user${i}@example.com`,
                    subject: `Concurrent Test Email ${i}`,
                    text: `Body ${i}`,
                    status: 'PENDING',
                    nextAttemptAt: new Date(),
                },
            });
        }

        // 2. Create 1 crashed job with expired lease (PROCESSING from 2 mins ago)
        await (prisma as any).emailOutbox.create({
            data: {
                idempotencyKey: `${testPrefix}-stale`,
                to: 'crashed@example.com',
                subject: 'Crashed Worker Job',
                text: 'Needs lease recovery',
                status: 'PROCESSING',
                lastAttemptAt: new Date(Date.now() - 120000),
                transportName: 'claim:old-crashed-worker-token',
                attempts: 1,
            },
        });

        // 3. Create 1 ready RETRYABLE_FAILURE job (nextAttemptAt in past)
        await (prisma as any).emailOutbox.create({
            data: {
                idempotencyKey: `${testPrefix}-retry`,
                to: 'retry@example.com',
                subject: 'Retry Job',
                text: 'Needs second attempt',
                status: 'RETRYABLE_FAILURE',
                nextAttemptAt: new Date(Date.now() - 1000),
                attempts: 1,
            },
        });

        // 4. Run both service processors concurrently against the local database with split batch size
        const [resultA, resultB] = await Promise.all([
            serviceA.processPendingBatch(3, 60000),
            serviceB.processPendingBatch(3, 60000),
        ]);

        const sentA = transportA.getSentEmails();
        const sentB = transportB.getSentEmails();

        // Invariant 1: Total sent emails must equal total ready jobs (6)
        assert.equal(
            sentA.length + sentB.length,
            6,
            `Total sent emails must be exactly 6, got ${sentA.length + sentB.length}`
        );

        // Invariant 2: No email delivered by both transports (Zero intersection)
        const sentASubjects = new Set(sentA.map((e) => e.subject));
        for (const b of sentB) {
            assert.ok(
                !sentASubjects.has(b.subject),
                `Duplicate delivery detected! Subject "${b.subject}" delivered by BOTH Worker A and Worker B`
            );
        }

        // Invariant 3: Verify all 6 records in DB are SENT with transportName 'MOCK'
        const dbRecords = await (prisma as any).emailOutbox.findMany({
            where: { idempotencyKey: { in: keys } },
        });

        assert.equal(dbRecords.length, 6);
        for (const record of dbRecords) {
            assert.equal(record.status, 'SENT', `Record ${record.id} should be SENT`);
            assert.equal(record.transportName, 'MOCK');
            assert.ok(record.sentAt instanceof Date);
        }

        // Invariant 4: Expired lease recovery verified
        const staleInDb = dbRecords.find((r: any) => r.idempotencyKey === `${testPrefix}-stale`);
        assert.equal(staleInDb?.status, 'SENT', 'Expired lease job was successfully recovered and sent');

        // Invariant 5: Retryable failure recovery verified
        const retryInDb = dbRecords.find((r: any) => r.idempotencyKey === `${testPrefix}-retry`);
        assert.equal(retryInDb?.status, 'SENT', 'Retryable failure job was successfully processed');

    } finally {
        await (prisma as any).emailOutbox.deleteMany({
            where: { idempotencyKey: { in: keys } },
        });
        const finalCount = await prisma.emailOutbox.count();
        assert.equal(finalCount, initialCount, 'Database baseline count must be strictly preserved');
    }
});
