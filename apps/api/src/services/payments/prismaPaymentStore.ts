import crypto from 'node:crypto';
import { db as defaultPrisma } from '@watchtube/database';
import {
  IPaymentTransactionStore,
  PaymentIdempotencyConflictError,
  PaymentTransactionRecord,
  resolvePaymentOwnerScope,
  StoredPaymentKind,
  WebhookProcessingMetadata,
} from './paymentStore';
import { MobileMoneyProviderName } from './types';
import type { GatewayStatus } from './mockAdapters';

function toNullableTrimmedString(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueConstraintError(err: any): boolean {
  return err?.code === 'P2002';
}

function getUniqueConstraintTarget(err: any): string {
  const target = err?.meta?.target;
  if (Array.isArray(target)) return target.join(',');
  if (typeof target === 'string') return target;
  return String(err?.message ?? '');
}

function mapRowToRecord(row: any): PaymentTransactionRecord {
  if (row.currency !== 'RWF') {
    throw new Error(`Unsupported persisted currency "${row.currency}" on transaction ${row.transactionId}`);
  }
  return {
    transactionId: row.transactionId,
    kind: row.kind as StoredPaymentKind,
    provider: row.provider as MobileMoneyProviderName,
    ownerScope: row.ownerScope,
    channelId: row.channelId ?? undefined,
    userId: row.userId,
    amountCents: BigInt(row.amountCents),
    currency: 'RWF',
    msisdnHash: row.msisdnHash,
    maskedPhone: row.maskedPhone,
    idempotencyKey: row.idempotencyKey,
    providerReference: row.providerReference ?? '',
    providerTransactionId: row.providerTransactionId ?? undefined,
    status: row.status as GatewayStatus,
    reconciliationRequired: Boolean(row.reconciliationRequired),
    failureReason: row.failureReason ?? undefined,
    parentTransactionId: row.parentTransactionId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finalizedAt: row.finalizedAt ?? undefined,
  };
}

/**
 * PostgreSQL / Prisma-backed durable store for mobile money payment orchestration
 * metadata and webhook deduplication.
 *
 * Guarantees:
 * - No raw MSISDNs stored (only `msisdnHash` + `maskedPhone`).
 * - No unnecessary raw webhook payloads stored (only `payloadSha256` + minimal metadata).
 * - Multi-instance duplicate suppression enforced at the PostgreSQL unique-constraint level:
 *   - `(kind, ownerScope, idempotencyKey)`
 *   - `(provider, providerReference)` (nullable so unset references never collide on '')
 *   - `(provider, webhookEventId)`
 */
export class PrismaPaymentTransactionStore implements IPaymentTransactionStore {
  private readonly prisma: any;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(prismaClient: any = defaultPrisma) {
    this.prisma = prismaClient;
  }

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
    const row = await this.prisma.paymentTransaction.findUnique({
      where: {
        kind_ownerScope_idempotencyKey: {
          kind,
          ownerScope,
          idempotencyKey,
        },
      },
    });
    return row ? mapRowToRecord(row) : null;
  }

  async findByTransactionId(transactionId: string): Promise<PaymentTransactionRecord | null> {
    const row = await this.prisma.paymentTransaction.findUnique({
      where: { transactionId },
    });
    return row ? mapRowToRecord(row) : null;
  }

  async findByProviderReference(
    provider: MobileMoneyProviderName,
    providerReference: string
  ): Promise<PaymentTransactionRecord | null> {
    const normalizedRef = toNullableTrimmedString(providerReference);
    if (!normalizedRef) return null;

    const row = await this.prisma.paymentTransaction.findUnique({
      where: {
        provider_providerReference: {
          provider,
          providerReference: normalizedRef,
        },
      },
    });
    return row ? mapRowToRecord(row) : null;
  }

  async findByParentTransactionId(parentTransactionId: string): Promise<PaymentTransactionRecord[]> {
    const rows = await this.prisma.paymentTransaction.findMany({
      where: { parentTransactionId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapRowToRecord);
  }

  async save(record: PaymentTransactionRecord): Promise<void> {
    const ownerScope = resolvePaymentOwnerScope(record);
    const providerReference = toNullableTrimmedString(record.providerReference);
    const providerTransactionId = toNullableTrimmedString(record.providerTransactionId);

    try {
      await this.prisma.paymentTransaction.upsert({
        where: { transactionId: record.transactionId },
        create: {
          transactionId: record.transactionId,
          kind: record.kind,
          provider: record.provider,
          ownerScope,
          userId: record.userId,
          channelId: record.channelId ?? null,
          amountCents: record.amountCents,
          currency: record.currency,
          msisdnHash: record.msisdnHash,
          maskedPhone: record.maskedPhone,
          idempotencyKey: record.idempotencyKey,
          providerReference,
          providerTransactionId,
          status: record.status,
          reconciliationRequired: record.reconciliationRequired,
          failureReason: record.failureReason ?? null,
          parentTransactionId: record.parentTransactionId ?? null,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          finalizedAt: record.finalizedAt ?? null,
        },
        update: {
          providerReference,
          providerTransactionId,
          status: record.status,
          reconciliationRequired: record.reconciliationRequired,
          failureReason: record.failureReason ?? null,
          finalizedAt: record.finalizedAt ?? null,
          updatedAt: record.updatedAt,
        },
      });
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        const target = getUniqueConstraintTarget(err);
        if (target.includes('idempotencyKey')) {
          throw new PaymentIdempotencyConflictError(record.kind, ownerScope, record.idempotencyKey);
        }
      }
      throw err;
    }
  }

  async hasProcessedWebhook(provider: MobileMoneyProviderName, webhookEventId: string): Promise<boolean> {
    const row = await this.prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_webhookEventId: {
          provider,
          webhookEventId,
        },
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  async markWebhookProcessed(
    provider: MobileMoneyProviderName,
    webhookEventId: string,
    metadata?: WebhookProcessingMetadata
  ): Promise<boolean> {
    let linkedTransactionUuid: string | null = null;
    if (metadata?.transactionId) {
      const txRow = await this.prisma.paymentTransaction.findUnique({
        where: { transactionId: metadata.transactionId },
        select: { id: true },
      });
      linkedTransactionUuid = txRow?.id ?? null;
    }

    const fallbackSha = crypto
      .createHash('sha256')
      .update(`${provider}:${webhookEventId}`)
      .digest('hex');

    try {
      await this.prisma.paymentWebhookEvent.create({
        data: {
          provider,
          webhookEventId,
          providerReference: toNullableTrimmedString(metadata?.providerReference),
          paymentTransactionId: linkedTransactionUuid,
          payloadSha256: metadata?.payloadSha256 || fallbackSha,
          reportedStatus: metadata?.reportedStatus ?? null,
          signatureVerified: metadata?.signatureVerified ?? true,
        },
      });
      return true;
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        return false;
      }
      throw err;
    }
  }

  async listPendingReconciliation(): Promise<PaymentTransactionRecord[]> {
    const rows = await this.prisma.paymentTransaction.findMany({
      where: {
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING' },
          { reconciliationRequired: true },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapRowToRecord);
  }
}
