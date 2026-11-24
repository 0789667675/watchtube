/**
 * Centralized Advertising Configuration & Security Validation
 *
 * Requirements:
 * 1. Single source of truth for advertising token signing and verification.
 * 2. Dedicated advertising secret separate from user authentication JWT secrets.
 * 3. Outside explicit development/test mode, startup fails if ADS_TRACKING_SECRET is
 *    absent, insecure, matches JWT_SECRET, a placeholder, or shorter than 32 characters.
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
  'adsecret',
];

const PLACEHOLDER_PREFIXES = ['replace_with_', 'your_', 'example_', 'placeholder_'];

export interface AdsSecretOptions {
  nodeEnv?: string;
  secret?: string;
  jwtSecret?: string;
}

export const AD_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const AD_DECISION_TIMEOUT_MS = 2000; // 2 seconds per provider
export const DEFAULT_AD_SKIP_OFFSET_SECONDS = 5;

export function resolveAdsTrackingSecret(options: AdsSecretOptions = {}): string {
  const nodeEnv = Object.prototype.hasOwnProperty.call(options, 'nodeEnv')
    ? options.nodeEnv
    : process.env.NODE_ENV;
  const rawSecret = (options.secret ?? process.env.ADS_TRACKING_SECRET)?.trim();
  const rawJwtSecret = (options.jwtSecret ?? process.env.JWT_SECRET)?.trim();
  const allowsFallback = nodeEnv === 'development' || nodeEnv === 'test';

  if (!rawSecret) {
    if (allowsFallback) {
      return 'dev-watchtube-ads-tracking-secret-32-chars';
    }

    if (nodeEnv === 'production') {
      throw new Error(
        '[FATAL] Production startup rejected: ADS_TRACKING_SECRET environment variable is missing or empty. A secure secret of at least 32 characters is required.'
      );
    }
    throw new Error(
      '[FATAL] Startup rejected: ADS_TRACKING_SECRET is required outside explicit development or test mode.'
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
      '[FATAL] Startup rejected: ADS_TRACKING_SECRET must be at least 32 characters and cannot use a known default, placeholder, or insecure fallback outside development or test mode.'
    );
  }

  // Ensure dedicated separation: advertising token secret must not match JWT user auth secret
  if (!allowsFallback && rawJwtSecret && rawSecret === rawJwtSecret) {
    throw new Error(
      '[FATAL] Security violation: ADS_TRACKING_SECRET must be distinct from JWT_SECRET to preserve cryptographic key isolation.'
    );
  }

  return rawSecret;
}
