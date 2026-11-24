import { IEmailTransport } from './types';
import {
  EmailOutboxRecord,
  EnqueueEmailInput,
  IEmailOutboxRepository,
  OutboxHealthStats,
  ProcessBatchResult,
} from './outbox.types';
import { resolveDefaultEmailTransport } from './transports';
import { PrismaEmailOutboxRepository } from './outboxRepository';

export function isPermanentEmailError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes('invalid recipient') ||
    lower.includes('invalid email') ||
    lower.includes('mailbox unavailable') ||
    lower.includes('user not found') ||
    lower.includes('550 ') ||
    lower.includes('551 ') ||
    lower.includes('553 ') ||
    lower.includes('554 ') ||
    lower.includes('syntax error') ||
    lower.includes('no recipient')
  );
}

export function calculateBackoffWithJitter(
  attempts: number,
  baseMs = 2000,
  maxMs = 300000
): Date {
  const exponent = Math.max(0, Math.min(attempts - 1, 10));
  const backoff = Math.min(maxMs, baseMs * Math.pow(2, exponent));
  const jitter = Math.floor(Math.random() * 1000);
  return new Date(Date.now() + backoff + jitter);
}

export class EmailOutboxService {
  constructor(
    private readonly repository: IEmailOutboxRepository = new PrismaEmailOutboxRepository(),
    private transport: IEmailTransport = resolveDefaultEmailTransport()
  ) {}

  setTransport(transport: IEmailTransport): void {
    this.transport = transport;
  }

  getTransport(): IEmailTransport {
    return this.transport;
  }

  getRepository(): IEmailOutboxRepository {
    return this.repository;
  }

  /**
   * Enqueues an outgoing email job durably.
   * Guaranteed idempotent by unique idempotencyKey.
   */
  async enqueueEmail(input: EnqueueEmailInput): Promise<{ outboxId: string; status: string; duplicate: boolean }> {
    const to = input.to?.trim();
    const isMalformed = !to || !to.includes('@') || to.startsWith('@') || to.endsWith('@');

    const { record, duplicate } = await this.repository.enqueue({
      ...input,
      to: to || input.to,
    });

    if (isMalformed && !duplicate) {
      await this.repository.markPermanentFailure(
        record.id,
        `Permanent failure: invalid email address "${input.to}"`,
        1
      );
      return { outboxId: record.id, status: 'PERMANENT_FAILURE', duplicate: false };
    }

    return { outboxId: record.id, status: record.status, duplicate };
  }

  /**
   * Processes a single claimed outbox job via the active transport.
   */
  async processJob(job: EmailOutboxRecord): Promise<{ success: boolean; permanent: boolean; error?: string }> {
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
    } catch (err: unknown) {
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
  async processPendingBatch(batchSize = 20, claimExpiryMs = 60000): Promise<ProcessBatchResult> {
    const jobs = await this.repository.claimPendingJobs(batchSize, claimExpiryMs);
    const result: ProcessBatchResult = {
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
      } else if (outcome.permanent) {
        result.failedPermanently += 1;
        result.errors.push({ id: job.id, error: outcome.error || 'Permanent failure', permanent: true });
      } else {
        result.retried += 1;
        result.errors.push({ id: job.id, error: outcome.error || 'Retryable failure', permanent: false });
      }
    }

    return result;
  }

  async getHealthStats(): Promise<OutboxHealthStats> {
    const counts = await this.repository.getHealthStats();
    return {
      ...counts,
      transportName: this.transport.transportName,
      isConfigured: this.transport.isConfigured(),
    };
  }

  async retryFailedJob(id: string): Promise<boolean> {
    const retried = await this.repository.retryFailedJob(id);
    return retried !== null;
  }
}

/**
 * Background outbox processor that periodically drains the durable email queue.
 */
export class EmailOutboxProcessor {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private activeBatchPromise: Promise<ProcessBatchResult | null> | null = null;

  constructor(
    private readonly outboxService: EmailOutboxService,
    private readonly intervalMs = 5000,
    private readonly batchSize = 20
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Unref so process exit is not blocked
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.activeBatchPromise) {
      try {
        await this.activeBatchPromise;
      } catch {
        // Safe swallow on stop
      }
    }
  }

  async tick(): Promise<ProcessBatchResult | null> {
    if (this.isProcessing) return null;
    this.isProcessing = true;
    const batchPromise = (async () => {
      try {
        return await this.outboxService.processPendingBatch(this.batchSize);
      } catch (err: unknown) {
        console.error('[EmailOutboxProcessor] Batch tick error:', err instanceof Error ? err.message : err);
        return null;
      } finally {
        this.isProcessing = false;
        this.activeBatchPromise = null;
      }
    })();
    this.activeBatchPromise = batchPromise;
    return await batchPromise;
  }

  isStarted(): boolean {
    return this.timer !== null;
  }

  isBusy(): boolean {
    return this.isProcessing;
  }
}

let defaultOutboxService: EmailOutboxService | null = null;

export function getEmailOutboxService(): EmailOutboxService {
  if (!defaultOutboxService) {
    defaultOutboxService = new EmailOutboxService();
  }
  return defaultOutboxService;
}

export function setEmailOutboxService(service: EmailOutboxService): void {
  defaultOutboxService = service;
}
