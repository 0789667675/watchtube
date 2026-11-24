import {
  CreateNotificationInput,
  INotificationRepository,
  ListNotificationsQuery,
  NotificationListResult,
  NotificationRecord,
  UpdateNotificationPreferencesInput,
  UserNotificationPreferences,
} from './types';
import {
  FinancialNotificationEvent,
  IFinancialNotificationListener,
} from '../finance/financialEvents';
import {
  EmailDispatcher,
  getEmailDispatcher,
  renderPaymentReceivedEmail,
  renderWithdrawalDispatchedEmail,
  renderWithdrawalFailedEmail,
  renderWithdrawalRequestedEmail,
} from '../email';

function formatRwfCents(amountCents: bigint): string {
  // Minor units to major string with thousands separators
  const amount = Number(amountCents);
  return amount.toLocaleString('en-US');
}

export class NotificationService {
  constructor(private readonly repository: INotificationRepository) {}

  async createNotification(input: CreateNotificationInput): Promise<NotificationRecord> {
    return this.repository.create(input);
  }

  async listNotifications(userId: string, query: ListNotificationsQuery): Promise<NotificationListResult> {
    const [notifications, total, unreadCount] = await Promise.all([
      this.repository.findMany(userId, query),
      this.repository.count(userId, false),
      this.repository.count(userId, true),
    ]);
    return {
      notifications,
      total,
      unreadCount,
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.repository.count(userId, true);
  }

  async markAsRead(userId: string, notificationId: string): Promise<NotificationRecord | null> {
    return this.repository.markAsRead(userId, notificationId);
  }

  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    return this.repository.markAllAsRead(userId);
  }

  async getPreferences(userId: string): Promise<UserNotificationPreferences> {
    return this.repository.getPreferences(userId);
  }

  async updatePreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput
  ): Promise<UserNotificationPreferences> {
    return this.repository.updatePreferences(userId, input);
  }

  getRepository(): INotificationRepository {
    return this.repository;
  }
}

let notificationServiceInstance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationServiceInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaNotificationRepository } = require('./notificationRepository');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prisma } = require('@watchtube/database');
    notificationServiceInstance = new NotificationService(new PrismaNotificationRepository(prisma));
  }
  return notificationServiceInstance;
}

export function setNotificationService(service: NotificationService | null): void {
  notificationServiceInstance = service;
}

/**
 * Consumer that bridges Workstream A's Financial Notification Events into
 * persistent in-app notifications and email dispatches.
 */
