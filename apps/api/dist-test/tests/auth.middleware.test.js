"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const node_test_1 = require("node:test");
const auth_1 = require("../src/middleware/auth");
const jwt_1 = require("../src/config/jwt");
const USER_ID = '11111111-1111-4111-8111-111111111111';
const token = jsonwebtoken_1.default.sign({ id: USER_ID, role: 'ADMIN' }, jwt_1.JWT_SECRET, { expiresIn: '1h' });
let activeServers = [];
async function startServer(findUser) {
    const app = (0, express_1.default)();
    app.get('/protected', (0, auth_1.createAuthenticate)(findUser), (req, res) => {
        res.status(200).json(req.user);
    });
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
async function getProtected(baseUrl) {
    return fetch(`${baseUrl}/protected`, {
        headers: { authorization: `Bearer ${token}` },
    });
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
    activeServers = [];
});
(0, node_test_1.test)('authentication uses the current database role instead of a stale JWT role', async () => {
    let lookedUpUserId = '';
    const baseUrl = await startServer(async (id) => {
        lookedUpUserId = id;
        return { id, role: 'VIEWER', status: 'GOOD_STANDING' };
    });
    const response = await getProtected(baseUrl);
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(lookedUpUserId, USER_ID);
    strict_1.default.deepEqual(await response.json(), { id: USER_ID, role: 'VIEWER' });
});
(0, node_test_1.test)('authentication rejects users whose accounts are restricted or suspended', async () => {
    for (const status of ['RESTRICTED', 'SUSPENDED']) {
        const baseUrl = await startServer(async (id) => ({ id, role: 'VIEWER', status }));
        const response = await getProtected(baseUrl);
        strict_1.default.equal(response.status, 403);
    }
});
(0, node_test_1.test)('authentication rejects tokens for users that no longer exist', async () => {
    const baseUrl = await startServer(async () => null);
    const response = await getProtected(baseUrl);
    strict_1.default.equal(response.status, 401);
});
(0, node_test_1.test)('authentication reports database lookup failures instead of accepting stale claims', async () => {
    const originalError = console.error;
    console.error = () => undefined;
    try {
        const baseUrl = await startServer(async () => {
            throw new Error('test database failure');
        });
        const response = await getProtected(baseUrl);
        strict_1.default.equal(response.status, 503);
    }
    finally {
        console.error = originalError;
    }
});
(0, node_test_1.test)('authentication explains database initialization failures without exposing details', async () => {
    const originalError = console.error;
    console.error = () => undefined;
    try {
        const baseUrl = await startServer(async () => {
            const error = new Error('private database connection detail');
            error.name = 'PrismaClientInitializationError';
            throw error;
        });
        const response = await getProtected(baseUrl);
        strict_1.default.equal(response.status, 503);
        strict_1.default.deepEqual(await response.json(), {
            error: 'Authentication is temporarily unavailable because the database is unavailable',
        });
    }
    finally {
        console.error = originalError;
    }
});
