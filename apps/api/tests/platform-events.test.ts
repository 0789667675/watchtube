import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  InMemoryNotificationRepository,
  NotificationService,
  PlatformEventDispatcher,
} from '../src/services/notifications';
import {
  EmailDispatcher,
  MockEmailTransport,
  EmailOutboxService,
  InMemoryEmailOutboxRepository,
} from '../src/services/email';

function setupTestDispatcher() {
  const notificationRepo = new InMemoryNotificationRepository();
  const notificationService = new NotificationService(notificationRepo);
  const mockTransport = new MockEmailTransport();
  const outboxRepo = new InMemoryEmailOutboxRepository();
  const outboxService = new EmailOutboxService(outboxRepo, mockTransport);
  const emailDispatcher = new EmailDispatcher(mockTransport, outboxService);
  const platformDispatcher = new PlatformEventDispatcher(notificationService, emailDispatcher);

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

test('Platform Events: WTPP Application lifecycle (received, reviewed, approved, rejected, changes requested)', async () => {
  const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
  const userId = 'creator-1';
  notificationRepo.seedUser(userId, 'creator1@example.com');

  // 1. WTPP_APPLICATION_RECEIVED
  const res1 = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'WTPP_APPLICATION_RECEIVED',
    userId,
    channelId: 'chan-1',
    channelName: 'Creator Channel',
    applicationId: 'app-1',
  });
  assert.equal(res1.inAppCreated, true);
  assert.equal(res1.emailEnqueued, true);

  // Verify in-app notification
  const notifications1 = await notificationRepo.findMany(userId, {});
  assert.equal(notifications1.length, 1);
  assert.equal(notifications1[0].type, 'WTPP_APPLICATION_RECEIVED');
  assert.match(notifications1[0].title, /Application Received/i);

  // Verify email dispatched
  const sentEmails1 = mockTransport.getSentEmails();
  assert.equal(sentEmails1.length, 1);
  assert.equal(sentEmails1[0].to, 'creator1@example.com');
  assert.match(sentEmails1[0].subject, /Application Received/i);

  // 2. WTPP_APPLICATION_APPROVED
  const res2 = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'WTPP_APPLICATION_APPROVED',
    userId,
    channelId: 'chan-1',
    channelName: 'Creator Channel',
    applicationId: 'app-1',
    reviewerNotes: 'Approved! High quality educational videos.',
  });
  assert.equal(res2.inAppCreated, true);
  assert.equal(res2.emailEnqueued, true);

  const notifications2 = await notificationRepo.findMany(userId, {});
  assert.equal(notifications2.length, 2);
  assert.match(notifications2[0].title, /Approved/i);

  const sentEmails2 = mockTransport.getSentEmails();
  assert.equal(sentEmails2.length, 2);
  assert.match(sentEmails2[1].subject, /Approved/i);

  // 3. WTPP_APPLICATION_REJECTED
  const res3 = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'WTPP_APPLICATION_REJECTED',
    userId,
    channelId: 'chan-1',
    channelName: 'Creator Channel',
    applicationId: 'app-1',
    reviewerNotes: 'Watch hours requirement not yet met.',
  });
  assert.equal(res3.inAppCreated, true);
  assert.equal(res3.emailEnqueued, true);

  const sentEmails3 = mockTransport.getSentEmails();
  assert.equal(sentEmails3.length, 3);
  assert.match(sentEmails3[2].subject, /Not Approved/i);
});

test('Platform Events: Video lifecycle events (completed, failed, published)', async () => {
  const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
  const userId = 'creator-video-user';
  notificationRepo.seedUser(userId, 'video.creator@example.com');

  // Video published
  const publishRes = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'VIDEO_PUBLISHED',
    userId,
    videoId: 'vid-100',
    videoTitle: 'My Rwanda Safari Tour',
    channelId: 'chan-100',
  });
  assert.equal(publishRes.inAppCreated, true);
  assert.equal(publishRes.emailEnqueued, true);

  const notifications = await notificationRepo.findMany(userId, {});
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'VIDEO_PUBLISHED');
  assert.match(notifications[0].title, /Video Published/i);

  const emails = mockTransport.getSentEmails();
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'video.creator@example.com');
  assert.match(emails[0].subject, /video is ready/i);

  // Video processing failed
  const failRes = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'VIDEO_PROCESSING_FAILED',
    userId,
    videoId: 'vid-101',
    videoTitle: 'Corrupted Clip',
    channelId: 'chan-100',
    errorReason: 'Audio stream decoding error',
  });
  assert.equal(failRes.inAppCreated, true);
  assert.equal(failRes.emailEnqueued, true);

  const emails2 = mockTransport.getSentEmails();
  assert.equal(emails2.length, 2);
  assert.match(emails2[1].subject, /processing issue/i);
});

