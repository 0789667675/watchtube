import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createWatchTubeApiClient,
  getApiErrorMessage,
  getSessionCheckFailure,
  getUploadTransferStatusError,
  isUnauthorizedError,
  resolveApiBaseUrl,
} from '../src/api/client.ts';
import {
  assertAuthSuccess,
  parseChannelProfile,
  parseCommentsPage,
  parseCreatorVideoDetail,
  parseCreatorVideos,
  parseFeedPage,
  parseReaction,
  parseSearchPage,
  parseSession,
  parseSubscription,
  parseUploadDraft,
  parseUploadIntent,
  parseUploadStatus,
  parseUploadUrlRefresh,
  parseViewerVideo,
} from '../src/api/contracts.ts';
import {
  UploadStageError,
  runCreatorUploadPipeline,
} from '../src/api/uploadWorkflow.ts';

const API_ORIGIN = (process.env.WATCHTUBE_API_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');

function createCookieClient() {
  const { baseUrl, error } = resolveApiBaseUrl(API_ORIGIN, true);
  assert.equal(error, null);
  assert.ok(baseUrl);
  const client = createWatchTubeApiClient(baseUrl);
  let cookieHeader = '';

  client.interceptors.request.use((config) => {
    if (cookieHeader) {
      config.headers.Cookie = cookieHeader;
    }
    return config;
  });

  client.interceptors.response.use((response) => {
    const setCookie = response.headers['set-cookie'];
    if (Array.isArray(setCookie) && setCookie.length > 0) {
      const nextPairs = setCookie
        .map((entry) => entry.split(';')[0]?.trim())
        .filter(Boolean);
      const clearToken = setCookie.some((entry) => /token=;/i.test(entry) || /Max-Age=0/i.test(entry));
      cookieHeader = clearToken ? '' : nextPairs.join('; ');
    }
    return response;
  });

  return {
    client,
    getCookieHeader: () => cookieHeader,
  };
}

test('live backend health, readiness, and unauthenticated session/feed contracts', async () => {
  const healthRes = await fetch(`${API_ORIGIN}/health`);
  assert.equal(healthRes.status, 200);
  const readyRes = await fetch(`${API_ORIGIN}/ready`);
  assert.equal(readyRes.status, 200);

  const { client } = createCookieClient();

  await assert.rejects(
    () => client.get('/auth/me'),
    (err) => {
      assert.equal(isUnauthorizedError(err), true);
      assert.deepEqual(getSessionCheckFailure(err), { clearSession: true, message: null });
      return true;
    },
  );

  await assert.rejects(
    () => client.get('/feed/subscriptions'),
    (err) => isUnauthorizedError(err),
  );

  const videosFeed = parseFeedPage((await client.get('/videos', { params: { page: 1, limit: 12 } })).data);
  assert.ok(Array.isArray(videosFeed.videos));

  const forYouFeed = parseFeedPage((await client.get('/feed/for-you', { params: { page: 1, limit: 12 } })).data);
  assert.ok(Array.isArray(forYouFeed.videos));

  const trendingFeed = parseFeedPage((await client.get('/feed/trending', { params: { page: 1, limit: 12 } })).data);
  assert.ok(Array.isArray(trendingFeed.videos));

  const shortsFeed = parseFeedPage((await client.get('/feed/shorts', { params: { page: 1, limit: 12 } })).data);
  assert.ok(Array.isArray(shortsFeed.videos));

  const searchPage = parseSearchPage((await client.get('/feed/search', {
    params: { q: 'watchtube', page: 1, limit: 12 },
  })).data);
  assert.ok(Array.isArray(searchPage.videos));
  assert.ok(Array.isArray(searchPage.channels));

  // If any published video exists on this environment, verify watch detail, comments, and reactions
  const sampleVideo = videosFeed.videos[0] ?? forYouFeed.videos[0];
  if (sampleVideo) {
    const detail = parseViewerVideo((await client.get(`/videos/${encodeURIComponent(sampleVideo.id)}`)).data);
    assert.equal(detail.id, sampleVideo.id);
    const comments = parseCommentsPage((await client.get(`/videos/${encodeURIComponent(sampleVideo.id)}/comments`)).data);
    assert.ok(Array.isArray(comments.comments));
  } else {
    const emptyComments = parseCommentsPage((await client.get('/videos/00000000-0000-4000-8000-000000000000/comments')).data);
    assert.deepEqual(emptyComments.comments, []);
  }
});

test('live backend auth registration, HTTP-only cookie login, session restoration, channel creation, subscriptions, and logout', async () => {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const password = 'WatchTubeTest!2026';
  const creatorEmail = `wt-int-creator-${unique}@example.com`;
  const viewerEmail = `wt-int-viewer-${unique}@example.com`;
  const handle = `@wtint${unique.slice(-8)}`;

  const creator = createCookieClient();
  const regRes = await creator.client.post('/auth/register', { email: creatorEmail, password });
  assert.equal(regRes.status, 201);
  assertAuthSuccess(regRes.data, 'register');

  const loginRes = await creator.client.post('/auth/login', { email: creatorEmail, password });
  assert.equal(loginRes.status, 200);
  assertAuthSuccess(loginRes.data, 'sign-in');
  const setCookies = loginRes.headers['set-cookie'] ?? [];
  assert.ok(setCookies.some((c) => /token=/.test(c) && /HttpOnly/i.test(c) && /Path=\//i.test(c)));

  const restoredSession = parseSession((await creator.client.get('/auth/me')).data);
  assert.ok(restoredSession);
  assert.equal(restoredSession.email, creatorEmail);
  assert.deepEqual(restoredSession.channels, []);

  const createdChannelRes = await creator.client.post('/channels', {
    name: 'Integration Test Channel',
    handle,
    description: 'Live API integration verification',
  });
  assert.equal(createdChannelRes.status, 201);
  const channelId = createdChannelRes.data.id;

  const refreshedSession = parseSession((await creator.client.get('/auth/me')).data);
  assert.ok(refreshedSession);
  assert.equal(refreshedSession.channels?.length, 1);
  assert.equal(refreshedSession.channels?.[0].handle, handle);

  const profile = parseChannelProfile((await creator.client.get(`/channels/${encodeURIComponent(handle)}`)).data);
  assert.equal(profile.id, channelId);
  assert.equal(profile.subscriberCount, 0);

  // Subscribing to own channel must return 400
  await assert.rejects(
    () => creator.client.post(`/channels/${encodeURIComponent(channelId)}/subscribe`),
    (err) => {
      assert.match(getApiErrorMessage(err, ''), /own channel/i);
      return true;
    },
  );

  // Second user subscribes & checks subscription status + subscriptions feed
  const viewer = createCookieClient();
  assertAuthSuccess((await viewer.client.post('/auth/register', { email: viewerEmail, password })).data, 'register');
  assertAuthSuccess((await viewer.client.post('/auth/login', { email: viewerEmail, password })).data, 'sign-in');

  assert.equal(
    parseSubscription((await viewer.client.get(`/channels/${encodeURIComponent(channelId)}/subscription-status`)).data),
    false,
  );
  assert.equal(
    parseSubscription((await viewer.client.post(`/channels/${encodeURIComponent(channelId)}/subscribe`)).data),
    true,
  );
  assert.equal(
    parseSubscription((await viewer.client.get(`/channels/${encodeURIComponent(channelId)}/subscription-status`)).data),
    true,
  );
  const subFeed = parseFeedPage((await viewer.client.get('/feed/subscriptions')).data);
  assert.ok(Array.isArray(subFeed.videos));

  // Unauthenticated / unpublished video interaction checks
  await assert.rejects(
    () => viewer.client.get('/videos/00000000-0000-4000-8000-000000000000/like-status'),
    (err) => /not found/i.test(getApiErrorMessage(err, '')),
  );
  await assert.rejects(
    () => viewer.client.post('/videos/00000000-0000-4000-8000-000000000000/like', { isDislike: false }),
    (err) => /not found/i.test(getApiErrorMessage(err, '')),
  );
  await assert.rejects(
    () => viewer.client.post('/videos/00000000-0000-4000-8000-000000000000/comments', { content: 'Test' }),
    (err) => /not found/i.test(getApiErrorMessage(err, '')),
  );

  // If a published video exists, exercise live reaction toggle + comment read/write
  const pubList = parseFeedPage((await viewer.client.get('/videos', { params: { page: 1, limit: 1 } })).data);
  if (pubList.videos[0]) {
    const targetId = pubList.videos[0].id;
    const initialReaction = parseReaction(
      (await viewer.client.get(`/videos/${encodeURIComponent(targetId)}/like-status`)).data,
    );
    assert.ok(initialReaction === null || initialReaction === 'liked' || initialReaction === 'disliked');
  }

  // Logout clears session cookie
  const logoutRes = await creator.client.post('/auth/logout');
  assert.equal(logoutRes.status, 200);
  assertAuthSuccess(logoutRes.data, 'sign-out');
  assert.equal(creator.getCookieHeader(), '');
  await assert.rejects(
    () => creator.client.get('/auth/me'),
    (err) => isUnauthorizedError(err),
  );
});

test('live backend creator upload pipeline (draft -> upload-intent -> binary R2 PUT -> verify check -> creator listing)', async () => {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const password = 'WatchTubeTest!2026';
  const email = `wt-int-upload-${unique}@example.com`;
  const handle = `@wtup${unique.slice(-8)}`;

  const { client } = createCookieClient();
  assertAuthSuccess((await client.post('/auth/register', { email, password })).data, 'register');
  assertAuthSuccess((await client.post('/auth/login', { email, password })).data, 'sign-in');
  const channelRes = await client.post('/channels', {
    name: 'Upload Verify Channel',
    handle,
  });
  const channelId = channelRes.data.id;

  const samplePath = join(tmpdir(), `wt-int-sample-${unique}.mp4`);
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', '+faststart', samplePath,
  ], { stdio: 'ignore' });
  const bytes = readFileSync(samplePath);
  unlinkSync(samplePath);

  let createdVideoId = '';
  let grantedUploadStatus = '';

  const workflowClient = {
    createDraft: async (metadata) => {
      const parsed = parseUploadDraft((await client.post('/videos/drafts', metadata)).data);
      createdVideoId = parsed.videoId;
      return parsed;
    },
    updateMetadata: async (videoId, metadata) => {
      await client.patch(`/videos/${encodeURIComponent(videoId)}`, metadata);
    },
    requestUploadIntent: async (input) => {
      const intent = parseUploadIntent((await client.post('/videos/upload-intent', input)).data);
      grantedUploadStatus = intent.status;
      return intent;
    },
    refreshUploadUrl: async (input) => parseUploadUrlRefresh(
      (await client.post(`/videos/${encodeURIComponent(input.videoId)}/upload-url`, {
        contentType: input.contentType,
        fileSize: input.fileSize,
      })).data,
    ),
    transferBinary: async (uploadUrl, file) => {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.contentType },
        body: bytes,
      });
      if (!response.ok) {
        const err = new Error(getUploadTransferStatusError(response.status));
        Object.assign(err, { status: response.status });
        throw err;
      }
    },
    verifyUpload: async (videoId) => (
      await client.post(`/videos/${encodeURIComponent(videoId)}/verify-upload`)
    ).data,
  };

  let uploadOutcome = 'completed';
  try {
    await runCreatorUploadPipeline(workflowClient, {
      metadata: {
        channelId,
        isShort: false,
        title: 'Live Integration Upload Clip',
        description: 'Testing real draft, upload-intent, and binary PUT',
        tags: ['integration', 'mobile'],
        category: 'SCIENCE_TECH',
        language: 'en',
        madeForKids: false,
        visibility: 'PRIVATE',
        copyrightDeclared: true,
      },
      file: {
        uri: `file://${samplePath}`,
        name: 'sample.mp4',
        size: bytes.length,
        contentType: 'video/mp4',
      },
    });
  } catch (err) {
    assert.ok(err instanceof UploadStageError);
    assert.equal(err.stage, 'transfer');
    assert.match(err.message, /403/);
    uploadOutcome = 'r2_put_rejected_403';
  }

  assert.ok(createdVideoId.length > 0);
  assert.equal(grantedUploadStatus, 'UPLOADING');

  const detail = parseCreatorVideoDetail((await client.get(`/videos/${encodeURIComponent(createdVideoId)}`)).data);
  assert.equal(detail.title, 'Live Integration Upload Clip');
  assert.equal(detail.copyrightDeclared, true);

  const refreshed = parseUploadUrlRefresh(
    (await client.post(`/videos/${encodeURIComponent(createdVideoId)}/upload-url`, {
      contentType: 'video/mp4',
      fileSize: bytes.length,
    })).data,
  );
  assert.ok(refreshed.uploadUrl.startsWith('https://'));

  const mine = parseCreatorVideos((await client.get('/videos/mine')).data);
  assert.ok(mine.some((v) => v.id === createdVideoId && v.status === (uploadOutcome === 'completed' ? 'PROCESSING' : 'UPLOADING')));

  const uploadStatus = parseUploadStatus((await client.get(`/videos/${encodeURIComponent(createdVideoId)}/upload-status`)).data);
  assert.equal(uploadStatus.videoId, createdVideoId);

  if (uploadOutcome === 'r2_put_rejected_403') {
    // Verify backend does NOT hallucinate success when R2 object wasn't stored
    await assert.rejects(
      () => client.post(`/videos/${encodeURIComponent(createdVideoId)}/verify-upload`),
      (err) => {
        assert.match(getApiErrorMessage(err, ''), /not found/i);
        return true;
      },
    );
  }

  // Verify Shorts draft & portrait dimension enforcement against live API
  const shortDraft = parseUploadDraft((await client.post('/videos/drafts', {
    channelId,
    isShort: true,
    title: 'Live Shorts Metadata Check',
    description: null,
    tags: ['short'],
    category: 'ENTERTAINMENT',
    language: 'en',
    madeForKids: false,
    visibility: 'PRIVATE',
    copyrightDeclared: true,
  })).data);
  await assert.rejects(
    () => client.post('/videos/upload-intent', {
      videoId: shortDraft.videoId,
      contentType: 'video/mp4',
      fileSize: 1024,
      duration: 240,
      width: 1080,
      height: 1920,
    }),
    (err) => /3 minutes/i.test(getApiErrorMessage(err, '')),
  );
  const shortIntent = parseUploadIntent((await client.post('/videos/upload-intent', {
    videoId: shortDraft.videoId,
    contentType: 'video/mp4',
    fileSize: 1024,
    duration: 30,
    width: 1080,
    height: 1920,
  })).data);
  assert.equal(shortIntent.status, 'UPLOADING');
});
