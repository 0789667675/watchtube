import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendUniqueComments,
  assertAuthSuccess,
  getPlayableVariants,
  parseChannelProfile,
  parseCommentsPage,
  parseCreatorVideoDetail,
  parseCreatorVideos,
  parseFeedPage,
  parsePublishResponse,
  parseReaction,
  parseSearchPage,
  parseSession,
  parseSubscription,
  parseUploadDraft,
  parseUploadIntent,
  parseUploadStatus,
  parseUploadUrlRefresh,
  parseVerifyUploadResponse,
  parseViewerVideo,
  selectPreferredPlaylistUrl,
} from '../src/api/contracts.ts';
import {
  apiClient,
  getApiErrorMessage,
  getSessionCheckFailure,
  getUploadTransferErrorMessage,
  getUploadTransferStatusError,
  resolveApiBaseUrl,
} from '../src/api/client.ts';
import {
  getVisibleReaction,
  reactionStateReducer,
} from '../src/api/reactionState.ts';
import {
  UploadStageError,
  inferVideoContentType,
  parseTagsInput,
  retryBinaryTransferAndVerify,
  runCreatorUploadPipeline,
  validateMetadataInput,
  validateSelectedVideoFile,
  validateShortVideoDimensions,
} from '../src/api/uploadWorkflow.ts';
import { shouldRefreshSessionOnForeground } from '../src/auth/sessionLifecycle.ts';
import { formatChannelHandle, formatFileSize } from '../src/utils/format.ts';

function requestError(status, data = {}, code) {
  const error = new Error('request failed');
  Object.assign(error, {
    isAxiosError: true,
    code,
    response: { status, data },
  });
  return error;
}

test('feed parser accepts the existing array and paginated response shapes', () => {
  assert.deepEqual(parseFeedPage([]), { videos: [], hasMore: false });
  assert.deepEqual(parseFeedPage({
    videos: [],
    pagination: { hasMore: true },
  }), { videos: [], hasMore: true });
  assert.deepEqual(parseFeedPage({
    videos: [],
    pagination: { hasMoreVideos: false },
  }), { videos: [], hasMore: false });
  assert.throws(() => parseFeedPage({ videos: null }), /invalid video list/);
});

test('search parser preserves independent video and channel pagination', () => {
  assert.deepEqual(parseSearchPage({
    videos: [],
    channels: [],
    pagination: { hasMoreVideos: true, hasMoreChannels: false },
  }), {
    videos: [],
    channels: [],
    hasMoreVideos: true,
    hasMoreChannels: false,
  });
  assert.throws(() => parseSearchPage({ videos: [], channels: [] }), /pagination/);
});

test('comments parse cursor pagination and append pages without duplicate cursor entries', () => {
  assert.deepEqual(parseCommentsPage({ comments: [], nextCursor: null }), {
    comments: [],
    nextCursor: undefined,
  });
  const cursorComment = { id: 'cursor', content: 'already loaded', createdAt: '2026-11-20T10:00:00.000Z' };
  const nextComment = { id: 'next', content: 'next page', createdAt: '2026-11-20T09:00:00.000Z' };
  assert.deepEqual(
    appendUniqueComments([cursorComment], [cursorComment, nextComment]),
    [cursorComment, nextComment],
  );
  assert.throws(() => parseCommentsPage({ comments: [], nextCursor: 123 }), /pagination/);
});

test('video, reaction, and subscription response parsers reject malformed payloads', () => {
  assert.throws(() => parseViewerVideo(null), /invalid video response/);
  assert.equal(parseReaction({ isLiked: true, isDisliked: false }), 'liked');
  assert.equal(parseReaction({ isLiked: false, isDisliked: true }), 'disliked');
  assert.equal(parseReaction({ isLiked: false, isDisliked: false }), null);
  assert.throws(() => parseReaction({ isLiked: true, isDisliked: true }), /invalid reaction/);
  assert.equal(parseSubscription({ isSubscribed: true }), true);
  assert.throws(() => parseSubscription({}), /invalid subscription/);
});

