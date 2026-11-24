import crypto from 'node:crypto';
import { db as defaultPrisma } from '@watchtube/database';
import {
  InsufficientFundsError,
  LEDGER_CURRENCY,
  LedgerValidationError,
  parsePositiveBigIntAmount,
  WalletLedgerService,
} from '../finance/ledger.service';
import { emitFinancialNotificationEvent } from '../finance/financialEvents';
import { recordAuditEvent } from '../audit.service';
import { hashMsisdn, maskMsisdn, normalizeRwandaMsisdn } from './msisdn';
import {
  GatewayStatus,
  IMobileMoneyGatewayAdapter,
  UnconfiguredMobileMoneyAdapter,
} from './mockAdapters';
import {
  IPaymentTransactionStore,
  InMemoryPaymentTransactionStore,
  PaymentIdempotencyConflictError,
  PaymentTransactionRecord,
  WebhookProcessingMetadata,
} from './paymentStore';
import { PrismaPaymentTransactionStore } from './prismaPaymentStore';
import { MobileMoneyProviderName } from './types';

export interface CreatorPayoutEligibilityResult {
  eligible: boolean;
  channelId?: string;
  reason?: string;
  statusCode?: number;
}

export interface CreatorPayoutEligibilityChecker {
  checkEligibility(userId: string): Promise<CreatorPayoutEligibilityResult>;
}

export interface PaymentOrchestratorOptions {
  ledger: WalletLedgerService;
  store?: IPaymentTransactionStore;
  adapters?: Partial<Record<MobileMoneyProviderName, IMobileMoneyGatewayAdapter>>;
  eligibilityChecker?: CreatorPayoutEligibilityChecker;
  /**
   * Optional explicit payout minimum threshold in RWF minor units.
   * Must come from approved configuration; never defaulted or invented.
   */
  minimumPayoutThresholdCents?: bigint;
  timeoutMs?: number;
  auditRecorder?: typeof recordAuditEvent;
}

export class OrchestratorError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const TERMINAL_STATES: ReadonlySet<GatewayStatus> = new Set([
  'PAID',
  'FAILED',
  'REVERSED',
  'REFUNDED',
]);

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        const err: any = new Error(`${label} timed out after ${timeoutMs}ms`);
        err.code = 'PROVIDER_TIMEOUT';
        reject(err);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

export function createPrismaPayoutEligibilityChecker(prismaClient: any = defaultPrisma): CreatorPayoutEligibilityChecker {
  return {
    async checkEligibility(userId: string): Promise<CreatorPayoutEligibilityResult> {
      const channel = await prismaClient.channel.findFirst({
        where: { userId },
        select: {
          id: true,
          isMonetized: true,
          user: {
            select: {
              id: true,
              status: true,
              strikes: {
                where: {
                  expiresAt: { gt: new Date() },
                  strikeType: { in: ['MONETIZATION_HOLD', 'SUSPENSION'] },
                },
                select: { id: true, strikeType: true },
                take: 1,
              },
            },
          },
        },
      });

      if (!channel) {
        return { eligible: false, reason: 'Creator channel not found.', statusCode: 404 };
      }
      if (!channel.isMonetized) {
        return { eligible: false, channelId: channel.id, reason: 'Channel is not approved for monetization in WTPP.', statusCode: 403 };
      }
      if (channel.user?.status === 'RESTRICTED' || channel.user?.status === 'SUSPENDED') {
        return { eligible: false, channelId: channel.id, reason: 'Creator account is restricted or suspended.', statusCode: 403 };
      }
      if (Array.isArray(channel.user?.strikes) && channel.user.strikes.length > 0) {
        return { eligible: false, channelId: channel.id, reason: 'Creator has active monetization strikes or holds.', statusCode: 403 };
      }
      return { eligible: true, channelId: channel.id };
    },
  };
}

export class PaymentOrchestratorService {
  private readonly adapters = new Map<MobileMoneyProviderName, IMobileMoneyGatewayAdapter>();
  private readonly store: IPaymentTransactionStore;
  private readonly ledger: WalletLedgerService;
  private readonly eligibilityChecker: CreatorPayoutEligibilityChecker;
  private readonly minimumPayoutThresholdCents?: bigint;
  private readonly timeoutMs: number;
  private readonly auditRecorder: typeof recordAuditEvent;

