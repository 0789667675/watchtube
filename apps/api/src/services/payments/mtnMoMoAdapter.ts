import crypto from 'node:crypto';
import {
  IMobileMoneyProvider,
  MobileMoneyProviderName,
  PaymentInitiationRequest,
  PaymentInitiationResponse,
  PayoutInitiationRequest,
  PayoutInitiationResponse,
  TransactionStatusResult,
  WebhookEvent,
  WebhookVerificationResult,
} from './types';
import { parsePositiveBigIntAmount } from '../finance/ledger.service';

export interface MtnMoMoTransport {
  initiateCollection(req: {
    referenceId: string;
    amountRwf: string;
    currency: 'RWF';
    payerMsisdn: string;
    description: string;
  }): Promise<{ providerReference: string; status: 'PENDING' | 'FAILED'; failureReason?: string; rawResponse?: unknown }>;
  initiateDisbursement(req: {
    referenceId: string;
    amountRwf: string;
    currency: 'RWF';
    recipientMsisdn: string;
    narrative: string;
  }): Promise<{ providerReference: string; status: 'PENDING' | 'FAILED'; failureReason?: string; rawResponse?: unknown }>;
  lookupStatus?(providerReference: string): Promise<TransactionStatusResult>;
  verifyWebhook?(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer
  ): Promise<WebhookVerificationResult>;
}

export interface MtnMoMoConfig {
  apiUrl?: string;
  subscriptionKey?: string;
  apiUser?: string;
  apiKey?: string;
  targetEnvironment?: 'sandbox' | 'production' | string;
  webhookSecret?: string;
  transport?: MtnMoMoTransport;
  nodeEnv?: string;
}

export function normalizeRwandaPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('250') && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return `250${digits.substring(1)}`;
  }
  if (digits.length === 9) {
    return `250${digits}`;
  }
  return digits;
}

/**
 * MTN Mobile Money adapter.
 *
 * IMPORTANT: Official MTN MoMo API endpoints, OAuth headers, request schemas, and
 * callback signatures are NOT hardcoded or invented here. Outside isolated test mode,
 * an authorized `MtnMoMoTransport` backed by verified MTN MoMo specifications and
 * sandbox/live credentials must be injected for `isConfigured()` to return true.
 */
export class MtnMoMoAdapter implements IMobileMoneyProvider {
  public readonly name: MobileMoneyProviderName = 'MTN_MOMO';
  private config: MtnMoMoConfig;
  private readonly hasExplicitCredentials: boolean;
  private readonly nodeEnv: string | undefined;

  constructor(config: MtnMoMoConfig = {}) {
    this.nodeEnv = Object.prototype.hasOwnProperty.call(config, 'nodeEnv')
      ? config.nodeEnv
      : process.env.NODE_ENV;
    this.hasExplicitCredentials = Boolean(config.subscriptionKey && config.apiUser && config.apiKey);
    this.config = {
      apiUrl: config.apiUrl || process.env.MTN_MOMO_API_URL,
      subscriptionKey: config.subscriptionKey || process.env.MTN_MOMO_SUBSCRIPTION_KEY,
      apiUser: config.apiUser || process.env.MTN_MOMO_API_USER,
      apiKey: config.apiKey || process.env.MTN_MOMO_API_KEY,
      targetEnvironment: config.targetEnvironment || process.env.MTN_MOMO_TARGET_ENVIRONMENT,
      webhookSecret: config.webhookSecret || process.env.MTN_MOMO_WEBHOOK_SECRET,
      transport: config.transport,
      nodeEnv: this.nodeEnv,
    };
  }

  isConfigured(): boolean {
    const hasCreds = Boolean(
      this.config.subscriptionKey
      && this.config.apiUser
      && this.config.apiKey
    );
    if (!hasCreds) return false;

    // Outside explicit unit tests, require an injected verified HTTP transport and explicit API URL.
    if (this.config.transport) {
      return Boolean(this.config.apiUrl);
    }
    return this.nodeEnv === 'test' && this.hasExplicitCredentials;
  }

