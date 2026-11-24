"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const node_http_1 = require("node:http");
const node_test_1 = require("node:test");
const admin_1 = require("../src/middleware/admin");
const invitation_public_route_1 = require("../src/routes/invitation-public.route");
const activeServers = [];
(0, node_test_1.afterEach)(async () => {
    while (activeServers.length > 0) {
        const s = activeServers.pop();
        if (s) {
            await new Promise((resolve) => s.close(() => resolve()));
        }
    }
});
function createMockAuth(user) {
    return (req, res, next) => {
        if (!user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        req.user = user;
        next();
    };
}
async function startTestApp(user) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const mockInvitationService = {
        async verifyInvitationToken(token) {
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
        async acceptInvitation(input) {
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
    app.use('/api/v1/admin/invitations', (0, invitation_public_route_1.createInvitationPublicRouter)(mockInvitationService));
    // Authenticated mock admin routes
    const adminRouter = express_1.default.Router();
    adminRouter.use(createMockAuth(user));
    // CEO routes (requireSuperAdmin)
    adminRouter.get('/ceo/overview', admin_1.requireSuperAdmin, (_req, res) => {
        res.status(200).json({ ok: true, scope: 'ceo_overview' });
    });
    adminRouter.get('/ceo/financial-intelligence', admin_1.requireSuperAdmin, (_req, res) => {
        res.status(200).json({ ok: true, scope: 'financial_intelligence' });
    });
    // Admin Management routes (requireSuperAdmin for mutations, requireAdmin for view)
    adminRouter.get('/management/positions', admin_1.requireAdmin, (_req, res) => {
        res.status(200).json([
            { positionNumber: 1, status: 'VACANT' },
            { positionNumber: 2, status: 'VACANT' },
            { positionNumber: 3, status: 'VACANT' },
        ]);
    });
    adminRouter.post('/management/invitations', admin_1.requireSuperAdmin, (_req, res) => {
        res.status(201).json({ success: true, message: 'Invitation issued' });
    });
    adminRouter.post('/management/positions/:pos/suspend', admin_1.requireSuperAdmin, (_req, res) => {
        res.status(200).json({ success: true, status: 'SUSPENDED' });
    });
    // Operational support routes (requireAdmin)
    adminRouter.get('/cases', admin_1.requireAdmin, (_req, res) => {
        res.status(200).json({ cases: [], total: 0 });
    });
    app.use('/api/v1/admin', adminRouter);
    const server = (0, node_http_1.createServer)(app);
    activeServers.push(server);
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            resolve(`http://127.0.0.1:${port}`);
        });
    });
}
(0, node_test_1.describe)('Company Administration & Ownership Protection HTTP Endpoints', () => {
    (0, node_test_1.it)('Public invitation verify rejects non-existent tokens with HTTP 400', async () => {
        const baseUrl = await startTestApp(null);
        const res = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/invalid-token-12345`);
        strict_1.default.equal(res.status, 400);
        const body = await res.json();
        strict_1.default.match(body.error, /invalid or unknown/i);
    });
    (0, node_test_1.it)('Public invitation verify succeeds for valid token', async () => {
        const baseUrl = await startTestApp(null);
        const res = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/valid-test-token-12345`);
        strict_1.default.equal(res.status, 200);
        const body = await res.json();
        strict_1.default.equal(body.email, 'partner@watchtube.com');
        strict_1.default.equal(body.positionNumber, 1);
    });
    (0, node_test_1.it)('Public invitation accept validates password length', async () => {
        const baseUrl = await startTestApp(null);
        const res = await fetch(`${baseUrl}/api/v1/admin/invitations/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'long-enough-token-for-test-12345', password: 'short' }),
        });
        strict_1.default.equal(res.status, 400);
        const body = await res.json();
        strict_1.default.match(body.error, /at least 8 characters/i);
    });
    (0, node_test_1.it)('Public invitation accept succeeds with valid token and password', async () => {
        const baseUrl = await startTestApp(null);
        const res = await fetch(`${baseUrl}/api/v1/admin/invitations/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'valid-test-token-12345', password: 'SecurePassword123' }),
        });
        strict_1.default.equal(res.status, 200);
        const body = await res.json();
        strict_1.default.equal(body.success, true);
        strict_1.default.equal(body.account.email, 'partner@watchtube.com');
    });
    (0, node_test_1.it)('Unauthenticated requests to admin management are rejected with HTTP 401', async () => {
        const baseUrl = await startTestApp(null);
        const res = await fetch(`${baseUrl}/api/v1/admin/management/positions`);
        strict_1.default.equal(res.status, 401);
    });
    (0, node_test_1.it)('Ordinary USER accounts are forbidden from admin routes with HTTP 403', async () => {
        const baseUrl = await startTestApp({ id: 'user-1', role: 'USER' });
        const res = await fetch(`${baseUrl}/api/v1/admin/management/positions`);
        strict_1.default.equal(res.status, 403);
    });
    (0, node_test_1.it)('Ordinary ADMIN can access operational routes and view positions', async () => {
        const baseUrl = await startTestApp({ id: 'admin-1', role: 'ADMIN' });
        const resPositions = await fetch(`${baseUrl}/api/v1/admin/management/positions`);
        strict_1.default.equal(resPositions.status, 200);
        const resCases = await fetch(`${baseUrl}/api/v1/admin/cases`);
        strict_1.default.equal(resCases.status, 200);
    });
    (0, node_test_1.it)('Ordinary ADMIN is strictly forbidden from CEO financial intelligence (HTTP 403)', async () => {
        const baseUrl = await startTestApp({ id: 'admin-1', role: 'ADMIN' });
        const res = await fetch(`${baseUrl}/api/v1/admin/ceo/financial-intelligence`);
        strict_1.default.equal(res.status, 403);
        const body = await res.json();
        strict_1.default.match(body.error, /SUPER_ADMIN/i);
    });
    (0, node_test_1.it)('Ordinary ADMIN is strictly forbidden from inviting partners or suspending positions (HTTP 403)', async () => {
        const baseUrl = await startTestApp({ id: 'admin-1', role: 'ADMIN' });
        const resInvite = await fetch(`${baseUrl}/api/v1/admin/management/invitations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'new@partner.com', positionNumber: 2, assignment: 'Support' }),
        });
        strict_1.default.equal(resInvite.status, 403);
        const resSuspend = await fetch(`${baseUrl}/api/v1/admin/management/positions/1/suspend`, {
            method: 'POST',
        });
        strict_1.default.equal(resSuspend.status, 403);
    });
    (0, node_test_1.it)('SUPER_ADMIN has authorized access to CEO dashboard, financial intelligence, and invitations', async () => {
        const baseUrl = await startTestApp({ id: 'owner-ceo-1', role: 'SUPER_ADMIN' });
        const resOverview = await fetch(`${baseUrl}/api/v1/admin/ceo/overview`);
        strict_1.default.equal(resOverview.status, 200);
        const resFinances = await fetch(`${baseUrl}/api/v1/admin/ceo/financial-intelligence`);
        strict_1.default.equal(resFinances.status, 200);
        const resInvite = await fetch(`${baseUrl}/api/v1/admin/management/invitations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'new@partner.com', positionNumber: 2, assignment: 'Support' }),
        });
        strict_1.default.equal(resInvite.status, 201);
    });
});
