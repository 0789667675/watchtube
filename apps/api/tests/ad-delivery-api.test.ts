import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import {
  createAdDecisionRouter,
  createAdEventRouter,
} from '../src/routes/monetization.route';
import {
  AdDecisionEngine,
  InMemoryAdTelemetryNonceStore,
  signAdToken,
  VastAdProviderAdapter,
} from '../src/services/advertising';
import { AuthRequest } from '../src/middleware/auth';
import { requirePermission } from '../src/middleware/rbac';
import { recordAuditEvent } from '../src/services/audit.service';

const TEST_ADS_SECRET = 'test-ads-secret-key-32-chars-long-secure-key';
const TEST_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
const activeServers: Server[] = [];

function createMockPrisma(options: {
  videoExists?: boolean;
  videoStatus?: string;
  visibility?: string;
  isMonetized?: boolean;
  userStatus?: string;
  hasStrike?: boolean;
  copyrightBlocked?: boolean;
} = {}) {
  const videoExists = options.videoExists ?? true;
  const videoStatus = options.videoStatus ?? 'PUBLISHED';
  const visibility = options.visibility ?? 'PUBLIC';
  const isMonetized = options.isMonetized ?? true;
  const userStatus = options.userStatus ?? 'ACTIVE';
  const hasStrike = options.hasStrike ?? false;
  const copyrightBlocked = options.copyrightBlocked ?? false;

  const mockStrikes = hasStrike
    ? [{ id: 'strike-1', strikeType: 'MONETIZATION_HOLD', expiresAt: new Date(Date.now() + 86400000) }]
    : [];

  const createdAdEvents: any[] = [];

  const mockPrismaClient = {
    video: {
      async findUnique({ where }: any) {
        if (!videoExists || where.id === '00000000-0000-4000-8000-000000000404') {
          return null;
        }
        return {
          id: where.id,
          title: 'Test Monetized Video',
          status: videoStatus,
          visibility,
          isShort: false,
          duration: 300,
          copyrightReviewStatus: copyrightBlocked ? 'BLOCKED' : 'CLEARED',
          channel: {
            id: 'channel-uuid-1234',
            isMonetized,
            user: {
              id: 'user-uuid-5678',
              status: userStatus,
              strikes: mockStrikes,
            },
          },
        };
      },
    },
    adProviderConfig: {
      async findMany() {
        return [
          {
            id: 'adsterra-1',
            name: 'Adsterra Video Pre-Roll',
            vastTagUrl: 'https://adsterra.example/vast?t=[timestamp]',
            priority: 1,
            isEnabled: true,
            format: 'PRE_ROLL',
          },
        ];
      },
      async findUnique({ where }: any) {
        if (where.id === 'prov-1' || where.name === 'Adsterra Network') {
          return { id: 'prov-1', name: 'Adsterra Network', vastTagUrl: 'https://adsterra.example/vast', priority: 1, isEnabled: true, format: 'PRE_ROLL' };
        }
        return null;
      },
      async upsert({ create }: any) {
        return { id: 'prov-new', ...create };
      },
      async delete({ where }: any) {
        return { id: where.id, name: 'Adsterra Network' };
      },
    },
    adEvent: {
      async create({ data }: any) {
        createdAdEvents.push(data);
        return { id: `event-${createdAdEvents.length}`, ...data };
      },
    },
  };

  return { mockPrismaClient, createdAdEvents };
}

