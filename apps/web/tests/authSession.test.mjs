import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

async function withVite(run) {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    await run(vite);
  } finally {
    await vite.close();
  }
}

test('current-user responses require a valid identity and channel profile', async () => {
  await withVite(async (vite) => {
    const { isAuthUser } = await vite.ssrLoadModule('/src/auth/authTypes.ts');
    const user = {
      id: 'user-1',
      email: 'creator@example.test',
      role: 'CREATOR',
      status: 'GOOD_STANDING',
      channels: [{
        id: 'channel-1',
        name: 'Creator',
        handle: 'creator',
        avatarUrl: 'https://cdn.example.test/avatar.webp',
        bannerUrl: null,
        description: null,
      }],
    };

    assert.equal(isAuthUser(user), true);
    assert.equal(
      isAuthUser({
        ...user,
        role: 'ADMIN',
        positionNumber: 1,
        assignment: 'Trust and Safety',
        permissions: ['trust.review'],
      }),
      true,
    );
    assert.equal(
      isAuthUser({
        ...user,
        role: 'VIEWER',
        positionNumber: null,
        assignment: null,
        permissions: [],
      }),
      true,
    );
    assert.equal(isAuthUser({ ...user, channels: [{ id: 'channel-1' }] }), false);
    assert.equal(isAuthUser({ ...user, role: 'UNKNOWN' }), false);
  });
});

test('API requests keep cookie credentials and notify shared auth on non-login 401 responses', async () => {
  await withVite(async (vite) => {
    const { apiClient, subscribeToUnauthorized } = await vite.ssrLoadModule('/src/api/apiClient.ts');
    assert.equal(apiClient.defaults.withCredentials, true);

    let unauthorizedCount = 0;
    const unsubscribe = subscribeToUnauthorized(() => {
      unauthorizedCount += 1;
    });
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => {
      const error = new Error('Unauthorized');
      Object.assign(error, {
        isAxiosError: true,
        config,
        response: { status: 401, data: { error: 'Unauthorized' }, config },
      });
      throw error;
    };

    try {
      await assert.rejects(apiClient.get('/api/v1/feed/subscriptions'));
      assert.equal(unauthorizedCount, 1);
      await assert.rejects(apiClient.post('/api/v1/auth/login', {}));
      assert.equal(unauthorizedCount, 1);
    } finally {
      apiClient.defaults.adapter = previousAdapter;
      unsubscribe();
    }
  });
});
