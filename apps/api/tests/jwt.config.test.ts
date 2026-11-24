import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveJwtSecret } from '../src/config/jwt';

test('production rejects the documented JWT secret placeholder', () => {
  assert.throws(
    () => resolveJwtSecret({
      nodeEnv: 'production',
      secret: 'replace_with_a_secure_random_jwt_secret_at_least_32_characters',
    }),
    /cannot use a known default, placeholder, or insecure fallback/,
  );
});

test('non-local runtimes fail closed when no JWT secret is configured', () => {
  for (const nodeEnv of ['staging', undefined]) {
    assert.throws(
      () => resolveJwtSecret({ nodeEnv, secret: '' }),
      /JWT_SECRET is required outside explicit development or test mode/,
    );
  }
  assert.throws(
    () => resolveJwtSecret({ nodeEnv: 'production', secret: '' }),
    /Production startup rejected: JWT_SECRET environment variable is missing or empty/,
  );
});

test('only explicit development and test modes may use the fallback secret', () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(resolveJwtSecret({ nodeEnv: 'development', secret: '' }), 'supersecret');
    assert.equal(resolveJwtSecret({ nodeEnv: 'test', secret: '' }), 'supersecret');
  } finally {
    console.warn = originalWarn;
  }
});

test('non-local runtimes accept a configured non-placeholder secret', () => {
  const secret = 'a-valid-test-only-jwt-secret-long-enough-123';
  assert.equal(resolveJwtSecret({ nodeEnv: 'production', secret }), secret);
  assert.equal(resolveJwtSecret({ nodeEnv: 'staging', secret }), secret);
});
