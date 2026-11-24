import { db as prisma } from '@watchtube/database';
import {
  IMobileMoneyProvider,
  MobileMoneyProviderName,
  PaymentTransactionStatus,
  PayoutInitiationRequest,
} from './types';
import { MtnMoMoAdapter } from './mtnMoMoAdapter';
import { AirtelMoneyAdapter } from './airtelMoneyAdapter';
import { recordAuditEvent } from '../audit.service';
import { LedgerValidationError, parsePositiveBigIntAmount } from '../finance/ledger.service';

export interface PayoutRequestInput {
  amountCents: number | bigint;
  provider: MobileMoneyProviderName;
  phoneNumber: string;
  idempotencyKey: string;
  narrative?: string;
}

export interface PayoutExecutionResult {
  success: boolean;
  transaction?: {
    id: string;
    channelId: string;
    transactionType: string;
    amountCents: string;
    balanceAfterCents: string;
    referenceId: string;
    status: string;
    createdAt: Date;
  };
  error?: string;
  failureReason?: string;
  reconciliationRequired?: boolean;
}

export interface WebhookProcessingResult {
  success: boolean;
  code?: number;
  error?: string;
  processed?: boolean;
  status?: PaymentTransactionStatus;
  reason?: string;
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
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

export class PaymentService {
  private providers = new Map<MobileMoneyProviderName, IMobileMoneyProvider>();
  private processedWebhooks = new Set<string>();
  private readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.registerProvider(new MtnMoMoAdapter());
    this.registerProvider(new AirtelMoneyAdapter());
  }

  registerProvider(provider: IMobileMoneyProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: MobileMoneyProviderName): IMobileMoneyProvider | undefined {
    return this.providers.get(name);
  }

  isProviderConfigured(name: MobileMoneyProviderName): boolean {
    const provider = this.providers.get(name);
    return Boolean(provider && provider.isConfigured());
  }

