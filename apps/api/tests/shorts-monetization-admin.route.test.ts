import assert from 'node:assert/strict';
import express, { RequestHandler } from 'express';
import { createServer, Server } from 'node:http';
import { afterEach, test } from 'node:test';
import { AuthRequest } from '../src/middleware/auth';
import { requireAdministrator } from '../src/middleware/admin';
import {
  createShortsMonetizationAdminRouter,
  ShortsMonetizationAdminRepository,
  ShortsMonetizationRateChangeRecord,
  ShortsMonetizationSettingRecord,
} from '../src/routes/shorts-monetization-admin.route';
import { calculateShortsCreatorEarningsRwf } from '../src/services/shortsMonetization';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const RATE_PATH = '/api/v1/admin/monetization/shorts-rate';
const activeServers: Server[] = [];

function createRepository(
  initialRate = 3_000,
  options: { unavailable?: boolean; conflict?: boolean; missing?: boolean } = {},
) {
  let setting: ShortsMonetizationSettingRecord | null = options.missing ? null : {
    rateBasisPoints: initialRate,
    updatedAt: new Date('2026-11-20T12:00:00.000Z'),
    updatedById: null,
  };
  const changes: ShortsMonetizationRateChangeRecord[] = [];

  const repository: ShortsMonetizationAdminRepository = {
    async findSetting() {
      if (options.unavailable) throw new Error('test database error');
      return setting;
    },
    async listRateChanges() {
      return [...changes].reverse();
    },
    async updateRate({ actorId, newRateBasisPoints }) {
      if (options.unavailable) throw new Error('test database error');
      if (options.conflict || !setting) return null;
      if (setting.rateBasisPoints === newRateBasisPoints) return { setting, change: null };

      const previousRateBasisPoints = setting.rateBasisPoints;
      const changedAt = new Date('2026-11-20T12:30:00.000Z');
      setting = {
        rateBasisPoints: newRateBasisPoints,
        updatedAt: changedAt,
        updatedById: actorId,
      };
      const change: ShortsMonetizationRateChangeRecord = {
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

async function startServer(
  repository: ShortsMonetizationAdminRepository,
  role: 'ADMIN' | 'MODERATOR' | 'VIEWER' | null = 'ADMIN',
): Promise<string> {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, res, next) => {
    if (!role) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as AuthRequest).user = { id: ADMIN_ID, role };
    next();
  };
  app.use(
    '/api/v1/admin/monetization',
    authenticate,
    createShortsMonetizationAdminRouter(requireAdministrator, repository),
  );

  const server = createServer(app);
  activeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map(
    (server) => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  ));
});

test('Shorts rate endpoint returns the database-backed default and its audit history', async () => {
  const { repository } = createRepository();
  const baseUrl = await startServer(repository);

  const response = await fetch(`${baseUrl}${RATE_PATH}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ratePercent: '30.00',
    updatedAt: '2026-11-20T12:00:00.000Z',
    updatedById: null,
    history: [],
  });
});

test('missing database settings fail closed instead of returning a success-shaped default', async () => {
  const { repository } = createRepository(3_000, { missing: true });
  const baseUrl = await startServer(repository);

  const response = await fetch(`${baseUrl}${RATE_PATH}`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Shorts monetization settings are unavailable.',
  });
});

test('only administrators can read or change the Shorts rate', async () => {
  const { repository } = createRepository();
  const signedOutUrl = await startServer(repository, null);
  const signedOut = await fetch(`${signedOutUrl}${RATE_PATH}`);
  assert.equal(signedOut.status, 401);

  const moderatorUrl = await startServer(repository, 'MODERATOR');
  const moderator = await fetch(`${moderatorUrl}${RATE_PATH}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ratePercent: '25.00' }),
  });
  assert.equal(moderator.status, 403);
});

test('rate changes persist the actor and old/new values in the audit record', async () => {
  const { repository, changes } = createRepository();
  const baseUrl = await startServer(repository);

  const firstUpdate = await fetch(`${baseUrl}${RATE_PATH}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ratePercent: '25.00' }),
  });

  assert.equal(firstUpdate.status, 200);
  assert.deepEqual(await firstUpdate.json(), {
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
  assert.equal(secondUpdate.status, 200);
  assert.deepEqual(changes.map(({ previousRateBasisPoints, newRateBasisPoints }) => [
    previousRateBasisPoints,
    newRateBasisPoints,
  ]), [[3_000, 2_500], [2_500, 5_000]]);

  const historyResponse = await fetch(`${baseUrl}${RATE_PATH}`);
  const history = await historyResponse.json() as { history: Array<{ previousRatePercent: string; newRatePercent: string }> };
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(history.history.map(({ previousRatePercent, newRatePercent }) => [
    previousRatePercent,
    newRatePercent,
  ]), [['25.00', '50.00'], ['30.00', '25.00']]);
});

test('invalid percentages and concurrent updates are rejected without a success response', async () => {
  const { repository, changes } = createRepository();
  const baseUrl = await startServer(repository);

  for (const ratePercent of ['-1', '100.01', '30.001', 'NaN', '01.00', 30]) {
    const response = await fetch(`${baseUrl}${RATE_PATH}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ratePercent }),
    });
    assert.equal(response.status, 400, `${ratePercent} should be rejected`);
  }
  assert.equal(changes.length, 0);

  const conflictUrl = await startServer(createRepository(3_000, { conflict: true }).repository);
  const conflict = await fetch(`${conflictUrl}${RATE_PATH}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ratePercent: '50.00' }),
  });
  assert.equal(conflict.status, 409);
});

test('Shorts earnings apply the configured rate to eligible standard earnings with integer rounding', () => {
  assert.equal(calculateShortsCreatorEarningsRwf(1_000n, 3_000), 300n);
  assert.equal(calculateShortsCreatorEarningsRwf(1_000n, 2_500), 250n);
  assert.equal(calculateShortsCreatorEarningsRwf(1_000n, 5_000), 500n);
  assert.equal(calculateShortsCreatorEarningsRwf(101n, 5_000), 51n);
  assert.equal(calculateShortsCreatorEarningsRwf(-101n, 5_000), -51n);
  assert.throws(() => calculateShortsCreatorEarningsRwf(1_000n, 10_001), RangeError);
});
