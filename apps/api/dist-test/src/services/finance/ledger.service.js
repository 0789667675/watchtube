"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletLedgerService = exports.InMemoryWalletLedgerRepository = exports.PrismaWalletLedgerRepository = exports.PayoutConflictError = exports.InsufficientFundsError = exports.LedgerIntegrityError = exports.LedgerValidationError = exports.LEDGER_CURRENCY = void 0;
exports.parsePositiveBigIntAmount = parsePositiveBigIntAmount;
exports.parseNonNegativeBigIntAmount = parseNonNegativeBigIntAmount;
exports.calculateBasisPointsRoundHalfAwayFromZero = calculateBasisPointsRoundHalfAwayFromZero;
exports.deriveChannelBalanceFromEntries = deriveChannelBalanceFromEntries;
const node_crypto_1 = __importDefault(require("node:crypto"));
const database_1 = require("@watchtube/database");
exports.LEDGER_CURRENCY = 'RWF';
class LedgerValidationError extends Error {
    code;
    statusCode;
    constructor(message, code = 'LEDGER_VALIDATION_ERROR', statusCode = 400) {
        super(message);
        this.name = 'LedgerValidationError';
        this.code = code;
        this.statusCode = statusCode;
    }
}
exports.LedgerValidationError = LedgerValidationError;
class LedgerIntegrityError extends Error {
    code = 'LEDGER_INTEGRITY_ERROR';
    constructor(message) {
        super(message);
        this.name = 'LedgerIntegrityError';
    }
}
exports.LedgerIntegrityError = LedgerIntegrityError;
class InsufficientFundsError extends LedgerValidationError {
    constructor(availableBalanceCents, requestedCents) {
        super(`Insufficient available balance (${availableBalanceCents.toString()} ${exports.LEDGER_CURRENCY}) for requested ${requestedCents.toString()} ${exports.LEDGER_CURRENCY}.`, 'INSUFFICIENT_FUNDS', 409);
        this.name = 'InsufficientFundsError';
    }
}
exports.InsufficientFundsError = InsufficientFundsError;
class PayoutConflictError extends LedgerValidationError {
    constructor(message, code = 'PAYOUT_STATE_CONFLICT') {
        super(message, code, 409);
        this.name = 'PayoutConflictError';
    }
}
exports.PayoutConflictError = PayoutConflictError;
/**
 * Validates and converts an unknown input into a strictly positive integer BigInt amount.
 * Rejects floats, scientific notation, negatives, zero, booleans, and unsafe numbers.
 */
function parsePositiveBigIntAmount(value, fieldName = 'amountCents') {
    if (typeof value === 'bigint') {
        if (value <= 0n) {
            throw new LedgerValidationError(`${fieldName} must be greater than zero.`, 'INVALID_AMOUNT', 400);
        }
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new LedgerValidationError(`${fieldName} must be a positive safe integer in ${exports.LEDGER_CURRENCY}.`, 'INVALID_AMOUNT', 400);
        }
        return BigInt(value);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!/^\d+$/.test(trimmed)) {
            throw new LedgerValidationError(`${fieldName} must be a whole integer string in ${exports.LEDGER_CURRENCY}.`, 'INVALID_AMOUNT', 400);
        }
        const parsed = BigInt(trimmed);
        if (parsed <= 0n) {
            throw new LedgerValidationError(`${fieldName} must be greater than zero.`, 'INVALID_AMOUNT', 400);
        }
        return parsed;
    }
    throw new LedgerValidationError(`${fieldName} is required and must be a positive integer.`, 'INVALID_AMOUNT', 400);
}
/**
 * Validates non-negative integer BigInt amounts (e.g., fees or deductions that may be 0).
 */