async function startAdServer(options: {
  prismaClient?: any;
  nonceStore?: InMemoryAdTelemetryNonceStore;
  engine?: AdDecisionEngine;
  secret?: string;
  role?: string;
  permissions?: string[];
} = {}) {
  const app = express();
  app.use(express.json());

  const authMiddleware: RequestHandler = (req, res, next) => {
    (req as AuthRequest).user = {
      id: TEST_ACTOR_ID,
      role: options.role || 'USER',
    };
    next();
  };

  const decisionRouter = createAdDecisionRouter({
    engine: options.engine,
    prismaClient: options.prismaClient,
    secret: options.secret || TEST_ADS_SECRET,
  });

  const eventRouter = createAdEventRouter(authMiddleware, {
    nonceStore: options.nonceStore,
    secret: options.secret || TEST_ADS_SECRET,
    prismaClient: options.prismaClient,
  });

  app.use('/api/v1/monetization', decisionRouter);
  app.use('/api/v1/monetization', eventRouter);

  // Admin provider routes for authorization test
  const adminRouter = express.Router();
  adminRouter.use(authMiddleware);

  adminRouter.get(
    '/providers',
    requirePermission('monetization.manage_providers'),
    async (_req, res) => {
      const providers = await options.prismaClient?.adProviderConfig?.findMany();
      res.status(200).json(providers || []);
    }
  );

  adminRouter.post(
    '/providers',
    requirePermission('monetization.manage_providers'),
    async (req, res) => {
      res.status(200).json({ success: true, created: req.body });
    }
  );

  app.use('/api/v1/admin/monetization', adminRouter);

  const server = createServer(app);
  activeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
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

// ==============================================================================
// 1. AD DECISION API TESTS
// ==============================================================================

test('POST /decision returns SERVE with valid VAST config and signed tracking token for monetized video', async () => {
  const { mockPrismaClient } = createMockPrisma();
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const response = await fetch(`${baseUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      placement: 'PRE_ROLL',
      videoId: '11111111-1111-4111-8111-111111111111',
    }),
  });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.decision, 'SERVE');
  assert.equal(data.format, 'VAST_URL');
  assert.equal(data.fallbackAction, 'FAIL_OPEN');
  assert.ok(data.payload?.vastTagUrl?.includes('https://adsterra.example/vast?t='));
  assert.ok(data.trackingToken, 'Decision must include signed tracking token');
});

test('POST /decision fails open with NO_FILL when channel is not monetized in WTPP', async () => {
  const { mockPrismaClient } = createMockPrisma({ isMonetized: false });
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const response = await fetch(`${baseUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      placement: 'PRE_ROLL',
      videoId: '11111111-1111-4111-8111-111111111111',
    }),
  });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.decision, 'NO_FILL');
  assert.equal(data.fallbackAction, 'FAIL_OPEN');
  assert.equal(data.reason, 'Channel is not approved for monetization in WTPP');
});

test('POST /decision fails open with NO_FILL when video is private', async () => {
  const { mockPrismaClient } = createMockPrisma({ visibility: 'PRIVATE' });
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const response = await fetch(`${baseUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      placement: 'PRE_ROLL',
      videoId: '11111111-1111-4111-8111-111111111111',
    }),
  });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.decision, 'NO_FILL');
  assert.equal(data.fallbackAction, 'FAIL_OPEN');
  assert.equal(data.reason, 'Private videos are not eligible for advertising');
});

test('POST /decision fails open with NO_FILL when video is blocked by copyright', async () => {
  const { mockPrismaClient } = createMockPrisma({ copyrightBlocked: true });
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const response = await fetch(`${baseUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      placement: 'PRE_ROLL',
      videoId: '11111111-1111-4111-8111-111111111111',
    }),
  });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.decision, 'NO_FILL');
  assert.equal(data.fallbackAction, 'FAIL_OPEN');
  assert.equal(data.reason, 'Video is blocked due to copyright infringement');
});

test('POST /decision fails open with NO_FILL when creator has an active monetization strike', async () => {
  const { mockPrismaClient } = createMockPrisma({ hasStrike: true });
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const response = await fetch(`${baseUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      placement: 'PRE_ROLL',
      videoId: '11111111-1111-4111-8111-111111111111',
    }),
  });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.decision, 'NO_FILL');
  assert.equal(data.fallbackAction, 'FAIL_OPEN');
  assert.equal(data.reason, 'Creator has active monetization strikes or holds');
});

test('POST /decision rejects invalid placement request with 400', async () => {
  const { mockPrismaClient } = createMockPrisma();
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const response = await fetch(`${baseUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      placement: 'INVALID_PLACEMENT_NAME',
    }),
  });

  assert.equal(response.status, 400);
});

