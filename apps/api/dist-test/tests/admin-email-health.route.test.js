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
const email_1 = require("../src/services/email");
let activeServers = [];
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
    activeServers = [];
});
function startAdminHealthTestApp(outboxService) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // Test authentication middleware that reads x-test-role header
    const testAuth = (req, res, next) => {
        const roleHeader = req.get('x-test-role');
        if (!roleHeader) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const user = {
            id: req.get('x-test-user-id') || 'test-user-1',
            role: roleHeader,
            status: 'GOOD_STANDING',
            permissions: roleHeader === 'SUPER_ADMIN' ? ['*'] : ['platform.view_health', 'creators.view'],
        };
        req.user = user;
        next();
    };
    const adminRouter = express_1.default.Router();
    adminRouter.use(testAuth, admin_1.requireAdmin);
    // Operational email health inspection (accessible to ADMIN and SUPER_ADMIN via platform.view_health)
    const checkHealthPermission = (req, res, next) => {
        const u = req.user;
        if (!u)
            return res.status(401).json({ error: 'Unauthorized' });
        if (u.role === 'SUPER_ADMIN' || (Array.isArray(u.permissions) && u.permissions.includes('platform.view_health'))) {
            return next();
        }
        return res.status(403).json({ error: 'Forbidden' });
    };
    adminRouter.get('/email/health', checkHealthPermission, async (_req, res) => {
        try {
            const stats = await outboxService.getHealthStats();
            res.status(200).json(stats);
        }
        catch {
            res.status(500).json({ error: 'Email health stats are temporarily unavailable.' });
        }
    });
    // Manual re-queue of failed email outbox jobs (strictly SUPER_ADMIN only)
    adminRouter.post('/email/outbox/:id/retry', admin_1.requireSuperAdmin, async (req, res) => {
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
        }
        catch {
            res.status(500).json({ error: 'Failed to re-queue outbox job.' });
        }
    });
    app.use('/api/v1/admin', adminRouter);
    const server = (0, node_http_1.createServer)(app);
    activeServers.push(server);
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve(`http://127.0.0.1:${address.port}/api/v1/admin`);
        });
    });
}
(0, node_test_1.test)('Admin Email Health: rejects unauthenticated requests with HTTP 401', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    const service = new email_1.EmailOutboxService(repo, transport);
    const baseUrl = await startAdminHealthTestApp(service);
    const res = await fetch(`${baseUrl}/email/health`);
    strict_1.default.equal(res.status, 401);
});
(0, node_test_1.test)('Admin Email Health: rejects regular USER with HTTP 403 Forbidden', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    const service = new email_1.EmailOutboxService(repo, transport);
    const baseUrl = await startAdminHealthTestApp(service);
    const res = await fetch(`${baseUrl}/email/health`, {
        headers: { 'x-test-role': 'USER' },
    });
    strict_1.default.equal(res.status, 403);
});
(0, node_test_1.test)('Admin Email Health: returns operational health stats to ADMIN and SUPER_ADMIN without leaking PII', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    const service = new email_1.EmailOutboxService(repo, transport);
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
    strict_1.default.equal(adminRes.status, 200);
    const adminStats = await adminRes.json();
    strict_1.default.equal(typeof adminStats.pending, 'number');
    strict_1.default.equal(typeof adminStats.sent, 'number');
    strict_1.default.equal(typeof adminStats.retryableFailure, 'number');
    strict_1.default.equal(typeof adminStats.permanentFailure, 'number');
    strict_1.default.equal(typeof adminStats.total, 'number');
    strict_1.default.equal(adminStats.total, 2);
    strict_1.default.equal(adminStats.transportName, 'MOCK');
    strict_1.default.equal(adminStats.isConfigured, true);
    // PRIVACY INVARIANT: Ensure NO sensitive email addresses or bodies exist anywhere in JSON
    const rawJson = JSON.stringify(adminStats);
    strict_1.default.equal(rawJson.includes('secret-creator@example.com'), false);
    strict_1.default.equal(rawJson.includes('Confidential'), false);
    // 2. Fetch as SUPER_ADMIN
    const superAdminRes = await fetch(`${baseUrl}/email/health`, {
        headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    strict_1.default.equal(superAdminRes.status, 200);
    const superStats = await superAdminRes.json();
    strict_1.default.equal(superStats.total, 2);
});
(0, node_test_1.test)('Admin Email Retry: ordinary ADMIN cannot retry outbox jobs (SUPER_ADMIN only)', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    const transport = new email_1.MockEmailTransport();
    const service = new email_1.EmailOutboxService(repo, transport);
    const baseUrl = await startAdminHealthTestApp(service);
    // Ordinary ADMIN tries to trigger manual outbox retry
    const res = await fetch(`${baseUrl}/email/outbox/some-id/retry`, {
        method: 'POST',
        headers: { 'x-test-role': 'ADMIN' },
    });
    strict_1.default.equal(res.status, 403);
});
(0, node_test_1.test)('Admin Email Retry: SUPER_ADMIN re-queues failed outbox job', async () => {
    const repo = new email_1.InMemoryEmailOutboxRepository();
    // Configure transport that fails
    const transport = new email_1.MockEmailTransport();
    transport.setSimulateFailure(true);
    const service = new email_1.EmailOutboxService(repo, transport);
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
    strict_1.default.ok(jobBefore);
    strict_1.default.equal(jobBefore.status === 'RETRYABLE_FAILURE' || jobBefore.status === 'PERMANENT_FAILURE', true);
    const baseUrl = await startAdminHealthTestApp(service);
    // SUPER_ADMIN retries the job
    const retryRes = await fetch(`${baseUrl}/email/outbox/${enq.outboxId}/retry`, {
        method: 'POST',
        headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    strict_1.default.equal(retryRes.status, 200);
    const retryBody = await retryRes.json();
    strict_1.default.equal(retryBody.success, true);
    strict_1.default.equal(retryBody.outboxId, enq.outboxId);
    // Verify job is back in PENDING with attempts reset to 0
    const jobAfter = await repo.findById(enq.outboxId);
    strict_1.default.ok(jobAfter);
    strict_1.default.equal(jobAfter.status, 'PENDING');
    strict_1.default.equal(jobAfter.attempts, 0);
    strict_1.default.equal(jobAfter.lastError, null);
    // Retrying an already pending or non-existent job returns 404
    const retryAgain = await fetch(`${baseUrl}/email/outbox/${enq.outboxId}/retry`, {
        method: 'POST',
        headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    strict_1.default.equal(retryAgain.status, 404);
});
