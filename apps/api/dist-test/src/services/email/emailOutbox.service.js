"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailOutboxProcessor = exports.EmailOutboxService = void 0;
exports.isPermanentEmailError = isPermanentEmailError;
exports.calculateBackoffWithJitter = calculateBackoffWithJitter;
exports.getEmailOutboxService = getEmailOutboxService;
exports.setEmailOutboxService = setEmailOutboxService;
const transports_1 = require("./transports");
const outboxRepository_1 = require("./outboxRepository");
function isPermanentEmailError(errorMessage) {
    const lower = errorMessage.toLowerCase();
    return (lower.includes('invalid recipient') ||
        lower.includes('invalid email') ||
        lower.includes('mailbox unavailable') ||
        lower.includes('user not found') ||
        lower.includes('550 ') ||
        lower.includes('551 ') ||
        lower.includes('553 ') ||
        lower.includes('554 ') ||
        lower.includes('syntax error') ||
        lower.includes('no recipient'));
}
function calculateBackoffWithJitter(attempts, baseMs = 2000, maxMs = 300000) {
    const exponent = Math.max(0, Math.min(attempts - 1, 10));
    const backoff = Math.min(maxMs, baseMs * Math.pow(2, exponent));
    const jitter = Math.floor(Math.random() * 1000);
    return new Date(Date.now() + backoff + jitter);
}
class EmailOutboxService {
    repository;
    transport;
    constructor(repository = new outboxRepository_1.PrismaEmailOutboxRepository(), transport = (0, transports_1.resolveDefaultEmailTransport)()) {
        this.repository = repository;
        this.transport = transport;
    }
    setTransport(transport) {
        this.transport = transport;
    }
    getTransport() {
        return this.transport;
    }
    getRepository() {
        return this.repository;
    }
    /**
     * Enqueues an outgoing email job durably.
     * Guaranteed idempotent by unique idempotencyKey.
     */
    async enqueueEmail(input) {
        const to = input.to?.trim();
        const isMalformed = !to || !to.includes('@') || to.startsWith('@') || to.endsWith('@');
        const { record, duplicate } = await this.repository.enqueue({
            ...input,
            to: to || input.to,
        });
        if (isMalformed && !duplicate) {
            await this.repository.markPermanentFailure(record.id, `Permanent failure: invalid email address "${input.to}"`, 1);
            return { outboxId: record.id, status: 'PERMANENT_FAILURE', duplicate: false };
        }
        return { outboxId: record.id, status: record.status, duplicate };
    }
    /**
     * Processes a single claimed outbox job via the active transport.
     */
    async processJob(job) {
        const newAttempts = job.attempts + 1;
        try {
            const result = await this.transport.sendEmail({
                to: job.to,
                from: job.from ?? undefined,
                subject: job.subject,
                text: job.text,
                html: job.html ?? undefined,
                templateId: job.templateId ?? undefined,
                metadata: job.metadata ?? undefined,
            });
            if (result.success) {
                await this.repository.markSent(job.id, this.transport.transportName, result.timestamp);
                return { success: true, permanent: false };
            }
            const errorMsg = result.error || 'Unknown transport failure';
            const permanent = isPermanentEmailError(errorMsg);
            if (permanent || newAttempts >= job.maxAttempts) {
                await this.repository.markPermanentFailure(job.id, errorMsg, newAttempts);
                return { success: false, permanent: true, error: errorMsg };
            }
            const nextAttemptAt = calculateBackoffWithJitter(newAttempts);
            await this.repository.markRetryableFailure(job.id, errorMsg, nextAttemptAt, newAttempts);
            return { success: false, permanent: false, error: errorMsg };
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            const permanent = isPermanentEmailError(errorMsg);
            if (permanent || newAttempts >= job.maxAttempts) {
                await this.repository.markPermanentFailure(job.id, errorMsg, newAttempts);
                return { success: false, permanent: true, error: errorMsg };
            }
            const nextAttemptAt = calculateBackoffWithJitter(newAttempts);
            await this.repository.markRetryableFailure(job.id, errorMsg, nextAttemptAt, newAttempts);
            return { success: false, permanent: false, error: errorMsg };
        }
    }
    /**
     * Claims and processes a batch of ready or stale jobs.
     * Concurrency-safe: claims jobs atomically before processing.
     */
    async processPendingBatch(batchSize = 20, claimExpiryMs = 60000) {
        const jobs = await this.repository.claimPendingJobs(batchSize, claimExpiryMs);
        const result = {
            claimed: jobs.length,
            sent: 0,
            retried: 0,
            failedPermanently: 0,
            errors: [],
        };
        for (const job of jobs) {
            const outcome = await this.processJob(job);
            if (outcome.success) {
                result.sent += 1;
            }
            else if (outcome.permanent) {
                result.failedPermanently += 1;
                result.errors.push({ id: job.id, error: outcome.error || 'Permanent failure', permanent: true });
            }
            else {
                result.retried += 1;
                result.errors.push({ id: job.id, error: outcome.error || 'Retryable failure', permanent: false });
            }
        }
        return result;
    }
    async getHealthStats() {
        const counts = await this.repository.getHealthStats();
        return {
            ...counts,
            transportName: this.transport.transportName,
            isConfigured: this.transport.isConfigured(),
        };
    }
    async retryFailedJob(id) {
        const retried = await this.repository.retryFailedJob(id);
        return retried !== null;
    }
}
exports.EmailOutboxService = EmailOutboxService;
/**
 * Background outbox processor that periodically drains the durable email queue.
 */
class EmailOutboxProcessor {
    outboxService;
    intervalMs;
    batchSize;
    timer = null;
    isProcessing = false;
    activeBatchPromise = null;
    constructor(outboxService, intervalMs = 5000, batchSize = 20) {
        this.outboxService = outboxService;
        this.intervalMs = intervalMs;
        this.batchSize = batchSize;
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            void this.tick();
        }, this.intervalMs);
        // Unref so process exit is not blocked
        this.timer.unref();
    }
    async stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.activeBatchPromise) {
            try {
                await this.activeBatchPromise;
            }
            catch {
                // Safe swallow on stop
            }
        }
    }
    async tick() {
        if (this.isProcessing)
            return null;
        this.isProcessing = true;
        const batchPromise = (async () => {
            try {
                return await this.outboxService.processPendingBatch(this.batchSize);
            }
            catch (err) {
                console.error('[EmailOutboxProcessor] Batch tick error:', err instanceof Error ? err.message : err);
                return null;
            }
            finally {
                this.isProcessing = false;
                this.activeBatchPromise = null;
            }
        })();
        this.activeBatchPromise = batchPromise;
        return await batchPromise;
    }
    isStarted() {
        return this.timer !== null;
    }
    isBusy() {
        return this.isProcessing;
    }
}
exports.EmailOutboxProcessor = EmailOutboxProcessor;
let defaultOutboxService = null;
function getEmailOutboxService() {
    if (!defaultOutboxService) {
        defaultOutboxService = new EmailOutboxService();
    }
    return defaultOutboxService;
}
function setEmailOutboxService(service) {
    defaultOutboxService = service;
}