function parseNonNegativeBigIntAmount(value, fieldName = 'amountCents') {
    if (typeof value === 'bigint') {
        if (value < 0n) {
            throw new LedgerValidationError(`${fieldName} cannot be negative.`, 'INVALID_AMOUNT', 400);
        }
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new LedgerValidationError(`${fieldName} must be a non-negative safe integer.`, 'INVALID_AMOUNT', 400);
        }
        return BigInt(value);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!/^\d+$/.test(trimmed)) {
            throw new LedgerValidationError(`${fieldName} must be a non-negative integer string.`, 'INVALID_AMOUNT', 400);
        }
        return BigInt(trimmed);
    }
    throw new LedgerValidationError(`${fieldName} must be a non-negative integer.`, 'INVALID_AMOUNT', 400);
}
/**
 * Deterministic basis-point integer multiplication (0..10,000) using round-half-away-from-zero.
 */
function calculateBasisPointsRoundHalfAwayFromZero(amountCents, basisPoints) {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
        throw new RangeError('Basis points must be an integer between 0 and 10000.');
    }
    const sign = amountCents < 0n ? -1n : 1n;
    const absAmount = amountCents * sign;
    const rounded = (absAmount * BigInt(basisPoints) + 5000n) / 10000n;
    return rounded * sign;
}
function compareEntriesChronological(a, b) {
    const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (timeDiff !== 0)
        return timeDiff;
    return a.id.localeCompare(b.id);
}
/**
 * Computes a strictly monotonic timestamp relative to existing channel ledger entries
 * so chronological ordering (`createdAt ASC, id ASC`) always matches causal insertion order
 * even when multiple transactions commit within the same millisecond.
 */
function nextMonotonicTimestamp(entries, offsetMs = 0) {
    const maxExisting = entries.reduce((max, entry) => Math.max(max, entry.createdAt.getTime()), 0);
    const base = Math.max(Date.now(), maxExisting + 1);
    return new Date(base + offsetMs);
}
/**
 * Derives authoritative wallet balances by folding all immutable ledger entries in
 * deterministic chronological order and verifying running balance invariants.
 */
