"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const channel_image_upload_route_1 = require("../src/routes/channel-image-upload.route");
const channel_route_1 = require("../src/routes/channel.route");
const channel_image_service_1 = require("../src/services/channel-image.service");
const storage_service_1 = require("../src/services/storage.service");
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const UPLOAD_ID = '55555555-5555-4555-8555-555555555555';
const TEST_SECRET = 'channel-image-test-secret-0123456789';
const PUBLIC_IMAGE_URL = `https://cdn.example/channel-images/${CHANNEL_ID}/avatar/verified.webp`;
let activeServers = [];
function makeChannel(id, userId) {
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
function publicChannel(channel) {
    const { userId: _userId, ...settings } = channel;
    return settings;
}
async function createHarness() {
    const channels = [makeChannel(CHANNEL_ID, OWNER_ID), makeChannel(SECOND_CHANNEL_ID, OTHER_USER_ID)];
    const calls = {
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
        ticketSecret: TEST_SECRET,
        repository: {
            ownsChannel: async (channelId, userId) => {
                calls.owns.push({ channelId, userId });
                return !calls.rejectOwner
                    && channels.some((channel) => channel.id === channelId && channel.userId === userId);
            },
            updateOwnedImage: async (channelId, userId, purpose, imageUrl) => {
                calls.updates.push({ channelId, userId, purpose, imageUrl });
                if (calls.persistenceFailure)
                    throw new Error('simulated database persistence failure');
                const channel = channels.find((item) => item.id === channelId && item.userId === userId);
                if (!channel)
                    return null;
                if (purpose === 'avatar')
                    channel.avatarUrl = imageUrl;
                else
                    channel.bannerUrl = imageUrl;
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
                    throw new storage_service_1.StorageUnavailableError('Cloud storage is not configured. Missing environment variable: R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL.');
                }
                if (calls.storageFailure)
                    throw new Error('simulated object storage failure');
                if (calls.invalidImage)
                    throw new channel_image_service_1.InvalidChannelImageError();
                return calls.missingObject ? null : PUBLIC_IMAGE_URL;
            },
        },
    };
    const channelRepository = {
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
        handleExists: async (handle, exceptChannelId) => channels.some((item) => item.handle === handle && item.id !== exceptChannelId),
        updateOwnedChannel: async (channelId, userId, data) => {
            const channel = channels.find((item) => item.id === channelId && item.userId === userId);
            if (!channel)
                return null;
            Object.assign(channel, data);
            return publicChannel(channel);
        },
    };
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1/channels', (0, channel_image_upload_route_1.createChannelImageUploadRouter)(dependencies));
    app.use('/api/v1/channels', (0, channel_route_1.createChannelRouter)({ authenticate, repository: channelRepository }));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return { baseUrl: `http://127.0.0.1:${address.port}`, server, channels, calls };
}
async function post(baseUrl, path, body, userId = OWNER_ID) {
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            ...(userId ? { 'x-test-user': userId } : {}),
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}
async function requestIntent(harness, purpose = 'avatar', body = { contentType: 'image/png', fileSize: 1024 }) {
    const response = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/${purpose}/upload-intent`, body);
    strict_1.default.equal(response.status, 201);
    return await response.json();
}
(0, node_test_1.beforeEach)(() => {
    activeServers = [];
});
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
});
(0, node_test_1.test)('upload intent requires authentication and owner authorization', async () => {
    const harness = await createHarness();
    const path = `/api/v1/channels/${CHANNEL_ID}/images/avatar/upload-intent`;
    const body = { contentType: 'image/png', fileSize: 1024 };
    const unauthenticated = await post(harness.baseUrl, path, body, '');
    strict_1.default.equal(unauthenticated.status, 401);
    const nonOwner = await post(harness.baseUrl, path, body, OTHER_USER_ID);
    strict_1.default.equal(nonOwner.status, 404);
    const crossChannel = await post(harness.baseUrl, `/api/v1/channels/${SECOND_CHANNEL_ID}/images/avatar/upload-intent`, body);
    strict_1.default.equal(crossChannel.status, 404);
    strict_1.default.equal(harness.calls.targets.length, 0);
});
(0, node_test_1.test)('upload intent accepts supported types and returns a short-lived target without an object key', async () => {
    const harness = await createHarness();
    const response = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/avatar/upload-intent`, { contentType: 'image/webp', fileSize: 1024 });
    strict_1.default.equal(response.status, 201);
    const body = await response.json();
    strict_1.default.equal(body.uploadUrl, 'https://upload.example/presigned');
    strict_1.default.equal(typeof body.uploadToken, 'string');
    strict_1.default.equal(body.expiresIn, 900);
    strict_1.default.equal('objectKey' in body, false);
    strict_1.default.equal('imageUrl' in body, false);
    strict_1.default.deepEqual(harness.calls.targets[0], {
        channelId: CHANNEL_ID,
        purpose: 'avatar',
        contentType: 'image/webp',
        fileSize: 1024,
    });
});
(0, node_test_1.test)('upload intent rejects unsupported types, invalid sizes, and forged keys', async () => {
    const harness = await createHarness();
    const path = `/api/v1/channels/${CHANNEL_ID}/images/avatar/upload-intent`;
    const unsupported = await post(harness.baseUrl, path, { contentType: 'image/svg+xml', fileSize: 1024 });
    strict_1.default.equal(unsupported.status, 400);
    const oversized = await post(harness.baseUrl, path, { contentType: 'image/png', fileSize: 5 * 1024 * 1024 + 1 });
    strict_1.default.equal(oversized.status, 400);
    const forgedKey = await post(harness.baseUrl, path, {
        contentType: 'image/png',
        fileSize: 1024,
        objectKey: `channel-images/${SECOND_CHANNEL_ID}/avatar/forged.webp`,
    });
    strict_1.default.equal(forgedKey.status, 400);
    strict_1.default.equal(harness.calls.targets.length, 0);
});
(0, node_test_1.test)('confirmation rechecks channel ownership before accessing the uploaded object', async () => {
    const harness = await createHarness();
    const { uploadToken } = await requestIntent(harness);
    harness.calls.rejectOwner = true;
    const response = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`, { uploadToken });
    strict_1.default.equal(response.status, 404);
    strict_1.default.equal(harness.calls.published.length, 0);
    strict_1.default.equal(harness.calls.updates.length, 0);
});
(0, node_test_1.test)('confirmation rejects missing objects, invalid image content, and arbitrary image URLs', async () => {
    const harness = await createHarness();
    const { uploadToken } = await requestIntent(harness);
    const path = `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`;
    const forged = await post(harness.baseUrl, path, {
        uploadToken,
        objectKey: `channel-image-uploads/${SECOND_CHANNEL_ID}/avatar/${UPLOAD_ID}`,
    });
    strict_1.default.equal(forged.status, 400);
    const externalUrl = await post(harness.baseUrl, path, {
        uploadToken,
        imageUrl: 'https://attacker.example/avatar.png',
    });
    strict_1.default.equal(externalUrl.status, 400);
    strict_1.default.equal(harness.calls.published.length, 0);
    harness.calls.missingObject = true;
    const missing = await post(harness.baseUrl, path, { uploadToken });
    strict_1.default.equal(missing.status, 409);
    strict_1.default.equal(harness.calls.updates.length, 0);
    harness.calls.missingObject = false;
    harness.calls.invalidImage = true;
    const invalid = await post(harness.baseUrl, path, { uploadToken });
    strict_1.default.equal(invalid.status, 400);
    strict_1.default.equal(harness.calls.updates.length, 0);
});
(0, node_test_1.test)('confirmation reports transient storage failures without persisting an image URL', async () => {
    const harness = await createHarness();
    const { uploadToken } = await requestIntent(harness);
    harness.calls.storageFailure = true;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    let response;
    try {
        response = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`, { uploadToken });
    }
    finally {
        console.error = originalConsoleError;
    }
    strict_1.default.equal(response.status, 503);
    strict_1.default.equal(harness.calls.updates.length, 0);
});
(0, node_test_1.test)('confirmation reports missing storage configuration without exposing credentials', async () => {
    const harness = await createHarness();
    const { uploadToken } = await requestIntent(harness);
    harness.calls.storageUnavailable = true;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    let response;
    try {
        response = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`, { uploadToken });
    }
    finally {
        console.error = originalConsoleError;
    }
    strict_1.default.equal(response.status, 503);
    const body = await response.json();
    strict_1.default.match(body.error, /R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL/);
    strict_1.default.doesNotMatch(body.error, /access.?key|secret|password/i);
    strict_1.default.equal(harness.calls.updates.length, 0);
});
(0, node_test_1.test)('confirmation reports persistence failures without returning a successful image URL', async () => {
    const harness = await createHarness();
    const { uploadToken } = await requestIntent(harness);
    harness.calls.persistenceFailure = true;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    let response;
    try {
        response = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`, { uploadToken });
    }
    finally {
        console.error = originalConsoleError;
    }
    strict_1.default.equal(response.status, 500);
    strict_1.default.deepEqual(await response.json(), { error: 'Internal server error' });
    strict_1.default.equal(harness.calls.updates.length, 1);
});
(0, node_test_1.test)('a valid ticket cannot be replayed for another channel or by another user', async () => {
    const harness = await createHarness();
    const { uploadToken } = await requestIntent(harness);
    const crossChannel = await post(harness.baseUrl, `/api/v1/channels/${SECOND_CHANNEL_ID}/images/avatar/confirm`, { uploadToken });
    strict_1.default.equal(crossChannel.status, 400);
    const otherUser = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`, { uploadToken }, OTHER_USER_ID);
    strict_1.default.equal(otherUser.status, 400);
    strict_1.default.equal(harness.calls.published.length, 0);
});
(0, node_test_1.test)('verified avatar uploads persist only the avatar URL on the authorized channel', async () => {
    const harness = await createHarness();
    const { uploadToken } = await requestIntent(harness, 'avatar');
    const response = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/avatar/confirm`, { uploadToken });
    strict_1.default.equal(response.status, 200);
    const body = await response.json();
    strict_1.default.equal(body.imageUrl, PUBLIC_IMAGE_URL);
    strict_1.default.equal(body.channel.avatarUrl, PUBLIC_IMAGE_URL);
    strict_1.default.equal(body.channel.bannerUrl, null);
    strict_1.default.deepEqual(harness.calls.updates[0], {
        channelId: CHANNEL_ID,
        userId: OWNER_ID,
        purpose: 'avatar',
        imageUrl: PUBLIC_IMAGE_URL,
    });
    strict_1.default.deepEqual(harness.calls.published[0], {
        channelId: CHANNEL_ID,
        purpose: 'avatar',
        contentType: 'image/png',
        fileSize: 1024,
        uploadId: UPLOAD_ID,
    });
    const publicResponse = await fetch(`${harness.baseUrl}/api/v1/channels/%40owner`);
    strict_1.default.equal(publicResponse.status, 200);
    const publicChannel = await publicResponse.json();
    strict_1.default.equal(publicChannel.avatarUrl, PUBLIC_IMAGE_URL);
    strict_1.default.equal(publicChannel.bannerUrl, null);
    strict_1.default.equal(harness.channels[1].avatarUrl, null);
});
(0, node_test_1.test)('verified banner uploads persist only the banner URL on the authorized channel', async () => {
    const harness = await createHarness();
    const { uploadToken } = await requestIntent(harness, 'banner', {
        contentType: 'image/jpeg',
        fileSize: 2048,
    });
    const response = await post(harness.baseUrl, `/api/v1/channels/${CHANNEL_ID}/images/banner/confirm`, { uploadToken });
    strict_1.default.equal(response.status, 200);
    const body = await response.json();
    strict_1.default.equal(body.imageUrl, PUBLIC_IMAGE_URL);
    strict_1.default.equal(body.channel.avatarUrl, null);
    strict_1.default.equal(body.channel.bannerUrl, PUBLIC_IMAGE_URL);
});
