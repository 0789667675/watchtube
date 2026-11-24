import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request, RequestHandler } from 'express';
import { afterEach, beforeEach, test } from 'node:test';
import {
  createChannelImageUploadRouter,
} from '../src/routes/channel-image-upload.route';
import { createChannelRouter } from '../src/routes/channel.route';
import type { ChannelRepository, ChannelSettings } from '../src/routes/channel.route';
import { InvalidChannelImageError } from '../src/services/channel-image.service';
import { StorageUnavailableError } from '../src/services/storage.service';
import type {
  ChannelImageConfirmationInput,
  ChannelImageUploadInput,
} from '../src/services/storage.service';
import type { ChannelImageUploadRouteDependencies } from '../src/routes/channel-image-upload.route';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const UPLOAD_ID = '55555555-5555-4555-8555-555555555555';
const TEST_SECRET = 'channel-image-test-secret-0123456789';
const PUBLIC_IMAGE_URL = `https://cdn.example/channel-images/${CHANNEL_ID}/avatar/verified.webp`;

interface TestChannel extends ChannelSettings {
  userId: string;
}

interface TestHarness {
  baseUrl: string;
  server: Server;
  channels: TestChannel[];
  calls: {
    owns: Array<{ channelId: string; userId: string }>;
    targets: ChannelImageUploadInput[];
    published: ChannelImageConfirmationInput[];
    updates: Array<{
      channelId: string;
      userId: string;
      purpose: 'avatar' | 'banner';
      imageUrl: string;
    }>;
    rejectOwner: boolean;
    missingObject: boolean;
    invalidImage: boolean;
    storageFailure: boolean;
    storageUnavailable: boolean;
    persistenceFailure: boolean;
  };
}

let activeServers: Server[] = [];

function makeChannel(id: string, userId: string): TestChannel {
  return {
    id,
    userId,
    name: id === CHANNEL_ID ? 'Owner channel' : 'Other channel',
    handle: id === CHANNEL_ID ? '@owner' : '@other',
    description: null,
    avatarUrl: null,
    bannerUrl: null,
  };
}

function publicChannel(channel: TestChannel): ChannelSettings {
  const { userId: _userId, ...settings } = channel;
  return settings;
}

