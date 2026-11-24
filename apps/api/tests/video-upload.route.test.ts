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
import { isValidProcessedThumbnailKey } from '../src/services/storage.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const VIDEO_ID = '44444444-4444-4444-8444-444444444444';
const RAW_KEY = `uploads/${USER_ID}/55555555-5555-4555-8555-555555555555`;
const VALID_METADATA = {
  title: 'Valid title',
  description: 'Video description',
  tags: ['music', 'live'],
  category: 'MUSIC',
  language: 'en',
  madeForKids: false,
  visibility: 'UNLISTED',
  copyrightDeclared: false,
};

test('publication accepts generated poster and owned custom-thumbnail keys only', () => {
  assert.equal(isValidProcessedThumbnailKey(VIDEO_ID, `processing/${VIDEO_ID}/poster.jpg`), true);
  assert.equal(
    isValidProcessedThumbnailKey(
      VIDEO_ID,
      `processing/${VIDEO_ID}/custom-thumbnail-66666666-6666-4666-8666-666666666666.webp`,
    ),
    true,
  );
  assert.equal(isValidProcessedThumbnailKey(VIDEO_ID, `processing/${VIDEO_ID}/other.jpg`), false);
  assert.equal(isValidProcessedThumbnailKey(VIDEO_ID, 'processing/another-video/poster.jpg'), false);
});

interface TestHarness {
  baseUrl: string;
  server: Server;
  video: UploadVideo;
  calls: {
    created: number;
    uploadUrls: Array<{ userId: string; key?: string; contentType: string; fileSize: number }>;
    inspection: number;
    queueJobs: Array<{
      jobId: string;
      data: { videoId: string; rawStorageKey: string };
      options: {
        attempts: number;
        backoff: { type: 'exponential'; delay: number };
      };
    }>;
    queueFails: boolean;
    queueReady: boolean;
    objectMissing: boolean;
    objectContentLength: number;
    objectContentType: string;
    ownsChannel: boolean;
    listFails: boolean;
    listDatabaseUnavailable: boolean;
    storageFails: boolean;
    storageError: unknown | null;
    blockingClaim: boolean;
    metadataUpdates: number;
    thumbnailFails: boolean;
    thumbnailIsShort: boolean[];
    publishedAssetsDeleted: number;
    publicPromotions: number;
    publishedAssetsPersisted: number;
  };
}

let activeServers: Server[] = [];

