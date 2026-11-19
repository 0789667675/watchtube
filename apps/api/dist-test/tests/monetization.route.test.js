"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const monetization_route_1 = require("../src/routes/monetization.route");
let activeServers = [];
async function startServer() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authenticate = (req, res, next) => {
        if (!req.get('x-test-user')) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        next();
    };
    const requireAdmin = (req, res, next) => {
        if (!req.get('x-test-admin')) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    };
    app.use('/api/v1/monetization', (0, monetization_route_1.createAdEventRouter)(authenticate), (0, monetization_route_1.createAdConfigRouter)(async () => []), (0, monetization_route_1.createRevenueReconciliationRouter)(authenticate, requireAdmin));
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
(0, node_test_1.test)('ad events require authentication and remain disabled until provider verification exists', async () => {
    const baseUrl = await startServer();
    const path = `${baseUrl}/api/v1/monetization/ad-event`;
    const body = {
        videoId: '11111111-1111-4111-8111-111111111111',
        eventType: 'AD_VIEWABLE',
        provider: 'untrusted-client',
        sessionId: 'client-session',
    };
    const unauthorized = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    strict_1.default.equal(unauthorized.status, 401);
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'test-user' },
        body: JSON.stringify(body),
    });
    strict_1.default.equal(response.status, 501);
    strict_1.default.deepEqual(await response.json(), {
        error: 'Ad event verification is not configured',
    });
});
(0, node_test_1.test)('ad config reports no ads when no provider is configured', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/v1/monetization/config`);
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), {
        enabled: false,
        providers: [],
        adSkipOffsetSeconds: 5,
    });
});
(0, node_test_1.test)('reconciliation remains admin-only and unavailable without verified allocation', async () => {
    const baseUrl = await startServer();
    const path = `${baseUrl}/api/v1/monetization/reconcile`;
    const unauthorized = await fetch(path, { method: 'POST' });
    strict_1.default.equal(unauthorized.status, 401);
    const forbidden = await fetch(path, {
        method: 'POST',
        headers: { 'x-test-user': 'test-user' },
    });
    strict_1.default.equal(forbidden.status, 403);
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'x-test-user': 'test-user', 'x-test-admin': 'test-admin' },
        body: JSON.stringify({ monthYear: '2026-10', grossProviderRevenueCents: 50000 }),
    });
    strict_1.default.equal(response.status, 501);
    strict_1.default.deepEqual(await response.json(), {
        error: 'Revenue reconciliation is unavailable until verified allocation is configured',
    });
});
