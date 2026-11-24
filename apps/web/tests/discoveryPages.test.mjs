import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

test('trending and search discovery pages render loading and empty-query states accessibly', async () => {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const [{ TrendingPage }, { SearchPage }, { ForYouPage }] = await Promise.all([
      vite.ssrLoadModule('/src/pages/TrendingPage.tsx'),
      vite.ssrLoadModule('/src/pages/SearchPage.tsx'),
      vite.ssrLoadModule('/src/pages/ForYouPage.tsx'),
    ]);

    const trending = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/trending'] },
      createElement(TrendingPage),
    ));
    assert.match(trending, /<h1[^>]*>Trending<\/h1>/);
    assert.match(trending, /role="status"/);
    assert.match(trending, /Loading trending videos/);

    const search = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/search'] },
      createElement(SearchPage),
    ));
    assert.match(search, /Search videos and channels/);
    assert.match(search, /Enter a search term/);

    const searching = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/search?q=music&page=2'] },
      createElement(SearchPage),
    ));
    assert.match(searching, /Search results for/);
    assert.match(searching, /Searching videos and channels/);

    const forYou = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/feed/for-you'] },
      createElement(ForYouPage),
    ));
    assert.match(forYou, /<h1[^>]*>For You<\/h1>/);
    assert.match(forYou, /Loading For You recommendations/);
  } finally {
    await vite.close();
  }
});

test('discovery result views render API-error retry and honest empty states', async () => {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const [{ TrendingContent }, { SearchContent }, { ForYouContent }] = await Promise.all([
      vite.ssrLoadModule('/src/pages/TrendingPage.tsx'),
      vite.ssrLoadModule('/src/pages/SearchPage.tsx'),
      vite.ssrLoadModule('/src/pages/ForYouPage.tsx'),
    ]);
    const render = (element) => renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      element,
    ));

    const trendingEmpty = render(createElement(TrendingContent, {
      page: 2,
      videos: [],
      hasMore: false,
      error: null,
      isLoading: false,
      onRetry() {},
      onPageChange() {},
    }));
    assert.match(trendingEmpty, /Nothing trending yet/);
    assert.match(trendingEmpty, /No public videos have recorded valid views, likes, or comments/);
    assert.match(trendingEmpty, /Previous page/);

    const trendingError = render(createElement(TrendingContent, {
      page: 1,
      videos: [],
      hasMore: false,
      error: 'Trending is unavailable.',
      isLoading: false,
      onRetry() {},
      onPageChange() {},
    }));
    assert.match(trendingError, /role="alert"/);
    assert.match(trendingError, /Trending is unavailable/);
    assert.match(trendingError, /Try again/);

    const searchEmpty = render(createElement(SearchContent, {
      query: 'missing',
      page: 2,
      videos: [],
      channels: [],
      hasMore: false,
      error: null,
      isLoading: false,
      onRetry() {},
      onPageChange() {},
    }));
    assert.match(searchEmpty, /No results found/);
    assert.match(searchEmpty, /There are no public videos or channels matching/);
    assert.match(searchEmpty, /Previous page/);

    const searchError = render(createElement(SearchContent, {
      query: 'music',
      page: 1,
      videos: [],
      channels: [],
      hasMore: false,
      error: 'Search is temporarily unavailable.',
      isLoading: false,
      onRetry() {},
      onPageChange() {},
    }));
    assert.match(searchError, /role="alert"/);
    assert.match(searchError, /Search is temporarily unavailable/);
    assert.match(searchError, /Try again/);

    const forYouError = render(createElement(ForYouContent, {
      page: 1,
      videos: [],
      hasMore: false,
      strategy: 'discovery',
      error: 'Recommendations are unavailable.',
      isLoading: false,
      onRetry() {},
      onPageChange() {},
    }));
    assert.match(forYouError, /For You/);
    assert.match(forYouError, /Recommendations are unavailable/);
    assert.match(forYouError, /Try again/);
  } finally {
    await vite.close();
  }
});

test('discovery result views render real result types and page navigation affordances', async () => {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const [{ TrendingContent }, { SearchContent }] = await Promise.all([
      vite.ssrLoadModule('/src/pages/TrendingPage.tsx'),
      vite.ssrLoadModule('/src/pages/SearchPage.tsx'),
    ]);
    const render = (element) => renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      element,
    ));

    const trending = render(createElement(TrendingContent, {
      page: 2,
      videos: [{
        id: 'public-video',
        title: 'Public video',
        viewsCount: 12,
        createdAt: '2026-11-18T12:00:00.000Z',
        publishedAt: '2026-11-18T12:00:00.000Z',
        channel: { name: 'Public channel', handle: 'public-channel', isVerified: false },
      }],
      hasMore: true,
      error: null,
      isLoading: false,
      onRetry() {},
      onPageChange() {},
    }));
    assert.match(trending, /Public video/);
    assert.match(trending, /#13/);
    assert.match(trending, /Page 2/);
    assert.match(trending, /Previous/);
    assert.match(trending, /Next/);

    const search = render(createElement(SearchContent, {
      query: 'music',
      page: 2,
      videos: [],
      channels: [{
        id: 'channel-1',
        name: 'Music creator',
        handle: 'music-creator',
        avatarUrl: null,
        isVerified: true,
        subscriberCount: 7,
      }],
      hasMore: true,
      error: null,
      isLoading: false,
      onRetry() {},
      onPageChange() {},
    }));
    assert.match(search, /Music creator/);
    assert.match(search, /Channels and creators/);
    assert.match(search, /No matching public videos on this page/);
    assert.match(search, /Page 2/);
    assert.match(search, /Previous/);
    assert.match(search, /Next/);
  } finally {
    await vite.close();
  }
});
