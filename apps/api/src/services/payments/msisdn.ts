import crypto from 'node:crypto';
import { MobileMoneyProviderId, PaymentProviderError } from './types';

const RWANDA_LOCAL_REGEX = /^0(7[2389]\d{7})$/;
const RWANDA_INTL_REGEX = /^\+?250(7[2389]\d{7})$/;

/**
 * Validates and normalizes Rwanda Mobile Money MSISDN numbers to canonical E.164 digits without '+'.
 * Example: '0781234567' -> '250781234567'
 */
export function normalizeRwandaMsisdn(rawPhone: string): string {
  if (typeof rawPhone !== 'string') {
    throw new PaymentProviderError('Phone number must be a string.', 'INVALID_MSISDN', 400);
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

  throw new PaymentProviderError(
    'Invalid Rwanda Mobile Money phone number. Expected 07Xxxxxxxx or +2507Xxxxxxxx.',
    'INVALID_MSISDN',
    400
  );
}

/**
 * Infers expected Rwanda mobile network operator from normalized MSISDN prefix.
 */
export function detectRwandaCarrier(normalizedMsisdn: string): MobileMoneyProviderId | null {
  if (/^2507[89]\d{7}$/.test(normalizedMsisdn)) return 'MTN_MOMO';
  if (/^2507[23]\d{7}$/.test(normalizedMsisdn)) return 'AIRTEL_MONEY';
  return null;
}

/**
 * Masks MSISDN for safe display/responses without exposing full subscriber numbers in logs.
 */
export function maskMsisdn(normalizedMsisdn: string): string {
  if (normalizedMsisdn.length < 7) return '***';
  return `${normalizedMsisdn.slice(0, 5)}****${normalizedMsisdn.slice(-3)}`;
}

/**
 * Hashes MSISDN for privacy-preserving deduplication and audit correlation.
 */
export function hashMsisdn(normalizedMsisdn: string): string {
  return crypto.createHash('sha256').update(normalizedMsisdn).digest('hex');
}
