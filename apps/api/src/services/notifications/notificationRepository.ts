import crypto from 'node:crypto';
import { db as defaultPrisma } from '@watchtube/database';
import {
  CreateNotificationInput,
  INotificationRepository,
  ListNotificationsQuery,
  NotificationRecord,
} from './types';

export class PrismaNotificationRepository implements INotificationRepository {
  constructor(private readonly prisma: typeof defaultPrisma = defaultPrisma) {}

  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    const created = await (this.prisma as any).notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: input.metadata ?? undefined,
      },
    });
    return this.mapRecord(created);
  }

  async findMany(userId: string, query: ListNotificationsQuery): Promise<NotificationRecord[]> {
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    const offset = Math.max(0, query.offset ?? 0);
    const where: Record<string, unknown> = { userId };
    if (query.unreadOnly) {
      where.isRead = false;
    }

    const items = await (this.prisma as any).notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return items.map((i: any) => this.mapRecord(i));
  }

  async count(userId: string, unreadOnly?: boolean): Promise<number> {
    const where: Record<string, unknown> = { userId };
    if (unreadOnly) {
      where.isRead = false;
    }
    return (this.prisma as any).notification.count({ where });
  }

  async markAsRead(userId: string, notificationId: string): Promise<NotificationRecord | null> {
    const now = new Date();
    const updateRes = await (this.prisma as any).notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: now },
    });
    if (updateRes.count === 0) return null;

    const item = await (this.prisma as any).notification.findUnique({
      where: { id: notificationId },
    });
    return item ? this.mapRecord(item) : null;
  }

  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    const res = await (this.prisma as any).notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updatedCount: res.count };
  }

  async findUserEmail(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  async findChannelOwnerUserId(channelId: string): Promise<{ userId: string; channelName: string; email: string } | null> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        userId: true,
        name: true,
        user: { select: { email: true } },
      },
    });
    if (!channel) return null;
    return {
      userId: channel.userId,
      channelName: channel.name,
      email: channel.user.email,
    };
  }

  async getPreferences(userId: string) {
    const pref = await (this.prisma as any).notificationPreference.findUnique({
      where: { userId },
    });
    return {
      userId,
      emailSecurityAlerts: true, // Non-negotiable security invariant
      emailFinancialTransfers: pref?.emailFinancialTransfers ?? true,
      emailWtppUpdates: pref?.emailWtppUpdates ?? true,
      emailVideoProcessing: pref?.emailVideoProcessing ?? true,
      emailPlatformAnnouncements: pref?.emailPlatformAnnouncements ?? true,
      inAppFinancialAlerts: pref?.inAppFinancialAlerts ?? true,
      inAppVideoProcessing: pref?.inAppVideoProcessing ?? true,
      inAppPlatformAnnouncements: pref?.inAppPlatformAnnouncements ?? true,
    };
  }

  async updatePreferences(userId: string, input: any) {
    const current = await this.getPreferences(userId);
    const updated = await (this.prisma as any).notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        emailSecurityAlerts: true,
        emailFinancialTransfers: input.emailFinancialTransfers ?? current.emailFinancialTransfers,
        emailWtppUpdates: input.emailWtppUpdates ?? current.emailWtppUpdates,
        emailVideoProcessing: input.emailVideoProcessing ?? current.emailVideoProcessing,
        emailPlatformAnnouncements: input.emailPlatformAnnouncements ?? current.emailPlatformAnnouncements,
        inAppFinancialAlerts: input.inAppFinancialAlerts ?? current.inAppFinancialAlerts,
        inAppVideoProcessing: input.inAppVideoProcessing ?? current.inAppVideoProcessing,
        inAppPlatformAnnouncements: input.inAppPlatformAnnouncements ?? current.inAppPlatformAnnouncements,
      },
      update: {
        ...(input.emailFinancialTransfers !== undefined ? { emailFinancialTransfers: input.emailFinancialTransfers } : {}),
        ...(input.emailWtppUpdates !== undefined ? { emailWtppUpdates: input.emailWtppUpdates } : {}),
        ...(input.emailVideoProcessing !== undefined ? { emailVideoProcessing: input.emailVideoProcessing } : {}),
        ...(input.emailPlatformAnnouncements !== undefined ? { emailPlatformAnnouncements: input.emailPlatformAnnouncements } : {}),
        ...(input.inAppFinancialAlerts !== undefined ? { inAppFinancialAlerts: input.inAppFinancialAlerts } : {}),
        ...(input.inAppVideoProcessing !== undefined ? { inAppVideoProcessing: input.inAppVideoProcessing } : {}),
        ...(input.inAppPlatformAnnouncements !== undefined ? { inAppPlatformAnnouncements: input.inAppPlatformAnnouncements } : {}),
        emailSecurityAlerts: true, // Ensure never overridden to false
      },
    });
    return {
      userId,
      emailSecurityAlerts: true,
      emailFinancialTransfers: updated.emailFinancialTransfers,
      emailWtppUpdates: updated.emailWtppUpdates,
      emailVideoProcessing: updated.emailVideoProcessing,
      emailPlatformAnnouncements: updated.emailPlatformAnnouncements,
      inAppFinancialAlerts: updated.inAppFinancialAlerts,
      inAppVideoProcessing: updated.inAppVideoProcessing,
      inAppPlatformAnnouncements: updated.inAppPlatformAnnouncements,
    };
  }

  private mapRecord(raw: any): NotificationRecord {
    return {
      id: raw.id,
      userId: raw.userId,
      type: raw.type,
      title: raw.title,
      message: raw.message,
      metadata: raw.metadata as Record<string, unknown> | null,
      isRead: raw.isRead,
      readAt: raw.readAt,
      createdAt: raw.createdAt,
    };
  }
}

