import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request, RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import {
  createAdConfigRouter,
  createAdDecisionRouter,
  createAdEventRouter,
  createMonetizationRouter,
} from '../src/routes/monetization.route';
import { createWalletRouter } from '../src/routes/wallet.route';
import {
  AdDecisionEngine,
  AdsterraDisplayAdapter,
  AttributionValidationError,
  DirectAdvertiserAdapter,
  InMemoryAdTelemetryNonceStore,
  inspectAdProviderConfig,
  IRevenueAttributionRepository,
  isPlaceholderAdUrl,
  PersistAttributionLineInput,
  RecordedAdEventSnapshot,
  RevenueAttributionService,
  signAdToken,
  VastAdProviderAdapter,
  VideoAttributionContext,
} from '../src/services/advertising';
import {
  InsufficientFundsError,
  InMemoryWalletLedgerRepository,
  WalletLedgerService,
} from '../src/services/finance/ledger.service';
import {
  AirtelMoneyAdapter,
  InMemoryPaymentTransactionStore,
  MockMtnMoMoSandboxAdapter,
  MtnMoMoAdapter,
  OrchestratorError,
  PaymentOrchestratorService,
} from '../src/services/payments';

const ADS_SECRET = 'phase5-monetization-ads-hmac-secret-32chars-min';
const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const CREATOR_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '99999999-9999-4999-8999-999999999999';

const activeServers: Server[] = [];

async function startTestHttpServer(app: express.Express): Promise<string> {
  const server = createServer(app);
  activeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        })
    )
  );
});

// =============================================================================
// 1. Advertising Reliability, Placeholder Protection & Playback Fail-Open
// =============================================================================

test('Placeholder domains are clearly identified and fail open outside test mode', async () => {
  assert.equal(isPlaceholderAdUrl('https://adsterra.example/vast?t=[timestamp]'), true);
  assert.equal(isPlaceholderAdUrl('https://ads.test/tag.xml'), true);
  assert.equal(isPlaceholderAdUrl('https://replace-with-provider.com/vast'), true);
  assert.equal(isPlaceholderAdUrl('https://verified-network.net/vast?slot=1'), false);

  const placeholderInspection = inspectAdProviderConfig({
    name: 'Placeholder Net',
    vastTagUrl: 'https://adsterra.example/vast',
    providerType: 'VAST_GENERIC',
    isEnabled: true,
  });
  assert.equal(placeholderInspection.integrationState, 'PLACEHOLDER_UNVERIFIED');
  assert.equal(placeholderInspection.liveVerified, false);

  const liveInspection = inspectAdProviderConfig({
    name: 'Live Config',
    vastTagUrl: 'https://verified-network.net/vast?slot=1',
    providerType: 'VAST_GENERIC',
    isEnabled: true,
  });
  assert.equal(liveInspection.integrationState, 'IMPLEMENTED_ADAPTER_UNVERIFIED_LIVE');
  assert.equal(liveInspection.liveVerified, false);

  const displayAdapter = new AdsterraDisplayAdapter();
  assert.equal(displayAdapter.integrationState, 'IMPLEMENTED_SANDBOX_ONLY');

  // Outside test mode, placeholder URLs must NEVER serve fake ads — guaranteed fail-open NO_FILL
  const prodVast = new VastAdProviderAdapter('vast-prod', 'Prod VAST', { nodeEnv: 'production' });
  const prodRes = await prodVast.requestAd(
    { placement: 'PRE_ROLL', videoId: VIDEO_ID },
    { vastTagUrl: 'https://adsterra.example/vast?cb=[timestamp]' }
  );
  assert.ok(prodRes);
  assert.equal(prodRes.decision, 'NO_FILL');
  assert.equal(prodRes.fallbackAction, 'FAIL_OPEN');

  const prodDirect = new DirectAdvertiserAdapter('dir-prod', 'Prod Direct', { nodeEnv: 'production' });
  const directRes = await prodDirect.requestAd(
    { placement: 'PRE_ROLL', videoId: VIDEO_ID },
    {
      campaign: {
        id: 'c1',
        title: 'Placeholder Promo',
        targetUrl: 'https://advertiser.example/deal',
      },
    }
  );
  assert.ok(directRes);
  assert.equal(directRes.decision, 'NO_FILL');
  assert.equal(directRes.fallbackAction, 'FAIL_OPEN');
});

