"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryEmailOutboxRepository = exports.PrismaEmailOutboxRepository = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const database_1 = require("@watchtube/database");
class PrismaEmailOutboxRepository {
    prisma;
    constructor(prisma = database_1.db) {
        this.prisma = prisma;
    }
    async enqueue(input) {
        try {
            const created = await this.prisma.emailOutbox.create({
                data: {
                    idempotencyKey: input.idempotencyKey,
                    to: input.to,
                    from: input.from ?? null,
                    subject: input.subject,
                    text: input.text,
                    html: input.html ?? null,
                    templateId: input.templateId ?? null,
                    metadata: input.metadata ?? undefined,
                    status: 'PENDING',
                    nextAttemptAt: input.nextAttemptAt ?? new Date(),
                    maxAttempts: input.maxAttempts ?? 5,
                },
            });
            return { record: this.mapRecord(created), duplicate: false };
        }
        catch (err) {
            if (err?.code === 'P2002' || err?.message?.includes('Unique constraint')) {
                const existing = await this.prisma.emailOutbox.findUnique({
                    where: { idempotencyKey: input.idempotencyKey },
                });
                if (existing) {
                    return { record: this.mapRecord(existing), duplicate: true };
                }
            }
            throw err;
        }
    }
    async claimPendingJobs(batchSize, claimExpiryMs) {
        const now = new Date();
        const staleProcessingBefore = new Date(now.getTime() - claimExpiryMs);
        // Find candidate jobs ready for processing or crashed jobs needing recovery
        const candidates = await this.prisma.emailOutbox.findMany({
            where: {
                OR: [
                    {
                        status: { in: ['PENDING', 'RETRYABLE_FAILURE'] },
                        nextAttemptAt: { lte: now },
                    },
                    {
                        status: 'PROCESSING',
                        lastAttemptAt: { lt: staleProcessingBefore },
                    },
                ],
            },
            orderBy: { createdAt: 'asc' },
            take: Math.max(1, Math.min(batchSize, 100)),
            select: { id: true },
        });
        if (candidates.length === 0) {
            return [];
        }
        const candidateIds = candidates.map((c) => c.id);
        const claimToken = node_crypto_1.default.randomUUID();
        // Atomically claim the candidate jobs using a unique claim token
        const updateResult = await this.prisma.emailOutbox.updateMany({
            where: {
                id: { in: candidateIds },
                OR: [
                    { status: { in: ['PENDING', 'RETRYABLE_FAILURE'] } },
                    { status: 'PROCESSING', lastAttemptAt: { lt: staleProcessingBefore } },
                ],
            },
            data: {
                status: 'PROCESSING',
                lastAttemptAt: now,
                transportName: `claim:${claimToken}`,
            },
        });
        if (updateResult.count === 0) {
            return [];
        }
        const claimed = await this.prisma.emailOutbox.findMany({
            where: {
                id: { in: candidateIds },
                status: 'PROCESSING',
                transportName: `claim:${claimToken}`,
            },
            orderBy: { createdAt: 'asc' },
        });
        return claimed.map((r) => this.mapRecord(r));
    }
    async markSent(id, transportName, sentAt) {
        await this.prisma.emailOutbox.update({
            where: { id },
            data: {
                status: 'SENT',
                sentAt: sentAt || new Date(),
                transportName,
                lastError: null,
            },
        });
    }
    async markRetryableFailure(id, error, nextAttemptAt, attempts) {
        await this.prisma.emailOutbox.update({
            where: { id },
            data: {
                status: 'RETRYABLE_FAILURE',
                lastError: error,
                nextAttemptAt,
                attempts,
                transportName: null,
            },
        });
    }
    async markPermanentFailure(id, error, attempts) {
        await this.prisma.emailOutbox.update({
            where: { id },
            data: {
                status: 'PERMANENT_FAILURE',
                lastError: error,
                attempts,
                transportName: null,
            },
        });
    }
    async getHealthStats() {
        const [pending, processing, sent, retryableFailure, permanentFailure, total] = await Promise.all([
            this.prisma.emailOutbox.count({ where: { status: 'PENDING' } }),
            this.prisma.emailOutbox.count({ where: { status: 'PROCESSING' } }),
            this.prisma.emailOutbox.count({ where: { status: 'SENT' } }),
            this.prisma.emailOutbox.count({ where: { status: 'RETRYABLE_FAILURE' } }),
            this.prisma.emailOutbox.count({ where: { status: 'PERMANENT_FAILURE' } }),
            this.prisma.emailOutbox.count(),
        ]);
        return {
            pending,
            processing,
            sent,
            retryableFailure,
            permanentFailure,
            total,
        };
    }
    async retryFailedJob(id) {
        const job = await this.prisma.emailOutbox.findUnique({ where: { id } });
        if (!job || (job.status !== 'PERMANENT_FAILURE' && job.status !== 'RETRYABLE_FAILURE')) {
            return null;
        }
        const updated = await this.prisma.emailOutbox.update({
            where: { id },
            data: {
                status: 'PENDING',
                nextAttemptAt: new Date(),
                attempts: 0,
                lastError: null,
                transportName: null,
            },
        });
        return this.mapRecord(updated);
    }
    async findById(id) {
        const job = await this.prisma.emailOutbox.findUnique({ where: { id } });
        return job ? this.mapRecord(job) : null;
    }
    mapRecord(raw) {
        return {
            id: raw.id,
            idempotencyKey: raw.idempotencyKey,
            to: raw.to,
            from: raw.from ?? null,
            subject: raw.subject,
            text: raw.text,
            html: raw.html ?? null,
            templateId: raw.templateId ?? null,
            metadata: raw.metadata,
            status: raw.status,
            attempts: raw.attempts,
            maxAttempts: raw.maxAttempts,
            nextAttemptAt: raw.nextAttemptAt,
            lastAttemptAt: raw.lastAttemptAt ?? null,
            sentAt: raw.sentAt ?? null,
            lastError: raw.lastError ?? null,
            transportName: raw.transportName?.startsWith('claim:') ? null : (raw.transportName ?? null),
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
        };
    }
}
exports.PrismaEmailOutboxRepository = PrismaEmailOutboxRepository;
class InMemoryEmailOutboxRepository {
    jobs = new Map();
    jobsByIdempotency = new Map();
    async enqueue(input) {
        const existingId = this.jobsByIdempotency.get(input.idempotencyKey);
        if (existingId) {
            const existing = this.jobs.get(existingId);
            return { record: { ...existing }, duplicate: true };
        }
        const record = {
            id: node_crypto_1.default.randomUUID(),
            idempotencyKey: input.idempotencyKey,
            to: input.to,
            from: input.from ?? null,
            subject: input.subject,
            text: input.text,
            html: input.html ?? null,
            templateId: input.templateId ?? null,
            metadata: input.metadata ?? null,
            status: 'PENDING',
            attempts: 0,
            maxAttempts: input.maxAttempts ?? 5,
            nextAttemptAt: input.nextAttemptAt ?? new Date(),
            lastAttemptAt: null,
            sentAt: null,
            lastError: null,
            transportName: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.jobs.set(record.id, record);
        this.jobsByIdempotency.set(record.idempotencyKey, record.id);
        return { record: { ...record }, duplicate: false };
    }
    async claimPendingJobs(batchSize, claimExpiryMs) {
        const now = new Date();
        const staleProcessingBefore = new Date(now.getTime() - claimExpiryMs);
        const claimToken = node_crypto_1.default.randomUUID();
        const claimed = [];
        for (const job of this.jobs.values()) {
            if (claimed.length >= batchSize)
                break;
            const isReady = (job.status === 'PENDING' || job.status === 'RETRYABLE_FAILURE') &&
                job.nextAttemptAt.getTime() <= now.getTime();
            const isStale = job.status === 'PROCESSING' &&
                job.lastAttemptAt &&
                job.lastAttemptAt.getTime() < staleProcessingBefore.getTime();
            if (isReady || isStale) {
                job.status = 'PROCESSING';
                job.lastAttemptAt = now;
                job.updatedAt = now;
                job.transportName = `claim:${claimToken}`;
                claimed.push({ ...job, transportName: null });
            }
        }
        return claimed;
    }
    async markSent(id, transportName, sentAt) {
        const job = this.jobs.get(id);
        if (job) {
            job.status = 'SENT';
            job.sentAt = sentAt || new Date();
            job.transportName = transportName;
            job.lastError = null;
            job.updatedAt = new Date();
        }
    }
    async markRetryableFailure(id, error, nextAttemptAt, attempts) {
        const job = this.jobs.get(id);
        if (job) {
            job.status = 'RETRYABLE_FAILURE';
            job.lastError = error;
            job.nextAttemptAt = nextAttemptAt;
            job.attempts = attempts;
            job.transportName = null;
            job.updatedAt = new Date();
        }
    }
    async markPermanentFailure(id, error, attempts) {
        const job = this.jobs.get(id);
        if (job) {
            job.status = 'PERMANENT_FAILURE';
            job.lastError = error;
            job.attempts = attempts;
            job.transportName = null;
            job.updatedAt = new Date();
        }
    }
    async getHealthStats() {
        let pending = 0;
        let processing = 0;
        let sent = 0;
        let retryableFailure = 0;
        let permanentFailure = 0;
        for (const job of this.jobs.values()) {
            if (job.status === 'PENDING')
                pending++;
            else if (job.status === 'PROCESSING')
                processing++;
            else if (job.status === 'SENT')
                sent++;
            else if (job.status === 'RETRYABLE_FAILURE')
                retryableFailure++;
            else if (job.status === 'PERMANENT_FAILURE')
                permanentFailure++;
        }
        return {
            pending,
            processing,
            sent,
            retryableFailure,
            permanentFailure,
            total: this.jobs.size,
        };
    }
    async retryFailedJob(id) {
        const job = this.jobs.get(id);
        if (!job || (job.status !== 'PERMANENT_FAILURE' && job.status !== 'RETRYABLE_FAILURE')) {
            return null;
        }
        job.status = 'PENDING';
        job.nextAttemptAt = new Date();
        job.attempts = 0;
        job.lastError = null;
        job.transportName = null;
        job.updatedAt = new Date();
        return { ...job };
    }
    async findById(id) {
        const job = this.jobs.get(id);
        return job ? { ...job } : null;
    }
    updateJob(id, updates) {
        const job = this.jobs.get(id);
        if (job) {
            Object.assign(job, updates);
        }
    }
    clear() {
        this.jobs.clear();
        this.jobsByIdempotency.clear();
    }
}
exports.InMemoryEmailOutboxRepository = InMemoryEmailOutboxRepository;