  constructor(options: PaymentOrchestratorOptions) {
    this.ledger = options.ledger;
    this.store =
      options.store ??
      (process.env.NODE_ENV === 'test'
        ? new InMemoryPaymentTransactionStore()
        : new PrismaPaymentTransactionStore());
    this.eligibilityChecker = options.eligibilityChecker ?? createPrismaPayoutEligibilityChecker();
    this.minimumPayoutThresholdCents = options.minimumPayoutThresholdCents;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.auditRecorder = options.auditRecorder ?? recordAuditEvent;

    this.adapters.set(
      'MTN_MOMO',
      options.adapters?.MTN_MOMO ?? new UnconfiguredMobileMoneyAdapter('MTN_MOMO', 'MTN Mobile Money')
    );
    this.adapters.set(
      'AIRTEL_MONEY',
      options.adapters?.AIRTEL_MONEY ?? new UnconfiguredMobileMoneyAdapter('AIRTEL_MONEY', 'Airtel Money')
    );
  }

  registerAdapter(adapter: IMobileMoneyGatewayAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  getAdapter(provider: MobileMoneyProviderName): IMobileMoneyGatewayAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new OrchestratorError(`Unknown payment provider "${provider}".`, 'UNKNOWN_PROVIDER', 400);
    }
    return adapter;
  }

  getProvidersStatus() {
    return Array.from(this.adapters.values()).map((adapter) => {
      const readinessStatus =
        adapter.mode === 'UNCONFIGURED'
          ? ('BLOCKED' as const)
          : adapter.mode === 'MOCK_SANDBOX'
            ? ('MOCK_SANDBOX' as const)
            : ('IMPLEMENTED_UNVERIFIED' as const);
      const blockers =
        adapter.mode === 'UNCONFIGURED'
          ? [
              `Verified ${adapter.displayName} API transport and sandbox/live credentials are not configured.`,
              `Official ${adapter.displayName} callback signature verification spec and merchant approval are required.`,
            ]
          : [];
      return {
        provider: adapter.providerId,
        displayName: adapter.displayName,
        configured: adapter.isConfigured(),
        mode: adapter.mode,
        readinessStatus,
        blockers,
        capabilities: { ...adapter.capabilities },
      };
    });
  }

  /**
   * Initiates a creator payout using immutable ledger reservation + idempotency.
   * NEVER marks payout as PAID on initiation.
   */
  async initiateCreatorPayout(input: {
    userId: string;
    provider: MobileMoneyProviderName;
    amountCents: unknown;
    currency?: string;
    phoneNumber: string;
    idempotencyKey: string;
    narrative?: string;
  }): Promise<{
    transaction: PaymentTransactionRecord;
    idempotentReplay: boolean;
    balanceAfterCents?: bigint;
  }> {
    if (input.currency !== undefined && input.currency !== LEDGER_CURRENCY) {
      throw new OrchestratorError(`Only ${LEDGER_CURRENCY} payouts are supported.`, 'UNSUPPORTED_CURRENCY', 400);
    }

    const amountCents = parsePositiveBigIntAmount(input.amountCents, 'amountCents');
    const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    if (!idempotencyKey) {
      throw new OrchestratorError('idempotencyKey is required.', 'INVALID_IDEMPOTENCY_KEY', 400);
    }

    const adapter = this.getAdapter(input.provider);
    if (!adapter.isConfigured() || !adapter.capabilities.disbursements) {
      throw new OrchestratorError(
        'Payouts are unavailable until a verified payment-provider integration is configured.',
        'PROVIDER_UNCONFIGURED',
        501
      );
    }

    const normalizedMsisdn = normalizeRwandaMsisdn(input.phoneNumber);
    const msisdnHash = hashMsisdn(normalizedMsisdn);
    const maskedPhone = maskMsisdn(normalizedMsisdn);

    const eligibility = await this.eligibilityChecker.checkEligibility(input.userId);
    if (!eligibility.eligible || !eligibility.channelId) {
      throw new OrchestratorError(
        eligibility.reason || 'Creator channel is not eligible for payouts.',
        'PAYOUT_INELIGIBLE',
        eligibility.statusCode || 403
      );
    }
    const channelId = eligibility.channelId;

    return this.store.withIdempotencyLock(`PAYOUT:${channelId}:${idempotencyKey}`, async () => {
      const existing = await this.store.findByIdempotencyKey('PAYOUT', channelId, idempotencyKey);
      if (existing) {
        if (
          existing.amountCents !== amountCents
          || existing.provider !== input.provider
          || existing.msisdnHash !== msisdnHash
        ) {
          throw new OrchestratorError(
            'Idempotency key was already used with different payout parameters.',
            'IDEMPOTENCY_CONFLICT',
            409
          );
        }
        return { transaction: existing, idempotentReplay: true };
      }

      const payoutId = crypto.randomUUID();

      // 1. Reserve funds atomically in immutable ledger BEFORE external provider call
      const reservation = await this.ledger.reservePayout({
        channelId,
        payoutId,
        amountCents,
        minimumThresholdCents: this.minimumPayoutThresholdCents,
      });

      const now = new Date();
      const record: PaymentTransactionRecord = {
        transactionId: payoutId,
        kind: 'PAYOUT',
        provider: input.provider,
        ownerScope: channelId,
        channelId,
        userId: input.userId,
        amountCents,
        currency: LEDGER_CURRENCY,
        msisdnHash,
        maskedPhone,
        idempotencyKey,
        providerReference: '',
        status: 'PENDING',
        reconciliationRequired: false,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.store.save(record);
      } catch (err) {
        if (err instanceof PaymentIdempotencyConflictError) {
          // Cross-process duplicate idempotency race: reverse tentative reservation safely.
          await this.ledger.failAndReversePayout({ channelId, payoutId });
          const winner = await this.store.findByIdempotencyKey('PAYOUT', channelId, idempotencyKey);
          if (winner) {
            if (
              winner.amountCents !== amountCents
              || winner.provider !== input.provider
              || winner.msisdnHash !== msisdnHash
            ) {
              throw new OrchestratorError(
                'Idempotency key was already used with different payout parameters.',
                'IDEMPOTENCY_CONFLICT',
                409
              );
            }
            return { transaction: winner, idempotentReplay: true };
          }
        }
        throw err;
      }

      await this.auditRecorder({
        actorId: input.userId,
        actorRole: 'CREATOR',
        action: 'WALLET_PAYOUT_INITIATED',
        targetResource: 'PAYOUT',
        targetId: payoutId,
        outcome: 'SUCCESS',
        metadata: {
          channelId,
          provider: input.provider,
          amountCents: amountCents.toString(),
          currency: LEDGER_CURRENCY,
          maskedPhone,
        },
      });

      // 2. Call external provider with bounded timeout
      try {
        const providerResp = await runWithTimeout(
          adapter.initiatePayout({
            internalReference: payoutId,
            idempotencyKey,
            channelId,
            amountCents,
            currency: LEDGER_CURRENCY,
            phoneNumber: normalizedMsisdn,
            narrative: input.narrative || 'WatchTube Creator Payout',
          }),
          this.timeoutMs,
          adapter.displayName
        );

        record.providerReference = providerResp.providerReference;
        record.providerTransactionId = providerResp.providerTransactionId;
        record.updatedAt = new Date();

        if (!providerResp.accepted || providerResp.status === 'FAILED') {
          // Synchronous provider rejection -> append immutable failure + reversal restoring funds
          await this.ledger.failAndReversePayout({ channelId, payoutId });
          record.status = 'FAILED';
          record.failureReason = providerResp.failureReason || 'Provider rejected payout request.';
          record.finalizedAt = new Date();
          await this.store.save(record);

          await this.auditRecorder({
            actorId: input.userId,
            actorRole: 'CREATOR',
            action: 'WALLET_PAYOUT_FAILED_AND_REVERSED',
            targetResource: 'PAYOUT',
            targetId: payoutId,
            outcome: 'FAILED',
            metadata: {
              channelId,
              provider: input.provider,
              amountCents: amountCents.toString(),
              reason: record.failureReason,
            },
          });

          throw new OrchestratorError(
            record.failureReason,
            providerResp.failureCode || 'PROVIDER_REJECTED',
            502
          );
        }

        // Initiation ALWAYS remains PENDING until verified webhook or status poll confirms completion
        record.status = 'PENDING';
        await this.store.save(record);

        void emitFinancialNotificationEvent({
          eventId: crypto.randomUUID(),
          eventType: 'WITHDRAWAL_REQUESTED',
          payoutId: record.transactionId,
          channelId,
          creatorUserId: input.userId,
          amountCents: record.amountCents,
          currency: LEDGER_CURRENCY,
          provider: record.provider,
          recipientPhoneMasked: record.maskedPhone,
          idempotencyKey: record.idempotencyKey,
          timestamp: record.createdAt,
        });

        return {
          transaction: record,
          idempotentReplay: false,
          balanceAfterCents: reservation.balanceAfterCents,
        };
      } catch (err: any) {
        if (err instanceof OrchestratorError) {
          throw err;
        }
        // Ambiguous timeout or transient outage: keep funds reserved & mark reconciliationRequired
        // so status polling or verified webhook resolves without double-spending or losing funds.
        record.reconciliationRequired = true;
        record.failureReason = err?.message || 'Provider timeout or transient outage';
        record.updatedAt = new Date();
        await this.store.save(record);

        return {
          transaction: record,
          idempotentReplay: false,
          balanceAfterCents: reservation.balanceAfterCents,
        };
      }
    });
  }

  /**
   * Initiates an inbound Mobile Money payment (collection).
   * Initiation NEVER marks payment as PAID or credits wallet balances.
   */
  async initiatePayment(input: {
    userId: string;
    channelId?: string;
    provider: MobileMoneyProviderName;
    amountCents: unknown;
    currency?: string;
    phoneNumber: string;
    idempotencyKey: string;
    description: string;
  }): Promise<{ transaction: PaymentTransactionRecord; idempotentReplay: boolean }> {
    if (input.currency !== undefined && input.currency !== LEDGER_CURRENCY) {
      throw new OrchestratorError(`Only ${LEDGER_CURRENCY} payments are supported.`, 'UNSUPPORTED_CURRENCY', 400);
    }

    const amountCents = parsePositiveBigIntAmount(input.amountCents, 'amountCents');
    const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    if (!idempotencyKey) {
      throw new OrchestratorError('idempotencyKey is required.', 'INVALID_IDEMPOTENCY_KEY', 400);
    }

    const adapter = this.getAdapter(input.provider);
    if (!adapter.isConfigured() || !adapter.capabilities.collections) {
      throw new OrchestratorError(
        'Payments are unavailable until a verified payment-provider integration is configured.',
        'PROVIDER_UNCONFIGURED',
        501
      );
    }

    const normalizedMsisdn = normalizeRwandaMsisdn(input.phoneNumber);
    const msisdnHash = hashMsisdn(normalizedMsisdn);
    const maskedPhone = maskMsisdn(normalizedMsisdn);

    return this.store.withIdempotencyLock(`PAYMENT:${input.userId}:${idempotencyKey}`, async () => {
      const existing = await this.store.findByIdempotencyKey('PAYMENT', input.userId, idempotencyKey);
      if (existing) {
        if (
          existing.amountCents !== amountCents
          || existing.provider !== input.provider
          || existing.msisdnHash !== msisdnHash
        ) {
          throw new OrchestratorError(
            'Idempotency key was already used with different payment parameters.',
            'IDEMPOTENCY_CONFLICT',
            409
          );
        }
        return { transaction: existing, idempotentReplay: true };
      }

      const paymentId = crypto.randomUUID();
      const now = new Date();
      const record: PaymentTransactionRecord = {
        transactionId: paymentId,
        kind: 'PAYMENT',
        provider: input.provider,
        ownerScope: input.userId,
        channelId: input.channelId,
        userId: input.userId,
        amountCents,
        currency: LEDGER_CURRENCY,
        msisdnHash,
        maskedPhone,
        idempotencyKey,
        providerReference: '',
        status: 'PENDING',
        reconciliationRequired: false,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await this.store.save(record);
      } catch (err) {
        if (err instanceof PaymentIdempotencyConflictError) {
          const winner = await this.store.findByIdempotencyKey('PAYMENT', input.userId, idempotencyKey);
          if (winner) {
            if (
              winner.amountCents !== amountCents
              || winner.provider !== input.provider
              || winner.msisdnHash !== msisdnHash
            ) {
              throw new OrchestratorError(
                'Idempotency key was already used with different payment parameters.',
                'IDEMPOTENCY_CONFLICT',
                409
              );
            }
            return { transaction: winner, idempotentReplay: true };
          }
        }
        throw err;
      }

      const providerResp = await runWithTimeout(
        adapter.initiatePayment({
          internalReference: paymentId,
          idempotencyKey,
          amountCents,
          currency: LEDGER_CURRENCY,
          phoneNumber: normalizedMsisdn,
          description: input.description,
        }),
        this.timeoutMs,
        adapter.displayName
      ).catch((err: any) => ({
        accepted: false,
        status: 'FAILED' as const,
        providerReference: '',
        providerTransactionId: undefined as string | undefined,
        failureReason: err?.message || 'Provider unavailable',
        _transient: err?.code === 'PROVIDER_TIMEOUT' || err?.retryable === true,
      }));

      record.providerReference = providerResp.providerReference;
      record.providerTransactionId = providerResp.providerTransactionId;
      record.updatedAt = new Date();
      if (!providerResp.accepted && !(providerResp as any)._transient) {
        record.status = 'FAILED';
        record.failureReason = providerResp.failureReason;
        record.finalizedAt = new Date();
        await this.store.save(record);
        throw new OrchestratorError(
          record.failureReason || 'Payment initiation rejected by provider.',
          'PROVIDER_REJECTED',
          502
        );
      }

      if ((providerResp as any)._transient) {
        record.reconciliationRequired = true;
        record.failureReason = providerResp.failureReason;
      }

      await this.store.save(record);
      return { transaction: record, idempotentReplay: false };
    });
  }

  /**
   * Processes a verified provider webhook callback with strict signature checks,
   * amount/currency validation, idempotency, and immutable ledger finality.
   */
  async processWebhook(input: {
    provider: MobileMoneyProviderName;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string | Buffer;
    parsedBody: unknown;
  }): Promise<{
    accepted: boolean;
    idempotent: boolean;
    status: GatewayStatus;
    transactionId: string;
  }> {
    const adapter = this.getAdapter(input.provider);
    const verification = await adapter.verifyAndParseWebhook(
      input.headers,
      input.rawBody,
      input.parsedBody
    );

    if (!verification.valid || !verification.event) {
      if (verification.errorCode === 'UNCONFIGURED_VERIFIER') {
        throw new OrchestratorError(
          verification.reason || 'Webhook verifier not configured.',
          'UNCONFIGURED_VERIFIER',
          501
        );
      }
      if (verification.errorCode === 'INVALID_PAYLOAD') {
        throw new OrchestratorError(
          verification.reason || 'Invalid webhook payload.',
          'INVALID_PAYLOAD',
          400
        );
      }
      throw new OrchestratorError(
        verification.reason || 'Webhook signature verification failed.',
        verification.errorCode || 'INVALID_SIGNATURE',
        401
      );
    }

    const event = verification.event;
    if (event.currency && event.currency !== LEDGER_CURRENCY) {
      throw new OrchestratorError(
        `Currency mismatch: expected ${LEDGER_CURRENCY}, got ${event.currency}.`,
        'CURRENCY_MISMATCH',
        400
      );
    }

    const rawBytes =
      typeof input.rawBody === 'string'
        ? input.rawBody.length > 0
          ? Buffer.from(input.rawBody, 'utf8')
          : Buffer.from(JSON.stringify(input.parsedBody ?? {}), 'utf8')
        : input.rawBody.length > 0
          ? input.rawBody
          : Buffer.from(JSON.stringify(input.parsedBody ?? {}), 'utf8');
    const payloadSha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');

    return this.store.withIdempotencyLock(
      `WEBHOOK:${input.provider}:${event.webhookEventId}`,
      async () => {
        if (await this.store.hasProcessedWebhook(input.provider, event.webhookEventId)) {
          const matched = await this.findRecordForEvent(input.provider, event.providerReference, event.internalReference);
          return {
            accepted: true,
            idempotent: true,
            status: matched?.status ?? event.status,
            transactionId: matched?.transactionId ?? event.providerReference,
          };
        }

        const record = await this.findRecordForEvent(
          input.provider,
          event.providerReference,
          event.internalReference
        );
        if (!record) {
          throw new OrchestratorError('Payment transaction not found for webhook.', 'TRANSACTION_NOT_FOUND', 404);
        }

        if (event.amountCents !== undefined && event.amountCents !== record.amountCents) {
          throw new OrchestratorError(
            'Webhook amount does not match initiated transaction amount.',
            'AMOUNT_MISMATCH',
            400
          );
        }

        const result = await this.applyVerifiedStatusTransition(record, event.status, event.failureReason);
        const webhookMeta: WebhookProcessingMetadata = {
          payloadSha256,
          providerReference: event.providerReference || result.record.providerReference,
          transactionId: result.record.transactionId,
          reportedStatus: event.status,
          signatureVerified: true,
        };
        const newlyMarked = await this.store.markWebhookProcessed(input.provider, event.webhookEventId, webhookMeta);

        return {
          accepted: true,
          idempotent: result.alreadyTerminal || !newlyMarked,
          status: result.record.status,
          transactionId: result.record.transactionId,
        };
      }
    );
  }

  /**
   * Queries provider status (bounded timeout) and reconciles any pending/timed-out transaction.
   */
  async reconcileTransaction(
    transactionId: string,
    actor: { id: string; role: string }
  ): Promise<PaymentTransactionRecord> {
    const record = await this.store.findByTransactionId(transactionId);
    if (!record) {
      throw new OrchestratorError('Transaction not found.', 'TRANSACTION_NOT_FOUND', 404);
    }
    if (TERMINAL_STATES.has(record.status) && !record.reconciliationRequired) {
      return record;
    }

    const adapter = this.getAdapter(record.provider);
    if (!adapter.isConfigured() || !adapter.capabilities.statusLookup) {
      throw new OrchestratorError(
        `${adapter.displayName} status lookup is not configured.`,
        'PROVIDER_UNCONFIGURED',
        501
      );
    }

    const refToCheck = record.providerReference || record.idempotencyKey;
    const statusResult = await runWithTimeout(
      adapter.lookupStatus(refToCheck),
      this.timeoutMs,
      adapter.displayName
    );

    if (statusResult.amountCents !== undefined && statusResult.amountCents !== record.amountCents) {
      throw new OrchestratorError('Provider status lookup returned mismatched amount.', 'AMOUNT_MISMATCH', 502);
    }

    const updated = await this.applyVerifiedStatusTransition(
      record,
      statusResult.status,
      statusResult.failureReason
    );

    await this.auditRecorder({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'PAYMENT_RECONCILED',
      targetResource: 'PAYMENT_TRANSACTION',
      targetId: record.transactionId,
      outcome: 'SUCCESS',
      metadata: {
        provider: record.provider,
        status: updated.record.status,
      },
    });

    return updated.record;
  }

  /**
   * Initiates a refund or reversal where supported by the provider adapter.
   */
  async initiateRefundOrReversal(input: {
    transactionId: string;
    reason: string;
    idempotencyKey: string;
    actor: { id: string; role: string };
  }): Promise<PaymentTransactionRecord> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new LedgerValidationError('Idempotency key is required for refund/reversal.', 'MISSING_IDEMPOTENCY_KEY', 400);
    }

    const initialOriginal = await this.store.findByTransactionId(input.transactionId);
    if (!initialOriginal) {
      throw new OrchestratorError('Original transaction not found.', 'TRANSACTION_NOT_FOUND', 404);
    }
    const refundOwnerScope = initialOriginal.channelId || initialOriginal.userId;

    return this.store.withIdempotencyLock(`REFUND:${refundOwnerScope}:${idempotencyKey}`, async () => {
      const existingRefund = await this.store.findByIdempotencyKey('REFUND', refundOwnerScope, idempotencyKey);
      if (existingRefund) {
        if (existingRefund.parentTransactionId !== input.transactionId) {
          throw new OrchestratorError(
            'Refund idempotency key was already used for a different transaction.',
            'IDEMPOTENCY_CONFLICT',
            409
          );
        }
        const reloadedOriginal = await this.store.findByTransactionId(input.transactionId);
        return reloadedOriginal ?? existingRefund;
      }

      const original = await this.store.findByTransactionId(input.transactionId);
      if (!original) {
        throw new OrchestratorError('Original transaction not found.', 'TRANSACTION_NOT_FOUND', 404);
      }
      if (original.status !== 'PAID') {
        throw new OrchestratorError(
          `Only PAID transactions can be refunded/reversed (current: ${original.status}).`,
          'INVALID_TRANSACTION_STATE',
          409
        );
      }

      const adapter = this.getAdapter(original.provider);
      if (!adapter.isConfigured()) {
        throw new OrchestratorError(`${adapter.displayName} is not configured.`, 'PROVIDER_UNCONFIGURED', 501);
      }
      if (!adapter.capabilities.refunds && !adapter.capabilities.reversals) {
        throw new OrchestratorError(
          `${adapter.displayName} does not support refunds or reversals.`,
          'UNSUPPORTED_OPERATION',
          501
        );
      }

      if (original.channelId && original.kind === 'PAYMENT') {
        const currentBalance = await this.ledger.getChannelBalance(original.channelId);
        if (currentBalance.availableBalanceCents < original.amountCents) {
          throw new InsufficientFundsError(currentBalance.availableBalanceCents, original.amountCents);
        }
      }

      const refundId = crypto.randomUUID();
      const res = await runWithTimeout(
        adapter.initiateRefundOrReversal({
          originalInternalReference: original.transactionId,
          originalProviderReference: original.providerReference,
          refundInternalReference: refundId,
          idempotencyKey,
          amountCents: original.amountCents,
          currency: LEDGER_CURRENCY,
          reason: input.reason,
        }),
        this.timeoutMs,
        adapter.displayName
      );

      if (!res.accepted) {
        throw new OrchestratorError(
          res.failureReason || 'Provider rejected refund/reversal.',
          'PROVIDER_REJECTED',
          502
        );
      }

      // Apply immutable ledger reversal BEFORE marking transaction refunded/reversed in store
      if (original.channelId && original.kind === 'PAYMENT') {
        await this.ledger.recordAdjustmentOrReversal({
          channelId: original.channelId,
          referenceId: `refund:${original.transactionId}`,
          deltaCents: -original.amountCents,
          status: 'AVAILABLE',
        });
      } else if (original.channelId && original.kind === 'PAYOUT') {
        await this.ledger.recordAdjustmentOrReversal({
          channelId: original.channelId,
          referenceId: `payout:reversal:${original.transactionId}`,
          deltaCents: original.amountCents,
          status: 'AVAILABLE',
        });
      }

      const now = new Date();
      const targetStatus: GatewayStatus = original.kind === 'PAYMENT' ? 'REFUNDED' : 'REVERSED';
      original.status = targetStatus;
      original.failureReason = input.reason;
      original.updatedAt = now;
      original.finalizedAt = now;
      await this.store.save(original);

      const refundChild: PaymentTransactionRecord = {
        transactionId: refundId,
        kind: 'REFUND',
        provider: original.provider,
        ownerScope: refundOwnerScope,
        channelId: original.channelId,
        userId: original.userId,
        amountCents: original.amountCents,
        currency: LEDGER_CURRENCY,
        msisdnHash: original.msisdnHash,
        maskedPhone: original.maskedPhone,
        idempotencyKey,
        providerReference: res.providerReference || '',
        status: 'PAID',
        reconciliationRequired: false,
        failureReason: input.reason,
        parentTransactionId: original.transactionId,
        createdAt: now,
        updatedAt: now,
        finalizedAt: now,
      };
      await this.store.save(refundChild);

      await this.auditRecorder({
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'PAYMENT_REFUND_OR_REVERSAL',
        targetResource: 'PAYMENT_TRANSACTION',
        targetId: original.transactionId,
        outcome: 'SUCCESS',
        metadata: {
          refundTransactionId: refundId,
          provider: original.provider,
          newStatus: targetStatus,
          reason: input.reason,
          amountCents: original.amountCents.toString(),
        },
      });

      return original;
    });
  }

  async getTransaction(transactionId: string): Promise<PaymentTransactionRecord | null> {
    return this.store.findByTransactionId(transactionId);
  }

  async listPendingReconciliation(): Promise<PaymentTransactionRecord[]> {
    return this.store.listPendingReconciliation();
  }

  private async findRecordForEvent(
    provider: MobileMoneyProviderName,
    providerReference: string,
    internalReference?: string
  ): Promise<PaymentTransactionRecord | null> {
    if (internalReference) {
      const byInternal = await this.store.findByTransactionId(internalReference);
      if (byInternal && byInternal.provider === provider) return byInternal;
    }
    return this.store.findByProviderReference(provider, providerReference);
  }

  private async applyVerifiedStatusTransition(
    record: PaymentTransactionRecord,
    targetStatus: GatewayStatus,
    failureReason?: string
  ): Promise<{ record: PaymentTransactionRecord; alreadyTerminal: boolean }> {
    if (TERMINAL_STATES.has(record.status)) {
      if (record.status === targetStatus) {
        if (record.reconciliationRequired) {
          record.reconciliationRequired = false;
          await this.store.save(record);
        }
        return { record, alreadyTerminal: true };
      }

      if (record.status === 'PAID' && (targetStatus === 'REFUNDED' || targetStatus === 'REVERSED')) {
        if (record.kind === 'PAYMENT' && record.channelId) {
          await this.ledger.recordAdjustmentOrReversal({
            channelId: record.channelId,
            referenceId: `refund:${record.transactionId}`,
            deltaCents: -record.amountCents,
            status: 'AVAILABLE',
            allowNegativeBalance: true,
          });
        } else if (record.kind === 'PAYOUT' && record.channelId) {
          await this.ledger.recordAdjustmentOrReversal({
            channelId: record.channelId,
            referenceId: `payout:reversal:${record.transactionId}`,
            deltaCents: record.amountCents,
            status: 'AVAILABLE',
          });
        }

        const now = new Date();
        record.status = targetStatus;
        record.reconciliationRequired = false;
        record.failureReason = failureReason || `Provider ${targetStatus.toLowerCase()} callback`;
        record.finalizedAt = now;
        record.updatedAt = now;
        await this.store.save(record);

        await this.auditRecorder({
          actorId: record.userId,
          actorRole: 'PAYMENT_PROVIDER',
          action: 'PAYMENT_REFUND_OR_REVERSAL',
          targetResource: 'PAYMENT_TRANSACTION',
          targetId: record.transactionId,
          outcome: 'SUCCESS',
          metadata: {
            provider: record.provider,
            kind: record.kind,
            newStatus: targetStatus,
            amountCents: record.amountCents.toString(),
            reason: record.failureReason,
          },
        });
        return { record, alreadyTerminal: false };
      }

      throw new OrchestratorError(
        `Conflicting state transition from terminal status ${record.status} to ${targetStatus}.`,
        'INVALID_TRANSACTION_STATE',
        409
      );
    }

    if (targetStatus === 'PENDING') {
      return { record, alreadyTerminal: false };
    }

    if (record.kind === 'PAYOUT' && record.channelId) {
      if (targetStatus === 'PAID') {
        await this.ledger.finalizePayoutSuccess({
          channelId: record.channelId,
          payoutId: record.transactionId,
        });
        record.status = 'PAID';
        record.reconciliationRequired = false;
        record.finalizedAt = new Date();
        record.updatedAt = new Date();
        await this.store.save(record);

        void emitFinancialNotificationEvent({
          eventId: crypto.randomUUID(),
          eventType: 'WITHDRAWAL_DISPATCHED',
          payoutId: record.transactionId,
          channelId: record.channelId,
          creatorUserId: record.userId,
          amountCents: record.amountCents,
          currency: LEDGER_CURRENCY,
          provider: record.provider,
          providerReference: record.providerReference || '',
          recipientPhoneMasked: record.maskedPhone,
          timestamp: record.finalizedAt || new Date(),
        });

        await this.auditRecorder({
          actorId: record.userId,
          actorRole: 'CREATOR',
          action: 'WALLET_PAYOUT_SETTLED',
          targetResource: 'PAYOUT',
          targetId: record.transactionId,
          outcome: 'SUCCESS',
          metadata: {
            channelId: record.channelId,
            provider: record.provider,
            providerReference: record.providerReference,
            amountCents: record.amountCents.toString(),
          },
        });
        return { record, alreadyTerminal: false };
      }

      if (targetStatus === 'FAILED' || targetStatus === 'REVERSED') {
        await this.ledger.failAndReversePayout({
          channelId: record.channelId,
          payoutId: record.transactionId,
        });
        record.status = targetStatus;
        record.reconciliationRequired = false;
        record.failureReason = failureReason || 'Provider payout failed';
        record.finalizedAt = new Date();
        record.updatedAt = new Date();
        await this.store.save(record);

        void emitFinancialNotificationEvent({
          eventId: crypto.randomUUID(),
          eventType: 'WITHDRAWAL_FAILED',
          payoutId: record.transactionId,
          channelId: record.channelId,
          creatorUserId: record.userId,
          amountCents: record.amountCents,
          currency: LEDGER_CURRENCY,
          provider: record.provider,
          recipientPhoneMasked: record.maskedPhone,
          reason: record.failureReason,
          timestamp: record.finalizedAt || new Date(),
        });

        await this.auditRecorder({
          actorId: record.userId,
          actorRole: 'CREATOR',
          action: 'WALLET_PAYOUT_FAILED_AND_REVERSED',
          targetResource: 'PAYOUT',
          targetId: record.transactionId,
          outcome: 'FAILED',
          metadata: {
            channelId: record.channelId,
            provider: record.provider,
            amountCents: record.amountCents.toString(),
            reason: record.failureReason,
          },
        });
        return { record, alreadyTerminal: false };
      }
    }

    if (record.kind === 'PAYMENT') {
      if (targetStatus === 'PAID') {
        if (record.channelId) {
          await this.ledger.creditRevenue({
            channelId: record.channelId,
            amountCents: record.amountCents,
            referenceId: `payment:credit:${record.transactionId}`,
            status: 'AVAILABLE',
          });
        }
        record.status = 'PAID';
        record.reconciliationRequired = false;
        record.finalizedAt = new Date();
        record.updatedAt = new Date();
        await this.store.save(record);

        void emitFinancialNotificationEvent({
          eventId: crypto.randomUUID(),
          eventType: 'PAYMENT_RECEIVED',
          transactionId: record.transactionId,
          channelId: record.channelId,
          creatorUserId: record.channelId ? undefined : record.userId,
          payerUserId: record.userId,
          amountCents: record.amountCents,
          currency: LEDGER_CURRENCY,
          provider: record.provider,
          providerReference: record.providerReference || '',
          senderPhoneMasked: record.maskedPhone,
          timestamp: record.finalizedAt || new Date(),
        });

        await this.auditRecorder({
          actorId: record.userId,
          actorRole: 'USER',
          action: 'PAYMENT_SETTLED',
          targetResource: 'PAYMENT_TRANSACTION',
          targetId: record.transactionId,
          outcome: 'SUCCESS',
          metadata: {
            provider: record.provider,
            providerReference: record.providerReference,
            amountCents: record.amountCents.toString(),
          },
        });
        return { record, alreadyTerminal: false };
      }

      if (targetStatus === 'FAILED' || targetStatus === 'REVERSED' || targetStatus === 'REFUNDED') {
        record.status = targetStatus;
        record.reconciliationRequired = false;
        record.failureReason = failureReason || `Payment ${targetStatus.toLowerCase()}`;
        record.finalizedAt = new Date();
        record.updatedAt = new Date();
        await this.store.save(record);
        return { record, alreadyTerminal: false };
      }
    }

    throw new LedgerValidationError(`Unsupported state transition to ${targetStatus}.`, 'INVALID_TRANSITION', 400);
  }
}

export const defaultPaymentOrchestrator = new PaymentOrchestratorService({
  ledger: new WalletLedgerService(),
});
