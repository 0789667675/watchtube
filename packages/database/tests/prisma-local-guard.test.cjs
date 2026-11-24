const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertLocalDatabaseUrls,
  createPrismaEnvironment,
  isLoopbackDatabaseUrl,
} = require('../scripts/prisma-local.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('accepts PostgreSQL URLs with loopback IPv4, IPv6, and localhost hosts', () => {
  assert.equal(isLoopbackDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/watchtube'), true);
  assert.equal(isLoopbackDatabaseUrl('postgres://user:pass@[::1]:5432/watchtube'), true);
  assert.equal(isLoopbackDatabaseUrl('postgresql://user:pass@localhost:5432/watchtube'), true);
});

test('rejects remote, malformed, and non-PostgreSQL database URLs', () => {
  assert.equal(isLoopbackDatabaseUrl('postgresql://user:pass@db.example/watchtube'), false);
  assert.equal(isLoopbackDatabaseUrl('mysql://user:pass@127.0.0.1/watchtube'), false);
  assert.equal(isLoopbackDatabaseUrl('not a URL'), false);
  assert.equal(isLoopbackDatabaseUrl(undefined), false);
});

test('requires both database URLs to be loopback and does not echo their values', () => {
  const remoteUrl = 'postgresql://sensitive-user:sensitive-password@db.example/watchtube';

  assert.throws(
    () => assertLocalDatabaseUrls({
      DATABASE_URL: remoteUrl,
      DATABASE_URL_UNPOOLED: 'postgresql://user:pass@127.0.0.1:5432/watchtube',
    }),
    (error) => {
      assert.match(error.message, /DATABASE_URL/);
      assert.doesNotMatch(error.message, /sensitive-user|sensitive-password|db\.example/);
      return true;
    },
  );

  assert.throws(
    () => assertLocalDatabaseUrls({
      DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/watchtube',
    }),
    /DATABASE_URL_UNPOOLED/,
  );
});

test('maps validated owner URLs to Prisma-only variables and masks generic URLs', () => {
  const localUrl = 'postgresql://owner:secret@127.0.0.1:5432/watchtube?schema=public';
  const env = createPrismaEnvironment({
    DATABASE_URL: localUrl,
    DATABASE_URL_UNPOOLED: localUrl,
    ROOT_ONLY_TOKEN: 'preserved',
  }, ['migrate', 'status']);

  assert.equal(env.WATCHTUBE_DATABASE_URL, localUrl);
  assert.equal(env.WATCHTUBE_DIRECT_URL, localUrl);
  assert.equal(env.DATABASE_URL, 'postgresql://127.0.0.1:5432/watchtube?schema=public');
  assert.equal(env.DATABASE_URL_UNPOOLED, env.DATABASE_URL);
  assert.equal(env.ROOT_ONLY_TOKEN, 'preserved');
});

test('Prisma generate uses inert loopback URLs without loading configured database targets', () => {
  const env = createPrismaEnvironment({
    DATABASE_URL: 'postgresql://owner:secret@remote.example/watchtube',
    DATABASE_URL_UNPOOLED: 'postgresql://owner:secret@remote.example/watchtube',
  }, ['generate']);

  assert.equal(env.WATCHTUBE_DATABASE_URL, 'postgresql://127.0.0.1:5432/watchtube?schema=public');
  assert.equal(env.WATCHTUBE_DIRECT_URL, env.WATCHTUBE_DATABASE_URL);
  assert.equal(env.DATABASE_URL, env.WATCHTUBE_DATABASE_URL);
  assert.doesNotMatch(JSON.stringify(env), /remote\.example|secret/);
});

test('Prisma schema cannot consume root dotenv database variable names directly', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'schema.prisma'),
    'utf8',
  );
  assert.match(schema, /url\s*=\s*env\("WATCHTUBE_DATABASE_URL"\)/);
  assert.match(schema, /directUrl\s*=\s*env\("WATCHTUBE_DIRECT_URL"\)/);
  assert.doesNotMatch(schema, /env\("DATABASE_URL(?:_UNPOOLED)?"\)/);
});