async function createHarness(): Promise<TestHarness> {
  const channels = [makeChannel(CHANNEL_ID, OWNER_ID), makeChannel(SECOND_CHANNEL_ID, OTHER_USER_ID)];
  const calls: TestHarness['calls'] = {
    owns: [],
    targets: [],
    published: [],
    updates: [],
    rejectOwner: false,
    missingObject: false,
    invalidImage: false,
    storageFailure: false,
    storageUnavailable: false,
    persistenceFailure: false,
  };
  const authenticate: RequestHandler = (req, res, next) => {
    const userId = req.get('x-test-user');
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as Request & { user?: { id: string; role: string } }).user = { id: userId, role: 'USER' };
    next();
  };

  const dependencies: ChannelImageUploadRouteDependencies = {
    authenticate,
    ticketSecret: TEST_SECRET,
    repository: {
      ownsChannel: async (channelId, userId) => {
        calls.owns.push({ channelId, userId });
        return !calls.rejectOwner
          && channels.some((channel) => channel.id === channelId && channel.userId === userId);
      },
      updateOwnedImage: async (channelId, userId, purpose, imageUrl) => {
        calls.updates.push({ channelId, userId, purpose, imageUrl });
        if (calls.persistenceFailure) throw new Error('simulated database persistence failure');
        const channel = channels.find((item) => item.id === channelId && item.userId === userId);
        if (!channel) return null;
        if (purpose === 'avatar') channel.avatarUrl = imageUrl;
        else channel.bannerUrl = imageUrl;
        return publicChannel(channel);
      },
    },
    storage: {
      createUploadTarget: async (input) => {
        calls.targets.push(input);
        return {
          uploadUrl: 'https://upload.example/presigned',
          uploadId: UPLOAD_ID,
          expiresIn: 900,
        };
      },
      publishUploadedImage: async (input) => {
        calls.published.push(input);
        if (calls.storageUnavailable) {
          throw new StorageUnavailableError(
            'Cloud storage is not configured. Missing environment variable: R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL.',
          );
        }
        if (calls.storageFailure) throw new Error('simulated object storage failure');
        if (calls.invalidImage) throw new InvalidChannelImageError();
        return calls.missingObject ? null : PUBLIC_IMAGE_URL;
      },
    },
  };
  const channelRepository: ChannelRepository = {
    createChannel: async (input) => {
      const channel = makeChannel('77777777-7777-4777-8777-777777777777', input.userId);
      channel.name = input.name;
      channel.handle = input.handle;
      channel.description = input.description ?? null;
      channels.push(channel);
      return publicChannel(channel);
    },
    findPublicChannel: async (handle) => {
      const channel = channels.find((item) => item.handle === handle);
      return channel
        ? { ...publicChannel(channel), subscriberCount: 0, isVerified: false, videos: [] }
        : null;
    },
    findOwnedChannel: async (channelId, userId) => {
      const channel = channels.find((item) => item.id === channelId && item.userId === userId);
      return channel ? publicChannel(channel) : null;
    },
    handleExists: async (handle, exceptChannelId) =>
      channels.some((item) => item.handle === handle && item.id !== exceptChannelId),
    updateOwnedChannel: async (channelId, userId, data) => {
      const channel = channels.find((item) => item.id === channelId && item.userId === userId);
      if (!channel) return null;
      Object.assign(channel, data);
      return publicChannel(channel);
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/channels', createChannelImageUploadRouter(dependencies));
  app.use('/api/v1/channels', createChannelRouter({ authenticate, repository: channelRepository }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, channels, calls };
}

async function post(
  baseUrl: string,
  path: string,
  body?: unknown,
  userId = OWNER_ID,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...(userId ? { 'x-test-user': userId } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function requestIntent(
  harness: TestHarness,
  purpose: 'avatar' | 'banner' = 'avatar',
  body: unknown = { contentType: 'image/png', fileSize: 1024 },
): Promise<{ uploadToken: string }> {
  const response = await post(
    harness.baseUrl,
    `/api/v1/channels/${CHANNEL_ID}/images/${purpose}/upload-intent`,
    body,
  );
  assert.equal(response.status, 201);
  return await response.json() as { uploadToken: string };
}

beforeEach(() => {
  activeServers = [];
});

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

test('upload intent requires authentication and owner authorization', async () => {
  const harness = await createHarness();
  const path = `/api/v1/channels/${CHANNEL_ID}/images/avatar/upload-intent`;
  const body = { contentType: 'image/png', fileSize: 1024 };

  const unauthenticated = await post(harness.baseUrl, path, body, '');
  assert.equal(unauthenticated.status, 401);

  const nonOwner = await post(harness.baseUrl, path, body, OTHER_USER_ID);
  assert.equal(nonOwner.status, 404);

  const crossChannel = await post(
    harness.baseUrl,
    `/api/v1/channels/${SECOND_CHANNEL_ID}/images/avatar/upload-intent`,
    body,
  );
  assert.equal(crossChannel.status, 404);
  assert.equal(harness.calls.targets.length, 0);
});

test('upload intent accepts supported types and returns a short-lived target without an object key', async () => {
  const harness = await createHarness();
  const response = await post(
    harness.baseUrl,
    `/api/v1/channels/${CHANNEL_ID}/images/avatar/upload-intent`,
    { contentType: 'image/webp', fileSize: 1024 },
  );
  assert.equal(response.status, 201);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.uploadUrl, 'https://upload.example/presigned');
  assert.equal(typeof body.uploadToken, 'string');
  assert.equal(body.expiresIn, 900);
  assert.equal('objectKey' in body, false);
  assert.equal('imageUrl' in body, false);
  assert.deepEqual(harness.calls.targets[0], {
    channelId: CHANNEL_ID,
    purpose: 'avatar',
    contentType: 'image/webp',
    fileSize: 1024,
  });
});

test('upload intent rejects unsupported types, invalid sizes, and forged keys', async () => {
  const harness = await createHarness();
  const path = `/api/v1/channels/${CHANNEL_ID}/images/avatar/upload-intent`;
  const unsupported = await post(harness.baseUrl, path, { contentType: 'image/svg+xml', fileSize: 1024 });
  assert.equal(unsupported.status, 400);

  const oversized = await post(harness.baseUrl, path, { contentType: 'image/png', fileSize: 5 * 1024 * 1024 + 1 });
  assert.equal(oversized.status, 400);

  const forgedKey = await post(harness.baseUrl, path, {
    contentType: 'image/png',
    fileSize: 1024,
    objectKey: `channel-images/${SECOND_CHANNEL_ID}/avatar/forged.webp`,
  });
  assert.equal(forgedKey.status, 400);
  assert.equal(harness.calls.targets.length, 0);
});

test('confirmation rechecks channel ownership before accessing the uploaded object', async () => {
  const harness = await createHarness();
  const { uploadToken } = await requestIntent(harness);
  harness.calls.rejectOwner = true;

  const response = await post(
    harness.baseUrl,
    `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`,
    { uploadToken },
  );
  assert.equal(response.status, 404);
  assert.equal(harness.calls.published.length, 0);
  assert.equal(harness.calls.updates.length, 0);
});

test('confirmation rejects missing objects, invalid image content, and arbitrary image URLs', async () => {
  const harness = await createHarness();
  const { uploadToken } = await requestIntent(harness);
  const path = `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`;

  const forged = await post(harness.baseUrl, path, {
    uploadToken,
    objectKey: `channel-image-uploads/${SECOND_CHANNEL_ID}/avatar/${UPLOAD_ID}`,
  });
  assert.equal(forged.status, 400);

  const externalUrl = await post(harness.baseUrl, path, {
    uploadToken,
    imageUrl: 'https://attacker.example/avatar.png',
  });
  assert.equal(externalUrl.status, 400);
  assert.equal(harness.calls.published.length, 0);

  harness.calls.missingObject = true;
  const missing = await post(harness.baseUrl, path, { uploadToken });
  assert.equal(missing.status, 409);
  assert.equal(harness.calls.updates.length, 0);

  harness.calls.missingObject = false;
  harness.calls.invalidImage = true;
  const invalid = await post(harness.baseUrl, path, { uploadToken });
  assert.equal(invalid.status, 400);
  assert.equal(harness.calls.updates.length, 0);
});

test('confirmation reports transient storage failures without persisting an image URL', async () => {
  const harness = await createHarness();
  const { uploadToken } = await requestIntent(harness);
  harness.calls.storageFailure = true;

  const originalConsoleError = console.error;
  console.error = () => undefined;
  let response: Response;
  try {
    response = await post(
      harness.baseUrl,
      `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`,
      { uploadToken },
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.status, 503);
  assert.equal(harness.calls.updates.length, 0);
});

test('confirmation reports missing storage configuration without exposing credentials', async () => {
  const harness = await createHarness();
  const { uploadToken } = await requestIntent(harness);
  harness.calls.storageUnavailable = true;

  const originalConsoleError = console.error;
  console.error = () => undefined;
  let response: Response;
  try {
    response = await post(
      harness.baseUrl,
      `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`,
      { uploadToken },
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 503);
  const body = await response.json() as { error: string };
  assert.match(body.error, /R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL/);
  assert.doesNotMatch(body.error, /access.?key|secret|password/i);
  assert.equal(harness.calls.updates.length, 0);
});

test('confirmation reports persistence failures without returning a successful image URL', async () => {
  const harness = await createHarness();
  const { uploadToken } = await requestIntent(harness);
  harness.calls.persistenceFailure = true;

  const originalConsoleError = console.error;
  console.error = () => undefined;
  let response: Response;
  try {
    response = await post(
      harness.baseUrl,
      `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`,
      { uploadToken },
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error' });
  assert.equal(harness.calls.updates.length, 1);
});

test('a valid ticket cannot be replayed for another channel or by another user', async () => {
  const harness = await createHarness();
  const { uploadToken } = await requestIntent(harness);

  const crossChannel = await post(
    harness.baseUrl,
    `/api/v1/channels/${SECOND_CHANNEL_ID}/images/avatar/confirm`,
    { uploadToken },
  );
  assert.equal(crossChannel.status, 400);

  const otherUser = await post(
    harness.baseUrl,
    `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`,
    { uploadToken },
    OTHER_USER_ID,
  );
  assert.equal(otherUser.status, 400);
  assert.equal(harness.calls.published.length, 0);
});

test('verified avatar uploads persist only the avatar URL on the authorized channel', async () => {
  const harness = await createHarness();
  const { uploadToken } = await requestIntent(harness, 'avatar');
  const response = await post(
    harness.baseUrl,
    `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`,
    { uploadToken },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { channel: ChannelSettings; imageUrl: string };
  assert.equal(body.imageUrl, PUBLIC_IMAGE_URL);
  assert.equal(body.channel.avatarUrl, PUBLIC_IMAGE_URL);
  assert.equal(body.channel.bannerUrl, null);
  assert.deepEqual(harness.calls.updates[0], {
    channelId: CHANNEL_ID,
    userId: OWNER_ID,
    purpose: 'avatar',
    imageUrl: PUBLIC_IMAGE_URL,
  });
  assert.deepEqual(harness.calls.published[0], {
    channelId: CHANNEL_ID,
    purpose: 'avatar',
    contentType: 'image/png',
    fileSize: 1024,
    uploadId: UPLOAD_ID,
  });
  const publicResponse = await fetch(`${harness.baseUrl}/api/v1/channels/%40owner`);
  assert.equal(publicResponse.status, 200);
  const publicChannel = await publicResponse.json() as { avatarUrl: string; bannerUrl: string | null };
  assert.equal(publicChannel.avatarUrl, PUBLIC_IMAGE_URL);
  assert.equal(publicChannel.bannerUrl, null);
  assert.equal(harness.channels[1].avatarUrl, null);
});

test('verified banner uploads persist only the banner URL on the authorized channel', async () => {
  const harness = await createHarness();
  const { uploadToken } = await requestIntent(harness, 'banner', {
    contentType: 'image/jpeg',
    fileSize: 2048,
  });
  const response = await post(
    harness.baseUrl,
    `/api/v1/channels/${CHANNEL_ID}/images/banner/confirm`,
    { uploadToken },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { channel: ChannelSettings; imageUrl: string };
  assert.equal(body.imageUrl, PUBLIC_IMAGE_URL);
  assert.equal(body.channel.avatarUrl, null);
  assert.equal(body.channel.bannerUrl, PUBLIC_IMAGE_URL);
});
