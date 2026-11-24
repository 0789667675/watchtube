"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const notifications_route_1 = require("../src/routes/notifications.route");
const notifications_1 = require("../src/services/notifications");
const email_1 = require("../src/services/email");
const ledger_service_1 = require("../src/services/finance/ledger.service");
const node_crypto_1 = __importDefault(require("node:crypto"));
let activeServers = [];
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
    activeServers = [];
});
async function startServer(notificationService, userId = 'user-notify-1') {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authenticate = (req, res, next) => {
        const authHeader = req.get('x-test-user');
        if (!authHeader) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        req.user = { id: authHeader, role: 'USER' };
        next();
    };
    app.use('/notifications', (0, notifications_route_1.createNotificationRouter)({ authenticate, notificationService }));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}/notifications`;
}
(0, node_test_1.test)('Notifications Route: authentication required on all endpoints', async () => {
    const repo = new notifications_1.InMemoryNotificationRepository();
    const service = new notifications_1.NotificationService(repo);
    const baseUrl = await startServer(service);
    const res1 = await fetch(baseUrl);
    strict_1.default.equal(res1.status, 401);
    const res2 = await fetch(`${baseUrl}/unread-count`);
    strict_1.default.equal(res2.status, 401);
    const res3 = await fetch(`${baseUrl}/read-all`, { method: 'POST' });
    strict_1.default.equal(res3.status, 401);
    const res4 = await fetch(`${baseUrl}/any-id/read`, { method: 'PATCH' });
    strict_1.default.equal(res4.status, 401);
});
(0, node_test_1.test)('Notifications Route: listing, pagination, unread filtering, and read status transitions', async () => {
    const repo = new notifications_1.InMemoryNotificationRepository();
    const service = new notifications_1.NotificationService(repo);
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
    strict_1.default.equal(countRes.status, 200);
    const countData = await countRes.json();
    strict_1.default.equal(countData.unreadCount, 2);
    // 2. List all notifications for Alice
    const listRes = await fetch(`${baseUrl}?limit=10`, {
        headers: { 'x-test-user': USER_ID },
    });
    strict_1.default.equal(listRes.status, 200);
    const listData = await listRes.json();
    strict_1.default.equal(listData.total, 2);
    strict_1.default.equal(listData.unreadCount, 2);
    strict_1.default.equal(listData.notifications.length, 2);
    strict_1.default.equal(listData.notifications[0].id, n2.id); // Most recent first
    // 3. Mark one notification as read
    const markRes = await fetch(`${baseUrl}/${n1.id}/read`, {
        method: 'PATCH',
        headers: { 'x-test-user': USER_ID },
    });
    strict_1.default.equal(markRes.status, 200);
    const markData = await markRes.json();
    strict_1.default.equal(markData.id, n1.id);
    strict_1.default.equal(markData.isRead, true);
    strict_1.default.ok(markData.readAt);
    // 4. Verify unreadOnly filter returns only 1
    const unreadOnlyRes = await fetch(`${baseUrl}?unreadOnly=true`, {
        headers: { 'x-test-user': USER_ID },
    });
    const unreadOnlyData = await unreadOnlyRes.json();
    strict_1.default.equal(unreadOnlyData.notifications.length, 1);
    strict_1.default.equal(unreadOnlyData.notifications[0].id, n2.id);
    strict_1.default.equal(unreadOnlyData.unreadCount, 1);
    // 5. Attempting to mark another user's notification returns 404
    const crossUserRes = await fetch(`${baseUrl}/${n1.id}/read`, {
        method: 'PATCH',
        headers: { 'x-test-user': OTHER_USER },
    });
    strict_1.default.equal(crossUserRes.status, 404);
    // 6. Mark all as read
    const markAllRes = await fetch(`${baseUrl}/read-all`, {
        method: 'POST',
        headers: { 'x-test-user': USER_ID },
    });
    strict_1.default.equal(markAllRes.status, 200);
    const markAllData = await markAllRes.json();
    strict_1.default.equal(markAllData.updatedCount, 1);
    // 7. Verify zero unread remain
    const finalCountRes = await fetch(`${baseUrl}/unread-count`, {
        headers: { 'x-test-user': USER_ID },
    });
    const finalCountData = await finalCountRes.json();
    strict_1.default.equal(finalCountData.unreadCount, 0);
});
(0, node_test_1.test)('FinancialNotificationConsumer: translates Workstream A events to notifications and emails', async () => {
    const repo = new notifications_1.InMemoryNotificationRepository();
    const service = new notifications_1.NotificationService(repo);
    const mockTransport = new email_1.MockEmailTransport();
    const emailDispatcher = new email_1.EmailDispatcher(mockTransport);
    const CREATOR_USER_ID = 'creator-user-001';
    const CHANNEL_ID = 'channel-rwanda-music';
    repo.seedUser(CREATOR_USER_ID, 'creator@watchtube.rw');
    repo.seedChannel(CHANNEL_ID, CREATOR_USER_ID, 'Rwanda Music Hub');
    const consumer = new notifications_1.FinancialNotificationConsumer(service, emailDispatcher);
    // 1. PAYMENT_RECEIVED
    await consumer.onFinancialEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'PAYMENT_RECEIVED',
        transactionId: 'tx-pay-777',
        channelId: CHANNEL_ID,
        creatorUserId: CREATOR_USER_ID,
        amountCents: 150000n,
        currency: ledger_service_1.LEDGER_CURRENCY,
        provider: 'MTN_MOMO',
        providerReference: 'momo-ref-888',
        timestamp: new Date(),
    });
    // 2. WITHDRAWAL_REQUESTED
    await consumer.onFinancialEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'WITHDRAWAL_REQUESTED',
        payoutId: 'payout-uuid-222',
        channelId: CHANNEL_ID,
        creatorUserId: CREATOR_USER_ID,
        amountCents: 50000n,
        currency: ledger_service_1.LEDGER_CURRENCY,
        provider: 'AIRTEL_MONEY',
        recipientPhoneMasked: '25073****456',
        idempotencyKey: 'idem-key-99',
        timestamp: new Date(),
    });
    // 3. WITHDRAWAL_DISPATCHED
    await consumer.onFinancialEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'WITHDRAWAL_DISPATCHED',
        payoutId: 'payout-uuid-222',
        channelId: CHANNEL_ID,
        creatorUserId: CREATOR_USER_ID,
        amountCents: 50000n,
        currency: ledger_service_1.LEDGER_CURRENCY,
        provider: 'AIRTEL_MONEY',
        providerReference: 'airtel-dispatched-111',
        recipientPhoneMasked: '25073****456',
        timestamp: new Date(),
    });
    // 4. WITHDRAWAL_FAILED
    await consumer.onFinancialEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'WITHDRAWAL_FAILED',
        payoutId: 'payout-uuid-333',
        channelId: CHANNEL_ID,
        creatorUserId: CREATOR_USER_ID,
        amountCents: 25000n,
        currency: ledger_service_1.LEDGER_CURRENCY,
        provider: 'MTN_MOMO',
        recipientPhoneMasked: '25078****333',
        reason: 'Subscriber bar active',
        timestamp: new Date(),
    });
    // 5. REVENUE_ATTRIBUTED
    await consumer.onFinancialEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'REVENUE_ATTRIBUTED',
        attributionLineId: 'attr-line-444',
        reportId: 'rep-nov-2026',
        channelId: CHANNEL_ID,
        amountCents: 75000n,
        currency: ledger_service_1.LEDGER_CURRENCY,
        provider: 'WATCHTUBE_ADS',
        timestamp: new Date(),
    });
    // Check generated in-app notifications
    const userNotifications = await service.listNotifications(CREATOR_USER_ID, { limit: 10 });
    strict_1.default.equal(userNotifications.total, 5, 'All 5 financial events must create in-app notifications');
    const types = userNotifications.notifications.map((n) => n.type);
    strict_1.default.ok(types.includes('PAYMENT_RECEIVED'));
    strict_1.default.ok(types.includes('WITHDRAWAL_REQUESTED'));
    strict_1.default.ok(types.includes('WITHDRAWAL_DISPATCHED'));
    strict_1.default.ok(types.includes('WITHDRAWAL_FAILED'));
    strict_1.default.ok(types.includes('REVENUE_ATTRIBUTED'));
    // Check dispatched emails (4 events dispatch emails: payment received, withdrawal requested, dispatched, failed)
    const sentEmails = mockTransport.getSentEmails();
    strict_1.default.equal(sentEmails.length, 4, '4 customer communications must be dispatched via email');
    strict_1.default.ok(sentEmails.every((e) => e.to === 'creator@watchtube.rw'));
    const templateIds = sentEmails.map((e) => e.templateId);
    strict_1.default.deepEqual(templateIds, [
        'PAYMENT_RECEIVED',
        'WITHDRAWAL_REQUESTED',
        'WITHDRAWAL_DISPATCHED',
        'WITHDRAWAL_FAILED',
    ]);
});
