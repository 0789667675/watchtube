"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryPaymentTransactionStore = exports.PaymentIdempotencyConflictError = void 0;
exports.resolvePaymentOwnerScope = resolvePaymentOwnerScope;
class PaymentIdempotencyConflictError extends Error {
    code = 'IDEMPOTENCY_UNIQUE_CONFLICT';
    kind;
    ownerScope;
    idempotencyKey;
    constructor(kind, ownerScope, idempotencyKey, message) {
        super(message || `Duplicate idempotency key for ${kind}:${ownerScope}`);
        this.name = 'PaymentIdempotencyConflictError';
        this.kind = kind;
        this.ownerScope = ownerScope;
        this.idempotencyKey = idempotencyKey;
    }
}
exports.PaymentIdempotencyConflictError = PaymentIdempotencyConflictError;
function resolvePaymentOwnerScope(record) {
    if (record.ownerScope && record.ownerScope.trim()) {
        return record.ownerScope;
    }
    if (record.kind === 'PAYOUT' || record.kind === 'REFUND') {
        return record.channelId || record.userId;
    }
    return record.userId;
}
/**
 * In-memory atomic store for payment/payout orchestration metadata and webhook deduplication.
 * NOTE: Ledger financial finality is persisted separately in PostgreSQL `WalletTransaction`
 * via unique `referenceId` constraints. Full cross-restart durability of external provider
 * references requires the Workstream A `PaymentTransaction` and `PaymentWebhookEvent` tables.
 */
class InMemoryPaymentTransactionStore {
    byId = new Map();
    byIdempotency = new Map();
    byProviderRef = new Map();
    processedWebhooks = new Set();
    locks = new Map();
    async withIdempotencyLock(key, fn) {
        const prev = this.locks.get(key) || Promise.resolve();
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        this.locks.set(key, prev.then(() => gate));
        await prev;
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
    async findByIdempotencyKey(kind, ownerScope, idempotencyKey) {
        const id = this.byIdempotency.get(`${kind}:${ownerScope}:${idempotencyKey}`);
        if (!id)
            return null;
        const rec = this.byId.get(id);
        return rec ? { ...rec } : null;
    }
    async findByTransactionId(transactionId) {
        const rec = this.byId.get(transactionId);
        return rec ? { ...rec } : null;
    }
    async findByProviderReference(provider, providerReference) {
        const id = this.byProviderRef.get(`${provider}:${providerReference}`);
        if (!id)
            return null;
        const rec = this.byId.get(id);
        return rec ? { ...rec } : null;
    }
    async save(record) {
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
    async hasProcessedWebhook(provider, webhookEventId) {
        return this.processedWebhooks.has(`${provider}:${webhookEventId}`);
    }
    async markWebhookProcessed(provider, webhookEventId, _metadata) {
        const key = `${provider}:${webhookEventId}`;
        if (this.processedWebhooks.has(key))
            return false;
        this.processedWebhooks.add(key);
        return true;
    }
    async listPendingReconciliation() {
        return Array.from(this.byId.values())
            .filter((r) => r.status === 'PENDING' || r.reconciliationRequired)
            .map((r) => ({ ...r }));
    }
}
exports.InMemoryPaymentTransactionStore = InMemoryPaymentTransactionStore;
