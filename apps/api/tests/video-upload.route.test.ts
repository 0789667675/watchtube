import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request, RequestHandler } from 'express';
import { afterEach, beforeEach, test } from 'node:test';
import { createCorsMiddleware, parseAllowedOrigins } from '../src/middleware/cors';
import {
  createVideoUploadRouter,
  UploadVideo,
  VideoUploadRouteDependencies,
} from '../src/routes/video-upload.route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const VIDEO_ID = '44444444-4444-4444-8444-444444444444';
const RAW_KEY = `uploads/${USER_ID}/55555555-5555-4555-8555-555555555555`;

interface TestVideo extends UploadVideo {
  title: string;
}

interface TestHarness {
  baseUrl: string;
  server: Server;
  video: TestVideo;
  calls: {
    created: number;
    uploadUrls: Array<{ userId: string; key?: string; contentType: string; fileSize: number }>;
    inspection: number;
    queueJobs: Array<{ jobId: string; data: { videoId: string; rawStorageKey: string } }>;
    queueFails: boolean;
    objectMissing: boolean;
    objectContentLength: number;
    objectContentType: string;
    ownsChannel: boolean;
  };
}

let activeServers: Server[] = [];

async function createHarness(): Promise<TestHarness> {
  const video: TestVideo = {
    id: VIDEO_ID,
    channelId: CHANNEL_ID,
    rawStorageKey: RAW_KEY,
    status: 'UPLOADING',
    thumbnailUrl: null,
    channel: { userId: USER_ID },
    title: 'Test video',
  };
  const calls: TestHarness['calls'] = {
    created: 0,
    uploadUrls: [],
    inspection: 0,
    queueJobs: [],
    queueFails: false,
    objectMissing: false,
    objectContentLength: 1024,
    objectContentType: 'video/mp4',
    ownsChannel: true,
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
  const dependencies: VideoUploadRouteDependencies = {
    authenticate,
    repository: {
      ownsChannel: async (_channelId, userId) => calls.ownsChannel && userId === USER_ID,
      createVideo: async () => {
        calls.created += 1;
        return { id: VIDEO_ID };
      },
      findVideo: async (id) => id === VIDEO_ID ? video : null,
      markProcessing: async () => {
        if (video.status !== 'UPLOADING') return false;
        video.status = 'PROCESSING';
        return true;
      },
      listVideos: async () => [],
    },
    storage: {
      createUploadUrl: async (userId, contentType, fileSize, key) => {
        calls.uploadUrls.push({ userId, contentType, fileSize, key });
        return { uploadUrl: 'https://upload.example/presigned', fileKey: key || RAW_KEY };
      },
      inspectObject: async () => {
        calls.inspection += 1;
        if (calls.objectMissing) return null;
        return { contentLength: calls.objectContentLength, contentType: calls.objectContentType };
      },
    },
    queue: {
      add: async (_name, data, options) => {
        calls.queueJobs.push({ jobId: options.jobId, data });
        if (calls.queueFails) throw new Error('test queue failure');
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1', createVideoUploadRouter(dependencies));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, video, calls };
}

async function post(
  baseUrl: string,
  path: string,
  body?: unknown,
  userId = USER_ID,
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

beforeEach(() => {
  activeServers = [];
});

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

test('upload intent requires authentication and validates metadata', async () => {
  const harness = await createHarness();
  const path = '/api/v1/videos/upload-intent';
  const unauthorized = await post(harness.baseUrl, path, {
    title: 'Valid title', contentType: 'video/mp4', fileSize: 1024, channelId: CHANNEL_ID,
  }, '');
  assert.equal(unauthorized.status, 401);

  const malformed = await post(harness.baseUrl, path, {
    title: 'Valid title', contentType: 'video/mp4', fileSize: 0, channelId: CHANNEL_ID,
  });
  assert.equal(malformed.status, 400);
  assert.equal(harness.calls.created, 0);
});

test('upload intent rejects channels not owned by the authenticated user', async () => {
  const harness = await createHarness();
  harness.calls.ownsChannel = false;
  const response = await post(harness.baseUrl, '/api/v1/videos/upload-intent', {
    title: 'Valid title', contentType: 'video/mp4', fileSize: 1024, channelId: CHANNEL_ID,
  });
  assert.equal(response.status, 404);
  assert.equal(harness.calls.uploadUrls.length, 0);
});

test('upload URL renewal is owner-scoped and reuses the original object key', async () => {
  const harness = await createHarness();
  const path = `/api/v1/videos/${VIDEO_ID}/upload-url`;
  const denied = await post(harness.baseUrl, path, { contentType: 'video/mp4', fileSize: 1024 }, OTHER_USER_ID);
  assert.equal(denied.status, 404);

  const renewed = await post(harness.baseUrl, path, { contentType: 'video/mp4', fileSize: 1024 });
  assert.equal(renewed.status, 200);
  assert.equal(harness.calls.uploadUrls.length, 1);
  assert.equal(harness.calls.uploadUrls[0].key, RAW_KEY);
});

test('verification does not queue a missing object and uses a stable job ID on retry', async () => {
  const harness = await createHarness();
  harness.calls.objectMissing = true;
  const path = `/api/v1/videos/${VIDEO_ID}/verify-upload`;
  const missing = await post(harness.baseUrl, path);
  assert.equal(missing.status, 409);
  assert.equal(harness.calls.queueJobs.length, 0);

  harness.calls.objectMissing = false;
  harness.calls.queueFails = true;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  let queueFailure: Response;
  try {
    queueFailure = await post(harness.baseUrl, path);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(queueFailure.status, 503);
  assert.equal(harness.video.status, 'PROCESSING');

  harness.calls.queueFails = false;
  const retried = await post(harness.baseUrl, path);
  assert.equal(retried.status, 202);
  assert.equal(harness.calls.inspection, 2);
  assert.deepEqual(harness.calls.queueJobs.map((job) => job.jobId), [VIDEO_ID, VIDEO_ID]);
});

test('verification rejects oversized or disallowed uploaded object metadata', async () => {
  const harness = await createHarness();
  const path = `/api/v1/videos/${VIDEO_ID}/verify-upload`;
  harness.calls.objectContentLength = 2 * 1024 * 1024 * 1024 + 1;
  const oversized = await post(harness.baseUrl, path);
  assert.equal(oversized.status, 400);

  harness.calls.objectContentLength = 1024;
  harness.calls.objectContentType = 'application/octet-stream';
  const wrongType = await post(harness.baseUrl, path);
  assert.equal(wrongType.status, 400);
  assert.equal(harness.calls.queueJobs.length, 0);
});

test('CORS allows only configured origins and blocks unapproved cross-origin writes', async () => {
  const origins = parseAllowedOrigins('https://viewer.example', true);
  const app = express();
  app.use(createCorsMiddleware(origins));
  app.post('/write', (_req, res) => res.sendStatus(204));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const allowed = await fetch(`${baseUrl}/write`, {
    method: 'POST',
    headers: { Origin: 'https://viewer.example' },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://viewer.example');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');

  const rejected = await fetch(`${baseUrl}/write`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});
