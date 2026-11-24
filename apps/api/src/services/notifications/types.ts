export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}

export interface ListNotificationsQuery {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface NotificationListResult {
  notifications: NotificationRecord[];
  total: number;
  unreadCount: number;
}

export interface UserNotificationPreferences {
  userId: string;
  emailSecurityAlerts: boolean; // Always true, non-disableable
  emailFinancialTransfers: boolean;
  emailWtppUpdates: boolean;
  emailVideoProcessing: boolean;
  emailPlatformAnnouncements: boolean;
  inAppFinancialAlerts: boolean;
  inAppVideoProcessing: boolean;
  inAppPlatformAnnouncements: boolean;
}

export interface UpdateNotificationPreferencesInput {
  emailFinancialTransfers?: boolean;
  emailWtppUpdates?: boolean;
  emailVideoProcessing?: boolean;
  emailPlatformAnnouncements?: boolean;
  inAppFinancialAlerts?: boolean;
  inAppVideoProcessing?: boolean;
  inAppPlatformAnnouncements?: boolean;
}

export interface INotificationRepository {
  create(input: CreateNotificationInput): Promise<NotificationRecord>;
  findMany(userId: string, query: ListNotificationsQuery): Promise<NotificationRecord[]>;
  count(userId: string, unreadOnly?: boolean): Promise<number>;
  markAsRead(userId: string, notificationId: string): Promise<NotificationRecord | null>;
  markAllAsRead(userId: string): Promise<{ updatedCount: number }>;
  findUserEmail(userId: string): Promise<string | null>;
  findChannelOwnerUserId(channelId: string): Promise<{ userId: string; channelName: string; email: string } | null>;
  getPreferences(userId: string): Promise<UserNotificationPreferences>;
  updatePreferences(userId: string, input: UpdateNotificationPreferencesInput): Promise<UserNotificationPreferences>;
}
