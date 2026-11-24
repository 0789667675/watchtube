import crypto from 'node:crypto';
import {
  AdPlacementType,
  AdTelemetryEventType,
  AdTokenBindingContext,
  AdTokenPayload,
} from './types';

export type NonceFailureReason =
  | 'DUPLICATE_EVENT'
  | 'CONFLICTING_LIFECYCLE_STATE'
  | 'INVALID_EVENT_SEQUENCE'
  | 'SESSION_EXPIRED'
  | 'PERSISTENCE_UNAVAILABLE';

export interface NonceConsumptionResult {
  success: boolean;
  reason?: NonceFailureReason;
  isDuplicateImpression?: boolean;
}

export interface IAdTelemetryNonceStore {
  consumeEvent(
    sessionId: string,
    eventType: AdTelemetryEventType,
    expiresAt: number
  ): Promise<NonceConsumptionResult> | NonceConsumptionResult;
  isEventConsumed(sessionId: string, eventType: AdTelemetryEventType): Promise<boolean> | boolean;
  releaseEvent?(sessionId: string, eventType: AdTelemetryEventType): Promise<void> | void;
  clear(): Promise<void> | void;
}

const VALID_PLACEMENTS: ReadonlySet<AdPlacementType> = new Set([
  'PRE_ROLL',
  'MID_ROLL',
  'POST_ROLL',
  'DISPLAY_BANNER',
  'DISPLAY_SIDEBAR',
  'NATIVE_FEED',
]);

const VALID_TELEMETRY_EVENTS: ReadonlySet<AdTelemetryEventType> = new Set([
  'AD_REQUEST',
  'AD_LOADED',
  'AD_IMPRESSION',
  'AD_VIEWABLE',
  'AD_CLICK',
  'AD_FIRST_QUARTILE',
  'AD_MIDPOINT',
  'AD_THIRD_QUARTILE',
  'AD_COMPLETED',
  'AD_SKIPPED',
  'AD_ERROR',
]);

const POST_REQUEST_EVENTS: readonly AdTelemetryEventType[] = [
  'AD_LOADED',
  'AD_IMPRESSION',
  'AD_VIEWABLE',
  'AD_CLICK',
  'AD_FIRST_QUARTILE',
  'AD_MIDPOINT',
  'AD_THIRD_QUARTILE',
];

const POST_LOADED_EVENTS: readonly AdTelemetryEventType[] = [
  'AD_IMPRESSION',
  'AD_VIEWABLE',
  'AD_CLICK',
  'AD_FIRST_QUARTILE',
  'AD_MIDPOINT',
  'AD_THIRD_QUARTILE',
];

const POST_IMPRESSION_EVENTS: readonly AdTelemetryEventType[] = [
  'AD_VIEWABLE',
  'AD_CLICK',
  'AD_FIRST_QUARTILE',
  'AD_MIDPOINT',
  'AD_THIRD_QUARTILE',
];

const TERMINAL_EVENTS: readonly AdTelemetryEventType[] = [
  'AD_COMPLETED',
  'AD_SKIPPED',
  'AD_ERROR',
];

/**
 * Shared deterministic lifecycle state-machine validation for ad telemetry.
 * Prevents duplicates, terminal conflicts (skip vs complete vs error),
 * prerequisite violations, and out-of-order progression.
 */