// ==============================================================================
// 2. AD TELEMETRY EVENT INGESTION & ANTI-REPLAY TESTS
// ==============================================================================

test('POST /ad-event ingests valid lifecycle events with signed token', async () => {
  const { mockPrismaClient, createdAdEvents } = createMockPrisma();
  const nonceStore = new InMemoryAdTelemetryNonceStore();
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient, nonceStore });

  const token = signAdToken(
    {
      sessionId: 'sess-lifecycle-1',
      placement: 'PRE_ROLL',
      provider: 'Adsterra Network',
      adId: 'ad-1234',
      videoId: '11111111-1111-4111-8111-111111111111',
      channelId: 'channel-uuid-1234',
      timestamp: Date.now(),
      expiresAt: Date.now() + 60000,
    },
    TEST_ADS_SECRET
  );

  // 1. Record AD_LOADED
  const loadedRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_LOADED' }),
  });
  assert.equal(loadedRes.status, 200);

  // 2. Record AD_IMPRESSION
  const impRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
  });
  assert.equal(impRes.status, 200);
  const impData = await impRes.json();
  assert.equal(impData.recordedEvent, 'AD_IMPRESSION');

  // 3. Record distinct AD_VIEWABLE (viewable impression, separate from AD_IMPRESSION)
  const viewableRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_VIEWABLE' }),
  });
  assert.equal(viewableRes.status, 200);

  // Verify exact 1:1 database persistence without lossy event collapse and grossRevenueCents is 0
  assert.equal(createdAdEvents.length, 3);
  const dbLoaded = createdAdEvents.find((e) => e.eventType === 'AD_LOADED');
  const dbImp = createdAdEvents.find((e) => e.eventType === 'AD_IMPRESSION');
  const dbViewable = createdAdEvents.find((e) => e.eventType === 'AD_VIEWABLE');
  assert.ok(dbLoaded);
  assert.ok(dbImp);
  assert.ok(dbViewable);
  assert.equal(dbImp.grossRevenueCents, BigInt(0));
  assert.equal(dbViewable.grossRevenueCents, BigInt(0));
  assert.equal(dbImp.sessionId, 'sess-lifecycle-1');
  assert.equal(dbImp.placement, 'PRE_ROLL');
  assert.equal(dbImp.adId, 'ad-1234');
});

test('POST /ad-event rejects duplicate billable impression on same session with 409', async () => {
  const { mockPrismaClient } = createMockPrisma();
  const nonceStore = new InMemoryAdTelemetryNonceStore();
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient, nonceStore });

  const token = signAdToken(
    {
      sessionId: 'sess-dup-imp-test',
      placement: 'PRE_ROLL',
      provider: 'Adsterra Network',
      adId: 'ad-1234',
      videoId: '11111111-1111-4111-8111-111111111111',
      channelId: 'channel-uuid-1234',
      timestamp: Date.now(),
      expiresAt: Date.now() + 60000,
    },
    TEST_ADS_SECRET
  );

  // First impression succeeds
  const firstRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
  });
  assert.equal(firstRes.status, 200);

  // Second duplicate impression must be rejected
  const secondRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
  });
  assert.equal(secondRes.status, 409);
  const data = await secondRes.json();
  assert.equal(data.code, 'DUPLICATE_IMPRESSION');
});

test('POST /ad-event atomically rejects concurrent duplicate impressions', async () => {
  const { mockPrismaClient } = createMockPrisma();
  const nonceStore = new InMemoryAdTelemetryNonceStore();
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient, nonceStore });

  const token = signAdToken(
    {
      sessionId: 'sess-concurrent-race-test',
      placement: 'PRE_ROLL',
      provider: 'Adsterra Network',
      adId: 'ad-concurrent',
      videoId: '11111111-1111-4111-8111-111111111111',
      channelId: 'channel-uuid-1234',
      timestamp: Date.now(),
      expiresAt: Date.now() + 60000,
    },
    TEST_ADS_SECRET
  );

  // Fire 5 concurrent requests simultaneously
  const requests = Array.from({ length: 5 }, () =>
    fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
    })
  );

  const responses = await Promise.all(requests);
  const statusCodes = responses.map((r) => r.status);

  // Exactly one request must succeed (200), and all 4 others must be rejected with 409!
  const successes = statusCodes.filter((s) => s === 200);
  const conflicts = statusCodes.filter((s) => s === 409);

  assert.equal(successes.length, 1, 'Only one concurrent impression may succeed');
  assert.equal(conflicts.length, 4, 'All concurrent duplicate impressions must be rejected with 409');
});

