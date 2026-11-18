import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSafeServiceEndpoints } from '../src/config/serviceEndpointSafety';

const localOptions = {
  databaseUrl: 'postgresql://test:test@127.0.0.1:5432/watchtube',
  redisUrl: 'redis://localhost:6379',
  localOnly: true,
};

test('local-only mode accepts loopback PostgreSQL and Redis endpoints', () => {
  assert.doesNotThrow(() => assertSafeServiceEndpoints(localOptions));
});

test('local-only mode rejects external PostgreSQL before a connection is attempted', () => {
  assert.throws(
    () => assertSafeServiceEndpoints({
      ...localOptions,
      databaseUrl: 'postgresql://test:secret@db.example.invalid:5432/watchtube',
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DATABASE_URL.*loopback/);
      assert.doesNotMatch(error.message, /secret|db\.example/);
      return true;
    },
  );
});

test('local-only mode rejects external Redis endpoints and hosts', () => {
  assert.throws(
    () => assertSafeServiceEndpoints({ ...localOptions, redisUrl: 'rediss://cache.example.invalid:6379' }),
    /Redis.*loopback/,
  );
  assert.throws(
    () => assertSafeServiceEndpoints({ ...localOptions, redisUrl: undefined, redisHost: 'cache.example.invalid' }),
    /Redis.*loopback/,
  );
});

test('external opt-in works for ordinary development but cannot bypass local-only mode', () => {
  assert.doesNotThrow(() => assertSafeServiceEndpoints({
    databaseUrl: 'postgresql://test:test@db.example.invalid:5432/watchtube',
    redisUrl: 'redis://cache.example.invalid:6379',
    allowExternal: true,
  }));
  assert.throws(
    () => assertSafeServiceEndpoints({
      ...localOptions,
      databaseUrl: 'postgresql://test:test@db.example.invalid:5432/watchtube',
      allowExternal: true,
    }),
    /DATABASE_URL.*loopback/,
  );
});

test('production startup is not subject to development endpoint restrictions', () => {
  assert.doesNotThrow(() => assertSafeServiceEndpoints({
    databaseUrl: 'postgresql://test:test@db.example.invalid:5432/watchtube',
    redisUrl: 'rediss://cache.example.invalid:6379',
    nodeEnv: 'production',
  }));
});
