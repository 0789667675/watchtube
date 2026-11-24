"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const ioredis_1 = __importDefault(require("ioredis"));
const node_test_1 = require("node:test");
const ads_1 = require("../src/config/ads");
const monetization_route_1 = require("../src/routes/monetization.route");
const advertising_1 = require("../src/services/advertising");
const TEST_ADS_SECRET = 'test-distributed-ads-secret-key-32-chars-minimum';
const TEST_JWT_SECRET = 'test-separate-jwt-auth-secret-key-32-chars-min';
const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const activeServers = [];
function createTestDb(options = {}) {
    const createdEvents = [];
    const client = {
        video: {
            async findUnique({ where }) {
                if (where.id !== VIDEO_ID)
                    return null;
                return {
                    id: VIDEO_ID,
                    title: 'Distributed Ad Test Video',
                    status: 'PUBLISHED',
                    visibility: 'PUBLIC',
                    isShort: false,
                    duration: 180,
                    copyrightReviewStatus: 'CLEARED',
                    channel: {
                        id: options.wrongChannel ? '99999999-9999-4999-8999-999999999999' : CHANNEL_ID,
                        isMonetized: true,
                        user: { id: '33333333-3333-4333-8333-333333333333', status: 'GOOD_STANDING', strikes: [] },
                    },
                };
            },
        },
        adProviderConfig: {
            async findMany() {
                return [
                    {
                        id: 'prov-vast-1',
                        name: 'Adsterra VAST',
                        vastTagUrl: 'https://ads.example/vast?t=[timestamp]',
                        priority: 1,
                        isEnabled: true,
                        format: 'PRE_ROLL',
                    },
                ];
            },
        },
        adEvent: {
            async create({ data }) {
                if (options.failAdEventCreate) {
                    throw new Error('ECONNREFUSED: PostgreSQL unavailable');
                }
                createdEvents.push(data);
                return { id: `ad-ev-${createdEvents.length}`, ...data };
            },
        },
    };
    return { client, createdEvents };
}
async function startHttpApp(options) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authMiddleware = (req, _res, next) => {
        req.user = { id: '44444444-4444-4444-8444-444444444444', role: 'USER' };
        next();
    };
    app.use('/api/v1/monetization', (0, monetization_route_1.createAdDecisionRouter)({
        engine: options.engine,
        prismaClient: options.prismaClient,
        secret: TEST_ADS_SECRET,
    }));
    app.use('/api/v1/monetization', (0, monetization_route_1.createAdEventRouter)(authMiddleware, {
        nonceStore: options.nonceStore,
        redisClient: options.redisClient,
        secret: TEST_ADS_SECRET,
        prismaClient: options.prismaClient,
    }));
    const server = (0, node_http_1.createServer)(app);
    activeServers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        async close() {
            const idx = activeServers.indexOf(server);
            if (idx >= 0)
                activeServers.splice(idx, 1);
            await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
        },
    };
}
async function connectLocalRedisIfAvailable() {
    const redis = new ioredis_1.default({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        connectTimeout: 1200,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: true,
    });
    redis.on('error', () => { });
    try {
        await redis.connect();
        const pong = await redis.ping();
        if (pong === 'PONG')
            return redis;
    }
    catch {
        // Redis unavailable in this test host
    }
    redis.disconnect();
    return null;
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.splice(0).map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
});
(0, node_test_1.test)('ADS_TRACKING_SECRET enforces cryptographic separation from JWT_SECRET and rejects insecure values', () => {
    strict_1.default.throws(() => (0, ads_1.resolveAdsTrackingSecret)({
        nodeEnv: 'production',
        secret: TEST_JWT_SECRET,
        jwtSecret: TEST_JWT_SECRET,
    }), /must be distinct from JWT_SECRET/);
    strict_1.default.throws(() => (0, ads_1.resolveAdsTrackingSecret)({
        nodeEnv: 'production',
        secret: 'short',
        jwtSecret: TEST_JWT_SECRET,
    }), /at least 32 characters/);
    strict_1.default.throws(() => (0, ads_1.resolveAdsTrackingSecret)({
        nodeEnv: 'production',
        secret: '',
        jwtSecret: TEST_JWT_SECRET,
    }), /ADS_TRACKING_SECRET environment variable is missing/);
    strict_1.default.equal((0, ads_1.resolveAdsTrackingSecret)({
        nodeEnv: 'production',
        secret: TEST_ADS_SECRET,
        jwtSecret: TEST_JWT_SECRET,
    }), TEST_ADS_SECRET);
});
(0, node_test_1.test)('resolveAdTelemetryNonceStore never silently falls back to in-memory outside test mode', async () => {
    const prodStore = (0, advertising_1.resolveAdTelemetryNonceStore)({ nodeEnv: 'production' });
    strict_1.default.ok(prodStore instanceof advertising_1.FailClosedAdTelemetryNonceStore);
    const res = await prodStore.consumeEvent('sess-1', 'AD_IMPRESSION', Date.now() + 60000);
    strict_1.default.equal(res.success, false);
    strict_1.default.equal(res.reason, 'PERSISTENCE_UNAVAILABLE');
});
(0, node_test_1.test)('valid full lifecycle event sequence succeeds and persists distinct non-lossy events', async () => {
    const { client, createdEvents } = createTestDb();
    const nonceStore = new advertising_1.InMemoryAdTelemetryNonceStore();
    const app = await startHttpApp({ nonceStore, prismaClient: client });
    const decRes = await fetch(`${app.baseUrl}/api/v1/monetization/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ placement: 'PRE_ROLL', videoId: VIDEO_ID }),
    });
    strict_1.default.equal(decRes.status, 200);
    const dec = await decRes.json();
    strict_1.default.equal(dec.decision, 'SERVE');
    strict_1.default.ok(dec.decisionId);
    strict_1.default.ok(dec.sessionId);
    const sequence = [
        'AD_LOADED',
        'AD_IMPRESSION',
        'AD_VIEWABLE',
        'AD_FIRST_QUARTILE',
        'AD_MIDPOINT',
        'AD_THIRD_QUARTILE',
        'AD_CLICK',
        'AD_COMPLETED',
    ];
    for (const eventType of sequence) {
        const res = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                token: dec.trackingToken,
                eventType,
                decisionId: dec.decisionId,
                sessionId: dec.sessionId,
                videoId: VIDEO_ID,
                channelId: CHANNEL_ID,
                placement: 'PRE_ROLL',
                provider: dec.provider,
                adId: dec.adId,
            }),
        });
        strict_1.default.equal(res.status, 200, `Expected ${eventType} to succeed`);
    }
    // First event is server-side AD_SERVED from /decision, plus 8 distinct telemetry events
    strict_1.default.equal(createdEvents.length, 9);
    strict_1.default.equal(createdEvents[0].eventType, 'AD_SERVED');
    strict_1.default.deepEqual(createdEvents.slice(1).map((e) => e.eventType), [...sequence]);
    strict_1.default.ok(createdEvents.every((e) => e.grossRevenueCents === 0n));
});
(0, node_test_1.test)('enforces strict lifecycle event ordering and rejects out-of-order sequences', async () => {
    const { client } = createTestDb();
    const nonceStore = new advertising_1.InMemoryAdTelemetryNonceStore();
    const app = await startHttpApp({ nonceStore, prismaClient: client });
    const makeToken = (id) => (0, advertising_1.signAdToken)({
        decisionId: `dec-${id}`,
        sessionId: `sess-order-${id}`,
        placement: 'PRE_ROLL',
        provider: 'Adsterra VAST',
        adId: 'ad-1',
        videoId: VIDEO_ID,
        channelId: CHANNEL_ID,
        v: 2,
        timestamp: Date.now(),
        expiresAt: Date.now() + 60_000,
    }, TEST_ADS_SECRET);
    // 1. Cannot record AD_COMPLETED before AD_IMPRESSION / quartiles
    const prematureComplete = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: makeToken('1'), eventType: 'AD_COMPLETED' }),
    });
    strict_1.default.equal(prematureComplete.status, 409);
    strict_1.default.equal((await prematureComplete.json()).code, 'INVALID_EVENT_SEQUENCE');
    // 2. Cannot record AD_CLICK or AD_VIEWABLE before AD_IMPRESSION
    const clickBeforeImp = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: makeToken('2'), eventType: 'AD_CLICK' }),
    });
    strict_1.default.equal(clickBeforeImp.status, 409);
    strict_1.default.equal((await clickBeforeImp.json()).code, 'INVALID_EVENT_SEQUENCE');
    const viewableBeforeImp = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: makeToken('2b'), eventType: 'AD_VIEWABLE' }),
    });
    strict_1.default.equal(viewableBeforeImp.status, 409);
    strict_1.default.equal((await viewableBeforeImp.json()).code, 'INVALID_EVENT_SEQUENCE');
    // 3. Cannot jump from AD_IMPRESSION directly to AD_MIDPOINT skipping AD_FIRST_QUARTILE
    const tok3 = makeToken('3');
    await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tok3, eventType: 'AD_IMPRESSION' }),
    });
    const skipQuartile = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tok3, eventType: 'AD_MIDPOINT' }),
    });
    strict_1.default.equal(skipQuartile.status, 409);
    strict_1.default.equal((await skipQuartile.json()).code, 'INVALID_EVENT_SEQUENCE');
    // 4. Cannot send AD_LOADED after AD_IMPRESSION
    const lateLoaded = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tok3, eventType: 'AD_LOADED' }),
    });
    strict_1.default.equal(lateLoaded.status, 409);
    strict_1.default.equal((await lateLoaded.json()).code, 'INVALID_EVENT_SEQUENCE');
});
(0, node_test_1.test)('rejects invalid token binding across decision, session, video, placement, and provider', async () => {
    const { client } = createTestDb();
    const nonceStore = new advertising_1.InMemoryAdTelemetryNonceStore();
    const app = await startHttpApp({ nonceStore, prismaClient: client });
    const payload = {
        decisionId: 'dec-bind-1',
        sessionId: 'sess-bind-1',
        placement: 'PRE_ROLL',
        provider: 'Adsterra VAST',
        providerId: 'prov-vast-1',
        adId: 'ad-bind-1',
        videoId: VIDEO_ID,
        channelId: CHANNEL_ID,
        v: 2,
        timestamp: Date.now(),
        expiresAt: Date.now() + 60_000,
    };
    const token = (0, advertising_1.signAdToken)(payload, TEST_ADS_SECRET);
    // Unit binding checks
    strict_1.default.equal((0, advertising_1.verifyAdTokenBinding)(payload, { videoId: 'other-vid' }).valid, false);
    strict_1.default.equal((0, advertising_1.verifyAdTokenBinding)(payload, { placement: 'MID_ROLL' }).valid, false);
    strict_1.default.equal((0, advertising_1.verifyAdTokenBinding)(payload, { provider: 'Other Network' }).valid, false);
    strict_1.default.equal((0, advertising_1.verifyAdTokenBinding)(payload, { decisionId: 'other-dec' }).valid, false);
    strict_1.default.equal((0, advertising_1.verifyAdTokenBinding)(payload, { sessionId: 'other-sess' }).valid, false);
    // HTTP binding rejection before consuming nonce
    const badVideo = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            token,
            eventType: 'AD_IMPRESSION',
            videoId: '99999999-9999-4999-8999-999999999999',
        }),
    });
    strict_1.default.equal(badVideo.status, 400);
    strict_1.default.equal((await badVideo.json()).code, 'TOKEN_BINDING_MISMATCH');
    strict_1.default.equal(nonceStore.isEventConsumed('sess-bind-1', 'AD_IMPRESSION'), false);
    // DB channel mismatch check
    const wrongChannelDb = createTestDb({ wrongChannel: true });
    const app2 = await startHttpApp({ nonceStore, prismaClient: wrongChannelDb.client });
    const badChannelRes = await fetch(`${app2.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
    });
    strict_1.default.equal(badChannelRes.status, 400);
    strict_1.default.equal((await badChannelRes.json()).code, 'TOKEN_BINDING_MISMATCH');
});
(0, node_test_1.test)('persistence failure (Redis unavailable or DB failure) returns 503 and creates zero attribution', async () => {
    // 1. Failing Redis client
    const brokenRedis = {
        async eval() {
            throw new Error('ECONNREFUSED Redis down');
        },
        async sismember() {
            throw new Error('ECONNREFUSED Redis down');
        },
        async del() {
            return 0;
        },
    };
    const { client } = createTestDb();
    const appRedisDown = await startHttpApp({
        redisClient: brokenRedis,
        prismaClient: client,
    });
    const token = (0, advertising_1.signAdToken)({
        decisionId: 'dec-fail-1',
        sessionId: 'sess-fail-1',
        placement: 'PRE_ROLL',
        provider: 'Adsterra VAST',
        adId: 'ad-1',
        videoId: VIDEO_ID,
        channelId: CHANNEL_ID,
        timestamp: Date.now(),
        expiresAt: Date.now() + 60_000,
    }, TEST_ADS_SECRET);
    const redisFailRes = await fetch(`${appRedisDown.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
    });
    strict_1.default.equal(redisFailRes.status, 503);
    strict_1.default.equal((await redisFailRes.json()).code, 'PERSISTENCE_UNAVAILABLE');
    // 2. Failing Postgres adEvent.create rolls back nonce and returns 503 (never lies with 200 OK)
    const failingDb = createTestDb({ failAdEventCreate: true });
    const nonceStore = new advertising_1.InMemoryAdTelemetryNonceStore();
    const appDbDown = await startHttpApp({ nonceStore, prismaClient: failingDb.client });
    const dbFailRes = await fetch(`${appDbDown.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
    });
    strict_1.default.equal(dbFailRes.status, 503);
    strict_1.default.equal((await dbFailRes.json()).code, 'PERSISTENCE_ERROR');
    strict_1.default.equal(failingDb.createdEvents.length, 0);
    strict_1.default.equal(nonceStore.isEventConsumed('sess-fail-1', 'AD_IMPRESSION'), false);
});
(0, node_test_1.test)('AdDecisionEngine handles provider timeout cleanly and fails open with NO_FILL', async () => {
    const engine = new advertising_1.AdDecisionEngine({ tokenSecret: TEST_ADS_SECRET, timeoutMs: 40 });
    const slowProvider = {
        id: 'slow-provider',
        name: 'Slow Provider',
        providerType: 'VAST_GENERIC',
        supportedPlacements: ['PRE_ROLL'],
        async requestAd() {
            await new Promise((resolve) => setTimeout(resolve, 250));
            return null;
        },
    };
    engine.registerProvider(slowProvider, 1, true);
    const result = await engine.decide({ placement: 'PRE_ROLL', videoId: VIDEO_ID });
    strict_1.default.equal(result.decision, 'NO_FILL');
    strict_1.default.equal(result.fallbackAction, 'FAIL_OPEN');
    // Fallback to secondary provider after primary times out
    const backup = new advertising_1.VastAdProviderAdapter('backup-1', 'Backup VAST');
    engine.registerProvider(backup, 2, true, { vastTagUrl: 'https://backup.example/vast' });
    const recovered = await engine.decide({ placement: 'PRE_ROLL', videoId: VIDEO_ID });
    strict_1.default.equal(recovered.decision, 'SERVE');
    strict_1.default.equal(recovered.provider, 'Backup VAST');
    strict_1.default.ok((0, advertising_1.verifyAdToken)(recovered.trackingToken, TEST_ADS_SECRET));
});
(0, node_test_1.test)('Real Redis distributed replay defense: multi-instance concurrent requests and process restart', async (t) => {
    const redisProbe = await connectLocalRedisIfAvailable();
    if (!redisProbe) {
        t.skip('Local Redis server unavailable on 127.0.0.1:6379');
        return;
    }
    const testPrefix = `test:wsb:ad:replay:${node_crypto_1.default.randomUUID()}:`;
    const { client: dbA, createdEvents: eventsA } = createTestDb();
    const { client: dbB, createdEvents: eventsB } = createTestDb();
    const redisA = new ioredis_1.default({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
    const redisB = new ioredis_1.default({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
    const storeA = new advertising_1.RedisAdTelemetryNonceStore(redisA, testPrefix);
    const storeB = new advertising_1.RedisAdTelemetryNonceStore(redisB, testPrefix);
    const instanceA = await startHttpApp({ nonceStore: storeA, prismaClient: dbA });
    const instanceB = await startHttpApp({ nonceStore: storeB, prismaClient: dbB });
    try {
        const token = (0, advertising_1.signAdToken)({
            decisionId: `dec-redis-${node_crypto_1.default.randomUUID()}`,
            sessionId: `sess-redis-${node_crypto_1.default.randomUUID()}`,
            placement: 'PRE_ROLL',
            provider: 'Adsterra VAST',
            adId: 'ad-redis-1',
            videoId: VIDEO_ID,
            channelId: CHANNEL_ID,
            v: 2,
            timestamp: Date.now(),
            expiresAt: Date.now() + 60_000,
        }, TEST_ADS_SECRET);
        // 1. Concurrent identical impression requests split across TWO distinct API server instances
        const concurrentCalls = [
            ...Array.from({ length: 4 }, () => fetch(`${instanceA.baseUrl}/api/v1/monetization/ad-event`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
            })),
            ...Array.from({ length: 4 }, () => fetch(`${instanceB.baseUrl}/api/v1/monetization/ad-event`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
            })),
        ];
        const responses = await Promise.all(concurrentCalls);
        const statuses = responses.map((r) => r.status);
        strict_1.default.equal(statuses.filter((s) => s === 200).length, 1, 'Exactly 1 instance must win atomic Redis SET NX EX');
        strict_1.default.equal(statuses.filter((s) => s === 409).length, 7, 'All 7 concurrent cross-instance replays must get 409');
        strict_1.default.equal(eventsA.length + eventsB.length, 1);
        // 2. Simulate full API process restart: close instanceA/B & their Redis connections,
        //    then spin up a brand new instanceC with a fresh Redis connection!
        await instanceA.close();
        await instanceB.close();
        await redisA.quit();
        await redisB.quit();
        const redisC = new ioredis_1.default({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
        const storeC = new advertising_1.RedisAdTelemetryNonceStore(redisC, testPrefix);
        const { client: dbC, createdEvents: eventsC } = createTestDb();
        const instanceC = await startHttpApp({ nonceStore: storeC, prismaClient: dbC });
        try {
            // Replaying AD_IMPRESSION after process restart MUST STILL fail with 409
            const replayAfterRestart = await fetch(`${instanceC.baseUrl}/api/v1/monetization/ad-event`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
            });
            strict_1.default.equal(replayAfterRestart.status, 409);
            strict_1.default.equal((await replayAfterRestart.json()).code, 'DUPLICATE_IMPRESSION');
            strict_1.default.equal(eventsC.length, 0);
            // Valid next lifecycle event (AD_VIEWABLE) after restart succeeds because session state persisted in Redis
            const viewableAfterRestart = await fetch(`${instanceC.baseUrl}/api/v1/monetization/ad-event`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token, eventType: 'AD_VIEWABLE' }),
            });
            strict_1.default.equal(viewableAfterRestart.status, 200);
            strict_1.default.equal(eventsC.length, 1);
            strict_1.default.equal(eventsC[0].eventType, 'AD_VIEWABLE');
        }
        finally {
            await instanceC.close();
            await storeC.clear();
            await redisC.quit();
        }
    }
    finally {
        await redisProbe.quit();
    }
});
