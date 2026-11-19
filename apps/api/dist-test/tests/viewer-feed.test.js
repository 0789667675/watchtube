"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const node_test_1 = require("node:test");
const auth_1 = require("../src/middleware/auth");
const feed_route_1 = require("../src/routes/feed.route");
const interaction_route_1 = require("../src/routes/interaction.route");
const jwt_1 = require("../src/config/jwt");
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const video = { id: 'public-video-from-test-repository' };
const token = jsonwebtoken_1.default.sign({ id: USER_ID, role: 'VIEWER' }, jwt_1.JWT_SECRET, { expiresIn: '1h' });
let activeServers = [];
async function startServer(app) {
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
function authenticate(status = 'GOOD_STANDING') {
    return (0, auth_1.createAuthenticate)(async (id) => ({ id, role: 'VIEWER', status }));
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
    activeServers = [];
});
(0, node_test_1.test)('home feed returns real repository results with public and ready filters', async () => {
    let query;
    const app = (0, express_1.default)();
    app.get('/api/v1/videos', (0, feed_route_1.createPublicVideosHandler)(async (args) => {
        query = args;
        return [video];
    }));
    const response = await fetch(`${await startServer(app)}/api/v1/videos`);
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), [video]);
    strict_1.default.deepEqual(query?.where, {
        status: { in: ['READY', 'PUBLISHED'] },
        visibility: 'PUBLIC',
    });
});
(0, node_test_1.test)('home feed reports a missing database as service unavailable without exposing details', async () => {
    const app = (0, express_1.default)();
    app.get('/api/v1/videos', (0, feed_route_1.createPublicVideosHandler)(async () => {
        const error = new Error('database connection detail must not be returned');
        error.name = 'PrismaClientInitializationError';
        throw error;
    }));
    const response = await fetch(`${await startServer(app)}/api/v1/videos`);
    strict_1.default.equal(response.status, 503);
    strict_1.default.deepEqual(await response.json(), {
        error: 'Discover videos are temporarily unavailable because the database is unavailable.',
    });
});
(0, node_test_1.test)('trending feed includes real public engagement, sorts it, paginates, and reports database failures', async () => {
    let query;
    let shouldFail = false;
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async (args) => {
        query = args;
        if (shouldFail)
            throw Object.assign(new Error('database offline'), { errorCode: 'P1001' });
        return [video];
    }));
    const baseUrl = await startServer(app);
    const success = await fetch(`${baseUrl}/api/v1/feed/trending?page=2&limit=3`);
    strict_1.default.equal(success.status, 200);
    strict_1.default.deepEqual(await success.json(), {
        videos: [video],
        pagination: { page: 2, limit: 3, hasMore: false },
    });
    strict_1.default.deepEqual(query?.where, {
        status: { in: ['READY', 'PUBLISHED'] },
        visibility: 'PUBLIC',
        OR: [
            { viewsCount: { gt: 0 } },
            { likes: { some: { isDislike: false } } },
            { comments: { some: {} } },
        ],
    });
    strict_1.default.equal('createdAt' in (query?.where ?? {}), false);
    strict_1.default.equal(query?.skip, 3);
    strict_1.default.equal(query?.take, 4);
    strict_1.default.deepEqual(query?.orderBy, [
        { viewsCount: 'desc' },
        { comments: { _count: 'desc' } },
        { createdAt: 'desc' },
    ]);
    shouldFail = true;
    const failure = await fetch(`${baseUrl}/api/v1/feed/trending`);
    strict_1.default.equal(failure.status, 503);
    strict_1.default.deepEqual(await failure.json(), {
        error: 'Trending videos are temporarily unavailable because the database is unavailable.',
    });
});
(0, node_test_1.test)('trending rejects malformed pagination before querying', async () => {
    let queries = 0;
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async () => {
        queries += 1;
        return [];
    }));
    const baseUrl = await startServer(app);
    for (const url of [
        '/api/v1/feed/trending?page=0',
        '/api/v1/feed/trending?page=1001',
        '/api/v1/feed/trending?limit=51',
    ]) {
        const response = await fetch(`${baseUrl}${url}`);
        strict_1.default.equal(response.status, 400);
    }
    strict_1.default.equal(queries, 0);
});
(0, node_test_1.test)('search returns separately paginated public video and creator results', async () => {
    let videoQuery;
    let channelQuery;
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async (args) => {
        videoQuery = args;
        return [video, { id: 'second-video' }, { id: 'third-video' }, { id: 'lookahead-video' }];
    }, async (args) => {
        channelQuery = args;
        return [{ id: 'creator-1' }, { id: 'creator-2' }, { id: 'creator-3' }, { id: 'lookahead-creator' }];
    }));
    const response = await fetch(`${await startServer(app)}/api/v1/feed/search?q=%20music%20&page=2&limit=3`);
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), {
        videos: [video, { id: 'second-video' }, { id: 'third-video' }],
        channels: [{ id: 'creator-1' }, { id: 'creator-2' }, { id: 'creator-3' }],
        pagination: { page: 2, limit: 3, hasMoreVideos: true, hasMoreChannels: true },
    });
    strict_1.default.deepEqual(videoQuery?.where, {
        status: { in: ['READY', 'PUBLISHED'] },
        visibility: 'PUBLIC',
        OR: [
            { title: { contains: 'music', mode: 'insensitive' } },
            { description: { contains: 'music', mode: 'insensitive' } },
            { channel: { name: { contains: 'music', mode: 'insensitive' } } },
            { channel: { handle: { contains: 'music', mode: 'insensitive' } } },
        ],
    });
    strict_1.default.equal(videoQuery?.skip, 3);
    strict_1.default.equal(videoQuery?.take, 4);
    strict_1.default.deepEqual(channelQuery?.where, {
        OR: [
            { name: { contains: 'music', mode: 'insensitive' } },
            { handle: { contains: 'music', mode: 'insensitive' } },
        ],
    });
    strict_1.default.equal(channelQuery?.skip, 3);
    strict_1.default.equal(channelQuery?.take, 4);
});
(0, node_test_1.test)('search rejects blank, oversized, and malformed pagination parameters before querying', async () => {
    let queries = 0;
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async () => { queries += 1; return []; }, async () => { queries += 1; return []; }));
    const baseUrl = await startServer(app);
    for (const url of [
        '/api/v1/feed/search?q=%20%20',
        `/api/v1/feed/search?q=${'x'.repeat(101)}`,
        '/api/v1/feed/search?q=music&page=0',
        '/api/v1/feed/search?q=music&limit=51',
    ]) {
        const response = await fetch(`${baseUrl}${url}`);
        strict_1.default.equal(response.status, 400);
    }
    strict_1.default.equal(queries, 0);
});
(0, node_test_1.test)('subscriptions reject unauthenticated requests and return only public videos from followed channels', async () => {
    let channelLookupCount = 0;
    let query;
    const app = (0, express_1.default)();
    app.use((0, interaction_route_1.createSubscriptionFeedRouter)(authenticate(), {
        async findChannelIds(userId) {
            channelLookupCount += 1;
            strict_1.default.equal(userId, USER_ID);
            return [{ channelId: CHANNEL_ID }];
        },
        async findVideos(args) {
            query = args;
            return [video];
        },
    }));
    const baseUrl = await startServer(app);
    const unauthenticated = await fetch(`${baseUrl}/feed/subscriptions`);
    strict_1.default.equal(unauthenticated.status, 401);
    strict_1.default.equal(channelLookupCount, 0);
    const authenticated = await fetch(`${baseUrl}/feed/subscriptions`, {
        headers: { authorization: `Bearer ${token}` },
    });
    strict_1.default.equal(authenticated.status, 200);
    strict_1.default.deepEqual(await authenticated.json(), [video]);
    strict_1.default.deepEqual(query?.where, {
        channelId: { in: [CHANNEL_ID] },
        status: { in: ['READY', 'PUBLISHED'] },
        visibility: 'PUBLIC',
    });
});
(0, node_test_1.test)('subscriptions report database failures and preserve account restrictions', async () => {
    const app = (0, express_1.default)();
    app.use((0, interaction_route_1.createSubscriptionFeedRouter)(authenticate(), {
        async findChannelIds() {
            throw Object.assign(new Error('database offline'), { code: 'P1003' });
        },
        async findVideos() {
            return [];
        },
    }));
    const baseUrl = await startServer(app);
    const unavailable = await fetch(`${baseUrl}/feed/subscriptions`, {
        headers: { authorization: `Bearer ${token}` },
    });
    strict_1.default.equal(unavailable.status, 503);
    strict_1.default.deepEqual(await unavailable.json(), {
        error: 'Subscriptions are temporarily unavailable because the database is unavailable.',
    });
    const restrictedApp = (0, express_1.default)();
    restrictedApp.use((0, interaction_route_1.createSubscriptionFeedRouter)(authenticate('RESTRICTED'), {
        async findChannelIds() {
            throw new Error('restricted accounts must not query subscriptions');
        },
        async findVideos() {
            return [];
        },
    }));
    const restrictedBaseUrl = await startServer(restrictedApp);
    const restricted = await fetch(`${restrictedBaseUrl}/feed/subscriptions`, {
        headers: { authorization: `Bearer ${token}` },
    });
    strict_1.default.equal(restricted.status, 403);
});
