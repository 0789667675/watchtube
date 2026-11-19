"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const health_route_1 = require("../src/routes/health.route");
const servers = [];
async function requestHealth(dependencies, path) {
    const app = (0, express_1.default)();
    app.use((0, health_route_1.createHealthRouter)(dependencies));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    return fetch(`http://127.0.0.1:${address.port}${path}`);
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
});
(0, node_test_1.test)('liveness remains healthy without probing unavailable dependencies', async () => {
    let databaseChecks = 0;
    const response = await requestHealth({
        databaseConfigured: false,
        async checkDatabase() { databaseChecks += 1; },
        getRedisStatus: () => 'unavailable',
        getStorageStatus: () => ({ status: 'unconfigured', missing: ['R2_ACCESS_KEY_ID'] }),
    }, '/health');
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), { status: 'ok' });
    strict_1.default.equal(databaseChecks, 0);
});
(0, node_test_1.test)('readiness returns a sanitized 503 when the local database is not configured', async () => {
    const response = await requestHealth({
        databaseConfigured: false,
        async checkDatabase() { throw new Error('must not run'); },
        getRedisStatus: () => 'unavailable',
        getStorageStatus: () => ({ status: 'unconfigured', missing: ['R2_SECRET_ACCESS_KEY'] }),
    }, '/ready');
    strict_1.default.equal(response.status, 503);
    strict_1.default.deepEqual(await response.json(), {
        status: 'degraded',
        services: {
            database: 'unconfigured',
            redis: 'unavailable',
            storage: { status: 'unconfigured', missing: ['R2_SECRET_ACCESS_KEY'] },
        },
    });
});
(0, node_test_1.test)('database readiness keeps basic API ready when optional Redis and storage are unavailable', async () => {
    const response = await requestHealth({
        databaseConfigured: true,
        async checkDatabase() { },
        getRedisStatus: () => 'unavailable',
        getStorageStatus: () => ({ status: 'partial', missing: ['R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL'] }),
    }, '/ready');
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), {
        status: 'degraded',
        services: {
            database: 'connected',
            redis: 'unavailable',
            storage: { status: 'partial', missing: ['R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL'] },
        },
    });
});