async function createHarness(): Promise<TestHarness> {
  const video: UploadVideo = {
    id: VIDEO_ID,
    isShort: false,
    channelId: CHANNEL_ID,
    rawStorageKey: RAW_KEY,
    processingAttempts: 0,
    status: 'UPLOADING',
    thumbnailUrl: null,
    thumbnailStorageKey: null,
    pendingThumbnailStorageKey: null,
    pendingThumbnailContentType: null,
    pendingThumbnailFileSize: null,
    uploadContentType: 'video/mp4',
    uploadFileSize: 1024n,
    description: null,
    tags: [],
    category: 'OTHER',
    language: 'en',
    madeForKids: false,
    visibility: 'PRIVATE',
    copyrightDeclared: false,
    copyrightDeclaredAt: null,
    copyrightDeclaredById: null,
    copyrightReviewStatus: 'NOT_SCANNED',
    channel: { userId: USER_ID, isMonetized: false },
    title: 'Test video',
  };
  const calls: TestHarness['calls'] = {
    created: 0,
    uploadUrls: [],
    inspection: 0,
    queueJobs: [],
    queueFails: false,
    queueReady: true,
    objectMissing: false,
    objectContentLength: 1024,
    objectContentType: 'video/mp4',
    ownsChannel: true,
    listFails: false,
    listDatabaseUnavailable: false,
    storageFails: false,
    storageError: null,
    blockingClaim: false,
    metadataUpdates: 0,
    thumbnailFails: false,
    thumbnailIsShort: [],
    publishedAssetsDeleted: 0,
    publicPromotions: 0,
    publishedAssetsPersisted: 0,
  };
  const authenticate: RequestHandler = (req, res, next) => {
    const userId = req.get('x-test-user')
      ?? req.get('authorization')?.replace(/^Bearer /i, '');
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
      createDraft: async (data) => {
        calls.created += 1;
        Object.assign(video, data, { status: 'DRAFT', rawStorageKey: null });
        return { id: VIDEO_ID };
      },
      updateMetadata: async ({ userId, metadata, publishedAssets }) => {
        if (userId !== USER_ID) return false;
        calls.metadataUpdates += 1;
        if (publishedAssets) {
          calls.publishedAssetsPersisted += 1;
          video.thumbnailUrl = publishedAssets.thumbnailUrl;
        }
        const wasDeclared = video.copyrightDeclared;
        Object.assign(video, metadata, { copyrightDeclared: wasDeclared || metadata.copyrightDeclared });
        if (metadata.copyrightDeclared && !video.copyrightDeclaredAt) {
          video.copyrightDeclaredAt = new Date();
          video.copyrightDeclaredById = userId;
        }
        return true;
      },
      setUploadTarget: async ({ userId, rawStorageKey, contentType, fileSize }) => {
        if (userId !== USER_ID || video.status !== 'DRAFT') return false;
        Object.assign(video, {
          rawStorageKey,
          uploadContentType: contentType,
          uploadFileSize: BigInt(fileSize),
          status: 'UPLOADING',
        });
        return true;
      },
      setPendingThumbnailUpload: async ({ userId, key, contentType, fileSize }) => {
        if (userId !== USER_ID) return false;
        Object.assign(video, {
          pendingThumbnailStorageKey: key,
          pendingThumbnailContentType: contentType,
          pendingThumbnailFileSize: BigInt(fileSize),
        });
        return true;
      },
      confirmThumbnailUpload: async (id, userId, storageKey) => {
        if (id !== VIDEO_ID || userId !== USER_ID || video.pendingThumbnailStorageKey !== storageKey) return false;
        video.thumbnailStorageKey = storageKey;
        video.pendingThumbnailStorageKey = null;
        return true;
      },
      findVideo: async (id) => id === VIDEO_ID ? video : null,
      hasBlockingCopyrightClaim: async () => calls.blockingClaim,
      markUploaded: async () => {
        if (!['UPLOADING', 'FAILED'].includes(video.status)) return false;
        video.status = 'UPLOADED';
        return true;
      },
      markProcessing: async () => {
        if (video.status !== 'UPLOADED') return null;
        video.status = 'PROCESSING';
        video.processingAttempts += 1;
        return video.processingAttempts;
      },
      publishVideo: async ({ thumbnailUrl }) => {
        if (calls.blockingClaim) return false;
        video.status = 'PUBLISHED';
        video.thumbnailUrl = thumbnailUrl ?? video.thumbnailUrl;
        return true;
      },
      listVideos: async () => {
        if (calls.listDatabaseUnavailable) {
          throw Object.assign(new Error('private connection details'), { code: 'P1001' });
        }
        if (calls.listFails) throw new Error('database connection details');
        return [];
      },
    },
    storage: {
      createUploadUrl: async (userId, contentType, fileSize, key) => {
        if (calls.storageFails) {
          throw calls.storageError ?? new Error('storage credentials must not be returned');
        }
        calls.uploadUrls.push({ userId, contentType, fileSize, key });
        return { uploadUrl: 'https://upload.example/presigned', fileKey: key || RAW_KEY };
      },
      inspectObject: async () => {
        calls.inspection += 1;
        if (calls.objectMissing) return null;
        return { contentLength: calls.objectContentLength, contentType: calls.objectContentType };
      },
      createThumbnailUploadTarget: async (_id, _contentType, _fileSize) => {
        if (calls.storageFails) throw new Error('test storage failure');
        return {
          uploadUrl: 'https://upload.example/thumbnail',
          storageKey: `processing/${VIDEO_ID}/custom-thumbnail-66666666-6666-4666-8666-666666666666.webp`,
          expiresIn: 900,
        };
      },
      normalizeThumbnail: async (_key, _contentType, _fileSize, isShort) => {
        calls.thumbnailIsShort.push(isShort);
        return !calls.thumbnailFails;
      },
      publishAssets: async () => {
        calls.publicPromotions += 1;
        return {
          thumbnailUrl: 'https://media.example/video-thumb.webp',
          playlistUrls: { '360p': 'https://media.example/360p.m3u8' },
        };
      },
      deletePublishedAssets: async () => { calls.publishedAssetsDeleted += 1; },
    },
    queue: {
      add: async (_name, data, options) => {
        calls.queueJobs.push({ jobId: options.jobId, data, options });
        if (calls.queueFails) throw new Error('test queue failure');
      },
    },
    isQueueReady: () => calls.queueReady,
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1', createVideoUploadRouter(dependencies));
  app.get('/api/v1/videos/:id([0-9a-fA-F-]+)', (req, res) => {
    const isPublic = video.status === 'PUBLISHED' && video.visibility !== 'PRIVATE';
    if (!isPublic || req.params.id !== video.id) {
      res.status(404).json({ error: 'Video not found or not available' });
      return;
    }
    res.status(200).json({ id: video.id, title: video.title });
  });
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

async function patch(
  baseUrl: string,
  path: string,
  body: unknown,
  userId = USER_ID,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      ...(userId ? { 'x-test-user': userId } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
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

test('draft creation requires authentication and validates video metadata', async () => {
  const harness = await createHarness();
  const path = '/api/v1/videos/drafts';
  const unauthorized = await post(harness.baseUrl, path, {
    ...VALID_METADATA, channelId: CHANNEL_ID,
  }, '');
  assert.equal(unauthorized.status, 401);

  const malformed = await post(harness.baseUrl, path, {
    ...VALID_METADATA, tags: Array.from({ length: 21 }, (_value, index) => `tag-${index}`), channelId: CHANNEL_ID,
  });

  assert.equal(malformed.status, 400);
  assert.equal(harness.calls.created, 0);
});

test('public watch reads fall through to the public API while owner metadata stays private', async () => {
  const harness = await createHarness();
  const path = `/api/v1/videos/${VIDEO_ID}`;

  const privateResponse = await fetch(`${harness.baseUrl}${path}`);
  assert.equal(privateResponse.status, 404);

  harness.video.status = 'PUBLISHED';
  harness.video.visibility = 'PUBLIC';
  const publicResponse = await fetch(`${harness.baseUrl}${path}`);
  assert.equal(publicResponse.status, 200);
  assert.deepEqual(await publicResponse.json(), { id: VIDEO_ID, title: 'Test video' });

  harness.video.visibility = 'PRIVATE';
  const notOwnerResponse = await fetch(`${harness.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${OTHER_USER_ID}` },
  });
  assert.equal(notOwnerResponse.status, 404);

  const ownerResponse = await fetch(`${harness.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${USER_ID}` },
  });
  assert.equal(ownerResponse.status, 200);
  assert.equal((await ownerResponse.json() as { videoId: string }).videoId, VIDEO_ID);
});