test('POST /decision fails open cleanly on eligibility DB outage, missing videoId on PRE_ROLL, and placement filtering', async () => {
  const dbWithMidRollOnly = {
    adProviderConfig: {
      async findMany() {
        return [
          {
            id: 'mid-1',
            name: 'MidRoll Only Net',
            vastTagUrl: 'https://verified-network.net/midroll?cb=[timestamp]',
            priority: 1,
            isEnabled: true,
            format: 'MID_ROLL',
            providerType: 'VAST_GENERIC',
            supportedPlacements: ['MID_ROLL'],
          },
        ];
      },
    },
    video: {
      async findUnique() {
        return {
          id: VIDEO_ID,
          title: 'Eligible Video',
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          isShort: false,
          copyrightReviewStatus: 'CLEARED',
          channel: {
            id: CHANNEL_ID,
            isMonetized: true,
            user: { id: CREATOR_ID, status: 'GOOD_STANDING', strikes: [] },
          },
        };
      },
    },
  };

  // Case A: Eligibility throws DB exception -> must still fail open 200 NO_FILL (never crash playback!)
  const appOutage = express();
  appOutage.use(express.json());
  appOutage.use(
    '/api/v1/monetization',
    createAdDecisionRouter({
      prismaClient: dbWithMidRollOnly,
      secret: ADS_SECRET,
      async checkEligibility() {
        throw new Error('ECONNREFUSED PostgreSQL unreachable');
      },
    })
  );
  const outageUrl = await startTestHttpServer(appOutage);

  const outageRes = await fetch(`${outageUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ placement: 'PRE_ROLL', videoId: VIDEO_ID }),
  });
  assert.equal(outageRes.status, 200);
  const outageBody: any = await outageRes.json();
  assert.equal(outageBody.decision, 'NO_FILL');
  assert.equal(outageBody.fallbackAction, 'FAIL_OPEN');

  // Case B: Placement isolation (MID_ROLL DB provider must NOT fill PRE_ROLL) & missing videoId fail-open
  const appNormal = express();
  appNormal.use(express.json());
  appNormal.use(
    '/api/v1/monetization',
    createAdDecisionRouter({
      prismaClient: dbWithMidRollOnly,
      secret: ADS_SECRET,
    })
  );
  const normalUrl = await startTestHttpServer(appNormal);

  const missingVidRes = await fetch(`${normalUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ placement: 'PRE_ROLL' }),
  });
  assert.equal(missingVidRes.status, 200);
  assert.equal((await missingVidRes.json()).decision, 'NO_FILL');

  const preRollNoFill = await fetch(`${normalUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ placement: 'PRE_ROLL', videoId: VIDEO_ID }),
  });
  assert.equal(preRollNoFill.status, 200);
  assert.equal((await preRollNoFill.json()).decision, 'NO_FILL');

  const midRollServe = await fetch(`${normalUrl}/api/v1/monetization/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ placement: 'MID_ROLL', videoId: VIDEO_ID }),
  });
  assert.equal(midRollServe.status, 200);
  const midJson: any = await midRollServe.json();
  assert.equal(midJson.decision, 'SERVE');
  assert.equal(midJson.provider, 'MidRoll Only Net');
});

