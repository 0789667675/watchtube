import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { afterEach, test } from 'node:test';
import { AuthenticatedUser, AuthRequest, createAuthenticate } from '../src/middleware/auth';
import { JWT_SECRET } from '../src/config/jwt';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const token = jwt.sign({ id: USER_ID, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
let activeServers: Server[] = [];

async function startServer(findUser: (id: string) => Promise<AuthenticatedUser | null>) {
  const app = express();
  app.use(cookieParser());
  app.get('/protected', createAuthenticate(findUser), (req: Request, res) => {
    res.status(200).json((req as AuthRequest).user);
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function getProtected(baseUrl: string) {
  return fetch(`${baseUrl}/protected`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function getProtectedWithCookie(baseUrl: string, value: string) {
  return fetch(`${baseUrl}/protected`, {
    headers: { cookie: `token=${value}` },
  });
}

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  activeServers = [];
});

test('authentication uses the current database role instead of a stale JWT role', async () => {
  let lookedUpUserId = '';
  const baseUrl = await startServer(async (id) => {
    lookedUpUserId = id;
    return { id, role: 'VIEWER', status: 'GOOD_STANDING' };
  });

  const response = await getProtected(baseUrl);
  assert.equal(response.status, 200);
  assert.equal(lookedUpUserId, USER_ID);
  assert.deepEqual(await response.json(), { id: USER_ID, role: 'VIEWER' });
});

test('authentication rejects users whose accounts are restricted or suspended', async () => {
  for (const status of ['RESTRICTED', 'SUSPENDED'] as const) {
    const baseUrl = await startServer(async (id) => ({ id, role: 'VIEWER', status }));
    const response = await getProtected(baseUrl);
    assert.equal(response.status, 403);
  }
});

test('authentication rejects tokens for users that no longer exist', async () => {
  const baseUrl = await startServer(async () => null);
  const response = await getProtected(baseUrl);
  assert.equal(response.status, 401);
});

test('authentication restores an account from the session cookie', async () => {
  const sessionToken = jwt.sign({ id: USER_ID }, JWT_SECRET, { expiresIn: '1h' });
  let lookedUpUserId = '';
  const baseUrl = await startServer(async (id) => {
    lookedUpUserId = id;
    return { id, role: 'VIEWER', status: 'GOOD_STANDING' };
  });

  const response = await getProtectedWithCookie(baseUrl, sessionToken);
  assert.equal(response.status, 200);
  assert.equal(lookedUpUserId, USER_ID);
  assert.deepEqual(await response.json(), { id: USER_ID, role: 'VIEWER' });
});

test('authentication rejects an expired session cookie', async () => {
  const expiredToken = jwt.sign({ id: USER_ID }, JWT_SECRET, { expiresIn: -1 });
  let lookedUpUser = false;
  const baseUrl = await startServer(async () => {
    lookedUpUser = true;
    return { id: USER_ID, role: 'VIEWER', status: 'GOOD_STANDING' };
  });

  const response = await getProtectedWithCookie(baseUrl, expiredToken);
  assert.equal(response.status, 401);
  assert.equal(lookedUpUser, false);
});

test('authentication reports database lookup failures instead of accepting stale claims', async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const baseUrl = await startServer(async () => {
      throw new Error('test database failure');
    });
    const response = await getProtected(baseUrl);
    assert.equal(response.status, 503);
  } finally {
    console.error = originalError;
  }
});

test('authentication explains database initialization failures without exposing details', async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const baseUrl = await startServer(async () => {
      const error = new Error('private database connection detail');
      error.name = 'PrismaClientInitializationError';
      throw error;
    });
    const response = await getProtected(baseUrl);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'Authentication is temporarily unavailable because the database is unavailable',
    });
  } finally {
    console.error = originalError;
  }
});
