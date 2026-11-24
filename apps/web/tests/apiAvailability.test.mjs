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
      getApiErrorMessage({ isAxiosError: true, response: { status: 504, data: 'proxy timeout' } }, 'fallback'),
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
      getApiErrorMessage({
        isAxiosError: true,
        response: { status: 401, data: { error: 'Unauthorized' } },
      }, 'fallback'),
      'Unauthorized',
    );
    assert.equal(
      getApiErrorMessage({ isAxiosError: true, response: { status: 500, data: {} } }, 'fallback'),
      'fallback',
    );
    assert.match(
      getApiErrorMessage({
        isAxiosError: true,
        response: { status: 503, data: { code: 'STORAGE_CONFIGURATION', error: 'storage unavailable' } },
      }, 'fallback'),
      /not configured/,
    );
    assert.match(
      getApiErrorMessage({
        isAxiosError: true,
        response: { status: 503, data: { code: 'STORAGE_PERMISSION', error: 'storage unavailable' } },
      }, 'fallback'),
      /rejected the upload/,
    );
    assert.match(
      getApiErrorMessage({
        isAxiosError: true,
        response: { status: 503, data: { code: 'STORAGE_NETWORK', error: 'storage unavailable' } },
      }, 'fallback'),
      /could not be reached/,
    );
    assert.match(
      getApiErrorMessage({
        isAxiosError: true,
        response: { status: 503, data: { code: 'STORAGE_THROTTLED', error: 'storage unavailable' } },
      }, 'fallback'),
      /throttling/,
    );
    assert.match(
      getApiErrorMessage({
        isAxiosError: true,
        response: { status: 403, data: { error: 'Forbidden' } },
      }, 'fallback'),
      /bucket permissions.*CORS/,
    );

    // Plain JavaScript Error objects preserve descriptive errors without masking
    assert.equal(
      getApiErrorMessage(
        new Error('The thumbnail file upload failed. Check network connectivity and retry.'),
        'fallback',
      ),
      'The thumbnail file upload failed. Check network connectivity and retry.',
    );
    assert.equal(
      getApiErrorMessage(
        new Error('Choose a portrait thumbnail close to the 9:16 aspect ratio.'),
        'fallback',
      ),
      'Choose a portrait thumbnail close to the 9:16 aspect ratio.',
    );
    assert.equal(
      getApiErrorMessage(new Error(''), 'fallback'),
      'fallback',
    );
    // Sensitive storage credentials and endpoints are sanitized in error messages
    const sanitizedResult = getApiErrorMessage(
      new Error('Failed PUT to https://acc123.r2.cloudflarestorage.com/raw?X-Amz-Signature=secret123'),
      'fallback',
    );
    assert.doesNotMatch(sanitizedResult, /acc123\.r2\.cloudflarestorage\.com/);
    assert.doesNotMatch(sanitizedResult, /secret123/);
    assert.match(sanitizedResult, /\[storage endpoint\]/);
  } finally {
    await vite.close();
  }
});