test('POST /ad-event blocks late telemetry when content becomes copyright-blocked without consuming nonce', async () => {
  const nonceStore = new InMemoryAdTelemetryNonceStore();
  let blocked = false;
  const createdEvents: any[] = [];

  const mockPrisma = {
    video: {
      async findUnique() {
        return {
          id: VIDEO_ID,
          status: blocked ? 'BLOCKED' : 'PUBLISHED',
          visibility: blocked ? 'PRIVATE' : 'PUBLIC',
          copyrightReviewStatus: blocked ? 'BLOCKED' : 'CLEARED',
          channel: { id: CHANNEL_ID, isMonetized: true },
        };
      },
    },
    adEvent: {
      async create({ data }: any) {
        createdEvents.push(data);
        return { id: 'ev-1', ...data };
      },
    },
  };

  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req, _res, next) => {
    (req as any).user = { id: CREATOR_ID, role: 'USER' };
    next();
  };
  app.use(
    '/api/v1/monetization',
    createAdEventRouter(auth, {
      nonceStore,
      prismaClient: mockPrisma,
      secret: ADS_SECRET,
    })
  );
  const baseUrl = await startTestHttpServer(app);

  const token = signAdToken(
    {
      decisionId: 'dec-late-1',
      sessionId: 'sess-late-block-1',
      placement: 'PRE_ROLL',
      provider: 'Verified Net',
      adId: 'ad-1',
      videoId: VIDEO_ID,
      channelId: CHANNEL_ID,
      timestamp: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    ADS_SECRET
  );

  blocked = true;
  const res = await fetch(`${baseUrl}/api/v1/monetization/ad-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, eventType: 'AD_IMPRESSION' }),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'CONTENT_NOT_ELIGIBLE');
  assert.equal(createdEvents.length, 0);
  assert.equal(nonceStore.isEventConsumed('sess-late-block-1', 'AD_IMPRESSION'), false);
});

// =============================================================================
// 2. Revenue Attribution Atomicity, Concurrent Escrow Races & IVT Clawbacks
// =============================================================================

test('RevenueAttributionService pre-validates batches atomically, deduplicates concurrent escrow races, and handles IVT clawbacks', async () => {
  const VIDEO_STD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const VIDEO_ESCROW = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const VIDEO_SHORT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const ledgerRepo = new InMemoryWalletLedgerRepository([CHANNEL_ID]);
  const ledger = new WalletLedgerService(ledgerRepo);

  const persistedLines = new Map<
    string,
    {
      id: string;
      channelId: string;
      videoId: string;
      creatorAttributableCents: bigint;
      ledgerReferenceId: string | null;
      status: string;
    }
  >();
  const reconciliations: any[] = [];
  let simulateConcurrentRaceOnKey: string | null = null;

  const repo: IRevenueAttributionRepository = {
    async getShortsRateBasisPoints() {
      return 3000;
    },
    async findVideoAttributionContext(videoId): Promise<VideoAttributionContext | null> {
      if (videoId === VIDEO_STD || videoId === VIDEO_SHORT || videoId === VIDEO_ESCROW) {
        return {
          id: videoId,
          channelId: CHANNEL_ID,
          isShort: videoId === VIDEO_SHORT,
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          copyrightReviewStatus: 'CLEARED',
          channelIsMonetized: true,
          hasActiveEscrowHold: videoId === VIDEO_ESCROW,
        };
      }
      return null;
    },
    async findMatchingTelemetryEvents({ videoId }): Promise<RecordedAdEventSnapshot[]> {
      return [
        {
          id: `imp-${videoId}`,
          videoId,
          channelId: CHANNEL_ID,
          eventType: 'AD_IMPRESSION',
          provider: 'Verified Ads',
          grossRevenueCents: 0n,
          sessionId: `sess-${videoId}`,
          createdAt: new Date(),
        },
      ];
    },
    async hasAttributionLine(provider, periodMonth, externalReportId) {
      return persistedLines.has(`${provider}::${periodMonth}::${externalReportId}`);
    },
    async findAttributionLine(provider, periodMonth, externalReportId) {
      return persistedLines.get(`${provider}::${periodMonth}::${externalReportId}`) ?? null;
    },
    async recordAttributionLines(reconId, lines: PersistAttributionLineInput[]) {
      let insertedCount = 0;
      const duplicateKeys: string[] = [];
      for (const line of lines) {
        const key = `${line.provider}::${line.periodMonth}::${line.externalReportId}`;
        if (persistedLines.has(key) || simulateConcurrentRaceOnKey === key) {
          duplicateKeys.push(key);
          continue;
        }
        persistedLines.set(key, {
          id: `attr-line-${persistedLines.size + 1}`,
          channelId: line.channelId,
          videoId: line.videoId,
          creatorAttributableCents: line.creatorAttributableCents,
          ledgerReferenceId: line.ledgerReferenceId,
          status: line.status,
        });
        insertedCount += 1;
      }
      return { insertedCount, duplicateKeys };
    },
    async createReconciliationRecord(input) {
      const rec = { id: `rec-${reconciliations.length + 1}`, ...input };
      reconciliations.push(rec);
      return { id: rec.id };
    },
    async updateReconciliationTotals(id, totals) {
      const rec = reconciliations.find((r) => r.id === id);
      if (rec) Object.assign(rec, totals);
    },
    async updateReconciliationStatus(id, status) {
      const rec = reconciliations.find((r) => r.id === id);
      if (rec) rec.status = status;
    },
  };

  const audits: any[] = [];
  const service = new RevenueAttributionService(repo, ledger, async (ev) => {
    audits.push(ev);
  });

  // 1. Atomic pre-validation: report[1] is CLIENT_TELEMETRY -> report[0] must NOT be credited
  await assert.rejects(
    () =>
      service.reconcileVerifiedReports({
        periodMonth: '2026-11',
        policy: { creatorShareBasisPoints: 5000 },
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
        reports: [
          {
            sourceType: 'PROVIDER_REPORT',
            externalReportId: 'rep-atomic-1',
            provider: 'Verified Ads',
            periodMonth: '2026-11',
            videoId: VIDEO_STD,
            channelId: CHANNEL_ID,
            reportedGrossRevenueCents: '1000',
            currency: 'RWF',
          },
          {
            sourceType: 'CLIENT_TELEMETRY',
            externalReportId: 'rep-atomic-bad',
            provider: 'Verified Ads',
            periodMonth: '2026-11',
            videoId: VIDEO_STD,
            channelId: CHANNEL_ID,
            reportedGrossRevenueCents: '500',
            currency: 'RWF',
          },
        ],
      }),
    (err: unknown) => err instanceof AttributionValidationError && err.code === 'CLIENT_TELEMETRY_CANNOT_PROVE_REVENUE'
  );
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 0n);

  // 2. Concurrent / race simulation on 0n-credit escrow-held line prevents inflated RevenueReconciliation sums
  simulateConcurrentRaceOnKey = 'Verified Ads::2026-11::rep-escrow-race';
  const raceBatch = await service.reconcileVerifiedReports({
    periodMonth: '2026-11',
    policy: { creatorShareBasisPoints: 5000 },
    actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
    reports: [
      {
        sourceType: 'PROVIDER_REPORT',
        externalReportId: 'rep-std-keep',
        provider: 'Verified Ads',
        periodMonth: '2026-11',
        videoId: VIDEO_STD,
        channelId: CHANNEL_ID,
        reportedGrossRevenueCents: '1000',
        providerFeeCents: '0',
        invalidTrafficDeductionCents: '100',
        currency: 'RWF',
      },
      {
        sourceType: 'PROVIDER_REPORT',
        externalReportId: 'rep-escrow-race',
        provider: 'Verified Ads',
        periodMonth: '2026-11',
        videoId: VIDEO_ESCROW,
        channelId: CHANNEL_ID,
        reportedGrossRevenueCents: '2000',
        currency: 'RWF',
      },
    ],
  });
  simulateConcurrentRaceOnKey = null;

  assert.equal(raceBatch.verifiedLineCount, 1);
  assert.equal(raceBatch.duplicateLineCount, 1);
  assert.equal(raceBatch.totalReportedGrossCents, 1000n);
  assert.equal(raceBatch.totalCreatorAttributableCents, 450n); // 50% of (1000 - 100)
  assert.equal(reconciliations[0].grossProviderRevenueCents, 1000n);
  assert.equal(reconciliations[0].creatorPoolCents, 450n);
  assert.equal(reconciliations[0].platformShareCents, 450n);

  // 3. Verified IVT clawback reduces balance & totalEarned idempotently without mutating historical entries
  await assert.rejects(
    () =>
      service.reverseAttributedReportLine({
        sourceType: 'PROVIDER_ADJUSTMENT',
        provider: 'Verified Ads',
        periodMonth: '2026-11',
        externalReportId: 'rep-std-keep',
        clawbackCents: 451n, // Exceeds 450n original creator share
        reason: 'Excess clawback',
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
      }),
    (err: unknown) => err instanceof AttributionValidationError && err.code === 'CLAWBACK_EXCEEDS_ATTRIBUTED_AMOUNT'
  );

  const clawback1 = await service.reverseAttributedReportLine({
    sourceType: 'PROVIDER_ADJUSTMENT',
    provider: 'Verified Ads',
    periodMonth: '2026-11',
    externalReportId: 'rep-std-keep',
    clawbackCents: 150n,
    reason: 'Post-settlement IVT adjustment from provider',
    actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
  });
  assert.equal(clawback1.duplicate, false);

  const clawbackReplay = await service.reverseAttributedReportLine({
    sourceType: 'PROVIDER_ADJUSTMENT',
    provider: 'Verified Ads',
    periodMonth: '2026-11',
    externalReportId: 'rep-std-keep',
    clawbackCents: 150n,
    reason: 'Post-settlement IVT adjustment from provider',
    actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
  });
  assert.equal(clawbackReplay.duplicate, true);

  const balAfterClawback = await ledger.getChannelBalance(CHANNEL_ID);
  assert.equal(balAfterClawback.availableBalanceCents, 300n);
  assert.equal(balAfterClawback.totalEarnedCents, 300n);
  assert.equal(balAfterClawback.integrityVerified, true);
});

// =============================================================================
// 3. Concurrent Wallet Updates, Refunds/Reversals & /wallet/webhooks Security
// =============================================================================

test('Ledger handles mixed concurrent credits and payout reservations without race corruption and accounts PAID payout reversals cleanly', async () => {
  const repo = new InMemoryWalletLedgerRepository([CHANNEL_ID]);
  const ledger = new WalletLedgerService(repo);
  await ledger.creditRevenue({ channelId: CHANNEL_ID, amountCents: 10_000n, referenceId: 'seed:1' });

  // Fire 5 concurrent credits (+1000) and 8 concurrent payouts (-2000)
  const ops = [
    ...Array.from({ length: 5 }, (_, i) =>
      ledger.creditRevenue({ channelId: CHANNEL_ID, amountCents: 1_000n, referenceId: `conc-cred:${i}` })
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      ledger.reservePayout({ channelId: CHANNEL_ID, payoutId: `conc-pay-${i}`, amountCents: 2_000n })
    ),
  ];
  await Promise.allSettled(ops);

  const midBal = await ledger.getChannelBalance(CHANNEL_ID);
  assert.equal(midBal.integrityVerified, true, midBal.integrityError);
  assert.equal(midBal.totalEarnedCents, 15_000n);
  assert.equal(
    midBal.totalEarnedCents - midBal.pendingPayoutCents - midBal.totalPaidOutCents,
    midBal.availableBalanceCents
  );

  // Finalize one payout as PAID, then reverse it via payout:reversal:
  await ledger.finalizePayoutSuccess({ channelId: CHANNEL_ID, payoutId: 'conc-pay-0' });
  const beforeRev = await ledger.getChannelBalance(CHANNEL_ID);
  assert.equal(beforeRev.totalPaidOutCents, 2_000n);

  await ledger.recordAdjustmentOrReversal({
    channelId: CHANNEL_ID,
    referenceId: 'payout:reversal:conc-pay-0',
    deltaCents: 2_000n,
    status: 'AVAILABLE',
  });
  const afterRev = await ledger.getChannelBalance(CHANNEL_ID);
  assert.equal(afterRev.totalPaidOutCents, 0n);
  assert.equal(afterRev.totalReversedPayoutCents, 2_000n);
  assert.equal(afterRev.availableBalanceCents, beforeRev.availableBalanceCents + 2_000n);
  assert.equal(afterRev.integrityVerified, true);
});

test('PaymentOrchestrator & /wallet/webhooks handle PAID->REFUNDED/REVERSED webhooks, terminal conflicts, and insufficient-funds refunds safely', async () => {
  const repo = new InMemoryWalletLedgerRepository([CHANNEL_ID]);
  const ledger = new WalletLedgerService(repo);
  await ledger.creditRevenue({ channelId: CHANNEL_ID, amountCents: 5_000n, referenceId: 'seed:momo' });

  const mtnMock = new MockMtnMoMoSandboxAdapter();
  const orchestrator = new PaymentOrchestratorService({
    ledger,
    store: new InMemoryPaymentTransactionStore(),
    adapters: { MTN_MOMO: mtnMock },
    eligibilityChecker: {
      async checkEligibility() {
        return { eligible: true, channelId: CHANNEL_ID };
      },
    },
    auditRecorder: async () => {},
  });

  // 1. Check readiness reporting marks unconfigured Airtel as BLOCKED
  const statusList = orchestrator.getProvidersStatus();
  const airtelStatus = statusList.find((s) => s.provider === 'AIRTEL_MONEY');
  assert.ok(airtelStatus);
  assert.equal(airtelStatus.configured, false);
  assert.equal(airtelStatus.readinessStatus, 'BLOCKED');
  assert.ok(airtelStatus.blockers.length > 0);

  // 2. Adapters fail closed on webhook signature verification outside test mode when transport missing
  const prodMtn = new MtnMoMoAdapter({
    nodeEnv: 'production',
    subscriptionKey: 'sub',
    apiUser: 'usr',
    apiKey: 'key',
    webhookSecret: 'fallback-should-not-verify-without-transport',
  });
  assert.equal(prodMtn.isConfigured(), false);
  const sigRes = await prodMtn.verifyWebhookSignature({ 'x-callback-signature': 'anything' }, '{}');
  assert.equal(sigRes.isValid, false);
  assert.equal(prodMtn.parseWebhook({ externalId: 'ext-1', status: 'PAID', amount: '0.00' }), null);

  const prodAirtel = new AirtelMoneyAdapter({
    nodeEnv: 'production',
    clientId: 'cid',
    clientSecret: 'csec',
    webhookSecret: 'fallback-should-not-verify-without-transport',
  });
  assert.equal(prodAirtel.isConfigured(), false);
  const airtelSigRes = await prodAirtel.verifyWebhookSignature({ 'x-airtel-signature': 'anything' }, '{}');
  assert.equal(airtelSigRes.isValid, false);
  assert.equal(
    prodAirtel.parseWebhook({ transaction: { id: 'tx-1', status_code: 'TS', amount: '0' } }),
    null
  );

  // 3. HTTP /api/v1/wallet router webhook verification + payout lifecycle + reversal
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  const auth: RequestHandler = (req, _res, next) => {
    (req as any).user = { id: CREATOR_ID, role: 'USER' };
    next();
  };
  app.use(
    '/api/v1/wallet',
    createWalletRouter({
      prismaClient: {
        channel: {
          async findFirst() {
            return { id: CHANNEL_ID };
          },
        },
      },
      ledgerService: ledger,
      orchestrator,
      authenticateMiddleware: auth,
    })
  );
  const baseUrl = await startTestHttpServer(app);

  // Unknown provider webhook -> 404
  const unknownWh = await fetch(`${baseUrl}/api/v1/wallet/webhooks/unknown_telco`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(unknownWh.status, 404);

  // Request payout -> 202 PENDING (balance drops from 5000 to 2000)
  const payoutRes = await fetch(`${baseUrl}/api/v1/wallet/request-payout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'wh-wallet-payout-1' },
    body: JSON.stringify({
      provider: 'MTN_MOMO',
      amountCents: 3000,
      phoneNumber: '0788123456',
    }),
  });
  assert.equal(payoutRes.status, 202);
  const payoutJson: any = await payoutRes.json();

  // Signed PAID webhook settles payout -> 200
  const paidWhPayload = {
    webhookEventId: 'wh-wallet-paid-1',
    providerReference: payoutJson.providerReference,
    internalReference: payoutJson.payoutId,
    status: 'PAID',
    amountCents: '3000',
    currency: 'RWF',
  };
  const paidSigned = mtnMock.signMockWebhookPayload(paidWhPayload);

  // Invalid signature rejected with 401 on /wallet/webhooks/mtn_momo
  const badSigWh = await fetch(`${baseUrl}/api/v1/wallet/webhooks/mtn_momo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-watchtube-mock-signature': 'tampered' },
    body: paidSigned.rawBody,
  });
  assert.equal(badSigWh.status, 401);

  const okPaidWh = await fetch(`${baseUrl}/api/v1/wallet/webhooks/mtn_momo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...paidSigned.headers },
    body: paidSigned.rawBody,
  });
  assert.equal(okPaidWh.status, 200);
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).totalPaidOutCents, 3000n);

  // Conflicting PAID -> FAILED webhook must fail closed with 409 (not silently return idempotent: true)
  const invalidRegPayload = {
    webhookEventId: 'wh-wallet-invalid-reg',
    providerReference: payoutJson.providerReference,
    internalReference: payoutJson.payoutId,
    status: 'FAILED',
    amountCents: '3000',
    currency: 'RWF',
  };
  const invalidRegSigned = mtnMock.signMockWebhookPayload(invalidRegPayload);
  const invalidRegRes = await fetch(`${baseUrl}/api/v1/wallet/webhooks/mtn_momo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...invalidRegSigned.headers },
    body: invalidRegSigned.rawBody,
  });
  assert.equal(invalidRegRes.status, 409);

  // Valid PAID -> REVERSED provider callback restores creator funds cleanly
  const revWhPayload = {
    webhookEventId: 'wh-wallet-rev-1',
    providerReference: payoutJson.providerReference,
    internalReference: payoutJson.payoutId,
    status: 'REVERSED',
    amountCents: '3000',
    currency: 'RWF',
    reason: 'Telco reversal after settlement',
  };
  const revSigned = mtnMock.signMockWebhookPayload(revWhPayload);
  const revRes = await fetch(`${baseUrl}/api/v1/wallet/webhooks/mtn_momo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...revSigned.headers },
    body: revSigned.rawBody,
  });
  assert.equal(revRes.status, 200);
  const revBal = await ledger.getChannelBalance(CHANNEL_ID);
  assert.equal(revBal.availableBalanceCents, 5000n);
  assert.equal(revBal.totalPaidOutCents, 0n);
  assert.equal(revBal.totalReversedPayoutCents, 3000n);

  // 4. Inbound payment refund guard: rejects 409 BEFORE calling provider when creator already spent funds
  const inbound = await orchestrator.initiatePayment({
    userId: CREATOR_ID,
    channelId: CHANNEL_ID,
    provider: 'MTN_MOMO',
    amountCents: 2_000n,
    phoneNumber: '0788123456',
    idempotencyKey: 'idem-in-guard-1',
    description: 'Channel support',
  });
  mtnMock.setSimulatedStatus(inbound.transaction.providerReference, 'PAID');
  const inPaidPayload = {
    webhookEventId: 'wh-in-guard-paid',
    eventType: 'PAYMENT',
    providerReference: inbound.transaction.providerReference,
    internalReference: inbound.transaction.transactionId,
    status: 'PAID',
    amountCents: '2000',
    currency: 'RWF',
  };
  const inPaidSigned = mtnMock.signMockWebhookPayload(inPaidPayload);
  await orchestrator.processWebhook({
    provider: 'MTN_MOMO',
    headers: inPaidSigned.headers,
    rawBody: inPaidSigned.rawBody,
    parsedBody: inPaidPayload,
  });
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, 7_000n);

  // Creator withdraws 6,000 -> leaves 1,000 available
  await ledger.reservePayout({ channelId: CHANNEL_ID, payoutId: 'withdraw-6k', amountCents: 6_000n });

  await assert.rejects(
    () =>
      orchestrator.initiateRefundOrReversal({
        transactionId: inbound.transaction.transactionId,
        reason: 'Customer refund',
        idempotencyKey: 'idem-refund-insufficient',
        actor: { id: OWNER_ID, role: 'SUPER_ADMIN' },
      }),
    (err: unknown) => err instanceof InsufficientFundsError && err.statusCode === 409
  );
  // Original payment remains PAID (not desynced to REFUNDED)
  assert.equal((await orchestrator.getTransaction(inbound.transaction.transactionId))?.status, 'PAID');

  // External mandatory provider REFUNDED webhook still reconciles & debits ledger cleanly
  const extRefundPayload = {
    webhookEventId: 'wh-in-guard-refunded',
    eventType: 'REFUND',
    providerReference: inbound.transaction.providerReference,
    internalReference: inbound.transaction.transactionId,
    status: 'REFUNDED',
    amountCents: '2000',
    currency: 'RWF',
    reason: 'Chargeback settled by telco',
  };
  const extRefundSigned = mtnMock.signMockWebhookPayload(extRefundPayload);
  const extRefundRes = await orchestrator.processWebhook({
    provider: 'MTN_MOMO',
    headers: extRefundSigned.headers,
    rawBody: extRefundSigned.rawBody,
    parsedBody: extRefundPayload,
  });
  assert.equal(extRefundRes.status, 'REFUNDED');
  assert.equal((await orchestrator.getTransaction(inbound.transaction.transactionId))?.status, 'REFUNDED');
  assert.equal((await ledger.getChannelBalance(CHANNEL_ID)).availableBalanceCents, -1_000n);
});

