import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStudioAnalytics, isStudioMonetizationStatus } from '../src/pages/studio/studioApi.js';
test('Studio analytics accepts recorded date-range metrics and an empty range', () => {
    assert.equal(isStudioAnalytics({
        period: { from: '2026-03-01', to: '2026-03-31' },
        subscriberCount: 0,
        totalViews: 0,
        totalWatchHours: 0,
        recentPerformance: [],
    }), true);
});
test('Studio analytics rejects malformed periods and fabricated negative metrics', () => {
    assert.equal(isStudioAnalytics({
        period: { from: 'not-a-date', to: '2026-03-31' },
        subscriberCount: 0,
        totalViews: 0,
        totalWatchHours: 0,
        recentPerformance: [],
    }), false);
    assert.equal(isStudioAnalytics({
        period: { from: '2026-03-01', to: '2026-03-31' },
        subscriberCount: 0,
        totalViews: -1,
        totalWatchHours: 0,
        recentPerformance: [],
    }), false);
});
test('monetization status exposes manual review without eligibility thresholds', () => {
    assert.equal(isStudioMonetizationStatus({
        channelId: '11111111-1111-4111-8111-111111111111',
        channelName: 'Creator',
        channelHandle: '@creator',
        isMonetized: false,
        applicationStatus: 'NOT_APPLIED',
        canApply: true,
        reviewerNotes: null,
        reviewedAt: null,
    }), true);
    assert.equal(isStudioMonetizationStatus({
        channelId: '11111111-1111-4111-8111-111111111111',
        channelName: 'Creator',
        channelHandle: '@creator',
        isMonetized: false,
        applicationStatus: 'REJECTED',
        canApply: true,
        reviewerNotes: 'Correct the application.',
        reviewedAt: '2026-03-31T12:00:00.000Z',
    }), true);
});