export class InMemoryNotificationRepository implements INotificationRepository {
  private notifications: (NotificationRecord & { seq: number })[] = [];
  private users = new Map<string, { email: string }>();
  private channels = new Map<string, { userId: string; name: string }>();
  private seq = 0;

  seedUser(userId: string, email: string): void {
    this.users.set(userId, { email });
  }

  seedChannel(channelId: string, userId: string, name: string): void {
    this.channels.set(channelId, { userId, name });
  }

  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    const record: NotificationRecord & { seq: number } = {
      id: crypto.randomUUID(),
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? null,
      isRead: false,
      readAt: null,
      createdAt: new Date(),
      seq: ++this.seq,
    };
    this.notifications.push(record);
    return record;
  }

  async findMany(userId: string, query: ListNotificationsQuery): Promise<NotificationRecord[]> {
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    const offset = Math.max(0, query.offset ?? 0);

    const filtered = this.notifications.filter((n) => {
      if (n.userId !== userId) return false;
      if (query.unreadOnly && n.isRead) return false;
      return true;
    });

    // Descending by createdAt, fallback to seq
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq);
    return filtered.slice(offset, offset + limit);
  }

  async count(userId: string, unreadOnly?: boolean): Promise<number> {
    return this.notifications.filter((n) => {
      if (n.userId !== userId) return false;
      if (unreadOnly && n.isRead) return false;
      return true;
    }).length;
  }

  async markAsRead(userId: string, notificationId: string): Promise<NotificationRecord | null> {
    const item = this.notifications.find((n) => n.id === notificationId && n.userId === userId);
    if (!item) return null;
    item.isRead = true;
    item.readAt = new Date();
    return item;
  }

  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    let updatedCount = 0;
    const now = new Date();
    for (const item of this.notifications) {
      if (item.userId === userId && !item.isRead) {
        item.isRead = true;
        item.readAt = now;
        updatedCount += 1;
      }
    }
    return { updatedCount };
  }

  async findUserEmail(userId: string): Promise<string | null> {
    return this.users.get(userId)?.email ?? null;
  }

  async findChannelOwnerUserId(channelId: string): Promise<{ userId: string; channelName: string; email: string } | null> {
    const channel = this.channels.get(channelId);
    if (!channel) return null;
    const user = this.users.get(channel.userId);
    return {
      userId: channel.userId,
      channelName: channel.name,
      email: user?.email ?? 'creator@example.com',
    };
  }

  private preferences = new Map<string, any>();

  async getPreferences(userId: string) {
    const pref = this.preferences.get(userId);
    return {
      userId,
      emailSecurityAlerts: true,
      emailFinancialTransfers: pref?.emailFinancialTransfers ?? true,
      emailWtppUpdates: pref?.emailWtppUpdates ?? true,
      emailVideoProcessing: pref?.emailVideoProcessing ?? true,
      emailPlatformAnnouncements: pref?.emailPlatformAnnouncements ?? true,
      inAppFinancialAlerts: pref?.inAppFinancialAlerts ?? true,
      inAppVideoProcessing: pref?.inAppVideoProcessing ?? true,
      inAppPlatformAnnouncements: pref?.inAppPlatformAnnouncements ?? true,
    };
  }

  async updatePreferences(userId: string, input: any) {
    const current = await this.getPreferences(userId);
    const updated = {
      userId,
      emailSecurityAlerts: true, // Non-negotiable security invariant
      emailFinancialTransfers: input.emailFinancialTransfers ?? current.emailFinancialTransfers,
      emailWtppUpdates: input.emailWtppUpdates ?? current.emailWtppUpdates,
      emailVideoProcessing: input.emailVideoProcessing ?? current.emailVideoProcessing,
      emailPlatformAnnouncements: input.emailPlatformAnnouncements ?? current.emailPlatformAnnouncements,
      inAppFinancialAlerts: input.inAppFinancialAlerts ?? current.inAppFinancialAlerts,
      inAppVideoProcessing: input.inAppVideoProcessing ?? current.inAppVideoProcessing,
      inAppPlatformAnnouncements: input.inAppPlatformAnnouncements ?? current.inAppPlatformAnnouncements,
    };
    this.preferences.set(userId, updated);
    return updated;
  }
}
