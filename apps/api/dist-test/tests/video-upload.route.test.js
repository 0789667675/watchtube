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
let activeServers = [];
async function createHarness() {
    const video = {
        id: VIDEO_ID,
        channelId: CHANNEL_ID,
        rawStorageKey: RAW_KEY,
        status: 'UPLOADING',
        thumbnailUrl: null,
        channel: { userId: USER_ID },
        title: 'Test video',
    };
    const calls = {
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
            createVideo: async () => {
                calls.created += 1;
                return { id: VIDEO_ID };
            },
            findVideo: async (id) => id === VIDEO_ID ? video : null,
            markProcessing: async () => {
                if (video.status !== 'UPLOADING')
                    return false;
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
                if (calls.objectMissing)
                    return null;
                return { contentLength: calls.objectContentLength, contentType: calls.objectContentType };
            },
        },
        queue: {
            add: async (_name, data, options) => {
                calls.queueJobs.push({ jobId: options.jobId, data });
                if (calls.queueFails)
                    throw new Error('test queue failure');
            },
        },
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
(0, node_test_1.beforeEach)(() => {
    activeServers = [];
});
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
});
(0, node_test_1.test)('upload intent requires authentication and validates metadata', async () => {
    const harness = await createHarness();
    const path = '/api/v1/videos/upload-intent';
    const unauthorized = await post(harness.baseUrl, path, {
        title: 'Valid title', contentType: 'video/mp4', fileSize: 1024, channelId: CHANNEL_ID,
    }, '');
    strict_1.default.equal(unauthorized.status, 401);
    const malformed = await post(harness.baseUrl, path, {
        title: 'Valid title', contentType: 'video/mp4', fileSize: 0, channelId: CHANNEL_ID,
    });
    strict_1.default.equal(malformed.status, 400);
    strict_1.default.equal(harness.calls.created, 0);
});
(0, node_test_1.test)('upload intent rejects channels not owned by the authenticated user', async () => {
    const harness = await createHarness();
    harness.calls.ownsChannel = false;
    const response = await post(harness.baseUrl, '/api/v1/videos/upload-intent', {
        title: 'Valid title', contentType: 'video/mp4', fileSize: 1024, channelId: CHANNEL_ID,
    });
    strict_1.default.equal(response.status, 404);
    strict_1.default.equal(harness.calls.uploadUrls.length, 0);
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