test('reaction state loads, updates from the API, and stays hidden across viewers', () => {
  const key = 'session:video:0';
  let state = reactionStateReducer(undefined, { type: 'load', key });
  assert.equal(state.status, 'loading');

  state = reactionStateReducer(state, {
    type: 'loaded',
    key,
    reaction: parseReaction({ isLiked: false, isDisliked: true }),
  });
  assert.equal(getVisibleReaction(state, key, true), 'disliked');

  state = reactionStateReducer(state, {
    type: 'updated',
    key,
    reaction: parseReaction({ isLiked: true, isDisliked: false }),
  });
  assert.equal(getVisibleReaction(state, key, true), 'liked');
  assert.equal(getVisibleReaction(state, key, false), null);
  assert.equal(reactionStateReducer(state, { type: 'updated', key: 'other-video', reaction: null }), state);
});

test('session response distinguishes no session from malformed data and validates auth acknowledgements', () => {
  assert.equal(apiClient.defaults.withCredentials, true);
  assert.equal(parseSession(null), null);
  assert.throws(() => parseSession({}), /invalid session response/);
  assert.doesNotThrow(() => assertAuthSuccess({ success: true }, 'sign-in'));
  assert.throws(() => assertAuthSuccess({ success: false }, 'sign-out'), /did not confirm/);
});

test('session checks clear expired or forbidden sessions but preserve sessions on transient failures', () => {
  assert.deepEqual(getSessionCheckFailure(requestError(401)), {
    clearSession: true,
    message: null,
  });
  assert.deepEqual(getSessionCheckFailure(requestError(403, { error: 'Account access is restricted' })), {
    clearSession: true,
    message: 'Account access is restricted',
  });
  const networkError = new Error('network unavailable');
  Object.assign(networkError, { isAxiosError: true, code: 'ERR_NETWORK' });
  assert.deepEqual(getSessionCheckFailure(networkError), {
    clearSession: false,
    message: 'The WatchTube API could not be reached. Check the network and API address, then retry.',
  });
});

test('session revalidation runs only when the app returns from a non-active state', () => {
  assert.equal(shouldRefreshSessionOnForeground('background', 'active'), true);
  assert.equal(shouldRefreshSessionOnForeground('inactive', 'active'), true);
  assert.equal(shouldRefreshSessionOnForeground('active', 'active'), false);
  assert.equal(shouldRefreshSessionOnForeground(null, 'active'), false);
  assert.equal(shouldRefreshSessionOnForeground(undefined, 'active'), false);
  assert.equal(shouldRefreshSessionOnForeground('background', 'inactive'), false);
});

test('API errors retain server messages and explain common status and network failures', () => {
  assert.equal(getApiErrorMessage(requestError(403, { error: 'Restricted' }), 'fallback'), 'Restricted');
  assert.equal(getApiErrorMessage(requestError(401), 'fallback'), 'Sign in to continue.');
  assert.equal(getApiErrorMessage(requestError(404), 'fallback'), 'This content is no longer available.');
  assert.equal(getApiErrorMessage(requestError(429), 'fallback'), 'Too many requests. Wait a moment and try again.');
  assert.equal(getApiErrorMessage(requestError(503), 'fallback'), 'WatchTube is temporarily unavailable. Please try again.');
  const networkError = new Error('network unavailable');
  Object.assign(networkError, { isAxiosError: true, code: 'ERR_NETWORK' });
  assert.match(getApiErrorMessage(networkError, 'fallback'), /could not be reached/);
  const timeoutError = new Error('timed out');
  Object.assign(timeoutError, { isAxiosError: true, code: 'ETIMEDOUT' });
  assert.match(getApiErrorMessage(timeoutError, 'fallback'), /could not be reached/);
});

test('channel profile parser extracts channel details and normalizes public videos with channel metadata', () => {
  const rawChannel = {
    id: 'ch-1',
    name: 'Maya Tech',
    handle: '@mayatech',
    description: 'Tech tutorials and reviews',
    avatarUrl: 'https://cdn.watchtube.com/avatar.jpg',
    bannerUrl: null,
    subscriberCount: 1500,
    isVerified: true,
    videos: [
      {
        id: 'vid-1',
        title: 'React Native in 2026',
        description: 'Building mobile apps',
        thumbnailUrl: 'https://cdn.watchtube.com/thumb.jpg',
        duration: 320,
        viewsCount: 4200,
        createdAt: '2026-11-20T10:00:00.000Z',
        publishedAt: '2026-11-20T11:00:00.000Z',
      },
    ],
  };

  const parsed = parseChannelProfile(rawChannel);
  assert.equal(parsed.id, 'ch-1');
  assert.equal(parsed.name, 'Maya Tech');
  assert.equal(parsed.handle, '@mayatech');
  assert.equal(parsed.subscriberCount, 1500);
  assert.equal(parsed.isVerified, true);
  assert.equal(parsed.videos.length, 1);
  assert.equal(parsed.videos[0].channel.name, 'Maya Tech');
  assert.equal(parsed.videos[0].channel.handle, '@mayatech');
  assert.equal(parsed.videos[0].channel.isVerified, true);
  assert.equal(parsed.videos[0].channelId, 'ch-1');

  assert.throws(() => parseChannelProfile(null), /invalid channel profile/);
  assert.throws(() => parseChannelProfile({ id: 'ch-1' }), /invalid channel profile/);
});