test('Platform Events: Mandatory security alerts override preferences and cannot be silenced', async () => {
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
    eventId: crypto.randomUUID(),
    eventType: 'ACCOUNT_SECURITY_ALERT',
    userId,
    title: 'Password Changed Successfully',
    details: 'Your account password was updated from an active session. If this was not you, lock your account immediately.',
    actionUrl: 'https://watchtube.com/settings/security',
  });

  assert.equal(alertRes.inAppCreated, true);
  assert.equal(alertRes.emailEnqueued, true);

  const inAppList = await notificationRepo.findMany(userId, {});
  assert.equal(inAppList.length, 1);
  assert.equal(inAppList[0].type, 'ACCOUNT_SECURITY_ALERT');

  const emails = mockTransport.getSentEmails();
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'target@example.com');
  assert.match(emails[0].subject, /Security Alert/i);
  assert.match(emails[0].subject, /Password Changed Successfully/i);
  assert.match(emails[0].text, /updated from an active session/i);

  // Community guidelines moderation strike is also a mandatory security alert
  const strikeRes = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'MODERATION_STRIKE_ISSUED',
    userId,
    strikeType: 'WARNING',
    reason: 'Copyright infringement warning on video #123',
    expiresAt: new Date(Date.now() + 90 * 86400000),
  });
  assert.equal(strikeRes.inAppCreated, true);
  assert.equal(strikeRes.emailEnqueued, true);

  const emailsAfterStrike = mockTransport.getSentEmails();
  assert.equal(emailsAfterStrike.length, 2);
  assert.match(emailsAfterStrike[1].subject, /Security Alert/i);
});

test('Platform Events: User notification preferences are honored for non-mandatory events', async () => {
  const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
  const userId = 'creator-pref-test';
  notificationRepo.seedUser(userId, 'pref.creator@example.com');

  // Turn off video processing emails, but leave in-app notifications enabled
  await notificationRepo.updatePreferences(userId, {
    emailVideoProcessing: false,
    inAppVideoProcessing: true,
  });

  const res = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'VIDEO_PROCESSING_COMPLETED',
    userId,
    videoId: 'vid-pref-1',
    videoTitle: 'Test Preferences Video',
    channelId: 'chan-pref-1',
  });

  assert.equal(res.inAppCreated, true);
  assert.equal(res.emailEnqueued, false); // Email skipped per user preference

  // In-app notification was still created
  const notifications = await notificationRepo.findMany(userId, {});
  assert.equal(notifications.length, 1);

  // Zero emails were enqueued or sent
  const emails = mockTransport.getSentEmails();
  assert.equal(emails.length, 0);
});

test('Platform Events: Admin role change notifications and copyright decisions', async () => {
  const { platformDispatcher, notificationRepo, mockTransport } = setupTestDispatcher();
  const partnerId = 'admin-partner-1';
  notificationRepo.seedUser(partnerId, 'partner1@watchtube.com');

  // Admin role granted
  const roleRes = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'ADMIN_ROLE_CHANGED',
    userId: partnerId,
    newRole: 'ADMIN',
    positionAssignment: 'Position 1: Trust & Operations Lead',
  });
  assert.equal(roleRes.inAppCreated, true);
  assert.equal(roleRes.emailEnqueued, true);

  const emails = mockTransport.getSentEmails();
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'partner1@watchtube.com');
  assert.match(emails[0].subject, /Administrative Access/i);

  // Copyright decision
  const creatorId = 'creator-claim-target';
  notificationRepo.seedUser(creatorId, 'creator.claim@example.com');

  const claimRes = await platformDispatcher.dispatchPlatformEvent({
    eventId: crypto.randomUUID(),
    eventType: 'COPYRIGHT_DECISION',
    userId: creatorId,
    videoId: 'v-claim-1',
    videoTitle: 'Music Video Cover',
    claimId: 'claim-123',
    status: 'CLAIM_UPHELD',
    claimantName: 'Rwanda Music Publishing Ltd',
    resolutionNotes: 'Content match verified against official sound recording.',
  });
  assert.equal(claimRes.inAppCreated, true);
  assert.equal(claimRes.emailEnqueued, true);

  const claimEmails = mockTransport.getSentEmails().filter((m: { to: string }) => m.to === 'creator.claim@example.com');
  assert.equal(claimEmails.length, 1);
  assert.match(claimEmails[0].subject, /Copyright Decision/i);
});