function deriveChannelBalanceFromEntries(channelId, rawEntries) {
    const entries = [...rawEntries].sort(compareEntriesChronological);
    let runningBalance = 0n;
    let integrityVerified = true;
    let integrityError;
    let totalEarnedCents = 0n;
    let heldEscrowCents = 0n;
    const payoutReserved = new Map();
    const payoutSettled = new Set();
    const payoutFailed = new Set();
    const payoutReversed = new Set();
    for (const entry of entries) {
        runningBalance += entry.amountCents;
        if (entry.balanceAfterCents !== runningBalance) {
            integrityVerified = false;
            integrityError = `Balance chain mismatch at entry ${entry.id} (${entry.referenceId}): expected ${runningBalance}, recorded ${entry.balanceAfterCents}.`;
        }
        if (entry.transactionType === 'REVENUE_CREDIT' && entry.status !== 'FAILED') {
            totalEarnedCents += entry.amountCents;
        }
        else if (entry.transactionType === 'HOLD') {
            heldEscrowCents += entry.amountCents < 0n ? -entry.amountCents : entry.amountCents;
        }
        else if (entry.transactionType === 'PAYOUT') {
            if (entry.referenceId.startsWith('payout:init:')) {
                const payoutId = entry.referenceId.slice('payout:init:'.length);
                payoutReserved.set(payoutId, entry.amountCents < 0n ? -entry.amountCents : entry.amountCents);
            }
            else if (entry.referenceId.startsWith('payout:settled:') && entry.status === 'PAID') {
                const payoutId = entry.referenceId.slice('payout:settled:'.length);
                payoutSettled.add(payoutId);
            }
            else if (entry.referenceId.startsWith('payout:failed:') && entry.status === 'FAILED') {
                const payoutId = entry.referenceId.slice('payout:failed:'.length);
                payoutFailed.add(payoutId);
            }
            else if (entry.status === 'PAID' && entry.amountCents < 0n) {
                // Legacy/direct settled payout record
                payoutReserved.set(entry.referenceId, -entry.amountCents);
                payoutSettled.add(entry.referenceId);
            }
            else if (entry.status === 'PENDING' && entry.amountCents < 0n) {
                payoutReserved.set(entry.referenceId, -entry.amountCents);
            }
        }
        else if (entry.transactionType === 'ADJUSTMENT') {
            if (entry.referenceId.startsWith('payout:reversal:')) {
                const payoutId = entry.referenceId.slice('payout:reversal:'.length);
                payoutReversed.add(payoutId);
            }
            else if (entry.referenceId.startsWith('escrow:release:')
                || entry.referenceId.startsWith('escrow:forfeit:')) {
                const settled = entry.amountCents < 0n ? -entry.amountCents : entry.amountCents;
                heldEscrowCents = heldEscrowCents >= settled ? heldEscrowCents - settled : 0n;
            }
            else if (entry.referenceId.startsWith('reversal:')
                || entry.referenceId.startsWith('refund:')
                || entry.referenceId.startsWith('clawback:')) {
                // Explicit adjustment/refund/reversal/clawback reduces or restores earned total cleanly
                totalEarnedCents += entry.amountCents;
            }
            else if (entry.amountCents > 0n) {
                totalEarnedCents += entry.amountCents;
            }
        }
    }
    let pendingPayoutCents = 0n;
    let totalPaidOutCents = 0n;
    let totalReversedPayoutCents = 0n;
    for (const [payoutId, amount] of payoutReserved.entries()) {
        if (payoutFailed.has(payoutId) || payoutReversed.has(payoutId)) {
            totalReversedPayoutCents += amount;
        }
        else if (payoutSettled.has(payoutId)) {
            totalPaidOutCents += amount;
        }
        else {
            pendingPayoutCents += amount;
        }
    }
    return {
        channelId,
        currency: exports.LEDGER_CURRENCY,
        availableBalanceCents: runningBalance,
        pendingPayoutCents,
        heldEscrowCents,
        totalEarnedCents,
        totalPaidOutCents,
        totalReversedPayoutCents,
        transactionCount: entries.length,
        integrityVerified,
        ...(integrityError ? { integrityError } : {}),
    };
}
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * Prisma-backed immutable ledger repository using PostgreSQL row-level locking
 * (SELECT ... FOR UPDATE on Channel) inside SERIALIZABLE/ACID transactions.
 */