test('creator videos parser correctly structures studio uploads and validates statuses', () => {
  const rawList = [
    {
      id: 'vid-1',
      channelId: 'ch-1',
      isShort: false,
      title: 'Studio Overview',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      thumbnailUrl: 'https://cdn.watchtube.com/thumb.jpg',
      description: 'Intro to studio',
      tags: ['overview', 'studio'],
      category: 'ENTERTAINMENT',
      language: 'en',
      madeForKids: false,
      copyrightDeclared: true,
      copyrightReviewStatus: 'NOT_SCANNED',
      viewsCount: 50,
      createdAt: '2026-11-21T10:00:00.000Z',
    },
    {
      id: 'vid-2',
      channelId: 'ch-1',
      isShort: true,
      title: 'Quick Short',
      status: 'PROCESSING',
      visibility: 'PUBLIC',
      thumbnailUrl: null,
      description: null,
      tags: [],
      category: 'OTHER',
      language: 'en',
      madeForKids: false,
      copyrightDeclared: true,
      copyrightReviewStatus: 'NOT_SCANNED',
      viewsCount: 0,
      createdAt: '2026-11-22T08:00:00.000Z',
    },
  ];

  const parsed = parseCreatorVideos(rawList);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].status, 'PUBLISHED');
  assert.equal(parsed[0].isShort, false);
  assert.equal(parsed[1].status, 'PROCESSING');
  assert.equal(parsed[1].isShort, true);

  assert.throws(() => parseCreatorVideos('not an array'), /invalid creator video list/);
  assert.throws(() => parseCreatorVideos([{ id: 'missing title' }]), /invalid creator video summary/);
});

test('upload workflow parsers validate draft creation and upload intent responses', () => {
  const draft = parseUploadDraft({ videoId: 'v-123', status: 'DRAFT' });
  assert.deepEqual(draft, { videoId: 'v-123', status: 'DRAFT' });
  assert.throws(() => parseUploadDraft({ videoId: 123 }), /invalid draft response/);

  const intent = parseUploadIntent({
    videoId: 'v-123',
    uploadUrl: 'https://upload.watchtube.com/target',
    expiresIn: 900,
    status: 'UPLOADING',
  });
  assert.deepEqual(intent, {
    videoId: 'v-123',
    uploadUrl: 'https://upload.watchtube.com/target',
    expiresIn: 900,
    status: 'UPLOADING',
  });
  assert.throws(() => parseUploadIntent({ videoId: 'v-123' }), /invalid upload intent response/);
});

test('session parser includes user channels and administrative positions when present', () => {
  const sessionData = {
    id: 'user-1',
    email: 'creator@watchtube.com',
    role: 'ADMIN',
    status: 'GOOD_STANDING',
    channels: [
      {
        id: 'ch-1',
        name: 'Creator Hub',
        handle: '@creatorhub',
        description: 'Official channel',
        avatarUrl: null,
        bannerUrl: null,
      },
    ],
    positionNumber: 1,
    assignment: 'Creator Partner Management',
    permissions: ['creators.manage', 'support.respond'],
  };

  const parsed = parseSession(sessionData);
  assert.ok(parsed);
  assert.equal(parsed.id, 'user-1');
  assert.equal(parsed.email, 'creator@watchtube.com');
  assert.equal(parsed.role, 'ADMIN');
  assert.equal(parsed.channels?.length, 1);
  assert.equal(parsed.channels?.[0].name, 'Creator Hub');
  assert.equal(parsed.positionNumber, 1);
  assert.deepEqual(parsed.permissions, ['creators.manage', 'support.respond']);

  assert.doesNotThrow(() => assertAuthSuccess({ id: 'user-new' }, 'register'));
  assert.throws(() => assertAuthSuccess({}, 'register'), /did not confirm register/);
});

