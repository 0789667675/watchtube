import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { requireSuperAdmin } from '../src/middleware/admin';
import { createRevenueReconciliationRouter } from '../src/routes/monetization.route';
import {
  AttributionPolicyError,
  AttributionValidationError,
  IRevenueAttributionRepository,
  RecordedAdEventSnapshot,
  RevenueAttributionService,
  VideoAttributionContext,
} from '../src/services/advertising';
import {
  InMemoryWalletLedgerRepository,
  WalletLedgerService,
} from '../src/services/finance/ledger.service';

const CHANNEL_STD = '11111111-1111-4111-8111-111111111111';
const CHANNEL_SHORT = '22222222-2222-4222-8222-222222222222';
const VIDEO_STD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VIDEO_SHORT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VIDEO_BLOCKED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VIDEO_ERROR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const VIDEO_ESCROW = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OWNER_ID = '99999999-9999-4999-8999-999999999999';

const activeServers: Server[] = [];

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

function createMockAttributionRepo(initialShortsRateBps = 3000) {
  let shortsRateBps = initialShortsRateBps;
  const reconciliations: any[] = [];

  const videos = new Map<string, VideoAttributionContext>([
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

  const eventsByVideo = new Map<string, RecordedAdEventSnapshot[]>([
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

  const repo: IRevenueAttributionRepository = {
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
      if (found) found.status = status;
    },
  };

  return {
    repo,
    reconciliations,
    setShortsRateBasisPoints(next: number) {
      shortsRateBps = next;
    },
  };
}

test('rejects client telemetry as proof of revenue and requires explicit approved policy', async () => {
  const { repo } = createMockAttributionRepo(3000);
  const ledgerRepo = new InMemoryWalletLedgerRepository([CHANNEL_STD, CHANNEL_SHORT]);
  const ledger = new WalletLedgerService(ledgerRepo);
  const auditEvents: any[] = [];
  const service = new RevenueAttributionService(repo, ledger, async (ev) => {
    auditEvents.push(ev);
  });

  // Unconfigured policy must fail closed (never invent a 50/50 or 55/45 split)
  await assert.rejects(
    () =>
      service.reconcileVerifiedReports({
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
      }),
    (err: unknown) => err instanceof AttributionPolicyError
  );

  // Client telemetry cannot be submitted as revenue
  await assert.rejects(
    () =>
      service.reconcileVerifiedReports({
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
      }),
    (err: unknown) =>
      err instanceof AttributionValidationError && err.code === 'CLIENT_TELEMETRY_CANNOT_PROVE_REVENUE'
  );

  // Missing provider reports cannot be fabricated
  await assert.rejects(
    () =>
      service.reconcileVerifiedReports({
        periodMonth: '2026-11',
        reports: [],
        policy: { creatorShareBasisPoints: 5000 },
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
      }),
    (err: unknown) =>
      err instanceof AttributionValidationError && err.code === 'MISSING_PROVIDER_REPORTS'
  );
  assert.equal(auditEvents.length, 0);
});

test('reconciles verified provider reports, preserves Shorts 30% prospective rule, blocks invalid/failed traffic, and prevents duplicate credits', async () => {
  const { repo, setShortsRateBasisPoints } = createMockAttributionRepo(3000); // 30.00% Shorts default
  const ledgerRepo = new InMemoryWalletLedgerRepository([CHANNEL_STD, CHANNEL_SHORT]);
  const ledger = new WalletLedgerService(ledgerRepo);
  const auditEvents: any[] = [];
  const service = new RevenueAttributionService(repo, ledger, async (ev) => {
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

  assert.equal(batch.verifiedLineCount, 3);
  assert.equal(batch.rejectedLineCount, 3);
  assert.equal(batch.duplicateLineCount, 1);
  assert.equal(batch.appliedShortsRateBasisPoints, 3000);
  assert.equal(batch.totalVerifiedNetRevenueCents, 2500n); // 900 + 1000 + 600
  assert.equal(batch.totalCreatorAttributableCents, 600n); // 450 + 150
  assert.equal(batch.totalEscrowWithheldCents, 300n); // 50% of 600 withheld
  assert.equal(batch.totalPlatformAttributableCents, 1600n); // 450 + 850 + 300
  assert.equal(
    batch.totalCreatorAttributableCents + batch.totalPlatformAttributableCents + batch.totalEscrowWithheldCents,
    batch.totalVerifiedNetRevenueCents
  );

  assert.equal((await ledger.getChannelBalance(CHANNEL_STD)).availableBalanceCents, 450n);
  assert.equal((await ledger.getChannelBalance(CHANNEL_SHORT)).availableBalanceCents, 150n);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, 'REVENUE_RECONCILED');

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
  assert.equal(retryBatch.verifiedLineCount, 0);
  assert.equal(retryBatch.duplicateLineCount, 1);
  assert.equal((await ledger.getChannelBalance(CHANNEL_STD)).availableBalanceCents, 450n);

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
  assert.equal(nextMonthBatch.appliedShortsRateBasisPoints, 5000);
  assert.equal(nextMonthBatch.totalCreatorAttributableCents, 250n); // 50% of 500 = 250
  assert.equal((await ledger.getChannelBalance(CHANNEL_SHORT)).availableBalanceCents, 400n); // 150 + 250
});

test('POST /reconcile strictly enforces SUPER_ADMIN ownership and fails with 501 when policy unconfigured', async () => {
  const { repo } = createMockAttributionRepo(3000);
  const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository([CHANNEL_STD]));
  const attributionService = new RevenueAttributionService(repo, ledger, async () => {});

  const makeServer = async (configuredPolicy: { creatorShareBasisPoints: number } | null) => {
    const app = express();
    app.use(express.json());
    const auth: RequestHandler = (req, res, next) => {
      const role = req.get('x-test-role');
      if (!role) return res.status(401).json({ error: 'Unauthorized' });
      (req as any).user = { id: OWNER_ID, role };
      next();
    };
    app.use(
      '/api/v1/monetization',
      createRevenueReconciliationRouter(auth, requireSuperAdmin, {
        attributionService,
        allocationPolicy: configuredPolicy,
      })
    );
    const server = createServer(app);
    activeServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  };

  // Unconfigured policy -> 501 for SUPER_ADMIN, 403 for ordinary ADMIN
  const unconfiguredUrl = await makeServer(null);
  const adminDenied = await fetch(`${unconfiguredUrl}/api/v1/monetization/reconcile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-role': 'ADMIN' },
    body: JSON.stringify({ periodMonth: '2026-11', reports: [{}] }),
  });
  assert.equal(adminDenied.status, 403);

  const owner501 = await fetch(`${unconfiguredUrl}/api/v1/monetization/reconcile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-role': 'SUPER_ADMIN' },
    body: JSON.stringify({ periodMonth: '2026-11', reports: [{}] }),
  });
  assert.equal(owner501.status, 501);

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
  assert.equal(adminStillDenied.status, 403);

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
  assert.equal(ownerOk.status, 200);
  const body = await ownerOk.json();
  assert.equal(body.totalCreatorAttributableCents, '500');
  assert.equal(body.totalPlatformAttributableCents, '500');
});