test('draft creation rejects channels not owned by the authenticated user', async () => {
  const harness = await createHarness();
  harness.calls.ownsChannel = false;
  const response = await post(harness.baseUrl, '/api/v1/videos/drafts', {
    ...VALID_METADATA, channelId: CHANNEL_ID,
  });
  assert.equal(response.status, 404);
  assert.equal(harness.calls.uploadUrls.length, 0);
});

test('draft metadata persists tags and an authenticated copyright declaration', async () => {
  const harness = await createHarness();
  const response = await post(harness.baseUrl, '/api/v1/videos/drafts', {
    ...VALID_METADATA,
    title: '  My creator video  ',
    tags: ['tag one', 'tag one', 'tag two'],
    copyrightDeclared: true,
    channelId: CHANNEL_ID,
  });
  assert.equal(response.status, 201);
  assert.equal(harness.video.title, 'My creator video');
  assert.deepEqual(harness.video.tags, ['tag one', 'tag two']);
  assert.equal(harness.video.copyrightDeclared, true);
  assert.equal(harness.video.copyrightDeclaredById, USER_ID);
  assert.ok(harness.video.copyrightDeclaredAt instanceof Date);
});

test('metadata edits persist and reload only for the owning creator', async () => {
  const harness = await createHarness();
  const path = `/api/v1/videos/${VIDEO_ID}`;
  const denied = await patch(harness.baseUrl, path, {
    ...VALID_METADATA,
    title: 'Unauthorized edit',
  }, OTHER_USER_ID);
  assert.equal(denied.status, 404);
  assert.equal(harness.video.title, 'Test video');

  const saved = await patch(harness.baseUrl, path, {
    ...VALID_METADATA,
    title: 'Updated creator title',
    description: 'Updated description',
    tags: ['tag one', 'tag two'],
    copyrightDeclared: true,
  });
  assert.equal(saved.status, 200);
  assert.equal(harness.video.copyrightDeclaredById, USER_ID);
  assert.ok(harness.video.copyrightDeclaredAt instanceof Date);

  const reloaded = await fetch(`${harness.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${USER_ID}` },
  });
  assert.equal(reloaded.status, 200);
  const metadata = await reloaded.json() as { title: string; description: string; tags: string[] };
  assert.equal(metadata.title, 'Updated creator title');
  assert.equal(metadata.description, 'Updated description');
  assert.deepEqual(metadata.tags, ['tag one', 'tag two']);
  assert.equal(harness.calls.metadataUpdates, 1);
});