test('POST /ad-event rejects tampered token (altered videoId) with 400', async () => {
  const { mockPrismaClient } = createMockPrisma();
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const payload = {
    sessionId: 'sess-tamper-test',
    placement: 'PRE_ROLL' as const,
    provider: 'Adsterra Network',
    adId: 'ad-tamper',
    videoId: 'original-video-uuid',
    channelId: 'original-channel-uuid',
    timestamp: Date.now(),
    expiresAt: Date.now() + 60000,
  };

  const validToken = signAdToken(payload, TEST_ADS_SECRET);
  const [, sig] = validToken.split('.');

  // Attacker tries to claim ad impression on another video
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...payload, videoId: 'attacker-video-uuid' }),
    'utf8'
  ).toString('base64url');
  const tamperedToken = `${tamperedPayload}.${sig}`;

  const res = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tamperedToken, eventType: 'AD_IMPRESSION' }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'Invalid, expired, or tampered ad tracking token');
});

test('POST /ad-event rejects client-submitted revenue or unexpected properties with 400', async () => {
  const { mockPrismaClient } = createMockPrisma();
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const token = signAdToken(
    {
      sessionId: 'sess-revenue-exploit',
      placement: 'PRE_ROLL',
      provider: 'Adsterra Network',
      adId: 'ad-exploit',
      timestamp: Date.now(),
      expiresAt: Date.now() + 60000,
    },
    TEST_ADS_SECRET
  );

  // Client attempts to inject financial revenue or credit fields
  const res = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      eventType: 'AD_IMPRESSION',
      grossRevenueCents: 100000, // Exploit payload
      amount: 5000,
    }),
  });

  assert.equal(res.status, 400);
});

test('POST /ad-event rejects expired token with 400', async () => {
  const { mockPrismaClient } = createMockPrisma();
  const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });

  const expiredToken = signAdToken(
    {
      sessionId: 'sess-expired-test',
      placement: 'PRE_ROLL',
      provider: 'Adsterra Network',
      adId: 'ad-expired',
      timestamp: Date.now() - 100000,
      expiresAt: Date.now() - 5000, // Expired
    },
    TEST_ADS_SECRET
  );

  const res = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: expiredToken, eventType: 'AD_IMPRESSION' }),
  });

  assert.equal(res.status, 400);
});

// ==============================================================================
// 3. PROVIDER ADMINISTRATION & RBAC PROTECTION TESTS
// ==============================================================================

test('Admin provider management rejects ordinary users and unprivileged admins with 403', async () => {
  const { mockPrismaClient } = createMockPrisma();
  // Server started with role 'USER' without monetization.manage_providers permission
  const baseUrl = await startAdServer({
    prismaClient: mockPrismaClient,
    role: 'USER',
  });

  const getRes = await fetch(`${baseUrl}/api/v1/admin/monetization/providers`);
  assert.equal(getRes.status, 403);

  const postRes = await fetch(`${baseUrl}/api/v1/admin/monetization/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Rogue Network',
      vastTagUrl: 'https://rogue.example/vast',
    }),
  });
  assert.equal(postRes.status, 403);
});

test('Admin provider management allows SUPER_ADMIN', async () => {
  const { mockPrismaClient } = createMockPrisma();
  const baseUrl = await startAdServer({
    prismaClient: mockPrismaClient,
    role: 'SUPER_ADMIN',
  });

  const getRes = await fetch(`${baseUrl}/api/v1/admin/monetization/providers`);
  assert.equal(getRes.status, 200);
  const data = await getRes.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].name, 'Adsterra Video Pre-Roll');
});
