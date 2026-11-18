"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const channel_route_1 = require("../src/routes/channel.route");
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_CHANNEL_ID = '55555555-5555-4555-8555-555555555555';
let activeServers = [];
function createChannel(id, userId, name, handle) {
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
function settingsOf(channel) {
    return {
        id: channel.id,
        name: channel.name,
        handle: channel.handle,
        description: channel.description,
        avatarUrl: channel.avatarUrl,
        bannerUrl: channel.bannerUrl,
    };
}
async function createHarness() {
    const channels = [
        createChannel(CHANNEL_ID, OWNER_ID, 'First channel', '@first'),
        createChannel(SECOND_CHANNEL_ID, OWNER_ID, 'Second channel', '@second'),
        createChannel(OTHER_CHANNEL_ID, OTHER_USER_ID, 'Other creator channel', '@other'),
    ];
    const calls = { settingsReads: [], updates: [] };
    const authenticate = (req, res, next) => {
        const userId = req.get('x-test-user');
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        req.user = { id: userId, role: 'USER' };
        next();
    };
    const repository = {
        createChannel: async (input) => {
            const channel = createChannel('77777777-7777-4777-8777-777777777777', input.userId, input.name, input.handle);
            channel.description = input.description ?? null;
            channels.push(channel);
            return settingsOf(channel);
        },
        findPublicChannel: async (handle) => {
            const channel = channels.find((item) => item.handle === handle);
            if (!channel)
                return null;
            const { userId: _userId, ...publicChannel } = channel;
            return publicChannel;
        },
        findOwnedChannel: async (channelId, userId) => {
            calls.settingsReads.push({ channelId, userId });
            const channel = channels.find((item) => item.id === channelId && item.userId === userId);
            return channel ? settingsOf(channel) : null;
        },
        handleExists: async (handle, exceptChannelId) => channels.some((item) => item.handle === handle && item.id !== exceptChannelId),
        updateOwnedChannel: async (channelId, userId, data) => {
            calls.updates.push({ channelId, userId, data });
            const channel = channels.find((item) => item.id === channelId && item.userId === userId);
            if (!channel)
                return null;
            Object.assign(channel, data);
            return settingsOf(channel);
        },
    };
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1/channels', (0, channel_route_1.createChannelRouter)({ authenticate, repository }));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return { baseUrl: `http://127.0.0.1:${address.port}`, server, channels, calls };
}
async function request(baseUrl, path, method, body, userId = OWNER_ID) {
    return fetch(`${baseUrl}/api/v1/channels${path}`, {
        method,
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
(0, node_test_1.test)('only an authenticated channel owner can retrieve settings', async () => {
    const harness = await createHarness();
    const response = await request(harness.baseUrl, `/${CHANNEL_ID}/settings`, 'GET');
    const settings = await response.json();
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(settings, {
        id: CHANNEL_ID,
        name: 'First channel',
        handle: '@first',
        description: null,
        avatarUrl: null,
        bannerUrl: null,
    });
    strict_1.default.equal('userId' in settings, false);
    const anonymous = await request(harness.baseUrl, `/${CHANNEL_ID}/settings`, 'GET', undefined, '');
    strict_1.default.equal(anonymous.status, 401);
    const nonOwner = await request(harness.baseUrl, `/${OTHER_CHANNEL_ID}/settings`, 'GET', undefined, OWNER_ID);
    strict_1.default.equal(nonOwner.status, 404);
});
(0, node_test_1.test)('an owner can update channel fields and the public channel endpoint returns the saved values', async () => {
    const harness = await createHarness();
    const response = await request(harness.baseUrl, `/${CHANNEL_ID}/settings`, 'PATCH', { name: '  Updated channel  ', handle: 'updated_handle', description: ' Updated description ' });
    const updated = await response.json();
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(updated, {
        id: CHANNEL_ID,
        name: 'Updated channel',
        handle: '@updated_handle',
        description: 'Updated description',
        avatarUrl: null,
        bannerUrl: null,
    });
    const publicResponse = await request(harness.baseUrl, '/@updated_handle', 'GET', undefined, '');
    const publicChannel = await publicResponse.json();
    strict_1.default.equal(publicResponse.status, 200);
    strict_1.default.equal(publicChannel.name, updated.name);
    strict_1.default.equal(publicChannel.handle, updated.handle);
    strict_1.default.equal(publicChannel.description, updated.description);
    strict_1.default.equal(publicChannel.videos.length, 1);
});
(0, node_test_1.test)('unauthenticated and non-owner update attempts cannot change a channel', async () => {
    const harness = await createHarness();
    const anonymous = await request(harness.baseUrl, `/${CHANNEL_ID}/settings`, 'PATCH', { name: 'Unauthorized change' }, '');
    strict_1.default.equal(anonymous.status, 401);
    const nonOwner = await request(harness.baseUrl, `/${OTHER_CHANNEL_ID}/settings`, 'PATCH', { name: 'Cross-channel change' });
    strict_1.default.equal(nonOwner.status, 404);
    strict_1.default.equal(harness.channels.find((channel) => channel.id === OTHER_CHANNEL_ID)?.name, 'Other creator channel');
    strict_1.default.equal(harness.calls.updates.length, 0);
});
(0, node_test_1.test)('duplicate handles are rejected without updating the channel', async () => {
    const harness = await createHarness();
    const response = await request(harness.baseUrl, `/${CHANNEL_ID}/settings`, 'PATCH', { handle: '@second' });
    strict_1.default.equal(response.status, 409);
    strict_1.default.equal(harness.channels.find((channel) => channel.id === CHANNEL_ID)?.handle, '@first');
    strict_1.default.equal(harness.calls.updates.length, 0);
});
(0, node_test_1.test)('invalid fields, image references, public links and account fields are rejected', async () => {
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
        const response = await request(harness.baseUrl, `/${CHANNEL_ID}/settings`, 'PATCH', body);
        strict_1.default.equal(response.status, 400);
    }
    strict_1.default.equal(harness.calls.updates.length, 0);
});
(0, node_test_1.test)('multiple owned channels remain isolated during updates', async () => {
    const harness = await createHarness();
    const response = await request(harness.baseUrl, `/${CHANNEL_ID}/settings`, 'PATCH', { description: 'Only the first channel changes' });
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(harness.channels.find((channel) => channel.id === CHANNEL_ID)?.description, 'Only the first channel changes');
    strict_1.default.equal(harness.channels.find((channel) => channel.id === SECOND_CHANNEL_ID)?.description, null);
});
(0, node_test_1.test)('malformed channel IDs are rejected before repository access', async () => {
    const harness = await createHarness();
    const response = await request(harness.baseUrl, '/not-a-uuid/settings', 'PATCH', { name: 'Updated name' });
    strict_1.default.equal(response.status, 400);
    strict_1.default.equal(harness.calls.settingsReads.length, 0);
    strict_1.default.equal(harness.calls.updates.length, 0);
});
