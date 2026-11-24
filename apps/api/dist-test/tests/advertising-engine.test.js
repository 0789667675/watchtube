"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const advertising_1 = require("../src/services/advertising");
const TEST_SECRET = 'test-secret-at-least-32-characters-long-safe-key-here';
(0, node_test_1.test)('signs and verifies valid ad telemetry tokens with HMAC-SHA256', () => {
    const now = Date.now();
    const payload = {
        sessionId: 'session-uuid-1234',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-9999',
        videoId: 'video-1111',
        channelId: 'channel-2222',
        timestamp: now,
        expiresAt: now + 60000,
    };
    const token = (0, advertising_1.signAdToken)(payload, TEST_SECRET);
    strict_1.default.ok(token.includes('.'), 'Token must contain payload and signature');
    const verified = (0, advertising_1.verifyAdToken)(token, TEST_SECRET);
    strict_1.default.ok(verified, 'Verified token must not be null');
    strict_1.default.equal(verified?.sessionId, payload.sessionId);
    strict_1.default.equal(verified?.placement, payload.placement);
    strict_1.default.equal(verified?.provider, payload.provider);
    strict_1.default.equal(verified?.videoId, payload.videoId);
});
(0, node_test_1.test)('rejects tampered ad telemetry tokens', () => {
    const now = Date.now();
    const payload = {
        sessionId: 'session-uuid-1234',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-9999',
        videoId: 'video-1111',
        timestamp: now,
        expiresAt: now + 60000,
    };
    const token = (0, advertising_1.signAdToken)(payload, TEST_SECRET);
    const [dataPart, sigPart] = token.split('.');
    // Attempt to tamper with the payload (e.g. change videoId or fake gross revenue)
    const tamperedData = Buffer.from(JSON.stringify({ ...payload, videoId: 'attacker-video' }), 'utf8').toString('base64url');
    const tamperedToken = `${tamperedData}.${sigPart}`;
    strict_1.default.equal((0, advertising_1.verifyAdToken)(tamperedToken, TEST_SECRET), null);
    // Attempt with invalid secret
    strict_1.default.equal((0, advertising_1.verifyAdToken)(token, 'wrong-secret-key-that-does-not-match-at-all'), null);
});
(0, node_test_1.test)('rejects expired ad telemetry tokens', () => {
    const past = Date.now() - 5000;
    const payload = {
        sessionId: 'session-uuid-1234',
        placement: 'PRE_ROLL',
        provider: 'Adsterra Network',
        adId: 'ad-9999',
        timestamp: past - 60000,
        expiresAt: past, // Expired 5 seconds ago
    };
    const token = (0, advertising_1.signAdToken)(payload, TEST_SECRET);
    strict_1.default.equal((0, advertising_1.verifyAdToken)(token, TEST_SECRET), null, 'Expired token must be rejected');
});
(0, node_test_1.test)('VastAdProviderAdapter serves valid VAST pre-roll configuration', async () => {
    const adapter = new advertising_1.VastAdProviderAdapter('adsterra-vast', 'Adsterra Pre-Roll');
    const request = {
        placement: 'PRE_ROLL',
        videoId: 'video-test-123',
        channelId: 'channel-test-456',
    };
    const result = await adapter.requestAd(request, {
        vastTagUrl: 'https://example.com/vast?cb=[timestamp]',
        skipOffsetSeconds: 5,
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result?.decision, 'SERVE');
    strict_1.default.equal(result?.format, 'VAST_URL');
    strict_1.default.equal(result?.fallbackAction, 'FAIL_OPEN');
    strict_1.default.ok(result?.payload?.vastTagUrl?.includes('https://example.com/vast?cb='));
    strict_1.default.equal(result?.payload?.skipOffsetSeconds, 5);
});
(0, node_test_1.test)('AdsterraDisplayAdapter serves sandboxed banner placements', async () => {
    const adapter = new advertising_1.AdsterraDisplayAdapter();
    const request = {
        placement: 'DISPLAY_SIDEBAR',
        videoId: 'video-test-123',
    };
    const result = await adapter.requestAd(request, {
        zoneId: '12345678',
        width: 300,
        height: 250,
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result?.decision, 'SERVE');
    strict_1.default.equal(result?.format, 'HTML_SNIPPET');
    strict_1.default.equal(result?.payload?.width, 300);
    strict_1.default.equal(result?.payload?.height, 250);
});
(0, node_test_1.test)('DirectAdvertiserAdapter serves self-hosted campaigns', async () => {
    const adapter = new advertising_1.DirectAdvertiserAdapter();
    const request = {
        placement: 'PRE_ROLL',
        videoId: 'video-test-123',
    };
    const result = await adapter.requestAd(request, {
        campaign: {
            id: 'camp-summer-promo',
            title: 'Summer WatchTube Special',
            videoUrl: 'https://cdn.watchtube.com/ads/summer.mp4',
            targetUrl: 'https://advertiser.com/deal',
            ctaText: 'Check it out',
        },
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result?.decision, 'SERVE');
    strict_1.default.equal(result?.format, 'DIRECT_VIDEO');
    strict_1.default.equal(result?.payload?.title, 'Summer WatchTube Special');
    strict_1.default.equal(result?.payload?.videoUrl, 'https://cdn.watchtube.com/ads/summer.mp4');
});
(0, node_test_1.test)('AdDecisionEngine enforces fail-open: returns NO_FILL on empty providers', async () => {
    const engine = new advertising_1.AdDecisionEngine({ tokenSecret: TEST_SECRET });
    const result = await engine.decide({
        placement: 'PRE_ROLL',
        videoId: 'vid-1',
    });
    strict_1.default.equal(result.decision, 'NO_FILL');
    strict_1.default.equal(result.fallbackAction, 'FAIL_OPEN');
});
(0, node_test_1.test)('AdDecisionEngine executes waterfall and returns signed tracking token', async () => {
    const engine = new advertising_1.AdDecisionEngine({ tokenSecret: TEST_SECRET });
    const vastAdapter = new advertising_1.VastAdProviderAdapter('adsterra-vast', 'Adsterra Pre-Roll');
    engine.registerProvider(vastAdapter, 1, true, {
        vastTagUrl: 'https://adsterra.example/vast?t=[timestamp]',
    });
    const result = await engine.decide({
        placement: 'PRE_ROLL',
        videoId: 'video-abc',
        channelId: 'channel-xyz',
    });
    strict_1.default.equal(result.decision, 'SERVE');
    strict_1.default.equal(result.provider, 'Adsterra Pre-Roll');
    strict_1.default.ok(result.trackingToken, 'Decision must include signed tracking token');
    // Verify the tracking token attached to the response
    const verified = (0, advertising_1.verifyAdToken)(result.trackingToken, TEST_SECRET);
    strict_1.default.ok(verified);
    strict_1.default.equal(verified?.videoId, 'video-abc');
    strict_1.default.equal(verified?.channelId, 'channel-xyz');
    strict_1.default.equal(verified?.placement, 'PRE_ROLL');
});
(0, node_test_1.test)('AdDecisionEngine fails open safely when a provider throws an unexpected error', async () => {
    const engine = new advertising_1.AdDecisionEngine({ tokenSecret: TEST_SECRET });
    const crashingAdapter = {
        id: 'broken-provider',
        name: 'Broken Provider',
        providerType: 'CUSTOM',
        supportedPlacements: ['PRE_ROLL'],
        async requestAd() {
            throw new Error('Third-party API connection timeout or socket hangup');
        },
    };
    engine.registerProvider(crashingAdapter, 1, true);
    // The engine must never throw or crash the request
    const result = await engine.decide({
        placement: 'PRE_ROLL',
        videoId: 'vid-99',
    });
    strict_1.default.equal(result.decision, 'NO_FILL');
    strict_1.default.equal(result.fallbackAction, 'FAIL_OPEN');
});
(0, node_test_1.test)('AdDecisionEngine waterfalls to secondary provider when primary no-fills', async () => {
    const engine = new advertising_1.AdDecisionEngine({ tokenSecret: TEST_SECRET });
    const failingPrimary = {
        id: 'primary-nofill',
        name: 'Primary Network',
        providerType: 'VAST_GENERIC',
        supportedPlacements: ['PRE_ROLL'],
        async requestAd(req) {
            return {
                decision: 'NO_FILL',
                placement: req.placement,
                provider: 'Primary Network',
                providerType: 'VAST_GENERIC',
                fallbackAction: 'TRY_NEXT_PROVIDER',
            };
        },
    };
    const backupAdapter = new advertising_1.VastAdProviderAdapter('backup-vast', 'Backup VAST Network');
    engine.registerProvider(failingPrimary, 1, true);
    engine.registerProvider(backupAdapter, 2, true, {
        vastTagUrl: 'https://backup.example/vast',
    });
    const result = await engine.decide({
        placement: 'PRE_ROLL',
        videoId: 'vid-fallback-test',
    });
    strict_1.default.equal(result.decision, 'SERVE');
    strict_1.default.equal(result.provider, 'Backup VAST Network');
    strict_1.default.ok(result.trackingToken);
});
class MockRedisClient {
    sets = new Map();
    ttls = new Map();
    async eval(_script, _numKeys, ...args) {
        const sessionKey = String(args[0]);
        const eventType = String(args[1]);
        const ttlSeconds = Number(args[2]);
        let set = this.sets.get(sessionKey);
        if (!set) {
            set = new Set();
            this.sets.set(sessionKey, set);
        }
        if (set.has(eventType)) {
            if (eventType === 'AD_IMPRESSION') {
                return 'DUPLICATE_IMPRESSION';
            }
            return 'DUPLICATE_EVENT';
        }
        if (eventType === 'AD_SKIPPED' && set.has('AD_COMPLETED')) {
            return 'CONFLICTING_LIFECYCLE_STATE';
        }
        if (eventType === 'AD_COMPLETED' && set.has('AD_SKIPPED')) {
            return 'CONFLICTING_LIFECYCLE_STATE';
        }
        set.add(eventType);
        const currentTtl = this.ttls.get(sessionKey) || 0;
        if (currentTtl < ttlSeconds) {
            this.ttls.set(sessionKey, ttlSeconds);
        }
        return 'OK';
    }
    async sismember(key, member) {
        const set = this.sets.get(key);
        return set && set.has(member) ? 1 : 0;
    }
    async del(...keys) {
        let count = 0;
        for (const key of keys) {
            if (this.sets.delete(key))
                count++;
            this.ttls.delete(key);
        }
        return count;
    }
    async keys(pattern) {
        const prefix = pattern.replace('*', '');
        return Array.from(this.sets.keys()).filter((k) => k.startsWith(prefix));
    }
}
(0, node_test_1.test)('RedisAdTelemetryNonceStore consumes events atomically and prevents replay', async () => {
    const mockRedis = new MockRedisClient();
    const store = new advertising_1.RedisAdTelemetryNonceStore(mockRedis);
    const sessionId = 'test-session-distributed-1';
    const expiresAt = Date.now() + 60000;
    // First request consumes AD_IMPRESSION
    const first = await store.consumeEvent(sessionId, 'AD_IMPRESSION', expiresAt);
    strict_1.default.equal(first.success, true);
    // Second duplicate request is rejected atomically
    const second = await store.consumeEvent(sessionId, 'AD_IMPRESSION', expiresAt);
    strict_1.default.equal(second.success, false);
    strict_1.default.equal(second.reason, 'DUPLICATE_EVENT');
    strict_1.default.equal(second.isDuplicateImpression, true);
    // sismember check confirms recorded
    const isRecorded = await store.isEventConsumed(sessionId, 'AD_IMPRESSION');
    strict_1.default.equal(isRecorded, true);
});
(0, node_test_1.test)('RedisAdTelemetryNonceStore enforces lifecycle state conflict protection', async () => {
    const mockRedis = new MockRedisClient();
    const store = new advertising_1.RedisAdTelemetryNonceStore(mockRedis);
    const sessionId = 'test-session-conflict-1';
    const expiresAt = Date.now() + 60000;
    // First record AD_SKIPPED
    const skippedResult = await store.consumeEvent(sessionId, 'AD_SKIPPED', expiresAt);
    strict_1.default.equal(skippedResult.success, true);
    // Now attempt to record AD_COMPLETED on skipped session
    const completedResult = await store.consumeEvent(sessionId, 'AD_COMPLETED', expiresAt);
    strict_1.default.equal(completedResult.success, false);
    strict_1.default.equal(completedResult.reason, 'CONFLICTING_LIFECYCLE_STATE');
});
(0, node_test_1.test)('RedisAdTelemetryNonceStore handles multi-instance concurrent requests atomically', async () => {
    const sharedRedis = new MockRedisClient();
    // Simulate 3 distinct API server instances connecting to the same Redis cluster
    const instanceA = new advertising_1.RedisAdTelemetryNonceStore(sharedRedis);
    const instanceB = new advertising_1.RedisAdTelemetryNonceStore(sharedRedis);
    const instanceC = new advertising_1.RedisAdTelemetryNonceStore(sharedRedis);
    const sessionId = 'concurrent-ad-session-multi-instance';
    const expiresAt = Date.now() + 30000;
    // 3 instances simultaneously attempt to claim the exact same impression
    const results = await Promise.all([
        instanceA.consumeEvent(sessionId, 'AD_IMPRESSION', expiresAt),
        instanceB.consumeEvent(sessionId, 'AD_IMPRESSION', expiresAt),
        instanceC.consumeEvent(sessionId, 'AD_IMPRESSION', expiresAt),
    ]);
    const successes = results.filter((r) => r.success);
    const duplicates = results.filter((r) => !r.success && r.isDuplicateImpression);
    // Exactly one instance must succeed, exactly two must be blocked as duplicates
    strict_1.default.equal(successes.length, 1);
    strict_1.default.equal(duplicates.length, 2);
});
(0, node_test_1.test)('RedisAdTelemetryNonceStore rejects expired sessions immediately', async () => {
    const mockRedis = new MockRedisClient();
    const store = new advertising_1.RedisAdTelemetryNonceStore(mockRedis);
    const sessionId = 'expired-session-1';
    const expiredTimestamp = Date.now() - 5000;
    const result = await store.consumeEvent(sessionId, 'AD_IMPRESSION', expiredTimestamp);
    strict_1.default.equal(result.success, false);
    strict_1.default.equal(result.reason, 'SESSION_EXPIRED');
});
