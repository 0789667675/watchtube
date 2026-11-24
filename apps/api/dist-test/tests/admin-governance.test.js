"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const ceoDashboard_service_1 = require("../src/services/ceoDashboard.service");
const audit_service_1 = require("../src/services/audit.service");
const wtpp_applications_route_1 = require("../src/routes/wtpp-applications.route");
let activeServers = [];
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
    activeServers = [];
});
function createMockUsersApp(currentUser) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const mockUsers = [
        {
            id: '00000000-0000-0000-0000-000000000001',
            email: 'founder@watchtube.com',
            role: 'SUPER_ADMIN',
            status: 'GOOD_STANDING',
            passwordHash: 'secret_hash_never_leak',
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
            channels: [{ id: 'ch-1', name: 'Official Channel', handle: 'official', isVerified: true, isMonetized: true, subscriberCount: 1000 }],
            strikes: [],
        },
        {
            id: '00000000-0000-0000-0000-000000000002',
            email: 'admin_partner@watchtube.com',
            role: 'ADMIN',
            status: 'GOOD_STANDING',
            passwordHash: 'secret_hash_never_leak',
            createdAt: new Date('2026-01-02'),
            updatedAt: new Date('2026-01-02'),
            channels: [],
            strikes: [],
        },
        {
            id: '00000000-0000-0000-0000-000000000003',
            email: 'bad_actor@watchtube.com',
            role: 'USER',
            status: 'GOOD_STANDING',
            passwordHash: 'secret_hash_never_leak',
            createdAt: new Date('2026-02-01'),
            updatedAt: new Date('2026-02-01'),
            channels: [{ id: 'ch-3', name: 'Spam Channel', handle: 'spammer', isVerified: false, isMonetized: false, subscriberCount: 5 }],
            strikes: [
                {
                    id: 'strike-1',
                    reason: 'Spam link in description',
                    strikeType: 'WARNING',
                    expiresAt: new Date('2026-05-01'),
                    createdAt: new Date('2026-02-02'),
                },
            ],
        },
        {
            id: '00000000-0000-0000-0000-000000000004',
            email: 'suspended_user@watchtube.com',
            role: 'USER',
            status: 'SUSPENDED',
            passwordHash: 'secret_hash_never_leak',
            createdAt: new Date('2026-02-05'),
            updatedAt: new Date('2026-02-05'),
            channels: [],
            strikes: [],
        },
    ];
    const authMiddleware = (req, _res, next) => {
        req.user = currentUser;
        next();
    };
    const requirePerm = (permission) => {
        return (req, res, next) => {
            const u = req.user;
            if (!u)
                return res.status(401).json({ error: 'Unauthorized' });
            if (u.role === 'SUPER_ADMIN' || (Array.isArray(u.permissions) && u.permissions.includes(permission))) {
                return next();
            }
            return res.status(403).json({ error: `Forbidden: Missing permission ${permission}` });
        };
    };
    const router = express_1.default.Router();
    // GET /api/v1/admin/users
    router.get('/', requirePerm('users.view'), (req, res) => {
        const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const role = typeof req.query.role === 'string' ? req.query.role : undefined;
        let filtered = [...mockUsers];
        if (status)
            filtered = filtered.filter((u) => u.status === status);
        if (role)
            filtered = filtered.filter((u) => u.role === role);
        if (search) {
            filtered = filtered.filter((u) => u.email.toLowerCase().includes(search) ||
                u.channels.some((c) => c.name.toLowerCase().includes(search) || c.handle.toLowerCase().includes(search)));
        }
        const safeUsers = filtered.map(({ passwordHash: _discard, ...safe }) => ({
            ...safe,
            _count: { strikes: safe.strikes.length, reports: 0 },
        }));
        res.status(200).json({
            users: safeUsers,
            total: safeUsers.length,
            page: 1,
            limit: 20,
            totalPages: 1,
        });
    });
    // GET /api/v1/admin/users/:id
    router.get('/:id', requirePerm('users.view'), (req, res) => {
        const u = mockUsers.find((x) => x.id === req.params.id);
        if (!u)
            return res.status(404).json({ error: 'User not found.' });
        const { passwordHash: _discard, ...safe } = u;
        res.status(200).json(safe);
    });
    // POST /api/v1/admin/users/:id/suspend
    router.post('/:id/suspend', requirePerm('users.suspend'), (req, res) => {
        const targetId = req.params.id;
        const { reason } = req.body || {};
        if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
            return res.status(400).json({ error: 'A valid suspension reason is required.' });
        }
        // Invariant 1: Self-suspension guard
        if (req.user?.id === targetId) {
            return res.status(400).json({ error: 'Administrators cannot suspend their own account.' });
        }
        const target = mockUsers.find((x) => x.id === targetId);
        if (!target)
            return res.status(404).json({ error: 'User not found.' });
        // Invariant 2: SUPER_ADMIN suspension guard
        if (target.role === 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Super Administrator accounts cannot be suspended.' });
        }
        // Invariant 3: Already suspended guard
        if (target.status === 'SUSPENDED') {
            return res.status(400).json({ error: 'User account is already suspended.' });
        }
        target.status = 'SUSPENDED';
        res.status(200).json({
            success: true,
            message: 'User account suspended successfully.',
            userId: target.id,
            status: 'SUSPENDED',
        });
    });
    // POST /api/v1/admin/users/:id/reinstate
    router.post('/:id/reinstate', requirePerm('users.suspend'), (req, res) => {
        const target = mockUsers.find((x) => x.id === req.params.id);
        if (!target)
            return res.status(404).json({ error: 'User not found.' });
        if (target.status !== 'SUSPENDED') {
            return res.status(400).json({ error: 'User account is not currently suspended.' });
        }
        target.status = 'GOOD_STANDING';
        res.status(200).json({
            success: true,
            message: 'User account reinstated successfully.',
            userId: target.id,
            status: 'GOOD_STANDING',
        });
    });
    // GET /api/v1/admin/users/:id/strikes
    router.get('/:id/strikes', requirePerm('users.view'), (req, res) => {
        const target = mockUsers.find((x) => x.id === req.params.id);
        if (!target)
            return res.status(404).json({ error: 'User not found.' });
        res.status(200).json(target.strikes);
    });
    app.use('/api/v1/admin/users', authMiddleware, router);
    return app;
}
async function startServer(app) {
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
(0, node_test_1.describe)('WatchTube Admin Governance & Platform Health Test Suite', () => {
    (0, node_test_1.describe)('User Management API & Policy Invariants', () => {
        (0, node_test_1.it)('allows an authorized admin to search users and verifies passwordHash is omitted', async () => {
            const app = createMockUsersApp({
                id: '00000000-0000-0000-0000-000000000002',
                role: 'ADMIN',
                permissions: ['users.view', 'users.suspend'],
            });
            const baseUrl = await startServer(app);
            const res = await fetch(`${baseUrl}/api/v1/admin/users?search=spammer`);
            strict_1.default.equal(res.status, 200);
            const data = await res.json();
            strict_1.default.equal(data.users.length, 1);
            strict_1.default.equal(data.users[0].email, 'bad_actor@watchtube.com');
            strict_1.default.equal(data.users[0].passwordHash, undefined, 'passwordHash must never be exposed');
        });
        (0, node_test_1.it)('rejects user lookup or suspension if actor lacks required permissions', async () => {
            const app = createMockUsersApp({
                id: '00000000-0000-0000-0000-000000000099',
                role: 'USER',
                permissions: [],
            });
            const baseUrl = await startServer(app);
            const res = await fetch(`${baseUrl}/api/v1/admin/users`);
            strict_1.default.equal(res.status, 403);
        });
        (0, node_test_1.it)('enforces self-suspension guard (admin cannot suspend self)', async () => {
            const adminId = '00000000-0000-0000-0000-000000000002';
            const app = createMockUsersApp({
                id: adminId,
                role: 'ADMIN',
                permissions: ['users.view', 'users.suspend'],
            });
            const baseUrl = await startServer(app);
            const res = await fetch(`${baseUrl}/api/v1/admin/users/${adminId}/suspend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Self-inflicted test suspension' }),
            });
            strict_1.default.equal(res.status, 400);
            const data = await res.json();
            strict_1.default.match(data.error, /cannot suspend their own account/i);
        });
        (0, node_test_1.it)('enforces SUPER_ADMIN protection (super admin accounts cannot be suspended)', async () => {
            const founderId = '00000000-0000-0000-0000-000000000001';
            const app = createMockUsersApp({
                id: '00000000-0000-0000-0000-000000000002',
                role: 'ADMIN',
                permissions: ['users.view', 'users.suspend'],
            });
            const baseUrl = await startServer(app);
            const res = await fetch(`${baseUrl}/api/v1/admin/users/${founderId}/suspend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Malicious attempt to suspend super admin' }),
            });
            strict_1.default.equal(res.status, 403);
            const data = await res.json();
            strict_1.default.match(data.error, /Super Administrator accounts cannot be suspended/i);
        });
        (0, node_test_1.it)('successfully suspends an ordinary user and prevents redundant re-suspension', async () => {
            const badUserId = '00000000-0000-0000-0000-000000000003';
            const app = createMockUsersApp({
                id: '00000000-0000-0000-0000-000000000002',
                role: 'ADMIN',
                permissions: ['users.view', 'users.suspend'],
            });
            const baseUrl = await startServer(app);
            // Attempt without reason -> 400
            const noReasonRes = await fetch(`${baseUrl}/api/v1/admin/users/${badUserId}/suspend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: '' }),
            });
            strict_1.default.equal(noReasonRes.status, 400);
            // Valid suspension -> 200
            const suspendRes = await fetch(`${baseUrl}/api/v1/admin/users/${badUserId}/suspend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Repeated spam violations' }),
            });
            strict_1.default.equal(suspendRes.status, 200);
            const suspendData = await suspendRes.json();
            strict_1.default.equal(suspendData.status, 'SUSPENDED');
            // Attempt re-suspending -> 400
            const resuspendRes = await fetch(`${baseUrl}/api/v1/admin/users/${badUserId}/suspend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Try again' }),
            });
            strict_1.default.equal(resuspendRes.status, 400);
            const resuspendData = await resuspendRes.json();
            strict_1.default.match(resuspendData.error, /already suspended/i);
        });
        (0, node_test_1.it)('successfully reinstates a suspended user and rejects reinstating an active user', async () => {
            const suspendedId = '00000000-0000-0000-0000-000000000004';
            const founderId = '00000000-0000-0000-0000-000000000001';
            const app = createMockUsersApp({
                id: '00000000-0000-0000-0000-000000000002',
                role: 'ADMIN',
                permissions: ['users.view', 'users.suspend'],
            });
            const baseUrl = await startServer(app);
            // Reinstating an already active user -> 400
            const failRes = await fetch(`${baseUrl}/api/v1/admin/users/${founderId}/reinstate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            strict_1.default.equal(failRes.status, 400);
            // Reinstating a suspended user -> 200
            const reinstateRes = await fetch(`${baseUrl}/api/v1/admin/users/${suspendedId}/reinstate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Appeal accepted' }),
            });
            strict_1.default.equal(reinstateRes.status, 200);
            const reinstateData = await reinstateRes.json();
            strict_1.default.equal(reinstateData.status, 'GOOD_STANDING');
        });
        (0, node_test_1.it)('retrieves user strikes list for an existing user', async () => {
            const badUserId = '00000000-0000-0000-0000-000000000003';
            const app = createMockUsersApp({
                id: '00000000-0000-0000-0000-000000000002',
                role: 'ADMIN',
                permissions: ['users.view'],
            });
            const baseUrl = await startServer(app);
            const res = await fetch(`${baseUrl}/api/v1/admin/users/${badUserId}/strikes`);
            strict_1.default.equal(res.status, 200);
            const strikes = await res.json();
            strict_1.default.equal(Array.isArray(strikes), true);
            strict_1.default.equal(strikes.length, 1);
            strict_1.default.equal(strikes[0].strikeType, 'WARNING');
        });
    });
    (0, node_test_1.describe)('Platform Health & Truthful Metrics Verification', () => {
        (0, node_test_1.it)('returns truthful platform health indicators including database and queue backlogs', async () => {
            const health = await (0, ceoDashboard_service_1.getPlatformHealthOverview)(true);
            strict_1.default.equal(health.apiHealth, 'HEALTHY');
            strict_1.default.ok(['CONNECTED', 'DISCONNECTED'].includes(health.database));
            strict_1.default.ok(['CONFIGURED', 'PARTIAL', 'DEGRADED'].includes(health.storage.status));
            strict_1.default.equal(health.redisQueue.status, 'CONNECTED');
            // Detailed blocks
            strict_1.default.equal(health.api?.status, 'HEALTHY');
            strict_1.default.ok(typeof health.api?.uptimeSeconds === 'number');
            strict_1.default.ok(health.videoQueue?.backlog !== undefined);
            strict_1.default.ok(typeof health.videoQueue?.backlog?.ready === 'number');
            strict_1.default.ok(typeof health.videoQueue?.backlog?.processing === 'number');
            // Payment gateway honest state
            strict_1.default.ok(health.payments?.mtnMoMo !== undefined);
            strict_1.default.ok(health.payments?.airtelMoney !== undefined);
        });
        (0, node_test_1.it)('returns operational overview without company financial intelligence', async () => {
            const overview = await (0, ceoDashboard_service_1.getOperationalOverview)();
            strict_1.default.ok(typeof overview.users.total === 'number');
            strict_1.default.ok(typeof overview.users.byStatus.goodStanding === 'number');
            strict_1.default.ok(typeof overview.creators.totalChannels === 'number');
            strict_1.default.ok(typeof overview.content.totalVideos === 'number');
            strict_1.default.ok(typeof overview.queues.openCases === 'number');
            // Crucial security invariant: ordinary operational overview must NEVER have revenue numbers
            strict_1.default.equal(overview.financials, undefined);
            strict_1.default.equal(overview.grossAdRevenueCents, undefined);
            strict_1.default.equal(overview.creatorPoolCents, undefined);
            strict_1.default.equal(overview.payouts, undefined);
        });
    });
    (0, node_test_1.describe)('WTPP Application Detail & Masking Verification', () => {
        (0, node_test_1.it)('returns application detail and masks identity numbers via boolean flags', async () => {
            const mockRepo = {
                async listPendingApplications() {
                    return [];
                },
                async getApplicationById(id) {
                    if (id === 'wtpp-app-1') {
                        return {
                            id: 'wtpp-app-1',
                            channelWatchHours: 4500,
                            subscriberCount: 1500,
                            submittedAt: new Date('2026-02-10'),
                            status: 'PENDING',
                            reviewerNotes: null,
                            channel: {
                                id: 'ch-wtpp-1',
                                name: 'Rising Star',
                                handle: 'risingstar',
                                userId: 'user-wtpp-1',
                            },
                            hasTaxId: true,
                            hasNationalId: true,
                        };
                    }
                    return null;
                },
            };
            const app = (0, express_1.default)();
            app.use(express_1.default.json());
            app.use('/wtpp', (0, wtpp_applications_route_1.createWtppApplicationsRouter)(mockRepo));
            const baseUrl = await startServer(app);
            const res = await fetch(`${baseUrl}/wtpp/wtpp-app-1`);
            strict_1.default.equal(res.status, 200);
            const data = await res.json();
            strict_1.default.equal(data.id, 'wtpp-app-1');
            strict_1.default.equal(data.channel.name, 'Rising Star');
            strict_1.default.equal(data.hasTaxId, true);
            strict_1.default.equal(data.hasNationalId, true);
            strict_1.default.equal(data.taxId, undefined, 'Raw taxId must not be returned');
            strict_1.default.equal(data.nationalIdOrPassport, undefined, 'Raw identity document must not be returned');
            // 404 for non-existent application
            const notFoundRes = await fetch(`${baseUrl}/wtpp/wtpp-app-nonexistent`);
            strict_1.default.equal(notFoundRes.status, 404);
        });
    });
    (0, node_test_1.describe)('Audit Log Operational Filtering & Access Control', () => {
        (0, node_test_1.it)('verifies that RESTRICTED_OWNER_AUDIT_RESOURCES contains financial, security, and payment resources', () => {
            strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('FINANCE'));
            strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('SECURITY'));
            strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('PAYMENT_CONFIG'));
            strict_1.default.ok(audit_service_1.RESTRICTED_OWNER_AUDIT_RESOURCES.includes('PAYOUT'));
        });
        (0, node_test_1.it)('rejects operational query for restricted owner resources when operationalOnly is true', async () => {
            const result = await (0, audit_service_1.listAuditLogs)({
                targetResource: 'FINANCE',
                operationalOnly: true,
            });
            strict_1.default.equal(result.logs.length, 0);
            strict_1.default.equal(result.total, 0);
        });
    });
});
