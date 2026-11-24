import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import IORedis from 'ioredis';
import { afterEach, test } from 'node:test';
import { resolveAdsTrackingSecret } from '../src/config/ads';
import {
  createAdDecisionRouter,
  createAdEventRouter,
} from '../src/routes/monetization.route';
import {
  AdDecisionEngine,
  FailClosedAdTelemetryNonceStore,
  IAdProviderAdapter,
  IAdTelemetryNonceStore,
  InMemoryAdTelemetryNonceStore,
  IRedisClientLike,
  RedisAdTelemetryNonceStore,
  resolveAdTelemetryNonceStore,
  signAdToken,
  VastAdProviderAdapter,
  verifyAdToken,
  verifyAdTokenBinding,
} from '../src/services/advertising';

const TEST_ADS_SECRET = 'test-distributed-ads-secret-key-32-chars-minimum';
const TEST_JWT_SECRET = 'test-separate-jwt-auth-secret-key-32-chars-min';
const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const activeServers: Server[] = [];

function createTestDb(options: { failAdEventCreate?: boolean; wrongChannel?: boolean } = {}) {
  const createdEvents: any[] = [];
  const client = {
    video: {
      async findUnique({ where }: any) {
        if (where.id !== VIDEO_ID) return null;
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
      async create({ data }: any) {
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

async function startHttpApp(options: {
  nonceStore?: IAdTelemetryNonceStore;
  redisClient?: IRedisClientLike;
  prismaClient?: any;
  engine?: AdDecisionEngine;
}) {
  const app = express();
  app.use(express.json());
  const authMiddleware: RequestHandler = (req, _res, next) => {
    (req as any).user = { id: '44444444-4444-4444-8444-444444444444', role: 'USER' };
    next();
  };

  app.use(
    '/api/v1/monetization',
    createAdDecisionRouter({
      engine: options.engine,
      prismaClient: options.prismaClient,
      secret: TEST_ADS_SECRET,
    })
  );
  app.use(
    '/api/v1/monetization',
    createAdEventRouter(authMiddleware, {
      nonceStore: options.nonceStore,
      redisClient: options.redisClient,
      secret: TEST_ADS_SECRET,
      prismaClient: options.prismaClient,
    })
  );

  const server = createServer(app);
  activeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      const idx = activeServers.indexOf(server);
      if (idx >= 0) activeServers.splice(idx, 1);
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
  };
}

async function connectLocalRedisIfAvailable(): Promise<IORedis | null> {
  const redis = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    connectTimeout: 1200,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong === 'PONG') return redis;
  } catch {
    // Redis unavailable in this test host
  }
  redis.disconnect();
  return null;
}

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

test('ADS_TRACKING_SECRET enforces cryptographic separation from JWT_SECRET and rejects insecure values', () => {
  assert.throws(
    () =>
      resolveAdsTrackingSecret({
        nodeEnv: 'production',
        secret: TEST_JWT_SECRET,
        jwtSecret: TEST_JWT_SECRET,
      }),
    /must be distinct from JWT_SECRET/
  );
  assert.throws(
    () =>
      resolveAdsTrackingSecret({
        nodeEnv: 'production',
        secret: 'short',
        jwtSecret: TEST_JWT_SECRET,
      }),
    /at least 32 characters/
  );
  assert.throws(
    () =>
      resolveAdsTrackingSecret({
        nodeEnv: 'production',
        secret: '',
        jwtSecret: TEST_JWT_SECRET,
      }),
    /ADS_TRACKING_SECRET environment variable is missing/
  );
  assert.equal(
    resolveAdsTrackingSecret({
      nodeEnv: 'production',
      secret: TEST_ADS_SECRET,
      jwtSecret: TEST_JWT_SECRET,
    }),
    TEST_ADS_SECRET
  );
});

test('resolveAdTelemetryNonceStore never silently falls back to in-memory outside test mode', async () => {
  const prodStore = resolveAdTelemetryNonceStore({ nodeEnv: 'production' });
  assert.ok(prodStore instanceof FailClosedAdTelemetryNonceStore);
  const res = await prodStore.consumeEvent('sess-1', 'AD_IMPRESSION', Date.now() + 60000);
  assert.equal(res.success, false);
  assert.equal(res.reason, 'PERSISTENCE_UNAVAILABLE');
});

test('valid full lifecycle event sequence succeeds and persists distinct non-lossy events', async () => {
  const { client, createdEvents } = createTestDb();
  const nonceStore = new InMemoryAdTelemetryNonceStore();
  const app = await startHttpApp({ nonceStore, prismaClient: client });

  const decRes = await fetch(`${app.baseUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ placement: 'PRE_ROLL', videoId: VIDEO_ID }),
  });
  assert.equal(decRes.status, 200);
  const dec = await decRes.json();
  assert.equal(dec.decision, 'SERVE');
  assert.ok(dec.decisionId);
  assert.ok(dec.sessionId);

  const sequence = [
    'AD_LOADED',
    'AD_IMPRESSION',
    'AD_VIEWABLE',
    'AD_FIRST_QUARTILE',
    'AD_MIDPOINT',
    'AD_THIRD_QUARTILE',
    'AD_CLICK',
    'AD_COMPLETED',
  ] as const;

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
    assert.equal(res.status, 200, `Expected ${eventType} to succeed`);
  }

  // First event is server-side AD_SERVED from /decision, plus 8 distinct telemetry events
  assert.equal(createdEvents.length, 9);
  assert.equal(createdEvents[0].eventType, 'AD_SERVED');
  assert.deepEqual(
    createdEvents.slice(1).map((e) => e.eventType),
    [...sequence]
  );
  assert.ok(createdEvents.every((e) => e.grossRevenueCents === 0n));
});

test('enforces strict lifecycle event ordering and rejects out-of-order sequences', async () => {
  const { client } = createTestDb();
  const nonceStore = new InMemoryAdTelemetryNonceStore();
  const app = await startHttpApp({ nonceStore, prismaClient: client });

  const makeToken = (id: string) =>
    signAdToken(
      {
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
      },
      TEST_ADS_SECRET
    );

  // 1. Cannot record AD_COMPLETED before AD_IMPRESSION / quartiles
  const prematureComplete = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: makeToken('1'), eventType: 'AD_COMPLETED' }),
  });
  assert.equal(prematureComplete.status, 409);
  assert.equal((await prematureComplete.json()).code, 'INVALID_EVENT_SEQUENCE');

  // 2. Cannot record AD_CLICK or AD_VIEWABLE before AD_IMPRESSION
  const clickBeforeImp = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: makeToken('2'), eventType: 'AD_CLICK' }),
  });
  assert.equal(clickBeforeImp.status, 409);
  assert.equal((await clickBeforeImp.json()).code, 'INVALID_EVENT_SEQUENCE');

  const viewableBeforeImp = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: makeToken('2b'), eventType: 'AD_VIEWABLE' }),
  });
  assert.equal(viewableBeforeImp.status, 409);
  assert.equal((await viewableBeforeImp.json()).code, 'INVALID_EVENT_SEQUENCE');

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
  assert.equal(skipQuartile.status, 409);
  assert.equal((await skipQuartile.json()).code, 'INVALID_EVENT_SEQUENCE');

  // 4. Cannot send AD_LOADED after AD_IMPRESSION
  const lateLoaded = await fetch(`${app.baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tok3, eventType: 'AD_LOADED' }),
  });
  assert.equal(lateLoaded.status, 409);
  assert.equal((await lateLoaded.json()).code, 'INVALID_EVENT_SEQUENCE');
});

