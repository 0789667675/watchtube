import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import express, { RequestHandler } from 'express';
import IORedis from 'ioredis';
import { after, before, describe, test } from 'node:test';
import { PrismaClient } from '@watchtube/database';
import {
  createAdDecisionRouter,
  createAdEventRouter,
  createRevenueReconciliationRouter,
} from '../src/routes/monetization.route';
import { createWalletRouter } from '../src/routes/wallet.route';
import {
  AdDecisionEngine,
  AttributionPolicyError,
  PrismaRevenueAttributionRepository,
  RedisAdTelemetryNonceStore,
  RevenueAttributionService,
  VastAdProviderAdapter,
  verifyAdToken,
} from '../src/services/advertising';
import {
  InsufficientFundsError,
  LEDGER_CURRENCY,
  PayoutConflictError,
  PrismaWalletLedgerRepository,
  WalletLedgerService,
} from '../src/services/finance/ledger.service';
import {
  createPrismaPayoutEligibilityChecker,
  hashMsisdn,
  MockAirtelMoneySandboxAdapter,
  MockMtnMoMoSandboxAdapter,
  OrchestratorError,
  PaymentOrchestratorService,
  PrismaPaymentTransactionStore,
} from '../src/services/payments';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function findDatabaseEnvPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'packages/database/.env'),
    path.resolve(process.cwd(), '../../packages/database/.env'),
  ];
  let cursor = __dirname;
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(cursor, 'packages/database/.env'));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseEnvValue(envFilePath: string, key: string): string | undefined {
  const raw = fs.readFileSync(envFilePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    if (k !== key) continue;
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

function resolveValidatedLocalPostgresUrl(): string {
  let candidate = process.env.WATCHTUBE_DATABASE_URL || process.env.DATABASE_URL;
  if (!candidate) {
    const envPath = findDatabaseEnvPath();
    if (envPath) {
      candidate = parseEnvValue(envPath, 'WATCHTUBE_DATABASE_URL') || parseEnvValue(envPath, 'DATABASE_URL');
    }
  }
  if (!candidate) {
    throw new Error('Local PostgreSQL URL unavailable for Workstream C integration test.');
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Invalid PostgreSQL connection URL format.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`Unsupported database protocol: ${parsed.protocol}`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Refusing non-loopback PostgreSQL host (${parsed.hostname}) in integration test.`);
  }
  return candidate;
}

async function probeLocalRedis(host = '127.0.0.1', port = 6379): Promise<IORedis | null> {
  const client = new IORedis({
    host,
    port,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  client.on('error', () => {
    // Expected when Redis is unavailable
  });
  try {
    await client.connect();
    const pong = await client.ping();
    if (pong === 'PONG') return client;
    client.disconnect();
    return null;
  } catch {
    client.disconnect();
    return null;
  }
}

const activeServers: Server[] = [];

async function startHttpServer(app: express.Express): Promise<{ baseUrl: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    activeServers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const TEST_ADS_SECRET = 'wsc-ads-hmac-secret-separate-from-jwt-32chars';

describe('Workstream C: Real PostgreSQL & Redis Financial Persistence Integration', { timeout: 60_000 }, () => {
  const runSuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const userId = crypto.randomUUID();
  const adminUserId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  const standardVideoId = crypto.randomUUID();
  const shortsVideoId = crypto.randomUUID();
  const heldVideoId = crypto.randomUUID();
  const copyrightClaimId = crypto.randomUUID();
  const escrowHoldId = crypto.randomUUID();

  const createdReconIds: string[] = [];
  const createdAdSessions: string[] = [];
  const createdRedisKeys: string[] = [];

  let prisma: PrismaClient;
  let dbReady = false;
  let redisClient: IORedis | null = null;

  before(async () => {
    const localUrl = resolveValidatedLocalPostgresUrl();
    prisma = new PrismaClient({
      datasources: { db: { url: localUrl } },
    });

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      dbReady = false;
      return;
    }

    redisClient = await probeLocalRedis();

    await prisma.user.createMany({
      data: [
        {
          id: userId,
          email: `wsc-creator-${runSuffix}@watchtube.local`,
          passwordHash: 'test-hash-not-used',
          role: 'USER',
          status: 'GOOD_STANDING',
        },
        {
          id: adminUserId,
          email: `wsc-owner-${runSuffix}@watchtube.local`,
          passwordHash: 'test-hash-not-used',
          role: 'SUPER_ADMIN',
          status: 'GOOD_STANDING',
        },
      ],
    });

    await prisma.channel.create({
      data: {
        id: channelId,
        userId,
        handle: `@wsc_${runSuffix.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        name: 'Workstream C Test Creator',
        isMonetized: true,
      },
    });

    await prisma.video.createMany({
      data: [
        {
          id: standardVideoId,
          channelId,
          isShort: false,
          title: 'WSC Long-Form Video',
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          duration: 300,
          copyrightReviewStatus: 'NOT_SCANNED',
        },
        {
          id: shortsVideoId,
          channelId,
          isShort: true,
          title: 'WSC Short Video',
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          duration: 42,
          copyrightReviewStatus: 'NOT_SCANNED',
        },
        {
          id: heldVideoId,
          channelId,
          isShort: false,
          title: 'WSC Escrow Held Video',
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          duration: 210,
          copyrightReviewStatus: 'NOT_SCANNED',
        },
      ],
    });

    await prisma.copyrightClaim.create({
      data: {
        id: copyrightClaimId,
        claimantId: adminUserId,
        videoId: heldVideoId,
        description: 'Workstream C escrow test claim',
        status: 'OPEN',
      },
    });

    await prisma.escrowHold.create({
      data: {
        id: escrowHoldId,
        videoId: heldVideoId,
        claimId: copyrightClaimId,
        heldAmountCents: 0n,
        status: 'HELD',
      },
    });
  });

  after(async () => {
    for (const s of activeServers.splice(0, activeServers.length)) {
      await closeHttpServer(s).catch(() => {});
    }

    if (redisClient) {
      if (createdRedisKeys.length > 0) {
        await redisClient.del(...createdRedisKeys).catch(() => {});
      }
      await redisClient.quit().catch(() => {});
    }

    if (prisma && dbReady) {
      // Strict reverse foreign-key deletion of ONLY this test run's isolated records
      await prisma.adRevenueAttributionLine.deleteMany({ where: { channelId } }).catch(() => {});
      if (createdReconIds.length > 0) {
        await prisma.revenueReconciliation.deleteMany({ where: { id: { in: createdReconIds } } }).catch(() => {});
      }
      await prisma.escrowHold.deleteMany({ where: { id: escrowHoldId } }).catch(() => {});
      await prisma.copyrightClaim.deleteMany({ where: { id: copyrightClaimId } }).catch(() => {});
      await prisma.adEvent.deleteMany({ where: { channelId } }).catch(() => {});
      await prisma.paymentWebhookEvent.deleteMany({
        where: {
          OR: [
            { paymentTransaction: { userId } },
            { providerReference: { startsWith: 'wsc-' } },
          ],
        },
      }).catch(() => {});
      await prisma.paymentTransaction.deleteMany({
        where: { userId, parentTransactionId: { not: null } },
      }).catch(() => {});
      await prisma.paymentTransaction.deleteMany({
        where: { userId },
      }).catch(() => {});
      await prisma.walletTransaction.deleteMany({ where: { channelId } }).catch(() => {});
      await prisma.adminAuditLog.deleteMany({
        where: { actorId: { in: [userId, adminUserId] } },
      }).catch(() => {});
      await prisma.video.deleteMany({ where: { channelId } }).catch(() => {});
      await prisma.channel.deleteMany({ where: { id: channelId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: [userId, adminUserId] } } }).catch(() => {});
    }

    if (prisma) {
      await prisma.$disconnect().catch(() => {});
    }
  });

  test('1. Wallet Ledger on real PostgreSQL: append-only, FOR UPDATE concurrency, rollback, reversal & settlement', async (t) => {
    if (!dbReady) {
      t.skip('Local PostgreSQL unavailable');
      return;
    }

    const ledgerRepo = new PrismaWalletLedgerRepository(prisma);
    const ledger = new WalletLedgerService(ledgerRepo);

    // 1a. Append-only credits & BigInt precision
    const c1 = await ledger.creditRevenue({
      channelId,
      amountCents: 10_000n,
      referenceId: `wsc-seed-1-${runSuffix}`,
      status: 'AVAILABLE',
    });
    assert.equal(c1.duplicate, false);
    assert.equal(c1.entry.balanceAfterCents, 10_000n);

    const c2 = await ledger.creditRevenue({
      channelId,
      amountCents: 2_500n,
      referenceId: `wsc-seed-2-${runSuffix}`,
      status: 'AVAILABLE',
    });
    assert.equal(c2.entry.balanceAfterCents, 12_500n);

    // Reject insufficient funds cleanly without mutating DB
    await assert.rejects(
      () =>
        ledger.reservePayout({
          channelId,
          payoutId: `wsc-overdraw-${runSuffix}`,
          amountCents: 15_000n,
        }),
      (err: any) => err instanceof InsufficientFundsError && err.statusCode === 409
    );

    // Verify PostgreSQL ACID rollback leaves zero partial entries on transaction error
    const txCountBeforeRollback = await prisma.walletTransaction.count({ where: { channelId } });
    await assert.rejects(
      () =>
        ledgerRepo.withChannelLock(channelId, async (ctx) => {
          await ctx.appendEntry({
            channelId,
            transactionType: 'ADJUSTMENT',
            amountCents: 99_999n,
            balanceAfterCents: 112_499n,
            referenceId: `wsc-rollback-${runSuffix}`,
            status: 'AVAILABLE',
          });
          throw new Error('Simulated crash after appendEntry inside PostgreSQL transaction');
        }),
      /Simulated crash/
    );
    const txCountAfterRollback = await prisma.walletTransaction.count({ where: { channelId } });
    assert.equal(txCountAfterRollback, txCountBeforeRollback);

    // 1b. Concurrent payout reservations serialized via PostgreSQL FOR UPDATE row lock
    const concurrentIds = Array.from({ length: 6 }, (_, idx) => `wsc-conc-${idx}-${runSuffix}`);
    const results = await Promise.allSettled(
      concurrentIds.map((payoutId) =>
        ledger.reservePayout({
          channelId,
          payoutId,
          amountCents: 3_000n,
        })
      )
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<
      PromiseFulfilledResult<Awaited<ReturnType<WalletLedgerService['reservePayout']>>>
    >;
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    assert.equal(fulfilled.length, 4, 'Only 4 x 3,000 = 12,000 RWF fits within 12,500 RWF balance');
    assert.equal(rejected.length, 2);
    for (const r of rejected) {
      assert.ok(r.reason instanceof InsufficientFundsError);
    }

    // Determine which payout IDs actually won the row lock
    const winningPayoutIds: string[] = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') winningPayoutIds.push(concurrentIds[i]);
    }

    // Duplicate payout reservation protection
    const replay = await ledger.reservePayout({
      channelId,
      payoutId: winningPayoutIds[0],
      amountCents: 3_000n,
    });
    assert.equal(replay.duplicate, true);
    await assert.rejects(
      () =>
        ledger.reservePayout({
          channelId,
          payoutId: winningPayoutIds[0],
          amountCents: 2_999n,
        }),
      (err: any) => err instanceof PayoutConflictError && err.code === 'IDEMPOTENCY_CONFLICT'
    );

    // Settle winningPayoutIds[0] as PAID, reverse winningPayoutIds[1] as FAILED, settle 2 and 3
    await ledger.finalizePayoutSuccess({ channelId, payoutId: winningPayoutIds[0] });
    const rev = await ledger.failAndReversePayout({ channelId, payoutId: winningPayoutIds[1] });
    assert.equal(rev.alreadyReversed, false);
    assert.equal(rev.reversalEntry.amountCents, 3_000n);
    await ledger.finalizePayoutSuccess({ channelId, payoutId: winningPayoutIds[2] });
    await ledger.finalizePayoutSuccess({ channelId, payoutId: winningPayoutIds[3] });

    // Integrity check + running balance verification across PostgreSQL rows
    const derived = await ledger.getChannelBalance(channelId);
    assert.equal(derived.integrityVerified, true, derived.integrityError);
    assert.equal(derived.availableBalanceCents, 3_500n); // 12,500 - 12,000 + 3,000 reversed
    assert.equal(derived.pendingPayoutCents, 0n);
    assert.equal(derived.totalEarnedCents, 12_500n);
    assert.equal(derived.totalPaidOutCents, 9_000n);
    assert.equal(derived.totalReversedPayoutCents, 3_000n);

    // HTTP route check backed by live PostgreSQL wallet service
    const authCreator: RequestHandler = (req: any, _res, next) => {
      req.user = { id: userId, role: 'USER' };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use('/api/wallet', createWalletRouter({ prismaClient: prisma, ledgerService: ledger, authenticateMiddleware: authCreator }));
    const { baseUrl, server } = await startHttpServer(app);
    try {
      const balRes = await fetch(`${baseUrl}/api/wallet/balance`);
      assert.equal(balRes.status, 200);
      const balBody: any = await balRes.json();
      assert.equal(balBody.availableBalanceCents, '3500');
      assert.equal(balBody.currency, LEDGER_CURRENCY);

      const ledRes = await fetch(`${baseUrl}/api/wallet/ledger`);
      assert.equal(ledRes.status, 200);
      const ledBody: any[] = await ledRes.json();
      assert.ok(ledBody.length >= 10);
    } finally {
      await closeHttpServer(server);
    }
  });

  test('2. Advertising DB + live Redis integration: AD_SERVED, ordered client events, replay, persistence failure, attribution cross-ref', async (t) => {
    if (!dbReady || !redisClient) {
      t.skip('Local PostgreSQL or local Redis unavailable');
      return;
    }

    const prefixA = `wsc:ad:nonce:${runSuffix}:`;
    const authUser: RequestHandler = (req: any, _res, next) => {
      req.user = { id: userId, role: 'USER' };
      next();
    };

    const buildApp = (opts: { redis: IORedis; prismaOverride?: any }) => {
      const engine = new AdDecisionEngine({ tokenSecret: TEST_ADS_SECRET });
      engine.registerProvider(
        new VastAdProviderAdapter('vast-wsc-1', 'WSC-VAST-Provider'),
        1,
        true,
        { vastTagUrl: 'https://ads.watchtube.local/vast.xml' }
      );
      const nonceStore = new RedisAdTelemetryNonceStore(opts.redis, prefixA);
      const dbObj = opts.prismaOverride ?? prisma;
      const app = express();
      app.use(express.json());
      app.use(createAdDecisionRouter({ engine, prismaClient: dbObj, secret: TEST_ADS_SECRET }));
      app.use(createAdEventRouter(authUser, { nonceStore, prismaClient: dbObj, secret: TEST_ADS_SECRET }));
      return app;
    };

    const { baseUrl: baseUrlA, server: serverA } = await startHttpServer(buildApp({ redis: redisClient }));
    // Second Redis connection + HTTP server instance simulating restarted / horizontally scaled API process
    const redisB = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
    const { baseUrl: baseUrlB, server: serverB } = await startHttpServer(buildApp({ redis: redisB }));

    try {
      // 2a. Decision creates AD_SERVED row in PostgreSQL with 0n grossRevenueCents
      const decRes = await fetch(`${baseUrlA}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ placement: 'PRE_ROLL', videoId: standardVideoId }),
      });
      assert.equal(decRes.status, 200);
      const decBody: any = await decRes.json();
      assert.equal(decBody.decision, 'SERVE');
      assert.ok(decBody.trackingToken);
      assert.ok(decBody.sessionId);
      createdAdSessions.push(decBody.sessionId);
      createdRedisKeys.push(`${prefixA}${decBody.sessionId}`);

      const tokenClaims = verifyAdToken(decBody.trackingToken, TEST_ADS_SECRET);
      assert.ok(tokenClaims);
      assert.equal(tokenClaims.videoId, standardVideoId);
      assert.equal(tokenClaims.channelId, channelId);

      const servedRows = await prisma.adEvent.findMany({
        where: { videoId: standardVideoId, sessionId: decBody.sessionId },
      });
      assert.equal(servedRows.length, 1);
      assert.equal(servedRows[0].eventType, 'AD_SERVED');
      assert.equal(servedRows[0].grossRevenueCents, 0n);

      // Incorrect event order: AD_VIEWABLE before AD_IMPRESSION -> 409 + 0 new DB rows
      const outOfOrderRes = await fetch(`${baseUrlA}/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: decBody.trackingToken, eventType: 'AD_VIEWABLE' }),
      });
      assert.equal(outOfOrderRes.status, 409);

      // Client-submitted revenue -> 400 strict schema rejection
      const clientRevRes = await fetch(`${baseUrlA}/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: decBody.trackingToken,
          eventType: 'AD_IMPRESSION',
          grossRevenueCents: 999999,
        }),
      });
      assert.equal(clientRevRes.status, 400);

      // Valid lifecycle sequence: AD_LOADED -> AD_IMPRESSION -> AD_VIEWABLE -> quartiles -> AD_COMPLETED
      const sequence = [
        'AD_LOADED',
        'AD_IMPRESSION',
        'AD_VIEWABLE',
        'AD_FIRST_QUARTILE',
        'AD_MIDPOINT',
        'AD_THIRD_QUARTILE',
        'AD_COMPLETED',
      ];
      for (const evt of sequence) {
        const res = await fetch(`${baseUrlA}/ad-event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: decBody.trackingToken, eventType: evt }),
        });
        assert.equal(res.status, 200, `Expected 200 for ${evt}`);
      }

      // Replay AD_IMPRESSION on instance B after "restart" -> 409 DUPLICATE_IMPRESSION
      const replayRes = await fetch(`${baseUrlB}/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: decBody.trackingToken, eventType: 'AD_IMPRESSION' }),
      });
      assert.equal(replayRes.status, 409);
      const replayJson: any = await replayRes.json();
      assert.equal(replayJson.code, 'DUPLICATE_IMPRESSION');

      const allEvents = await prisma.adEvent.findMany({
        where: { sessionId: decBody.sessionId },
        orderBy: { createdAt: 'asc' },
      });
      assert.equal(allEvents.length, 8); // AD_SERVED + 7 distinct lifecycle events
      assert.deepEqual(
        allEvents.map((e) => e.eventType),
        ['AD_SERVED', ...sequence]
      );
      assert.ok(allEvents.every((e) => e.grossRevenueCents === 0n));

      // 2b. Persistence failure during adEvent.create fails closed 503 & releases Redis nonce so clean retry succeeds
      const decRes2 = await fetch(`${baseUrlA}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ placement: 'PRE_ROLL', videoId: shortsVideoId }),
      });
      const dec2Body: any = await decRes2.json();
      createdAdSessions.push(dec2Body.sessionId);
      createdRedisKeys.push(`${prefixA}${dec2Body.sessionId}`);

      const failingPrisma = new Proxy(prisma, {
        get(target, prop) {
          if (prop === 'adEvent') {
            return {
              ...target.adEvent,
              create: async () => {
                throw new Error('Simulated PostgreSQL write failure');
              },
            };
          }
          return (target as any)[prop];
        },
      });
      const { baseUrl: failBaseUrl, server: failServer } = await startHttpServer(
        buildApp({ redis: redisClient, prismaOverride: failingPrisma })
      );
      try {
        const failRes = await fetch(`${failBaseUrl}/ad-event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: dec2Body.trackingToken, eventType: 'AD_IMPRESSION' }),
        });
        assert.equal(failRes.status, 503);
      } finally {
        await closeHttpServer(failServer);
      }

      // Clean retry after persistence recovery succeeds & persists AD_IMPRESSION
      const retryRes = await fetch(`${baseUrlB}/ad-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: dec2Body.trackingToken, eventType: 'AD_IMPRESSION' }),
      });
      assert.equal(retryRes.status, 200);
      const shortsImpressions = await prisma.adEvent.count({
        where: { videoId: shortsVideoId, sessionId: dec2Body.sessionId, eventType: 'AD_IMPRESSION' },
      });
      assert.equal(shortsImpressions, 1);
    } finally {
      await closeHttpServer(serverA);
      await closeHttpServer(serverB);
      await redisB.quit().catch(() => {});
    }
  });

  test('3. Durable Payment & Webhook Persistence: PrismaPaymentTransactionStore across restarts, webhook hash dedup, payout reversal, refunds & nullable refs', async (t) => {
    if (!dbReady) {
      t.skip('Local PostgreSQL unavailable');
      return;
    }

    const ledger = new WalletLedgerService(new PrismaWalletLedgerRepository(prisma));
    const store1 = new PrismaPaymentTransactionStore(prisma);
    const eligibilityChecker = createPrismaPayoutEligibilityChecker(prisma);
    const dbAuditRecorder = async (input: any) => {
      await prisma.adminAuditLog.create({
        data: {
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: input.action,
          targetResource: input.targetResource,
          targetId: input.targetId ?? null,
          outcome: input.outcome ?? 'SUCCESS',
          metadata: (input.metadata ?? null) as any,
        },
      });
    };

    // 3a. Fail-closed unconfigured default adapters (even with durable Prisma store)
    const failClosedOrch = new PaymentOrchestratorService({
      ledger,
      store: store1,
      eligibilityChecker,
      auditRecorder: dbAuditRecorder,
    });
    await assert.rejects(
      () =>
        failClosedOrch.initiatePayment({
          userId,
          provider: 'MTN_MOMO',
          amountCents: 5_000n,
          currency: 'RWF',
          phoneNumber: '+250788123456',
          idempotencyKey: `unconf-pay-${runSuffix}`,
          description: 'Unconfigured check',
        }),
      (err: any) => err instanceof OrchestratorError && err.statusCode === 501
    );
    await assert.rejects(
      () =>
        failClosedOrch.initiateCreatorPayout({
          userId,
          provider: 'AIRTEL_MONEY',
          amountCents: 1_000n,
          currency: 'RWF',
          phoneNumber: '+250722123456',
          idempotencyKey: `unconf-payout-${runSuffix}`,
        }),
      (err: any) => err instanceof OrchestratorError && err.statusCode === 501
    );

    // 3b. Configure sandbox adapters with durable PrismaPaymentTransactionStore
    const timeoutKeys = new Set([`timeout-1-${runSuffix}`, `timeout-2-${runSuffix}`]);
    const mtnAdapter = new MockMtnMoMoSandboxAdapter({ simulateTimeoutOnKey: timeoutKeys });
    const airtelAdapter = new MockAirtelMoneySandboxAdapter();
    const orch1 = new PaymentOrchestratorService({
      ledger,
      store: store1,
      adapters: { MTN_MOMO: mtnAdapter, AIRTEL_MONEY: airtelAdapter },
      eligibilityChecker,
      auditRecorder: dbAuditRecorder,
      timeoutMs: 1_000,
    });

    const payIdempKey = `pay-col-${runSuffix}`;
    const initPay = await orch1.initiatePayment({
      userId,
      channelId,
      provider: 'MTN_MOMO',
      amountCents: 5_000n,
      currency: 'RWF',
      phoneNumber: '+250788123456',
      idempotencyKey: payIdempKey,
      description: 'Creator support payment',
    });
    assert.equal(initPay.idempotentReplay, false);
    assert.equal(initPay.transaction.status, 'PENDING');
    assert.ok(initPay.transaction.providerReference.length > 0);

    // Inspect persisted DB row: hash + masked phone only, NEVER raw MSISDN
    const dbPayRow = await prisma.paymentTransaction.findUnique({
      where: { transactionId: initPay.transaction.transactionId },
    });
    assert.ok(dbPayRow);
    assert.equal(dbPayRow.msisdnHash, hashMsisdn('250788123456'));
    assert.ok(!dbPayRow.maskedPhone.includes('881234'));
    assert.equal(dbPayRow.amountCents, 5_000n);

    // Simulate process restart: new store + new orchestrator reading existing PostgreSQL row
    const storeRestarted = new PrismaPaymentTransactionStore(prisma);
    const orchRestarted = new PaymentOrchestratorService({
      ledger,
      store: storeRestarted,
      adapters: { MTN_MOMO: mtnAdapter, AIRTEL_MONEY: airtelAdapter },
      eligibilityChecker,
      auditRecorder: dbAuditRecorder,
    });

    const replayPay = await orchRestarted.initiatePayment({
      userId,
      channelId,
      provider: 'MTN_MOMO',
      amountCents: 5_000n,
      currency: 'RWF',
      phoneNumber: '+250788123456',
      idempotencyKey: payIdempKey,
      description: 'Creator support payment',
    });
    assert.equal(replayPay.idempotentReplay, true);
    assert.equal(replayPay.transaction.transactionId, initPay.transaction.transactionId);

    // Idempotency key conflict with modified amount -> 409
    await assert.rejects(
      () =>
        orchRestarted.initiatePayment({
          userId,
          channelId,
          provider: 'MTN_MOMO',
          amountCents: 6_000n,
          currency: 'RWF',
          phoneNumber: '+250788123456',
          idempotencyKey: payIdempKey,
          description: 'Tampered amount',
        }),
      (err: any) => err instanceof OrchestratorError && err.statusCode === 409
    );

    // Deliver verified PAID webhook & assert PaymentWebhookEvent stores SHA-256 hash without raw payload
    const webhookId1 = `wh-mtn-pay-${runSuffix}`;
    const signedWebhook = mtnAdapter.signMockWebhookPayload({
      webhookEventId: webhookId1,
      providerReference: initPay.transaction.providerReference,
      internalReference: initPay.transaction.transactionId,
      status: 'PAID',
      amountCents: '5000',
      currency: 'RWF',
    });
    const expectedSha = crypto.createHash('sha256').update(signedWebhook.rawBody, 'utf8').digest('hex');

    const whRes1 = await orch1.processWebhook({
      provider: 'MTN_MOMO',
      headers: signedWebhook.headers,
      rawBody: signedWebhook.rawBody,
      parsedBody: JSON.parse(signedWebhook.rawBody),
    });
    assert.equal(whRes1.accepted, true);
    assert.equal(whRes1.idempotent, false);
    assert.equal(whRes1.status, 'PAID');

    const dbWebhook = await prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_webhookEventId: { provider: 'MTN_MOMO', webhookEventId: webhookId1 },
      },
    });
    assert.ok(dbWebhook);
    assert.equal(dbWebhook.payloadSha256, expectedSha);
    assert.equal(dbWebhook.paymentTransactionId, dbPayRow.id);

    // Webhook replay after restart is idempotent
    const whReplay = await orchRestarted.processWebhook({
      provider: 'MTN_MOMO',
      headers: signedWebhook.headers,
      rawBody: signedWebhook.rawBody,
      parsedBody: JSON.parse(signedWebhook.rawBody),
    });
    assert.equal(whReplay.idempotent, true);
    assert.equal(whReplay.status, 'PAID');

    // 3c. Payout failure webhook reversal & successful payout settlement
    const balanceBeforePayouts = (await ledger.getChannelBalance(channelId)).availableBalanceCents;
    const failedPayout = await orch1.initiateCreatorPayout({
      userId,
      provider: 'AIRTEL_MONEY',
      amountCents: 2_000n,
      currency: 'RWF',
      phoneNumber: '+250722123456',
      idempotencyKey: `payout-fail-${runSuffix}`,
    });
    assert.equal(failedPayout.transaction.status, 'PENDING');
    assert.equal(
      (await ledger.getChannelBalance(channelId)).availableBalanceCents,
      balanceBeforePayouts - 2_000n
    );

    const failWebhook = airtelAdapter.signMockWebhookPayload({
      webhookEventId: `wh-airtel-fail-${runSuffix}`,
      providerReference: failedPayout.transaction.providerReference,
      internalReference: failedPayout.transaction.transactionId,
      status: 'FAILED',
      amountCents: '2000',
      currency: 'RWF',
      failureReason: 'Subscriber unreachable',
    });
    await orchRestarted.processWebhook({
      provider: 'AIRTEL_MONEY',
      headers: failWebhook.headers,
      rawBody: failWebhook.rawBody,
      parsedBody: JSON.parse(failWebhook.rawBody),
    });
    assert.equal(
      (await ledger.getChannelBalance(channelId)).availableBalanceCents,
      balanceBeforePayouts,
      'Failed payout webhook must append reversal restoring full balance'
    );

    // Concurrent cross-instance duplicate payout idempotency & settlement
    const concPayoutKey = `payout-conc-${runSuffix}`;
    const [raceA, raceB] = await Promise.all([
      orch1.initiateCreatorPayout({
        userId,
        provider: 'MTN_MOMO',
        amountCents: 1_000n,
        currency: 'RWF',
        phoneNumber: '+250788123456',
        idempotencyKey: concPayoutKey,
      }),
      orchRestarted.initiateCreatorPayout({
        userId,
        provider: 'MTN_MOMO',
        amountCents: 1_000n,
        currency: 'RWF',
        phoneNumber: '+250788123456',
        idempotencyKey: concPayoutKey,
      }),
    ]);
    assert.equal(raceA.transaction.transactionId, raceB.transaction.transactionId);
    assert.equal(
      [raceA.idempotentReplay, raceB.idempotentReplay].filter(Boolean).length,
      1,
      'Exactly one concurrent caller wins creation and the second replays idempotently'
    );
    assert.equal(
      (await ledger.getChannelBalance(channelId)).availableBalanceCents,
      balanceBeforePayouts - 1_000n
    );

    const settledWebhook = mtnAdapter.signMockWebhookPayload({
      webhookEventId: `wh-mtn-payout-paid-${runSuffix}`,
      providerReference: raceA.transaction.providerReference,
      internalReference: raceA.transaction.transactionId,
      status: 'PAID',
      amountCents: '1000',
      currency: 'RWF',
    });
    const paidWhRes = await orchRestarted.processWebhook({
      provider: 'MTN_MOMO',
      headers: settledWebhook.headers,
      rawBody: settledWebhook.rawBody,
      parsedBody: JSON.parse(settledWebhook.rawBody),
    });
    assert.equal(paidWhRes.status, 'PAID');
    assert.equal(paidWhRes.idempotent, false);

    // Parent/child REFUND transaction persisted in PostgreSQL
    mtnAdapter.setSimulatedStatus(initPay.transaction.providerReference, 'PAID');
    const refundIdempKey = `refund-${runSuffix}`;
    const refundedParent = await orchRestarted.initiateRefundOrReversal({
      transactionId: initPay.transaction.transactionId,
      reason: 'Customer chargeback resolution',
      idempotencyKey: refundIdempKey,
      actor: { id: adminUserId, role: 'SUPER_ADMIN' },
    });
    assert.equal(refundedParent.status, 'REFUNDED');

    const childRefunds = await storeRestarted.findByParentTransactionId(initPay.transaction.transactionId);
    assert.equal(childRefunds.length, 1);
    assert.equal(childRefunds[0].kind, 'REFUND');
    assert.equal(childRefunds[0].parentTransactionId, initPay.transaction.transactionId);
    assert.equal(childRefunds[0].status, 'PAID');

    // Retry refund idempotently with same key
    const refundReplay = await orch1.initiateRefundOrReversal({
      transactionId: initPay.transaction.transactionId,
      reason: 'Customer chargeback resolution',
      idempotencyKey: refundIdempKey,
      actor: { id: adminUserId, role: 'SUPER_ADMIN' },
    });
    assert.equal(refundReplay.status, 'REFUNDED');

    // 3d. Two concurrent/consecutive timeouts with NULL providerReference must NOT collide on unique index
    const t1 = await orch1.initiatePayment({
      userId,
      provider: 'MTN_MOMO',
      amountCents: 1_500n,
      currency: 'RWF',
      phoneNumber: '+250788123456',
      idempotencyKey: `timeout-1-${runSuffix}`,
      description: 'Timeout 1',
    });
    const t2 = await orch1.initiatePayment({
      userId,
      provider: 'MTN_MOMO',
      amountCents: 1_600n,
      currency: 'RWF',
      phoneNumber: '+250788123456',
      idempotencyKey: `timeout-2-${runSuffix}`,
      description: 'Timeout 2',
    });
    assert.equal(t1.transaction.reconciliationRequired, true);
    assert.equal(t2.transaction.reconciliationRequired, true);
    assert.equal(t1.transaction.providerReference, '');
    assert.equal(t2.transaction.providerReference, '');

    const dbTimeoutRow = await prisma.paymentTransaction.findUnique({
      where: { transactionId: t1.transaction.transactionId },
      select: { providerReference: true, reconciliationRequired: true },
    });
    assert.equal(dbTimeoutRow?.providerReference, null);
    assert.equal(dbTimeoutRow?.reconciliationRequired, true);

    const pendingRecon = await orchRestarted.listPendingReconciliation();
    const pendingIds = new Set(pendingRecon.map((r) => r.transactionId));
    assert.ok(pendingIds.has(t1.transaction.transactionId));
    assert.ok(pendingIds.has(t2.transaction.transactionId));
  });

  test('4. Revenue Attribution Persistence: real Shorts 30% DB setting, AdRevenueAttributionLine, EscrowHold withholding, and idempotency', async (t) => {
    if (!dbReady) {
      t.skip('Local PostgreSQL unavailable');
      return;
    }

    const attrRepo = new PrismaRevenueAttributionRepository(prisma);
    const ledger = new WalletLedgerService(new PrismaWalletLedgerRepository(prisma));
    const attrAuditRecorder = async (input: any) => {
      await prisma.adminAuditLog.create({
        data: {
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: input.action,
          targetResource: input.targetResource,
          targetId: input.targetId ?? null,
          outcome: input.outcome ?? 'SUCCESS',
          metadata: (input.metadata ?? null) as any,
        },
      });
    };
    const attrService = new RevenueAttributionService(attrRepo, ledger, attrAuditRecorder);

    // 4a. Must fail closed 501 until an approved commercial split policy is configured
    const authOwner: RequestHandler = (req: any, _res, next) => {
      req.user = { id: adminUserId, role: 'SUPER_ADMIN' };
      next();
    };
    const appNoPolicy = express();
    appNoPolicy.use(express.json());
    appNoPolicy.use(
      createRevenueReconciliationRouter(authOwner, authOwner, {
        attributionService: attrService,
        allocationPolicy: null,
      })
    );
    const { baseUrl: noPolUrl, server: noPolServer } = await startHttpServer(appNoPolicy);
    try {
      const noPolRes = await fetch(`${noPolUrl}/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          periodMonth: '2026-11',
          reports: [{ sourceType: 'PROVIDER_REPORT', externalReportId: 'x' }],
        }),
      });
      assert.equal(noPolRes.status, 501);
    } finally {
      await closeHttpServer(noPolServer);
    }

    await assert.rejects(
      () =>
        attrService.reconcileVerifiedReports({
          periodMonth: '2026-11',
          policy: null,
          actor: { id: adminUserId, role: 'SUPER_ADMIN' },
          reports: [],
        }),
      (err: any) => err instanceof AttributionPolicyError && err.statusCode === 501
    );

    // Seed verified AdEvent telemetry proof for all 3 test videos if Test 2 wasn't run
    const ipHash = crypto.createHash('sha256').update('127.0.0.1').digest('hex');
    const stdSession = `wsc-attr-std-${runSuffix}`;
    const shortSession = `wsc-attr-short-${runSuffix}`;
    const heldSession = `wsc-attr-held-${runSuffix}`;

    await prisma.adEvent.createMany({
      data: [
        {
          videoId: standardVideoId,
          channelId,
          eventType: 'AD_IMPRESSION',
          provider: 'WSC-VAST-Provider',
          grossRevenueCents: 0n,
          ipHash,
          sessionId: stdSession,
          placement: 'PRE_ROLL',
        },
        {
          videoId: shortsVideoId,
          channelId,
          eventType: 'AD_IMPRESSION',
          provider: 'WSC-VAST-Provider',
          grossRevenueCents: 0n,
          ipHash,
          sessionId: shortSession,
          placement: 'PRE_ROLL',
        },
        {
          videoId: heldVideoId,
          channelId,
          eventType: 'AD_IMPRESSION',
          provider: 'WSC-VAST-Provider',
          grossRevenueCents: 0n,
          ipHash,
          sessionId: heldSession,
          placement: 'PRE_ROLL',
        },
      ],
    });

    // Confirm live DB Shorts rate is preserved at 3000 bps (30%)
    const liveShortsBps = await attrRepo.getShortsRateBasisPoints();
    assert.equal(liveShortsBps, 3000);

    // 4b. Reconcile using an explicit test-only split parameter (never hardcoded in prod)
    const testExplicitPolicy = { creatorShareBasisPoints: 5500 }; // 55% test-only fixture
    const balanceBefore = (await ledger.getChannelBalance(channelId)).availableBalanceCents;

    const reportBatch = [
      // Standard video: gross 10,000 - fee 1,000 = 9,000 net -> 55% = 4,950 creator
      {
        sourceType: 'PROVIDER_REPORT',
        externalReportId: `rep-std-${runSuffix}`,
        provider: 'WSC-VAST-Provider',
        periodMonth: '2026-11',
        videoId: standardVideoId,
        channelId,
        sessionId: stdSession,
        reportedGrossRevenueCents: '10000',
        providerFeeCents: '1000',
        invalidTrafficDeductionCents: '0',
        currency: 'RWF',
      },
      // Shorts video: gross 10,000 -> 55% standard (5,500) * 30% Shorts = 1,650 creator
      {
        sourceType: 'PROVIDER_REPORT',
        externalReportId: `rep-short-${runSuffix}`,
        provider: 'WSC-VAST-Provider',
        periodMonth: '2026-11',
        videoId: shortsVideoId,
        channelId,
        sessionId: shortSession,
        reportedGrossRevenueCents: '10000',
        providerFeeCents: '0',
        invalidTrafficDeductionCents: '0',
        currency: 'RWF',
      },
      // Escrow-held video: verified net 10,000 -> creatorShare 5,500 withheld in escrow (0n ledger credit)
      {
        sourceType: 'PROVIDER_REPORT',
        externalReportId: `rep-held-${runSuffix}`,
        provider: 'WSC-VAST-Provider',
        periodMonth: '2026-11',
        videoId: heldVideoId,
        channelId,
        sessionId: heldSession,
        reportedGrossRevenueCents: '10000',
        providerFeeCents: '0',
        invalidTrafficDeductionCents: '0',
        currency: 'RWF',
      },
      // Invalid-traffic line: rejected cleanly, never persisted or credited
      {
        sourceType: 'PROVIDER_REPORT',
        externalReportId: `rep-ivt-${runSuffix}`,
        provider: 'WSC-VAST-Provider',
        periodMonth: '2026-11',
        videoId: standardVideoId,
        channelId,
        sessionId: stdSession,
        reportedGrossRevenueCents: '5000',
        providerFeeCents: '0',
        invalidTrafficDeductionCents: '0',
        currency: 'RWF',
        isInvalidTraffic: true,
      },
    ];

    const batch1 = await attrService.reconcileVerifiedReports({
      periodMonth: '2026-11',
      policy: testExplicitPolicy,
      actor: { id: adminUserId, role: 'SUPER_ADMIN' },
      reports: reportBatch,
    });
    createdReconIds.push(batch1.reconciliationId);

    assert.equal(batch1.verifiedLineCount, 3);
    assert.equal(batch1.rejectedLineCount, 1);
    assert.equal(batch1.appliedShortsRateBasisPoints, 3000);
    assert.equal(batch1.totalCreatorAttributableCents, 6_600n); // 4,950 + 1,650 + 0
    assert.equal(batch1.totalEscrowWithheldCents, 5_500n);

    const balanceAfter = (await ledger.getChannelBalance(channelId)).availableBalanceCents;
    assert.equal(balanceAfter - balanceBefore, 6_600n);

    // Verify durable AdRevenueAttributionLine rows in PostgreSQL
    const persistedLines = await prisma.adRevenueAttributionLine.findMany({
      where: { reconciliationId: batch1.reconciliationId },
      orderBy: { externalReportId: 'asc' },
    });
    assert.equal(persistedLines.length, 3);

    const byReportId = new Map(persistedLines.map((l) => [l.externalReportId, l]));
    const stdLine = byReportId.get(`rep-std-${runSuffix}`)!;
    const shortLine = byReportId.get(`rep-short-${runSuffix}`)!;
    const heldLine = byReportId.get(`rep-held-${runSuffix}`)!;

    assert.equal(stdLine.status, 'VERIFIED_CREDITED');
    assert.equal(stdLine.appliedShortsRateBps, null);
    assert.equal(stdLine.creatorAttributableCents, 4_950n);
    assert.ok(stdLine.ledgerReferenceId);

    assert.equal(shortLine.status, 'VERIFIED_CREDITED');
    assert.equal(shortLine.isShort, true);
    assert.equal(shortLine.appliedShortsRateBps, 3000);
    assert.equal(shortLine.creatorAttributableCents, 1_650n);
    assert.ok(shortLine.ledgerReferenceId);

    assert.equal(heldLine.status, 'VERIFIED_ESCROW_HELD');
    assert.equal(heldLine.escrowWithheldCents, 5_500n);
    assert.equal(heldLine.creatorAttributableCents, 0n);
    assert.equal(heldLine.ledgerReferenceId, null);

    // 4c. Restarted service re-running same batch deduplicates ALL 3 persisted lines (including escrow-held line with 0n wallet tx)
    const restartedService = new RevenueAttributionService(
      new PrismaRevenueAttributionRepository(prisma),
      new WalletLedgerService(new PrismaWalletLedgerRepository(prisma)),
      attrAuditRecorder
    );
    const batch2 = await restartedService.reconcileVerifiedReports({
      periodMonth: '2026-11',
      policy: testExplicitPolicy,
      actor: { id: adminUserId, role: 'SUPER_ADMIN' },
      reports: reportBatch.slice(0, 3),
    });
    createdReconIds.push(batch2.reconciliationId);

    assert.equal(batch2.verifiedLineCount, 0);
    assert.equal(batch2.duplicateLineCount, 3);
    assert.equal(batch2.totalCreatorAttributableCents, 0n);
    assert.equal((await ledger.getChannelBalance(channelId)).availableBalanceCents, balanceAfter);

    const auditCount = await prisma.adminAuditLog.count({
      where: {
        actorId: { in: [userId, adminUserId] },
        action: { in: ['WALLET_PAYOUT_INITIATED', 'WALLET_PAYOUT_SETTLED', 'PAYMENT_SETTLED', 'PAYMENT_REFUND_OR_REVERSAL', 'REVENUE_RECONCILED'] },
      },
    });
    assert.ok(auditCount >= 5, `Expected durable audit records in Postgres, got ${auditCount}`);
  });
});
