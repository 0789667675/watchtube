import { MobileMoneyProviderName } from './types';
import type { GatewayStatus } from './mockAdapters';

export type StoredPaymentKind = 'PAYMENT' | 'PAYOUT' | 'REFUND';

export interface WebhookProcessingMetadata {
  payloadSha256?: string;
  providerReference?: string;
  transactionId?: string;
  reportedStatus?: GatewayStatus;
  signatureVerified?: boolean;
}

export class PaymentIdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_UNIQUE_CONFLICT';
  readonly kind: StoredPaymentKind;
  readonly ownerScope: string;
  readonly idempotencyKey: string;

  constructor(kind: StoredPaymentKind, ownerScope: string, idempotencyKey: string, message?: string) {
    super(message || `Duplicate idempotency key for ${kind}:${ownerScope}`);
    this.name = 'PaymentIdempotencyConflictError';
    this.kind = kind;
    this.ownerScope = ownerScope;
    this.idempotencyKey = idempotencyKey;
  }
}

export interface PaymentTransactionRecord {
  transactionId: string;
  kind: StoredPaymentKind;
  provider: MobileMoneyProviderName;
  ownerScope?: string;
  channelId?: string;
  userId: string;
  amountCents: bigint;
  currency: 'RWF';
  msisdnHash: string;
  maskedPhone: string;
  idempotencyKey: string;
  providerReference: string;
  providerTransactionId?: string;
  status: GatewayStatus;
  reconciliationRequired: boolean;
  failureReason?: string;
  parentTransactionId?: string;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt?: Date;
}

export function resolvePaymentOwnerScope(
  record: Pick<PaymentTransactionRecord, 'kind' | 'ownerScope' | 'channelId' | 'userId'>
): string {
  if (record.ownerScope && record.ownerScope.trim()) {
    return record.ownerScope;
  }
  if (record.kind === 'PAYOUT' || record.kind === 'REFUND') {
    return record.channelId || record.userId;
  }
  return record.userId;
}

export interface IPaymentTransactionStore {
  withIdempotencyLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  findByIdempotencyKey(kind: StoredPaymentKind, ownerScope: string, idempotencyKey: string): Promise<PaymentTransactionRecord | null>;
  findByTransactionId(transactionId: string): Promise<PaymentTransactionRecord | null>;
  findByProviderReference(provider: MobileMoneyProviderName, providerReference: string): Promise<PaymentTransactionRecord | null>;
  save(record: PaymentTransactionRecord): Promise<void>;
  hasProcessedWebhook(provider: MobileMoneyProviderName, webhookEventId: string): Promise<boolean>;
  markWebhookProcessed(
    provider: MobileMoneyProviderName,
    webhookEventId: string,
    metadata?: WebhookProcessingMetadata
  ): Promise<boolean>;
  listPendingReconciliation(): Promise<PaymentTransactionRecord[]>;
}

/**
 * In-memory atomic store for payment/payout orchestration metadata and webhook deduplication.
 * NOTE: Ledger financial finality is persisted separately in PostgreSQL `WalletTransaction`
 * via unique `referenceId` constraints. Full cross-restart durability of external provider
 * references requires the Workstream A `PaymentTransaction` and `PaymentWebhookEvent` tables.
 */
export class InMemoryPaymentTransactionStore implements IPaymentTransactionStore {
  private byId = new Map<string, PaymentTransactionRecord>();
  private byIdempotency = new Map<string, string>();
  private byProviderRef = new Map<string, string>();
  private processedWebhooks = new Set<string>();
  private locks = new Map<string, Promise<void>>();

  async withIdempotencyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, prev.then(() => gate));

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async findByIdempotencyKey(
    kind: StoredPaymentKind,
    ownerScope: string,
    idempotencyKey: string
  ): Promise<PaymentTransactionRecord | null> {
    const id = this.byIdempotency.get(`${kind}:${ownerScope}:${idempotencyKey}`);
    if (!id) return null;
    const rec = this.byId.get(id);
    return rec ? { ...rec } : null;
  }

  async findByTransactionId(transactionId: string): Promise<PaymentTransactionRecord | null> {
    const rec = this.byId.get(transactionId);
    return rec ? { ...rec } : null;
  }

  async findByProviderReference(
    provider: MobileMoneyProviderName,
    providerReference: string
  ): Promise<PaymentTransactionRecord | null> {
    const id = this.byProviderRef.get(`${provider}:${providerReference}`);
    if (!id) return null;
    const rec = this.byId.get(id);
    return rec ? { ...rec } : null;
  }

  async save(record: PaymentTransactionRecord): Promise<void> {
    const copy = { ...record };
    const ownerScope = resolvePaymentOwnerScope(copy);
    copy.ownerScope = ownerScope;
    const idempKey = `${copy.kind}:${ownerScope}:${copy.idempotencyKey}`;
    const existingIdForKey = this.byIdempotency.get(idempKey);
    if (existingIdForKey && existingIdForKey !== copy.transactionId) {
      throw new PaymentIdempotencyConflictError(copy.kind, ownerScope, copy.idempotencyKey);
    }
    this.byId.set(copy.transactionId, copy);
    this.byIdempotency.set(idempKey, copy.transactionId);
    if (copy.providerReference) {
      this.byProviderRef.set(`${copy.provider}:${copy.providerReference}`, copy.transactionId);
    }
  }

  async hasProcessedWebhook(provider: MobileMoneyProviderName, webhookEventId: string): Promise<boolean> {
    return this.processedWebhooks.has(`${provider}:${webhookEventId}`);
  }

  async markWebhookProcessed(
    provider: MobileMoneyProviderName,
    webhookEventId: string,
    _metadata?: WebhookProcessingMetadata
  ): Promise<boolean> {
    const key = `${provider}:${webhookEventId}`;
    if (this.processedWebhooks.has(key)) return false;
    this.processedWebhooks.add(key);
    return true;
  }

  async listPendingReconciliation(): Promise<PaymentTransactionRecord[]> {
    return Array.from(this.byId.values())
      .filter((r) => r.status === 'PENDING' || r.reconciliationRequired)
      .map((r) => ({ ...r }));
  }
}
