/**
 * Centralized JWT configuration and production safety validation.
 *
 * Requirements:
 * 1. Single source of truth for token signing and verification across the API.
 * 2. Outside explicit development/test mode, startup MUST fail if JWT_SECRET is
 *    absent, blank, insecure, a placeholder, or shorter than 32 characters.
 * 3. Only development and testing may use the fallback, with a clear warning.
 * 4. Never echo or expose secrets in log output or error messages.
 */

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

const PLACEHOLDER_PREFIXES = ['replace_with_', 'your_', 'example_', 'placeholder_'];

export interface JwtSecretOptions {
  nodeEnv?: string;
  secret?: string;
}

export function resolveJwtSecret(options: JwtSecretOptions = {}): string {
  const nodeEnv = Object.prototype.hasOwnProperty.call(options, 'nodeEnv')
    ? options.nodeEnv
    : process.env.NODE_ENV;
  const rawSecret = (options.secret ?? process.env.JWT_SECRET)?.trim();
  const allowsFallback = nodeEnv === 'development' || nodeEnv === 'test';

  if (!rawSecret) {
    if (allowsFallback) {
      console.warn(
        '[SECURITY WARNING] JWT_SECRET is not configured. Falling back to development default. Never use this in production.'
      );
      return 'supersecret';
    }

    if (nodeEnv === 'production') {
      throw new Error(
        '[FATAL] Production startup rejected: JWT_SECRET environment variable is missing or empty. A secure secret of at least 32 characters is required.'
      );
    }
    throw new Error(
      '[FATAL] Startup rejected: JWT_SECRET is required outside explicit development or test mode.'
    );
  }

  const normalizedSecret = rawSecret.toLowerCase();
  const isPlaceholder = PLACEHOLDER_PREFIXES.some((prefix) => normalizedSecret.startsWith(prefix));
  if (!allowsFallback && (
    INSECURE_FALLBACKS.includes(normalizedSecret)
    || rawSecret.length < 32
    || isPlaceholder
  )) {
    throw new Error(
      '[FATAL] Startup rejected: JWT_SECRET must be at least 32 characters and cannot use a known default, placeholder, or insecure fallback outside development or test mode.'
    );
  }

  return rawSecret;
}

export const JWT_SECRET = resolveJwtSecret();
