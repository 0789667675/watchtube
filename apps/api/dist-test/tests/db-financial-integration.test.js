"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = require("node:http");
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const ioredis_1 = __importDefault(require("ioredis"));
const node_test_1 = require("node:test");
const database_1 = require("@watchtube/database");
const monetization_route_1 = require("../src/routes/monetization.route");
const wallet_route_1 = require("../src/routes/wallet.route");
const advertising_1 = require("../src/services/advertising");
const ledger_service_1 = require("../src/services/finance/ledger.service");
const payments_1 = require("../src/services/payments");
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function findDatabaseEnvPath() {
    const candidates = [
        node_path_1.default.resolve(process.cwd(), 'packages/database/.env'),
        node_path_1.default.resolve(process.cwd(), '../../packages/database/.env'),
    ];
    let cursor = __dirname;
    for (let i = 0; i < 8; i++) {
        candidates.push(node_path_1.default.join(cursor, 'packages/database/.env'));
        const parent = node_path_1.default.dirname(cursor);
        if (parent === cursor)
            break;
        cursor = parent;
    }
    for (const candidate of candidates) {
        if (node_fs_1.default.existsSync(candidate))
            return candidate;
    }
    return null;
}
function parseEnvValue(envFilePath, key) {
    const raw = node_fs_1.default.readFileSync(envFilePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0)
            continue;
        const k = trimmed.slice(0, eqIdx).trim();
        if (k !== key)
            continue;
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"'))
            || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        return val;
    }
    return undefined;
}
function resolveValidatedLocalPostgresUrl() {
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
    let parsed;
    try {
        parsed = new URL(candidate);
    }
    catch {
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
async function probeLocalRedis(host = '127.0.0.1', port = 6379) {
    const client = new ioredis_1.default({
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
        if (pong === 'PONG')
            return client;
        client.disconnect();
        return null;
    }
    catch {
        client.disconnect();
        return null;
    }
}
const activeServers = [];
async function startHttpServer(app) {
    return new Promise((resolve) => {
        const server = (0, node_http_1.createServer)(app);
        activeServers.push(server);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, server });
        });
    });
}
async function closeHttpServer(server) {
    await new Promise((resolve) => server.close(() => resolve()));
}
const TEST_ADS_SECRET = 'wsc-ads-hmac-secret-separate-from-jwt-32chars';
(0, node_test_1.describe)('Workstream C: Real PostgreSQL & Redis Financial Persistence Integration', { timeout: 60_000 }, () => {
    const runSuffix = `${Date.now()}-${node_crypto_1.default.randomUUID().slice(0, 8)}`;
    const userId = node_crypto_1.default.randomUUID();
    const adminUserId = node_crypto_1.default.randomUUID();
    const channelId = node_crypto_1.default.randomUUID();
    const standardVideoId = node_crypto_1.default.randomUUID();
    const shortsVideoId = node_crypto_1.default.randomUUID();
    const heldVideoId = node_crypto_1.default.randomUUID();
    const copyrightClaimId = node_crypto_1.default.randomUUID();
    const escrowHoldId = node_crypto_1.default.randomUUID();
    const createdReconIds = [];
    const createdAdSessions = [];
    const createdRedisKeys = [];
    let prisma;
    let dbReady = false;
    let redisClient = null;
    (0, node_test_1.before)(async () => {
        const localUrl = resolveValidatedLocalPostgresUrl();
        prisma = new database_1.PrismaClient({
            datasources: { db: { url: localUrl } },
        });
        try {
            await prisma.$queryRaw `SELECT 1`;
            dbReady = true;
        }
        catch {
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
    (0, node_test_1.after)(async () => {
        for (const s of activeServers.splice(0, activeServers.length)) {
            await closeHttpServer(s).catch(() => { });
        }
        if (redisClient) {
            if (createdRedisKeys.length > 0) {
                await redisClient.del(...createdRedisKeys).catch(() => { });
            }
            await redisClient.quit().catch(() => { });
        }
        if (prisma && dbReady) {
            // Strict reverse foreign-key deletion of ONLY this test run's isolated records
            await prisma.adRevenueAttributionLine.deleteMany({ where: { channelId } }).catch(() => { });
            if (createdReconIds.length > 0) {
                await prisma.revenueReconciliation.deleteMany({ where: { id: { in: createdReconIds } } }).catch(() => { });
            }
            await prisma.escrowHold.deleteMany({ where: { id: escrowHoldId } }).catch(() => { });
            await prisma.copyrightClaim.deleteMany({ where: { id: copyrightClaimId } }).catch(() => { });
            await prisma.adEvent.deleteMany({ where: { channelId } }).catch(() => { });
            await prisma.paymentWebhookEvent.deleteMany({
                where: {
                    OR: [
                        { paymentTransaction: { userId } },
                        { providerReference: { startsWith: 'wsc-' } },
                    ],
                },
            }).catch(() => { });
            await prisma.paymentTransaction.deleteMany({
                where: { userId, parentTransactionId: { not: null } },
            }).catch(() => { });
            await prisma.paymentTransaction.deleteMany({
                where: { userId },
            }).catch(() => { });
            await prisma.walletTransaction.deleteMany({ where: { channelId } }).catch(() => { });
            await prisma.adminAuditLog.deleteMany({
                where: { actorId: { in: [userId, adminUserId] } },
            }).catch(() => { });
            await prisma.video.deleteMany({ where: { channelId } }).catch(() => { });
            await prisma.channel.deleteMany({ where: { id: channelId } }).catch(() => { });
            await prisma.user.deleteMany({ where: { id: { in: [userId, adminUserId] } } }).catch(() => { });
        }
        if (prisma) {
            await prisma.$disconnect().catch(() => { });
        }
    });
    (0, node_test_1.test)('1. Wallet Ledger on real PostgreSQL: append-only, FOR UPDATE concurrency, rollback, reversal & settlement', async (t) => {
        if (!dbReady) {
            t.skip('Local PostgreSQL unavailable');
            return;
        }
        const ledgerRepo = new ledger_service_1.PrismaWalletLedgerRepository(prisma);
        const ledger = new ledger_service_1.WalletLedgerService(ledgerRepo);
        // 1a. Append-only credits & BigInt precision
        const c1 = await ledger.creditRevenue({
            channelId,
            amountCents: 10000n,
            referenceId: `wsc-seed-1-${runSuffix}`,
            status: 'AVAILABLE',
        });
        strict_1.default.equal(c1.duplicate, false);
        strict_1.default.equal(c1.entry.balanceAfterCents, 10000n);
        const c2 = await ledger.creditRevenue({
            channelId,
            amountCents: 2500n,
            referenceId: `wsc-seed-2-${runSuffix}`,
            status: 'AVAILABLE',
        });
        strict_1.default.equal(c2.entry.balanceAfterCents, 12500n);
        // Reject insufficient funds cleanly without mutating DB
        await strict_1.default.rejects(() => ledger.reservePayout({
            channelId,
            payoutId: `wsc-overdraw-${runSuffix}`,
            amountCents: 15000n,
        }), (err) => err instanceof ledger_service_1.InsufficientFundsError && err.statusCode === 409);
        // Verify PostgreSQL ACID rollback leaves zero partial entries on transaction error
        const txCountBeforeRollback = await prisma.walletTransaction.count({ where: { channelId } });
        await strict_1.default.rejects(() => ledgerRepo.withChannelLock(channelId, async (ctx) => {
            await ctx.appendEntry({
                channelId,
                transactionType: 'ADJUSTMENT',
                amountCents: 99999n,
                balanceAfterCents: 112499n,
                referenceId: `wsc-rollback-${runSuffix}`,
                status: 'AVAILABLE',
            });
            throw new Error('Simulated crash after appendEntry inside PostgreSQL transaction');
        }), /Simulated crash/);
        const txCountAfterRollback = await prisma.walletTransaction.count({ where: { channelId } });
        strict_1.default.equal(txCountAfterRollback, txCountBeforeRollback);
        // 1b. Concurrent payout reservations serialized via PostgreSQL FOR UPDATE row lock
        const concurrentIds = Array.from({ length: 6 }, (_, idx) => `wsc-conc-${idx}-${runSuffix}`);
        const results = await Promise.allSettled(concurrentIds.map((payoutId) => ledger.reservePayout({
            channelId,
            payoutId,
            amountCents: 3000n,
        })));
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        strict_1.default.equal(fulfilled.length, 4, 'Only 4 x 3,000 = 12,000 RWF fits within 12,500 RWF balance');
        strict_1.default.equal(rejected.length, 2);
        for (const r of rejected) {
            strict_1.default.ok(r.reason instanceof ledger_service_1.InsufficientFundsError);
        }
        // Determine which payout IDs actually won the row lock
        const winningPayoutIds = [];
        for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'fulfilled')
                winningPayoutIds.push(concurrentIds[i]);
        }
        // Duplicate payout reservation protection
        const replay = await ledger.reservePayout({
            channelId,
            payoutId: winningPayoutIds[0],
            amountCents: 3000n,
        });
        strict_1.default.equal(replay.duplicate, true);
        await strict_1.default.rejects(() => ledger.reservePayout({
            channelId,
            payoutId: winningPayoutIds[0],
            amountCents: 2999n,
        }), (err) => err instanceof ledger_service_1.PayoutConflictError && err.code === 'IDEMPOTENCY_CONFLICT');
        // Settle winningPayoutIds[0] as PAID, reverse winningPayoutIds[1] as FAILED, settle 2 and 3
        await ledger.finalizePayoutSuccess({ channelId, payoutId: winningPayoutIds[0] });
        const rev = await ledger.failAndReversePayout({ channelId, payoutId: winningPayoutIds[1] });
        strict_1.default.equal(rev.alreadyReversed, false);
        strict_1.default.equal(rev.reversalEntry.amountCents, 3000n);
        await ledger.finalizePayoutSuccess({ channelId, payoutId: winningPayoutIds[2] });
        await ledger.finalizePayoutSuccess({ channelId, payoutId: winningPayoutIds[3] });
        // Integrity check + running balance verification across PostgreSQL rows
        const derived = await ledger.getChannelBalance(channelId);
        strict_1.default.equal(derived.integrityVerified, true, derived.integrityError);
        strict_1.default.equal(derived.availableBalanceCents, 3500n); // 12,500 - 12,000 + 3,000 reversed
        strict_1.default.equal(derived.pendingPayoutCents, 0n);
        strict_1.default.equal(derived.totalEarnedCents, 12500n);
        strict_1.default.equal(derived.totalPaidOutCents, 9000n);
        strict_1.default.equal(derived.totalReversedPayoutCents, 3000n);
        // HTTP route check backed by live PostgreSQL wallet service
        const authCreator = (req, _res, next) => {
            req.user = { id: userId, role: 'USER' };
            next();
        };
        const app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/wallet', (0, wallet_route_1.createWalletRouter)({ prismaClient: prisma, ledgerService: ledger, authenticateMiddleware: authCreator }));
        const { baseUrl, server } = await startHttpServer(app);
        try {
            const balRes = await fetch(`${baseUrl}/api/wallet/balance`);
            strict_1.default.equal(balRes.status, 200);
            const balBody = await balRes.json();
            strict_1.default.equal(balBody.availableBalanceCents, '3500');
            strict_1.default.equal(balBody.currency, ledger_service_1.LEDGER_CURRENCY);
            const ledRes = await fetch(`${baseUrl}/api/wallet/ledger`);
            strict_1.default.equal(ledRes.status, 200);
            const ledBody = await ledRes.json();
            strict_1.default.ok(ledBody.length >= 10);
        }
        finally {
            await closeHttpServer(server);
        }
    });
    (0, node_test_1.test)('2. Advertising DB + live Redis integration: AD_SERVED, ordered client events, replay, persistence failure, attribution cross-ref', async (t) => {
        if (!dbReady || !redisClient) {
            t.skip('Local PostgreSQL or local Redis unavailable');
            return;
        }
        const prefixA = `wsc:ad:nonce:${runSuffix}:`;
        const authUser = (req, _res, next) => {
            req.user = { id: userId, role: 'USER' };
            next();
        };
        const buildApp = (opts) => {
            const engine = new advertising_1.AdDecisionEngine({ tokenSecret: TEST_ADS_SECRET });
            engine.registerProvider(new advertising_1.VastAdProviderAdapter('vast-wsc-1', 'WSC-VAST-Provider'), 1, true, { vastTagUrl: 'https://ads.watchtube.local/vast.xml' });
            const nonceStore = new advertising_1.RedisAdTelemetryNonceStore(opts.redis, prefixA);
            const dbObj = opts.prismaOverride ?? prisma;
            const app = (0, express_1.default)();
            app.use(express_1.default.json());
            app.use((0, monetization_route_1.createAdDecisionRouter)({ engine, prismaClient: dbObj, secret: TEST_ADS_SECRET }));
            app.use((0, monetization_route_1.createAdEventRouter)(authUser, { nonceStore, prismaClient: dbObj, secret: TEST_ADS_SECRET }));
            return app;
        };
        const { baseUrl: baseUrlA, server: serverA } = await startHttpServer(buildApp({ redis: redisClient }));
        // Second Redis connection + HTTP server instance simulating restarted / horizontally scaled API process
        const redisB = new ioredis_1.default({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
        const { baseUrl: baseUrlB, server: serverB } = await startHttpServer(buildApp({ redis: redisB }));
        try {
            // 2a. Decision creates AD_SERVED row in PostgreSQL with 0n grossRevenueCents
            const decRes = await fetch(`${baseUrlA}/decision`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ placement: 'PRE_ROLL', videoId: standardVideoId }),
            });
            strict_1.default.equal(decRes.status, 200);
            const decBody = await decRes.json();
            strict_1.default.equal(decBody.decision, 'SERVE');
            strict_1.default.ok(decBody.trackingToken);
            strict_1.default.ok(decBody.sessionId);
            createdAdSessions.push(decBody.sessionId);
            createdRedisKeys.push(`${prefixA}${decBody.sessionId}`);
            const tokenClaims = (0, advertising_1.verifyAdToken)(decBody.trackingToken, TEST_ADS_SECRET);
            strict_1.default.ok(tokenClaims);
            strict_1.default.equal(tokenClaims.videoId, standardVideoId);
            strict_1.default.equal(tokenClaims.channelId, channelId);
            const servedRows = await prisma.adEvent.findMany({
                where: { videoId: standardVideoId, sessionId: decBody.sessionId },
            });
            strict_1.default.equal(servedRows.length, 1);
            strict_1.default.equal(servedRows[0].eventType, 'AD_SERVED');
            strict_1.default.equal(servedRows[0].grossRevenueCents, 0n);
            // Incorrect event order: AD_VIEWABLE before AD_IMPRESSION -> 409 + 0 new DB rows
            const outOfOrderRes = await fetch(`${baseUrlA}/ad-event`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token: decBody.trackingToken, eventType: 'AD_VIEWABLE' }),
            });
            strict_1.default.equal(outOfOrderRes.status, 409);
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
            strict_1.default.equal(clientRevRes.status, 400);
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
                strict_1.default.equal(res.status, 200, `Expected 200 for ${evt}`);
            }
            // Replay AD_IMPRESSION on instance B after "restart" -> 409 DUPLICATE_IMPRESSION
            const replayRes = await fetch(`${baseUrlB}/ad-event`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token: decBody.trackingToken, eventType: 'AD_IMPRESSION' }),
            });
            strict_1.default.equal(replayRes.status, 409);
            const replayJson = await replayRes.json();
            strict_1.default.equal(replayJson.code, 'DUPLICATE_IMPRESSION');
            const allEvents = await prisma.adEvent.findMany({
                where: { sessionId: decBody.sessionId },
                orderBy: { createdAt: 'asc' },
            });
            strict_1.default.equal(allEvents.length, 8); // AD_SERVED + 7 distinct lifecycle events
            strict_1.default.deepEqual(allEvents.map((e) => e.eventType), ['AD_SERVED', ...sequence]);
            strict_1.default.ok(allEvents.every((e) => e.grossRevenueCents === 0n));
            // 2b. Persistence failure during adEvent.create fails closed 503 & releases Redis nonce so clean retry succeeds
            const decRes2 = await fetch(`${baseUrlA}/decision`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ placement: 'PRE_ROLL', videoId: shortsVideoId }),
            });
            const dec2Body = await decRes2.json();
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
                    return target[prop];
                },
            });
            const { baseUrl: failBaseUrl, server: failServer } = await startHttpServer(buildApp({ redis: redisClient, prismaOverride: failingPrisma }));
            try {
                const failRes = await fetch(`${failBaseUrl}/ad-event`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ token: dec2Body.trackingToken, eventType: 'AD_IMPRESSION' }),
                });
                strict_1.default.equal(failRes.status, 503);
            }
            finally {
                await closeHttpServer(failServer);
            }
            // Clean retry after persistence recovery succeeds & persists AD_IMPRESSION
            const retryRes = await fetch(`${baseUrlB}/ad-event`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token: dec2Body.trackingToken, eventType: 'AD_IMPRESSION' }),
            });
            strict_1.default.equal(retryRes.status, 200);
            const shortsImpressions = await prisma.adEvent.count({
                where: { videoId: shortsVideoId, sessionId: dec2Body.sessionId, eventType: 'AD_IMPRESSION' },
            });
            strict_1.default.equal(shortsImpressions, 1);
        }
        finally {
            await closeHttpServer(serverA);
            await closeHttpServer(serverB);
            await redisB.quit().catch(() => { });
        }
    });
    (0, node_test_1.test)('3. Durable Payment & Webhook Persistence: PrismaPaymentTransactionStore across restarts, webhook hash dedup, payout reversal, refunds & nullable refs', async (t) => {
        if (!dbReady) {
            t.skip('Local PostgreSQL unavailable');
            return;
        }
        const ledger = new ledger_service_1.WalletLedgerService(new ledger_service_1.PrismaWalletLedgerRepository(prisma));
        const store1 = new payments_1.PrismaPaymentTransactionStore(prisma);
        const eligibilityChecker = (0, payments_1.createPrismaPayoutEligibilityChecker)(prisma);
        const dbAuditRecorder = async (input) => {
            await prisma.adminAuditLog.create({
                data: {
                    actorId: input.actorId,
                    actorRole: input.actorRole,
                    action: input.action,
                    targetResource: input.targetResource,
                    targetId: input.targetId ?? null,
                    outcome: input.outcome ?? 'SUCCESS',
                    metadata: (input.metadata ?? null),
                },
            });
        };
        // 3a. Fail-closed unconfigured default adapters (even with durable Prisma store)
        const failClosedOrch = new payments_1.PaymentOrchestratorService({
            ledger,
            store: store1,
            eligibilityChecker,
            auditRecorder: dbAuditRecorder,
        });
        await strict_1.default.rejects(() => failClosedOrch.initiatePayment({
            userId,
            provider: 'MTN_MOMO',
            amountCents: 5000n,
            currency: 'RWF',
            phoneNumber: '+250788123456',
            idempotencyKey: `unconf-pay-${runSuffix}`,
            description: 'Unconfigured check',
        }), (err) => err instanceof payments_1.OrchestratorError && err.statusCode === 501);
        await strict_1.default.rejects(() => failClosedOrch.initiateCreatorPayout({
            userId,
            provider: 'AIRTEL_MONEY',
            amountCents: 1000n,
            currency: 'RWF',
            phoneNumber: '+250722123456',
            idempotencyKey: `unconf-payout-${runSuffix}`,
        }), (err) => err instanceof payments_1.OrchestratorError && err.statusCode === 501);
        // 3b. Configure sandbox adapters with durable PrismaPaymentTransactionStore
        const timeoutKeys = new Set([`timeout-1-${runSuffix}`, `timeout-2-${runSuffix}`]);
        const mtnAdapter = new payments_1.MockMtnMoMoSandboxAdapter({ simulateTimeoutOnKey: timeoutKeys });
        const airtelAdapter = new payments_1.MockAirtelMoneySandboxAdapter();
        const orch1 = new payments_1.PaymentOrchestratorService({
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
            amountCents: 5000n,
            currency: 'RWF',
            phoneNumber: '+250788123456',
            idempotencyKey: payIdempKey,
            description: 'Creator support payment',
        });
        strict_1.default.equal(initPay.idempotentReplay, false);
        strict_1.default.equal(initPay.transaction.status, 'PENDING');
        strict_1.default.ok(initPay.transaction.providerReference.length > 0);
        // Inspect persisted DB row: hash + masked phone only, NEVER raw MSISDN
        const dbPayRow = await prisma.paymentTransaction.findUnique({
            where: { transactionId: initPay.transaction.transactionId },
        });
        strict_1.default.ok(dbPayRow);
        strict_1.default.equal(dbPayRow.msisdnHash, (0, payments_1.hashMsisdn)('250788123456'));
        strict_1.default.ok(!dbPayRow.maskedPhone.includes('881234'));
        strict_1.default.equal(dbPayRow.amountCents, 5000n);
        // Simulate process restart: new store + new orchestrator reading existing PostgreSQL row
        const storeRestarted = new payments_1.PrismaPaymentTransactionStore(prisma);
        const orchRestarted = new payments_1.PaymentOrchestratorService({
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
            amountCents: 5000n,
            currency: 'RWF',
            phoneNumber: '+250788123456',
            idempotencyKey: payIdempKey,
            description: 'Creator support payment',
        });
        strict_1.default.equal(replayPay.idempotentReplay, true);
        strict_1.default.equal(replayPay.transaction.transactionId, initPay.transaction.transactionId);
        // Idempotency key conflict with modified amount -> 409
        await strict_1.default.rejects(() => orchRestarted.initiatePayment({
            userId,
            channelId,
            provider: 'MTN_MOMO',
            amountCents: 6000n,
            currency: 'RWF',
            phoneNumber: '+250788123456',
            idempotencyKey: payIdempKey,
            description: 'Tampered amount',
        }), (err) => err instanceof payments_1.OrchestratorError && err.statusCode === 409);
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
        const expectedSha = node_crypto_1.default.createHash('sha256').update(signedWebhook.rawBody, 'utf8').digest('hex');
        const whRes1 = await orch1.processWebhook({
            provider: 'MTN_MOMO',
            headers: signedWebhook.headers,
            rawBody: signedWebhook.rawBody,
            parsedBody: JSON.parse(signedWebhook.rawBody),
        });
        strict_1.default.equal(whRes1.accepted, true);
        strict_1.default.equal(whRes1.idempotent, false);
        strict_1.default.equal(whRes1.status, 'PAID');
        const dbWebhook = await prisma.paymentWebhookEvent.findUnique({
            where: {
                provider_webhookEventId: { provider: 'MTN_MOMO', webhookEventId: webhookId1 },
            },
        });
        strict_1.default.ok(dbWebhook);
        strict_1.default.equal(dbWebhook.payloadSha256, expectedSha);
        strict_1.default.equal(dbWebhook.paymentTransactionId, dbPayRow.id);
        // Webhook replay after restart is idempotent
        const whReplay = await orchRestarted.processWebhook({
            provider: 'MTN_MOMO',
            headers: signedWebhook.headers,
            rawBody: signedWebhook.rawBody,
            parsedBody: JSON.parse(signedWebhook.rawBody),
        });
        strict_1.default.equal(whReplay.idempotent, true);
        strict_1.default.equal(whReplay.status, 'PAID');
        // 3c. Payout failure webhook reversal & successful payout settlement
        const balanceBeforePayouts = (await ledger.getChannelBalance(channelId)).availableBalanceCents;
        const failedPayout = await orch1.initiateCreatorPayout({
            userId,
            provider: 'AIRTEL_MONEY',
            amountCents: 2000n,
            currency: 'RWF',
            phoneNumber: '+250722123456',
            idempotencyKey: `payout-fail-${runSuffix}`,
        });
        strict_1.default.equal(failedPayout.transaction.status, 'PENDING');
        strict_1.default.equal((await ledger.getChannelBalance(channelId)).availableBalanceCents, balanceBeforePayouts - 2000n);
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
        strict_1.default.equal((await ledger.getChannelBalance(channelId)).availableBalanceCents, balanceBeforePayouts, 'Failed payout webhook must append reversal restoring full balance');
        // Concurrent cross-instance duplicate payout idempotency & settlement
        const concPayoutKey = `payout-conc-${runSuffix}`;
        const [raceA, raceB] = await Promise.all([
            orch1.initiateCreatorPayout({
                userId,
                provider: 'MTN_MOMO',
                amountCents: 1000n,
                currency: 'RWF',
                phoneNumber: '+250788123456',
                idempotencyKey: concPayoutKey,
            }),
            orchRestarted.initiateCreatorPayout({
                userId,
                provider: 'MTN_MOMO',
                amountCents: 1000n,
                currency: 'RWF',
                phoneNumber: '+250788123456',
                idempotencyKey: concPayoutKey,
            }),
        ]);
        strict_1.default.equal(raceA.transaction.transactionId, raceB.transaction.transactionId);
        strict_1.default.equal([raceA.idempotentReplay, raceB.idempotentReplay].filter(Boolean).length, 1, 'Exactly one concurrent caller wins creation and the second replays idempotently');
        strict_1.default.equal((await ledger.getChannelBalance(channelId)).availableBalanceCents, balanceBeforePayouts - 1000n);
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
        strict_1.default.equal(paidWhRes.status, 'PAID');
        strict_1.default.equal(paidWhRes.idempotent, false);
        // Parent/child REFUND transaction persisted in PostgreSQL
        mtnAdapter.setSimulatedStatus(initPay.transaction.providerReference, 'PAID');
        const refundIdempKey = `refund-${runSuffix}`;
        const refundedParent = await orchRestarted.initiateRefundOrReversal({
            transactionId: initPay.transaction.transactionId,
            reason: 'Customer chargeback resolution',
            idempotencyKey: refundIdempKey,
            actor: { id: adminUserId, role: 'SUPER_ADMIN' },
        });
        strict_1.default.equal(refundedParent.status, 'REFUNDED');
        const childRefunds = await storeRestarted.findByParentTransactionId(initPay.transaction.transactionId);
        strict_1.default.equal(childRefunds.length, 1);
        strict_1.default.equal(childRefunds[0].kind, 'REFUND');
        strict_1.default.equal(childRefunds[0].parentTransactionId, initPay.transaction.transactionId);
        strict_1.default.equal(childRefunds[0].status, 'PAID');
        // Retry refund idempotently with same key
        const refundReplay = await orch1.initiateRefundOrReversal({
            transactionId: initPay.transaction.transactionId,
            reason: 'Customer chargeback resolution',
            idempotencyKey: refundIdempKey,
            actor: { id: adminUserId, role: 'SUPER_ADMIN' },
        });
        strict_1.default.equal(refundReplay.status, 'REFUNDED');
        // 3d. Two concurrent/consecutive timeouts with NULL providerReference must NOT collide on unique index
        const t1 = await orch1.initiatePayment({
            userId,
            provider: 'MTN_MOMO',
            amountCents: 1500n,
            currency: 'RWF',
            phoneNumber: '+250788123456',
            idempotencyKey: `timeout-1-${runSuffix}`,
            description: 'Timeout 1',
        });
        const t2 = await orch1.initiatePayment({
            userId,
            provider: 'MTN_MOMO',
            amountCents: 1600n,
            currency: 'RWF',
            phoneNumber: '+250788123456',
            idempotencyKey: `timeout-2-${runSuffix}`,
            description: 'Timeout 2',
        });
        strict_1.default.equal(t1.transaction.reconciliationRequired, true);
        strict_1.default.equal(t2.transaction.reconciliationRequired, true);
        strict_1.default.equal(t1.transaction.providerReference, '');
        strict_1.default.equal(t2.transaction.providerReference, '');
        const dbTimeoutRow = await prisma.paymentTransaction.findUnique({
            where: { transactionId: t1.transaction.transactionId },
            select: { providerReference: true, reconciliationRequired: true },
        });
        strict_1.default.equal(dbTimeoutRow?.providerReference, null);
        strict_1.default.equal(dbTimeoutRow?.reconciliationRequired, true);
        const pendingRecon = await orchRestarted.listPendingReconciliation();
        const pendingIds = new Set(pendingRecon.map((r) => r.transactionId));
        strict_1.default.ok(pendingIds.has(t1.transaction.transactionId));
        strict_1.default.ok(pendingIds.has(t2.transaction.transactionId));
    });
    (0, node_test_1.test)('4. Revenue Attribution Persistence: real Shorts 30% DB setting, AdRevenueAttributionLine, EscrowHold withholding, and idempotency', async (t) => {
        if (!dbReady) {
            t.skip('Local PostgreSQL unavailable');
            return;
        }
        const attrRepo = new advertising_1.PrismaRevenueAttributionRepository(prisma);
        const ledger = new ledger_service_1.WalletLedgerService(new ledger_service_1.PrismaWalletLedgerRepository(prisma));
        const attrAuditRecorder = async (input) => {
            await prisma.adminAuditLog.create({
                data: {
                    actorId: input.actorId,
                    actorRole: input.actorRole,
                    action: input.action,
                    targetResource: input.targetResource,
                    targetId: input.targetId ?? null,
                    outcome: input.outcome ?? 'SUCCESS',
                    metadata: (input.metadata ?? null),
                },
            });
        };
        const attrService = new advertising_1.RevenueAttributionService(attrRepo, ledger, attrAuditRecorder);
        // 4a. Must fail closed 501 until an approved commercial split policy is configured
        const authOwner = (req, _res, next) => {
            req.user = { id: adminUserId, role: 'SUPER_ADMIN' };
            next();
        };
        const appNoPolicy = (0, express_1.default)();
        appNoPolicy.use(express_1.default.json());
        appNoPolicy.use((0, monetization_route_1.createRevenueReconciliationRouter)(authOwner, authOwner, {
            attributionService: attrService,
            allocationPolicy: null,
        }));
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
            strict_1.default.equal(noPolRes.status, 501);
        }
        finally {
            await closeHttpServer(noPolServer);
        }
        await strict_1.default.rejects(() => attrService.reconcileVerifiedReports({
            periodMonth: '2026-11',
            policy: null,
            actor: { id: adminUserId, role: 'SUPER_ADMIN' },
            reports: [],
        }), (err) => err instanceof advertising_1.AttributionPolicyError && err.statusCode === 501);
        // Seed verified AdEvent telemetry proof for all 3 test videos if Test 2 wasn't run
        const ipHash = node_crypto_1.default.createHash('sha256').update('127.0.0.1').digest('hex');
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
        strict_1.default.equal(liveShortsBps, 3000);
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
        strict_1.default.equal(batch1.verifiedLineCount, 3);
        strict_1.default.equal(batch1.rejectedLineCount, 1);
        strict_1.default.equal(batch1.appliedShortsRateBasisPoints, 3000);
        strict_1.default.equal(batch1.totalCreatorAttributableCents, 6600n); // 4,950 + 1,650 + 0
        strict_1.default.equal(batch1.totalEscrowWithheldCents, 5500n);
        const balanceAfter = (await ledger.getChannelBalance(channelId)).availableBalanceCents;
        strict_1.default.equal(balanceAfter - balanceBefore, 6600n);
        // Verify durable AdRevenueAttributionLine rows in PostgreSQL
        const persistedLines = await prisma.adRevenueAttributionLine.findMany({
            where: { reconciliationId: batch1.reconciliationId },
            orderBy: { externalReportId: 'asc' },
        });
        strict_1.default.equal(persistedLines.length, 3);
        const byReportId = new Map(persistedLines.map((l) => [l.externalReportId, l]));
        const stdLine = byReportId.get(`rep-std-${runSuffix}`);
        const shortLine = byReportId.get(`rep-short-${runSuffix}`);
        const heldLine = byReportId.get(`rep-held-${runSuffix}`);
        strict_1.default.equal(stdLine.status, 'VERIFIED_CREDITED');
        strict_1.default.equal(stdLine.appliedShortsRateBps, null);
        strict_1.default.equal(stdLine.creatorAttributableCents, 4950n);
        strict_1.default.ok(stdLine.ledgerReferenceId);
        strict_1.default.equal(shortLine.status, 'VERIFIED_CREDITED');
        strict_1.default.equal(shortLine.isShort, true);
        strict_1.default.equal(shortLine.appliedShortsRateBps, 3000);
        strict_1.default.equal(shortLine.creatorAttributableCents, 1650n);
        strict_1.default.ok(shortLine.ledgerReferenceId);
        strict_1.default.equal(heldLine.status, 'VERIFIED_ESCROW_HELD');
        strict_1.default.equal(heldLine.escrowWithheldCents, 5500n);
        strict_1.default.equal(heldLine.creatorAttributableCents, 0n);
        strict_1.default.equal(heldLine.ledgerReferenceId, null);
        // 4c. Restarted service re-running same batch deduplicates ALL 3 persisted lines (including escrow-held line with 0n wallet tx)
        const restartedService = new advertising_1.RevenueAttributionService(new advertising_1.PrismaRevenueAttributionRepository(prisma), new ledger_service_1.WalletLedgerService(new ledger_service_1.PrismaWalletLedgerRepository(prisma)), attrAuditRecorder);
        const batch2 = await restartedService.reconcileVerifiedReports({
            periodMonth: '2026-11',
            policy: testExplicitPolicy,
            actor: { id: adminUserId, role: 'SUPER_ADMIN' },
            reports: reportBatch.slice(0, 3),
        });
        createdReconIds.push(batch2.reconciliationId);
        strict_1.default.equal(batch2.verifiedLineCount, 0);
        strict_1.default.equal(batch2.duplicateLineCount, 3);
        strict_1.default.equal(batch2.totalCreatorAttributableCents, 0n);
        strict_1.default.equal((await ledger.getChannelBalance(channelId)).availableBalanceCents, balanceAfter);
        const auditCount = await prisma.adminAuditLog.count({
            where: {
                actorId: { in: [userId, adminUserId] },
                action: { in: ['WALLET_PAYOUT_INITIATED', 'WALLET_PAYOUT_SETTLED', 'PAYMENT_SETTLED', 'PAYMENT_REFUND_OR_REVERSAL', 'REVENUE_RECONCILED'] },
            },
        });
        strict_1.default.ok(auditCount >= 5, `Expected durable audit records in Postgres, got ${auditCount}`);
    });
});
