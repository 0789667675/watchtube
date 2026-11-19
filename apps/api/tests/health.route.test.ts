import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import express from 'express';
import { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';
import { createHealthRouter, HealthRouterDependencies } from '../src/routes/health.route';

const servers: Server[] = [];

async function requestHealth(dependencies: HealthRouterDependencies, path: string): Promise<Response> {
  const app = express();
  app.use(createHealthRouter(dependencies));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

test('liveness remains healthy without probing unavailable dependencies', async () => {
  let databaseChecks = 0;
  const response = await requestHealth({
    databaseConfigured: false,
    async checkDatabase() { databaseChecks += 1; },
    getRedisStatus: () => 'unavailable',
    getStorageStatus: () => ({ status: 'unconfigured', missing: ['R2_ACCESS_KEY_ID'] }),
  }, '/health');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(databaseChecks, 0);
});

test('readiness returns a sanitized 503 when the local database is not configured', async () => {
  const response = await requestHealth({
    databaseConfigured: false,
    async checkDatabase() { throw new Error('must not run'); },
    getRedisStatus: () => 'unavailable',
    getStorageStatus: () => ({ status: 'unconfigured', missing: ['R2_SECRET_ACCESS_KEY'] }),
  }, '/ready');

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: 'degraded',
    services: {
      database: 'unconfigured',
      redis: 'unavailable',
      storage: { status: 'unconfigured', missing: ['R2_SECRET_ACCESS_KEY'] },
    },
  });
});

test('database readiness keeps basic API ready when optional Redis and storage are unavailable', async () => {
  const response = await requestHealth({
    databaseConfigured: true,
    async checkDatabase() {},
    getRedisStatus: () => 'unavailable',
    getStorageStatus: () => ({ status: 'partial', missing: ['R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL'] }),
  }, '/ready');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'degraded',
    services: {
      database: 'connected',
      redis: 'unavailable',
      storage: { status: 'partial', missing: ['R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL'] },
    },
  });
});
