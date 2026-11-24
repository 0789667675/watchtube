import crypto from 'node:crypto';
import {
  MobileMoneyProviderName,
  PaymentTransactionStatus,
} from './types';
import { normalizeRwandaPhoneNumber } from './mtnMoMoAdapter';
import { maskMsisdn } from './msisdn';
import { parsePositiveBigIntAmount } from '../finance/ledger.service';

export type GatewayProviderMode = 'UNCONFIGURED' | 'MOCK_SANDBOX' | 'LIVE_CONFIGURED';

export type GatewayStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REVERSED' | 'REFUNDED';

export interface GatewayCapabilities {
  collections: boolean;
  disbursements: boolean;
  statusLookup: boolean;
  webhooks: boolean;
  refunds: boolean;
  reversals: boolean;
}

export interface GatewayPaymentInitRequest {
  internalReference: string;
  idempotencyKey: string;
  amountCents: bigint;
  currency: 'RWF';
  phoneNumber: string;
  description: string;
}

export interface GatewayPayoutInitRequest {
  internalReference: string;
  idempotencyKey: string;
  channelId: string;
  amountCents: bigint;
  currency: 'RWF';
  phoneNumber: string;
  narrative: string;
}

export interface GatewayInitResponse {
  accepted: boolean;
  status: 'PENDING' | 'FAILED';
  providerReference: string;
  providerTransactionId?: string;
  failureCode?: string;
  failureReason?: string;
}

export interface GatewayStatusLookupResult {
  providerReference: string;
  providerTransactionId?: string;
  status: GatewayStatus;
  amountCents?: bigint;
  currency?: string;
  failureReason?: string;
}

export interface GatewayRefundRequest {
  originalInternalReference: string;
  originalProviderReference: string;
  refundInternalReference: string;
  idempotencyKey: string;
  amountCents: bigint;
  currency: 'RWF';
  reason: string;
}

export interface GatewayRefundResult {
  accepted: boolean;
  status: 'PENDING' | 'REFUNDED' | 'REVERSED' | 'FAILED';
  providerReference: string;
  failureReason?: string;
}

export interface GatewayWebhookEvent {
  webhookEventId: string;
  provider: MobileMoneyProviderName;
  eventType: 'PAYMENT' | 'PAYOUT' | 'REFUND' | 'REVERSAL';
  providerReference: string;
  internalReference?: string;
  status: GatewayStatus;
  amountCents?: bigint;
  currency?: string;
  failureReason?: string;
}

export interface GatewayWebhookVerifyResult {
  valid: boolean;
  errorCode?: 'UNCONFIGURED_VERIFIER' | 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'INVALID_PAYLOAD';
  reason?: string;
  event?: GatewayWebhookEvent;
}

export interface IMobileMoneyGatewayAdapter {
  readonly providerId: MobileMoneyProviderName;
  readonly displayName: string;
  readonly mode: GatewayProviderMode;
  readonly capabilities: Readonly<GatewayCapabilities>;

  isConfigured(): boolean;
  initiatePayment(req: GatewayPaymentInitRequest): Promise<GatewayInitResponse>;
  initiatePayout(req: GatewayPayoutInitRequest): Promise<GatewayInitResponse>;
  lookupStatus(providerReference: string): Promise<GatewayStatusLookupResult>;
  verifyAndParseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
    parsedBody: unknown
  ): Promise<GatewayWebhookVerifyResult>;
  initiateRefundOrReversal(req: GatewayRefundRequest): Promise<GatewayRefundResult>;
}

/**
 * Safe unconfigured adapter used in runtime when official MTN MoMo or Airtel Money
 * sandbox/live specifications and credentials are absent. Always fails closed (501).
 */
export class UnconfiguredMobileMoneyAdapter implements IMobileMoneyGatewayAdapter {
  readonly mode: GatewayProviderMode = 'UNCONFIGURED';
  readonly capabilities: Readonly<GatewayCapabilities> = {
    collections: false,
    disbursements: false,
    statusLookup: false,
    webhooks: false,
    refunds: false,
    reversals: false,
  };

  constructor(
    public readonly providerId: MobileMoneyProviderName,
    public readonly displayName: string
  ) {}

  isConfigured(): boolean {
    return false;
  }

  async initiatePayment(): Promise<GatewayInitResponse> {
    throw new Error(`${this.displayName} integration is not configured.`);
  }

  async initiatePayout(): Promise<GatewayInitResponse> {
    throw new Error(`${this.displayName} disbursements are not configured.`);
  }

  async lookupStatus(): Promise<GatewayStatusLookupResult> {
    throw new Error(`${this.displayName} status lookup is not configured.`);
  }