  /**
   * Dispatches a creator payout with transactional balance reservation, row locking,
   * bounded provider timeout, and idempotency.
   */
  async requestPayout(
    userId: string,
    input: PayoutRequestInput,
    dbClient: any = prisma
  ): Promise<PayoutExecutionResult> {
    let amountCents: bigint;
    try {
      amountCents = parsePositiveBigIntAmount(input.amountCents, 'amountCents');
    } catch (error) {
      const msg = error instanceof LedgerValidationError ? error.message : 'Payout amount must be a positive integer.';
      return { success: false, error: 'INVALID_AMOUNT', failureReason: msg };
    }

    const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    if (!idempotencyKey) {
      return { success: false, error: 'INVALID_IDEMPOTENCY_KEY', failureReason: 'idempotencyKey is required.' };
    }

    const provider = this.providers.get(input.provider);
    if (!provider || !provider.isConfigured()) {
      return {
        success: false,
        error: 'PROVIDER_UNAVAILABLE',
        failureReason: `Payment provider ${input.provider} is not configured or unavailable.`,
      };
    }

    // 1. Identify creator channel
    const channel = await dbClient.channel.findFirst({
      where: { userId },
      select: { id: true, isMonetized: true },
    });

    if (!channel) {
      return { success: false, error: 'CHANNEL_NOT_FOUND', failureReason: 'Creator channel not found.' };
    }

    // 2. Enforce idempotency before starting reservation transaction
    const existingTx = await dbClient.walletTransaction.findUnique({
      where: { referenceId: idempotencyKey },
    });

    if (existingTx) {
      if (existingTx.channelId !== channel.id || BigInt(existingTx.amountCents) !== amountCents) {
        return {
          success: false,
          error: 'IDEMPOTENCY_CONFLICT',
          failureReason: 'Idempotency key was already used with different payout parameters.',
        };
      }
      return {
        success: true,
        transaction: {
          ...existingTx,
          amountCents: existingTx.amountCents.toString(),
          balanceAfterCents: existingTx.balanceAfterCents.toString(),
        },
      };
    }

    // 3. Atomically lock channel, check balance, and reserve funds in ledger
    let createdTx: any;
    try {
      createdTx = await dbClient.$transaction(async (tx: any) => {
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT "id" FROM "Channel" WHERE "id" = ${channel.id}::uuid FOR UPDATE`;
        }

        const existingInsideTx = await tx.walletTransaction.findUnique({
          where: { referenceId: idempotencyKey },
        });
        if (existingInsideTx) {
          if (existingInsideTx.channelId !== channel.id || BigInt(existingInsideTx.amountCents) !== amountCents) {
            throw new Error('IDEMPOTENCY_CONFLICT');
          }
          return existingInsideTx;
        }

        const lastTx = await tx.walletTransaction.findFirst({
          where: { channelId: channel.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });

        const currentBalance = lastTx ? BigInt(lastTx.balanceAfterCents) : BigInt(0);
        if (currentBalance < amountCents) {
          throw new Error('INSUFFICIENT_FUNDS');
        }

        const newBalance = currentBalance - amountCents;

        return tx.walletTransaction.create({
          data: {
            channelId: channel.id,
            transactionType: 'PAYOUT',
            amountCents,
            balanceAfterCents: newBalance,
            referenceId: idempotencyKey,
            status: 'PENDING',
          },
        });
      });
    } catch (error: any) {
      if (error?.message === 'INSUFFICIENT_FUNDS') {
        return { success: false, error: 'INSUFFICIENT_FUNDS', failureReason: 'Available wallet balance is insufficient for this payout.' };
      }
      if (error?.message === 'IDEMPOTENCY_CONFLICT') {
        return {
          success: false,
          error: 'IDEMPOTENCY_CONFLICT',
          failureReason: 'Idempotency key was already used with different payout parameters.',
        };
      }
      throw error;
    }

    await recordAuditEvent({
      actorId: userId,
      actorRole: 'CREATOR',
      action: 'WALLET_PAYOUT_INITIATED',
      targetResource: 'PAYOUT',
      targetId: createdTx.id,
      metadata: {
        channelId: channel.id,
        amountCents: amountCents.toString(),
        currency: 'RWF',
        provider: input.provider,
        referenceId: idempotencyKey,
      },
    });

    // 4. Dispatch to provider adapter with bounded timeout
    const payoutReq: PayoutInitiationRequest = {
      channelId: channel.id,
      amountCents,
      currency: 'RWF',
      phoneNumber: input.phoneNumber,
      idempotencyKey,
      narrative: input.narrative || 'WatchTube Creator Earnings Payout',
    };

    let dispatchResult;
    let timedOut = false;
    try {
      dispatchResult = await withTimeout(
        provider.initiatePayout(payoutReq),
        this.timeoutMs,
        input.provider
      );
    } catch (err: any) {
      if (err?.code === 'PROVIDER_TIMEOUT') {
        timedOut = true;
      }
      dispatchResult = {
        success: false,
        providerReference: idempotencyKey,
        status: (timedOut ? 'PENDING' : 'FAILED') as PaymentTransactionStatus,
        failureReason: err?.message || 'Network exception during provider dispatch',
      };
    }

    // On timeout, keep PENDING and require explicit status reconciliation rather than risking double-payout
    if (timedOut) {
      return {
        success: true,
        reconciliationRequired: true,
        transaction: {
          ...createdTx,
          amountCents: createdTx.amountCents.toString(),
          balanceAfterCents: createdTx.balanceAfterCents.toString(),
        },
      };
    }

    // 5. Compensating reversal if provider synchronously rejected
    if (!dispatchResult.success || dispatchResult.status === 'FAILED') {
      await dbClient.$transaction(async (tx: any) => {
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT "id" FROM "Channel" WHERE "id" = ${channel.id}::uuid FOR UPDATE`;
        }

        await tx.walletTransaction.update({
          where: { id: createdTx.id },
          data: { status: 'FAILED' },
        });

        const lastTx = await tx.walletTransaction.findFirst({
          where: { channelId: channel.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const currentBalance = lastTx ? BigInt(lastTx.balanceAfterCents) : BigInt(0);

        await tx.walletTransaction.create({
          data: {
            channelId: channel.id,
            transactionType: 'ADJUSTMENT',
            amountCents,
            balanceAfterCents: currentBalance + amountCents,
            referenceId: `${idempotencyKey}-failed-refund`,
            status: 'AVAILABLE',
          },
        });
      });

      await recordAuditEvent({
        actorId: userId,
        actorRole: 'CREATOR',
        action: 'WALLET_PAYOUT_AUTO_REFUNDED',
        targetResource: 'PAYOUT',
        targetId: createdTx.id,
        metadata: {
          channelId: channel.id,
          amountCents: amountCents.toString(),
          provider: input.provider,
          referenceId: idempotencyKey,
          reason: dispatchResult.failureReason,
        },
      });

      return {
        success: false,
        error: 'DISPATCH_REJECTED',
        failureReason: dispatchResult.failureReason || 'Provider rejected payout transfer.',
      };
    }

    return {
      success: true,
      transaction: {
        ...createdTx,
        amountCents: createdTx.amountCents.toString(),
        balanceAfterCents: createdTx.balanceAfterCents.toString(),
      },
    };
  }

  /**
   * Processes an incoming provider callback with strict signature validation,
   * amount/currency verification, duplicate protection, and ledger updates.
   */
  async handleWebhook(
    providerName: MobileMoneyProviderName,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
    parsedJson: unknown,
    dbClient: any = prisma
  ): Promise<WebhookProcessingResult> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      return { success: false, code: 404, error: 'UNKNOWN_PROVIDER' };
    }

    // 1. Signature validation (fail closed)
    const verification = await provider.verifyWebhookSignature(headers, rawBody);
    if (!verification.isValid) {
      return {
        success: false,
        code: 401,
        error: 'INVALID_SIGNATURE',
        reason: verification.reason || 'Webhook signature verification failed',
      };
    }

    // 2. Parse payload
    const event = provider.parseWebhook(parsedJson, headers);
    if (!event) {
      return { success: false, code: 400, error: 'MALFORMED_PAYLOAD' };
    }

    if (event.currency && event.currency !== 'RWF') {
      return { success: false, code: 400, error: 'CURRENCY_MISMATCH', reason: `Unsupported currency ${event.currency}` };
    }

    // 3. Check webhook deduplication
    const eventDedupeKey = `${providerName}:${event.providerReference}:${event.status}`;
    if (this.processedWebhooks.has(eventDedupeKey)) {
      return { success: true, processed: false, reason: 'DUPLICATE_WEBHOOK_EVENT' };
    }

    // 4. Match transaction
    const tx = await dbClient.walletTransaction.findFirst({
      where: {
        OR: [
          { referenceId: event.externalReference },
          { referenceId: event.providerReference },
        ],
      },
    });

    if (!tx) {
      return { success: false, code: 404, error: 'TRANSACTION_NOT_FOUND' };
    }

    // Validate webhook amount matches initiated transaction if supplied
    if (event.amountCents !== undefined) {
      const txAbsAmount = BigInt(tx.amountCents) < 0n ? -BigInt(tx.amountCents) : BigInt(tx.amountCents);
      if (BigInt(event.amountCents) !== txAbsAmount) {
        return {
          success: false,
          code: 400,
          error: 'AMOUNT_MISMATCH',
          reason: 'Webhook amount does not match recorded transaction amount.',
        };
      }
    }

    // If transaction already in terminal state, mark deduplicated and exit idempotently
    if (tx.status === 'PAID' || tx.status === 'FAILED') {
      this.processedWebhooks.add(eventDedupeKey);
      return { success: true, processed: false, reason: 'TRANSACTION_ALREADY_FINALIZED' };
    }

    // Resolve valid User actorId for AdminAuditLog FK if Channel lookup is available
    let auditActorId: string | null = null;
    if (typeof dbClient.channel?.findUnique === 'function') {
      const ch = await dbClient.channel.findUnique({ where: { id: tx.channelId }, select: { userId: true } });
      auditActorId = ch?.userId ?? null;
    } else if (typeof dbClient.channel?.findFirst === 'function') {
      const ch = await dbClient.channel.findFirst({ where: { id: tx.channelId }, select: { userId: true } });
      auditActorId = ch?.userId ?? null;
    }

    // 5. Update transaction and apply ledger changes atomically
    if (event.status === 'PAID') {
      await dbClient.walletTransaction.update({
        where: { id: tx.id },
        data: { status: 'PAID' },
      });
      this.processedWebhooks.add(eventDedupeKey);

      if (auditActorId) {
        await recordAuditEvent({
          actorId: auditActorId,
          actorRole: 'PAYMENT_PROVIDER',
          action: 'WALLET_PAYOUT_COMPLETED',
          targetResource: 'PAYOUT',
          targetId: tx.id,
          metadata: {
            provider: providerName,
            referenceId: tx.referenceId,
            providerReference: event.providerReference,
          },
        });
      }

      return { success: true, processed: true, status: 'PAID' };
    }

    if (event.status === 'FAILED' || event.status === 'REVERSED') {
      const refundRef = `${tx.referenceId}-callback-refund`;
      await dbClient.$transaction(async (txRunner: any) => {
        if (typeof txRunner.$queryRaw === 'function') {
          await txRunner.$queryRaw`SELECT "id" FROM "Channel" WHERE "id" = ${tx.channelId}::uuid FOR UPDATE`;
        }

        const alreadyRefunded = await txRunner.walletTransaction.findUnique({
          where: { referenceId: refundRef },
        });
        if (alreadyRefunded) return;

        await txRunner.walletTransaction.update({
          where: { id: tx.id },
          data: { status: 'FAILED' },
        });

        const lastTx = await txRunner.walletTransaction.findFirst({
          where: { channelId: tx.channelId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const currentBalance = lastTx ? BigInt(lastTx.balanceAfterCents) : BigInt(0);
        const restoreAmount = BigInt(tx.amountCents) < 0n ? -BigInt(tx.amountCents) : BigInt(tx.amountCents);

        await txRunner.walletTransaction.create({
          data: {
            channelId: tx.channelId,
            transactionType: 'ADJUSTMENT',
            amountCents: restoreAmount,
            balanceAfterCents: currentBalance + restoreAmount,
            referenceId: refundRef,
            status: 'AVAILABLE',
          },
        });
      });

      this.processedWebhooks.add(eventDedupeKey);

      if (auditActorId) {
        await recordAuditEvent({
          actorId: auditActorId,
          actorRole: 'PAYMENT_PROVIDER',
          action: 'WALLET_PAYOUT_FAILED',
          targetResource: 'PAYOUT',
          targetId: tx.id,
          metadata: {
            provider: providerName,
            referenceId: tx.referenceId,
            reason: event.failureReason,
          },
        });
      }

      return { success: true, processed: true, status: 'FAILED' };
    }

    return { success: true, processed: false, status: event.status };
  }
}

export const defaultPaymentService = new PaymentService();