test('API base URL resolver enforces HTTPS in production while allowing HTTP in development', () => {
  assert.deepEqual(resolveApiBaseUrl('https://api.watchtube.rw/', false), {
    baseUrl: 'https://api.watchtube.rw/api/v1',
    error: null,
  });
  assert.deepEqual(resolveApiBaseUrl('http://10.0.2.2:3001', true), {
    baseUrl: 'http://10.0.2.2:3001/api/v1',
    error: null,
  });
  assert.match(resolveApiBaseUrl('http://10.0.2.2:3001', false).error ?? '', /HTTPS/);
  assert.match(resolveApiBaseUrl('https://api.watchtube.rw/api/v1', true).error ?? '', /without credentials, path/);
  assert.match(resolveApiBaseUrl('not-a-url', true).error ?? '', /absolute HTTP/);
});

test('channel handle and file size formatters avoid double @ prefixes and format units', () => {
  assert.equal(formatChannelHandle('@mayatech'), '@mayatech');
  assert.equal(formatChannelHandle('mayatech'), '@mayatech');
  assert.equal(formatChannelHandle('  '), '');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB');
});

test('playable variant helper filters unexpanded storage keys and orders preferred HLS resolutions', () => {
  const variants = [
    { resolution: '360p', playlistUrl: 'https://cdn.watchtube.com/media/1/360p.m3u8' },
    { resolution: 'raw', playlistUrl: 'processing/1/720p.m3u8' },
    { resolution: '720p', playlistUrl: 'https://cdn.watchtube.com/media/1/720p.m3u8' },
    { resolution: '1080p', playlistUrl: 'https://cdn.watchtube.com/media/1/1080p.m3u8' },
  ];
  const playable = getPlayableVariants(variants);
  assert.deepEqual(playable.map((v) => v.resolution), ['720p', '360p', '1080p']);
  assert.equal(selectPreferredPlaylistUrl(variants), 'https://cdn.watchtube.com/media/1/720p.m3u8');
  assert.equal(selectPreferredPlaylistUrl([{ resolution: '360p', playlistUrl: 'processing/1/360p.m3u8' }]), null);
});

test('upload detail, status, refresh, verify, and publish parsers validate backend contracts', () => {
  const detail = parseCreatorVideoDetail({
    videoId: 'v-1',
    isShort: true,
    channelId: 'ch-1',
    title: 'Portrait Clip',
    description: null,
    tags: ['short', 'clip'],
    category: 'SCIENCE_TECH',
    language: 'en',
    madeForKids: false,
    visibility: 'PUBLIC',
    copyrightDeclared: true,
    copyrightReviewStatus: 'NOT_SCANNED',
    status: 'READY_FOR_REVIEW',
    thumbnailUrl: 'https://cdn.watchtube.com/poster.jpg',
  });
  assert.equal(detail.isShort, true);
  assert.equal(detail.status, 'READY_FOR_REVIEW');
  assert.equal(detail.category, 'SCIENCE_TECH');

  assert.deepEqual(parseUploadUrlRefresh({ uploadUrl: 'https://r2.example/put', expiresIn: 900 }), {
    uploadUrl: 'https://r2.example/put',
    expiresIn: 900,
  });
  assert.deepEqual(parseVerifyUploadResponse({ videoId: 'v-1', status: 'PROCESSING' }), {
    videoId: 'v-1',
    status: 'PROCESSING',
  });
  assert.deepEqual(parseUploadStatus({
    videoId: 'v-1',
    status: 'READY_FOR_REVIEW',
    thumbnailUrl: null,
    copyrightReviewStatus: 'NOT_SCANNED',
  }), {
    videoId: 'v-1',
    status: 'READY_FOR_REVIEW',
    thumbnailUrl: null,
    copyrightReviewStatus: 'NOT_SCANNED',
  });
  assert.deepEqual(parsePublishResponse({
    videoId: 'v-1',
    status: 'PUBLISHED',
    copyrightReviewStatus: 'NOT_SCANNED',
  }), {
    videoId: 'v-1',
    status: 'PUBLISHED',
    copyrightReviewStatus: 'NOT_SCANNED',
  });
});