export function validateAdLifecycleTransition(
  consumedEvents: ReadonlySet<AdTelemetryEventType>,
  eventType: AdTelemetryEventType
): NonceConsumptionResult {
  if (!VALID_TELEMETRY_EVENTS.has(eventType)) {
    return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
  }

  if (consumedEvents.has(eventType)) {
    return {
      success: false,
      reason: 'DUPLICATE_EVENT',
      isDuplicateImpression: eventType === 'AD_IMPRESSION',
    };
  }

  const hasAny = (events: readonly AdTelemetryEventType[]) =>
    events.some((ev) => consumedEvents.has(ev));

  // Terminal conflicts are evaluated first so skip-vs-complete always surfaces clearly.
  if (eventType === 'AD_COMPLETED' && (consumedEvents.has('AD_SKIPPED') || consumedEvents.has('AD_ERROR'))) {
    return { success: false, reason: 'CONFLICTING_LIFECYCLE_STATE' };
  }
  if (eventType === 'AD_SKIPPED' && (consumedEvents.has('AD_COMPLETED') || consumedEvents.has('AD_ERROR'))) {
    return { success: false, reason: 'CONFLICTING_LIFECYCLE_STATE' };
  }
  if (eventType === 'AD_ERROR' && (consumedEvents.has('AD_COMPLETED') || consumedEvents.has('AD_SKIPPED'))) {
    return { success: false, reason: 'CONFLICTING_LIFECYCLE_STATE' };
  }

  if (eventType === 'AD_CLICK') {
    if (consumedEvents.has('AD_ERROR')) {
      return { success: false, reason: 'CONFLICTING_LIFECYCLE_STATE' };
    }
    if (!consumedEvents.has('AD_IMPRESSION')) {
      return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
    }
    return { success: true };
  }

  if (eventType !== 'AD_SKIPPED' && eventType !== 'AD_ERROR' && hasAny(TERMINAL_EVENTS)) {
    return { success: false, reason: 'CONFLICTING_LIFECYCLE_STATE' };
  }

  switch (eventType) {
    case 'AD_REQUEST':
      if (hasAny(POST_REQUEST_EVENTS)) {
        return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
      }
      return { success: true };

    case 'AD_LOADED':
      if (hasAny(POST_LOADED_EVENTS)) {
        return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
      }
      return { success: true };

    case 'AD_IMPRESSION':
      if (hasAny(POST_IMPRESSION_EVENTS)) {
        return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
      }
      return { success: true };

    case 'AD_VIEWABLE':
      if (!consumedEvents.has('AD_IMPRESSION')) {
        return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
      }
      return { success: true };

    case 'AD_FIRST_QUARTILE':
      if (!consumedEvents.has('AD_IMPRESSION') || consumedEvents.has('AD_MIDPOINT') || consumedEvents.has('AD_THIRD_QUARTILE')) {
        return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
      }
      return { success: true };

    case 'AD_MIDPOINT':
      if (!consumedEvents.has('AD_FIRST_QUARTILE') || consumedEvents.has('AD_THIRD_QUARTILE')) {
        return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
      }
      return { success: true };

    case 'AD_THIRD_QUARTILE':
      if (!consumedEvents.has('AD_MIDPOINT')) {
        return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
      }
      return { success: true };

    case 'AD_COMPLETED':
      if (!consumedEvents.has('AD_THIRD_QUARTILE')) {
        return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
      }
      return { success: true };

    case 'AD_SKIPPED':
    case 'AD_ERROR':
      return { success: true };
  }
}

/**
 * In-memory telemetry nonce and replay prevention store for unit tests only.
 * Unsuitable for multi-instance production deployments.
 */
export class InMemoryAdTelemetryNonceStore implements IAdTelemetryNonceStore {
  private sessions = new Map<
    string,
    { expiresAt: number; consumedEvents: Set<AdTelemetryEventType> }
  >();
  private lastPurge = Date.now();
  private purgeIntervalMs = 60 * 1000;

  consumeEvent(
    sessionId: string,
    eventType: AdTelemetryEventType,
    expiresAt: number
  ): NonceConsumptionResult {
    this.maybePurgeExpired();

    const now = Date.now();
    if (!Number.isFinite(expiresAt) || now > expiresAt) {
      return { success: false, reason: 'SESSION_EXPIRED' };
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      const check = validateAdLifecycleTransition(session.consumedEvents, eventType);
      if (!check.success) return check;
      session.consumedEvents.add(eventType);
      return { success: true };
    }

    const emptySet = new Set<AdTelemetryEventType>();
    const check = validateAdLifecycleTransition(emptySet, eventType);
    if (!check.success) return check;

    emptySet.add(eventType);
    this.sessions.set(sessionId, { expiresAt, consumedEvents: emptySet });
    return { success: true };
  }

