import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { requireAdmin } from '../src/middleware/admin';
import {
  createWtppApplicationsRouter,
  WtppApplicationsRepository,
} from '../src/routes/wtpp-applications.route';

const APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
let activeServers: Server[] = [];

async function startServer(repository: WtppApplicationsRepository) {
  const app = express();
  const testIdentity: RequestHandler = (req, res, next) => {
    const role = req.get('x-test-role');
    if (!role) return res.status(401).json({ error: 'Unauthorized' });
    (req as express.Request & { user?: { id: string; role: string } }).user = {
      id: '22222222-2222-4222-8222-222222222222',
      role,
    };
    next();
  };
  app.use('/admin', testIdentity, requireAdmin, createWtppApplicationsRouter(repository));

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

test('pending application responses omit tax and identity document numbers', async () => {
  const submittedAt = new Date('2026-01-02T03:04:05.000Z');
  const application = Object.assign({
    id: APPLICATION_ID,
    channelWatchHours: 12.5,
    subscriberCount: 42,
    submittedAt,
    channel: { name: 'Creator', handle: '@creator' },
  }, {
    taxId: 'private-tax-id',
    nationalIdOrPassport: 'private-identity-document',
    reviewerNotes: 'private-reviewer-note',
  });
  const baseUrl = await startServer({
    async listPendingApplications() {
      return [application];
    },
  });

  const denied = await fetch(`${baseUrl}/admin/`);
  assert.equal(denied.status, 401);
  const viewer = await fetch(`${baseUrl}/admin/`, { headers: { 'x-test-role': 'VIEWER' } });
  assert.equal(viewer.status, 403);

  const response = await fetch(`${baseUrl}/admin/`, { headers: { 'x-test-role': 'ADMIN' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{
    id: APPLICATION_ID,
    channelWatchHours: 12.5,
    subscriberCount: 42,
    submittedAt: submittedAt.toISOString(),
    channel: { name: 'Creator', handle: '@creator' },
  }]);
});
