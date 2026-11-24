import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AdDecisionEngine,
  VastAdProviderAdapter,
  AdsterraDisplayAdapter,
  DirectAdvertiserAdapter,
  signAdToken,
  verifyAdToken,
  IAdProviderAdapter,
  AdDecisionRequest,
  RedisAdTelemetryNonceStore,
  IRedisClientLike,
} from '../src/services/advertising';

const TEST_SECRET = 'test-secret-at-least-32-characters-long-safe-key-here';

test('signs and verifies valid ad telemetry tokens with HMAC-SHA256', () => {
  const now = Date.now();
  const payload = {
    sessionId: 'session-uuid-1234',
    placement: 'PRE_ROLL' as const,
    provider: 'Adsterra Network',
    adId: 'ad-9999',
    videoId: 'video-1111',
    channelId: 'channel-2222',
    timestamp: now,
    expiresAt: now + 60000,
  };

  const token = signAdToken(payload, TEST_SECRET);
  assert.ok(token.includes('.'), 'Token must contain payload and signature');

  const verified = verifyAdToken(token, TEST_SECRET);
  assert.ok(verified, 'Verified token must not be null');
  assert.equal(verified?.sessionId, payload.sessionId);
  assert.equal(verified?.placement, payload.placement);
  assert.equal(verified?.provider, payload.provider);
  assert.equal(verified?.videoId, payload.videoId);
});

test('rejects tampered ad telemetry tokens', () => {
  const now = Date.now();
  const payload = {
    sessionId: 'session-uuid-1234',
    placement: 'PRE_ROLL' as const,
    provider: 'Adsterra Network',
    adId: 'ad-9999',
    videoId: 'video-1111',
    timestamp: now,
    expiresAt: now + 60000,
  };

  const token = signAdToken(payload, TEST_SECRET);
  const [dataPart, sigPart] = token.split('.');

  // Attempt to tamper with the payload (e.g. change videoId or fake gross revenue)
  const tamperedData = Buffer.from(
    JSON.stringify({ ...payload, videoId: 'attacker-video' }),
    'utf8'
  ).toString('base64url');
  const tamperedToken = `${tamperedData}.${sigPart}`;

  assert.equal(verifyAdToken(tamperedToken, TEST_SECRET), null);

  // Attempt with invalid secret
  assert.equal(verifyAdToken(token, 'wrong-secret-key-that-does-not-match-at-all'), null);
});

test('rejects expired ad telemetry tokens', () => {
  const past = Date.now() - 5000;
  const payload = {
    sessionId: 'session-uuid-1234',
    placement: 'PRE_ROLL' as const,
    provider: 'Adsterra Network',
    adId: 'ad-9999',
    timestamp: past - 60000,
    expiresAt: past, // Expired 5 seconds ago
  };

  const token = signAdToken(payload, TEST_SECRET);
  assert.equal(verifyAdToken(token, TEST_SECRET), null, 'Expired token must be rejected');
});

test('VastAdProviderAdapter serves valid VAST pre-roll configuration', async () => {
  const adapter = new VastAdProviderAdapter('adsterra-vast', 'Adsterra Pre-Roll');
  const request: AdDecisionRequest = {
    placement: 'PRE_ROLL',
    videoId: 'video-test-123',
    channelId: 'channel-test-456',
  };

  const result = await adapter.requestAd(request, {
    vastTagUrl: 'https://example.com/vast?cb=[timestamp]',
    skipOffsetSeconds: 5,
  });

  assert.ok(result);
  assert.equal(result?.decision, 'SERVE');
  assert.equal(result?.format, 'VAST_URL');
  assert.equal(result?.fallbackAction, 'FAIL_OPEN');
  assert.ok(result?.payload?.vastTagUrl?.includes('https://example.com/vast?cb='));
  assert.equal(result?.payload?.skipOffsetSeconds, 5);
});

test('AdsterraDisplayAdapter serves sandboxed banner placements', async () => {
  const adapter = new AdsterraDisplayAdapter();
  const request: AdDecisionRequest = {
    placement: 'DISPLAY_SIDEBAR',
    videoId: 'video-test-123',
  };

  const result = await adapter.requestAd(request, {
    zoneId: '12345678',
    width: 300,
    height: 250,
  });

  assert.ok(result);
  assert.equal(result?.decision, 'SERVE');
  assert.equal(result?.format, 'HTML_SNIPPET');
  assert.equal(result?.payload?.width, 300);
  assert.equal(result?.payload?.height, 250);
});

