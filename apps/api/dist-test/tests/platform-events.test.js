"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_test_1 = require("node:test");
const notifications_1 = require("../src/services/notifications");
const email_1 = require("../src/services/email");
function setupTestDispatcher() {
    const notificationRepo = new notifications_1.InMemoryNotificationRepository();
    const notificationService = new notifications_1.NotificationService(notificationRepo);
    const mockTransport = new email_1.MockEmailTransport();
    const outboxRepo = new email_1.InMemoryEmailOutboxRepository();
    const outboxService = new email_1.EmailOutboxService(outboxRepo, mockTransport);
    const emailDispatcher = new email_1.EmailDispatcher(mockTransport, outboxService);
    const platformDispatcher = new notifications_1.PlatformEventDispatcher(notificationService, emailDispatcher);
    return {
        notificationRepo,
        notificationService,
        mockTransport,
        outboxRepo,
        outboxService,
        emailDispatcher,
        platformDispatcher,
    };
}
(0, node_test_1.test)('Platform Events: WTPP Application lifecycle (received, reviewed, approved, rejected, changes requested)', async () => {
    const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
    const userId = 'creator-1';
    notificationRepo.seedUser(userId, 'creator1@example.com');
    // 1. WTPP_APPLICATION_RECEIVED
    const res1 = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'WTPP_APPLICATION_RECEIVED',
        userId,
        channelId: 'chan-1',
        channelName: 'Creator Channel',
        applicationId: 'app-1',
    });
    strict_1.default.equal(res1.inAppCreated, true);
    strict_1.default.equal(res1.emailEnqueued, true);
    // Verify in-app notification
    const notifications1 = await notificationRepo.findMany(userId, {});
    strict_1.default.equal(notifications1.length, 1);
    strict_1.default.equal(notifications1[0].type, 'WTPP_APPLICATION_RECEIVED');
    strict_1.default.match(notifications1[0].title, /Application Received/i);
    // Verify email dispatched
    const sentEmails1 = mockTransport.getSentEmails();
    strict_1.default.equal(sentEmails1.length, 1);
    strict_1.default.equal(sentEmails1[0].to, 'creator1@example.com');
    strict_1.default.match(sentEmails1[0].subject, /Application Received/i);
    // 2. WTPP_APPLICATION_APPROVED
    const res2 = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'WTPP_APPLICATION_APPROVED',
        userId,
        channelId: 'chan-1',
        channelName: 'Creator Channel',
        applicationId: 'app-1',
        reviewerNotes: 'Approved! High quality educational videos.',
    });
    strict_1.default.equal(res2.inAppCreated, true);
    strict_1.default.equal(res2.emailEnqueued, true);
    const notifications2 = await notificationRepo.findMany(userId, {});
    strict_1.default.equal(notifications2.length, 2);
    strict_1.default.match(notifications2[0].title, /Approved/i);
    const sentEmails2 = mockTransport.getSentEmails();
    strict_1.default.equal(sentEmails2.length, 2);
    strict_1.default.match(sentEmails2[1].subject, /Approved/i);
    // 3. WTPP_APPLICATION_REJECTED
    const res3 = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'WTPP_APPLICATION_REJECTED',
        userId,
        channelId: 'chan-1',
        channelName: 'Creator Channel',
        applicationId: 'app-1',
        reviewerNotes: 'Watch hours requirement not yet met.',
    });
    strict_1.default.equal(res3.inAppCreated, true);
    strict_1.default.equal(res3.emailEnqueued, true);
    const sentEmails3 = mockTransport.getSentEmails();
    strict_1.default.equal(sentEmails3.length, 3);
    strict_1.default.match(sentEmails3[2].subject, /Not Approved/i);
});
(0, node_test_1.test)('Platform Events: Video lifecycle events (completed, failed, published)', async () => {
    const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
    const userId = 'creator-video-user';
    notificationRepo.seedUser(userId, 'video.creator@example.com');
    // Video published
    const publishRes = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'VIDEO_PUBLISHED',
        userId,
        videoId: 'vid-100',
        videoTitle: 'My Rwanda Safari Tour',
        channelId: 'chan-100',
    });
    strict_1.default.equal(publishRes.inAppCreated, true);
    strict_1.default.equal(publishRes.emailEnqueued, true);
    const notifications = await notificationRepo.findMany(userId, {});
    strict_1.default.equal(notifications.length, 1);
    strict_1.default.equal(notifications[0].type, 'VIDEO_PUBLISHED');
    strict_1.default.match(notifications[0].title, /Video Published/i);
    const emails = mockTransport.getSentEmails();
    strict_1.default.equal(emails.length, 1);
    strict_1.default.equal(emails[0].to, 'video.creator@example.com');
    strict_1.default.match(emails[0].subject, /video is ready/i);
    // Video processing failed
    const failRes = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'VIDEO_PROCESSING_FAILED',
        userId,
        videoId: 'vid-101',
        videoTitle: 'Corrupted Clip',
        channelId: 'chan-100',
        errorReason: 'Audio stream decoding error',
    });
    strict_1.default.equal(failRes.inAppCreated, true);
    strict_1.default.equal(failRes.emailEnqueued, true);
    const emails2 = mockTransport.getSentEmails();
    strict_1.default.equal(emails2.length, 2);
    strict_1.default.match(emails2[1].subject, /processing issue/i);
});
(0, node_test_1.test)('Platform Events: Mandatory security alerts override preferences and cannot be silenced', async () => {
    const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
    const userId = 'user-security-target';
    notificationRepo.seedUser(userId, 'target@example.com');
    // User attempted to disable all email and in-app notifications
    await notificationRepo.updatePreferences(userId, {
        emailFinancialTransfers: false,
        emailWtppUpdates: false,
        emailVideoProcessing: false,
        emailPlatformAnnouncements: false,
        inAppFinancialAlerts: false,
        inAppVideoProcessing: false,
        inAppPlatformAnnouncements: false,
    });
    // Security alert dispatched (e.g. password changed, new login from unrecognized device)
    const alertRes = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'ACCOUNT_SECURITY_ALERT',
        userId,
        title: 'Password Changed Successfully',
        details: 'Your account password was updated from an active session. If this was not you, lock your account immediately.',
        actionUrl: 'https://watchtube.com/settings/security',
    });
    strict_1.default.equal(alertRes.inAppCreated, true);
    strict_1.default.equal(alertRes.emailEnqueued, true);
    const inAppList = await notificationRepo.findMany(userId, {});
    strict_1.default.equal(inAppList.length, 1);
    strict_1.default.equal(inAppList[0].type, 'ACCOUNT_SECURITY_ALERT');
    const emails = mockTransport.getSentEmails();
    strict_1.default.equal(emails.length, 1);
    strict_1.default.equal(emails[0].to, 'target@example.com');
    strict_1.default.match(emails[0].subject, /Security Alert/i);
    strict_1.default.match(emails[0].subject, /Password Changed Successfully/i);
    strict_1.default.match(emails[0].text, /updated from an active session/i);
    // Community guidelines moderation strike is also a mandatory security alert
    const strikeRes = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'MODERATION_STRIKE_ISSUED',
        userId,
        strikeType: 'WARNING',
        reason: 'Copyright infringement warning on video #123',
        expiresAt: new Date(Date.now() + 90 * 86400000),
    });
    strict_1.default.equal(strikeRes.inAppCreated, true);
    strict_1.default.equal(strikeRes.emailEnqueued, true);
    const emailsAfterStrike = mockTransport.getSentEmails();
    strict_1.default.equal(emailsAfterStrike.length, 2);
    strict_1.default.match(emailsAfterStrike[1].subject, /Security Alert/i);
});
(0, node_test_1.test)('Platform Events: User notification preferences are honored for non-mandatory events', async () => {
    const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
    const userId = 'creator-pref-test';
    notificationRepo.seedUser(userId, 'pref.creator@example.com');
    // Turn off video processing emails, but leave in-app notifications enabled
    await notificationRepo.updatePreferences(userId, {
        emailVideoProcessing: false,
        inAppVideoProcessing: true,
    });
    const res = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'VIDEO_PROCESSING_COMPLETED',
        userId,
        videoId: 'vid-pref-1',
        videoTitle: 'Test Preferences Video',
        channelId: 'chan-pref-1',
    });
    strict_1.default.equal(res.inAppCreated, true);
    strict_1.default.equal(res.emailEnqueued, false); // Email skipped per user preference
    // In-app notification was still created
    const notifications = await notificationRepo.findMany(userId, {});
    strict_1.default.equal(notifications.length, 1);
    // Zero emails were enqueued or sent
    const emails = mockTransport.getSentEmails();
    strict_1.default.equal(emails.length, 0);
});
(0, node_test_1.test)('Platform Events: Admin role change notifications and copyright decisions', async () => {
    const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
    const partnerId = 'admin-partner-1';
    notificationRepo.seedUser(partnerId, 'partner1@watchtube.com');
    // Admin role granted
    const roleRes = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'ADMIN_ROLE_CHANGED',
        userId: partnerId,
        newRole: 'ADMIN',
        positionAssignment: 'Position 1: Trust & Operations Lead',
    });
    strict_1.default.equal(roleRes.inAppCreated, true);
    strict_1.default.equal(roleRes.emailEnqueued, true);
    const emails = mockTransport.getSentEmails();
    strict_1.default.equal(emails.length, 1);
    strict_1.default.equal(emails[0].to, 'partner1@watchtube.com');
    strict_1.default.match(emails[0].subject, /Administrative Access/i);
    // Copyright decision
    const creatorId = 'creator-claim-target';
    notificationRepo.seedUser(creatorId, 'creator.claim@example.com');
    const claimRes = await platformDispatcher.dispatchPlatformEvent({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'COPYRIGHT_DECISION',
        userId: creatorId,
        videoId: 'v-claim-1',
        videoTitle: 'Music Video Cover',
        claimId: 'claim-123',
        status: 'CLAIM_UPHELD',
        claimantName: 'Rwanda Music Publishing Ltd',
        resolutionNotes: 'Content match verified against official sound recording.',
    });
    strict_1.default.equal(claimRes.inAppCreated, true);
    strict_1.default.equal(claimRes.emailEnqueued, true);
    const claimEmails = mockTransport.getSentEmails().filter((m) => m.to === 'creator.claim@example.com');
    strict_1.default.equal(claimEmails.length, 1);
    strict_1.default.match(claimEmails[0].subject, /Copyright Decision/i);
});
