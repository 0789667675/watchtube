import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { createServer } from 'vite';

test('viewer loading, error, and empty states expose their intended accessible content', async () => {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const { EmptyState, ErrorState, LoadingState } = await vite.ssrLoadModule(
      '/src/components/video/ViewerState.tsx',
    );
    const loading = renderToStaticMarkup(createElement(LoadingState));
    assert.match(loading, /role="status"/);
    assert.match(loading, /Loading videos…/);

    const error = renderToStaticMarkup(createElement(ErrorState, { message: 'Video unavailable' }));
    assert.match(error, /role="alert"/);
    assert.match(error, /We couldn’t load this page/);
    assert.match(error, /Video unavailable/);

    const retryError = renderToStaticMarkup(createElement(ErrorState, {
      message: 'API unavailable',
      onRetry: () => undefined,
    }));
    assert.match(retryError, /Try again/);

    const empty = renderToStaticMarkup(createElement(EmptyState, {
      title: 'No videos yet',
      message: 'Try again later.',
    }));
    assert.match(empty, /No videos yet/);
    assert.match(empty, /Try again later\./);
  } finally {
    await vite.close();
  }
});
