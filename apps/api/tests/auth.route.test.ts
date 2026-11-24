import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, test } from 'node:test';
import { JWT_SECRET } from '../src/config/jwt';
import { extractDatabaseErrorCode, isDatabaseUnavailable } from '../src/config/databaseErrors';
import { createAuthenticate } from '../src/middleware/auth';
import { createAuthRouter } from '../src/routes/auth.route';
import { createInvitationPublicRouter } from '../src/routes/invitation-public.route';

const servers: Server[] = [];

async function startTestApp(setup: (app: express.Express) => void): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  setup(app);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

function createPostgresPermissionError(tableName: string): Error {
  const err = new Error(
    `\nInvalid \`prisma.user.findUnique()\` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "42501", message: "permission denied for table ${tableName}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
  );
  err.name = 'PrismaClientUnknownRequestError';
  return err;
}

test('extractDatabaseErrorCode and isDatabaseUnavailable detect wrapped Postgres privilege and schema errors', () => {
  const permErr = createPostgresPermissionError('AdminPosition');
  assert.equal(extractDatabaseErrorCode(permErr), '42501');
  assert.equal(isDatabaseUnavailable(permErr), true);

  const nonDbErr = new Error('Unexpected application bug');
  assert.equal(extractDatabaseErrorCode(nonDbErr), undefined);
  assert.equal(isDatabaseUnavailable(nonDbErr), false);
});

test('GET /api/v1/auth/me handles unauthenticated, invalid, expired, missing-user, and restricted accounts', async () => {
  const existingUserId = crypto.randomUUID();
  const deletedUserId = crypto.randomUUID();
  const restrictedUserId = crypto.randomUUID();

  const prismaMock = {
    user: {
      async findUnique({ where, select }: any) {
        if (where.id === deletedUserId) return null;
        if (where.id === restrictedUserId) {
          return { id: restrictedUserId, role: 'VIEWER', status: 'RESTRICTED' as const, channels: [] };
        }
        if (where.id === existingUserId) {
          return select.email
            ? {
                id: existingUserId,
                email: 'viewer@watchtube.test',
                role: 'VIEWER',
                status: 'GOOD_STANDING' as const,
                channels: [],
              }
            : { id: existingUserId, role: 'VIEWER', status: 'GOOD_STANDING' as const };
        }
        return null;
      },
    },
  };

  const authMiddleware = createAuthenticate(async (id) =>
    prismaMock.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } }),
  );

  const baseUrl = await startTestApp((app) => {
    app.use('/api/v1/auth', createAuthRouter({ prismaClient: prismaMock, authenticateMiddleware: authMiddleware }));
  });

  // Unauthenticated
  const unauthRes = await fetch(`${baseUrl}/api/v1/auth/me`);
  assert.equal(unauthRes.status, 401);

  // Invalid / tampered token
  const invalidRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { cookie: 'token=not-a-valid-jwt' },
  });
  assert.equal(invalidRes.status, 401);

  // Expired token
  const expiredToken = jwt.sign({ id: existingUserId }, JWT_SECRET, { expiresIn: -10 });
  const expiredRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { cookie: `token=${expiredToken}` },
  });
  assert.equal(expiredRes.status, 401);

  // Deleted user -> 401
  const deletedToken = jwt.sign({ id: deletedUserId }, JWT_SECRET, { expiresIn: '5m' });
  const deletedRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { cookie: `token=${deletedToken}` },
  });
  assert.equal(deletedRes.status, 401);

  // Restricted user -> 403
  const restrictedToken = jwt.sign({ id: restrictedUserId }, JWT_SECRET, { expiresIn: '5m' });
  const restrictedRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { cookie: `token=${restrictedToken}` },
  });
  assert.equal(restrictedRes.status, 403);
});

test('GET /api/v1/auth/me verifies VIEWER without querying AdminPosition and is idempotent on retry', async () => {
  const viewerId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  let adminPositionQueries = 0;
  let userWrites = 0;

  const prismaMock = {
    user: {
      async findUnique({ where, select }: any) {
        if (where.id !== viewerId) return null;
        return {
          id: viewerId,
          email: 'viewer@watchtube.test',
          role: 'VIEWER',
          status: 'GOOD_STANDING' as const,
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

  const authMiddleware = createAuthenticate(async (id) =>
    prismaMock.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } }),
  );
  const baseUrl = await startTestApp((app) => {
    app.use('/api/v1/auth', createAuthRouter({ prismaClient: prismaMock, authenticateMiddleware: authMiddleware }));
  });

  const token = jwt.sign({ id: viewerId }, JWT_SECRET, { expiresIn: '5m' });
  const first = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `token=${token}` } });
  const second = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `token=${token}` } });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const body1: any = await first.json();
  const body2: any = await second.json();
  assert.deepEqual(body1, body2);
  assert.equal(body1.role, 'VIEWER');
  assert.equal(body1.channels.length, 1);
  assert.equal(body1.positionNumber, null);
  assert.deepEqual(body1.permissions, []);
  assert.equal(adminPositionQueries, 0, 'VIEWER account verification must not query AdminPosition');
  assert.equal(userWrites, 0, 'Verification retries must never mutate or create records');
});

test('GET /api/v1/auth/me returns adminPosition permissions when granted and reports 503 instead of unexplained 500 on 42501', async () => {
  const adminId = crypto.randomUUID();
  let denyAdminPosition = false;

  const prismaMock = {
    user: {
      async findUnique({ where }: any) {
        if (where.id !== adminId) return null;
        return {
          id: adminId,
          email: 'admin@watchtube.test',
          role: 'ADMIN',
          status: 'GOOD_STANDING' as const,
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

  const authMiddleware = createAuthenticate(async (id) =>
    prismaMock.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } }),
  );
  const baseUrl = await startTestApp((app) => {
    app.use('/api/v1/auth', createAuthRouter({ prismaClient: prismaMock, authenticateMiddleware: authMiddleware }));
  });

  const token = jwt.sign({ id: adminId }, JWT_SECRET, { expiresIn: '5m' });

  const okRes = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `token=${token}` } });
  assert.equal(okRes.status, 200);
  const okBody: any = await okRes.json();
  assert.equal(okBody.positionNumber, 1);
  assert.equal(okBody.assignment, 'Trust and Safety');
  assert.deepEqual(okBody.permissions, ['trust.review']);

  const origConsoleError = console.error;
  const loggedLines: string[] = [];
  console.error = (...args: unknown[]) => {
    loggedLines.push(args.map(String).join(' '));
  };
  try {
    denyAdminPosition = true;
    const privErrRes = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `token=${token}` } });
    assert.equal(privErrRes.status, 503);
    assert.deepEqual(await privErrRes.json(), {
      error: 'Account details are temporarily unavailable because the database is unavailable.',
    });
    assert.ok(loggedLines.some((l) => l.includes('42501')));
    assert.ok(loggedLines.every((l) => !l.includes(token) && !l.includes('admin@watchtube.test')));
  } finally {
    console.error = origConsoleError;
  }
});

test('Public invitation verification returns 400 on invalid token and 503 on database privilege failure', async () => {
  let failDb = false;
  const router = createInvitationPublicRouter({
    async verifyInvitationToken(token) {
      if (failDb) throw createPostgresPermissionError('AdminInvitation');
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
      if (failDb) throw createPostgresPermissionError('AdminInvitation');
      return { userId: 'u1', email: 'partner@watchtube.test', positionNumber: 2 };
    },
  });

  const baseUrl = await startTestApp((app) => {
    app.use('/api/v1/admin/invitations', router);
  });

  const invalidRes = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/bad-token`);
  assert.equal(invalidRes.status, 400);

  const okRes = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/valid-token-12345678`);
  assert.equal(okRes.status, 200);

  const origConsoleError = console.error;
  console.error = () => undefined;
  try {
    failDb = true;
    const dbErrVerify = await fetch(`${baseUrl}/api/v1/admin/invitations/verify/valid-token-12345678`);
    assert.equal(dbErrVerify.status, 503);

    const dbErrAccept = await fetch(`${baseUrl}/api/v1/admin/invitations/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'valid-token-12345678', password: 'strong-password-123' }),
    });
    assert.equal(dbErrAccept.status, 503);
  } finally {
    console.error = origConsoleError;
  }
});
