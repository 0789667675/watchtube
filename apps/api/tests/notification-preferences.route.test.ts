import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { createNotificationRouter } from '../src/routes/notifications.route';
import {
  InMemoryNotificationRepository,
  NotificationService,
} from '../src/services/notifications';

let activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  activeServers = [];
});

async function startPreferencesServer(notificationService: NotificationService) {
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
  return `http://127.0.0.1:${address.port}/notifications/preferences`;
}

test('Notification Preferences API: authentication required for GET and PATCH', async () => {
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(repo);
  const url = await startPreferencesServer(service);

  const getRes = await fetch(url);
  assert.equal(getRes.status, 401);

  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ emailVideoProcessing: false }),
  });
  assert.equal(patchRes.status, 401);
});

test('Notification Preferences API: returns safe defaults on first fetch', async () => {
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(repo);
  const url = await startPreferencesServer(service);

  const res = await fetch(url, {
    headers: { 'x-test-user': 'user-new-pref' },
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.userId, 'user-new-pref');
  assert.equal(body.emailSecurityAlerts, true);
  assert.equal(body.emailFinancialTransfers, true);
  assert.equal(body.emailWtppUpdates, true);
  assert.equal(body.emailVideoProcessing, true);
  assert.equal(body.emailPlatformAnnouncements, true);
  assert.equal(body.inAppFinancialAlerts, true);
  assert.equal(body.inAppVideoProcessing, true);
  assert.equal(body.inAppPlatformAnnouncements, true);
});

test('Notification Preferences API: updates preferences and strictly prevents disabling security alerts', async () => {
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(repo);
  const url = await startPreferencesServer(service);

  // User attempts to disable email security alerts along with other preferences
  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-test-user': 'user-strict-security',
    },
    body: JSON.stringify({
      emailSecurityAlerts: false, // Attempt to disable mandatory security alerts
      emailVideoProcessing: false,
      inAppPlatformAnnouncements: false,
    }),
  });

  assert.equal(patchRes.status, 200);
  const patched = await patchRes.json();

  // Mandatory security alerts MUST remain true
  assert.equal(patched.emailSecurityAlerts, true);
  // Requested toggles must be honored
  assert.equal(patched.emailVideoProcessing, false);
  assert.equal(patched.inAppPlatformAnnouncements, false);
  // Unspecified toggles should remain at default (true)
  assert.equal(patched.emailFinancialTransfers, true);

  // Verify subsequent GET also reflects persistent state
  const getRes = await fetch(url, {
    headers: { 'x-test-user': 'user-strict-security' },
  });
  const refreshed = await getRes.json();
  assert.equal(refreshed.emailSecurityAlerts, true);
  assert.equal(refreshed.emailVideoProcessing, false);
  assert.equal(refreshed.inAppPlatformAnnouncements, false);
});

test('Notification Preferences API: input validation rejects unknown attributes', async () => {
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(repo);
  const url = await startPreferencesServer(service);

  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-test-user': 'user-pref-validation',
    },
    body: JSON.stringify({
      invalidKey: 'malicious-data',
    }),
  });

  assert.equal(patchRes.status, 400);
  const body = await patchRes.json();
  assert.match(body.error, /invalid preferences payload/i);
});

test('Notification Preferences API: strict isolation between distinct users', async () => {
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(repo);
  const url = await startPreferencesServer(service);

  // User A updates preferences
  await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-test-user': 'user-alice',
    },
    body: JSON.stringify({ emailVideoProcessing: false }),
  });

  // User B reads preferences
  const bRes = await fetch(url, {
    headers: { 'x-test-user': 'user-bob' },
  });
  const bData = await bRes.json();

  // User B still has defaults (not affected by User A)
  assert.equal(bData.userId, 'user-bob');
  assert.equal(bData.emailVideoProcessing, true);

  // User A has updated value
  const aRes = await fetch(url, {
    headers: { 'x-test-user': 'user-alice' },
  });
  const aData = await aRes.json();
  assert.equal(aData.userId, 'user-alice');
  assert.equal(aData.emailVideoProcessing, false);
});
