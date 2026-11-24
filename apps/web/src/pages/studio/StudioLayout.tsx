import { useAuth } from '../../auth/useAuth';
import { NavLink, Link, Outlet } from 'react-router-dom';
import {
  CircleDollarSign,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  Video,
} from 'lucide-react';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';
import { AccountControls } from '../../components/account/AccountControls';
import type { StudioOutletContext } from './studioApi';

const navigation = [
  { to: '/studio', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/studio/content', label: 'Content', icon: Video },
  { to: '/studio/monetization', label: 'Monetization', icon: CircleDollarSign },
  { to: '/studio/comments', label: 'Comments', icon: MessageSquareText },
  { to: '/studio/settings', label: 'Settings', icon: Settings },
];

export function StudioLayout() {
  const { state, refresh, addChannel, updateChannel } = useAuth();

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
          <h1 className="text-xl font-bold">Creator Studio is unavailable</h1>
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
      <main className="flex min-h-screen items-center justify-center bg-canvas-light p-6 text-text-muted dark:bg-canvas-obsidian">
        <p role="status">Redirecting to sign in…</p>
      </main>
    );
  }

  const outletContext: StudioOutletContext = {
    profile: { email: state.user.email, channels: state.user.channels },
    addChannel,
    updateChannel,
  };

  return (
    <div className="min-h-screen bg-canvas-light text-text-primary dark:bg-canvas-obsidian lg:flex lg:h-screen lg:overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface-light dark:bg-surface-dark lg:flex">
        <Link to="/" aria-label="WatchTube home" className="flex h-16 shrink-0 items-center border-b border-border px-6">
          <ApertureLogo />
        </Link>
        <div className="border-b border-border px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Creator account</p>
          <p className="mt-2 truncate text-sm font-semibold" title={state.user.email}>{state.user.email}</p>
          <p className="mt-1 text-xs text-text-muted">
            {state.user.channels.length} {state.user.channels.length === 1 ? 'channel' : 'channels'}
          </p>
        </div>
        <nav aria-label="Studio navigation" className="flex-1 space-y-1 overflow-y-auto p-4">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }: { isActive: boolean }) =>
                `flex items-center gap-3 rounded-control px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? 'bg-surface-subtle text-brand-dark'
                    : 'text-text-primary hover:bg-surface-hover'
                }`
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface-light px-4 dark:bg-surface-dark sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" aria-label="WatchTube home" className="lg:hidden">
              <ApertureLogo />
            </Link>
            <span className="hidden text-sm font-semibold text-text-muted lg:inline">Creator Studio</span>
            <span className="text-sm font-semibold lg:hidden">Studio</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <ThemeToggle />
            <AccountControls />
            <Link
              to="/studio/content"
              className="rounded-control bg-brand-action px-3 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-action-hover sm:px-4"
            >
              Upload video
            </Link>
          </div>
        </header>

        <nav aria-label="Mobile Studio navigation" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-light px-2 py-2 dark:bg-surface-dark lg:hidden">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }: { isActive: boolean }) =>
                `flex shrink-0 items-center gap-2 rounded-control px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-surface-subtle text-brand-dark' : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:overflow-y-auto lg:p-8">
          <Outlet context={outletContext} />
        </main>
      </div>
    </div>
  );
}
