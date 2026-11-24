import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

const watchPageUrl = new URL('../src/pages/WatchPage.tsx', import.meta.url);
const videoPlayerUrl = new URL('../src/components/player/VideoPlayer.tsx', import.meta.url);
const shortsPageUrl = new URL('../src/pages/ShortsPage.tsx', import.meta.url);

test('WatchPage implements comment replies, optimistic reactions with rollback, and report modals', async () => {
  const source = await readFile(watchPageUrl, 'utf8');

  // Comment replies API contract
  assert.match(source, /\/api\/v1\/comments\/\$\{encodeURIComponent\(commentId\)\}\/replies/);
  assert.match(source, /parentId:\s*commentId/);
  assert.match(source, /_count:\s*\{\s*replies/);
  assert.match(source, /repliesState/);
  assert.match(source, /toggleReplies/);
  assert.match(source, /submitReply/);
  assert.match(source, /View \$\{totalReplyCount\}/);

  // Optimistic like toggle with rollback
  assert.match(source, /previousState\s*=\s*likeState/);
  assert.match(source, /setLikeState\(targetState\)/);
  assert.match(source, /setLikeState\(previousState\)/);

  // Live subscriber count update on toggle
  assert.match(source, /subscriberCount:\s*Math\.max\(0,\s*currentCount\s*\+\s*\(data\.isSubscribed\s*\?\s*1\s*:\s*-1\)\)/);

  // Reporting for video and comments
  assert.match(source, /ReportModal/);
  assert.match(source, /type:\s*'VIDEO'/);
  assert.match(source, /type:\s*'COMMENT'/);

  // VideoPlayer receives videoId and viewerSessionId for advertising resilience
  assert.match(source, /videoId=\{video\.id\}/);
  assert.match(source, /viewerSessionId=\{playbackSessionRef\.current\}/);
});

test('VideoPlayer implements advertising resilience with fail-open behavior and telemetry', async () => {
  const source = await readFile(videoPlayerUrl, 'utf8');

  // Pre-roll decision endpoint
  assert.match(source, /\/api\/v1\/monetization\/decision/);
  assert.match(source, /placement:\s*'PRE_ROLL'/);

  // Fail-open timeout
  assert.match(source, /setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?setAdState\(null\)[\s\S]*?\},\s*2000\)/);

  // Fail-open on catch or NO_FILL
  assert.match(source, /\.catch\(\(\)\s*=>\s*\{[\s\S]*?setAdState\(null\)[\s\S]*?\}\)/);

  // Telemetry events
  assert.match(source, /\/api\/v1\/monetization\/event/);
  assert.match(source, /eventType:\s*'IMPRESSION'/);
  assert.match(source, /eventType:\s*'COMPLETE'/);
  assert.match(source, /eventType:\s*'SKIP'/);
  assert.match(source, /eventType:\s*'ERROR'/);

  // Fail open on ad element error
  assert.match(source, /onError=\{failOpenAd\}/);
  assert.match(source, /Skip Ad/);
});

test('ShortsPage enforces vertical 9:16 presentation, duration <= 180s, and reliable navigation', async () => {
  const source = await readFile(shortsPageUrl, 'utf8');

  // Duration limit <= 180s
  assert.match(source, /MAX_SHORT_DURATION_SECONDS\s*=\s*180/);
  assert.match(source, /duration\s*<=\s*MAX_SHORT_DURATION_SECONDS/);

  // Vertical 9:16 presentation
  assert.match(source, /aspect-\[9\/16\]/);

  // Navigation and controls
  assert.match(source, /Previous short/);
  assert.match(source, /Next short/);
  assert.match(source, /Browse grid/);
  assert.match(source, /Watch feed/);

  // Reporting and comments
  assert.match(source, /ReportModal/);
  assert.match(source, /targetType="VIDEO"/);
  assert.match(source, /submitShortComment/);
});

test('ShortsContent renders vertical 9:16 presentation, duration limit, and filters ineligible videos', async () => {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const { ShortsContent, MAX_SHORT_DURATION_SECONDS } = await vite.ssrLoadModule('/src/pages/ShortsPage.tsx');
    assert.equal(MAX_SHORT_DURATION_SECONDS, 180);

    const testVideos = [
      {
        id: 'short-1',
        title: 'Valid Portrait Short',
        duration: 45,
        viewsCount: 150,
        createdAt: '2026-11-20T10:00:00.000Z',
        channel: { name: 'Creator One', handle: 'creator1', isVerified: true },
      },
      {
        id: 'long-video',
        title: 'Over 3 Minutes Long Video',
        duration: 240, // Exceeds 180 seconds - must be filtered out!
        viewsCount: 300,
        createdAt: '2026-11-20T10:00:00.000Z',
        channel: { name: 'Creator Two', handle: 'creator2', isVerified: false },
      },
    ];

    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/feed/shorts'] },
      createElement(ShortsContent, {
        page: 1,
        videos: testVideos,
        hasMore: false,
        error: null,
        isLoading: false,
        onRetry() {},
        onPageChange() {},
      }),
    ));

    // Valid short must be present
    assert.match(markup, /Valid Portrait Short/);
    assert.match(markup, /aspect-\[9\/16\]/);
    assert.match(markup, /0:45/);

    // Over-length video (>180s) must NOT be present
    assert.doesNotMatch(markup, /Over 3 Minutes Long Video/);
  } finally {
    await vite.close();
  }
});
