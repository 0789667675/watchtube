"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRwandaMsisdn = normalizeRwandaMsisdn;
exports.detectRwandaCarrier = detectRwandaCarrier;
exports.maskMsisdn = maskMsisdn;
exports.hashMsisdn = hashMsisdn;
const node_crypto_1 = __importDefault(require("node:crypto"));
const types_1 = require("./types");
const RWANDA_LOCAL_REGEX = /^0(7[2389]\d{7})$/;
const RWANDA_INTL_REGEX = /^\+?250(7[2389]\d{7})$/;
/**
 * Validates and normalizes Rwanda Mobile Money MSISDN numbers to canonical E.164 digits without '+'.
 * Example: '0781234567' -> '250781234567'
 */
function normalizeRwandaMsisdn(rawPhone) {
    if (typeof rawPhone !== 'string') {
        throw new types_1.PaymentProviderError('Phone number must be a string.', 'INVALID_MSISDN', 400);
    }
    const cleaned = rawPhone.replace(/[\s()-]/g, '').trim();
    const localMatch = cleaned.match(RWANDA_LOCAL_REGEX);
    if (localMatch) {
        return `250${localMatch[1]}`;
    }
    const intlMatch = cleaned.match(RWANDA_INTL_REGEX);
    if (intlMatch) {
        return `250${intlMatch[1]}`;
    }
    throw new types_1.PaymentProviderError('Invalid Rwanda Mobile Money phone number. Expected 07Xxxxxxxx or +2507Xxxxxxxx.', 'INVALID_MSISDN', 400);
}
/**
 * Infers expected Rwanda mobile network operator from normalized MSISDN prefix.
 */
function detectRwandaCarrier(normalizedMsisdn) {
    if (/^2507[89]\d{7}$/.test(normalizedMsisdn))
        return 'MTN_MOMO';
    if (/^2507[23]\d{7}$/.test(normalizedMsisdn))
        return 'AIRTEL_MONEY';
    return null;
}
/**
 * Masks MSISDN for safe display/responses without exposing full subscriber numbers in logs.
 */
function maskMsisdn(normalizedMsisdn) {
    if (normalizedMsisdn.length < 7)
        return '***';
    return `${normalizedMsisdn.slice(0, 5)}****${normalizedMsisdn.slice(-3)}`;
}
/**
 * Hashes MSISDN for privacy-preserving deduplication and audit correlation.
 */
function hashMsisdn(normalizedMsisdn) {
    return node_crypto_1.default.createHash('sha256').update(normalizedMsisdn).digest('hex');
}
