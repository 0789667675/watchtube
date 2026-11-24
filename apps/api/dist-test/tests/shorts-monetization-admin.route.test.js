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
const shorts_monetization_admin_route_1 = require("../src/routes/shorts-monetization-admin.route");
const shortsMonetization_1 = require("../src/services/shortsMonetization");
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const RATE_PATH = '/api/v1/admin/monetization/shorts-rate';
const activeServers = [];
function createRepository(initialRate = 3_000, options = {}) {
    let setting = options.missing ? null : {
        rateBasisPoints: initialRate,
        updatedAt: new Date('2026-11-20T12:00:00.000Z'),
        updatedById: null,
    };
    const changes = [];
    const repository = {
        async findSetting() {
            if (options.unavailable)
                throw new Error('test database error');
            return setting;
        },
        async listRateChanges() {
            return [...changes].reverse();
        },
        async updateRate({ actorId, newRateBasisPoints }) {
            if (options.unavailable)
                throw new Error('test database error');
            if (options.conflict || !setting)
                return null;
            if (setting.rateBasisPoints === newRateBasisPoints)
                return { setting, change: null };
            const previousRateBasisPoints = setting.rateBasisPoints;
            const changedAt = new Date('2026-11-20T12:30:00.000Z');
            setting = {
                rateBasisPoints: newRateBasisPoints,
                updatedAt: changedAt,
                updatedById: actorId,
            };
            const change = {
                id: `audit-${changes.length + 1}`,
                actorId,
                previousRateBasisPoints,
                newRateBasisPoints,
                changedAt,
            };
            changes.push(change);
            return { setting, change };
        },
    };
    return { repository, changes };
}
async function startServer(repository, role = 'ADMIN') {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authenticate = (req, res, next) => {
        if (!role) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        req.user = { id: ADMIN_ID, role };
        next();
    };
    app.use('/api/v1/admin/monetization', authenticate, (0, shorts_monetization_admin_route_1.createShortsMonetizationAdminRouter)(admin_1.requireAdministrator, repository));
    const server = (0, node_http_1.createServer)(app);
    activeServers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    strict_1.default.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.splice(0).map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
});
(0, node_test_1.test)('Shorts rate endpoint returns the database-backed default and its audit history', async () => {
    const { repository } = createRepository();
    const baseUrl = await startServer(repository);
    const response = await fetch(`${baseUrl}${RATE_PATH}`);
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), {
        ratePercent: '30.00',
        updatedAt: '2026-11-20T12:00:00.000Z',
        updatedById: null,
        history: [],
    });
});
(0, node_test_1.test)('missing database settings fail closed instead of returning a success-shaped default', async () => {
    const { repository } = createRepository(3_000, { missing: true });
    const baseUrl = await startServer(repository);
    const response = await fetch(`${baseUrl}${RATE_PATH}`);
    strict_1.default.equal(response.status, 503);
    strict_1.default.deepEqual(await response.json(), {
        error: 'Shorts monetization settings are unavailable.',
    });
});
(0, node_test_1.test)('only administrators can read or change the Shorts rate', async () => {
    const { repository } = createRepository();
    const signedOutUrl = await startServer(repository, null);
    const signedOut = await fetch(`${signedOutUrl}${RATE_PATH}`);
    strict_1.default.equal(signedOut.status, 401);
    const moderatorUrl = await startServer(repository, 'MODERATOR');
    const moderator = await fetch(`${moderatorUrl}${RATE_PATH}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ratePercent: '25.00' }),
    });
    strict_1.default.equal(moderator.status, 403);
});
(0, node_test_1.test)('rate changes persist the actor and old/new values in the audit record', async () => {
    const { repository, changes } = createRepository();
    const baseUrl = await startServer(repository);
    const firstUpdate = await fetch(`${baseUrl}${RATE_PATH}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ratePercent: '25.00' }),
    });
    strict_1.default.equal(firstUpdate.status, 200);
    strict_1.default.deepEqual(await firstUpdate.json(), {
        ratePercent: '25.00',
        updatedAt: '2026-11-20T12:30:00.000Z',
        updatedById: ADMIN_ID,
        change: {
            id: 'audit-1',
            actorId: ADMIN_ID,
            previousRatePercent: '30.00',
            newRatePercent: '25.00',
            changedAt: '2026-11-20T12:30:00.000Z',
        },
    });
    const secondUpdate = await fetch(`${baseUrl}${RATE_PATH}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ratePercent: '50.00' }),
    });
    strict_1.default.equal(secondUpdate.status, 200);
    strict_1.default.deepEqual(changes.map(({ previousRateBasisPoints, newRateBasisPoints }) => [
        previousRateBasisPoints,
        newRateBasisPoints,
    ]), [[3_000, 2_500], [2_500, 5_000]]);
    const historyResponse = await fetch(`${baseUrl}${RATE_PATH}`);
    const history = await historyResponse.json();
    strict_1.default.equal(historyResponse.status, 200);
    strict_1.default.deepEqual(history.history.map(({ previousRatePercent, newRatePercent }) => [
        previousRatePercent,
        newRatePercent,
    ]), [['25.00', '50.00'], ['30.00', '25.00']]);
});
(0, node_test_1.test)('invalid percentages and concurrent updates are rejected without a success response', async () => {
    const { repository, changes } = createRepository();
    const baseUrl = await startServer(repository);
    for (const ratePercent of ['-1', '100.01', '30.001', 'NaN', '01.00', 30]) {
        const response = await fetch(`${baseUrl}${RATE_PATH}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ratePercent }),
        });
        strict_1.default.equal(response.status, 400, `${ratePercent} should be rejected`);
    }
    strict_1.default.equal(changes.length, 0);
    const conflictUrl = await startServer(createRepository(3_000, { conflict: true }).repository);
    const conflict = await fetch(`${conflictUrl}${RATE_PATH}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ratePercent: '50.00' }),
    });
    strict_1.default.equal(conflict.status, 409);
});
(0, node_test_1.test)('Shorts earnings apply the configured rate to eligible standard earnings with integer rounding', () => {
    strict_1.default.equal((0, shortsMonetization_1.calculateShortsCreatorEarningsRwf)(1000n, 3_000), 300n);
    strict_1.default.equal((0, shortsMonetization_1.calculateShortsCreatorEarningsRwf)(1000n, 2_500), 250n);
    strict_1.default.equal((0, shortsMonetization_1.calculateShortsCreatorEarningsRwf)(1000n, 5_000), 500n);
    strict_1.default.equal((0, shortsMonetization_1.calculateShortsCreatorEarningsRwf)(101n, 5_000), 51n);
    strict_1.default.equal((0, shortsMonetization_1.calculateShortsCreatorEarningsRwf)(-101n, 5_000), -51n);
    strict_1.default.throws(() => (0, shortsMonetization_1.calculateShortsCreatorEarningsRwf)(1000n, 10_001), RangeError);
});
