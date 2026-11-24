import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request, Response, RequestHandler } from 'express';
import { afterEach, describe, it } from 'node:test';
import { AuthRequest } from '../src/middleware/auth';
import { requireAdmin, requireSuperAdmin } from '../src/middleware/admin';
import {
  getPlatformHealthOverview,
  getOperationalOverview,
} from '../src/services/ceoDashboard.service';
import {
  listAuditLogs,
  RESTRICTED_OWNER_AUDIT_RESOURCES,
} from '../src/services/audit.service';
import {
  createWtppApplicationsRouter,
  WtppApplicationsRepository,
  WtppAdminApplication,
} from '../src/routes/wtpp-applications.route';

let activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  activeServers = [];
});

interface MockUser {
  id: string;
  email: string;
  role: string;
  status: 'GOOD_STANDING' | 'WARNING' | 'RESTRICTED' | 'SUSPENDED';
  createdAt: Date;
  updatedAt: Date;
  passwordHash: string;
  channels: Array<{
    id: string;
    name: string;
    handle: string;
    isVerified: boolean;
    isMonetized: boolean;
    subscriberCount: number;
  }>;
  strikes: Array<{
    id: string;
    reason: string;
    strikeType: string;
    expiresAt: Date;
    createdAt: Date;
  }>;
}

