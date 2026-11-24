import crypto from 'node:crypto';
import { db as defaultPrisma } from '@watchtube/database';
import {
  EmailOutboxRecord,
  EmailOutboxStatus,
  EnqueueEmailInput,
  IEmailOutboxRepository,
  OutboxHealthStats,
} from './outbox.types';

export class PrismaEmailOutboxRepository implements IEmailOutboxRepository {
  constructor(private readonly prisma: typeof defaultPrisma = defaultPrisma) {}

  async enqueue(input: EnqueueEmailInput): Promise<{ record: EmailOutboxRecord; duplicate: boolean }> {
    try {
      const created = await (this.prisma as any).emailOutbox.create({
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
    } catch (err: any) {
      if (err?.code === 'P2002' || err?.message?.includes('Unique constraint')) {
        const existing = await (this.prisma as any).emailOutbox.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          return { record: this.mapRecord(existing), duplicate: true };
        }
      }
      throw err;
    }
  }

  async claimPendingJobs(batchSize: number, claimExpiryMs: number): Promise<EmailOutboxRecord[]> {
    const now = new Date();
    const staleProcessingBefore = new Date(now.getTime() - claimExpiryMs);

    // Find candidate jobs ready for processing or crashed jobs needing recovery
    const candidates = await (this.prisma as any).emailOutbox.findMany({
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

    const candidateIds: string[] = candidates.map((c: { id: string }) => c.id);
    const claimToken = crypto.randomUUID();

    // Atomically claim the candidate jobs using a unique claim token
    const updateResult = await (this.prisma as any).emailOutbox.updateMany({
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

    const claimed = await (this.prisma as any).emailOutbox.findMany({
      where: {
        id: { in: candidateIds },
        status: 'PROCESSING',
        transportName: `claim:${claimToken}`,
      },
      orderBy: { createdAt: 'asc' },
    });

    return claimed.map((r: any) => this.mapRecord(r));
  }

  async markSent(id: string, transportName: string, sentAt?: Date): Promise<void> {
    await (this.prisma as any).emailOutbox.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: sentAt || new Date(),
        transportName,
        lastError: null,
      },
    });
  }

  async markRetryableFailure(id: string, error: string, nextAttemptAt: Date, attempts: number): Promise<void> {
    await (this.prisma as any).emailOutbox.update({
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

  async markPermanentFailure(id: string, error: string, attempts: number): Promise<void> {
    await (this.prisma as any).emailOutbox.update({
      where: { id },
      data: {
        status: 'PERMANENT_FAILURE',
        lastError: error,
        attempts,
        transportName: null,
      },
    });
  }

  async getHealthStats(): Promise<Omit<OutboxHealthStats, 'transportName' | 'isConfigured'>> {
    const [pending, processing, sent, retryableFailure, permanentFailure, total] = await Promise.all([
      (this.prisma as any).emailOutbox.count({ where: { status: 'PENDING' } }),
      (this.prisma as any).emailOutbox.count({ where: { status: 'PROCESSING' } }),
      (this.prisma as any).emailOutbox.count({ where: { status: 'SENT' } }),
      (this.prisma as any).emailOutbox.count({ where: { status: 'RETRYABLE_FAILURE' } }),
      (this.prisma as any).emailOutbox.count({ where: { status: 'PERMANENT_FAILURE' } }),
      (this.prisma as any).emailOutbox.count(),
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

  async retryFailedJob(id: string): Promise<EmailOutboxRecord | null> {
    const job = await (this.prisma as any).emailOutbox.findUnique({ where: { id } });
    if (!job || (job.status !== 'PERMANENT_FAILURE' && job.status !== 'RETRYABLE_FAILURE')) {
      return null;
    }

    const updated = await (this.prisma as any).emailOutbox.update({
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

  async findById(id: string): Promise<EmailOutboxRecord | null> {
    const job = await (this.prisma as any).emailOutbox.findUnique({ where: { id } });
    return job ? this.mapRecord(job) : null;
  }

  private mapRecord(raw: any): EmailOutboxRecord {
    return {
      id: raw.id,
      idempotencyKey: raw.idempotencyKey,
      to: raw.to,
      from: raw.from ?? null,
      subject: raw.subject,
      text: raw.text,
      html: raw.html ?? null,
      templateId: raw.templateId ?? null,
      metadata: raw.metadata as Record<string, unknown> | null,
      status: raw.status as EmailOutboxStatus,
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

export class InMemoryEmailOutboxRepository implements IEmailOutboxRepository {
  private jobs = new Map<string, EmailOutboxRecord>();
  private jobsByIdempotency = new Map<string, string>();

  async enqueue(input: EnqueueEmailInput): Promise<{ record: EmailOutboxRecord; duplicate: boolean }> {
    const existingId = this.jobsByIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.jobs.get(existingId)!;
      return { record: { ...existing }, duplicate: true };
    }

    const record: EmailOutboxRecord = {
      id: crypto.randomUUID(),
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

  async claimPendingJobs(batchSize: number, claimExpiryMs: number): Promise<EmailOutboxRecord[]> {
    const now = new Date();
    const staleProcessingBefore = new Date(now.getTime() - claimExpiryMs);
    const claimToken = crypto.randomUUID();
    const claimed: EmailOutboxRecord[] = [];

    for (const job of this.jobs.values()) {
      if (claimed.length >= batchSize) break;

      const isReady =
        (job.status === 'PENDING' || job.status === 'RETRYABLE_FAILURE') &&
        job.nextAttemptAt.getTime() <= now.getTime();
      const isStale =
        job.status === 'PROCESSING' &&
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

  async markSent(id: string, transportName: string, sentAt?: Date): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'SENT';
      job.sentAt = sentAt || new Date();
      job.transportName = transportName;
      job.lastError = null;
      job.updatedAt = new Date();
    }
  }

  async markRetryableFailure(id: string, error: string, nextAttemptAt: Date, attempts: number): Promise<void> {
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

  async markPermanentFailure(id: string, error: string, attempts: number): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'PERMANENT_FAILURE';
      job.lastError = error;
      job.attempts = attempts;
      job.transportName = null;
      job.updatedAt = new Date();
    }
  }

  async getHealthStats(): Promise<Omit<OutboxHealthStats, 'transportName' | 'isConfigured'>> {
    let pending = 0;
    let processing = 0;
    let sent = 0;
    let retryableFailure = 0;
    let permanentFailure = 0;

    for (const job of this.jobs.values()) {
      if (job.status === 'PENDING') pending++;
      else if (job.status === 'PROCESSING') processing++;
      else if (job.status === 'SENT') sent++;
      else if (job.status === 'RETRYABLE_FAILURE') retryableFailure++;
      else if (job.status === 'PERMANENT_FAILURE') permanentFailure++;
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

  async retryFailedJob(id: string): Promise<EmailOutboxRecord | null> {
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

  async findById(id: string): Promise<EmailOutboxRecord | null> {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  updateJob(id: string, updates: Partial<EmailOutboxRecord>): void {
    const job = this.jobs.get(id);
    if (job) {
      Object.assign(job, updates);
    }
  }

  clear(): void {
    this.jobs.clear();
    this.jobsByIdempotency.clear();
  }
}
