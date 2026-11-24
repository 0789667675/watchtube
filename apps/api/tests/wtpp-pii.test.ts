import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  decryptWtppPii,
  encryptWtppPii,
  isEncryptedWtppPii,
  migrateWtppPiiRecords,
  WtppPiiCiphertextError,
  WtppPiiConfigurationError,
  WtppPiiMigrationRepository,
  WtppPiiRecord,
  WtppPiiUpdate,
} from '../src/security/wtppPii';

const previousEncryptionKey = process.env.WTPP_PII_ENCRYPTION_KEY;

afterEach(() => {
  if (previousEncryptionKey === undefined) delete process.env.WTPP_PII_ENCRYPTION_KEY;
  else process.env.WTPP_PII_ENCRYPTION_KEY = previousEncryptionKey;
});

function setTestKey(value = Buffer.alloc(32, 13).toString('base64')) {
  process.env.WTPP_PII_ENCRYPTION_KEY = value;
}

test('AES-GCM encryption is randomized and authenticated to its field', () => {
  setTestKey();
  const first = encryptWtppPii('sensitive-value', 'taxId');
  const second = encryptWtppPii('sensitive-value', 'taxId');

  assert.notEqual(first, second);
  assert.equal(isEncryptedWtppPii(first), true);
  assert.equal(decryptWtppPii(first, 'taxId'), 'sensitive-value');
  assert.throws(() => decryptWtppPii(first, 'nationalIdOrPassport'), WtppPiiCiphertextError);
});

test('encryption rejects missing or malformed keys without exposing key material', () => {
  delete process.env.WTPP_PII_ENCRYPTION_KEY;
  assert.throws(
    () => encryptWtppPii('sensitive-value', 'taxId'),
    (error) => error instanceof WtppPiiConfigurationError
      && !error.message.includes('sensitive-value'),
  );

  process.env.WTPP_PII_ENCRYPTION_KEY = 'not-a-key';
  assert.throws(
    () => encryptWtppPii('sensitive-value', 'taxId'),
    WtppPiiConfigurationError,
  );
});

test('legacy WTPP migration preserves values, skips encrypted rows, and is idempotent', async () => {
  setTestKey();
  const records: WtppPiiRecord[] = [
    { id: 'legacy', taxId: 'tax-1234', nationalIdOrPassport: 'id-5678' },
    {
      id: 'already-encrypted',
      taxId: encryptWtppPii('tax-9999', 'taxId'),
      nationalIdOrPassport: null,
    },
    { id: 'empty', taxId: null, nationalIdOrPassport: null },
  ];
  const repository: WtppPiiMigrationRepository = {
    async listSensitiveFields() {
      return records.map((record) => ({ ...record }));
    },
    async updateSensitiveFields(updates: WtppPiiUpdate[]) {
      for (const update of updates) {
        const index = records.findIndex((record) => record.id === update.id);
        records[index] = { ...update };
      }
    },
  };

  const result = await migrateWtppPiiRecords(repository, true);
  assert.deepEqual(result, { scanned: 3, encrypted: 1 });
  assert.equal(records.length, 3);
  assert.equal(decryptWtppPii(records[0].taxId!, 'taxId'), 'tax-1234');
  assert.equal(
    decryptWtppPii(records[0].nationalIdOrPassport!, 'nationalIdOrPassport'),
    'id-5678',
  );
  assert.equal(decryptWtppPii(records[1].taxId!, 'taxId'), 'tax-9999');

  const repeated = await migrateWtppPiiRecords(repository, true);
  assert.deepEqual(repeated, { scanned: 3, encrypted: 0 });
});

test('legacy WTPP migration dry-run leaves records unchanged', async () => {
  setTestKey();
  const records: WtppPiiRecord[] = [
    { id: 'legacy', taxId: 'tax-1234', nationalIdOrPassport: null },
  ];
  let updateCalls = 0;
  const repository: WtppPiiMigrationRepository = {
    async listSensitiveFields() {
      return records.map((record) => ({ ...record }));
    },
    async updateSensitiveFields() {
      updateCalls += 1;
    },
  };

  assert.deepEqual(await migrateWtppPiiRecords(repository, false), {
    scanned: 1,
    encrypted: 1,
  });
  assert.equal(records[0].taxId, 'tax-1234');
  assert.equal(updateCalls, 0);
});

test('migration aborts rather than modifying ciphertext encrypted with another key', async () => {
  setTestKey();
  const ciphertext = encryptWtppPii('tax-1234', 'taxId');
  process.env.WTPP_PII_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString('base64');
  let updateCalls = 0;
  const repository: WtppPiiMigrationRepository = {
    async listSensitiveFields() {
      return [{ id: 'encrypted', taxId: ciphertext, nationalIdOrPassport: null }];
    },
    async updateSensitiveFields() {
      updateCalls += 1;
    },
  };

  await assert.rejects(migrateWtppPiiRecords(repository, true), WtppPiiCiphertextError);
  assert.equal(updateCalls, 0);
});
