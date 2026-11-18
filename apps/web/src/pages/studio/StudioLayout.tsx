import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
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
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import {
  isStudioProfile,
  type StudioChannel,
  type StudioChannelSettings,
  type StudioOutletContext,
  type StudioProfile,
} from './studioApi';

type AccessState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; profile: StudioProfile };

const navigation = [
  { to: '/studio', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/studio/content', label: 'Content', icon: Video },
  { to: '/studio/monetization', label: 'Monetization', icon: CircleDollarSign },
  { to: '/studio/comments', label: 'Comments', icon: MessageSquareText },
  { to: '/studio/settings', label: 'Settings', icon: Settings },
];

export function StudioLayout() {
  const [attempt, setAttempt] = useState(0);
  const [access, setAccess] = useState<AccessState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    apiClient.get<unknown>('/api/v1/auth/me', { signal: controller.signal })
      .then(({ data }) => {
        if (isStudioProfile(data)) {
          setAccess({ status: 'ready', profile: data });
        } else {
          setAccess({ status: 'unavailable', message: 'Your creator profile could not be verified.' });
        }
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          setAccess({ status: 'signed-out' });
        } else {
          setAccess({
            status: 'unavailable',
            message: getApiErrorMessage(requestError, 'Creator access could not be verified.'),
          });
        }
      });
    return () => controller.abort();
  }, [attempt]);

  const addChannel = useCallback((channel: StudioChannel) => {
    setAccess((current) => current.status === 'ready'
      ? {
        ...current,
        profile: {
          ...current.profile,
          channels: current.profile.channels.some((item) => item.id === channel.id)
            ? current.profile.channels
            : [...current.profile.channels, channel],
        },
      }
      : current);
  }, []);

  const updateChannel = useCallback((channel: StudioChannelSettings) => {
    setAccess((current) => current.status === 'ready'
      ? {
        ...current,
        profile: {
          ...current.profile,
          channels: current.profile.channels.map((item) =>
            item.id === channel.id ? { ...item, ...channel } : item),
        },
      }
      : current);
  }, []);

  if (access.status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas-light p-6 text-text-muted dark:bg-canvas-obsidian">
        <p role="status">Verifying creator access…</p>
      </main>
    );
  }

  if (access.status === 'signed-out') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas-light p-6 dark:bg-canvas-obsidian">
        <section className="w-full max-w-md rounded-card border border-border bg-surface-light p-6 text-center dark:bg-surface-dark">
          <h1 className="text-xl font-bold">Sign in to Creator Studio</h1>
          <p className="mt-2 text-sm text-text-muted">Your videos and channel tools require an authenticated account.</p>
          <Link to="/auth/login" className="mt-5 inline-flex rounded-control bg-brand-action px-5 py-2.5 font-semibold text-brand-foreground hover:bg-brand-action-hover">
            Sign in
          </Link>
        </section>
      </main>
    );
  }

  if (access.status === 'unavailable') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas-light p-6 dark:bg-canvas-obsidian">
        <section role="alert" className="w-full max-w-md rounded-card border border-border bg-surface-light p-6 text-center dark:bg-surface-dark">
          <h1 className="text-xl font-bold">Creator Studio is unavailable</h1>
          <p className="mt-2 text-sm text-text-muted">{access.message}</p>
          <button
            type="button"
            onClick={() => {
              setAccess({ status: 'loading' });
              setAttempt((current) => current + 1);
            }}
            className="mt-5 rounded-control bg-brand-action px-5 py-2.5 font-semibold text-brand-foreground hover:bg-brand-action-hover"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  const outletContext: StudioOutletContext = { profile: access.profile, addChannel, updateChannel };

  return (
    <div className="min-h-screen bg-canvas-light text-text-primary dark:bg-canvas-obsidian lg:flex lg:h-screen lg:overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface-light dark:bg-surface-dark lg:flex">
        <Link to="/" aria-label="WatchTube home" className="flex h-16 shrink-0 items-center border-b border-border px-6">
          <ApertureLogo />
        </Link>
        <div className="border-b border-border px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Creator account</p>
          <p className="mt-2 truncate text-sm font-semibold" title={access.profile.email}>{access.profile.email}</p>
          <p className="mt-1 text-xs text-text-muted">
            {access.profile.channels.length} {access.profile.channels.length === 1 ? 'channel' : 'channels'}
          </p>
        </div>
        <nav aria-label="Studio navigation" className="flex-1 space-y-1 overflow-y-auto p-4">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
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
              className={({ isActive }) =>
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
