import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, test } from 'node:test';
import type { Prisma } from '@watchtube/database';
import { createAuthenticate, type AuthenticatedUser } from '../src/middleware/auth';
import { createPublicVideosHandler, createFeedRouter } from '../src/routes/feed.route';
import { createSubscriptionFeedRouter } from '../src/routes/interaction.route';
import { JWT_SECRET } from '../src/config/jwt';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const video = { id: 'public-video-from-test-repository' };
const token = jwt.sign({ id: USER_ID, role: 'VIEWER' }, JWT_SECRET, { expiresIn: '1h' });
let activeServers: Server[] = [];

async function startServer(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function authenticate(status: AuthenticatedUser['status'] = 'GOOD_STANDING') {
  return createAuthenticate(async (id) => ({ id, role: 'VIEWER', status }));
}

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  activeServers = [];
});

test('home feed returns real repository results with public and ready filters', async () => {
  let query: Prisma.VideoFindManyArgs | undefined;
  const app = express();
  app.get('/api/v1/videos', createPublicVideosHandler(async (args) => {
    query = args;
    return [video];
  }));
  const response = await fetch(`${await startServer(app)}/api/v1/videos`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [video]);
  assert.deepEqual(query?.where, {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
  });
});

test('home feed reports a missing database as service unavailable without exposing details', async () => {
  const app = express();
  app.get('/api/v1/videos', createPublicVideosHandler(async () => {
    const error = new Error('database connection detail must not be returned');
    error.name = 'PrismaClientInitializationError';
    throw error;
  }));
  const response = await fetch(`${await startServer(app)}/api/v1/videos`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Discover videos are temporarily unavailable because the database is unavailable.',
  });
});

test('trending feed includes real public engagement, sorts it, paginates, and reports database failures', async () => {
  let query: Prisma.VideoFindManyArgs | undefined;
  let shouldFail = false;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async (args) => {
      query = args;
      if (shouldFail) throw Object.assign(new Error('database offline'), { errorCode: 'P1001' });
      return [video];
    },
  ));
  const baseUrl = await startServer(app);

  const success = await fetch(`${baseUrl}/api/v1/feed/trending?page=2&limit=3`);
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), {
    videos: [video],
    pagination: { page: 2, limit: 3, hasMore: false },
  });
  assert.deepEqual(query?.where, {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
    OR: [
      { viewsCount: { gt: 0 } },
      { likes: { some: { isDislike: false } } },
      { comments: { some: {} } },
    ],
  });
  assert.equal('createdAt' in (query?.where ?? {}), false);
  assert.equal(query?.skip, 3);
  assert.equal(query?.take, 4);
  assert.deepEqual(query?.orderBy, [
    { viewsCount: 'desc' },
    { comments: { _count: 'desc' } },
    { createdAt: 'desc' },
  ]);

  shouldFail = true;
  const failure = await fetch(`${baseUrl}/api/v1/feed/trending`);
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), {
    error: 'Trending videos are temporarily unavailable because the database is unavailable.',
  });
});

test('trending rejects malformed pagination before querying', async () => {
  let queries = 0;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(async () => {
    queries += 1;
    return [];
  }));
  const baseUrl = await startServer(app);

  for (const url of [
    '/api/v1/feed/trending?page=0',
    '/api/v1/feed/trending?page=1001',
    '/api/v1/feed/trending?limit=51',
  ]) {
    const response = await fetch(`${baseUrl}${url}`);
    assert.equal(response.status, 400);
  }
  assert.equal(queries, 0);
});

