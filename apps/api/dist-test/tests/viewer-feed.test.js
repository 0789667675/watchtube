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
const recommendation_service_1 = require("../src/services/recommendation.service");
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const video = { id: 'public-video-from-test-repository' };
const channel = { name: 'Public channel', handle: '@public', avatarUrl: null, isVerified: false };
function trendingVideo(id, activity, publishedAt = new Date('2026-11-18T12:00:00.000Z')) {
    return {
        id,
        title: id,
        description: null,
        thumbnailUrl: null,
        duration: null,
        viewsCount: 0,
        createdAt: publishedAt,
        publishedAt,
        channel,
        _count: activity,
    };
}
const recommendationNow = new Date('2026-11-21T12:00:00.000Z');
function recommendationVideo(id, options = {}) {
    const createdAt = options.createdAt ?? recommendationNow;
    return {
        id,
        isShort: false,
        title: id,
        description: null,
        thumbnailUrl: null,
        duration: 120,
        viewsCount: 0,
        createdAt,
        publishedAt: options.publishedAt ?? createdAt,
        channelId: options.channelId ?? `channel-${id}`,
        category: options.category ?? 'MUSIC',
        tags: options.tags ?? [],
        channel,
        ...options,
    };
}
function activityFor(category = 'MUSIC', tags = ['acoustic'], videoId = 'watched-video') {
    return {
        watchHistory: [{
                videoId,
                category,
                tags,
                channelId: 'history-channel',
                completed: true,
                lastPositionSeconds: 120,
                updatedAt: recommendationNow,
            }],
    };
}
function publicTrendingVideo(candidate) {
    const { _count, ...videoResult } = candidate;
    return videoResult;
}
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
        isShort: false,
        copyrightReviewStatus: { not: 'BLOCKED' },
        channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
    });
    strict_1.default.deepEqual(query?.select, {
        id: true,
        isShort: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        duration: true,
        viewsCount: true,
        createdAt: true,
        publishedAt: true,
        channel: {
            select: { name: true, handle: true, avatarUrl: true, isVerified: true },
        },
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
(0, node_test_1.test)('trending ranking uses recent valid views, positive likes, comments, and deterministic ties', () => {
    const mostRecent = trendingVideo('more-recent', { viewEvents: 1, likes: 1, comments: 0 }, new Date('2026-11-19T12:00:00.000Z'));
    const higherScore = trendingVideo('higher-score', { viewEvents: 0, likes: 2, comments: 0 });
    const tiedByDate = trendingVideo('a-tie', { viewEvents: 4, likes: 0, comments: 0 });
    const tiedById = trendingVideo('b-tie', { viewEvents: 4, likes: 0, comments: 0 });
    const input = [mostRecent, tiedById, higherScore, tiedByDate];
    strict_1.default.deepEqual((0, feed_route_1.rankTrendingVideos)(input).map(({ id }) => id), ['higher-score', 'more-recent', 'a-tie', 'b-tie']);
    strict_1.default.deepEqual(input.map(({ id }) => id), ['more-recent', 'b-tie', 'higher-score', 'a-tie']);
});
(0, node_test_1.test)('trending uses a seven-day activity window, filters ineligible videos, and paginates ranked results', async () => {
    const queries = [];
    let shouldFail = false;
    const rankedResults = (0, feed_route_1.rankTrendingVideos)([
        trendingVideo('first-place', { viewEvents: 0, likes: 2, comments: 0 }),
        trendingVideo('second-place', { viewEvents: 1, likes: 1, comments: 0 }),
    ]).map(publicTrendingVideo);
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async () => [], async () => [], async (args) => {
        queries.push(args);
        if (shouldFail)
            throw Object.assign(new Error('database offline'), { errorCode: 'P1001' });
        return rankedResults.slice(args.skip, args.skip + args.take);
    }));
    const baseUrl = await startServer(app);
    const firstPage = await fetch(`${baseUrl}/api/v1/feed/trending?limit=1`);
    strict_1.default.equal(firstPage.status, 200);
    strict_1.default.deepEqual(await firstPage.json(), {
        videos: [{
                id: 'first-place',
                title: 'first-place',
                description: null,
                thumbnailUrl: null,
                duration: null,
                viewsCount: 0,
                createdAt: '2026-11-18T12:00:00.000Z',
                publishedAt: '2026-11-18T12:00:00.000Z',
                channel,
            }],
        pagination: { page: 1, limit: 1, hasMore: true },
    });
    const success = await fetch(`${baseUrl}/api/v1/feed/trending?page=2&limit=1`);
    strict_1.default.equal(success.status, 200);
    strict_1.default.deepEqual(await success.json(), {
        videos: [{
                id: 'second-place',
                title: 'second-place',
                description: null,
                thumbnailUrl: null,
                duration: null,
                viewsCount: 0,
                createdAt: '2026-11-18T12:00:00.000Z',
                publishedAt: '2026-11-18T12:00:00.000Z',
                channel,
            }],
        pagination: { page: 2, limit: 1, hasMore: false },
    });
    strict_1.default.equal(queries.length, 2);
    strict_1.default.equal(queries[0].take, 2);
    strict_1.default.equal(queries[0].skip, 0);
    strict_1.default.equal(queries[1].take, 2);
    strict_1.default.equal(queries[1].skip, 1);
    strict_1.default.ok(Date.now() - queries[0].windowStart.getTime() >= 7 * 24 * 60 * 60 * 1000 - 1000);
    strict_1.default.ok(Date.now() - queries[0].windowStart.getTime() <= 7 * 24 * 60 * 60 * 1000 + 1000);
    shouldFail = true;
    const failure = await fetch(`${baseUrl}/api/v1/feed/trending`);
    strict_1.default.equal(failure.status, 503);
    strict_1.default.deepEqual(await failure.json(), {
        error: 'Trending videos are temporarily unavailable because the database is unavailable.',
    });
});
(0, node_test_1.test)('trending SQL applies public eligibility filters and bounds ranked results in the database', () => {
    const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const query = (0, feed_route_1.buildTrendingQuery)({ windowStart, take: 13, skip: 24 });
    strict_1.default.match(query.sql, /video\."status" IN \('READY', 'PUBLISHED'\)/);
    strict_1.default.match(query.sql, /video\."visibility" = 'PUBLIC'/);
    strict_1.default.match(query.sql, /video\."copyrightReviewStatus" <> 'BLOCKED'/);
    strict_1.default.match(query.sql, /creator\."status" NOT IN \('RESTRICTED', 'SUSPENDED'\)/);
    strict_1.default.match(query.sql, /view_event\."isValidView" = TRUE/);
    strict_1.default.match(query.sql, /video_like\."isDislike" = FALSE/);
    strict_1.default.match(query.sql, /ORDER BY \(/);
    strict_1.default.match(query.sql, /LIMIT .* OFFSET /s);
    strict_1.default.equal(query.values.filter((value) => value === windowStart).length, 3);
    strict_1.default.ok(query.values.includes(1));
    strict_1.default.ok(query.values.includes(3));
    strict_1.default.ok(query.values.includes(4));
    strict_1.default.ok(query.values.includes(13));
    strict_1.default.ok(query.values.includes(24));
});
(0, node_test_1.test)('trending returns an empty page when there is no recent public activity', async () => {
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async () => [], async () => [], async () => []));
    const response = await fetch(`${await startServer(app)}/api/v1/feed/trending`);
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), {
        videos: [],
        pagination: { page: 1, limit: 12, hasMore: false },
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
        isShort: false,
        copyrightReviewStatus: { not: 'BLOCKED' },
        channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
        OR: [
            { title: { contains: 'music', mode: 'insensitive' } },
            { description: { contains: 'music', mode: 'insensitive' } },
            { channel: { name: { contains: 'music', mode: 'insensitive' } } },
            { channel: { handle: { contains: 'music', mode: 'insensitive' } } },
        ],
    });
    strict_1.default.equal(videoQuery?.skip, 3);
    strict_1.default.equal(videoQuery?.take, 4);
    strict_1.default.deepEqual(videoQuery?.orderBy, [
        { viewsCount: 'desc' },
        { createdAt: 'desc' },
        { id: 'asc' },
    ]);
    strict_1.default.deepEqual(videoQuery?.select, {
        id: true,
        isShort: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        duration: true,
        viewsCount: true,
        createdAt: true,
        publishedAt: true,
        channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
    });
    strict_1.default.deepEqual(channelQuery?.where, {
        user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } },
        OR: [
            { name: { contains: 'music', mode: 'insensitive' } },
            { handle: { contains: 'music', mode: 'insensitive' } },
        ],
    });
    strict_1.default.equal(channelQuery?.skip, 3);
    strict_1.default.equal(channelQuery?.take, 4);
    strict_1.default.deepEqual(channelQuery?.orderBy, [
        { subscriberCount: 'desc' },
        { name: 'asc' },
        { id: 'asc' },
    ]);
    strict_1.default.deepEqual(channelQuery?.select, {
        id: true,
        name: true,
        handle: true,
        avatarUrl: true,
        isVerified: true,
        subscriberCount: true,
    });
});
(0, node_test_1.test)('search pages do not repeat or skip ordered repository results', async () => {
    const records = Array.from({ length: 5 }, (_, index) => ({ id: `video-${index + 1}` }));
    const requests = [];
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async (args) => {
        requests.push(args);
        const skip = args.skip ?? 0;
        return records.slice(skip, skip + (args.take ?? 0));
    }, async () => []));
    const baseUrl = await startServer(app);
    const firstPage = await fetch(`${baseUrl}/api/v1/feed/search?q=music&page=1&limit=2`);
    const secondPage = await fetch(`${baseUrl}/api/v1/feed/search?q=music&page=2&limit=2`);
    strict_1.default.equal(firstPage.status, 200);
    strict_1.default.equal(secondPage.status, 200);
    const firstResults = (await firstPage.json()).videos;
    const secondResults = (await secondPage.json()).videos;
    strict_1.default.deepEqual(firstResults.map(({ id }) => id), ['video-1', 'video-2']);
    strict_1.default.deepEqual(secondResults.map(({ id }) => id), ['video-3', 'video-4']);
    strict_1.default.deepEqual(firstResults.filter(({ id }) => secondResults.some((next) => next.id === id)), []);
    strict_1.default.equal(requests[0].skip, 0);
    strict_1.default.equal(requests[1].skip, 2);
    strict_1.default.equal(requests[0].take, 3);
    strict_1.default.equal(requests[1].take, 3);
});
(0, node_test_1.test)('search preserves special characters in a trimmed, parameterized query', async () => {
    let videoQuery;
    let channelQuery;
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async (args) => { videoQuery = args; return []; }, async (args) => { channelQuery = args; return []; }));
    const term = "  O'Reilly 100%_\\music? & #  ";
    const response = await fetch(`${await startServer(app)}/api/v1/feed/search?${new URLSearchParams({ q: term })}`);
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), {
        videos: [],
        channels: [],
        pagination: { page: 1, limit: 12, hasMoreVideos: false, hasMoreChannels: false },
    });
    const expectedTerm = term.trim();
    const includesExpectedTerm = (value) => Object.values(value).some((field) => {
        if (typeof field !== 'object' || field === null)
            return false;
        if ('contains' in field)
            return field.contains === expectedTerm;
        return includesExpectedTerm(field);
    });
    strict_1.default.ok(videoQuery?.where?.OR?.every(includesExpectedTerm));
    strict_1.default.ok(channelQuery?.where?.OR?.every(includesExpectedTerm));
});
(0, node_test_1.test)('search returns empty public result sets and hides database failures', async () => {
    let shouldFail = false;
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async () => {
        if (shouldFail)
            throw Object.assign(new Error('database offline'), { errorCode: 'P1001' });
        return [];
    }, async () => []));
    const baseUrl = await startServer(app);
    const empty = await fetch(`${baseUrl}/api/v1/feed/search?q=missing`);
    strict_1.default.equal(empty.status, 200);
    strict_1.default.deepEqual(await empty.json(), {
        videos: [],
        channels: [],
        pagination: { page: 1, limit: 12, hasMoreVideos: false, hasMoreChannels: false },
    });
    shouldFail = true;
    const failure = await fetch(`${baseUrl}/api/v1/feed/search?q=music`);
    strict_1.default.equal(failure.status, 503);
    strict_1.default.deepEqual(await failure.json(), {
        error: 'Search is temporarily unavailable because the database is unavailable.',
    });
});
(0, node_test_1.test)('Shorts feed returns only published public Shorts and rejects invalid pagination', async () => {
    let shortsQuery;
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async (args) => {
        shortsQuery = args;
        return [{ id: 'short-1', isShort: true }, { id: 'short-2', isShort: true }];
    }));
    const baseUrl = await startServer(app);
    const response = await fetch(`${baseUrl}/api/v1/feed/shorts?page=1&limit=1`);
    strict_1.default.equal(response.status, 200);
    const body = await response.json();
    strict_1.default.equal(body.videos.length, 1);
    strict_1.default.equal(body.videos[0].isShort, true);
    strict_1.default.equal(body.pagination.hasMore, true);
    strict_1.default.equal(shortsQuery?.where?.isShort, true);
    const invalid = await fetch(`${baseUrl}/api/v1/feed/shorts?page=0`);
    strict_1.default.equal(invalid.status, 400);
});
(0, node_test_1.test)('search rejects blank, oversized, and malformed pagination parameters before querying', async () => {
    let queries = 0;
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async () => { queries += 1; return []; }, async () => { queries += 1; return []; }));
    const baseUrl = await startServer(app);
    for (const url of [
        '/api/v1/feed/search',
        '/api/v1/feed/search?q=%20%20',
        `/api/v1/feed/search?q=${'x'.repeat(101)}`,
        '/api/v1/feed/search?q=music&page=0',
        '/api/v1/feed/search?q=music&limit=51',
        '/api/v1/feed/search?q=music&q=video',
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
(0, node_test_1.test)('reaction status route is registered before any reaction write and requires authentication', async () => {
    const app = (0, express_1.default)();
    app.use(interaction_route_1.interactionRouter);
    const response = await fetch(`${await startServer(app)}/videos/${video.id}/like-status`);
    strict_1.default.equal(response.status, 401);
    strict_1.default.deepEqual(await response.json(), { error: 'Unauthorized' });
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
(0, node_test_1.test)('For You cold-start falls back to deterministic public discovery ordering', () => {
    const videos = [
        recommendationVideo('older', { publishedAt: new Date('2026-11-01T00:00:00.000Z') }),
        recommendationVideo('newer', { publishedAt: new Date('2026-11-20T00:00:00.000Z') }),
        recommendationVideo('popular', { viewsCount: 100 }),
    ];
    strict_1.default.deepEqual((0, recommendation_service_1.rankForYouVideos)(videos, {}, recommendationNow).map(({ id }) => id), ['popular', 'newer', 'older']);
    strict_1.default.deepEqual((0, recommendation_service_1.rankForYouVideos)(videos, undefined, recommendationNow).map(({ id }) => id), ['popular', 'newer', 'older']);
});
(0, node_test_1.test)('For You personalizes with meaningful watch and engagement activity', () => {
    const videos = [
        recommendationVideo('unrelated', { category: 'SPORTS', tags: ['football'] }),
        recommendationVideo('watch-match', { category: 'MUSIC', tags: ['acoustic'] }),
        recommendationVideo('tag-match', { category: 'SPORTS', tags: ['acoustic'] }),
    ];
    const activity = {
        ...activityFor(),
        likes: [{
                videoId: 'liked-video',
                category: 'MUSIC',
                tags: ['acoustic'],
                channelId: 'liked-channel',
                isDislike: false,
                createdAt: recommendationNow,
            }],
        comments: [{
                category: 'MUSIC',
                tags: ['acoustic'],
                channelId: 'comment-channel',
                createdAt: recommendationNow,
            }],
    };
    const ranked = (0, recommendation_service_1.rankForYouVideos)(videos, activity, recommendationNow);
    strict_1.default.equal(ranked[0].id, 'watch-match');
    strict_1.default.ok(ranked.findIndex(({ id }) => id === 'tag-match') < ranked.findIndex(({ id }) => id === 'unrelated'));
});
(0, node_test_1.test)('For You reduces recommendations matching the viewer’s recorded dislikes', () => {
    const disliked = Array.from({ length: 5 }, (_, index) => ({
        videoId: `disliked-${index}`,
        category: 'MUSIC',
        tags: ['acoustic'],
        channelId: `disliked-channel-${index}`,
        isDislike: true,
        createdAt: recommendationNow,
    }));
    const ranked = (0, recommendation_service_1.rankForYouVideos)([
        recommendationVideo('disliked-topic', { category: 'MUSIC', tags: ['acoustic'] }),
        recommendationVideo('other-topic', { category: 'SPORTS', tags: ['football'] }),
    ], { likes: disliked }, recommendationNow);
    strict_1.default.deepEqual(ranked.map(({ id }) => id), ['other-topic', 'disliked-topic']);
});
(0, node_test_1.test)('For You gives recent activity more influence and favors recent candidates', () => {
    const recent = new Date('2026-11-20T12:00:00.000Z');
    const old = new Date('2026-06-01T12:00:00.000Z');
    const candidates = [
        recommendationVideo('new-relevant', { category: 'MUSIC', publishedAt: recent }),
        recommendationVideo('old-relevant', { category: 'MUSIC', publishedAt: old }),
        recommendationVideo('new-other', { category: 'SPORTS', publishedAt: recent }),
    ];
    const oldActivity = activityFor('MUSIC', ['acoustic']);
    oldActivity.watchHistory[0].updatedAt = old;
    const recentActivity = activityFor('SPORTS', ['football']);
    strict_1.default.equal((0, recommendation_service_1.rankForYouVideos)(candidates, oldActivity, recommendationNow)[0].id, 'new-relevant');
    strict_1.default.equal((0, recommendation_service_1.rankForYouVideos)(candidates, recentActivity, recommendationNow)[0].id, 'new-other');
});
(0, node_test_1.test)('For You suppresses recent repeats without permanently excluding watched videos', () => {
    const recentHistory = {
        videoId: 'watched',
        category: 'MUSIC',
        tags: ['acoustic'],
        channelId: 'watched-channel',
        completed: true,
        lastPositionSeconds: 120,
        updatedAt: recommendationNow,
    };
    const candidates = [
        recommendationVideo('watched', { category: 'MUSIC', tags: ['acoustic'] }),
        recommendationVideo('unwatched', { category: 'MUSIC', tags: ['acoustic'] }),
    ];
    const ranked = (0, recommendation_service_1.rankForYouVideos)(candidates, { watchHistory: [recentHistory] }, recommendationNow);
    strict_1.default.deepEqual(ranked.map(({ id }) => id), ['unwatched', 'watched']);
    strict_1.default.equal(ranked.some(({ id }) => id === 'watched'), true);
    const agedHistory = { ...recentHistory, updatedAt: new Date('2026-10-01T00:00:00.000Z') };
    const aged = (0, recommendation_service_1.rankForYouVideos)(candidates, { watchHistory: [agedHistory] }, recommendationNow);
    strict_1.default.equal(aged.some(({ id }) => id === 'watched'), true);
    strict_1.default.ok(recommendation_service_1.RECOMMENDATION_CONFIG.watchedSuppression.olderMultiplier > 0);
});
(0, node_test_1.test)('For You removes duplicate candidate ids and keeps equal-score ordering stable', () => {
    const input = [
        recommendationVideo('b'),
        recommendationVideo('a'),
        recommendationVideo('a', { title: 'duplicate record' }),
    ];
    const ranked = (0, recommendation_service_1.rankForYouVideos)(input, {}, recommendationNow);
    strict_1.default.deepEqual(ranked.map(({ id }) => id), ['a', 'b']);
    strict_1.default.equal(ranked.find(({ id }) => id === 'a')?.title, 'a');
});
(0, node_test_1.test)('For You balances creators while preserving the ordered candidate set', () => {
    const candidates = [
        ...Array.from({ length: 8 }, (_, index) => recommendationVideo(`first-${index}`, {
            channelId: 'creator-a',
            category: 'MUSIC',
            viewsCount: 100 - index,
        })),
        ...Array.from({ length: 8 }, (_, index) => recommendationVideo(`second-${index}`, {
            channelId: 'creator-b',
            category: 'MUSIC',
            viewsCount: 80 - index,
        })),
        ...Array.from({ length: 8 }, (_, index) => recommendationVideo(`third-${index}`, {
            channelId: 'creator-c',
            category: 'MUSIC',
            viewsCount: 60 - index,
        })),
    ];
    const ranked = (0, recommendation_service_1.rankForYouVideos)(candidates, {}, recommendationNow);
    const creatorCap = Math.max(recommendation_service_1.RECOMMENDATION_CONFIG.creatorDiversity.maxPerWindow, Math.ceil(recommendation_service_1.RECOMMENDATION_CONFIG.creatorDiversity.windowSize
        / new Set(candidates.map(({ channelId }) => channelId)).size));
    strict_1.default.equal(new Set(ranked.map(({ id }) => id)).size, candidates.length);
    for (let start = 0; start + recommendation_service_1.RECOMMENDATION_CONFIG.creatorDiversity.windowSize <= ranked.length; start += 1) {
        const window = ranked.slice(start, start + recommendation_service_1.RECOMMENDATION_CONFIG.creatorDiversity.windowSize);
        const counts = new Map();
        for (const candidate of window) {
            counts.set(candidate.channelId, (counts.get(candidate.channelId) ?? 0) + 1);
        }
        strict_1.default.ok([...counts.values()].every((count) => count <= creatorCap));
    }
});
(0, node_test_1.test)('For You query uses eligible public projections and scopes every private signal to the viewer', () => {
    const candidateQuery = (0, recommendation_service_1.buildRecommendationCandidateQuery)();
    strict_1.default.deepEqual(candidateQuery.where, {
        status: { in: ['READY', 'PUBLISHED'] },
        visibility: 'PUBLIC',
        isShort: false,
        copyrightReviewStatus: { not: 'BLOCKED' },
        channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
    });
    strict_1.default.deepEqual(candidateQuery.select, {
        id: true,
        isShort: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        duration: true,
        viewsCount: true,
        createdAt: true,
        publishedAt: true,
        channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
        channelId: true,
        category: true,
        tags: true,
    });
    const queries = (0, recommendation_service_1.buildViewerActivityQueries)(USER_ID);
    for (const query of [queries.watchHistory, queries.likes, queries.comments, queries.validViews]) {
        strict_1.default.deepEqual(query.where.userId, USER_ID);
        strict_1.default.deepEqual(query.where.video, { is: candidateQuery.where });
    }
    strict_1.default.equal(queries.validViews.where.isValidView, true);
    strict_1.default.equal(queries.subscriptions.where.subscriberId, USER_ID);
});
(0, node_test_1.test)('For You service supports pagination, signed-out discovery, empty pools, and incomplete activity', async () => {
    const candidates = [
        recommendationVideo('page-a', { publishedAt: new Date('2026-11-21T11:00:00.000Z') }),
        recommendationVideo('page-b', { publishedAt: new Date('2026-11-21T10:00:00.000Z') }),
        recommendationVideo('page-c', { publishedAt: new Date('2026-11-21T09:00:00.000Z') }),
    ];
    let activityRequests = 0;
    const service = (0, recommendation_service_1.createForYouService)({
        async findCandidates() {
            return candidates;
        },
        async findViewerActivity(userId) {
            activityRequests += 1;
            strict_1.default.equal(userId, USER_ID);
            return { watchHistory: undefined, likes: [], comments: [] };
        },
    }, () => recommendationNow);
    const first = await service({ page: 1, limit: 2 });
    const second = await service({ page: 2, limit: 2 });
    strict_1.default.deepEqual(first.videos.map(({ id }) => id), ['page-a', 'page-b']);
    strict_1.default.deepEqual(second.videos.map(({ id }) => id), ['page-c']);
    strict_1.default.equal(new Set([...first.videos, ...second.videos].map(({ id }) => id)).size, 3);
    strict_1.default.equal(first.pagination.hasMore, true);
    strict_1.default.equal(second.pagination.hasMore, false);
    strict_1.default.equal(first.strategy, 'discovery');
    strict_1.default.equal(activityRequests, 0);
    strict_1.default.equal('category' in first.videos[0], false);
    strict_1.default.equal('tags' in first.videos[0], false);
    strict_1.default.equal('channelId' in first.videos[0], false);
    const personalized = await service({ userId: USER_ID, page: 1, limit: 2 });
    strict_1.default.equal(personalized.strategy, 'discovery');
    strict_1.default.equal(activityRequests, 1);
    const emptyService = (0, recommendation_service_1.createForYouService)({
        async findCandidates() {
            return [];
        },
        async findViewerActivity() {
            return {};
        },
    }, () => recommendationNow);
    const empty = await emptyService({ page: 1, limit: 12 });
    strict_1.default.deepEqual(empty.videos, []);
    strict_1.default.equal(empty.pagination.hasMore, false);
});
(0, node_test_1.test)('For You route permits signed-out discovery, personalizes a valid viewer, and rejects invalid credentials', async () => {
    let receivedUserId;
    const service = (0, recommendation_service_1.createForYouService)({
        async findCandidates() {
            return [recommendationVideo('public-candidate')];
        },
        async findViewerActivity(userId) {
            receivedUserId = userId;
            return activityFor();
        },
    }, () => recommendationNow);
    const app = (0, express_1.default)();
    app.use('/api/v1/feed', (0, feed_route_1.createFeedRouter)(async () => [], async () => [], async () => [], service, (0, auth_1.createOptionalAuthenticate)(async (id) => ({
        id,
        role: 'VIEWER',
        status: 'GOOD_STANDING',
    }))));
    const baseUrl = await startServer(app);
    const signedOut = await fetch(`${baseUrl}/api/v1/feed/for-you`);
    strict_1.default.equal(signedOut.status, 200);
    strict_1.default.equal((await signedOut.json()).strategy, 'discovery');
    strict_1.default.equal(receivedUserId, undefined);
    const signedIn = await fetch(`${baseUrl}/api/v1/feed/for-you`, {
        headers: { authorization: `Bearer ${token}` },
    });
    strict_1.default.equal(signedIn.status, 200);
    strict_1.default.equal((await signedIn.json()).strategy, 'personalized');
    strict_1.default.equal(receivedUserId, USER_ID);
    const invalidToken = await fetch(`${baseUrl}/api/v1/feed/for-you`, {
        headers: { authorization: 'Bearer invalid-token' },
    });
    strict_1.default.equal(invalidToken.status, 401);
});
