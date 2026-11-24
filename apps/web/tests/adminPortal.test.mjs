import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
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

test('isAuthUser accepts SUPER_ADMIN and ADMIN partner accounts with position metadata', async () => {
  await withVite(async (vite) => {
    const { isAuthUser } = await vite.ssrLoadModule('/src/auth/authTypes.ts');

    const superAdminUser = {
      id: 'super-admin-uuid-1',
      email: 'founder@watchtube.test',
      role: 'SUPER_ADMIN',
      status: 'GOOD_STANDING',
      channels: [],
      permissions: ['*'],
    };

    assert.equal(isAuthUser(superAdminUser), true);

    const partnerAdminUser = {
      id: 'admin-partner-uuid-2',
      email: 'partner1@watchtube.test',
      role: 'ADMIN',
      status: 'GOOD_STANDING',
      positionNumber: 1,
      assignment: 'Creator Support & Onboarding Lead',
      permissions: ['creator_support.view', 'creator_support.manage'],
      channels: [],
    };

    assert.equal(isAuthUser(partnerAdminUser), true);

    const ordinaryUser = {
      id: 'user-uuid-3',
      email: 'viewer@watchtube.test',
      role: 'USER',
      status: 'GOOD_STANDING',
      channels: [],
    };

    assert.equal(isAuthUser(ordinaryUser), true);

    // Invalid role rejected
    assert.equal(isAuthUser({ ...partnerAdminUser, role: 'CHIEF_OPERATING_OFFICER' }), false);
  });
});

test('AcceptInvitationPage renders securely with token validation and setup form', async () => {
  await withVite(async (vite) => {
    const { AcceptInvitationPage } = await vite.ssrLoadModule('/src/pages/auth/AcceptInvitationPage.tsx');
    const { ThemeContext } = await vite.ssrLoadModule('/src/components/theme/ThemeProvider.tsx');

    const html = renderToStaticMarkup(
      createElement(
        ThemeContext.Provider,
        { value: { theme: 'dark', toggleTheme: () => {} } },
        createElement(
          MemoryRouter,
          { initialEntries: ['/auth/accept-invite?token=valid-test-token-123'] },
          createElement(AcceptInvitationPage),
        ),
      ),
    );

    assert.match(html, /Verifying your Admin invitation/);
  });
});

test('AcceptInvitationPage displays error when token parameter is missing', async () => {
  await withVite(async (vite) => {
    const { AcceptInvitationPage } = await vite.ssrLoadModule('/src/pages/auth/AcceptInvitationPage.tsx');
    const { ThemeContext } = await vite.ssrLoadModule('/src/components/theme/ThemeProvider.tsx');

    const html = renderToStaticMarkup(
      createElement(
        ThemeContext.Provider,
        { value: { theme: 'dark', toggleTheme: () => {} } },
        createElement(
          MemoryRouter,
          { initialEntries: ['/auth/accept-invite'] },
          createElement(AcceptInvitationPage),
        ),
      ),
    );

    assert.match(html, /No invitation token was provided/);
    assert.match(html, /Return to WatchTube Home/);
  });
});

test('AdminDashboard renders shared operational queues and creator support hubs', async () => {
  await withVite(async (vite) => {
    const { AdminDashboard } = await vite.ssrLoadModule('/src/pages/admin/AdminDashboard.tsx');
    const { AuthContext } = await vite.ssrLoadModule('/src/auth/authContext.ts');
    const { ThemeContext } = await vite.ssrLoadModule('/src/components/theme/ThemeProvider.tsx');

    const mockAdminContext = {
      state: {
        status: 'authenticated',
        user: {
          id: 'admin-id-1',
          email: 'admin1@watchtube.test',
          role: 'ADMIN',
          status: 'GOOD_STANDING',
          positionNumber: 1,
          assignment: 'Creator Support Lead',
          permissions: ['creator_support.view'],
          channels: [],
        },
      },
      login: async () => {},
      logout: async () => {},
      refresh: async () => {},
      addChannel: () => {},
      updateChannel: () => {},
    };

    const html = renderToStaticMarkup(
      createElement(
        ThemeContext.Provider,
        { value: { theme: 'dark', toggleTheme: () => {} } },
        createElement(
          MemoryRouter,
          { initialEntries: ['/admin'] },
          createElement(
            AuthContext.Provider,
            { value: mockAdminContext },
            createElement(AdminDashboard),
          ),
        ),
      ),
    );

    assert.match(html, /WatchTube Admin Portal/);
    assert.match(html, /ADMIN 1 \(Creator Support Lead\)/);
    assert.match(html, /Creator Support Cases/);
    assert.match(html, /Approvals/);
    assert.match(html, /Creator Financials/);
    assert.match(html, /Moderation Queue/);
    assert.match(html, /Partner Program \(WTPP\)/);
    assert.match(html, /Copyright Disputes/);
    assert.match(html, /Audit Ledger/);

    // Non-super-admins MUST NOT see CEO Overview tab or Admin Positions tab
    assert.doesNotMatch(html, /CEO Overview/);
    assert.doesNotMatch(html, /Admin Positions \(3\)/);
  });
});

test('AdminDashboard renders CEO-only controls when authenticated as SUPER_ADMIN', async () => {
  await withVite(async (vite) => {
    const { AdminDashboard } = await vite.ssrLoadModule('/src/pages/admin/AdminDashboard.tsx');
    const { AuthContext } = await vite.ssrLoadModule('/src/auth/authContext.ts');
    const { ThemeContext } = await vite.ssrLoadModule('/src/components/theme/ThemeProvider.tsx');

    const mockSuperAdminContext = {
      state: {
        status: 'authenticated',
        user: {
          id: 'super-admin-id',
          email: 'founder@watchtube.test',
          role: 'SUPER_ADMIN',
          status: 'GOOD_STANDING',
          channels: [],
          permissions: ['*'],
        },
      },
      login: async () => {},
      logout: async () => {},
      refresh: async () => {},
      addChannel: () => {},
      updateChannel: () => {},
    };

    const html = renderToStaticMarkup(
      createElement(
        ThemeContext.Provider,
        { value: { theme: 'dark', toggleTheme: () => {} } },
        createElement(
          MemoryRouter,
          { initialEntries: ['/admin'] },
          createElement(
            AuthContext.Provider,
            { value: mockSuperAdminContext },
            createElement(AdminDashboard),
          ),
        ),
      ),
    );

    assert.match(html, /WatchTube Admin Portal/);
    assert.match(html, /SUPER_ADMIN \(Owner &amp; CEO\)/);
    assert.match(html, /CEO Overview/);
    assert.match(html, /Admin Positions \(3\)/);
    assert.match(html, /Shorts Monetization Rates/);
  });
});
