import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import {
  createAdConfigRouter,
  createAdEventRouter,
  createRevenueReconciliationRouter,
} from '../src/routes/monetization.route';

let activeServers: Server[] = [];

async function startServer() {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, res, next) => {
    if (!req.get('x-test-user')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
  const requireAdmin: RequestHandler = (req, res, next) => {
    if (!req.get('x-test-admin')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
  app.use(
    '/api/v1/monetization',
    createAdEventRouter(authenticate),
    createAdConfigRouter(async () => []),
    createRevenueReconciliationRouter(authenticate, requireAdmin),
  );

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  activeServers = [];
});

test('ad events require authentication and remain disabled until provider verification exists', async () => {
  const baseUrl = await startServer();
  const path = `${baseUrl}/api/v1/monetization/ad-event`;
  const body = {
    videoId: '11111111-1111-4111-8111-111111111111',
    eventType: 'AD_VIEWABLE',
    provider: 'untrusted-client',
    sessionId: 'client-session',
  };

  const unauthorized = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': 'test-user' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: 'Ad event verification is not configured',
  });
});

test('ad config reports no ads when no provider is configured', async () => {
  const baseUrl = await startServer();
  const response = await fetch(`${baseUrl}/api/v1/monetization/config`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: false,
    providers: [],
    adSkipOffsetSeconds: 5,
  });
});

test('reconciliation remains admin-only and unavailable without verified allocation', async () => {
  const baseUrl = await startServer();
  const path = `${baseUrl}/api/v1/monetization/reconcile`;

  const unauthorized = await fetch(path, { method: 'POST' });
  assert.equal(unauthorized.status, 401);

  const forbidden = await fetch(path, {
    method: 'POST',
    headers: { 'x-test-user': 'test-user' },
  });
  assert.equal(forbidden.status, 403);

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'x-test-user': 'test-user', 'x-test-admin': 'test-admin' },
    body: JSON.stringify({ monthYear: '2026-10', grossProviderRevenueCents: 50000 }),
  });
  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: 'Revenue reconciliation is unavailable until verified allocation is configured',
  });
});
