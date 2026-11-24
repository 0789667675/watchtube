"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const admin_1 = require("../src/middleware/admin");
const monetization_route_1 = require("../src/routes/monetization.route");
const advertising_1 = require("../src/services/advertising");
const ledger_service_1 = require("../src/services/finance/ledger.service");
const CHANNEL_STD = '11111111-1111-4111-8111-111111111111';
const CHANNEL_SHORT = '22222222-2222-4222-8222-222222222222';
const VIDEO_STD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VIDEO_SHORT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VIDEO_BLOCKED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VIDEO_ERROR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const VIDEO_ESCROW = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OWNER_ID = '99999999-9999-4999-8999-999999999999';
const activeServers = [];
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.splice(0).map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
});
function createMockAttributionRepo(initialShortsRateBps = 3000) {
    let shortsRateBps = initialShortsRateBps;
    const reconciliations = [];
    const videos = new Map([
        [
            VIDEO_STD,
            {
                id: VIDEO_STD,
                channelId: CHANNEL_STD,
                isShort: false,
                status: 'PUBLISHED',
                visibility: 'PUBLIC',
                copyrightReviewStatus: 'CLEARED',
                channelIsMonetized: true,
                hasActiveEscrowHold: false,
            },
        ],
        [
            VIDEO_SHORT,
            {
                id: VIDEO_SHORT,
                channelId: CHANNEL_SHORT,
                isShort: true,
                status: 'PUBLISHED',
                visibility: 'PUBLIC',
                copyrightReviewStatus: 'CLEARED',
                channelIsMonetized: true,
                hasActiveEscrowHold: false,
            },
        ],
        [
            VIDEO_BLOCKED,
            {
                id: VIDEO_BLOCKED,
                channelId: CHANNEL_STD,
                isShort: false,
                status: 'BLOCKED',
                visibility: 'PRIVATE',
                copyrightReviewStatus: 'BLOCKED',
                channelIsMonetized: true,
                hasActiveEscrowHold: false,
            },
        ],
        [
            VIDEO_ERROR,
            {
                id: VIDEO_ERROR,
                channelId: CHANNEL_STD,
                isShort: false,
                status: 'PUBLISHED',
                visibility: 'PUBLIC',
                copyrightReviewStatus: 'CLEARED',
                channelIsMonetized: true,
                hasActiveEscrowHold: false,
            },
        ],
        [
            VIDEO_ESCROW,
            {
                id: VIDEO_ESCROW,
                channelId: CHANNEL_STD,
                isShort: false,
                status: 'PUBLISHED',
                visibility: 'PUBLIC',
                copyrightReviewStatus: 'CLEARED',
                channelIsMonetized: true,
                hasActiveEscrowHold: true,
            },
        ],
    ]);
    const eventsByVideo = new Map([
        [
            VIDEO_STD,
            [
                {
                    id: 'ev-std-1',
                    videoId: VIDEO_STD,
                    channelId: CHANNEL_STD,
                    eventType: 'AD_IMPRESSION',
                    provider: 'Adsterra VAST',
                    grossRevenueCents: 0n,
                    sessionId: 'sess-std-1',
                    createdAt: new Date(),
                },
            ],
        ],
        [
            VIDEO_SHORT,
            [
                {
                    id: 'ev-short-1',
                    videoId: VIDEO_SHORT,
                    channelId: CHANNEL_SHORT,
                    eventType: 'AD_VIEWABLE',
                    provider: 'Adsterra VAST',
                    grossRevenueCents: 0n,
                    sessionId: 'sess-short-1',
                    createdAt: new Date(),
                },
            ],
        ],
        [
            VIDEO_ERROR,
            [
                {
                    id: 'ev-err-1',
                    videoId: VIDEO_ERROR,
                    channelId: CHANNEL_STD,
                    eventType: 'AD_ERROR',
                    provider: 'Adsterra VAST',
                    grossRevenueCents: 0n,
                    sessionId: 'sess-err-1',
                    createdAt: new Date(),
                },
            ],
        ],
        [
            VIDEO_ESCROW,
            [
                {
                    id: 'ev-escrow-1',
                    videoId: VIDEO_ESCROW,
                    channelId: CHANNEL_STD,
                    eventType: 'AD_IMPRESSION',
                    provider: 'Adsterra VAST',
                    grossRevenueCents: 0n,
                    sessionId: 'sess-escrow-1',
                    createdAt: new Date(),
                },
            ],
        ],
    ]);
    const repo = {
        async getShortsRateBasisPoints() {
            return shortsRateBps;
        },
        async findVideoAttributionContext(videoId) {
            return videos.get(videoId) ?? null;
        },
        async findMatchingTelemetryEvents({ videoId, sessionId }) {
            const list = eventsByVideo.get(videoId) ?? [];
            return sessionId ? list.filter((e) => e.sessionId === sessionId) : list;
        },
        async createReconciliationRecord(input) {
            const rec = { id: `recon-${reconciliations.length + 1}`, ...input };
            reconciliations.push(rec);
            return { id: rec.id };
        },
        async updateReconciliationStatus(id, status) {
            const found = reconciliations.find((r) => r.id === id);
            if (found)
                found.status = status;
        },
    };
    return {
        repo,
        reconciliations,
        setShortsRateBasisPoints(next) {
            shortsRateBps = next;
        },
    };
}
(0, node_test_1.test)('rejects client telemetry as proof of revenue and requires explicit approved policy', async () => {
    const { repo } = createMockAttributionRepo(3000);
    const ledgerRepo = new ledger_service_1.InMemoryWalletLedgerRepository([CHANNEL_STD, CHANNEL_SHORT]);
    const ledger = new ledger_service_1.WalletLedgerService(ledgerRepo);
    const auditEvents = [];
    const service = new advertising_1.RevenueAttributionService(repo, ledger, async (ev) => {
        auditEvents.push(ev);
    });
    // Unconfigured policy must fail closed (never invent a 50/50 or 55/45 split)
    await strict_1.default.rejects(() => service.reconcileVerifiedReports({
        periodMonth: '2026-11',
        reports: [
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_STD,
                channelId: CHANNEL_STD,
                reportedGrossRevenueCents: 1000n,
                currency: 'RWF',
            },
        ],
        policy: null,
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
    }), (err) => err instanceof advertising_1.AttributionPolicyError);
    // Client telemetry cannot be submitted as revenue
    await strict_1.default.rejects(() => service.reconcileVerifiedReports({
        periodMonth: '2026-11',
        reports: [
            {
                sourceType: 'CLIENT_TELEMETRY',
                externalReportId: 'rep-fake',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_STD,
                channelId: CHANNEL_STD,
                reportedGrossRevenueCents: 1000n,
                currency: 'RWF',
            },
        ],
        policy: { creatorShareBasisPoints: 5000 },
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
    }), (err) => err instanceof advertising_1.AttributionValidationError && err.code === 'CLIENT_TELEMETRY_CANNOT_PROVE_REVENUE');
    // Missing provider reports cannot be fabricated
    await strict_1.default.rejects(() => service.reconcileVerifiedReports({
        periodMonth: '2026-11',
        reports: [],
        policy: { creatorShareBasisPoints: 5000 },
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
    }), (err) => err instanceof advertising_1.AttributionValidationError && err.code === 'MISSING_PROVIDER_REPORTS');
    strict_1.default.equal(auditEvents.length, 0);
});
(0, node_test_1.test)('reconciles verified provider reports, preserves Shorts 30% prospective rule, blocks invalid/failed traffic, and prevents duplicate credits', async () => {
    const { repo, setShortsRateBasisPoints } = createMockAttributionRepo(3000); // 30.00% Shorts default
    const ledgerRepo = new ledger_service_1.InMemoryWalletLedgerRepository([CHANNEL_STD, CHANNEL_SHORT]);
    const ledger = new ledger_service_1.WalletLedgerService(ledgerRepo);
    const auditEvents = [];
    const service = new advertising_1.RevenueAttributionService(repo, ledger, async (ev) => {
        auditEvents.push(ev);
    });
    // Policy explicitly provided by caller/test (not hardcoded in service)
    const testPolicy = { creatorShareBasisPoints: 5000 };
    const batch = await service.reconcileVerifiedReports({
        periodMonth: '2026-11',
        policy: testPolicy,
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
        reports: [
            // 1. Standard video: gross 1000, fee 100, IVT 0 -> net 900 -> 50% creator = 450, platform = 450
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-std-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_STD,
                channelId: CHANNEL_STD,
                sessionId: 'sess-std-1',
                reportedGrossRevenueCents: 1000n,
                providerFeeCents: 100n,
                invalidTrafficDeductionCents: 0n,
                currency: 'RWF',
            },
            // 2. Short video: gross 1000 -> net 1000 -> standard creator 500 -> 30% Shorts = 150 creator, 850 platform
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-short-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_SHORT,
                channelId: CHANNEL_SHORT,
                sessionId: 'sess-short-1',
                reportedGrossRevenueCents: 1000n,
                currency: 'RWF',
            },
            // 3. Duplicate report in same batch -> must NOT double-credit
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-short-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_SHORT,
                channelId: CHANNEL_SHORT,
                sessionId: 'sess-short-1',
                reportedGrossRevenueCents: 1000n,
                currency: 'RWF',
            },
            // 4. Copyright-blocked video -> rejected (0 creator earnings)
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-blocked-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_BLOCKED,
                channelId: CHANNEL_STD,
                reportedGrossRevenueCents: 2000n,
                currency: 'RWF',
            },
            // 5. Failed ad session (AD_ERROR) -> rejected (0 creator earnings)
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-err-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_ERROR,
                channelId: CHANNEL_STD,
                sessionId: 'sess-err-1',
                reportedGrossRevenueCents: 2000n,
                currency: 'RWF',
            },
            // 6. Active EscrowHold -> creator share withheld, NOT credited to available wallet balance
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-escrow-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_ESCROW,
                channelId: CHANNEL_STD,
                sessionId: 'sess-escrow-1',
                reportedGrossRevenueCents: 600n,
                currency: 'RWF',
            },
        ],
    });
    strict_1.default.equal(batch.verifiedLineCount, 3);
    strict_1.default.equal(batch.rejectedLineCount, 3);
    strict_1.default.equal(batch.duplicateLineCount, 1);
    strict_1.default.equal(batch.appliedShortsRateBasisPoints, 3000);
    strict_1.default.equal(batch.totalVerifiedNetRevenueCents, 2500n); // 900 + 1000 + 600
    strict_1.default.equal(batch.totalCreatorAttributableCents, 600n); // 450 + 150
    strict_1.default.equal(batch.totalEscrowWithheldCents, 300n); // 50% of 600 withheld
    strict_1.default.equal(batch.totalPlatformAttributableCents, 1600n); // 450 + 850 + 300
    strict_1.default.equal(batch.totalCreatorAttributableCents + batch.totalPlatformAttributableCents + batch.totalEscrowWithheldCents, batch.totalVerifiedNetRevenueCents);
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_STD)).availableBalanceCents, 450n);
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_SHORT)).availableBalanceCents, 150n);
    strict_1.default.equal(auditEvents.length, 1);
    strict_1.default.equal(auditEvents[0].action, 'REVENUE_RECONCILED');
    // Re-submitting the exact same reports in a retry must produce zero duplicate credits
    const retryBatch = await service.reconcileVerifiedReports({
        periodMonth: '2026-11',
        policy: testPolicy,
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
        reports: [
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-std-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-11',
                videoId: VIDEO_STD,
                channelId: CHANNEL_STD,
                sessionId: 'sess-std-1',
                reportedGrossRevenueCents: 1000n,
                providerFeeCents: 100n,
                currency: 'RWF',
            },
        ],
    });
    strict_1.default.equal(retryBatch.verifiedLineCount, 0);
    strict_1.default.equal(retryBatch.duplicateLineCount, 1);
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_STD)).availableBalanceCents, 450n);
    // Prospective Shorts rate change to 50.00% applies ONLY to future reports (historical 150n untouched)
    setShortsRateBasisPoints(5000);
    const nextMonthBatch = await service.reconcileVerifiedReports({
        periodMonth: '2026-12',
        policy: testPolicy,
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
        reports: [
            {
                sourceType: 'PROVIDER_REPORT',
                externalReportId: 'rep-short-dec-1',
                provider: 'Adsterra VAST',
                periodMonth: '2026-12',
                videoId: VIDEO_SHORT,
                channelId: CHANNEL_SHORT,
                sessionId: 'sess-short-1',
                reportedGrossRevenueCents: 1000n,
                currency: 'RWF',
            },
        ],
    });
    strict_1.default.equal(nextMonthBatch.appliedShortsRateBasisPoints, 5000);
    strict_1.default.equal(nextMonthBatch.totalCreatorAttributableCents, 250n); // 50% of 500 = 250
    strict_1.default.equal((await ledger.getChannelBalance(CHANNEL_SHORT)).availableBalanceCents, 400n); // 150 + 250
});
(0, node_test_1.test)('POST /reconcile strictly enforces SUPER_ADMIN ownership and fails with 501 when policy unconfigured', async () => {
    const { repo } = createMockAttributionRepo(3000);
    const ledger = new ledger_service_1.WalletLedgerService(new ledger_service_1.InMemoryWalletLedgerRepository([CHANNEL_STD]));
    const attributionService = new advertising_1.RevenueAttributionService(repo, ledger, async () => { });
    const makeServer = async (configuredPolicy) => {
        const app = (0, express_1.default)();
        app.use(express_1.default.json());
        const auth = (req, res, next) => {
            const role = req.get('x-test-role');
            if (!role)
                return res.status(401).json({ error: 'Unauthorized' });
            req.user = { id: OWNER_ID, role };
            next();
        };
        app.use('/api/v1/monetization', (0, monetization_route_1.createRevenueReconciliationRouter)(auth, admin_1.requireSuperAdmin, {
            attributionService,
            allocationPolicy: configuredPolicy,
        }));
        const server = (0, node_http_1.createServer)(app);
        activeServers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address();
        return `http://127.0.0.1:${addr.port}`;
    };
    // Unconfigured policy -> 501 for SUPER_ADMIN, 403 for ordinary ADMIN
    const unconfiguredUrl = await makeServer(null);
    const adminDenied = await fetch(`${unconfiguredUrl}/api/v1/monetization/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-role': 'ADMIN' },
        body: JSON.stringify({ periodMonth: '2026-11', reports: [{}] }),
    });
    strict_1.default.equal(adminDenied.status, 403);
    const owner501 = await fetch(`${unconfiguredUrl}/api/v1/monetization/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-role': 'SUPER_ADMIN' },
        body: JSON.stringify({ periodMonth: '2026-11', reports: [{}] }),
    });
    strict_1.default.equal(owner501.status, 501);
    // Configured policy -> SUPER_ADMIN succeeds, ordinary ADMIN still 403
    const configuredUrl = await makeServer({ creatorShareBasisPoints: 5000 });
    const adminStillDenied = await fetch(`${configuredUrl}/api/v1/monetization/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-role': 'ADMIN' },
        body: JSON.stringify({
            periodMonth: '2026-11',
            reports: [
                {
                    sourceType: 'PROVIDER_REPORT',
                    externalReportId: 'rep-http-1',
                    provider: 'Adsterra VAST',
                    periodMonth: '2026-11',
                    videoId: VIDEO_STD,
                    channelId: CHANNEL_STD,
                    reportedGrossRevenueCents: '1000',
                    currency: 'RWF',
                },
            ],
        }),
    });
    strict_1.default.equal(adminStillDenied.status, 403);
    const ownerOk = await fetch(`${configuredUrl}/api/v1/monetization/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-role': 'SUPER_ADMIN' },
        body: JSON.stringify({
            periodMonth: '2026-11',
            reports: [
                {
                    sourceType: 'PROVIDER_REPORT',
                    externalReportId: 'rep-http-1',
                    provider: 'Adsterra VAST',
                    periodMonth: '2026-11',
                    videoId: VIDEO_STD,
                    channelId: CHANNEL_STD,
                    reportedGrossRevenueCents: '1000',
                    currency: 'RWF',
                },
            ],
        }),
    });
    strict_1.default.equal(ownerOk.status, 200);
    const body = await ownerOk.json();
    strict_1.default.equal(body.totalCreatorAttributableCents, '500');
    strict_1.default.equal(body.totalPlatformAttributableCents, '500');
});
