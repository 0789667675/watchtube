import assert from 'node:assert/strict';
import express, { RequestHandler } from 'express';
import { createServer, Server } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { AuthRequest } from '../src/middleware/auth';
import { requireAdmin, requireSuperAdmin } from '../src/middleware/admin';
import { createInvitationPublicRouter, InvitationPublicService } from '../src/routes/invitation-public.route';

const activeServers: Server[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const s = activeServers.pop();
    if (s) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  }
});

function createMockAuth(user: { id: string; role: string; permissions?: string[] } | null): RequestHandler {
  return (req, res, next) => {
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as AuthRequest).user = user;
    next();
  };
}

async function startTestApp(user: { id: string; role: string; permissions?: string[] } | null): Promise<string> {
  const app = express();
  app.use(express.json());

  const mockInvitationService: InvitationPublicService = {
    async verifyInvitationToken(token: string) {
      if (token === 'valid-test-token-12345') {
        return {
          valid: true,
          invitation: {
            id: 'inv-1',
            email: 'partner@watchtube.com',
            positionNumber: 1,
            assignment: 'Creator Support',
          },
        };
      }
      return { valid: false, error: 'Invalid or unknown invitation token.' };
    },
    async acceptInvitation(input: { token: string; password: string }) {
      if (input.token !== 'valid-test-token-12345') {
        throw new Error('Invalid or unknown invitation token.');
      }
      return {
        userId: 'partner-user-1',
        email: 'partner@watchtube.com',
        positionNumber: 1,
      };
    },
  };

  // Mount public invitation routes with mock service
  app.use('/api/v1/admin/invitations', createInvitationPublicRouter(mockInvitationService));

  // Authenticated mock admin routes
  const adminRouter = express.Router();
  adminRouter.use(createMockAuth(user));

  // CEO routes (requireSuperAdmin)
  adminRouter.get('/ceo/overview', requireSuperAdmin, (_req, res) => {
    res.status(200).json({ ok: true, scope: 'ceo_overview' });
  });

  adminRouter.get('/ceo/financial-intelligence', requireSuperAdmin, (_req, res) => {
    res.status(200).json({ ok: true, scope: 'financial_intelligence' });
  });

  // Admin Management routes (requireSuperAdmin for mutations, requireAdmin for view)
  adminRouter.get('/management/positions', requireAdmin, (_req, res) => {
    res.status(200).json([
      { positionNumber: 1, status: 'VACANT' },
      { positionNumber: 2, status: 'VACANT' },
      { positionNumber: 3, status: 'VACANT' },
    ]);
  });

  adminRouter.post('/management/invitations', requireSuperAdmin, (_req, res) => {
    res.status(201).json({ success: true, message: 'Invitation issued' });
  });

  adminRouter.post('/management/positions/:pos/suspend', requireSuperAdmin, (_req, res) => {
    res.status(200).json({ success: true, status: 'SUSPENDED' });
  });

  // Operational support routes (requireAdmin)
  adminRouter.get('/cases', requireAdmin, (_req, res) => {
    res.status(200).json({ cases: [], total: 0 });
  });

  app.use('/api/v1/admin', adminRouter);

  const server = createServer(app);
  activeServers.push(server);

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('Company Administration & Ownership Protection HTTP Endpoints', () => {
  it('Public invitation verify rejects non-existent tokens with HTTP 400', async () => {
    const baseUrl = await startTestApp(null);
    const res = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/invalid-token-12345`);
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.match(body.error, /invalid or unknown/i);
  });

  it('Public invitation verify succeeds for valid token', async () => {
    const baseUrl = await startTestApp(null);
    const res = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/valid-test-token-12345`);
    assert.equal(res.status, 200);
    const body = await res.json() as { email: string; positionNumber: number };
    assert.equal(body.email, 'partner@watchtube.com');
    assert.equal(body.positionNumber, 1);
  });

  it('Public invitation accept validates password length', async () => {
    const baseUrl = await startTestApp(null);
    const res = await fetch(`${baseUrl}/api/v1/admin/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'long-enough-token-for-test-12345', password: 'short' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.match(body.error, /at least 8 characters/i);
  });

  it('Public invitation accept succeeds with valid token and password', async () => {
    const baseUrl = await startTestApp(null);
    const res = await fetch(`${baseUrl}/api/v1/admin/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid-test-token-12345', password: 'SecurePassword123' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { success: boolean; account: { email: string } };
    assert.equal(body.success, true);
    assert.equal(body.account.email, 'partner@watchtube.com');
  });

  it('Unauthenticated requests to admin management are rejected with HTTP 401', async () => {
    const baseUrl = await startTestApp(null);
    const res = await fetch(`${baseUrl}/api/v1/admin/management/positions`);
    assert.equal(res.status, 401);
  });

  it('Ordinary USER accounts are forbidden from admin routes with HTTP 403', async () => {
    const baseUrl = await startTestApp({ id: 'user-1', role: 'USER' });
    const res = await fetch(`${baseUrl}/api/v1/admin/management/positions`);
    assert.equal(res.status, 403);
  });

  it('Ordinary ADMIN can access operational routes and view positions', async () => {
    const baseUrl = await startTestApp({ id: 'admin-1', role: 'ADMIN' });
    const resPositions = await fetch(`${baseUrl}/api/v1/admin/management/positions`);
    assert.equal(resPositions.status, 200);

    const resCases = await fetch(`${baseUrl}/api/v1/admin/cases`);
    assert.equal(resCases.status, 200);
  });

  it('Ordinary ADMIN is strictly forbidden from CEO financial intelligence (HTTP 403)', async () => {
    const baseUrl = await startTestApp({ id: 'admin-1', role: 'ADMIN' });
    const res = await fetch(`${baseUrl}/api/v1/admin/ceo/financial-intelligence`);
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string };
    assert.match(body.error, /SUPER_ADMIN/i);
  });

  it('Ordinary ADMIN is strictly forbidden from inviting partners or suspending positions (HTTP 403)', async () => {
    const baseUrl = await startTestApp({ id: 'admin-1', role: 'ADMIN' });
    const resInvite = await fetch(`${baseUrl}/api/v1/admin/management/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@partner.com', positionNumber: 2, assignment: 'Support' }),
    });
    assert.equal(resInvite.status, 403);

    const resSuspend = await fetch(`${baseUrl}/api/v1/admin/management/positions/1/suspend`, {
      method: 'POST',
    });
    assert.equal(resSuspend.status, 403);
  });

  it('SUPER_ADMIN has authorized access to CEO dashboard, financial intelligence, and invitations', async () => {
    const baseUrl = await startTestApp({ id: 'owner-ceo-1', role: 'SUPER_ADMIN' });

    const resOverview = await fetch(`${baseUrl}/api/v1/admin/ceo/overview`);
    assert.equal(resOverview.status, 200);

    const resFinances = await fetch(`${baseUrl}/api/v1/admin/ceo/financial-intelligence`);
    assert.equal(resFinances.status, 200);

    const resInvite = await fetch(`${baseUrl}/api/v1/admin/management/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@partner.com', positionNumber: 2, assignment: 'Support' }),
    });
    assert.equal(resInvite.status, 201);
  });
});