function createMockUsersApp(currentUser: { id: string; role: string; permissions: string[] }) {
  const app = express();
  app.use(express.json());

  const mockUsers: MockUser[] = [
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

  const authMiddleware: RequestHandler = (req, _res, next) => {
    (req as AuthRequest).user = currentUser as any;
    next();
  };

  const requirePerm = (permission: string): RequestHandler => {
    return (req, res, next) => {
      const u = (req as AuthRequest).user as any;
      if (!u) return res.status(401).json({ error: 'Unauthorized' });
      if (u.role === 'SUPER_ADMIN' || (Array.isArray(u.permissions) && u.permissions.includes(permission))) {
        return next();
      }
      return res.status(403).json({ error: `Forbidden: Missing permission ${permission}` });
    };
  };

  const router = express.Router();

  // GET /api/v1/admin/users
  router.get('/', requirePerm('users.view'), (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;

    let filtered = [...mockUsers];
    if (status) filtered = filtered.filter((u) => u.status === status);
    if (role) filtered = filtered.filter((u) => u.role === role);
    if (search) {
      filtered = filtered.filter(
        (u) =>
          u.email.toLowerCase().includes(search) ||
          u.channels.some((c) => c.name.toLowerCase().includes(search) || c.handle.toLowerCase().includes(search))
      );
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
  router.get('/:id', requirePerm('users.view'), (req: Request, res: Response) => {
    const u = mockUsers.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const { passwordHash: _discard, ...safe } = u;
    res.status(200).json(safe);
  });

  // POST /api/v1/admin/users/:id/suspend
  router.post('/:id/suspend', requirePerm('users.suspend'), (req: AuthRequest, res: Response) => {
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
    if (!target) return res.status(404).json({ error: 'User not found.' });

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
  router.post('/:id/reinstate', requirePerm('users.suspend'), (req: AuthRequest, res: Response) => {
    const target = mockUsers.find((x) => x.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

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
  router.get('/:id/strikes', requirePerm('users.view'), (req: Request, res: Response) => {
    const target = mockUsers.find((x) => x.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    res.status(200).json(target.strikes);
  });

  app.use('/api/v1/admin/users', authMiddleware, router);
  return app;
}

async function startServer(app: express.Express): Promise<string> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe('WatchTube Admin Governance & Platform Health Test Suite', () => {
  describe('User Management API & Policy Invariants', () => {
    it('allows an authorized admin to search users and verifies passwordHash is omitted', async () => {
      const app = createMockUsersApp({
        id: '00000000-0000-0000-0000-000000000002',
        role: 'ADMIN',
        permissions: ['users.view', 'users.suspend'],
      });
      const baseUrl = await startServer(app);

      const res = await fetch(`${baseUrl}/api/v1/admin/users?search=spammer`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.users.length, 1);
      assert.equal(data.users[0].email, 'bad_actor@watchtube.com');
      assert.equal(data.users[0].passwordHash, undefined, 'passwordHash must never be exposed');
    });

    it('rejects user lookup or suspension if actor lacks required permissions', async () => {
      const app = createMockUsersApp({
        id: '00000000-0000-0000-0000-000000000099',
        role: 'USER',
        permissions: [],
      });
      const baseUrl = await startServer(app);

      const res = await fetch(`${baseUrl}/api/v1/admin/users`);
      assert.equal(res.status, 403);
    });

    it('enforces self-suspension guard (admin cannot suspend self)', async () => {
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
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /cannot suspend their own account/i);
    });

    it('enforces SUPER_ADMIN protection (super admin accounts cannot be suspended)', async () => {
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
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /Super Administrator accounts cannot be suspended/i);
    });

    it('successfully suspends an ordinary user and prevents redundant re-suspension', async () => {
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
      assert.equal(noReasonRes.status, 400);

      // Valid suspension -> 200
      const suspendRes = await fetch(`${baseUrl}/api/v1/admin/users/${badUserId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Repeated spam violations' }),
      });
      assert.equal(suspendRes.status, 200);
      const suspendData = await suspendRes.json();
      assert.equal(suspendData.status, 'SUSPENDED');

      // Attempt re-suspending -> 400
      const resuspendRes = await fetch(`${baseUrl}/api/v1/admin/users/${badUserId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Try again' }),
      });
      assert.equal(resuspendRes.status, 400);
      const resuspendData = await resuspendRes.json();
      assert.match(resuspendData.error, /already suspended/i);
    });

    it('successfully reinstates a suspended user and rejects reinstating an active user', async () => {
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
      assert.equal(failRes.status, 400);

      // Reinstating a suspended user -> 200
      const reinstateRes = await fetch(`${baseUrl}/api/v1/admin/users/${suspendedId}/reinstate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Appeal accepted' }),
      });
      assert.equal(reinstateRes.status, 200);
      const reinstateData = await reinstateRes.json();
      assert.equal(reinstateData.status, 'GOOD_STANDING');
    });

    it('retrieves user strikes list for an existing user', async () => {
      const badUserId = '00000000-0000-0000-0000-000000000003';
      const app = createMockUsersApp({
        id: '00000000-0000-0000-0000-000000000002',
        role: 'ADMIN',
        permissions: ['users.view'],
      });
      const baseUrl = await startServer(app);

      const res = await fetch(`${baseUrl}/api/v1/admin/users/${badUserId}/strikes`);
      assert.equal(res.status, 200);
      const strikes = await res.json();
      assert.equal(Array.isArray(strikes), true);
      assert.equal(strikes.length, 1);
      assert.equal(strikes[0].strikeType, 'WARNING');
    });
  });

  describe('Platform Health & Truthful Metrics Verification', () => {
    it('returns truthful platform health indicators including database and queue backlogs', async () => {
      const health = await getPlatformHealthOverview(true);
      assert.equal(health.apiHealth, 'HEALTHY');
      assert.ok(['CONNECTED', 'DISCONNECTED'].includes(health.database));
      assert.ok(['CONFIGURED', 'PARTIAL', 'DEGRADED'].includes(health.storage.status));
      assert.equal(health.redisQueue.status, 'CONNECTED');

      // Detailed blocks
      assert.equal(health.api?.status, 'HEALTHY');
      assert.ok(typeof health.api?.uptimeSeconds === 'number');
      assert.ok(health.videoQueue?.backlog !== undefined);
      assert.ok(typeof health.videoQueue?.backlog?.ready === 'number');
      assert.ok(typeof health.videoQueue?.backlog?.processing === 'number');

      // Payment gateway honest state
      assert.ok(health.payments?.mtnMoMo !== undefined);
      assert.ok(health.payments?.airtelMoney !== undefined);
    });

    it('returns operational overview without company financial intelligence', async () => {
      const overview = await getOperationalOverview();
      assert.ok(typeof overview.users.total === 'number');
      assert.ok(typeof overview.users.byStatus.goodStanding === 'number');
      assert.ok(typeof overview.creators.totalChannels === 'number');
      assert.ok(typeof overview.content.totalVideos === 'number');
      assert.ok(typeof overview.queues.openCases === 'number');

      // Crucial security invariant: ordinary operational overview must NEVER have revenue numbers
      assert.equal((overview as any).financials, undefined);
      assert.equal((overview as any).grossAdRevenueCents, undefined);
      assert.equal((overview as any).creatorPoolCents, undefined);
      assert.equal((overview as any).payouts, undefined);
    });
  });

  describe('WTPP Application Detail & Masking Verification', () => {
    it('returns application detail and masks identity numbers via boolean flags', async () => {
      const mockRepo: WtppApplicationsRepository = {
        async listPendingApplications() {
          return [];
        },
        async getApplicationById(id: string): Promise<WtppAdminApplication | null> {
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

      const app = express();
      app.use(express.json());
      app.use('/wtpp', createWtppApplicationsRouter(mockRepo));
      const baseUrl = await startServer(app);

      const res = await fetch(`${baseUrl}/wtpp/wtpp-app-1`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.id, 'wtpp-app-1');
      assert.equal(data.channel.name, 'Rising Star');
      assert.equal(data.hasTaxId, true);
      assert.equal(data.hasNationalId, true);
      assert.equal((data as any).taxId, undefined, 'Raw taxId must not be returned');
      assert.equal((data as any).nationalIdOrPassport, undefined, 'Raw identity document must not be returned');

      // 404 for non-existent application
      const notFoundRes = await fetch(`${baseUrl}/wtpp/wtpp-app-nonexistent`);
      assert.equal(notFoundRes.status, 404);
    });
  });

  describe('Audit Log Operational Filtering & Access Control', () => {
    it('verifies that RESTRICTED_OWNER_AUDIT_RESOURCES contains financial, security, and payment resources', () => {
      assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('FINANCE' as any));
      assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('SECURITY' as any));
      assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('PAYMENT_CONFIG' as any));
      assert.ok(RESTRICTED_OWNER_AUDIT_RESOURCES.includes('PAYOUT' as any));
    });

    it('rejects operational query for restricted owner resources when operationalOnly is true', async () => {
      const result = await listAuditLogs({
        targetResource: 'FINANCE',
        operationalOnly: true,
      });
      assert.equal(result.logs.length, 0);
      assert.equal(result.total, 0);
    });
  });
});
