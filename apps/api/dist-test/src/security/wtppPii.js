"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WtppPiiCiphertextError = exports.WtppPiiConfigurationError = void 0;
exports.isEncryptedWtppPii = isEncryptedWtppPii;
exports.encryptWtppPii = encryptWtppPii;
exports.decryptWtppPii = decryptWtppPii;
exports.migrateWtppPiiRecords = migrateWtppPiiRecords;
const node_crypto_1 = require("node:crypto");
const ENVELOPE_PREFIX = 'wtpp:v1:';
const ASSOCIATED_DATA_PREFIX = 'watchtube:wtpp:v1:';
class WtppPiiConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WtppPiiConfigurationError';
    }
}
exports.WtppPiiConfigurationError = WtppPiiConfigurationError;
class WtppPiiCiphertextError extends Error {
    constructor() {
        super('WTPP identity ciphertext is invalid or cannot be authenticated.');
        this.name = 'WtppPiiCiphertextError';
    }
}
exports.WtppPiiCiphertextError = WtppPiiCiphertextError;
function getEncryptionKey() {
    const configured = process.env.WTPP_PII_ENCRYPTION_KEY?.trim();
    if (!configured) {
        throw new WtppPiiConfigurationError('WTPP_PII_ENCRYPTION_KEY is required to store tax and identity data.');
    }
    const key = Buffer.from(configured, 'base64');
    if (key.length !== 32 || key.toString('base64') !== configured) {
        throw new WtppPiiConfigurationError('WTPP_PII_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.');
    }
    return key;
}
function getAssociatedData(field) {
    return Buffer.from(`${ASSOCIATED_DATA_PREFIX}${field}`);
}
function isEncryptedWtppPii(value) {
    return value?.startsWith(ENVELOPE_PREFIX) ?? false;
}
function encryptWtppPii(value, field) {
    const key = getEncryptionKey();
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', key, iv);
    cipher.setAAD(getAssociatedData(field));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
        'wtpp',
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
    ].join(':');
}
function decryptWtppPii(value, field) {
    if (!isEncryptedWtppPii(value))
        throw new WtppPiiCiphertextError();
    const parts = value.split(':');
    if (parts.length !== 5 || parts[0] !== 'wtpp' || parts[1] !== 'v1') {
        throw new WtppPiiCiphertextError();
    }
    try {
        const [ivText, tagText, encryptedText] = parts.slice(2);
        const iv = Buffer.from(ivText, 'base64url');
        const tag = Buffer.from(tagText, 'base64url');
        const encrypted = Buffer.from(encryptedText, 'base64url');
        if (iv.length !== 12 || tag.length !== 16)
            throw new WtppPiiCiphertextError();
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', getEncryptionKey(), iv);
        decipher.setAAD(getAssociatedData(field));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }
    catch (error) {
        if (error instanceof WtppPiiConfigurationError)
            throw error;
        throw new WtppPiiCiphertextError();
    }
}
function protectExistingValue(value, field) {
    if (value === null)
        return null;
    if (isEncryptedWtppPii(value)) {
        decryptWtppPii(value, field);
        return value;
    }
    return encryptWtppPii(value, field);
}
async function migrateWtppPiiRecords(repository, apply) {
    const records = await repository.listSensitiveFields();
    const updates = [];
    for (const record of records) {
        const taxId = protectExistingValue(record.taxId, 'taxId');
        const nationalIdOrPassport = protectExistingValue(record.nationalIdOrPassport, 'nationalIdOrPassport');
        if (taxId !== record.taxId
            || nationalIdOrPassport !== record.nationalIdOrPassport) {
            updates.push({ id: record.id, taxId, nationalIdOrPassport });
        }
    }
    if (apply && updates.length > 0) {
        await repository.updateSensitiveFields(updates);
    }
    return { scanned: records.length, encrypted: updates.length };
}