test('changing a published private video to public promotes and persists its playable assets', async () => {
  const harness = await createHarness();
  harness.video.status = 'PUBLISHED';
  harness.video.visibility = 'PRIVATE';
  harness.video.thumbnailStorageKey = `processing/${VIDEO_ID}/poster.jpg`;
  harness.video.copyrightDeclared = true;
  harness.video.copyrightDeclaredAt = new Date();
  harness.video.copyrightDeclaredById = USER_ID;
  const response = await fetch(`${harness.baseUrl}/api/v1/videos/${VIDEO_ID}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-test-user': USER_ID,
    },
    body: JSON.stringify({ ...VALID_METADATA, visibility: 'PUBLIC' }),
  });

  assert.equal(response.status, 200);
  assert.equal(harness.video.visibility, 'PUBLIC');
  assert.equal(harness.calls.publicPromotions, 1);
  assert.equal(harness.calls.publishedAssetsPersisted, 1);
  assert.equal(harness.video.thumbnailUrl, 'https://media.example/video-thumb.webp');
});

test('changing a published private video to public remains blocked by a verified claim', async () => {
  const harness = await createHarness();
  harness.video.status = 'PUBLISHED';
  harness.video.visibility = 'PRIVATE';
  harness.video.copyrightDeclared = true;
  harness.video.copyrightDeclaredAt = new Date();
  harness.video.copyrightDeclaredById = USER_ID;
  harness.calls.blockingClaim = true;
  const response = await fetch(`${harness.baseUrl}/api/v1/videos/${VIDEO_ID}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-test-user': USER_ID,
    },
    body: JSON.stringify({ ...VALID_METADATA, visibility: 'PUBLIC' }),
  });

  assert.equal(response.status, 409);
  assert.equal(harness.video.visibility, 'PRIVATE');
  assert.equal(harness.calls.publicPromotions, 0);
});

