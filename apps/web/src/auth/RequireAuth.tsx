import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, refresh } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas-light p-6 text-text-muted dark:bg-canvas-obsidian">
        <p role="status">Restoring your WatchTube session…</p>
      </main>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas-light p-6 dark:bg-canvas-obsidian">
        <section role="alert" className="w-full max-w-md rounded-card border border-border bg-surface-light p-6 text-center dark:bg-surface-dark">
          <h1 className="text-xl font-bold">Account verification is unavailable</h1>
          <p className="mt-2 text-sm text-text-muted">{state.message}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-5 rounded-control bg-brand-action px-5 py-2.5 font-semibold text-brand-foreground hover:bg-brand-action-hover"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (state.status === 'unauthenticated') {
    return (
      <Navigate
        to="/auth/login"
        replace
        state={{
          from: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
        }}
      />
    );
  }

  return children;
}
