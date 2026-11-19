import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { createStudioRouter, StudioAnalyticsRepository } from '../src/routes/studio.route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
let activeServers: Server[] = [];

async function startServer(repository: StudioAnalyticsRepository) {
  const app = express();
  const authenticate: RequestHandler = (req, res, next) => {
    const userId = req.get('x-test-user');
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    (req as express.Request & { user?: { id: string; role: string } }).user = { id: userId, role: 'CREATOR' };
    next();
  };
  app.use('/studio', createStudioRouter(authenticate, repository));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function createRepository() {
  let requestedPeriod: { from: Date; toExclusive: Date } | null = null;
  const repository: StudioAnalyticsRepository = {
    async findOwnedChannel(userId, channelId) {
      return userId === USER_ID && (!channelId || channelId === CHANNEL_ID)
        ? { id: CHANNEL_ID, subscriberCount: 3 }
        : null;
    },
    async getAnalytics(_channelId, period) {
      requestedPeriod = period;
      return {
        totalViews: 2,
        totalWatchHours: 0.5,
        recentPerformance: [{
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Recorded video',
          views: 2,
          watchHours: 0.5,
          _count: { likes: 1, comments: 0 },
        }],
      };
    },
  };
  return { repository, getRequestedPeriod: () => requestedPeriod };
}

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  activeServers = [];
});

test('Studio analytics scope events to an owned channel and the requested dates', async () => {
  const state = createRepository();
  const baseUrl = await startServer(state.repository);
  const response = await fetch(
    `${baseUrl}/studio/analytics?channelId=${CHANNEL_ID}&from=2026-03-01&to=2026-03-31`,
    { headers: { 'x-test-user': USER_ID } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    period: { from: '2026-03-01', to: '2026-03-31' },
    subscriberCount: 3,
    totalViews: 2,
    totalWatchHours: 0.5,
    recentPerformance: [{
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Recorded video',
      views: 2,
      watchHours: 0.5,
      _count: { likes: 1, comments: 0 },
    }],
  });
  assert.equal(state.getRequestedPeriod()?.from.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(state.getRequestedPeriod()?.toExclusive.toISOString(), '2026-04-01T00:00:00.000Z');
});

test('Studio analytics reject invalid ranges, unauthorized users, and channels they do not own', async () => {
  const state = createRepository();
  const baseUrl = await startServer(state.repository);
  const invalidRange = await fetch(
    `${baseUrl}/studio/analytics?channelId=${CHANNEL_ID}&from=2026-04-01&to=2026-03-01`,
    { headers: { 'x-test-user': USER_ID } },
  );
  assert.equal(invalidRange.status, 400);

  const unauthorized = await fetch(`${baseUrl}/studio/analytics?from=2026-03-01&to=2026-03-31`);
  assert.equal(unauthorized.status, 401);

  const otherChannel = await fetch(
    `${baseUrl}/studio/analytics?channelId=44444444-4444-4444-8444-444444444444&from=2026-03-01&to=2026-03-31`,
    { headers: { 'x-test-user': USER_ID } },
  );
  assert.equal(otherChannel.status, 404);
});
