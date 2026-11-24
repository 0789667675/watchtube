export type MobileMoneyProviderName = 'MTN_MOMO' | 'AIRTEL_MONEY';
export type MobileMoneyProviderId = MobileMoneyProviderName;

export class PaymentProviderError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string = 'PAYMENT_ERROR', statusCode: number = 500) {
    super(message);
    this.name = 'PaymentProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type PaymentTransactionStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REVERSED';

export interface PaymentInitiationRequest {
  amountCents: number | bigint;
  currency?: 'RWF';
  phoneNumber: string;
  payerReference?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentInitiationResponse {
  success: boolean;
  providerReference: string;
  status: PaymentTransactionStatus;
  message?: string;
  rawResponse?: unknown;
}

export interface PayoutInitiationRequest {
  channelId: string;
  amountCents: number | bigint;
  currency?: 'RWF';
  phoneNumber: string;
  idempotencyKey: string;
  narrative: string;
  metadata?: Record<string, unknown>;
}

export interface PayoutInitiationResponse {
  success: boolean;
  providerReference: string;
  status: PaymentTransactionStatus;
  failureReason?: string;
  rawResponse?: unknown;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  reason?: string;
}

export interface WebhookEvent {
  provider: MobileMoneyProviderName;
  eventType: 'PAYMENT' | 'PAYOUT';
  providerReference: string;
  externalReference: string;
  status: PaymentTransactionStatus;
  amountCents?: number | bigint;
  currency?: string;
  failureReason?: string;
  rawPayload: unknown;
}

export interface TransactionStatusResult {
  providerReference: string;
  status: PaymentTransactionStatus;
  amountCents?: number | bigint;
  failureReason?: string;
}

export interface IMobileMoneyProvider {
  readonly name: MobileMoneyProviderName;
  isConfigured(): boolean;
  initiatePayment(req: PaymentInitiationRequest): Promise<PaymentInitiationResponse>;
  initiatePayout(req: PayoutInitiationRequest): Promise<PayoutInitiationResponse>;
  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer
  ): Promise<WebhookVerificationResult>;
  parseWebhook(
    body: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): WebhookEvent | null;
  checkStatus?(providerReference: string): Promise<TransactionStatusResult>;
}