test('GET /config excludes placeholder URLs outside test mode cleanly', async () => {
  const prevEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const app = express();
    app.use(
      '/api/v1/monetization',
      createAdConfigRouter(async () => {
        const rows = [
          { id: '1', name: 'Placeholder', vastTagUrl: 'https://adsterra.example/vast', priority: 1, isEnabled: true },
        ];
        return process.env.NODE_ENV === 'test'
          ? rows
          : rows.filter((r) => !isPlaceholderAdUrl(r.vastTagUrl));
      })
    );
    const url = await startTestHttpServer(app);
    const res = await fetch(`${url}/api/v1/monetization/config`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      enabled: false,
      providers: [],
      adSkipOffsetSeconds: 5,
    });
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

test('createMonetizationRouter exposes unconfigured reconciliation 501 cleanly', async () => {
  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req, _res, next) => {
    (req as any).user = { id: OWNER_ID, role: 'SUPER_ADMIN' };
    next();
  };
  app.use(
    '/api/v1/monetization',
    createMonetizationRouter({
      allowInMemoryNonceStore: true,
      secret: ADS_SECRET,
      authenticateMiddleware: auth,
      requireAdminMiddleware: (_req, _res, next) => next(),
      loadProviders: async () => [],
    })
  );
  const url = await startTestHttpServer(app);
  const res = await fetch(`${url}/api/v1/monetization/reconcile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ periodMonth: '2026-11', reports: [{}] }),
  });
  assert.equal(res.status, 501);
});
