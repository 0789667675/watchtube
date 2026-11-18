import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request, RequestHandler } from 'express';
import { afterEach, beforeEach, test } from 'node:test';
import {
  ChannelRepository,
  ChannelSettings,
  ChannelUpdateData,
  createChannelRouter,
} from '../src/routes/channel.route';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_CHANNEL_ID = '55555555-5555-4555-8555-555555555555';

interface TestChannel extends ChannelSettings {
  userId: string;
  subscriberCount: number;
  isVerified: boolean;
  videos: Array<{
    id: string;
    title: string;
    description: string | null;
    thumbnailUrl: string | null;
    duration: number | null;
    viewsCount: number;
    createdAt: string;
    publishedAt: string | null;
  }>;
}

interface TestHarness {
  baseUrl: string;
  server: Server;
  channels: TestChannel[];
  calls: {
    settingsReads: Array<{ channelId: string; userId: string }>;
    updates: Array<{ channelId: string; userId: string; data: ChannelUpdateData }>;
  };
}

let activeServers: Server[] = [];

function createChannel(
  id: string,
  userId: string,
  name: string,
  handle: string,
): TestChannel {
  return {
    id,
    userId,
    name,
    handle,
    description: null,
    avatarUrl: null,
    bannerUrl: null,
    subscriberCount: 0,
    isVerified: false,
    videos: [{
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Existing public video',
      description: null,
      thumbnailUrl: null,
      duration: null,
      viewsCount: 0,
      createdAt: '2026-01-02T03:04:05.000Z',
      publishedAt: null,
    }],
  };
}

function settingsOf(channel: TestChannel): ChannelSettings {
  return {
    id: channel.id,
    name: channel.name,
    handle: channel.handle,
    description: channel.description,
    avatarUrl: channel.avatarUrl,
    bannerUrl: channel.bannerUrl,
  };
}