test('upload intent reports unavailable storage without creating another video', async () => {
  const harness = await createHarness();
  harness.video.status = 'DRAFT';
  harness.video.rawStorageKey = null;
  harness.calls.storageFails = true;
  const response = await post(harness.baseUrl, '/api/v1/videos/upload-intent', {
    videoId: VIDEO_ID, contentType: 'video/mp4', fileSize: 1024,
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'STORAGE_TEMPORARY');
  assert.equal(harness.calls.created, 0);
  assert.doesNotMatch(JSON.stringify(body), /credentials/);
});

test('upload intent identifies throttled storage without exposing provider details', async () => {
  const harness = await createHarness();
  harness.video.status = 'DRAFT';
  harness.video.rawStorageKey = null;
  harness.calls.storageFails = true;
  harness.calls.storageError = Object.assign(new Error('provider response details'), {
    name: 'SlowDown',
    $metadata: { httpStatusCode: 503 },
  });
  const response = await post(harness.baseUrl, '/api/v1/videos/upload-intent', {
    videoId: VIDEO_ID, contentType: 'video/mp4', fileSize: 1024,
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'STORAGE_THROTTLED');
  assert.match(body.error, /throttling/);
  assert.doesNotMatch(JSON.stringify(body), /provider response details/);
});

test('a repeated upload intent cannot create another video or replace an active upload', async () => {
  const harness = await createHarness();
  harness.video.status = 'DRAFT';
  harness.video.rawStorageKey = null;
  const body = { videoId: VIDEO_ID, contentType: 'video/mp4', fileSize: 1024 };
  const first = await post(harness.baseUrl, '/api/v1/videos/upload-intent', body);
  const duplicate = await post(harness.baseUrl, '/api/v1/videos/upload-intent', body);
  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 409);
  assert.equal(harness.calls.uploadUrls.length, 1);
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
  assert.deepEqual(harness.calls.queueJobs[0].options, {
    jobId: VIDEO_ID,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
});

test('verification does not mark a video processing while Redis is unavailable', async () => {
  const harness = await createHarness();
  harness.calls.queueReady = false;
  const response = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/verify-upload`);
  assert.equal(response.status, 503);
  assert.equal(harness.video.status, 'UPLOADED');
  assert.equal(harness.calls.queueJobs.length, 0);
});

test('a failed processing attempt can be retried with a distinct stable job ID', async () => {
  const harness = await createHarness();
  harness.video.status = 'FAILED';
  harness.video.processingAttempts = 1;
  const response = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/verify-upload`);
  assert.equal(response.status, 202);
  assert.equal(harness.video.status, 'PROCESSING');
  assert.equal(harness.calls.queueJobs[0].jobId, `${VIDEO_ID}-retry-2`);
});

test('Short upload intents reject invalid duration, aspect ratio, and oversized files', async () => {
  const harness = await createHarness();
  harness.video.status = 'DRAFT';
  harness.video.rawStorageKey = null;
  harness.video.isShort = true;

  const tooLong = await post(harness.baseUrl, '/api/v1/videos/upload-intent', {
    videoId: VIDEO_ID,
    contentType: 'video/mp4',
    fileSize: 1024,
    duration: 181,
    width: 1080,
    height: 1920,
  });
  assert.equal(tooLong.status, 400);

  const wrongAspect = await post(harness.baseUrl, '/api/v1/videos/upload-intent', {
    videoId: VIDEO_ID,
    contentType: 'video/mp4',
    fileSize: 1024,
    duration: 60,
    width: 1920,
    height: 1080,
  });
  assert.equal(wrongAspect.status, 400);

  const valid = await post(harness.baseUrl, '/api/v1/videos/upload-intent', {
    videoId: VIDEO_ID,
    contentType: 'video/mp4',
    fileSize: 1024,
    duration: 60,
    width: 1080,
    height: 1920,
  });
  assert.equal(valid.status, 201);
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

test('video listing returns a sanitized server error when the repository fails', async () => {
  const harness = await createHarness();
  harness.calls.listFails = true;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  let response: Response;
  try {
    response = await fetch(`${harness.baseUrl}/api/v1/videos/mine`, {
      headers: { 'x-test-user': USER_ID },
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error' });
});

test('video listing reports database connectivity failures as 503 without leaking details', async () => {
  const harness = await createHarness();
  harness.calls.listDatabaseUnavailable = true;
  const response = await fetch(`${harness.baseUrl}/api/v1/videos/mine`, {
    headers: { 'x-test-user': USER_ID },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Video data is temporarily unavailable because the database is unavailable.',
  });
});

test('thumbnail upload is owner-scoped and requires successful server-side validation', async () => {
  const harness = await createHarness();
  harness.video.isShort = true;
  const path = `/api/v1/videos/${VIDEO_ID}/thumbnail-upload-intent`;
  const body = { contentType: 'image/png', fileSize: 4096 };
  const denied = await post(harness.baseUrl, path, body, OTHER_USER_ID);
  assert.equal(denied.status, 404);

  const intent = await post(harness.baseUrl, path, body);
  assert.equal(intent.status, 201);
  assert.ok(harness.video.pendingThumbnailStorageKey);
  const expectedKey = harness.video.pendingThumbnailStorageKey;

  harness.calls.thumbnailFails = true;
  const invalid = await post(
    harness.baseUrl,
    `/api/v1/videos/${VIDEO_ID}/thumbnail-confirmation`,
    body,
  );
  assert.equal(invalid.status, 409);
  assert.equal(harness.video.thumbnailStorageKey, null);

  harness.calls.thumbnailFails = false;
  const confirmed = await post(
    harness.baseUrl,
    `/api/v1/videos/${VIDEO_ID}/thumbnail-confirmation`,
    body,
  );
  assert.equal(confirmed.status, 200);
  assert.equal(harness.video.thumbnailStorageKey, expectedKey);
  assert.equal(harness.video.pendingThumbnailStorageKey, null);
  assert.deepEqual(harness.calls.thumbnailIsShort, [true, true]);
});

test('publication requires declaration and is blocked by a verified copyright claim', async () => {
  const harness = await createHarness();
  harness.video.status = 'READY_FOR_REVIEW';
  harness.video.visibility = 'UNLISTED';
  const path = `/api/v1/videos/${VIDEO_ID}/publish`;

  const noDeclaration = await post(harness.baseUrl, path);
  assert.equal(noDeclaration.status, 409);
  assert.equal(harness.video.status, 'READY_FOR_REVIEW');

  harness.video.copyrightDeclared = true;
  harness.video.copyrightDeclaredAt = new Date();
  harness.video.copyrightDeclaredById = USER_ID;
  harness.calls.blockingClaim = true;
  const blocked = await post(harness.baseUrl, path);
  assert.equal(blocked.status, 409);
  assert.equal(harness.video.status, 'READY_FOR_REVIEW');

  harness.calls.blockingClaim = false;
  const published = await post(harness.baseUrl, path);
  assert.equal(published.status, 200);
  assert.equal(harness.video.status, 'PUBLISHED');
  assert.equal(harness.video.thumbnailUrl, 'https://media.example/video-thumb.webp');
  assert.equal(harness.video.copyrightReviewStatus, 'NOT_SCANNED');
  assert.equal(harness.calls.publicPromotions, 1);
});

test('publication is owner-authorized and failed uploads cannot be published', async () => {
  const harness = await createHarness();
  harness.video.status = 'READY_FOR_REVIEW';
  harness.video.copyrightDeclared = true;
  harness.video.copyrightDeclaredAt = new Date();
  harness.video.copyrightDeclaredById = USER_ID;
  const path = `/api/v1/videos/${VIDEO_ID}/publish`;

  const denied = await post(harness.baseUrl, path, undefined, OTHER_USER_ID);
  assert.equal(denied.status, 404);
  assert.equal(harness.calls.publicPromotions, 0);

  harness.video.status = 'FAILED';
  const failed = await post(harness.baseUrl, path);
  assert.equal(failed.status, 409);
  assert.equal(harness.video.status, 'FAILED');
  assert.equal(harness.calls.publicPromotions, 0);
});

test('non-monetized creators can publish without promoting private media', async () => {
  const harness = await createHarness();
  assert.equal(harness.video.channel.isMonetized, false);
  harness.video.status = 'READY_FOR_REVIEW';
  harness.video.copyrightDeclared = true;
  harness.video.copyrightDeclaredAt = new Date();
  harness.video.copyrightDeclaredById = USER_ID;
  const response = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/publish`);
  assert.equal(response.status, 200);
  assert.equal(harness.video.status, 'PUBLISHED');
  assert.equal(harness.calls.publicPromotions, 0);
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

test('verify-upload enforces Short file size limits and safely increments jobId on retry after FAILED', async () => {
  const harness = await createHarness();
  harness.video.isShort = true;
  harness.video.status = 'FAILED';
  harness.video.processingAttempts = 1;
  harness.video.uploadFileSize = BigInt(1024);

  // Oversized uploaded object on Short fails 400
  harness.calls.objectContentLength = 1024 * 1024 * 1024 + 1;
  const oversizedRes = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/verify-upload`);
  assert.equal(oversizedRes.status, 400);
  assert.equal(harness.calls.queueJobs.length, 0);

  // Matching size transitions FAILED -> UPLOADED -> PROCESSING and uses retry jobId
  harness.calls.objectContentLength = 1024;
  const retryRes = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/verify-upload`);
  assert.equal(retryRes.status, 202);
  assert.equal(harness.video.status, 'PROCESSING');
  assert.equal(harness.calls.queueJobs.length, 1);
  assert.equal(harness.calls.queueJobs[0].jobId, `${VIDEO_ID}-retry-2`);
});
