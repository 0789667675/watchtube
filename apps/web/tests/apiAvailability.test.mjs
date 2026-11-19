import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { test } from 'node:test';

test('API errors distinguish unavailable services from route failures', async () => {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const { getApiErrorMessage } = await vite.ssrLoadModule('/src/api/apiClient.ts');

    assert.match(
      getApiErrorMessage({ isAxiosError: true, response: { status: 502, data: 'proxy error' } }, 'fallback'),
      /WatchTube API could not be reached/,
    );
    assert.match(
      getApiErrorMessage({ isAxiosError: true, code: 'ERR_NETWORK' }, 'fallback'),
      /WatchTube API could not be reached/,
    );
    assert.equal(
      getApiErrorMessage({
        isAxiosError: true,
        response: { status: 503, data: { error: 'Authentication is temporarily unavailable' } },
      }, 'fallback'),
      'Authentication is temporarily unavailable',
    );
    assert.equal(
      getApiErrorMessage({ isAxiosError: true, response: { status: 500, data: {} } }, 'fallback'),
      'fallback',
    );
  } finally {
    await vite.close();
  }
});