async function createHarness(): Promise<TestHarness> {
  const channels = [
    createChannel(CHANNEL_ID, OWNER_ID, 'First channel', '@first'),
    createChannel(SECOND_CHANNEL_ID, OWNER_ID, 'Second channel', '@second'),
    createChannel(OTHER_CHANNEL_ID, OTHER_USER_ID, 'Other creator channel', '@other'),
  ];
  const calls: TestHarness['calls'] = { settingsReads: [], updates: [] };
  const authenticate: RequestHandler = (req, res, next) => {
    const userId = req.get('x-test-user');
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as Request & { user?: { id: string; role: string } }).user = { id: userId, role: 'USER' };
    next();
  };
  const repository: ChannelRepository = {
    createChannel: async (input) => {
      const channel = createChannel(
        '77777777-7777-4777-8777-777777777777',
        input.userId,
        input.name,
        input.handle,
      );
      channel.description = input.description ?? null;
      channels.push(channel);
      return settingsOf(channel);
    },
    findPublicChannel: async (handle) => {
      const channel = channels.find((item) => item.handle === handle);
      if (!channel) return null;
      const { userId: _userId, ...publicChannel } = channel;
      return publicChannel;
    },
    findOwnedChannel: async (channelId, userId) => {
      calls.settingsReads.push({ channelId, userId });
      const channel = channels.find((item) => item.id === channelId && item.userId === userId);
      return channel ? settingsOf(channel) : null;
    },
    handleExists: async (handle, exceptChannelId) =>
      channels.some((item) => item.handle === handle && item.id !== exceptChannelId),
    updateOwnedChannel: async (channelId, userId, data) => {
      calls.updates.push({ channelId, userId, data });
      const channel = channels.find((item) => item.id === channelId && item.userId === userId);
      if (!channel) return null;
      Object.assign(channel, data);
      return settingsOf(channel);
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/channels', createChannelRouter({ authenticate, repository }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, channels, calls };
}

async function request(
  baseUrl: string,
  path: string,
  method: 'GET' | 'PATCH',
  body?: unknown,
  userId = OWNER_ID,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/channels${path}`, {
    method,
    headers: {
      ...(userId ? { 'x-test-user': userId } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  activeServers = [];
});

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

test('only an authenticated channel owner can retrieve settings', async () => {
  const harness = await createHarness();
  const response = await request(
    harness.baseUrl,
    `/${CHANNEL_ID}/settings`,
    'GET',
  );
  const settings = await response.json() as ChannelSettings & { userId?: string };

  assert.equal(response.status, 200);
  assert.deepEqual(settings, {
    id: CHANNEL_ID,
    name: 'First channel',
    handle: '@first',
    description: null,
    avatarUrl: null,
    bannerUrl: null,
  });
  assert.equal('userId' in settings, false);

  const anonymous = await request(
    harness.baseUrl,
    `/${CHANNEL_ID}/settings`,
    'GET',
    undefined,
    '',
  );
  assert.equal(anonymous.status, 401);

  const nonOwner = await request(
    harness.baseUrl,
    `/${OTHER_CHANNEL_ID}/settings`,
    'GET',
    undefined,
    OWNER_ID,
  );
  assert.equal(nonOwner.status, 404);
});

test('an owner can update channel fields and the public channel endpoint returns the saved values', async () => {
  const harness = await createHarness();
  const response = await request(
    harness.baseUrl,
    `/${CHANNEL_ID}/settings`,
    'PATCH',
    { name: '  Updated channel  ', handle: 'updated_handle', description: ' Updated description ' },
  );
  const updated = await response.json() as ChannelSettings;

  assert.equal(response.status, 200);
  assert.deepEqual(updated, {
    id: CHANNEL_ID,
    name: 'Updated channel',
    handle: '@updated_handle',
    description: 'Updated description',
    avatarUrl: null,
    bannerUrl: null,
  });

  const publicResponse = await request(
    harness.baseUrl,
    '/@updated_handle',
    'GET',
    undefined,
    '',
  );
  const publicChannel = await publicResponse.json() as TestChannel;
  assert.equal(publicResponse.status, 200);
  assert.equal(publicChannel.name, updated.name);
  assert.equal(publicChannel.handle, updated.handle);
  assert.equal(publicChannel.description, updated.description);
  assert.equal(publicChannel.videos.length, 1);
});

test('unauthenticated and non-owner update attempts cannot change a channel', async () => {
  const harness = await createHarness();
  const anonymous = await request(
    harness.baseUrl,
    `/${CHANNEL_ID}/settings`,
    'PATCH',
    { name: 'Unauthorized change' },
    '',
  );
  assert.equal(anonymous.status, 401);

  const nonOwner = await request(
    harness.baseUrl,
    `/${OTHER_CHANNEL_ID}/settings`,
    'PATCH',
    { name: 'Cross-channel change' },
  );
  assert.equal(nonOwner.status, 404);
  assert.equal(harness.channels.find((channel) => channel.id === OTHER_CHANNEL_ID)?.name, 'Other creator channel');
  assert.equal(harness.calls.updates.length, 0);
});

test('duplicate handles are rejected without updating the channel', async () => {
  const harness = await createHarness();
  const response = await request(
    harness.baseUrl,
    `/${CHANNEL_ID}/settings`,
    'PATCH',
    { handle: '@second' },
  );

  assert.equal(response.status, 409);
  assert.equal(harness.channels.find((channel) => channel.id === CHANNEL_ID)?.handle, '@first');
  assert.equal(harness.calls.updates.length, 0);
});

test('invalid fields, image references, public links and account fields are rejected', async () => {
  const harness = await createHarness();
  const invalidUpdates = [
    { name: '   ' },
    { handle: 'has spaces' },
    { avatarUrl: 'javascript:alert(1)' },
    { bannerUrl: 'not a URL' },
    { websiteUrl: 'https://example.com' },
    { email: 'new@example.com' },
  ];

  for (const body of invalidUpdates) {
    const response = await request(
      harness.baseUrl,
      `/${CHANNEL_ID}/settings`,
      'PATCH',
      body,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(harness.calls.updates.length, 0);
});

test('multiple owned channels remain isolated during updates', async () => {
  const harness = await createHarness();
  const response = await request(
    harness.baseUrl,
    `/${CHANNEL_ID}/settings`,
    'PATCH',
    { description: 'Only the first channel changes' },
  );

  assert.equal(response.status, 200);
  assert.equal(harness.channels.find((channel) => channel.id === CHANNEL_ID)?.description, 'Only the first channel changes');
  assert.equal(harness.channels.find((channel) => channel.id === SECOND_CHANNEL_ID)?.description, null);
});

test('malformed channel IDs are rejected before repository access', async () => {
  const harness = await createHarness();
  const response = await request(
    harness.baseUrl,
    '/not-a-uuid/settings',
    'PATCH',
    { name: 'Updated name' },
  );

  assert.equal(response.status, 400);
  assert.equal(harness.calls.settingsReads.length, 0);
  assert.equal(harness.calls.updates.length, 0);
});
