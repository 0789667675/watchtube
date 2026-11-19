"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const wallet_route_1 = require("../src/routes/wallet.route");
let activeServers = [];
async function startServer() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authenticate = (req, res, next) => {
        if (!req.get('x-test-user'))
            return res.status(401).json({ error: 'Unauthorized' });
        next();
    };
    app.use('/wallet/request-payout', (0, wallet_route_1.createPayoutRouter)(authenticate));
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
(0, node_test_1.test)('payout requests are authenticated and unavailable without writing a payout record', async () => {
    const baseUrl = await startServer();
    const path = `${baseUrl}/wallet/request-payout`;
    const unauthorized = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountCents: 50000, provider: 'MTN_MOMO', phoneNumber: '0781234567' }),
    });
    strict_1.default.equal(unauthorized.status, 401);
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'test-user' },
        body: JSON.stringify({ amountCents: 50000, provider: 'MTN_MOMO', phoneNumber: '0781234567' }),
    });
    strict_1.default.equal(response.status, 501);
    strict_1.default.deepEqual(await response.json(), {
        error: 'Payouts are unavailable until a verified payment-provider integration is configured.',
    });
});
