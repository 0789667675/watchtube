/**
 * Centralized JWT configuration and production safety validation.
 *
 * Requirements:
 * 1. Single source of truth for token signing and verification across the API.
 * 2. In production (NODE_ENV=production), startup MUST fail if JWT_SECRET is
 *    absent, blank, insecure, or shorter than 32 characters.
 * 3. In development / testing, a fallback default is permitted with a clear warning.
 * 4. Never echo or expose secrets in log output or error messages.
 */

const isProduction = process.env.NODE_ENV === 'production';
const rawSecret = process.env.JWT_SECRET?.trim();

const INSECURE_FALLBACKS = [
  'supersecret',
  'secret',
  'changeme',
  'password',
  '12345678',
  'default',
  'admin',
  'test',
  'jwtsecret',
];

export function resolveJwtSecret(): string {
  if (isProduction) {
    if (!rawSecret) {
      throw new Error(
        '[FATAL] Production startup rejected: JWT_SECRET environment variable is missing or empty. A secure secret of at least 32 characters is required.'
      );
    }
    if (INSECURE_FALLBACKS.includes(rawSecret.toLowerCase()) || rawSecret.length < 32) {
      throw new Error(
        '[FATAL] Production startup rejected: JWT_SECRET must be at least 32 characters and cannot use a known default or insecure fallback.'
      );
    }
    return rawSecret;
  }

  // Development and test fallback
  if (!rawSecret) {
    console.warn(
      '[SECURITY WARNING] JWT_SECRET is not configured. Falling back to development default. Never use this in production.'
    );
    return 'supersecret';
  }

  return rawSecret;
}

export const JWT_SECRET = resolveJwtSecret();
