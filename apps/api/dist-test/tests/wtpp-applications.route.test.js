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
const wtpp_applications_route_1 = require("../src/routes/wtpp-applications.route");
const APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
let activeServers = [];
async function startServer(repository) {
    const app = (0, express_1.default)();
    const testIdentity = (req, res, next) => {
        const role = req.get('x-test-role');
        if (!role)
            return res.status(401).json({ error: 'Unauthorized' });
        req.user = {
            id: '22222222-2222-4222-8222-222222222222',
            role,
        };
        next();
    };
    app.use('/admin', testIdentity, admin_1.requireAdmin, (0, wtpp_applications_route_1.createWtppApplicationsRouter)(repository));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
    activeServers = [];
});
(0, node_test_1.test)('pending application responses omit tax and identity document numbers', async () => {
    const submittedAt = new Date('2026-01-02T03:04:05.000Z');
    const application = Object.assign({
        id: APPLICATION_ID,
        channelWatchHours: 12.5,
        subscriberCount: 42,
        submittedAt,
        channel: { name: 'Creator', handle: '@creator' },
    }, {
        taxId: 'private-tax-id',
        nationalIdOrPassport: 'private-identity-document',
        reviewerNotes: 'private-reviewer-note',
    });
    const baseUrl = await startServer({
        async listPendingApplications() {
            return [application];
        },
    });
    const denied = await fetch(`${baseUrl}/admin/`);
    strict_1.default.equal(denied.status, 401);
    const viewer = await fetch(`${baseUrl}/admin/`, { headers: { 'x-test-role': 'VIEWER' } });
    strict_1.default.equal(viewer.status, 403);
    const response = await fetch(`${baseUrl}/admin/`, { headers: { 'x-test-role': 'ADMIN' } });
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), [{
            id: APPLICATION_ID,
            channelWatchHours: 12.5,
            subscriberCount: 42,
            submittedAt: submittedAt.toISOString(),
            channel: { name: 'Creator', handle: '@creator' },
        }]);
});
