import { LEDGER_CURRENCY } from './ledger.service';

export type FinancialEventType =
  | 'PAYMENT_RECEIVED'
  | 'WITHDRAWAL_REQUESTED'
  | 'WITHDRAWAL_DISPATCHED'
  | 'WITHDRAWAL_FAILED'
  | 'REVENUE_ATTRIBUTED';

export interface BaseFinancialEvent {
  eventId: string;
  eventType: FinancialEventType;
  channelId?: string;
  creatorUserId?: string;
  amountCents: bigint;
  currency: typeof LEDGER_CURRENCY;
  timestamp: Date;
}

export interface PaymentReceivedEvent extends BaseFinancialEvent {
  eventType: 'PAYMENT_RECEIVED';
  transactionId: string;
  provider: string;
  providerReference: string;
  senderPhoneMasked?: string;
  payerUserId?: string;
}

export interface WithdrawalRequestedEvent extends BaseFinancialEvent {
  eventType: 'WITHDRAWAL_REQUESTED';
  payoutId: string;
  provider: string;
  recipientPhoneMasked: string;
  idempotencyKey: string;
}

export interface WithdrawalDispatchedEvent extends BaseFinancialEvent {
  eventType: 'WITHDRAWAL_DISPATCHED';
  payoutId: string;
  provider: string;
  providerReference: string;
  recipientPhoneMasked: string;
}

export interface WithdrawalFailedEvent extends BaseFinancialEvent {
  eventType: 'WITHDRAWAL_FAILED';
  payoutId: string;
  provider: string;
  recipientPhoneMasked: string;
  reason: string;
}

export interface RevenueAttributedEvent extends BaseFinancialEvent {
  eventType: 'REVENUE_ATTRIBUTED';
  attributionLineId: string;
  reportId?: string;
  provider: string;
  periodStart?: Date;
  periodEnd?: Date;
}

export type FinancialNotificationEvent =
  | PaymentReceivedEvent
  | WithdrawalRequestedEvent
  | WithdrawalDispatchedEvent
  | WithdrawalFailedEvent
  | RevenueAttributedEvent;

export interface IFinancialNotificationListener {
  onFinancialEvent(event: FinancialNotificationEvent): Promise<void> | void;
}

const listeners = new Set<IFinancialNotificationListener>();

export function registerFinancialNotificationListener(listener: IFinancialNotificationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearFinancialNotificationListeners(): void {
  listeners.clear();
}

/**
 * Emits a financial event to all registered notification listeners.
 * Guarantees fail-safe execution: notification failures are caught and logged
 * and will NEVER abort, rollback, or alter the underlying financial transaction.
 */
export async function emitFinancialNotificationEvent(event: FinancialNotificationEvent): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const listener of listeners) {
    try {
      const res = listener.onFinancialEvent(event);
      if (res && typeof res.then === 'function') {
        promises.push(
          res.catch((err) => {
            console.error(
              `[FinanceNotification] Listener failed on ${event.eventType} for channel ${event.channelId}:`,
              err instanceof Error ? err.message : err
            );
          })
        );
      }
    } catch (err) {
      console.error(
        `[FinanceNotification] Sync listener threw on ${event.eventType} for channel ${event.channelId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  if (promises.length > 0) {
    await Promise.allSettled(promises);
  }
}
