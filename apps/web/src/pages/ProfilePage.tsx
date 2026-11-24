import { Link } from 'react-router-dom';
import { ChannelAvatar } from '../components/account/ChannelAvatar';
import { LoadingState } from '../components/video/ViewerState';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { state } = useAuth();

  if (state.status !== 'authenticated') {
    return <LoadingState label="Loading your profile…" />;
  }

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="rounded-card border border-border bg-surface-light p-6 dark:bg-surface-dark sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">Account profile</p>
        <h1 className="mt-2 break-all text-2xl font-bold tracking-tight">{state.user.email}</h1>
        <p className="mt-2 text-sm text-text-muted">Signed in to WatchTube as this account.</p>
      </header>

      <section className="mt-8" aria-labelledby="profile-channels-heading">
        <h2 id="profile-channels-heading" className="mb-4 text-xl font-bold">Your channels</h2>
        {state.user.channels.length > 0 ? (
          <ul className="space-y-3">
            {state.user.channels.map((channel) => (
              <li key={channel.id}>
                <Link
                  to={`/channel/${encodeURIComponent(channel.handle)}`}
                  className="flex items-center gap-4 rounded-card border border-border bg-surface-light p-4 transition hover:bg-surface-hover dark:bg-surface-dark"
                >
                  <ChannelAvatar channel={channel} size="large" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{channel.name}</span>
                    <span className="mt-1 block truncate text-sm text-text-muted">{channel.handle}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-card border border-border bg-surface-light p-6 text-center dark:bg-surface-dark">
            <p className="font-semibold">No creator channels yet</p>
            <p className="mt-1 text-sm text-text-muted">Create a channel in Studio to start publishing.</p>
            <Link to="/studio" className="mt-4 inline-flex rounded-control bg-brand-action px-5 py-2.5 font-semibold text-brand-foreground hover:bg-brand-action-hover">
              Open Creator Studio
            </Link>
          </div>
        )}
      </section>
    </section>
  );
}
