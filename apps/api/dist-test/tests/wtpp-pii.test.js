"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const wtppPii_1 = require("../src/security/wtppPii");
const previousEncryptionKey = process.env.WTPP_PII_ENCRYPTION_KEY;
(0, node_test_1.afterEach)(() => {
    if (previousEncryptionKey === undefined)
        delete process.env.WTPP_PII_ENCRYPTION_KEY;
    else
        process.env.WTPP_PII_ENCRYPTION_KEY = previousEncryptionKey;
});
function setTestKey(value = Buffer.alloc(32, 13).toString('base64')) {
    process.env.WTPP_PII_ENCRYPTION_KEY = value;
}
(0, node_test_1.test)('AES-GCM encryption is randomized and authenticated to its field', () => {
    setTestKey();
    const first = (0, wtppPii_1.encryptWtppPii)('sensitive-value', 'taxId');
    const second = (0, wtppPii_1.encryptWtppPii)('sensitive-value', 'taxId');
    strict_1.default.notEqual(first, second);
    strict_1.default.equal((0, wtppPii_1.isEncryptedWtppPii)(first), true);
    strict_1.default.equal((0, wtppPii_1.decryptWtppPii)(first, 'taxId'), 'sensitive-value');
    strict_1.default.throws(() => (0, wtppPii_1.decryptWtppPii)(first, 'nationalIdOrPassport'), wtppPii_1.WtppPiiCiphertextError);
});
(0, node_test_1.test)('encryption rejects missing or malformed keys without exposing key material', () => {
    delete process.env.WTPP_PII_ENCRYPTION_KEY;
    strict_1.default.throws(() => (0, wtppPii_1.encryptWtppPii)('sensitive-value', 'taxId'), (error) => error instanceof wtppPii_1.WtppPiiConfigurationError
        && !error.message.includes('sensitive-value'));
    process.env.WTPP_PII_ENCRYPTION_KEY = 'not-a-key';
    strict_1.default.throws(() => (0, wtppPii_1.encryptWtppPii)('sensitive-value', 'taxId'), wtppPii_1.WtppPiiConfigurationError);
});
(0, node_test_1.test)('legacy WTPP migration preserves values, skips encrypted rows, and is idempotent', async () => {
    setTestKey();
    const records = [
        { id: 'legacy', taxId: 'tax-1234', nationalIdOrPassport: 'id-5678' },
        {
            id: 'already-encrypted',
            taxId: (0, wtppPii_1.encryptWtppPii)('tax-9999', 'taxId'),
            nationalIdOrPassport: null,
        },
        { id: 'empty', taxId: null, nationalIdOrPassport: null },
    ];
    const repository = {
        async listSensitiveFields() {
            return records.map((record) => ({ ...record }));
        },
        async updateSensitiveFields(updates) {
            for (const update of updates) {
                const index = records.findIndex((record) => record.id === update.id);
                records[index] = { ...update };
            }
        },
    };
    const result = await (0, wtppPii_1.migrateWtppPiiRecords)(repository, true);
    strict_1.default.deepEqual(result, { scanned: 3, encrypted: 1 });
    strict_1.default.equal(records.length, 3);
    strict_1.default.equal((0, wtppPii_1.decryptWtppPii)(records[0].taxId, 'taxId'), 'tax-1234');
    strict_1.default.equal((0, wtppPii_1.decryptWtppPii)(records[0].nationalIdOrPassport, 'nationalIdOrPassport'), 'id-5678');
    strict_1.default.equal((0, wtppPii_1.decryptWtppPii)(records[1].taxId, 'taxId'), 'tax-9999');
    const repeated = await (0, wtppPii_1.migrateWtppPiiRecords)(repository, true);
    strict_1.default.deepEqual(repeated, { scanned: 3, encrypted: 0 });
});
(0, node_test_1.test)('legacy WTPP migration dry-run leaves records unchanged', async () => {
    setTestKey();
    const records = [
        { id: 'legacy', taxId: 'tax-1234', nationalIdOrPassport: null },
    ];
    let updateCalls = 0;
    const repository = {
        async listSensitiveFields() {
            return records.map((record) => ({ ...record }));
        },
        async updateSensitiveFields() {
            updateCalls += 1;
        },
    };
    strict_1.default.deepEqual(await (0, wtppPii_1.migrateWtppPiiRecords)(repository, false), {
        scanned: 1,
        encrypted: 1,
    });
    strict_1.default.equal(records[0].taxId, 'tax-1234');
    strict_1.default.equal(updateCalls, 0);
});
(0, node_test_1.test)('migration aborts rather than modifying ciphertext encrypted with another key', async () => {
    setTestKey();
    const ciphertext = (0, wtppPii_1.encryptWtppPii)('tax-1234', 'taxId');
    process.env.WTPP_PII_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString('base64');
    let updateCalls = 0;
    const repository = {
        async listSensitiveFields() {
            return [{ id: 'encrypted', taxId: ciphertext, nationalIdOrPassport: null }];
        },
        async updateSensitiveFields() {
            updateCalls += 1;
        },
    };
    await strict_1.default.rejects((0, wtppPii_1.migrateWtppPiiRecords)(repository, true), wtppPii_1.WtppPiiCiphertextError);
    strict_1.default.equal(updateCalls, 0);
});
