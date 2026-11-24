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
import { normalizeRwandaPhoneNumber } from './mtnMoMoAdapter';
import { parsePositiveBigIntAmount } from '../finance/ledger.service';

export interface AirtelMoneyTransport {
  initiateCollection(req: {
    referenceId: string;
    amountRwf: string;
    currency: string;
    country: string;
    payerMsisdn: string;
    description: string;
  }): Promise<{ providerReference: string; status: 'PENDING' | 'FAILED'; failureReason?: string; rawResponse?: unknown }>;
  initiateDisbursement(req: {
    referenceId: string;
    amountRwf: string;
    currency: string;
    country: string;
    recipientMsisdn: string;
    narrative: string;
  }): Promise<{ providerReference: string; status: 'PENDING' | 'FAILED'; failureReason?: string; rawResponse?: unknown }>;
  lookupStatus?(providerReference: string): Promise<TransactionStatusResult>;
  verifyWebhook?(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer
  ): Promise<WebhookVerificationResult>;
}

export interface AirtelMoneyConfig {
  apiUrl?: string;
  clientId?: string;
  clientSecret?: string;
  pin?: string;
  country?: string;
  currency?: string;
  webhookSecret?: string;
  transport?: AirtelMoneyTransport;
  nodeEnv?: string;
}

/**
 * Airtel Money adapter.
 *
 * IMPORTANT: Official Airtel Money API endpoints, OAuth headers, encryption/PIN rules,
 * and callback signatures are NOT hardcoded or invented here. Outside isolated test mode,
 * an authorized `AirtelMoneyTransport` backed by official Airtel Money specifications and
 * credentials must be injected for `isConfigured()` to return true.
 */
export class AirtelMoneyAdapter implements IMobileMoneyProvider {
  public readonly name: MobileMoneyProviderName = 'AIRTEL_MONEY';
  private config: AirtelMoneyConfig;
  private readonly hasExplicitCredentials: boolean;
  private readonly nodeEnv: string | undefined;

  constructor(config: AirtelMoneyConfig = {}) {
    this.nodeEnv = Object.prototype.hasOwnProperty.call(config, 'nodeEnv')
      ? config.nodeEnv
      : process.env.NODE_ENV;
    this.hasExplicitCredentials = Boolean(config.clientId && config.clientSecret);
    this.config = {
      apiUrl: config.apiUrl || process.env.AIRTEL_MONEY_API_URL,
      clientId: config.clientId || process.env.AIRTEL_MONEY_CLIENT_ID,
      clientSecret: config.clientSecret || process.env.AIRTEL_MONEY_CLIENT_SECRET,
      pin: config.pin || process.env.AIRTEL_MONEY_PIN,
      country: config.country || process.env.AIRTEL_MONEY_COUNTRY || 'RW',
      currency: config.currency || process.env.AIRTEL_MONEY_CURRENCY || 'RWF',
      webhookSecret: config.webhookSecret || process.env.AIRTEL_MONEY_WEBHOOK_SECRET,
      transport: config.transport,
      nodeEnv: this.nodeEnv,
    };
  }

  isConfigured(): boolean {
    const hasCreds = Boolean(this.config.clientId && this.config.clientSecret);
    if (!hasCreds) return false;

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
        message: 'Airtel Money provider credentials or official sandbox transport are not configured.',
      };
    }

    const amount = parsePositiveBigIntAmount(req.amountCents, 'amountCents');
    const formattedPhone = normalizeRwandaPhoneNumber(req.phoneNumber);
    if (!formattedPhone.startsWith('25072') && !formattedPhone.startsWith('25073')) {
      return {
        success: false,
        providerReference: '',
        status: 'FAILED',
        message: 'Invalid Airtel Rwanda MSISDN. Number must start with 072 or 073.',
      };
    }

    const referenceId = req.payerReference || crypto.randomUUID();
    if (this.config.transport) {
      const result = await this.config.transport.initiateCollection({
        referenceId,
        amountRwf: amount.toString(),
        currency: this.config.currency || 'RWF',
        country: this.config.country || 'RW',
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
      message: `Test-mode Airtel payment initiated for ${formattedPhone.slice(0, 5)}****${formattedPhone.slice(-3)} (${amount.toString()} RWF)`,
    };
  }

  async initiatePayout(req: PayoutInitiationRequest): Promise<PayoutInitiationResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerReference: req.idempotencyKey,
        status: 'FAILED',
        failureReason: 'Airtel Money disbursements or official sandbox transport are not configured.',
      };
    }

    const amount = parsePositiveBigIntAmount(req.amountCents, 'amountCents');
    const formattedPhone = normalizeRwandaPhoneNumber(req.phoneNumber);
    if (!formattedPhone.startsWith('25072') && !formattedPhone.startsWith('25073')) {
      return {
        success: false,
        providerReference: req.idempotencyKey,
        status: 'FAILED',
        failureReason: 'Invalid Airtel Rwanda MSISDN. Number must start with 072 or 073.',
      };
    }

    if (this.config.transport) {
      const result = await this.config.transport.initiateDisbursement({
        referenceId: req.idempotencyKey,
        amountRwf: amount.toString(),
        currency: this.config.currency || 'RWF',
        country: this.config.country || 'RW',
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
        currency: this.config.currency || 'RWF',
        country: this.config.country || 'RW',
      },
    };
  }

  async checkStatus(providerReference: string): Promise<TransactionStatusResult> {
    if (!this.config.transport?.lookupStatus) {
      throw new Error('Airtel Money status lookup transport is not configured.');
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
        reason: 'Official Airtel Money webhook verification transport is not configured',
      };
    }

    const secret = this.config.webhookSecret;
    if (!secret) {
      return { isValid: false, reason: 'Webhook secret is not configured' };
    }

    const signature = headers['x-airtel-signature'] || headers['x-signature'];
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

    const data = body as Record<string, any>;
    const transaction = data.transaction || {};
    const airtelMoneyId = String(transaction.airtel_money_id || transaction.id || data.reference || '');
    const externalRef = String(transaction.id || data.reference || '');
    const statusCode = String(transaction.status_code || transaction.status || '').toUpperCase();

    if (!externalRef && !airtelMoneyId) return null;

    let status: 'PAID' | 'FAILED' | 'PENDING' = 'PENDING';
    if (statusCode === 'TS' || statusCode === 'SUCCESSFUL' || statusCode === 'PAID' || statusCode === 'SUCCEEDED') {
      status = 'PAID';
    } else if (statusCode === 'TF' || statusCode === 'FAILED' || statusCode === 'REJECTED' || statusCode === 'EXPIRED') {
      status = 'FAILED';
    }

    let amountCents: bigint | undefined;
    if (transaction.amountCents !== undefined) {
      try {
        amountCents = parsePositiveBigIntAmount(transaction.amountCents, 'amountCents');
      } catch {
        return null;
      }
    } else if (transaction.amount !== undefined) {
      const numeric = String(transaction.amount).trim();
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
      provider: 'AIRTEL_MONEY',
      eventType: data.eventType === 'PAYMENT' ? 'PAYMENT' : 'PAYOUT',
      providerReference: airtelMoneyId || externalRef,
      externalReference: externalRef,
      status,
      amountCents,
      currency: transaction.currency || 'RWF',
      failureReason: transaction.message || undefined,
      rawPayload: body,
    };
  }
}