test('DirectAdvertiserAdapter serves self-hosted campaigns', async () => {
  const adapter = new DirectAdvertiserAdapter();
  const request: AdDecisionRequest = {
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

  assert.ok(result);
  assert.equal(result?.decision, 'SERVE');
  assert.equal(result?.format, 'DIRECT_VIDEO');
  assert.equal(result?.payload?.title, 'Summer WatchTube Special');
  assert.equal(result?.payload?.videoUrl, 'https://cdn.watchtube.com/ads/summer.mp4');
});

test('AdDecisionEngine enforces fail-open: returns NO_FILL on empty providers', async () => {
  const engine = new AdDecisionEngine({ tokenSecret: TEST_SECRET });

  const result = await engine.decide({
    placement: 'PRE_ROLL',
    videoId: 'vid-1',
  });

  assert.equal(result.decision, 'NO_FILL');
  assert.equal(result.fallbackAction, 'FAIL_OPEN');
});

test('AdDecisionEngine executes waterfall and returns signed tracking token', async () => {
  const engine = new AdDecisionEngine({ tokenSecret: TEST_SECRET });

  const vastAdapter = new VastAdProviderAdapter('adsterra-vast', 'Adsterra Pre-Roll');
  engine.registerProvider(vastAdapter, 1, true, {
    vastTagUrl: 'https://adsterra.example/vast?t=[timestamp]',
  });

  const result = await engine.decide({
    placement: 'PRE_ROLL',
    videoId: 'video-abc',
    channelId: 'channel-xyz',
  });

  assert.equal(result.decision, 'SERVE');
  assert.equal(result.provider, 'Adsterra Pre-Roll');
  assert.ok(result.trackingToken, 'Decision must include signed tracking token');

  // Verify the tracking token attached to the response
  const verified = verifyAdToken(result.trackingToken!, TEST_SECRET);
  assert.ok(verified);
  assert.equal(verified?.videoId, 'video-abc');
  assert.equal(verified?.channelId, 'channel-xyz');
  assert.equal(verified?.placement, 'PRE_ROLL');
});

test('AdDecisionEngine fails open safely when a provider throws an unexpected error', async () => {
  const engine = new AdDecisionEngine({ tokenSecret: TEST_SECRET });

  const crashingAdapter: IAdProviderAdapter = {
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

  assert.equal(result.decision, 'NO_FILL');
  assert.equal(result.fallbackAction, 'FAIL_OPEN');
});

test('AdDecisionEngine waterfalls to secondary provider when primary no-fills', async () => {
  const engine = new AdDecisionEngine({ tokenSecret: TEST_SECRET });

  const failingPrimary: IAdProviderAdapter = {
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

  const backupAdapter = new VastAdProviderAdapter('backup-vast', 'Backup VAST Network');

  engine.registerProvider(failingPrimary, 1, true);
  engine.registerProvider(backupAdapter, 2, true, {
    vastTagUrl: 'https://backup.example/vast',
  });

  const result = await engine.decide({
    placement: 'PRE_ROLL',
    videoId: 'vid-fallback-test',
  });

  assert.equal(result.decision, 'SERVE');
  assert.equal(result.provider, 'Backup VAST Network');
  assert.ok(result.trackingToken);
});

class MockRedisClient implements IRedisClientLike {
  private sets = new Map<string, Set<string>>();
  private ttls = new Map<string, number>();

  async eval(_script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    const sessionKey = String(args[0]);
    const eventType = String(args[1]);
    const ttlSeconds = Number(args[2]);

    let set = this.sets.get(sessionKey);
    if (!set) {
      set = new Set<string>();
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

  async sismember(key: string, member: string): Promise<number> {
    const set = this.sets.get(key);
    return set && set.has(member) ? 1 : 0;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.sets.delete(key)) count++;
      this.ttls.delete(key);
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace('*', '');
    return Array.from(this.sets.keys()).filter((k) => k.startsWith(prefix));
  }
}

test('RedisAdTelemetryNonceStore consumes events atomically and prevents replay', async () => {
  const mockRedis = new MockRedisClient();
  const store = new RedisAdTelemetryNonceStore(mockRedis);
  const sessionId = 'test-session-distributed-1';
  const expiresAt = Date.now() + 60000;

  // First request consumes AD_IMPRESSION
  const first = await store.consumeEvent(sessionId, 'AD_IMPRESSION', expiresAt);
  assert.equal(first.success, true);

  // Second duplicate request is rejected atomically
  const second = await store.consumeEvent(sessionId, 'AD_IMPRESSION', expiresAt);
  assert.equal(second.success, false);
  assert.equal(second.reason, 'DUPLICATE_EVENT');
  assert.equal(second.isDuplicateImpression, true);

  // sismember check confirms recorded
  const isRecorded = await store.isEventConsumed(sessionId, 'AD_IMPRESSION');
  assert.equal(isRecorded, true);
});

test('RedisAdTelemetryNonceStore enforces lifecycle state conflict protection', async () => {
  const mockRedis = new MockRedisClient();
  const store = new RedisAdTelemetryNonceStore(mockRedis);
  const sessionId = 'test-session-conflict-1';
  const expiresAt = Date.now() + 60000;

  // First record AD_SKIPPED
  const skippedResult = await store.consumeEvent(sessionId, 'AD_SKIPPED', expiresAt);
  assert.equal(skippedResult.success, true);

  // Now attempt to record AD_COMPLETED on skipped session
  const completedResult = await store.consumeEvent(sessionId, 'AD_COMPLETED', expiresAt);
  assert.equal(completedResult.success, false);
  assert.equal(completedResult.reason, 'CONFLICTING_LIFECYCLE_STATE');
});

test('RedisAdTelemetryNonceStore handles multi-instance concurrent requests atomically', async () => {
  const sharedRedis = new MockRedisClient();
  // Simulate 3 distinct API server instances connecting to the same Redis cluster
  const instanceA = new RedisAdTelemetryNonceStore(sharedRedis);
  const instanceB = new RedisAdTelemetryNonceStore(sharedRedis);
  const instanceC = new RedisAdTelemetryNonceStore(sharedRedis);

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
  assert.equal(successes.length, 1);
  assert.equal(duplicates.length, 2);
});

test('RedisAdTelemetryNonceStore rejects expired sessions immediately', async () => {
  const mockRedis = new MockRedisClient();
  const store = new RedisAdTelemetryNonceStore(mockRedis);
  const sessionId = 'expired-session-1';
  const expiredTimestamp = Date.now() - 5000;

  const result = await store.consumeEvent(sessionId, 'AD_IMPRESSION', expiredTimestamp);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'SESSION_EXPIRED');
});
