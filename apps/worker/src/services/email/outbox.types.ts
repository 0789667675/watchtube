export type EmailOutboxStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'RETRYABLE_FAILURE'
  | 'PERMANENT_FAILURE';

export interface EnqueueEmailInput {
  idempotencyKey: string;
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
  templateId?: string;
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
  nextAttemptAt?: Date;
}

export interface EmailOutboxRecord {
  id: string;
  idempotencyKey: string;
  to: string;
  from: string | null;
  subject: string;
  text: string;
  html: string | null;
  templateId: string | null;
  metadata: Record<string, unknown> | null;
  status: EmailOutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  lastError: string | null;
  transportName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxHealthStats {
  pending: number;
  processing: number;
  sent: number;
  retryableFailure: number;
  permanentFailure: number;
  total: number;
  transportName: string;
  isConfigured: boolean;
}

export interface ProcessBatchResult {
  claimed: number;
  sent: number;
  retried: number;
  failedPermanently: number;
  errors: Array<{ id: string; error: string; permanent: boolean }>;
}

export interface IEmailOutboxRepository {
  enqueue(input: EnqueueEmailInput): Promise<{ record: EmailOutboxRecord; duplicate: boolean }>;
  claimPendingJobs(batchSize: number, claimExpiryMs: number): Promise<EmailOutboxRecord[]>;
  markSent(id: string, transportName: string, sentAt?: Date): Promise<void>;
  markRetryableFailure(id: string, error: string, nextAttemptAt: Date, attempts: number): Promise<void>;
  markPermanentFailure(id: string, error: string, attempts: number): Promise<void>;
  getHealthStats(): Promise<Omit<OutboxHealthStats, 'transportName' | 'isConfigured'>>;
  retryFailedJob(id: string): Promise<EmailOutboxRecord | null>;
  findById(id: string): Promise<EmailOutboxRecord | null>;
}