  async verifyAndParseWebhook(): Promise<GatewayWebhookVerifyResult> {
    return {
      valid: false,
      errorCode: 'UNCONFIGURED_VERIFIER',
      reason: `${this.displayName} webhook verification is not configured.`,
    };
  }

  async initiateRefundOrReversal(): Promise<GatewayRefundResult> {
    throw new Error(`${this.displayName} refund/reversal integration is not configured.`);
  }
}

export interface MockAdapterBehaviorOptions {
  webhookSecret?: string;
  supportsRefunds?: boolean;
  supportsReversals?: boolean;
  simulateTimeoutOnKey?: Set<string>;
  simulateOutageOnKey?: Set<string>;
  simulateSyncFailureOnKey?: Set<string>;
  nodeEnv?: string;
}

interface MockTxState {
  providerReference: string;
  internalReference: string;
  kind: 'PAYMENT' | 'PAYOUT' | 'REFUND';
  amountCents: bigint;
  currency: 'RWF';
  status: GatewayStatus;
  failureReason?: string;
}

/**
 * Base test-only sandbox mock adapter for MTN MoMo and Airtel Money orchestration testing.
 * Explicitly forbidden in NODE_ENV === 'production'.
 * Uses test-only header 'x-watchtube-mock-signature' (never claims to be real telco headers).
 */
export abstract class BaseMockMobileMoneyAdapter implements IMobileMoneyGatewayAdapter {
  readonly mode: GatewayProviderMode = 'MOCK_SANDBOX';
  readonly capabilities: Readonly<GatewayCapabilities>;

  private readonly webhookSecret: string;
  private readonly idempotencyMap = new Map<string, GatewayInitResponse>();
  private readonly txByProviderRef = new Map<string, MockTxState>();
  private readonly simulateTimeoutOnKey: Set<string>;
  private readonly simulateOutageOnKey: Set<string>;
  private readonly simulateSyncFailureOnKey: Set<string>;

  abstract readonly providerId: MobileMoneyProviderName;
  abstract readonly displayName: string;
  protected abstract readonly allowedPrefixes: readonly string[];

  constructor(options: MockAdapterBehaviorOptions = {}) {
    const env = Object.prototype.hasOwnProperty.call(options, 'nodeEnv')
      ? options.nodeEnv
      : process.env.NODE_ENV;
    if (env === 'production') {
      throw new Error('[SECURITY] Mock Mobile Money adapters cannot be instantiated in production.');
    }
    this.webhookSecret = options.webhookSecret || 'watchtube-test-mock-webhook-secret-only';
    this.capabilities = {
      collections: true,
      disbursements: true,
      statusLookup: true,
      webhooks: true,
      refunds: options.supportsRefunds ?? true,
      reversals: options.supportsReversals ?? true,
    };
    this.simulateTimeoutOnKey = options.simulateTimeoutOnKey ?? new Set();
    this.simulateOutageOnKey = options.simulateOutageOnKey ?? new Set();
    this.simulateSyncFailureOnKey = options.simulateSyncFailureOnKey ?? new Set();
  }

  isConfigured(): boolean {
    return true;
  }

  /** Test helper to control async provider state transitions (for polling/status tests). */
  setSimulatedStatus(providerReference: string, status: GatewayStatus, failureReason?: string): void {
    const existing = this.txByProviderRef.get(providerReference);
    if (existing) {
      existing.status = status;
      existing.failureReason = failureReason;
    }
  }

  /** Test helper to sign a mock webhook payload with the test-only mock signature scheme. */
  signMockWebhookPayload(payload: Record<string, unknown>): { rawBody: string; headers: Record<string, string> } {
    const rawBody = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    return {
      rawBody,
      headers: { 'x-watchtube-mock-signature': sig },
    };
  }

  private validatePhonePrefix(phoneNumber: string): string | null {
    const normalized = normalizeRwandaPhoneNumber(phoneNumber);
    if (normalized.length !== 12 || !normalized.startsWith('250')) {
      return `Invalid Rwanda MSISDN format: ${maskMsisdn(normalized)}`;
    }
    const prefix = normalized.slice(3, 5);
    if (!this.allowedPrefixes.includes(prefix)) {
      return `MSISDN prefix 0${prefix} is not valid for ${this.displayName}.`;
    }
    return null;
  }