test('rejects invalid token binding across decision, session, video, placement, and provider', async () => {
  const { client } = createTestDb();
  const nonceStore = new InMemoryAdTelemetryNonceStore();
  const app = await startHttpApp({ nonceStore, prismaClient: client });

  const payload = {
    decisionId: 'dec-bind-1',
    sessionId: 'sess-bind-1',
    placement: 'PRE_ROLL' as const,
    provider: 'Adsterra VAST',
    providerId: 'prov-vast-1',
    adId: 'ad-bind-1',
    videoId: VIDEO_ID,
    channelId: CHANNEL_ID,
    v: 2,
    timestamp: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  const token = signAdToken(payload, TEST_ADS_SECRET);

  // Unit binding checks
  assert.equal(verifyAdTokenBinding(payload, { videoId: 'other-vid' }).valid, false);
  assert.equal(verifyAdTokenBinding(payload, { placement: 'MID_ROLL' }).valid, false);
  assert.equal(verifyAdTokenBinding(payload, { provider: 'Other Network' }).valid, false);
  assert.equal(verifyAdTokenBinding(payload, { decisionId: 'other-dec' }).valid, false);
  assert.equal(verifyAdTokenBinding(payload, { sessionId: 'other-sess' }).valid, false);

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
  assert.equal(badVideo.status, 400);
  assert.equal((await badVideo.json()).code, 'TOKEN_BINDING_MISMATCH');
  assert.equal(nonceStore.isEventConsumed('sess-bind-1', 'AD_IMPRESSION'), false);

  // DB channel mismatch check
  const wrongChannelDb = createTestDb({ wrongChannel: true });
  const app2 = await startHttpApp({ nonceStore, prismaClient: wrongChannelDb.client });
  const badChannelRes = await fetch(`${app2.baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
  });
  assert.equal(badChannelRes.status, 400);
  assert.equal((await badChannelRes.json()).code, 'TOKEN_BINDING_MISMATCH');
});

test('persistence failure (Redis unavailable or DB failure) returns 503 and creates zero attribution', async () => {
  // 1. Failing Redis client
  const brokenRedis: IRedisClientLike = {
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

  const token = signAdToken(
    {
      decisionId: 'dec-fail-1',
      sessionId: 'sess-fail-1',
      placement: 'PRE_ROLL',
      provider: 'Adsterra VAST',
      adId: 'ad-1',
      videoId: VIDEO_ID,
      channelId: CHANNEL_ID,
      timestamp: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    TEST_ADS_SECRET
  );

  const redisFailRes = await fetch(`${appRedisDown.baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
  });
  assert.equal(redisFailRes.status, 503);
  assert.equal((await redisFailRes.json()).code, 'PERSISTENCE_UNAVAILABLE');

  // 2. Failing Postgres adEvent.create rolls back nonce and returns 503 (never lies with 200 OK)
  const failingDb = createTestDb({ failAdEventCreate: true });
  const nonceStore = new InMemoryAdTelemetryNonceStore();
  const appDbDown = await startHttpApp({ nonceStore, prismaClient: failingDb.client });

  const dbFailRes = await fetch(`${appDbDown.baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
  });
  assert.equal(dbFailRes.status, 503);
  assert.equal((await dbFailRes.json()).code, 'PERSISTENCE_ERROR');
  assert.equal(failingDb.createdEvents.length, 0);
  assert.equal(nonceStore.isEventConsumed('sess-fail-1', 'AD_IMPRESSION'), false);
});

test('AdDecisionEngine handles provider timeout cleanly and fails open with NO_FILL', async () => {
  const engine = new AdDecisionEngine({ tokenSecret: TEST_ADS_SECRET, timeoutMs: 40 });
  const slowProvider: IAdProviderAdapter = {
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
  assert.equal(result.decision, 'NO_FILL');
  assert.equal(result.fallbackAction, 'FAIL_OPEN');

  // Fallback to secondary provider after primary times out
  const backup = new VastAdProviderAdapter('backup-1', 'Backup VAST');
  engine.registerProvider(backup, 2, true, { vastTagUrl: 'https://backup.example/vast' });
  const recovered = await engine.decide({ placement: 'PRE_ROLL', videoId: VIDEO_ID });
  assert.equal(recovered.decision, 'SERVE');
  assert.equal(recovered.provider, 'Backup VAST');
  assert.ok(verifyAdToken(recovered.trackingToken!, TEST_ADS_SECRET));
});

test('Real Redis distributed replay defense: multi-instance concurrent requests and process restart', async (t) => {
  const redisProbe = await connectLocalRedisIfAvailable();
  if (!redisProbe) {
    t.skip('Local Redis server unavailable on 127.0.0.1:6379');
    return;
  }

  const testPrefix = `test:wsb:ad:replay:${crypto.randomUUID()}:`;
  const { client: dbA, createdEvents: eventsA } = createTestDb();
  const { client: dbB, createdEvents: eventsB } = createTestDb();

  const redisA = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
  const redisB = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });

  const storeA = new RedisAdTelemetryNonceStore(redisA, testPrefix);
  const storeB = new RedisAdTelemetryNonceStore(redisB, testPrefix);

  const instanceA = await startHttpApp({ nonceStore: storeA, prismaClient: dbA });
  const instanceB = await startHttpApp({ nonceStore: storeB, prismaClient: dbB });

  try {
    const token = signAdToken(
      {
        decisionId: `dec-redis-${crypto.randomUUID()}`,
        sessionId: `sess-redis-${crypto.randomUUID()}`,
        placement: 'PRE_ROLL',
        provider: 'Adsterra VAST',
        adId: 'ad-redis-1',
        videoId: VIDEO_ID,
        channelId: CHANNEL_ID,
        v: 2,
        timestamp: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      TEST_ADS_SECRET
    );

    // 1. Concurrent identical impression requests split across TWO distinct API server instances
    const concurrentCalls = [
      ...Array.from({ length: 4 }, () =>
        fetch(`${instanceA.baseUrl}/api/v1/monetization/ad-event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
        })
      ),
      ...Array.from({ length: 4 }, () =>
        fetch(`${instanceB.baseUrl}/api/v1/monetization/ad-event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
        })
      ),
    ];

    const responses = await Promise.all(concurrentCalls);
    const statuses = responses.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 200).length, 1, 'Exactly 1 instance must win atomic Redis SET NX EX');
    assert.equal(statuses.filter((s) => s === 409).length, 7, 'All 7 concurrent cross-instance replays must get 409');
    assert.equal(eventsA.length + eventsB.length, 1);

    // 2. Simulate full API process restart: close instanceA/B & their Redis connections,
    //    then spin up a brand new instanceC with a fresh Redis connection!
    await instanceA.close();
    await instanceB.close();
    await redisA.quit();
    await redisB.quit();

    const redisC = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
    const storeC = new RedisAdTelemetryNonceStore(redisC, testPrefix);
    const { client: dbC, createdEvents: eventsC } = createTestDb();
    const instanceC = await startHttpApp({ nonceStore: storeC, prismaClient: dbC });

    try {
      // Replaying AD_IMPRESSION after process restart MUST STILL fail with 409
      const replayAfterRestart = await fetch(`${instanceC.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
      });
      assert.equal(replayAfterRestart.status, 409);
      assert.equal((await replayAfterRestart.json()).code, 'DUPLICATE_IMPRESSION');
      assert.equal(eventsC.length, 0);

      // Valid next lifecycle event (AD_VIEWABLE) after restart succeeds because session state persisted in Redis
      const viewableAfterRestart = await fetch(`${instanceC.baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_VIEWABLE' }),
      });
      assert.equal(viewableAfterRestart.status, 200);
      assert.equal(eventsC.length, 1);
      assert.equal(eventsC[0].eventType, 'AD_VIEWABLE');
    } finally {
      await instanceC.close();
      await storeC.clear();
      await redisC.quit();
    }
  } finally {
    await redisProbe.quit();
  }
});