test('upload validators enforce content types, sizes, tags, copyright declaration, and Shorts portrait bounds', () => {
  assert.equal(inferVideoContentType('clip.MOV', ''), 'video/quicktime');
  assert.equal(inferVideoContentType('clip.mp4', 'video/mp4; codecs=avc1'), 'video/mp4');
  assert.deepEqual(parseTagsInput('one, two\none, three '), ['one', 'two', 'three']);

  assert.match(
    validateSelectedVideoFile({ name: 'clip.avi', size: 1024, contentType: 'video/x-msvideo' }, false) ?? '',
    /MP4, WebM, or QuickTime/,
  );
  assert.match(
    validateSelectedVideoFile({ name: 'empty.mp4', size: 0, contentType: 'video/mp4' }, false) ?? '',
    /empty/,
  );
  assert.equal(
    validateSelectedVideoFile({ name: 'ok.mp4', size: 1024, contentType: 'video/mp4' }, false),
    null,
  );

  assert.match(validateShortVideoDimensions(200, 1080, 1920) ?? '', /180 seconds/);
  assert.match(validateShortVideoDimensions(30, 1920, 1080) ?? '', /9:16/);
  assert.equal(validateShortVideoDimensions(30, 1080, 1920), null);

  assert.match(
    validateMetadataInput({
      channelId: 'ch-1',
      isShort: false,
      title: 'Test',
      description: null,
      tags: [],
      category: 'OTHER',
      language: 'en',
      madeForKids: false,
      visibility: 'PUBLIC',
      copyrightDeclared: false,
    }) ?? '',
    /copyright/,
  );
});

test('upload pipeline transfers actual binary before verifying and halts without verifying when R2 rejects transfer', async () => {
  const calls = [];
  const file = { uri: 'file:///clip.mp4', name: 'clip.mp4', size: 5464, contentType: 'video/mp4' };
  const metadata = {
    channelId: 'ch-1',
    isShort: false,
    title: 'Real Binary Test',
    description: 'Testing pipeline',
    tags: ['test'],
    category: 'SCIENCE_TECH',
    language: 'en',
    madeForKids: false,
    visibility: 'PUBLIC',
    copyrightDeclared: true,
  };

  // Failure at binary transfer stage (e.g., R2 403 AccessDenied) must NOT call verifyUpload
  await assert.rejects(
    () => runCreatorUploadPipeline({
      createDraft: async () => {
        calls.push('createDraft');
        return { videoId: 'vid-1', status: 'DRAFT' };
      },
      updateMetadata: async () => { calls.push('updateMetadata'); },
      requestUploadIntent: async () => {
        calls.push('requestUploadIntent');
        return { videoId: 'vid-1', uploadUrl: 'https://r2.example/put', expiresIn: 900, status: 'UPLOADING' };
      },
      refreshUploadUrl: async () => ({ uploadUrl: 'https://r2.example/put2', expiresIn: 900 }),
      transferBinary: async () => {
        calls.push('transferBinary');
        const err = new Error('Forbidden');
        Object.assign(err, { status: 403 });
        throw err;
      },
      verifyUpload: async () => {
        calls.push('verifyUpload');
        return { videoId: 'vid-1', status: 'PROCESSING' };
      },
    }, { metadata, file }),
    (error) => error instanceof UploadStageError && error.stage === 'transfer' && /403/.test(error.message),
  );
  assert.deepEqual(calls, ['createDraft', 'requestUploadIntent', 'transferBinary']);

  // Retry refreshes URL, transfers binary, and verifies ONLY after binary succeeds
  calls.length = 0;
  const retryRes = await retryBinaryTransferAndVerify({
    refreshUploadUrl: async () => {
      calls.push('refreshUploadUrl');
      return { uploadUrl: 'https://r2.example/put-fresh', expiresIn: 900 };
    },
    transferBinary: async (_url, _file, onProgress) => {
      calls.push('transferBinary');
      onProgress(50);
      onProgress(100);
    },
    verifyUpload: async () => {
      calls.push('verifyUpload');
      return { videoId: 'vid-1', status: 'PROCESSING' };
    },
  }, 'vid-1', file);
  assert.deepEqual(calls, ['refreshUploadUrl', 'transferBinary', 'verifyUpload']);
  assert.deepEqual(retryRes, { videoId: 'vid-1', status: 'PROCESSING' });
  assert.match(getUploadTransferStatusError(403), /403/);
  const netErr = Object.assign(new Error('net'), { code: 'ERR_NETWORK' });
  assert.match(getUploadTransferErrorMessage(netErr) ?? '', /CORS/);
});
