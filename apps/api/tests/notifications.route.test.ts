import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { createNotificationRouter } from '../src/routes/notifications.route';
import {
  InMemoryNotificationRepository,
  NotificationService,
  FinancialNotificationConsumer,
} from '../src/services/notifications';
import { EmailDispatcher, MockEmailTransport } from '../src/services/email';
import { LEDGER_CURRENCY } from '../src/services/finance/ledger.service';
import crypto from 'node:crypto';

let activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
  activeServers = [];
});

async function startServer(
  notificationService: NotificationService,
  userId = 'user-notify-1'
) {
  const app = express();
  app.use(express.json());

  const authenticate: RequestHandler = (req, res, next) => {
    const authHeader = req.get('x-test-user');
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as any).user = { id: authHeader, role: 'USER' };
    next();
  };

  app.use('/notifications', createNotificationRouter({ authenticate, notificationService }));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/notifications`;
}

test('Notifications Route: authentication required on all endpoints', async () => {
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(repo);
  const baseUrl = await startServer(service);

  const res1 = await fetch(baseUrl);
  assert.equal(res1.status, 401);

  const res2 = await fetch(`${baseUrl}/unread-count`);
  assert.equal(res2.status, 401);

  const res3 = await fetch(`${baseUrl}/read-all`, { method: 'POST' });
  assert.equal(res3.status, 401);

  const res4 = await fetch(`${baseUrl}/any-id/read`, { method: 'PATCH' });
  assert.equal(res4.status, 401);
});

test('Notifications Route: listing, pagination, unread filtering, and read status transitions', async () => {
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(repo);
  const USER_ID = 'user-alice';
  const OTHER_USER = 'user-bob';

  // Seed notifications for Alice
  const n1 = await service.createNotification({
    userId: USER_ID,
    type: 'SYSTEM',
    title: 'Welcome to WatchTube',
    message: 'Start exploring content.',
  });
  const n2 = await service.createNotification({
    userId: USER_ID,
    type: 'WTPP_STATUS',
    title: 'WTPP Application Approved',
    message: 'Your channel is now monetized.',
  });
  // Notification for Bob
  await service.createNotification({
    userId: OTHER_USER,
    type: 'SYSTEM',
    title: 'Hello Bob',
    message: 'Welcome Bob.',
  });

  const baseUrl = await startServer(service);

  // 1. Unread count
  const countRes = await fetch(`${baseUrl}/unread-count`, {
    headers: { 'x-test-user': USER_ID },
  });
  assert.equal(countRes.status, 200);
  const countData = await countRes.json() as { unreadCount: number };
  assert.equal(countData.unreadCount, 2);

  // 2. List all notifications for Alice
  const listRes = await fetch(`${baseUrl}?limit=10`, {
    headers: { 'x-test-user': USER_ID },
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json() as { notifications: any[]; total: number; unreadCount: number };
  assert.equal(listData.total, 2);
  assert.equal(listData.unreadCount, 2);
  assert.equal(listData.notifications.length, 2);
  assert.equal(listData.notifications[0].id, n2.id); // Most recent first

  // 3. Mark one notification as read
  const markRes = await fetch(`${baseUrl}/${n1.id}/read`, {
    method: 'PATCH',
    headers: { 'x-test-user': USER_ID },
  });
  assert.equal(markRes.status, 200);
  const markData = await markRes.json() as { id: string; isRead: boolean; readAt: string | null };
  assert.equal(markData.id, n1.id);
  assert.equal(markData.isRead, true);
  assert.ok(markData.readAt);

  // 4. Verify unreadOnly filter returns only 1
  const unreadOnlyRes = await fetch(`${baseUrl}?unreadOnly=true`, {
    headers: { 'x-test-user': USER_ID },
  });
  const unreadOnlyData = await unreadOnlyRes.json() as { notifications: any[]; unreadCount: number };
  assert.equal(unreadOnlyData.notifications.length, 1);
  assert.equal(unreadOnlyData.notifications[0].id, n2.id);
  assert.equal(unreadOnlyData.unreadCount, 1);

  // 5. Attempting to mark another user's notification returns 404
  const crossUserRes = await fetch(`${baseUrl}/${n1.id}/read`, {
    method: 'PATCH',
    headers: { 'x-test-user': OTHER_USER },
  });
  assert.equal(crossUserRes.status, 404);

  // 6. Mark all as read
  const markAllRes = await fetch(`${baseUrl}/read-all`, {
    method: 'POST',
    headers: { 'x-test-user': USER_ID },
  });
  assert.equal(markAllRes.status, 200);
  const markAllData = await markAllRes.json() as { updatedCount: number };
  assert.equal(markAllData.updatedCount, 1);

  // 7. Verify zero unread remain
  const finalCountRes = await fetch(`${baseUrl}/unread-count`, {
    headers: { 'x-test-user': USER_ID },
  });
  const finalCountData = await finalCountRes.json() as { unreadCount: number };
  assert.equal(finalCountData.unreadCount, 0);
});

test('FinancialNotificationConsumer: translates Workstream A events to notifications and emails', async () => {
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(repo);
  const mockTransport = new MockEmailTransport();
  const emailDispatcher = new EmailDispatcher(mockTransport);

  const CREATOR_USER_ID = 'creator-user-001';
  const CHANNEL_ID = 'channel-rwanda-music';

  repo.seedUser(CREATOR_USER_ID, 'creator@watchtube.rw');
  repo.seedChannel(CHANNEL_ID, CREATOR_USER_ID, 'Rwanda Music Hub');

  const consumer = new FinancialNotificationConsumer(service, emailDispatcher);

  // 1. PAYMENT_RECEIVED
  await consumer.onFinancialEvent({
    eventId: crypto.randomUUID(),
    eventType: 'PAYMENT_RECEIVED',
    transactionId: 'tx-pay-777',
    channelId: CHANNEL_ID,
    creatorUserId: CREATOR_USER_ID,
    amountCents: 150000n,
    currency: LEDGER_CURRENCY,
    provider: 'MTN_MOMO',
    providerReference: 'momo-ref-888',
    timestamp: new Date(),
  });

  // 2. WITHDRAWAL_REQUESTED
  await consumer.onFinancialEvent({
    eventId: crypto.randomUUID(),
    eventType: 'WITHDRAWAL_REQUESTED',
    payoutId: 'payout-uuid-222',
    channelId: CHANNEL_ID,
    creatorUserId: CREATOR_USER_ID,
    amountCents: 50000n,
    currency: LEDGER_CURRENCY,
    provider: 'AIRTEL_MONEY',
    recipientPhoneMasked: '25073****456',
    idempotencyKey: 'idem-key-99',
    timestamp: new Date(),
  });

  // 3. WITHDRAWAL_DISPATCHED
  await consumer.onFinancialEvent({
    eventId: crypto.randomUUID(),
    eventType: 'WITHDRAWAL_DISPATCHED',
    payoutId: 'payout-uuid-222',
    channelId: CHANNEL_ID,
    creatorUserId: CREATOR_USER_ID,
    amountCents: 50000n,
    currency: LEDGER_CURRENCY,
    provider: 'AIRTEL_MONEY',
    providerReference: 'airtel-dispatched-111',
    recipientPhoneMasked: '25073****456',
    timestamp: new Date(),
  });

  // 4. WITHDRAWAL_FAILED
  await consumer.onFinancialEvent({
    eventId: crypto.randomUUID(),
    eventType: 'WITHDRAWAL_FAILED',
    payoutId: 'payout-uuid-333',
    channelId: CHANNEL_ID,
    creatorUserId: CREATOR_USER_ID,
    amountCents: 25000n,
    currency: LEDGER_CURRENCY,
    provider: 'MTN_MOMO',
    recipientPhoneMasked: '25078****333',
    reason: 'Subscriber bar active',
    timestamp: new Date(),
  });

  // 5. REVENUE_ATTRIBUTED
  await consumer.onFinancialEvent({
    eventId: crypto.randomUUID(),
    eventType: 'REVENUE_ATTRIBUTED',
    attributionLineId: 'attr-line-444',
    reportId: 'rep-nov-2026',
    channelId: CHANNEL_ID,
    amountCents: 75000n,
    currency: LEDGER_CURRENCY,
    provider: 'WATCHTUBE_ADS',
    timestamp: new Date(),
  });

  // Check generated in-app notifications
  const userNotifications = await service.listNotifications(CREATOR_USER_ID, { limit: 10 });
  assert.equal(userNotifications.total, 5, 'All 5 financial events must create in-app notifications');

  const types = userNotifications.notifications.map((n) => n.type);
  assert.ok(types.includes('PAYMENT_RECEIVED'));
  assert.ok(types.includes('WITHDRAWAL_REQUESTED'));
  assert.ok(types.includes('WITHDRAWAL_DISPATCHED'));
  assert.ok(types.includes('WITHDRAWAL_FAILED'));
  assert.ok(types.includes('REVENUE_ATTRIBUTED'));

  // Check dispatched emails (4 events dispatch emails: payment received, withdrawal requested, dispatched, failed)
  const sentEmails = mockTransport.getSentEmails();
  assert.equal(sentEmails.length, 4, '4 customer communications must be dispatched via email');
  assert.ok(sentEmails.every((e) => e.to === 'creator@watchtube.rw'));
  const templateIds = sentEmails.map((e) => e.templateId);
  assert.deepEqual(templateIds, [
    'PAYMENT_RECEIVED',
    'WITHDRAWAL_REQUESTED',
    'WITHDRAWAL_DISPATCHED',
    'WITHDRAWAL_FAILED',
  ]);
});