class PrismaWalletLedgerRepository {
    prismaClient;
    constructor(prismaClient = database_1.db) {
        this.prismaClient = prismaClient;
    }
    async withChannelLock(channelId, fn) {
        if (!UUID_REGEX.test(channelId)) {
            throw new LedgerValidationError('Invalid channel identifier format.', 'INVALID_CHANNEL_ID', 400);
        }
        return this.prismaClient.$transaction(async (tx) => {
            if (typeof tx.$queryRaw === 'function') {
                const rows = await tx.$queryRaw `
          SELECT "id" FROM "Channel" WHERE "id" = ${channelId}::uuid FOR UPDATE
        `;
                if (!Array.isArray(rows) || rows.length === 0) {
                    throw new LedgerValidationError('Channel not found.', 'CHANNEL_NOT_FOUND', 404);
                }
            }
            else if (typeof tx.channel?.findUnique === 'function') {
                const channel = await tx.channel.findUnique({ where: { id: channelId }, select: { id: true } });
                if (!channel) {
                    throw new LedgerValidationError('Channel not found.', 'CHANNEL_NOT_FOUND', 404);
                }
            }
            const ctx = {
                async listEntries() {
                    return tx.walletTransaction.findMany({
                        where: { channelId },
                        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    });
                },
                async findByReferenceId(referenceId) {
                    return tx.walletTransaction.findUnique({
                        where: { referenceId },
                    });
                },
                async appendEntry(input) {
                    return tx.walletTransaction.create({
                        data: {
                            channelId: input.channelId,
                            transactionType: input.transactionType,
                            amountCents: input.amountCents,
                            balanceAfterCents: input.balanceAfterCents,
                            referenceId: input.referenceId,
                            status: input.status,
                            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
                        },
                    });
                },
            };
            return fn(ctx);
        });
    }
    async listChannelEntries(channelId) {
        return this.prismaClient.walletTransaction.findMany({
            where: { channelId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
    }
    async findEntryByReferenceId(referenceId) {
        return this.prismaClient.walletTransaction.findUnique({
            where: { referenceId },
        });
    }
}
exports.PrismaWalletLedgerRepository = PrismaWalletLedgerRepository;
/**
 * Thread/async-safe in-memory immutable ledger repository for unit & concurrency tests.
 * Uses per-channel async mutex locks and enforces referenceId uniqueness and immutability.
 */
class InMemoryWalletLedgerRepository {
    entries = [];
    channelLocks = new Map();
    validChannels;
    clockSeq = 0;
    constructor(validChannelIds) {
        this.validChannels = validChannelIds ? new Set(validChannelIds) : null;
    }
    registerChannel(channelId) {
        if (!this.validChannels) {
            this.validChannels = new Set();
        }
        this.validChannels.add(channelId);
    }
    async withChannelLock(channelId, fn) {
        const previous = this.channelLocks.get(channelId) || Promise.resolve();
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const chain = previous.then(() => gate);
        this.channelLocks.set(channelId, chain);
        await previous;
        try {
            if (this.validChannels && !this.validChannels.has(channelId)) {
                throw new LedgerValidationError('Channel not found.', 'CHANNEL_NOT_FOUND', 404);
            }
            const stagedEntries = [];
            const self = this;
            const ctx = {
                async listEntries() {
                    return [...self.entries.filter((e) => e.channelId === channelId), ...stagedEntries]
                        .sort(compareEntriesChronological);
                },
                async findByReferenceId(referenceId) {
                    return (stagedEntries.find((e) => e.referenceId === referenceId)
                        || self.entries.find((e) => e.referenceId === referenceId)
                        || null);
                },
                async appendEntry(input) {
                    const dup = stagedEntries.some((e) => e.referenceId === input.referenceId)
                        || self.entries.some((e) => e.referenceId === input.referenceId);
                    if (dup) {
                        const err = new Error(`Unique constraint failed on referenceId: ${input.referenceId}`);
                        err.code = 'P2002';
                        throw err;
                    }
                    self.clockSeq += 1;
                    const existingChannelEntries = [...self.entries.filter((e) => e.channelId === channelId), ...stagedEntries];
                    const minNextMs = existingChannelEntries.reduce((max, e) => Math.max(max, e.createdAt.getTime() + 1), Date.now());
                    const createdAt = input.createdAt && input.createdAt.getTime() >= minNextMs
                        ? input.createdAt
                        : new Date(minNextMs);
                    const record = {
                        id: node_crypto_1.default.randomUUID(),
                        channelId: input.channelId,
                        transactionType: input.transactionType,
                        amountCents: input.amountCents,
                        balanceAfterCents: input.balanceAfterCents,
                        referenceId: input.referenceId,
                        createdAt,
                        status: input.status,
                    };
                    stagedEntries.push(record);
                    return { ...record };
                },
            };
            const result = await fn(ctx);
            this.entries.push(...stagedEntries);
            return result;
        }
        finally {
            release();
        }
    }
    async listChannelEntries(channelId) {
        return this.entries
            .filter((e) => e.channelId === channelId)
            .sort(compareEntriesChronological)
            .map((e) => ({ ...e }));
    }
    async findEntryByReferenceId(referenceId) {
        const found = this.entries.find((e) => e.referenceId === referenceId);
        return found ? { ...found } : null;
    }
    getAllEntriesReadOnly() {
        return this.entries.map((e) => ({ ...e }));
    }
}
exports.InMemoryWalletLedgerRepository = InMemoryWalletLedgerRepository;
class WalletLedgerService {
    repo;
    constructor(repo = new PrismaWalletLedgerRepository()) {
        this.repo = repo;
    }
    async getChannelBalance(channelId) {
        const entries = await this.repo.listChannelEntries(channelId);
        return deriveChannelBalanceFromEntries(channelId, entries);
    }
    async getChannelLedger(channelId, options = {}) {
        const page = Math.max(1, Math.trunc(options.page ?? 1));
        const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 20)));
        const allEntries = await this.repo.listChannelEntries(channelId);
        const descending = [...allEntries].sort(compareEntriesChronological).reverse();
        const skip = (page - 1) * limit;
        return {
            items: descending.slice(skip, skip + limit),
            total: descending.length,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(descending.length / limit)),
        };
    }
    /**
     * Appends a verified REVENUE_CREDIT entry idempotently.
     * Duplicate referenceId returns the existing entry without double-crediting.
     */
    async creditRevenue(input) {
        const amountCents = parsePositiveBigIntAmount(input.amountCents, 'amountCents');
        const referenceId = input.referenceId.trim();
        if (!referenceId) {
            throw new LedgerValidationError('referenceId is required.', 'INVALID_REFERENCE', 400);
        }
        return this.repo.withChannelLock(input.channelId, async (ctx) => {
            const existing = await ctx.findByReferenceId(referenceId);
            if (existing) {
                if (existing.channelId !== input.channelId || existing.amountCents !== amountCents) {
                    throw new PayoutConflictError(`Reference "${referenceId}" already exists with different parameters.`, 'IDEMPOTENCY_CONFLICT');
                }
                return { entry: existing, duplicate: true };
            }
            const entries = await ctx.listEntries();
            const balance = deriveChannelBalanceFromEntries(input.channelId, entries);
            if (!balance.integrityVerified) {
                throw new LedgerIntegrityError(balance.integrityError || 'Ledger integrity check failed.');
            }
            const nextBalance = balance.availableBalanceCents + amountCents;
            const entry = await ctx.appendEntry({
                channelId: input.channelId,
                transactionType: 'REVENUE_CREDIT',
                amountCents,
                balanceAfterCents: nextBalance,
                referenceId,
                status: input.status ?? 'AVAILABLE',
                createdAt: nextMonotonicTimestamp(entries),
            });
            return { entry, duplicate: false };
        });
    }
    /**
     * Atomically reserves funds for a creator payout (PAYOUT PENDING).
     * Enforces available balance, positive integer precision, and optional configured threshold.
     */
    async reservePayout(input) {
        const amountCents = parsePositiveBigIntAmount(input.amountCents, 'amountCents');
        const payoutId = input.payoutId.trim();
        if (!payoutId) {
            throw new LedgerValidationError('payoutId is required.', 'INVALID_REFERENCE', 400);
        }
        if (input.minimumThresholdCents !== undefined && amountCents < input.minimumThresholdCents) {
            throw new LedgerValidationError(`Requested payout (${amountCents.toString()} ${exports.LEDGER_CURRENCY}) is below the configured minimum threshold (${input.minimumThresholdCents.toString()} ${exports.LEDGER_CURRENCY}).`, 'BELOW_MINIMUM_THRESHOLD', 400);
        }
        const referenceId = `payout:init:${payoutId}`;
        return this.repo.withChannelLock(input.channelId, async (ctx) => {
            const existing = await ctx.findByReferenceId(referenceId);
            if (existing) {
                if (existing.amountCents !== -amountCents) {
                    throw new PayoutConflictError(`Payout "${payoutId}" already exists with a different amount.`, 'IDEMPOTENCY_CONFLICT');
                }
                return { entry: existing, balanceAfterCents: existing.balanceAfterCents, duplicate: true };
            }
            const entries = await ctx.listEntries();
            const balance = deriveChannelBalanceFromEntries(input.channelId, entries);
            if (!balance.integrityVerified) {
                throw new LedgerIntegrityError(balance.integrityError || 'Ledger integrity check failed.');
            }
            if (balance.availableBalanceCents < amountCents) {
                throw new InsufficientFundsError(balance.availableBalanceCents, amountCents);
            }
            const nextBalance = balance.availableBalanceCents - amountCents;
            const entry = await ctx.appendEntry({
                channelId: input.channelId,
                transactionType: 'PAYOUT',
                amountCents: -amountCents,
                balanceAfterCents: nextBalance,
                referenceId,
                status: 'PENDING',
                createdAt: nextMonotonicTimestamp(entries),
            });
            return { entry, balanceAfterCents: nextBalance, duplicate: false };
        });
    }
    /**
     * Finalizes a reserved payout upon VERIFIED provider completion.
     * Appends an immutable PAID marker entry (0n delta) without mutating historical entries.
     */
    async finalizePayoutSuccess(input) {
        const payoutId = input.payoutId.trim();
        const initRef = `payout:init:${payoutId}`;
        const settledRef = `payout:settled:${payoutId}`;
        const failedRef = `payout:failed:${payoutId}`;
        return this.repo.withChannelLock(input.channelId, async (ctx) => {
            const existingSettled = await ctx.findByReferenceId(settledRef);
            if (existingSettled) {
                return { entry: existingSettled, alreadyFinalized: true };
            }
            const existingFailed = await ctx.findByReferenceId(failedRef);
            if (existingFailed) {
                throw new PayoutConflictError(`Cannot mark payout "${payoutId}" as PAID because it was already finalized as FAILED.`, 'PAYOUT_ALREADY_FAILED');
            }
            const initEntry = await ctx.findByReferenceId(initRef);
            if (!initEntry) {
                throw new LedgerValidationError(`Payout reservation "${payoutId}" not found.`, 'PAYOUT_NOT_FOUND', 404);
            }
            const entries = await ctx.listEntries();
            const balance = deriveChannelBalanceFromEntries(input.channelId, entries);
            if (!balance.integrityVerified) {
                throw new LedgerIntegrityError(balance.integrityError || 'Ledger integrity check failed.');
            }
            const entry = await ctx.appendEntry({
                channelId: input.channelId,
                transactionType: 'PAYOUT',
                amountCents: 0n,
                balanceAfterCents: balance.availableBalanceCents,
                referenceId: settledRef,
                status: 'PAID',
                createdAt: nextMonotonicTimestamp(entries),
            });
            return { entry, alreadyFinalized: false };
        });
    }
    /**
     * Records verified payout failure and appends an immutable reversing ADJUSTMENT entry
     * restoring creator funds atomically. Idempotent on retry/duplicate webhooks.
     */
    async failAndReversePayout(input) {
        const payoutId = input.payoutId.trim();
        const initRef = `payout:init:${payoutId}`;
        const settledRef = `payout:settled:${payoutId}`;
        const failedRef = `payout:failed:${payoutId}`;
        const reversalRef = `payout:reversal:${payoutId}`;
        return this.repo.withChannelLock(input.channelId, async (ctx) => {
            const existingFailed = await ctx.findByReferenceId(failedRef);
            const existingReversal = await ctx.findByReferenceId(reversalRef);
            if (existingFailed && existingReversal) {
                return {
                    failedEntry: existingFailed,
                    reversalEntry: existingReversal,
                    alreadyReversed: true,
                };
            }
            const existingSettled = await ctx.findByReferenceId(settledRef);
            if (existingSettled) {
                throw new PayoutConflictError(`Cannot reverse payout "${payoutId}" because it is already settled as PAID.`, 'PAYOUT_ALREADY_SETTLED');
            }
            const initEntry = await ctx.findByReferenceId(initRef);
            if (!initEntry) {
                throw new LedgerValidationError(`Payout reservation "${payoutId}" not found.`, 'PAYOUT_NOT_FOUND', 404);
            }
            const entries = await ctx.listEntries();
            const balance = deriveChannelBalanceFromEntries(input.channelId, entries);
            if (!balance.integrityVerified) {
                throw new LedgerIntegrityError(balance.integrityError || 'Ledger integrity check failed.');
            }
            const restoreAmount = initEntry.amountCents < 0n ? -initEntry.amountCents : initEntry.amountCents;
            const failedEntry = existingFailed ?? await ctx.appendEntry({
                channelId: input.channelId,
                transactionType: 'PAYOUT',
                amountCents: 0n,
                balanceAfterCents: balance.availableBalanceCents,
                referenceId: failedRef,
                status: 'FAILED',
                createdAt: nextMonotonicTimestamp(entries, 0),
            });
            const reversalEntry = existingReversal ?? await ctx.appendEntry({
                channelId: input.channelId,
                transactionType: 'ADJUSTMENT',
                amountCents: restoreAmount,
                balanceAfterCents: balance.availableBalanceCents + restoreAmount,
                referenceId: reversalRef,
                status: 'AVAILABLE',
                createdAt: nextMonotonicTimestamp(entries, 1),
            });
            return { failedEntry, reversalEntry, alreadyReversed: false };
        });
    }
    /**
     * Appends an explicit immutable reversal or refund adjustment entry.
     */
    async recordAdjustmentOrReversal(input) {
        if (input.deltaCents === 0n) {
            throw new LedgerValidationError('Adjustment delta cannot be zero.', 'INVALID_AMOUNT', 400);
        }
        const referenceId = input.referenceId.trim();
        if (!referenceId) {
            throw new LedgerValidationError('referenceId is required.', 'INVALID_REFERENCE', 400);
        }
        return this.repo.withChannelLock(input.channelId, async (ctx) => {
            const existing = await ctx.findByReferenceId(referenceId);
            if (existing) {
                if (existing.amountCents !== input.deltaCents) {
                    throw new PayoutConflictError(`Adjustment reference "${referenceId}" already exists with a different delta.`, 'IDEMPOTENCY_CONFLICT');
                }
                return { entry: existing, duplicate: true };
            }
            const entries = await ctx.listEntries();
            const balance = deriveChannelBalanceFromEntries(input.channelId, entries);
            if (!balance.integrityVerified) {
                throw new LedgerIntegrityError(balance.integrityError || 'Ledger integrity check failed.');
            }
            const nextBalance = balance.availableBalanceCents + input.deltaCents;
            if (nextBalance < 0n && !input.allowNegativeBalance) {
                throw new InsufficientFundsError(balance.availableBalanceCents, -input.deltaCents);
            }
            const entry = await ctx.appendEntry({
                channelId: input.channelId,
                transactionType: 'ADJUSTMENT',
                amountCents: input.deltaCents,
                balanceAfterCents: nextBalance,
                referenceId,
                status: input.status ?? 'AVAILABLE',
                createdAt: nextMonotonicTimestamp(entries),
            });
            return { entry, duplicate: false };
        });
    }
    /**
     * Places an immutable escrow HOLD (negative debit from available balance) or releases it.
     */
    async placeEscrowHold(input) {
        const amountCents = parsePositiveBigIntAmount(input.amountCents, 'amountCents');
        const referenceId = `escrow:hold:${input.claimId}`;
        return this.repo.withChannelLock(input.channelId, async (ctx) => {
            const existing = await ctx.findByReferenceId(referenceId);
            if (existing) {
                return { entry: existing, duplicate: true };
            }
            const entries = await ctx.listEntries();
            const balance = deriveChannelBalanceFromEntries(input.channelId, entries);
            if (!balance.integrityVerified) {
                throw new LedgerIntegrityError(balance.integrityError || 'Ledger integrity check failed.');
            }
            if (balance.availableBalanceCents < amountCents) {
                throw new InsufficientFundsError(balance.availableBalanceCents, amountCents);
            }
            const entry = await ctx.appendEntry({
                channelId: input.channelId,
                transactionType: 'HOLD',
                amountCents: -amountCents,
                balanceAfterCents: balance.availableBalanceCents - amountCents,
                referenceId,
                status: 'PENDING',
                createdAt: nextMonotonicTimestamp(entries),
            });
            return { entry, duplicate: false };
        });
    }
}
exports.WalletLedgerService = WalletLedgerService;