  async initiatePayment(req: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerReference: '',
        status: 'FAILED',
        message: 'MTN Mobile Money provider credentials or official sandbox transport are not configured.',
      };
    }

    const amount = parsePositiveBigIntAmount(req.amountCents, 'amountCents');
    const formattedPhone = normalizeRwandaPhoneNumber(req.phoneNumber);
    if (!formattedPhone.startsWith('25078') && !formattedPhone.startsWith('25079')) {
      return {
        success: false,
        providerReference: '',
        status: 'FAILED',
        message: 'Invalid MTN Rwanda MSISDN. Number must start with 078 or 079.',
      };
    }

    const referenceId = req.payerReference || crypto.randomUUID();
    if (this.config.transport) {
      const result = await this.config.transport.initiateCollection({
        referenceId,
        amountRwf: amount.toString(),
        currency: 'RWF',
        payerMsisdn: formattedPhone,
        description: req.description,
      });
      return {
        success: result.status === 'PENDING',
        providerReference: result.providerReference,
        status: result.status,
        message: result.failureReason,
        rawResponse: result.rawResponse,
      };
    }

    return {
      success: true,
      providerReference: referenceId,
      status: 'PENDING',
      message: `Test-mode MTN payment initiated for ${formattedPhone.slice(0, 5)}****${formattedPhone.slice(-3)} (${amount.toString()} RWF)`,
    };
  }

  async initiatePayout(req: PayoutInitiationRequest): Promise<PayoutInitiationResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerReference: req.idempotencyKey,
        status: 'FAILED',
        failureReason: 'MTN Mobile Money disbursements or official sandbox transport are not configured.',
      };
    }

    const amount = parsePositiveBigIntAmount(req.amountCents, 'amountCents');
    const formattedPhone = normalizeRwandaPhoneNumber(req.phoneNumber);
    if (!formattedPhone.startsWith('25078') && !formattedPhone.startsWith('25079')) {
      return {
        success: false,
        providerReference: req.idempotencyKey,
        status: 'FAILED',
        failureReason: 'Invalid MTN Rwanda MSISDN. Number must start with 078 or 079.',
      };
    }

    if (this.config.transport) {
      const result = await this.config.transport.initiateDisbursement({
        referenceId: req.idempotencyKey,
        amountRwf: amount.toString(),
        currency: 'RWF',
        recipientMsisdn: formattedPhone,
        narrative: req.narrative,
      });
      return {
        success: result.status === 'PENDING',
        providerReference: result.providerReference,
        status: result.status,
        failureReason: result.failureReason,
        rawResponse: result.rawResponse,
      };
    }

    return {
      success: true,
      providerReference: req.idempotencyKey,
      status: 'PENDING',
      rawResponse: {
        mode: 'TEST_ONLY_IN_MEMORY',
        amountRwf: amount.toString(),
        currency: 'RWF',
        targetEnvironment: this.config.targetEnvironment || 'test',
      },
    };
  }

  async checkStatus(providerReference: string): Promise<TransactionStatusResult> {
    if (!this.config.transport?.lookupStatus) {
      throw new Error('MTN Mobile Money status lookup transport is not configured.');
    }
    return this.config.transport.lookupStatus(providerReference);
  }

  async verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer
  ): Promise<WebhookVerificationResult> {
    if (this.config.transport?.verifyWebhook) {
      return this.config.transport.verifyWebhook(headers, rawBody);
    }

    if (this.nodeEnv !== 'test') {
      return {
        isValid: false,
        reason: 'Official MTN Mobile Money webhook verification transport is not configured',
      };
    }

    const secret = this.config.webhookSecret;
    if (!secret) {
      return { isValid: false, reason: 'Webhook secret is not configured' };
    }

    const signature = headers['x-callback-signature'] || headers['x-signature'];
    const signatureStr = Array.isArray(signature) ? signature[0] : signature;

    if (!signatureStr) {
      return { isValid: false, reason: 'Missing signature header' };
    }

    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expectedHmac = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

    if (signatureStr.length !== expectedHmac.length) {
      return { isValid: false, reason: 'Invalid signature length' };
    }

    const isMatch = crypto.timingSafeEqual(
      Buffer.from(signatureStr, 'utf8'),
      Buffer.from(expectedHmac, 'utf8')
    );

    return isMatch ? { isValid: true } : { isValid: false, reason: 'Signature mismatch' };
  }

  parseWebhook(
    body: unknown,
    _headers?: Record<string, string | string[] | undefined>
  ): WebhookEvent | null {
    if (!body || typeof body !== 'object') return null;

    const data = body as Record<string, unknown>;
    const financialTransactionId = String(data.financialTransactionId || data.referenceId || '');
    const externalId = String(data.externalId || data.referenceId || '');
    const statusRaw = String(data.status || '').toUpperCase();

    if (!externalId && !financialTransactionId) return null;

    let status: 'PAID' | 'FAILED' | 'PENDING' = 'PENDING';
    if (statusRaw === 'SUCCESSFUL' || statusRaw === 'PAID' || statusRaw === 'SUCCEEDED') {
      status = 'PAID';
    } else if (statusRaw === 'FAILED' || statusRaw === 'REJECTED' || statusRaw === 'EXPIRED') {
      status = 'FAILED';
    }

    let amountCents: bigint | undefined;
    if (data.amountCents !== undefined) {
      try {
        amountCents = parsePositiveBigIntAmount(data.amountCents, 'amountCents');
      } catch {
        return null;
      }
    } else if (typeof data.amount === 'string' || typeof data.amount === 'number') {
      const numeric = String(data.amount).trim();
      if (/^\d+$/.test(numeric)) {
        amountCents = BigInt(numeric);
      } else if (/^\d+\.\d{1,2}$/.test(numeric)) {
        const [whole, frac = ''] = numeric.split('.');
        amountCents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
      }
      if (amountCents !== undefined && amountCents <= 0n) {
        return null;
      }
    }

    return {
      provider: 'MTN_MOMO',
      eventType: data.eventType === 'PAYMENT' ? 'PAYMENT' : 'PAYOUT',
      providerReference: financialTransactionId || externalId,
      externalReference: externalId,
      status,
      amountCents,
      currency: typeof data.currency === 'string' ? data.currency : 'RWF',
      failureReason: typeof data.reason === 'string' ? data.reason : undefined,
      rawPayload: body,
    };
  }
}