export class FinancialNotificationConsumer implements IFinancialNotificationListener {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly emailDispatcher: EmailDispatcher = getEmailDispatcher()
  ) {}

  async onFinancialEvent(event: FinancialNotificationEvent): Promise<void> {
    const repo = this.notificationService.getRepository();

    switch (event.eventType) {
      case 'PAYMENT_RECEIVED': {
        let recipientUserId = event.creatorUserId;
        let channelName = 'Your Channel';
        let recipientEmail: string | null = null;

        if (event.channelId) {
          const owner = await repo.findChannelOwnerUserId(event.channelId);
          if (owner) {
            recipientUserId = owner.userId;
            channelName = owner.channelName;
            recipientEmail = owner.email;
          }
        }

        if (!recipientUserId && event.payerUserId) {
          recipientUserId = event.payerUserId;
        }

        const amountStr = formatRwfCents(event.amountCents);

        if (recipientUserId) {
          await this.notificationService.createNotification({
            userId: recipientUserId,
            type: 'PAYMENT_RECEIVED',
            title: 'Payment Received',
            message: `Received ${amountStr} RWF via ${event.provider} for ${channelName}.`,
            metadata: {
              transactionId: event.transactionId,
              amountCents: event.amountCents.toString(),
              currency: event.currency,
              provider: event.provider,
              providerReference: event.providerReference,
            },
          });

          if (!recipientEmail) {
            recipientEmail = await repo.findUserEmail(recipientUserId);
          }

          if (recipientEmail) {
            await this.emailDispatcher.sendEmail(
              renderPaymentReceivedEmail({
                recipientEmail,
                channelName,
                amountRwf: amountStr,
                provider: event.provider,
                transactionId: event.providerReference || event.transactionId,
              })
            );
          }
        }
        break;
      }

      case 'WITHDRAWAL_REQUESTED': {
        if (!event.creatorUserId) break;
        const creatorUserId = event.creatorUserId;
        const amountStr = formatRwfCents(event.amountCents);
        await this.notificationService.createNotification({
          userId: creatorUserId,
          type: 'WITHDRAWAL_REQUESTED',
          title: 'Withdrawal Requested',
          message: `Withdrawal of ${amountStr} RWF to ${event.provider} (${event.recipientPhoneMasked}) has been requested.`,
          metadata: {
            payoutId: event.payoutId,
            amountCents: event.amountCents.toString(),
            currency: event.currency,
            provider: event.provider,
            recipientPhoneMasked: event.recipientPhoneMasked,
          },
        });

        const email = await repo.findUserEmail(creatorUserId);
        if (email) {
          let channelName = 'Creator Wallet';
          if (event.channelId) {
            const owner = await repo.findChannelOwnerUserId(event.channelId);
            if (owner) channelName = owner.channelName;
          }
          await this.emailDispatcher.sendEmail(
            renderWithdrawalRequestedEmail({
              recipientEmail: email,
              channelName,
              amountRwf: amountStr,
              provider: event.provider,
              maskedPhone: event.recipientPhoneMasked,
              payoutId: event.payoutId,
            })
          );
        }
        break;
      }

      case 'WITHDRAWAL_DISPATCHED': {
        if (!event.creatorUserId) break;
        const creatorUserId = event.creatorUserId;
        const amountStr = formatRwfCents(event.amountCents);
        await this.notificationService.createNotification({
          userId: creatorUserId,
          type: 'WITHDRAWAL_DISPATCHED',
          title: 'Withdrawal Dispatched',
          message: `Withdrawal of ${amountStr} RWF has been successfully transferred to ${event.provider} (${event.recipientPhoneMasked}).`,
          metadata: {
            payoutId: event.payoutId,
            amountCents: event.amountCents.toString(),
            currency: event.currency,
            provider: event.provider,
            providerReference: event.providerReference,
            recipientPhoneMasked: event.recipientPhoneMasked,
          },
        });

        const email = await repo.findUserEmail(creatorUserId);
        if (email) {
          let channelName = 'Creator Wallet';
          if (event.channelId) {
            const owner = await repo.findChannelOwnerUserId(event.channelId);
            if (owner) channelName = owner.channelName;
          }
          await this.emailDispatcher.sendEmail(
            renderWithdrawalDispatchedEmail({
              recipientEmail: email,
              channelName,
              amountRwf: amountStr,
              provider: event.provider,
              maskedPhone: event.recipientPhoneMasked,
              providerReference: event.providerReference,
            })
          );
        }
        break;
      }

      case 'WITHDRAWAL_FAILED': {
        if (!event.creatorUserId) break;
        const creatorUserId = event.creatorUserId;
        const amountStr = formatRwfCents(event.amountCents);
        await this.notificationService.createNotification({
          userId: creatorUserId,
          type: 'WITHDRAWAL_FAILED',
          title: 'Withdrawal Failed',
          message: `Withdrawal of ${amountStr} RWF could not be completed (${event.reason}). All reserved funds were restored to your wallet.`,
          metadata: {
            payoutId: event.payoutId,
            amountCents: event.amountCents.toString(),
            currency: event.currency,
            provider: event.provider,
            recipientPhoneMasked: event.recipientPhoneMasked,
            reason: event.reason,
          },
        });

        const email = await repo.findUserEmail(creatorUserId);
        if (email) {
          let channelName = 'Creator Wallet';
          if (event.channelId) {
            const owner = await repo.findChannelOwnerUserId(event.channelId);
            if (owner) channelName = owner.channelName;
          }
          await this.emailDispatcher.sendEmail(
            renderWithdrawalFailedEmail({
              recipientEmail: email,
              channelName,
              amountRwf: amountStr,
              provider: event.provider,
              maskedPhone: event.recipientPhoneMasked,
              reason: event.reason,
            })
          );
        }
        break;
      }

      case 'REVENUE_ATTRIBUTED': {
        let recipientUserId = event.creatorUserId;
        let channelName = 'Your Channel';
        if (event.channelId) {
          const owner = await repo.findChannelOwnerUserId(event.channelId);
          if (owner) {
            recipientUserId = owner.userId;
            channelName = owner.channelName;
          }
        }

        if (recipientUserId) {
          const amountStr = formatRwfCents(event.amountCents);
          await this.notificationService.createNotification({
            userId: recipientUserId,
            type: 'REVENUE_ATTRIBUTED',
            title: 'Advertising Revenue Credited',
            message: `Your channel "${channelName}" was credited ${amountStr} RWF for advertising revenue.`,
            metadata: {
              attributionLineId: event.attributionLineId,
              reportId: event.reportId,
              amountCents: event.amountCents.toString(),
              currency: event.currency,
              provider: event.provider,
            },
          });
        }
        break;
      }
    }
  }
}