test('search returns separately paginated public video and creator results', async () => {
  let videoQuery: Prisma.VideoFindManyArgs | undefined;
  let channelQuery: Prisma.ChannelFindManyArgs | undefined;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async (args) => {
      videoQuery = args;
      return [video, { id: 'second-video' }, { id: 'third-video' }, { id: 'lookahead-video' }];
    },
    async (args) => {
      channelQuery = args;
      return [{ id: 'creator-1' }, { id: 'creator-2' }, { id: 'creator-3' }, { id: 'lookahead-creator' }];
    },
  ));
  const response = await fetch(`${await startServer(app)}/api/v1/feed/search?q=%20music%20&page=2&limit=3`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    videos: [video, { id: 'second-video' }, { id: 'third-video' }],
    channels: [{ id: 'creator-1' }, { id: 'creator-2' }, { id: 'creator-3' }],
    pagination: { page: 2, limit: 3, hasMoreVideos: true, hasMoreChannels: true },
  });
  assert.deepEqual(videoQuery?.where, {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
    OR: [
      { title: { contains: 'music', mode: 'insensitive' } },
      { description: { contains: 'music', mode: 'insensitive' } },
      { channel: { name: { contains: 'music', mode: 'insensitive' } } },
      { channel: { handle: { contains: 'music', mode: 'insensitive' } } },
    ],
  });
  assert.equal(videoQuery?.skip, 3);
  assert.equal(videoQuery?.take, 4);
  assert.deepEqual(channelQuery?.where, {
    OR: [
      { name: { contains: 'music', mode: 'insensitive' } },
      { handle: { contains: 'music', mode: 'insensitive' } },
    ],
  });
  assert.equal(channelQuery?.skip, 3);
  assert.equal(channelQuery?.take, 4);
});

test('search rejects blank, oversized, and malformed pagination parameters before querying', async () => {
  let queries = 0;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async () => { queries += 1; return []; },
    async () => { queries += 1; return []; },
  ));
  const baseUrl = await startServer(app);

  for (const url of [
    '/api/v1/feed/search?q=%20%20',
    `/api/v1/feed/search?q=${'x'.repeat(101)}`,
    '/api/v1/feed/search?q=music&page=0',
    '/api/v1/feed/search?q=music&limit=51',
  ]) {
    const response = await fetch(`${baseUrl}${url}`);
    assert.equal(response.status, 400);
  }
  assert.equal(queries, 0);
});

test('subscriptions reject unauthenticated requests and return only public videos from followed channels', async () => {
  let channelLookupCount = 0;
  let query: Prisma.VideoFindManyArgs | undefined;
  const app = express();
  app.use(createSubscriptionFeedRouter(authenticate(), {
    async findChannelIds(userId) {
      channelLookupCount += 1;
      assert.equal(userId, USER_ID);
      return [{ channelId: CHANNEL_ID }];
    },
    async findVideos(args) {
      query = args;
      return [video];
    },
  }));
  const baseUrl = await startServer(app);

  const unauthenticated = await fetch(`${baseUrl}/feed/subscriptions`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(channelLookupCount, 0);

  const authenticated = await fetch(`${baseUrl}/feed/subscriptions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), [video]);
  assert.deepEqual(query?.where, {
    channelId: { in: [CHANNEL_ID] },
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
  });
});

test('subscriptions report database failures and preserve account restrictions', async () => {
  const app = express();
  app.use(createSubscriptionFeedRouter(authenticate(), {
    async findChannelIds() {
      throw Object.assign(new Error('database offline'), { code: 'P1003' });
    },
    async findVideos() {
      return [];
    },
  }));
  const baseUrl = await startServer(app);

  const unavailable = await fetch(`${baseUrl}/feed/subscriptions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: 'Subscriptions are temporarily unavailable because the database is unavailable.',
  });

  const restrictedApp = express();
  restrictedApp.use(createSubscriptionFeedRouter(authenticate('RESTRICTED'), {
    async findChannelIds() {
      throw new Error('restricted accounts must not query subscriptions');
    },
    async findVideos() {
      return [];
    },
  }));
  const restrictedBaseUrl = await startServer(restrictedApp);
  const restricted = await fetch(`${restrictedBaseUrl}/feed/subscriptions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(restricted.status, 403);
});