  isEventConsumed(sessionId: string, eventType: AdTelemetryEventType): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.consumedEvents.has(eventType) : false;
  }

  releaseEvent(sessionId: string, eventType: AdTelemetryEventType): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.consumedEvents.delete(eventType);
    }
  }

  clear(): void {
    this.sessions.clear();
  }

  private maybePurgeExpired(): void {
    const now = Date.now();
    if (now - this.lastPurge < this.purgeIntervalMs) return;

    this.lastPurge = now;
    for (const [sessionId, data] of this.sessions.entries()) {
      if (now > data.expiresAt) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export const defaultAdTelemetryNonceStore = new InMemoryAdTelemetryNonceStore();

/**
 * Fail-closed store used outside test mode when no distributed Redis client is available.
 * Guarantees production never silently degrades to unsafe in-memory replay tracking.
 */
export class FailClosedAdTelemetryNonceStore implements IAdTelemetryNonceStore {
  constructor(private readonly message = 'Distributed ad telemetry store is not configured') {}

  consumeEvent(
    _sessionId: string,
    _eventType: AdTelemetryEventType,
    _expiresAt: number
  ): NonceConsumptionResult {
    return { success: false, reason: 'PERSISTENCE_UNAVAILABLE' };
  }

  isEventConsumed(_sessionId: string, _eventType: AdTelemetryEventType): boolean {
    return false;
  }

  clear(): void {
    // No-op
  }

  getReason(): string {
    return this.message;
  }
}

export interface IRedisClientLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  sismember(key: string, member: string): Promise<number>;
  srem?(key: string, ...members: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;
  keys?(pattern: string): Promise<string[]>;
}

/**
 * Atomic Redis Lua script executing single-threaded in Redis.
 * Enforces:
 * 1. Atomic duplicate rejection + SET NX EX per-event nonce key.
 * 2. Terminal state conflicts (COMPLETED vs SKIPPED vs ERROR).
 * 3. Strict lifecycle prerequisite & progression ordering.
 * 4. Bounded TTL expiration matching the token expiration.
 */
export const REDIS_NONCE_LUA_SCRIPT = `
local sessionKey = KEYS[1]
local eventType = ARGV[1]
local ttlSeconds = tonumber(ARGV[2])

local function has(ev)
  return redis.call('SISMEMBER', sessionKey, ev) == 1
end

if has(eventType) then
  if eventType == 'AD_IMPRESSION' then
    return 'DUPLICATE_IMPRESSION'
  end
  return 'DUPLICATE_EVENT'
end

-- Terminal mutual-exclusion checks first
if eventType == 'AD_COMPLETED' and (has('AD_SKIPPED') or has('AD_ERROR')) then
  return 'CONFLICTING_LIFECYCLE_STATE'
end
if eventType == 'AD_SKIPPED' and (has('AD_COMPLETED') or has('AD_ERROR')) then
  return 'CONFLICTING_LIFECYCLE_STATE'
end
if eventType == 'AD_ERROR' and (has('AD_COMPLETED') or has('AD_SKIPPED')) then
  return 'CONFLICTING_LIFECYCLE_STATE'
end

if eventType == 'AD_CLICK' then
  if has('AD_ERROR') then
    return 'CONFLICTING_LIFECYCLE_STATE'
  end
  if not has('AD_IMPRESSION') then
    return 'INVALID_EVENT_SEQUENCE'
  end
elseif eventType ~= 'AD_SKIPPED' and eventType ~= 'AD_ERROR' then
  if has('AD_COMPLETED') or has('AD_SKIPPED') or has('AD_ERROR') then
    return 'CONFLICTING_LIFECYCLE_STATE'
  end
end

if eventType == 'AD_REQUEST' then
  if has('AD_LOADED') or has('AD_IMPRESSION') or has('AD_VIEWABLE') or has('AD_CLICK')
     or has('AD_FIRST_QUARTILE') or has('AD_MIDPOINT') or has('AD_THIRD_QUARTILE') then
    return 'INVALID_EVENT_SEQUENCE'
  end
elseif eventType == 'AD_LOADED' then
  if has('AD_IMPRESSION') or has('AD_VIEWABLE') or has('AD_CLICK')
     or has('AD_FIRST_QUARTILE') or has('AD_MIDPOINT') or has('AD_THIRD_QUARTILE') then
    return 'INVALID_EVENT_SEQUENCE'
  end
elseif eventType == 'AD_IMPRESSION' then
  if has('AD_VIEWABLE') or has('AD_CLICK')
     or has('AD_FIRST_QUARTILE') or has('AD_MIDPOINT') or has('AD_THIRD_QUARTILE') then
    return 'INVALID_EVENT_SEQUENCE'
  end
elseif eventType == 'AD_VIEWABLE' then
  if not has('AD_IMPRESSION') then
    return 'INVALID_EVENT_SEQUENCE'
  end
elseif eventType == 'AD_FIRST_QUARTILE' then
  if (not has('AD_IMPRESSION')) or has('AD_MIDPOINT') or has('AD_THIRD_QUARTILE') then
    return 'INVALID_EVENT_SEQUENCE'
  end
elseif eventType == 'AD_MIDPOINT' then
  if (not has('AD_FIRST_QUARTILE')) or has('AD_THIRD_QUARTILE') then
    return 'INVALID_EVENT_SEQUENCE'
  end
elseif eventType == 'AD_THIRD_QUARTILE' then
  if not has('AD_MIDPOINT') then
    return 'INVALID_EVENT_SEQUENCE'
  end
elseif eventType == 'AD_COMPLETED' then
  if not has('AD_THIRD_QUARTILE') then
    return 'INVALID_EVENT_SEQUENCE'
  end
end

local eventNonceKey = sessionKey .. ':ev:' .. eventType
local acquired = redis.call('SET', eventNonceKey, '1', 'EX', ttlSeconds, 'NX')
if not acquired then
  if eventType == 'AD_IMPRESSION' then
    return 'DUPLICATE_IMPRESSION'
  end
  return 'DUPLICATE_EVENT'
end

redis.call('SADD', sessionKey, eventType)
local currentTtl = redis.call('TTL', sessionKey)
if currentTtl < ttlSeconds then
  redis.call('EXPIRE', sessionKey, ttlSeconds)
end

return 'OK'
`;

export class RedisAdTelemetryNonceStore implements IAdTelemetryNonceStore {
  private redis: IRedisClientLike;
  private keyPrefix: string;

  constructor(redis: IRedisClientLike, keyPrefix = 'ad:telemetry:session:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  async consumeEvent(
    sessionId: string,
    eventType: AdTelemetryEventType,
    expiresAt: number
  ): Promise<NonceConsumptionResult> {
    if (!VALID_TELEMETRY_EVENTS.has(eventType)) {
      return { success: false, reason: 'INVALID_EVENT_SEQUENCE' };
    }

    const now = Date.now();
    if (!Number.isFinite(expiresAt) || now > expiresAt) {
      return { success: false, reason: 'SESSION_EXPIRED' };
    }

    const ttlSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));
    const sessionKey = `${this.keyPrefix}${sessionId}`;

    try {
      const result = await this.redis.eval(
        REDIS_NONCE_LUA_SCRIPT,
        1,
        sessionKey,
        eventType,
        ttlSeconds
      );

      if (result === 'OK') {
        return { success: true };
      }
      if (result === 'DUPLICATE_IMPRESSION') {
        return {
          success: false,
          reason: 'DUPLICATE_EVENT',
          isDuplicateImpression: true,
        };
      }
      if (result === 'DUPLICATE_EVENT') {
        return {
          success: false,
          reason: 'DUPLICATE_EVENT',
          isDuplicateImpression: eventType === 'AD_IMPRESSION',
        };
      }
      if (result === 'CONFLICTING_LIFECYCLE_STATE') {
        return {
          success: false,
          reason: 'CONFLICTING_LIFECYCLE_STATE',
        };
      }
      if (result === 'INVALID_EVENT_SEQUENCE') {
        return {
          success: false,
          reason: 'INVALID_EVENT_SEQUENCE',
        };
      }

      return { success: false, reason: 'PERSISTENCE_UNAVAILABLE' };
    } catch (error) {
      console.error(
        '[RedisAdTelemetryNonceStore] Error during nonce consumption:',
        error instanceof Error ? error.message : 'Redis error'
      );
      return { success: false, reason: 'PERSISTENCE_UNAVAILABLE' };
    }
  }

  async isEventConsumed(sessionId: string, eventType: AdTelemetryEventType): Promise<boolean> {
    const sessionKey = `${this.keyPrefix}${sessionId}`;
    try {
      const exists = await this.redis.sismember(sessionKey, eventType);
      return exists === 1;
    } catch {
      return false;
    }
  }

  async releaseEvent(sessionId: string, eventType: AdTelemetryEventType): Promise<void> {
    const sessionKey = `${this.keyPrefix}${sessionId}`;
    const eventNonceKey = `${sessionKey}:ev:${eventType}`;
    try {
      if (typeof this.redis.srem === 'function') {
        await this.redis.srem(sessionKey, eventType);
      }
      await this.redis.del(eventNonceKey);
    } catch (error) {
      console.error(
        '[RedisAdTelemetryNonceStore] Failed to roll back event nonce:',
        error instanceof Error ? error.message : 'Redis error'
      );
    }
  }

  async clear(): Promise<void> {
    if (typeof this.redis.keys === 'function') {
      try {
        const keys = await this.redis.keys(`${this.keyPrefix}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } catch {
        // Safe fallback for cleanup
      }
    }
  }
}

export function resolveAdTelemetryNonceStore(options: {
  nonceStore?: IAdTelemetryNonceStore;
  redisClient?: IRedisClientLike;
  nodeEnv?: string;
  allowInMemory?: boolean;
} = {}): IAdTelemetryNonceStore {
  if (options.nonceStore) {
    return options.nonceStore;
  }
  if (options.redisClient) {
    return new RedisAdTelemetryNonceStore(options.redisClient);
  }
  const nodeEnv = Object.prototype.hasOwnProperty.call(options, 'nodeEnv')
    ? options.nodeEnv
    : process.env.NODE_ENV;
  if (options.allowInMemory || nodeEnv === 'test') {
    return defaultAdTelemetryNonceStore;
  }
  return new FailClosedAdTelemetryNonceStore(
    'Distributed Redis replay store is required outside test mode.'
  );
}

/**
 * Signs an ad session payload into a tamper-proof token using HMAC-SHA256.
 */
export function signAdToken(payload: AdTokenPayload, secret: string): string {
  const serialized = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(serialized).digest('base64url');
  return `${serialized}.${hmac}`;
}

/**
 * Verifies and parses an ad token. Returns null if expired, malformed, or tampered with.
 */
export function verifyAdToken(token: string, secret: string): AdTokenPayload | null {
  if (!token || typeof token !== 'string' || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [serialized, signature] = parts;
  if (!serialized || !signature) return null;

  const expectedHmac = crypto.createHmac('sha256', secret).update(serialized).digest('base64url');

  if (signature.length !== expectedHmac.length) return null;
  const isMatch = crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedHmac, 'utf8')
  );

  if (!isMatch) return null;

  try {
    const raw = Buffer.from(serialized, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as AdTokenPayload;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (
      typeof parsed.sessionId !== 'string' || !parsed.sessionId.trim()
      || typeof parsed.adId !== 'string' || !parsed.adId.trim()
      || typeof parsed.provider !== 'string' || !parsed.provider.trim()
      || !VALID_PLACEMENTS.has(parsed.placement)
      || typeof parsed.timestamp !== 'number' || !Number.isFinite(parsed.timestamp)
      || typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }

    if (parsed.videoId !== undefined && typeof parsed.videoId !== 'string') return null;
    if (parsed.channelId !== undefined && typeof parsed.channelId !== 'string') return null;
    if (parsed.decisionId !== undefined && typeof parsed.decisionId !== 'string') return null;
    if (parsed.providerId !== undefined && typeof parsed.providerId !== 'string') return null;
    if (parsed.isShort !== undefined && typeof parsed.isShort !== 'boolean') return null;

    if (Date.now() > parsed.expiresAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Verifies that an ad token remains strictly bound to expected decision/session/video/placement/provider claims.
 */
export function verifyAdTokenBinding(
  payload: AdTokenPayload,
  expected: AdTokenBindingContext
): { valid: boolean; mismatchedFields: string[] } {
  const mismatchedFields: string[] = [];

  if (expected.decisionId !== undefined && payload.decisionId !== expected.decisionId) {
    mismatchedFields.push('decisionId');
  }
  if (expected.sessionId !== undefined && payload.sessionId !== expected.sessionId) {
    mismatchedFields.push('sessionId');
  }
  if (expected.placement !== undefined && payload.placement !== expected.placement) {
    mismatchedFields.push('placement');
  }
  if (expected.provider !== undefined && payload.provider !== expected.provider) {
    mismatchedFields.push('provider');
  }
  if (expected.providerId !== undefined && payload.providerId !== expected.providerId) {
    mismatchedFields.push('providerId');
  }
  if (expected.adId !== undefined && payload.adId !== expected.adId) {
    mismatchedFields.push('adId');
  }
  if (expected.videoId !== undefined && payload.videoId !== expected.videoId) {
    mismatchedFields.push('videoId');
  }
  if (expected.channelId !== undefined && payload.channelId !== expected.channelId) {
    mismatchedFields.push('channelId');
  }

  return {
    valid: mismatchedFields.length === 0,
    mismatchedFields,
  };
}
