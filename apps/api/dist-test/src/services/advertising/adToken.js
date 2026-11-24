"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisAdTelemetryNonceStore = exports.REDIS_NONCE_LUA_SCRIPT = exports.FailClosedAdTelemetryNonceStore = exports.defaultAdTelemetryNonceStore = exports.InMemoryAdTelemetryNonceStore = void 0;
exports.validateAdLifecycleTransition = validateAdLifecycleTransition;
exports.resolveAdTelemetryNonceStore = resolveAdTelemetryNonceStore;
exports.signAdToken = signAdToken;
exports.verifyAdToken = verifyAdToken;
exports.verifyAdTokenBinding = verifyAdTokenBinding;
const node_crypto_1 = __importDefault(require("node:crypto"));
const VALID_PLACEMENTS = new Set([
    'PRE_ROLL',
    'MID_ROLL',
    'POST_ROLL',
    'DISPLAY_BANNER',
    'DISPLAY_SIDEBAR',
    'NATIVE_FEED',
]);
const VALID_TELEMETRY_EVENTS = new Set([
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
const POST_REQUEST_EVENTS = [
    'AD_LOADED',
    'AD_IMPRESSION',
    'AD_VIEWABLE',
    'AD_CLICK',
    'AD_FIRST_QUARTILE',
    'AD_MIDPOINT',
    'AD_THIRD_QUARTILE',
];
const POST_LOADED_EVENTS = [
    'AD_IMPRESSION',
    'AD_VIEWABLE',
    'AD_CLICK',
    'AD_FIRST_QUARTILE',
    'AD_MIDPOINT',
    'AD_THIRD_QUARTILE',
];
const POST_IMPRESSION_EVENTS = [
    'AD_VIEWABLE',
    'AD_CLICK',
    'AD_FIRST_QUARTILE',
    'AD_MIDPOINT',
    'AD_THIRD_QUARTILE',
];
const TERMINAL_EVENTS = [
    'AD_COMPLETED',
    'AD_SKIPPED',
    'AD_ERROR',
];
/**
 * Shared deterministic lifecycle state-machine validation for ad telemetry.
 * Prevents duplicates, terminal conflicts (skip vs complete vs error),
 * prerequisite violations, and out-of-order progression.
 */
function validateAdLifecycleTransition(consumedEvents, eventType) {
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
    const hasAny = (events) => events.some((ev) => consumedEvents.has(ev));
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
class InMemoryAdTelemetryNonceStore {
    sessions = new Map();
    lastPurge = Date.now();
    purgeIntervalMs = 60 * 1000;
    consumeEvent(sessionId, eventType, expiresAt) {
        this.maybePurgeExpired();
        const now = Date.now();
        if (!Number.isFinite(expiresAt) || now > expiresAt) {
            return { success: false, reason: 'SESSION_EXPIRED' };
        }
        const session = this.sessions.get(sessionId);
        if (session) {
            const check = validateAdLifecycleTransition(session.consumedEvents, eventType);
            if (!check.success)
                return check;
            session.consumedEvents.add(eventType);
            return { success: true };
        }
        const emptySet = new Set();
        const check = validateAdLifecycleTransition(emptySet, eventType);
        if (!check.success)
            return check;
        emptySet.add(eventType);
        this.sessions.set(sessionId, { expiresAt, consumedEvents: emptySet });
        return { success: true };
    }
    isEventConsumed(sessionId, eventType) {
        const session = this.sessions.get(sessionId);
        return session ? session.consumedEvents.has(eventType) : false;
    }
    releaseEvent(sessionId, eventType) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.consumedEvents.delete(eventType);
        }
    }
    clear() {
        this.sessions.clear();
    }
    maybePurgeExpired() {
        const now = Date.now();
        if (now - this.lastPurge < this.purgeIntervalMs)
            return;
        this.lastPurge = now;
        for (const [sessionId, data] of this.sessions.entries()) {
            if (now > data.expiresAt) {
                this.sessions.delete(sessionId);
            }
        }
    }
}
exports.InMemoryAdTelemetryNonceStore = InMemoryAdTelemetryNonceStore;
exports.defaultAdTelemetryNonceStore = new InMemoryAdTelemetryNonceStore();
/**
 * Fail-closed store used outside test mode when no distributed Redis client is available.
 * Guarantees production never silently degrades to unsafe in-memory replay tracking.
 */
class FailClosedAdTelemetryNonceStore {
    message;
    constructor(message = 'Distributed ad telemetry store is not configured') {
        this.message = message;
    }
    consumeEvent(_sessionId, _eventType, _expiresAt) {
        return { success: false, reason: 'PERSISTENCE_UNAVAILABLE' };
    }
    isEventConsumed(_sessionId, _eventType) {
        return false;
    }
    clear() {
        // No-op
    }
    getReason() {
        return this.message;
    }
}
exports.FailClosedAdTelemetryNonceStore = FailClosedAdTelemetryNonceStore;
/**
 * Atomic Redis Lua script executing single-threaded in Redis.
 * Enforces:
 * 1. Atomic duplicate rejection + SET NX EX per-event nonce key.
 * 2. Terminal state conflicts (COMPLETED vs SKIPPED vs ERROR).
 * 3. Strict lifecycle prerequisite & progression ordering.
 * 4. Bounded TTL expiration matching the token expiration.
 */
exports.REDIS_NONCE_LUA_SCRIPT = `
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
class RedisAdTelemetryNonceStore {
    redis;
    keyPrefix;
    constructor(redis, keyPrefix = 'ad:telemetry:session:') {
        this.redis = redis;
        this.keyPrefix = keyPrefix;
    }
    async consumeEvent(sessionId, eventType, expiresAt) {
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
            const result = await this.redis.eval(exports.REDIS_NONCE_LUA_SCRIPT, 1, sessionKey, eventType, ttlSeconds);
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
        }
        catch (error) {
            console.error('[RedisAdTelemetryNonceStore] Error during nonce consumption:', error instanceof Error ? error.message : 'Redis error');
            return { success: false, reason: 'PERSISTENCE_UNAVAILABLE' };
        }
    }
    async isEventConsumed(sessionId, eventType) {
        const sessionKey = `${this.keyPrefix}${sessionId}`;
        try {
            const exists = await this.redis.sismember(sessionKey, eventType);
            return exists === 1;
        }
        catch {
            return false;
        }
    }
    async releaseEvent(sessionId, eventType) {
        const sessionKey = `${this.keyPrefix}${sessionId}`;
        const eventNonceKey = `${sessionKey}:ev:${eventType}`;
        try {
            if (typeof this.redis.srem === 'function') {
                await this.redis.srem(sessionKey, eventType);
            }
            await this.redis.del(eventNonceKey);
        }
        catch (error) {
            console.error('[RedisAdTelemetryNonceStore] Failed to roll back event nonce:', error instanceof Error ? error.message : 'Redis error');
        }
    }
    async clear() {
        if (typeof this.redis.keys === 'function') {
            try {
                const keys = await this.redis.keys(`${this.keyPrefix}*`);
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
            }
            catch {
                // Safe fallback for cleanup
            }
        }
    }
}
exports.RedisAdTelemetryNonceStore = RedisAdTelemetryNonceStore;
function resolveAdTelemetryNonceStore(options = {}) {
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
        return exports.defaultAdTelemetryNonceStore;
    }
    return new FailClosedAdTelemetryNonceStore('Distributed Redis replay store is required outside test mode.');
}
/**
 * Signs an ad session payload into a tamper-proof token using HMAC-SHA256.
 */
function signAdToken(payload, secret) {
    const serialized = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const hmac = node_crypto_1.default.createHmac('sha256', secret).update(serialized).digest('base64url');
    return `${serialized}.${hmac}`;
}
/**
 * Verifies and parses an ad token. Returns null if expired, malformed, or tampered with.
 */
function verifyAdToken(token, secret) {
    if (!token || typeof token !== 'string' || !secret)
        return null;
    const parts = token.split('.');
    if (parts.length !== 2)
        return null;
    const [serialized, signature] = parts;
    if (!serialized || !signature)
        return null;
    const expectedHmac = node_crypto_1.default.createHmac('sha256', secret).update(serialized).digest('base64url');
    if (signature.length !== expectedHmac.length)
        return null;
    const isMatch = node_crypto_1.default.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedHmac, 'utf8'));
    if (!isMatch)
        return null;
    try {
        const raw = Buffer.from(serialized, 'base64url').toString('utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return null;
        if (typeof parsed.sessionId !== 'string' || !parsed.sessionId.trim()
            || typeof parsed.adId !== 'string' || !parsed.adId.trim()
            || typeof parsed.provider !== 'string' || !parsed.provider.trim()
            || !VALID_PLACEMENTS.has(parsed.placement)
            || typeof parsed.timestamp !== 'number' || !Number.isFinite(parsed.timestamp)
            || typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt)) {
            return null;
        }
        if (parsed.videoId !== undefined && typeof parsed.videoId !== 'string')
            return null;
        if (parsed.channelId !== undefined && typeof parsed.channelId !== 'string')
            return null;
        if (parsed.decisionId !== undefined && typeof parsed.decisionId !== 'string')
            return null;
        if (parsed.providerId !== undefined && typeof parsed.providerId !== 'string')
            return null;
        if (parsed.isShort !== undefined && typeof parsed.isShort !== 'boolean')
            return null;
        if (Date.now() > parsed.expiresAt) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
/**
 * Verifies that an ad token remains strictly bound to expected decision/session/video/placement/provider claims.
 */
function verifyAdTokenBinding(payload, expected) {
    const mismatchedFields = [];
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
