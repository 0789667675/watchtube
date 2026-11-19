"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const cors_1 = require("../src/middleware/cors");
const video_upload_route_1 = require("../src/routes/video-upload.route");
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
let activeServers = [];
async function createHarness() {
    const video = {
        id: VIDEO_ID,
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
    const calls = {
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
        blockingClaim: false,
        metadataUpdates: 0,
        thumbnailFails: false,
        publishedAssetsDeleted: 0,
        publicPromotions: 0,
    };
    const authenticate = (req, res, next) => {
        const userId = req.get('x-test-user');
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        req.user = { id: userId, role: 'USER' };
        next();
    };
    const dependencies = {
        authenticate,
        repository: {
            ownsChannel: async (_channelId, userId) => calls.ownsChannel && userId === USER_ID,
            createDraft: async (data) => {
                calls.created += 1;
                Object.assign(video, data, { status: 'DRAFT', rawStorageKey: null });
                return { id: VIDEO_ID };
            },
            updateMetadata: async ({ userId, metadata }) => {
                if (userId !== USER_ID)
                    return false;
                calls.metadataUpdates += 1;
                const wasDeclared = video.copyrightDeclared;
                Object.assign(video, metadata, { copyrightDeclared: wasDeclared || metadata.copyrightDeclared });
                if (metadata.copyrightDeclared && !video.copyrightDeclaredAt) {
                    video.copyrightDeclaredAt = new Date();
                    video.copyrightDeclaredById = userId;
                }
                return true;
            },
            setUploadTarget: async ({ userId, rawStorageKey, contentType, fileSize }) => {
                if (userId !== USER_ID || video.status !== 'DRAFT')
                    return false;
                Object.assign(video, {
                    rawStorageKey,
                    uploadContentType: contentType,
                    uploadFileSize: BigInt(fileSize),
                    status: 'UPLOADING',
                });
                return true;
            },
            setPendingThumbnailUpload: async ({ userId, key, contentType, fileSize }) => {
                if (userId !== USER_ID)
                    return false;
                Object.assign(video, {
                    pendingThumbnailStorageKey: key,
                    pendingThumbnailContentType: contentType,
                    pendingThumbnailFileSize: BigInt(fileSize),
                });
                return true;
            },
            confirmThumbnailUpload: async (id, userId, storageKey) => {
                if (id !== VIDEO_ID || userId !== USER_ID || video.pendingThumbnailStorageKey !== storageKey)
                    return false;
                video.thumbnailStorageKey = storageKey;
                video.pendingThumbnailStorageKey = null;
                return true;
            },
            findVideo: async (id) => id === VIDEO_ID ? video : null,
            hasBlockingCopyrightClaim: async () => calls.blockingClaim,
            markUploaded: async () => {
                if (!['UPLOADING', 'FAILED'].includes(video.status))
                    return false;
                video.status = 'UPLOADED';
                return true;
            },
            markProcessing: async () => {
                if (video.status !== 'UPLOADED')
                    return null;
                video.status = 'PROCESSING';
                video.processingAttempts += 1;
                return video.processingAttempts;
            },
            publishVideo: async ({ thumbnailUrl }) => {
                if (calls.blockingClaim)
                    return false;
                video.status = 'PUBLISHED';
                video.thumbnailUrl = thumbnailUrl ?? video.thumbnailUrl;
                return true;
            },
            listVideos: async () => {
                if (calls.listDatabaseUnavailable) {
                    throw Object.assign(new Error('private connection details'), { code: 'P1001' });
                }
                if (calls.listFails)
                    throw new Error('database connection details');
                return [];
            },
        },
        storage: {
            createUploadUrl: async (userId, contentType, fileSize, key) => {
                if (calls.storageFails)
                    throw new Error('storage credentials must not be returned');
                calls.uploadUrls.push({ userId, contentType, fileSize, key });
                return { uploadUrl: 'https://upload.example/presigned', fileKey: key || RAW_KEY };
            },
            inspectObject: async () => {
                calls.inspection += 1;
                if (calls.objectMissing)
                    return null;
                return { contentLength: calls.objectContentLength, contentType: calls.objectContentType };
            },
            createThumbnailUploadTarget: async (_id, _contentType, _fileSize) => {
                if (calls.storageFails)
                    throw new Error('test storage failure');
                return {
                    uploadUrl: 'https://upload.example/thumbnail',
                    storageKey: `processing/${VIDEO_ID}/custom-thumbnail-66666666-6666-4666-8666-666666666666.webp`,
                    expiresIn: 900,
                };
            },
            normalizeThumbnail: async () => !calls.thumbnailFails,
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
                calls.queueJobs.push({ jobId: options.jobId, data });
                if (calls.queueFails)
                    throw new Error('test queue failure');
            },
        },
        isQueueReady: () => calls.queueReady,
    };
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', (0, video_upload_route_1.createVideoUploadRouter)(dependencies));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return { baseUrl: `http://127.0.0.1:${address.port}`, server, video, calls };
}
async function post(baseUrl, path, body, userId = USER_ID) {
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            ...(userId ? { 'x-test-user': userId } : {}),
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}
async function patch(baseUrl, path, body, userId = USER_ID) {
    return fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: {
            ...(userId ? { 'x-test-user': userId } : {}),
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}
(0, node_test_1.beforeEach)(() => {
    activeServers = [];
});
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
});
(0, node_test_1.test)('draft creation requires authentication and validates video metadata', async () => {
    const harness = await createHarness();
    const path = '/api/v1/videos/drafts';
    const unauthorized = await post(harness.baseUrl, path, {
        ...VALID_METADATA, channelId: CHANNEL_ID,
    }, '');
    strict_1.default.equal(unauthorized.status, 401);
    const malformed = await post(harness.baseUrl, path, {
        ...VALID_METADATA, tags: Array.from({ length: 21 }, (_value, index) => `tag-${index}`), channelId: CHANNEL_ID,
    });
    strict_1.default.equal(malformed.status, 400);
    strict_1.default.equal(harness.calls.created, 0);
});
(0, node_test_1.test)('draft creation rejects channels not owned by the authenticated user', async () => {
    const harness = await createHarness();
    harness.calls.ownsChannel = false;
    const response = await post(harness.baseUrl, '/api/v1/videos/drafts', {
        ...VALID_METADATA, channelId: CHANNEL_ID,
    });
    strict_1.default.equal(response.status, 404);
    strict_1.default.equal(harness.calls.uploadUrls.length, 0);
});
(0, node_test_1.test)('draft metadata persists tags and an authenticated copyright declaration', async () => {
    const harness = await createHarness();
    const response = await post(harness.baseUrl, '/api/v1/videos/drafts', {
        ...VALID_METADATA,
        title: '  My creator video  ',
        tags: ['tag one', 'tag one', 'tag two'],
        copyrightDeclared: true,
        channelId: CHANNEL_ID,
    });
    strict_1.default.equal(response.status, 201);
    strict_1.default.equal(harness.video.title, 'My creator video');
    strict_1.default.deepEqual(harness.video.tags, ['tag one', 'tag two']);
    strict_1.default.equal(harness.video.copyrightDeclared, true);
    strict_1.default.equal(harness.video.copyrightDeclaredById, USER_ID);
    strict_1.default.ok(harness.video.copyrightDeclaredAt instanceof Date);
});
(0, node_test_1.test)('metadata edits persist and reload only for the owning creator', async () => {
    const harness = await createHarness();
    const path = `/api/v1/videos/${VIDEO_ID}`;
    const denied = await patch(harness.baseUrl, path, {
        ...VALID_METADATA,
        title: 'Unauthorized edit',
    }, OTHER_USER_ID);
    strict_1.default.equal(denied.status, 404);
    strict_1.default.equal(harness.video.title, 'Test video');
    const saved = await patch(harness.baseUrl, path, {
        ...VALID_METADATA,
        title: 'Updated creator title',
        description: 'Updated description',
        tags: ['tag one', 'tag two'],
        copyrightDeclared: true,
    });
    strict_1.default.equal(saved.status, 200);
    strict_1.default.equal(harness.video.copyrightDeclaredById, USER_ID);
    strict_1.default.ok(harness.video.copyrightDeclaredAt instanceof Date);
    const reloaded = await fetch(`${harness.baseUrl}${path}`, {
        headers: { 'x-test-user': USER_ID },
    });
    strict_1.default.equal(reloaded.status, 200);
    const metadata = await reloaded.json();
    strict_1.default.equal(metadata.title, 'Updated creator title');
    strict_1.default.equal(metadata.description, 'Updated description');
    strict_1.default.deepEqual(metadata.tags, ['tag one', 'tag two']);
    strict_1.default.equal(harness.calls.metadataUpdates, 1);
});
(0, node_test_1.test)('upload intent reports unavailable storage without creating another video', async () => {
    const harness = await createHarness();
    harness.video.status = 'DRAFT';
    harness.video.rawStorageKey = null;
    harness.calls.storageFails = true;
    const response = await post(harness.baseUrl, '/api/v1/videos/upload-intent', {
        videoId: VIDEO_ID, contentType: 'video/mp4', fileSize: 1024,
    });
    strict_1.default.equal(response.status, 503);
    strict_1.default.equal(harness.calls.created, 0);
    strict_1.default.doesNotMatch(JSON.stringify(await response.json()), /credentials/);
});
(0, node_test_1.test)('a repeated upload intent cannot create another video or replace an active upload', async () => {
    const harness = await createHarness();
    harness.video.status = 'DRAFT';
    harness.video.rawStorageKey = null;
    const body = { videoId: VIDEO_ID, contentType: 'video/mp4', fileSize: 1024 };
    const first = await post(harness.baseUrl, '/api/v1/videos/upload-intent', body);
    const duplicate = await post(harness.baseUrl, '/api/v1/videos/upload-intent', body);
    strict_1.default.equal(first.status, 201);
    strict_1.default.equal(duplicate.status, 409);
    strict_1.default.equal(harness.calls.uploadUrls.length, 1);
});
(0, node_test_1.test)('upload URL renewal is owner-scoped and reuses the original object key', async () => {
    const harness = await createHarness();
    const path = `/api/v1/videos/${VIDEO_ID}/upload-url`;
    const denied = await post(harness.baseUrl, path, { contentType: 'video/mp4', fileSize: 1024 }, OTHER_USER_ID);
    strict_1.default.equal(denied.status, 404);
    const renewed = await post(harness.baseUrl, path, { contentType: 'video/mp4', fileSize: 1024 });
    strict_1.default.equal(renewed.status, 200);
    strict_1.default.equal(harness.calls.uploadUrls.length, 1);
    strict_1.default.equal(harness.calls.uploadUrls[0].key, RAW_KEY);
});
(0, node_test_1.test)('verification does not queue a missing object and uses a stable job ID on retry', async () => {
    const harness = await createHarness();
    harness.calls.objectMissing = true;
    const path = `/api/v1/videos/${VIDEO_ID}/verify-upload`;
    const missing = await post(harness.baseUrl, path);
    strict_1.default.equal(missing.status, 409);
    strict_1.default.equal(harness.calls.queueJobs.length, 0);
    harness.calls.objectMissing = false;
    harness.calls.queueFails = true;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    let queueFailure;
    try {
        queueFailure = await post(harness.baseUrl, path);
    }
    finally {
        console.error = originalConsoleError;
    }
    strict_1.default.equal(queueFailure.status, 503);
    strict_1.default.equal(harness.video.status, 'PROCESSING');
    harness.calls.queueFails = false;
    const retried = await post(harness.baseUrl, path);
    strict_1.default.equal(retried.status, 202);
    strict_1.default.equal(harness.calls.inspection, 2);
    strict_1.default.deepEqual(harness.calls.queueJobs.map((job) => job.jobId), [VIDEO_ID, VIDEO_ID]);
});
(0, node_test_1.test)('verification does not mark a video processing while Redis is unavailable', async () => {
    const harness = await createHarness();
    harness.calls.queueReady = false;
    const response = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/verify-upload`);
    strict_1.default.equal(response.status, 503);
    strict_1.default.equal(harness.video.status, 'UPLOADED');
    strict_1.default.equal(harness.calls.queueJobs.length, 0);
});
(0, node_test_1.test)('a failed processing attempt can be retried with a distinct stable job ID', async () => {
    const harness = await createHarness();
    harness.video.status = 'FAILED';
    harness.video.processingAttempts = 1;
    const response = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/verify-upload`);
    strict_1.default.equal(response.status, 202);
    strict_1.default.equal(harness.video.status, 'PROCESSING');
    strict_1.default.equal(harness.calls.queueJobs[0].jobId, `${VIDEO_ID}-retry-2`);
});
(0, node_test_1.test)('verification rejects oversized or disallowed uploaded object metadata', async () => {
    const harness = await createHarness();
    const path = `/api/v1/videos/${VIDEO_ID}/verify-upload`;
    harness.calls.objectContentLength = 2 * 1024 * 1024 * 1024 + 1;
    const oversized = await post(harness.baseUrl, path);
    strict_1.default.equal(oversized.status, 400);
    harness.calls.objectContentLength = 1024;
    harness.calls.objectContentType = 'application/octet-stream';
    const wrongType = await post(harness.baseUrl, path);
    strict_1.default.equal(wrongType.status, 400);
    strict_1.default.equal(harness.calls.queueJobs.length, 0);
});
(0, node_test_1.test)('video listing returns a sanitized server error when the repository fails', async () => {
    const harness = await createHarness();
    harness.calls.listFails = true;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    let response;
    try {
        response = await fetch(`${harness.baseUrl}/api/v1/videos/mine`, {
            headers: { 'x-test-user': USER_ID },
        });
    }
    finally {
        console.error = originalConsoleError;
    }
    strict_1.default.equal(response.status, 500);
    strict_1.default.deepEqual(await response.json(), { error: 'Internal server error' });
});
(0, node_test_1.test)('video listing reports database connectivity failures as 503 without leaking details', async () => {
    const harness = await createHarness();
    harness.calls.listDatabaseUnavailable = true;
    const response = await fetch(`${harness.baseUrl}/api/v1/videos/mine`, {
        headers: { 'x-test-user': USER_ID },
    });
    strict_1.default.equal(response.status, 503);
    strict_1.default.deepEqual(await response.json(), {
        error: 'Video data is temporarily unavailable because the database is unavailable.',
    });
});
(0, node_test_1.test)('thumbnail upload is owner-scoped and requires successful server-side validation', async () => {
    const harness = await createHarness();
    const path = `/api/v1/videos/${VIDEO_ID}/thumbnail-upload-intent`;
    const body = { contentType: 'image/png', fileSize: 4096 };
    const denied = await post(harness.baseUrl, path, body, OTHER_USER_ID);
    strict_1.default.equal(denied.status, 404);
    const intent = await post(harness.baseUrl, path, body);
    strict_1.default.equal(intent.status, 201);
    strict_1.default.ok(harness.video.pendingThumbnailStorageKey);
    const expectedKey = harness.video.pendingThumbnailStorageKey;
    harness.calls.thumbnailFails = true;
    const invalid = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/thumbnail-confirmation`, body);
    strict_1.default.equal(invalid.status, 409);
    strict_1.default.equal(harness.video.thumbnailStorageKey, null);
    harness.calls.thumbnailFails = false;
    const confirmed = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/thumbnail-confirmation`, body);
    strict_1.default.equal(confirmed.status, 200);
    strict_1.default.equal(harness.video.thumbnailStorageKey, expectedKey);
    strict_1.default.equal(harness.video.pendingThumbnailStorageKey, null);
});
(0, node_test_1.test)('publication requires declaration and is blocked by a verified copyright claim', async () => {
    const harness = await createHarness();
    harness.video.status = 'READY_FOR_REVIEW';
    harness.video.visibility = 'UNLISTED';
    const path = `/api/v1/videos/${VIDEO_ID}/publish`;
    const noDeclaration = await post(harness.baseUrl, path);
    strict_1.default.equal(noDeclaration.status, 409);
    strict_1.default.equal(harness.video.status, 'READY_FOR_REVIEW');
    harness.video.copyrightDeclared = true;
    harness.video.copyrightDeclaredAt = new Date();
    harness.video.copyrightDeclaredById = USER_ID;
    harness.calls.blockingClaim = true;
    const blocked = await post(harness.baseUrl, path);
    strict_1.default.equal(blocked.status, 409);
    strict_1.default.equal(harness.video.status, 'READY_FOR_REVIEW');
    harness.calls.blockingClaim = false;
    const published = await post(harness.baseUrl, path);
    strict_1.default.equal(published.status, 200);
    strict_1.default.equal(harness.video.status, 'PUBLISHED');
    strict_1.default.equal(harness.video.thumbnailUrl, 'https://media.example/video-thumb.webp');
    strict_1.default.equal(harness.video.copyrightReviewStatus, 'NOT_SCANNED');
    strict_1.default.equal(harness.calls.publicPromotions, 1);
});
(0, node_test_1.test)('publication is owner-authorized and failed uploads cannot be published', async () => {
    const harness = await createHarness();
    harness.video.status = 'READY_FOR_REVIEW';
    harness.video.copyrightDeclared = true;
    harness.video.copyrightDeclaredAt = new Date();
    harness.video.copyrightDeclaredById = USER_ID;
    const path = `/api/v1/videos/${VIDEO_ID}/publish`;
    const denied = await post(harness.baseUrl, path, undefined, OTHER_USER_ID);
    strict_1.default.equal(denied.status, 404);
    strict_1.default.equal(harness.calls.publicPromotions, 0);
    harness.video.status = 'FAILED';
    const failed = await post(harness.baseUrl, path);
    strict_1.default.equal(failed.status, 409);
    strict_1.default.equal(harness.video.status, 'FAILED');
    strict_1.default.equal(harness.calls.publicPromotions, 0);
});
(0, node_test_1.test)('non-monetized creators can publish without promoting private media', async () => {
    const harness = await createHarness();
    strict_1.default.equal(harness.video.channel.isMonetized, false);
    harness.video.status = 'READY_FOR_REVIEW';
    harness.video.copyrightDeclared = true;
    harness.video.copyrightDeclaredAt = new Date();
    harness.video.copyrightDeclaredById = USER_ID;
    const response = await post(harness.baseUrl, `/api/v1/videos/${VIDEO_ID}/publish`);
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(harness.video.status, 'PUBLISHED');
    strict_1.default.equal(harness.calls.publicPromotions, 0);
});
(0, node_test_1.test)('CORS allows only configured origins and blocks unapproved cross-origin writes', async () => {
    const origins = (0, cors_1.parseAllowedOrigins)('https://viewer.example', true);
    const app = (0, express_1.default)();
    app.use((0, cors_1.createCorsMiddleware)(origins));
    app.post('/write', (_req, res) => res.sendStatus(204));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const allowed = await fetch(`${baseUrl}/write`, {
        method: 'POST',
        headers: { Origin: 'https://viewer.example' },
    });
    strict_1.default.equal(allowed.status, 204);
    strict_1.default.equal(allowed.headers.get('access-control-allow-origin'), 'https://viewer.example');
    strict_1.default.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    const rejected = await fetch(`${baseUrl}/write`, {
        method: 'POST',
        headers: { Origin: 'https://attacker.example' },
    });
    strict_1.default.equal(rejected.status, 403);
    strict_1.default.equal(rejected.headers.get('access-control-allow-origin'), null);
});
