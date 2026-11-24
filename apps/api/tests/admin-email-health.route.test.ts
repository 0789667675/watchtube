import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request, Response, RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { AuthRequest } from '../src/middleware/auth';
import { requireAdmin, requireSuperAdmin } from '../src/middleware/admin';
import { requirePermission } from '../src/middleware/rbac';
import {
  EmailOutboxService,
  InMemoryEmailOutboxRepository,
  MockEmailTransport,
} from '../src/services/email';

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

interface TestUser {
  id: string;
  role: string;
  status?: 'GOOD_STANDING' | 'SUSPENDED';
  permissions?: string[];
}

function startAdminHealthTestApp(outboxService: EmailOutboxService) {
  const app = express();
  app.use(express.json());

  // Test authentication middleware that reads x-test-role header
  const testAuth: RequestHandler = (req, res, next) => {
    const roleHeader = req.get('x-test-role');
    if (!roleHeader) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user: TestUser = {
      id: req.get('x-test-user-id') || 'test-user-1',
      role: roleHeader,
      status: 'GOOD_STANDING',
      permissions: roleHeader === 'SUPER_ADMIN' ? ['*'] : ['platform.view_health', 'creators.view'],
    };
    (req as AuthRequest).user = user as any;
    next();
  };

  const adminRouter = express.Router();
  adminRouter.use(testAuth, requireAdmin);

  // Operational email health inspection (accessible to ADMIN and SUPER_ADMIN via platform.view_health)
  const checkHealthPermission: RequestHandler = (req, res, next) => {
    const u = (req as AuthRequest).user as any;
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    if (u.role === 'SUPER_ADMIN' || (Array.isArray(u.permissions) && u.permissions.includes('platform.view_health'))) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
  };

  adminRouter.get(
    '/email/health',
    checkHealthPermission,
    async (_req: Request, res: Response) => {
      try {
        const stats = await outboxService.getHealthStats();
        res.status(200).json(stats);
      } catch {
        res.status(500).json({ error: 'Email health stats are temporarily unavailable.' });
      }
    }
  );

  // Manual re-queue of failed email outbox jobs (strictly SUPER_ADMIN only)
  adminRouter.post(
    '/email/outbox/:id/retry',
    requireSuperAdmin,
    async (req: AuthRequest, res: Response) => {
      const id = req.params.id;
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Invalid outbox job ID' });
      }

      try {
        const retried = await outboxService.retryFailedJob(id);
        if (!retried) {
          return res.status(404).json({ error: 'Outbox job not found or not in a failed state.' });
        }

        res.status(200).json({
          success: true,
          message: 'Email outbox job re-queued for delivery.',
          outboxId: id,
        });
      } catch {
        res.status(500).json({ error: 'Failed to re-queue outbox job.' });
      }
    }
  );

  app.use('/api/v1/admin', adminRouter);

  const server = createServer(app);
  activeServers.push(server);

  return new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}/api/v1/admin`);
    });
  });
}

test('Admin Email Health: rejects unauthenticated requests with HTTP 401', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  const service = new EmailOutboxService(repo, transport);
  const baseUrl = await startAdminHealthTestApp(service);

  const res = await fetch(`${baseUrl}/email/health`);
  assert.equal(res.status, 401);
});

test('Admin Email Health: rejects regular USER with HTTP 403 Forbidden', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  const service = new EmailOutboxService(repo, transport);
  const baseUrl = await startAdminHealthTestApp(service);

  const res = await fetch(`${baseUrl}/email/health`, {
    headers: { 'x-test-role': 'USER' },
  });
  assert.equal(res.status, 403);
});

test('Admin Email Health: returns operational health stats to ADMIN and SUPER_ADMIN without leaking PII', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  const service = new EmailOutboxService(repo, transport);

  // Seed some outbox records
  await service.enqueueEmail({
    idempotencyKey: 'email:test:1',
    to: 'secret-creator@example.com',
    subject: 'Confidential Subject',
    text: 'Confidential body content',
  });
  await service.enqueueEmail({
    idempotencyKey: 'email:test:2',
    to: 'partner@example.com',
    subject: 'Another message',
    text: 'Another body',
  });

  const baseUrl = await startAdminHealthTestApp(service);

  // 1. Fetch as ADMIN
  const adminRes = await fetch(`${baseUrl}/email/health`, {
    headers: { 'x-test-role': 'ADMIN' },
  });
  assert.equal(adminRes.status, 200);
  const adminStats = await adminRes.json();

  assert.equal(typeof adminStats.pending, 'number');
  assert.equal(typeof adminStats.sent, 'number');
  assert.equal(typeof adminStats.retryableFailure, 'number');
  assert.equal(typeof adminStats.permanentFailure, 'number');
  assert.equal(typeof adminStats.total, 'number');
  assert.equal(adminStats.total, 2);
  assert.equal(adminStats.transportName, 'MOCK');
  assert.equal(adminStats.isConfigured, true);

  // PRIVACY INVARIANT: Ensure NO sensitive email addresses or bodies exist anywhere in JSON
  const rawJson = JSON.stringify(adminStats);
  assert.equal(rawJson.includes('secret-creator@example.com'), false);
  assert.equal(rawJson.includes('Confidential'), false);

  // 2. Fetch as SUPER_ADMIN
  const superAdminRes = await fetch(`${baseUrl}/email/health`, {
    headers: { 'x-test-role': 'SUPER_ADMIN' },
  });
  assert.equal(superAdminRes.status, 200);
  const superStats = await superAdminRes.json();
  assert.equal(superStats.total, 2);
});

test('Admin Email Retry: ordinary ADMIN cannot retry outbox jobs (SUPER_ADMIN only)', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const transport = new MockEmailTransport();
  const service = new EmailOutboxService(repo, transport);
  const baseUrl = await startAdminHealthTestApp(service);

  // Ordinary ADMIN tries to trigger manual outbox retry
  const res = await fetch(`${baseUrl}/email/outbox/some-id/retry`, {
    method: 'POST',
    headers: { 'x-test-role': 'ADMIN' },
  });
  assert.equal(res.status, 403);
});

test('Admin Email Retry: SUPER_ADMIN re-queues failed outbox job', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  // Configure transport that fails
  const transport = new MockEmailTransport();
  transport.setSimulateFailure(true);
  const service = new EmailOutboxService(repo, transport);

  // Enqueue and fail a job
  const enq = await service.enqueueEmail({
    idempotencyKey: 'fail-job-1',
    to: 'failed@example.com',
    subject: 'Will Fail',
    text: 'Body',
  });
  // Force process to fail
  await service.processPendingBatch(10);

  // Verify it is in failed state
  const jobBefore = await repo.findById(enq.outboxId);
  assert.ok(jobBefore);
  assert.equal(jobBefore.status === 'RETRYABLE_FAILURE' || jobBefore.status === 'PERMANENT_FAILURE', true);

  const baseUrl = await startAdminHealthTestApp(service);

  // SUPER_ADMIN retries the job
  const retryRes = await fetch(`${baseUrl}/email/outbox/${enq.outboxId}/retry`, {
    method: 'POST',
    headers: { 'x-test-role': 'SUPER_ADMIN' },
  });
  assert.equal(retryRes.status, 200);
  const retryBody = await retryRes.json();
  assert.equal(retryBody.success, true);
  assert.equal(retryBody.outboxId, enq.outboxId);

  // Verify job is back in PENDING with attempts reset to 0
  const jobAfter = await repo.findById(enq.outboxId);
  assert.ok(jobAfter);
  assert.equal(jobAfter.status, 'PENDING');
  assert.equal(jobAfter.attempts, 0);
  assert.equal(jobAfter.lastError, null);

  // Retrying an already pending or non-existent job returns 404
  const retryAgain = await fetch(`${baseUrl}/email/outbox/${enq.outboxId}/retry`, {
    method: 'POST',
    headers: { 'x-test-role': 'SUPER_ADMIN' },
  });
  assert.equal(retryAgain.status, 404);
});
