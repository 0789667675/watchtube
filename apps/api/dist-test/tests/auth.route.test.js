"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_http_1 = require("node:http");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const node_test_1 = require("node:test");
const jwt_1 = require("../src/config/jwt");
const databaseErrors_1 = require("../src/config/databaseErrors");
const auth_1 = require("../src/middleware/auth");
const auth_route_1 = require("../src/routes/auth.route");
const invitation_public_route_1 = require("../src/routes/invitation-public.route");
const servers = [];
async function startTestApp(setup) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use((0, cookie_parser_1.default)());
    setup(app);
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
});
function createPostgresPermissionError(tableName) {
    const err = new Error(`\nInvalid \`prisma.user.findUnique()\` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "42501", message: "permission denied for table ${tableName}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`);
    err.name = 'PrismaClientUnknownRequestError';
    return err;
}
(0, node_test_1.test)('extractDatabaseErrorCode and isDatabaseUnavailable detect wrapped Postgres privilege and schema errors', () => {
    const permErr = createPostgresPermissionError('AdminPosition');
    strict_1.default.equal((0, databaseErrors_1.extractDatabaseErrorCode)(permErr), '42501');
    strict_1.default.equal((0, databaseErrors_1.isDatabaseUnavailable)(permErr), true);
    const nonDbErr = new Error('Unexpected application bug');
    strict_1.default.equal((0, databaseErrors_1.extractDatabaseErrorCode)(nonDbErr), undefined);
    strict_1.default.equal((0, databaseErrors_1.isDatabaseUnavailable)(nonDbErr), false);
});
(0, node_test_1.test)('GET /api/v1/auth/me handles unauthenticated, invalid, expired, missing-user, and restricted accounts', async () => {
    const existingUserId = node_crypto_1.default.randomUUID();
    const deletedUserId = node_crypto_1.default.randomUUID();
    const restrictedUserId = node_crypto_1.default.randomUUID();
    const prismaMock = {
        user: {
            async findUnique({ where, select }) {
                if (where.id === deletedUserId)
                    return null;
                if (where.id === restrictedUserId) {
                    return { id: restrictedUserId, role: 'VIEWER', status: 'RESTRICTED', channels: [] };
                }
                if (where.id === existingUserId) {
                    return select.email
                        ? {
                            id: existingUserId,
                            email: 'viewer@watchtube.test',
                            role: 'VIEWER',
                            status: 'GOOD_STANDING',
                            channels: [],
                        }
                        : { id: existingUserId, role: 'VIEWER', status: 'GOOD_STANDING' };
                }
                return null;
            },
        },
    };
    const authMiddleware = (0, auth_1.createAuthenticate)(async (id) => prismaMock.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } }));
    const baseUrl = await startTestApp((app) => {
        app.use('/api/v1/auth', (0, auth_route_1.createAuthRouter)({ prismaClient: prismaMock, authenticateMiddleware: authMiddleware }));
    });
    // Unauthenticated
    const unauthRes = await fetch(`${baseUrl}/api/v1/auth/me`);
    strict_1.default.equal(unauthRes.status, 401);
    // Invalid / tampered token
    const invalidRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { cookie: 'token=not-a-valid-jwt' },
    });
    strict_1.default.equal(invalidRes.status, 401);
    // Expired token
    const expiredToken = jsonwebtoken_1.default.sign({ id: existingUserId }, jwt_1.JWT_SECRET, { expiresIn: -10 });
    const expiredRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { cookie: `token=${expiredToken}` },
    });
    strict_1.default.equal(expiredRes.status, 401);
    // Deleted user -> 401
    const deletedToken = jsonwebtoken_1.default.sign({ id: deletedUserId }, jwt_1.JWT_SECRET, { expiresIn: '5m' });
    const deletedRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { cookie: `token=${deletedToken}` },
    });
    strict_1.default.equal(deletedRes.status, 401);
    // Restricted user -> 403
    const restrictedToken = jsonwebtoken_1.default.sign({ id: restrictedUserId }, jwt_1.JWT_SECRET, { expiresIn: '5m' });
    const restrictedRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { cookie: `token=${restrictedToken}` },
    });
    strict_1.default.equal(restrictedRes.status, 403);
});
(0, node_test_1.test)('GET /api/v1/auth/me verifies VIEWER without querying AdminPosition and is idempotent on retry', async () => {
    const viewerId = node_crypto_1.default.randomUUID();
    const channelId = node_crypto_1.default.randomUUID();
    let adminPositionQueries = 0;
    let userWrites = 0;
    const prismaMock = {
        user: {
            async findUnique({ where, select }) {
                if (where.id !== viewerId)
                    return null;
                return {
                    id: viewerId,
                    email: 'viewer@watchtube.test',
                    role: 'VIEWER',
                    status: 'GOOD_STANDING',
                    ...(select.channels
                        ? {
                            channels: [
                                {
                                    id: channelId,
                                    name: 'Test Channel',
                                    handle: '@testchannel',
                                    description: null,
                                    avatarUrl: null,
                                    bannerUrl: null,
                                },
                            ],
                        }
                        : {}),
                };
            },
            async create() {
                userWrites += 1;
            },
            async update() {
                userWrites += 1;
            },
        },
        adminPosition: {
            async findUnique() {
                adminPositionQueries += 1;
                throw createPostgresPermissionError('AdminPosition');
            },
        },
    };
    const authMiddleware = (0, auth_1.createAuthenticate)(async (id) => prismaMock.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } }));
    const baseUrl = await startTestApp((app) => {
        app.use('/api/v1/auth', (0, auth_route_1.createAuthRouter)({ prismaClient: prismaMock, authenticateMiddleware: authMiddleware }));
    });
    const token = jsonwebtoken_1.default.sign({ id: viewerId }, jwt_1.JWT_SECRET, { expiresIn: '5m' });
    const first = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `token=${token}` } });
    const second = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `token=${token}` } });
    strict_1.default.equal(first.status, 200);
    strict_1.default.equal(second.status, 200);
    const body1 = await first.json();
    const body2 = await second.json();
    strict_1.default.deepEqual(body1, body2);
    strict_1.default.equal(body1.role, 'VIEWER');
    strict_1.default.equal(body1.channels.length, 1);
    strict_1.default.equal(body1.positionNumber, null);
    strict_1.default.deepEqual(body1.permissions, []);
    strict_1.default.equal(adminPositionQueries, 0, 'VIEWER account verification must not query AdminPosition');
    strict_1.default.equal(userWrites, 0, 'Verification retries must never mutate or create records');
});
(0, node_test_1.test)('GET /api/v1/auth/me returns adminPosition permissions when granted and reports 503 instead of unexplained 500 on 42501', async () => {
    const adminId = node_crypto_1.default.randomUUID();
    let denyAdminPosition = false;
    const prismaMock = {
        user: {
            async findUnique({ where }) {
                if (where.id !== adminId)
                    return null;
                return {
                    id: adminId,
                    email: 'admin@watchtube.test',
                    role: 'ADMIN',
                    status: 'GOOD_STANDING',
                    channels: [],
                };
            },
        },
        adminPosition: {
            async findUnique() {
                if (denyAdminPosition) {
                    throw createPostgresPermissionError('AdminPosition');
                }
                return {
                    positionNumber: 1,
                    assignment: 'Trust and Safety',
                    permissions: ['trust.review'],
                    status: 'OCCUPIED',
                };
            },
        },
    };
    const authMiddleware = (0, auth_1.createAuthenticate)(async (id) => prismaMock.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } }));
    const baseUrl = await startTestApp((app) => {
        app.use('/api/v1/auth', (0, auth_route_1.createAuthRouter)({ prismaClient: prismaMock, authenticateMiddleware: authMiddleware }));
    });
    const token = jsonwebtoken_1.default.sign({ id: adminId }, jwt_1.JWT_SECRET, { expiresIn: '5m' });
    const okRes = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `token=${token}` } });
    strict_1.default.equal(okRes.status, 200);
    const okBody = await okRes.json();
    strict_1.default.equal(okBody.positionNumber, 1);
    strict_1.default.equal(okBody.assignment, 'Trust and Safety');
    strict_1.default.deepEqual(okBody.permissions, ['trust.review']);
    const origConsoleError = console.error;
    const loggedLines = [];
    console.error = (...args) => {
        loggedLines.push(args.map(String).join(' '));
    };
    try {
        denyAdminPosition = true;
        const privErrRes = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `token=${token}` } });
        strict_1.default.equal(privErrRes.status, 503);
        strict_1.default.deepEqual(await privErrRes.json(), {
            error: 'Account details are temporarily unavailable because the database is unavailable.',
        });
        strict_1.default.ok(loggedLines.some((l) => l.includes('42501')));
        strict_1.default.ok(loggedLines.every((l) => !l.includes(token) && !l.includes('admin@watchtube.test')));
    }
    finally {
        console.error = origConsoleError;
    }
});
(0, node_test_1.test)('Public invitation verification returns 400 on invalid token and 503 on database privilege failure', async () => {
    let failDb = false;
    const router = (0, invitation_public_route_1.createInvitationPublicRouter)({
        async verifyInvitationToken(token) {
            if (failDb)
                throw createPostgresPermissionError('AdminInvitation');
            if (token === 'valid-token-12345678') {
                return {
                    valid: true,
                    invitation: {
                        id: 'inv-1',
                        email: 'partner@watchtube.test',
                        positionNumber: 2,
                        assignment: 'Operations',
                        invitedByEmail: 'owner@watchtube.test',
                        expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    },
                };
            }
            return { valid: false, error: 'Invalid or unknown invitation token.' };
        },
        async acceptInvitation() {
            if (failDb)
                throw createPostgresPermissionError('AdminInvitation');
            return { userId: 'u1', email: 'partner@watchtube.test', positionNumber: 2 };
        },
    });
    const baseUrl = await startTestApp((app) => {
        app.use('/api/v1/admin/invitations', router);
    });
    const invalidRes = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/bad-token`);
    strict_1.default.equal(invalidRes.status, 400);
    const okRes = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/valid-token-12345678`);
    strict_1.default.equal(okRes.status, 200);
    const origConsoleError = console.error;
    console.error = () => undefined;
    try {
        failDb = true;
        const dbErrVerify = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/valid-token-12345678`);
        strict_1.default.equal(dbErrVerify.status, 503);
        const dbErrAccept = await fetch(`${baseUrl}/api/v1/admin/invitations/accept`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'valid-token-12345678', password: 'strong-password-123' }),
        });
        strict_1.default.equal(dbErrAccept.status, 503);
    }
    finally {
        console.error = origConsoleError;
    }
});
