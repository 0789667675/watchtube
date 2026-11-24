"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const monetization_route_1 = require("../src/routes/monetization.route");
const advertising_1 = require("../src/services/advertising");
const rbac_1 = require("../src/middleware/rbac");
const TEST_ADS_SECRET = 'test-ads-secret-key-32-chars-long-secure-key';
const TEST_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
const activeServers = [];
function createMockPrisma(options = {}) {
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
    const createdAdEvents = [];
    const mockPrismaClient = {
        video: {
            async findUnique({ where }) {
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
            async findUnique({ where }) {
                if (where.id === 'prov-1' || where.name === 'Adsterra Network') {
                    return { id: 'prov-1', name: 'Adsterra Network', vastTagUrl: 'https://adsterra.example/vast', priority: 1, isEnabled: true, format: 'PRE_ROLL' };
                }
                return null;
            },
            async upsert({ create }) {
                return { id: 'prov-new', ...create };
            },
            async delete({ where }) {
                return { id: where.id, name: 'Adsterra Network' };
            },
        },
        adEvent: {
            async create({ data }) {
                createdAdEvents.push(data);
                return { id: `event-${createdAdEvents.length}`, ...data };
            },
        },
    };
    return { mockPrismaClient, createdAdEvents };
}
async function startAdServer(options = {}) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authMiddleware = (req, res, next) => {
        req.user = {
            id: TEST_ACTOR_ID,
            role: options.role || 'USER',
        };
        next();
    };
    const decisionRouter = (0, monetization_route_1.createAdDecisionRouter)({
        engine: options.engine,
        prismaClient: options.prismaClient,
        secret: options.secret || TEST_ADS_SECRET,
    });
    const eventRouter = (0, monetization_route_1.createAdEventRouter)(authMiddleware, {
        nonceStore: options.nonceStore,
        secret: options.secret || TEST_ADS_SECRET,
        prismaClient: options.prismaClient,
    });
    app.use('/api/v1/monetization', decisionRouter);
    app.use('/api/v1/monetization', eventRouter);
    // Admin provider routes for authorization test
    const adminRouter = express_1.default.Router();
    adminRouter.use(authMiddleware);
    adminRouter.get('/providers', (0, rbac_1.requirePermission)('monetization.manage_providers'), async (_req, res) => {
        const providers = await options.prismaClient?.adProviderConfig?.findMany();
        res.status(200).json(providers || []);
    });
    adminRouter.post('/providers', (0, rbac_1.requirePermission)('monetization.manage_providers'), async (req, res) => {
        res.status(200).json({ success: true, created: req.body });
    });
    app.use('/api/v1/admin/monetization', adminRouter);
    const server = (0, node_http_1.createServer)(app);
    activeServers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.splice(0).map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
});
// ==============================================================================
// 1. AD DECISION API TESTS
// ==============================================================================
(0, node_test_1.test)('POST /decision returns SERVE with valid VAST config and signed tracking token for monetized video', async () => {
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
    strict_1.default.equal(response.status, 200);
    const data = await response.json();
    strict_1.default.equal(data.decision, 'SERVE');
    strict_1.default.equal(data.format, 'VAST_URL');
    strict_1.default.equal(data.fallbackAction, 'FAIL_OPEN');
    strict_1.default.ok(data.payload?.vastTagUrl?.includes('https://adsterra.example/vast?t='));
    strict_1.default.ok(data.trackingToken, 'Decision must include signed tracking token');
});
(0, node_test_1.test)('POST /decision fails open with NO_FILL when channel is not monetized in WTPP', async () => {
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
    strict_1.default.equal(response.status, 200);
    const data = await response.json();
    strict_1.default.equal(data.decision, 'NO_FILL');
    strict_1.default.equal(data.fallbackAction, 'FAIL_OPEN');
    strict_1.default.equal(data.reason, 'Channel is not approved for monetization in WTPP');
});
(0, node_test_1.test)('POST /decision fails open with NO_FILL when video is private', async () => {
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
    strict_1.default.equal(response.status, 200);
    const data = await response.json();
    strict_1.default.equal(data.decision, 'NO_FILL');
    strict_1.default.equal(data.fallbackAction, 'FAIL_OPEN');
    strict_1.default.equal(data.reason, 'Private videos are not eligible for advertising');
});
(0, node_test_1.test)('POST /decision fails open with NO_FILL when video is blocked by copyright', async () => {
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
    strict_1.default.equal(response.status, 200);
    const data = await response.json();
    strict_1.default.equal(data.decision, 'NO_FILL');
    strict_1.default.equal(data.fallbackAction, 'FAIL_OPEN');
    strict_1.default.equal(data.reason, 'Video is blocked due to copyright infringement');
});
(0, node_test_1.test)('POST /decision fails open with NO_FILL when creator has an active monetization strike', async () => {
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
    strict_1.default.equal(response.status, 200);
    const data = await response.json();
    strict_1.default.equal(data.decision, 'NO_FILL');
    strict_1.default.equal(data.fallbackAction, 'FAIL_OPEN');
    strict_1.default.equal(data.reason, 'Creator has active monetization strikes or holds');
});
(0, node_test_1.test)('POST /decision rejects invalid placement request with 400', async () => {
    const { mockPrismaClient } = createMockPrisma();
    const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });
    const response = await fetch(`${baseUrl}/api/v1/monetization/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            placement: 'INVALID_PLACEMENT_NAME',
        }),
    });
    strict_1.default.equal(response.status, 400);
});
// ==============================================================================
// 2. AD TELEMETRY EVENT INGESTION & ANTI-REPLAY TESTS
// ==============================================================================
(0, node_test_1.test)('POST /ad-event ingests valid lifecycle events with signed token', async () => {
    const { mockPrismaClient, createdAdEvents } = createMockPrisma();
    const nonceStore = new advertising_1.InMemoryAdTelemetryNonceStore();
    const baseUrl = await startAdServer({ prismaClient: mockPrismaClient, nonceStore });
    const token = (0, advertising_1.signAdToken)({
        sessionId: 'sess-lifecycle-1',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-1234',
        videoId: '11111111-1111-4111-8111-111111111111',
        channelId: 'channel-uuid-1234',
        timestamp: Date.now(),
        expiresAt: Date.now() + 60000,
    }, TEST_ADS_SECRET);
    // 1. Record AD_LOADED
    const loadedRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_LOADED' }),
    });
    strict_1.default.equal(loadedRes.status, 200);
    // 2. Record AD_IMPRESSION
    const impRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
    });
    strict_1.default.equal(impRes.status, 200);
    const impData = await impRes.json();
    strict_1.default.equal(impData.recordedEvent, 'AD_IMPRESSION');
    // 3. Record distinct AD_VIEWABLE (viewable impression, separate from AD_IMPRESSION)
    const viewableRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_VIEWABLE' }),
    });
    strict_1.default.equal(viewableRes.status, 200);
    // Verify exact 1:1 database persistence without lossy event collapse and grossRevenueCents is 0
    strict_1.default.equal(createdAdEvents.length, 3);
    const dbLoaded = createdAdEvents.find((e) => e.eventType === 'AD_LOADED');
    const dbImp = createdAdEvents.find((e) => e.eventType === 'AD_IMPRESSION');
    const dbViewable = createdAdEvents.find((e) => e.eventType === 'AD_VIEWABLE');
    strict_1.default.ok(dbLoaded);
    strict_1.default.ok(dbImp);
    strict_1.default.ok(dbViewable);
    strict_1.default.equal(dbImp.grossRevenueCents, BigInt(0));
    strict_1.default.equal(dbViewable.grossRevenueCents, BigInt(0));
    strict_1.default.equal(dbImp.sessionId, 'sess-lifecycle-1');
    strict_1.default.equal(dbImp.placement, 'PRE_ROLL');
    strict_1.default.equal(dbImp.adId, 'ad-1234');
});
(0, node_test_1.test)('POST /ad-event rejects duplicate billable impression on same session with 409', async () => {
    const { mockPrismaClient } = createMockPrisma();
    const nonceStore = new advertising_1.InMemoryAdTelemetryNonceStore();
    const baseUrl = await startAdServer({ prismaClient: mockPrismaClient, nonceStore });
    const token = (0, advertising_1.signAdToken)({
        sessionId: 'sess-dup-imp-test',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-1234',
        videoId: '11111111-1111-4111-8111-111111111111',
        channelId: 'channel-uuid-1234',
        timestamp: Date.now(),
        expiresAt: Date.now() + 60000,
    }, TEST_ADS_SECRET);
    // First impression succeeds
    const firstRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
    });
    strict_1.default.equal(firstRes.status, 200);
    // Second duplicate impression must be rejected
    const secondRes = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
    });
    strict_1.default.equal(secondRes.status, 409);
    const data = await secondRes.json();
    strict_1.default.equal(data.code, 'DUPLICATE_IMPRESSION');
});
(0, node_test_1.test)('POST /ad-event atomically rejects concurrent duplicate impressions', async () => {
    const { mockPrismaClient } = createMockPrisma();
    const nonceStore = new advertising_1.InMemoryAdTelemetryNonceStore();
    const baseUrl = await startAdServer({ prismaClient: mockPrismaClient, nonceStore });
    const token = (0, advertising_1.signAdToken)({
        sessionId: 'sess-concurrent-race-test',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-concurrent',
        videoId: '11111111-1111-4111-8111-111111111111',
        channelId: 'channel-uuid-1234',
        timestamp: Date.now(),
        expiresAt: Date.now() + 60000,
    }, TEST_ADS_SECRET);
    // Fire 5 concurrent requests simultaneously
    const requests = Array.from({ length: 5 }, () => fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
    }));
    const responses = await Promise.all(requests);
    const statusCodes = responses.map((r) => r.status);
    // Exactly one request must succeed (200), and all 4 others must be rejected with 409!
    const successes = statusCodes.filter((s) => s === 200);
    const conflicts = statusCodes.filter((s) => s === 409);
    strict_1.default.equal(successes.length, 1, 'Only one concurrent impression may succeed');
    strict_1.default.equal(conflicts.length, 4, 'All concurrent duplicate impressions must be rejected with 409');
});
(0, node_test_1.test)('POST /ad-event rejects tampered token (altered videoId) with 400', async () => {
    const { mockPrismaClient } = createMockPrisma();
    const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });
    const payload = {
        sessionId: 'sess-tamper-test',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-tamper',
        videoId: 'original-video-uuid',
        channelId: 'original-channel-uuid',
        timestamp: Date.now(),
        expiresAt: Date.now() + 60000,
    };
    const validToken = (0, advertising_1.signAdToken)(payload, TEST_ADS_SECRET);
    const [, sig] = validToken.split('.');
    // Attacker tries to claim ad impression on another video
    const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, videoId: 'attacker-video-uuid' }), 'utf8').toString('base64url');
    const tamperedToken = `${tamperedPayload}.${sig}`;
    const res = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tamperedToken, eventType: 'AD_IMPRESSION' }),
    });
    strict_1.default.equal(res.status, 400);
    const data = await res.json();
    strict_1.default.equal(data.error, 'Invalid, expired, or tampered ad tracking token');
});
(0, node_test_1.test)('POST /ad-event rejects client-submitted revenue or unexpected properties with 400', async () => {
    const { mockPrismaClient } = createMockPrisma();
    const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });
    const token = (0, advertising_1.signAdToken)({
        sessionId: 'sess-revenue-exploit',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-exploit',
        timestamp: Date.now(),
        expiresAt: Date.now() + 60000,
    }, TEST_ADS_SECRET);
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
    strict_1.default.equal(res.status, 400);
});
(0, node_test_1.test)('POST /ad-event rejects expired token with 400', async () => {
    const { mockPrismaClient } = createMockPrisma();
    const baseUrl = await startAdServer({ prismaClient: mockPrismaClient });
    const expiredToken = (0, advertising_1.signAdToken)({
        sessionId: 'sess-expired-test',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-expired',
        timestamp: Date.now() - 100000,
        expiresAt: Date.now() - 5000, // Expired
    }, TEST_ADS_SECRET);
    const res = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: expiredToken, eventType: 'AD_IMPRESSION' }),
    });
    strict_1.default.equal(res.status, 400);
});
// ==============================================================================
// 3. PROVIDER ADMINISTRATION & RBAC PROTECTION TESTS
// ==============================================================================
(0, node_test_1.test)('Admin provider management rejects ordinary users and unprivileged admins with 403', async () => {
    const { mockPrismaClient } = createMockPrisma();
    // Server started with role 'USER' without monetization.manage_providers permission
    const baseUrl = await startAdServer({
        prismaClient: mockPrismaClient,
        role: 'USER',
    });
    const getRes = await fetch(`${baseUrl}/api/v1/admin/monetization/providers`);
    strict_1.default.equal(getRes.status, 403);
    const postRes = await fetch(`${baseUrl}/api/v1/admin/monetization/providers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            name: 'Rogue Network',
            vastTagUrl: 'https://rogue.example/vast',
        }),
    });
    strict_1.default.equal(postRes.status, 403);
});
(0, node_test_1.test)('Admin provider management allows SUPER_ADMIN', async () => {
    const { mockPrismaClient } = createMockPrisma();
    const baseUrl = await startAdServer({
        prismaClient: mockPrismaClient,
        role: 'SUPER_ADMIN',
    });
    const getRes = await fetch(`${baseUrl}/api/v1/admin/monetization/providers`);
    strict_1.default.equal(getRes.status, 200);
    const data = await getRes.json();
    strict_1.default.equal(data.length, 1);
    strict_1.default.equal(data[0].name, 'Adsterra Video Pre-Roll');
});
