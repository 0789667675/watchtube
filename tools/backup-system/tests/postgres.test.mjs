import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDatabaseUrl } from '../postgres.mjs';

test('PostgreSQL URL values are passed through environment variables, not arguments', () => {
  const parsed = parseDatabaseUrl(
    'postgresql://synthetic-user:synthetic%2Fpassword@127.0.0.1:55439/synthetic_db?sslmode=prefer',
  );
  assert.equal(parsed.host, '127.0.0.1');
  assert.equal(parsed.database, 'synthetic_db');
  assert.equal(parsed.env.PGPASSWORD, 'synthetic/password');
  assert.equal(parsed.env.PGSSLMODE, 'prefer');
});

test('remote PostgreSQL connections require full certificate and host verification', () => {
  const secure = parseDatabaseUrl(
    'postgresql://synthetic-user:synthetic-password@db.example.invalid:5432/synthetic_db',
  );
  assert.equal(secure.env.PGSSLMODE, 'verify-full');
  assert.throws(
    () => parseDatabaseUrl(
      'postgresql://synthetic-user:synthetic-password@db.example.invalid/synthetic_db?sslmode=require',
    ),
    /sslmode=verify-full/,
  );
});