  private async maybeSimulateFault(idempotencyKey: string): Promise<void> {
    if (this.simulateTimeoutOnKey.has(idempotencyKey)) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 60_000);
        if (typeof timer.unref === 'function') timer.unref();
      });
    }
    if (this.simulateOutageOnKey.has(idempotencyKey)) {
      const err: any = new Error(`${this.displayName} upstream service temporarily unavailable (503).`);
      err.code = 'PROVIDER_UNAVAILABLE';
      err.retryable = true;
      throw err;
    }
  }

  async initiatePayment(req: GatewayPaymentInitRequest): Promise<GatewayInitResponse> {
    parsePositiveBigIntAmount(req.amountCents, 'amountCents');
    await this.maybeSimulateFault(req.idempotencyKey);

    const cached = this.idempotencyMap.get(`PAY:${req.idempotencyKey}`);
    if (cached) return { ...cached };

    const phoneErr = this.validatePhonePrefix(req.phoneNumber);
    if (phoneErr || this.simulateSyncFailureOnKey.has(req.idempotencyKey)) {
      const failed: GatewayInitResponse = {
        accepted: false,
        status: 'FAILED',
        providerReference: `${this.providerId.toLowerCase()}-fail-${crypto.randomUUID().slice(0, 8)}`,
        failureCode: phoneErr ? 'INVALID_MSISDN' : 'PROVIDER_REJECTED',
        failureReason: phoneErr || `${this.displayName} rejected simulated payment request.`,
      };
      this.idempotencyMap.set(`PAY:${req.idempotencyKey}`, failed);
      return failed;
    }

    const providerReference = `${this.providerId.toLowerCase()}-pay-${crypto.randomUUID()}`;
    const response: GatewayInitResponse = {
      accepted: true,
      status: 'PENDING', // Initiation NEVER equals PAID
      providerReference,
      providerTransactionId: `ext-${providerReference}`,
    };

    this.txByProviderRef.set(providerReference, {
      providerReference,
      internalReference: req.internalReference,
      kind: 'PAYMENT',
      amountCents: req.amountCents,
      currency: req.currency,
      status: 'PENDING',
    });
    this.idempotencyMap.set(`PAY:${req.idempotencyKey}`, response);
    return response;
  }

  async initiatePayout(req: GatewayPayoutInitRequest): Promise<GatewayInitResponse> {
    parsePositiveBigIntAmount(req.amountCents, 'amountCents');
    await this.maybeSimulateFault(req.idempotencyKey);

    const cached = this.idempotencyMap.get(`PAYOUT:${req.idempotencyKey}`);
    if (cached) return { ...cached };

    const phoneErr = this.validatePhonePrefix(req.phoneNumber);
    if (phoneErr || this.simulateSyncFailureOnKey.has(req.idempotencyKey)) {
      const failed: GatewayInitResponse = {
        accepted: false,
        status: 'FAILED',
        providerReference: `${this.providerId.toLowerCase()}-fail-${crypto.randomUUID().slice(0, 8)}`,
        failureCode: phoneErr ? 'INVALID_MSISDN' : 'DISBURSEMENT_REJECTED',
        failureReason: phoneErr || `${this.displayName} rejected simulated payout transfer.`,
      };
      this.idempotencyMap.set(`PAYOUT:${req.idempotencyKey}`, failed);
      return failed;
    }

    const providerReference = `${this.providerId.toLowerCase()}-payout-${crypto.randomUUID()}`;
    const response: GatewayInitResponse = {
      accepted: true,
      status: 'PENDING', // Initiation NEVER equals PAID
      providerReference,
      providerTransactionId: `ext-${providerReference}`,
    };

    this.txByProviderRef.set(providerReference, {
      providerReference,
      internalReference: req.internalReference,
      kind: 'PAYOUT',
      amountCents: req.amountCents,
      currency: req.currency,
      status: 'PENDING',
    });
    this.idempotencyMap.set(`PAYOUT:${req.idempotencyKey}`, response);
    return response;
  }

  async lookupStatus(providerReference: string): Promise<GatewayStatusLookupResult> {
    const state = this.txByProviderRef.get(providerReference);
    if (!state) {
      throw new Error(`Transaction reference "${providerReference}" not found on ${this.displayName} mock.`);
    }
    return {
      providerReference: state.providerReference,
      providerTransactionId: `ext-${state.providerReference}`,
      status: state.status,
      amountCents: state.amountCents,
      currency: state.currency,
      failureReason: state.failureReason,
    };
  }

  async verifyAndParseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
    parsedBody: unknown
  ): Promise<GatewayWebhookVerifyResult> {
    const sigRaw = headers['x-watchtube-mock-signature'];
    const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
    if (!signature) {
      return {
        valid: false,
        errorCode: 'MISSING_SIGNATURE',
        reason: 'Missing x-watchtube-mock-signature header.',
      };
    }

    const bodyText = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(bodyText).digest('hex');
    if (
      signature.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'))
    ) {
      return {
        valid: false,
        errorCode: 'INVALID_SIGNATURE',
        reason: 'Mock webhook HMAC-SHA256 signature mismatch.',
      };
    }

    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return {
        valid: false,
        errorCode: 'INVALID_PAYLOAD',
        reason: 'Webhook body must be a JSON object.',
      };
    }

    const data = parsedBody as Record<string, unknown>;
    const providerReference = typeof data.providerReference === 'string' ? data.providerReference.trim() : '';
    const internalReference = typeof data.internalReference === 'string' ? data.internalReference.trim() : undefined;
    const webhookEventId = typeof data.webhookEventId === 'string' && data.webhookEventId.trim()
      ? data.webhookEventId.trim()
      : `${providerReference}:${String(data.status || '')}`;
    const rawStatus = String(data.status || '').toUpperCase();

    if (!providerReference) {
      return {
        valid: false,
        errorCode: 'INVALID_PAYLOAD',
        reason: 'providerReference is required.',
      };
    }

    let status: GatewayStatus;
    if (rawStatus === 'PAID' || rawStatus === 'SUCCESSFUL' || rawStatus === 'SUCCEEDED') {
      status = 'PAID';
    } else if (rawStatus === 'FAILED' || rawStatus === 'REJECTED') {
      status = 'FAILED';
    } else if (rawStatus === 'REVERSED') {
      status = 'REVERSED';
    } else if (rawStatus === 'REFUNDED') {
      status = 'REFUNDED';
    } else if (rawStatus === 'PENDING') {
      status = 'PENDING';
    } else {
      return {
        valid: false,
        errorCode: 'INVALID_PAYLOAD',
        reason: `Unsupported webhook status "${rawStatus}".`,
      };
    }

    let amountCents: bigint | undefined;
    if (data.amountCents !== undefined) {
      try {
        amountCents = parsePositiveBigIntAmount(data.amountCents, 'amountCents');
      } catch {
        return {
          valid: false,
          errorCode: 'INVALID_PAYLOAD',
          reason: 'Invalid amountCents in webhook payload.',
        };
      }
    }

    const eventType =
      data.eventType === 'PAYMENT' || data.eventType === 'PAYOUT' || data.eventType === 'REFUND' || data.eventType === 'REVERSAL'
        ? data.eventType
        : 'PAYOUT';

    return {
      valid: true,
      event: {
        webhookEventId,
        provider: this.providerId,
        eventType,
        providerReference,
        internalReference,
        status,
        amountCents,
        currency: typeof data.currency === 'string' ? data.currency : 'RWF',
        failureReason: typeof data.reason === 'string' ? data.reason : undefined,
      },
    };
  }

  async initiateRefundOrReversal(req: GatewayRefundRequest): Promise<GatewayRefundResult> {
    if (!this.capabilities.refunds && !this.capabilities.reversals) {
      return {
        accepted: false,
        status: 'FAILED',
        providerReference: '',
        failureReason: `${this.displayName} does not support refunds or reversals in this configuration.`,
      };
    }

    const original = this.txByProviderRef.get(req.originalProviderReference);
    if (!original) {
      return {
        accepted: false,
        status: 'FAILED',
        providerReference: '',
        failureReason: 'Original provider transaction reference not found.',
      };
    }
    if (original.status !== 'PAID') {
      return {
        accepted: false,
        status: 'FAILED',
        providerReference: '',
        failureReason: `Cannot refund/reverse transaction in state ${original.status}.`,
      };
    }
    if (req.amountCents > original.amountCents) {
      return {
        accepted: false,
        status: 'FAILED',
        providerReference: '',
        failureReason: 'Refund amount cannot exceed original transaction amount.',
      };
    }

    const refundRef = `${this.providerId.toLowerCase()}-refund-${crypto.randomUUID()}`;
    original.status = original.kind === 'PAYMENT' ? 'REFUNDED' : 'REVERSED';

    return {
      accepted: true,
      status: original.kind === 'PAYMENT' ? 'REFUNDED' : 'REVERSED',
      providerReference: refundRef,
    };
  }
}

export class MockMtnMoMoSandboxAdapter extends BaseMockMobileMoneyAdapter {
  readonly providerId: MobileMoneyProviderName = 'MTN_MOMO';
  readonly displayName = 'MTN Mobile Money (Mock Sandbox)';
  protected readonly allowedPrefixes = ['78', '79'] as const;
}

export class MockAirtelMoneySandboxAdapter extends BaseMockMobileMoneyAdapter {
  readonly providerId: MobileMoneyProviderName = 'AIRTEL_MONEY';
  readonly displayName = 'Airtel Money (Mock Sandbox)';
  protected readonly allowedPrefixes = ['72', '73'] as const;
}

export type LegacyStatusBridge = PaymentTransactionStatus;
