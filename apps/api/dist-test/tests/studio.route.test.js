"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const studio_route_1 = require("../src/routes/studio.route");
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
let activeServers = [];
async function startServer(repository) {
    const app = (0, express_1.default)();
    const authenticate = (req, res, next) => {
        const userId = req.get('x-test-user');
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        req.user = { id: userId, role: 'CREATOR' };
        next();
    };
    app.use('/studio', (0, studio_route_1.createStudioRouter)(authenticate, repository));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
function createRepository() {
    let requestedPeriod = null;
    const repository = {
        async findOwnedChannel(userId, channelId) {
            return userId === USER_ID && (!channelId || channelId === CHANNEL_ID)
                ? { id: CHANNEL_ID, subscriberCount: 3 }
                : null;
        },
        async getAnalytics(_channelId, period) {
            requestedPeriod = period;
            return {
                totalViews: 2,
                totalWatchHours: 0.5,
                recentPerformance: [{
                        id: '33333333-3333-4333-8333-333333333333',
                        title: 'Recorded video',
                        views: 2,
                        watchHours: 0.5,
                        _count: { likes: 1, comments: 0 },
                    }],
            };
        },
    };
    return { repository, getRequestedPeriod: () => requestedPeriod };
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
    activeServers = [];
});
(0, node_test_1.test)('Studio analytics scope events to an owned channel and the requested dates', async () => {
    const state = createRepository();
    const baseUrl = await startServer(state.repository);
    const response = await fetch(`${baseUrl}/studio/analytics?channelId=${CHANNEL_ID}&from=2026-03-01&to=2026-03-31`, { headers: { 'x-test-user': USER_ID } });
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), {
        period: { from: '2026-03-01', to: '2026-03-31' },
        subscriberCount: 3,
        totalViews: 2,
        totalWatchHours: 0.5,
        recentPerformance: [{
                id: '33333333-3333-4333-8333-333333333333',
                title: 'Recorded video',
                views: 2,
                watchHours: 0.5,
                _count: { likes: 1, comments: 0 },
            }],
    });
    strict_1.default.equal(state.getRequestedPeriod()?.from.toISOString(), '2026-03-01T00:00:00.000Z');
    strict_1.default.equal(state.getRequestedPeriod()?.toExclusive.toISOString(), '2026-04-01T00:00:00.000Z');
});
(0, node_test_1.test)('Studio analytics reject invalid ranges, unauthorized users, and channels they do not own', async () => {
    const state = createRepository();
    const baseUrl = await startServer(state.repository);
    const invalidRange = await fetch(`${baseUrl}/studio/analytics?channelId=${CHANNEL_ID}&from=2026-04-01&to=2026-03-01`, { headers: { 'x-test-user': USER_ID } });
    strict_1.default.equal(invalidRange.status, 400);
    const unauthorized = await fetch(`${baseUrl}/studio/analytics?from=2026-03-01&to=2026-03-31`);
    strict_1.default.equal(unauthorized.status, 401);
    const otherChannel = await fetch(`${baseUrl}/studio/analytics?channelId=44444444-4444-4444-8444-444444444444&from=2026-03-01&to=2026-03-31`, { headers: { 'x-test-user': USER_ID } });
    strict_1.default.equal(otherChannel.status, 404);
});
