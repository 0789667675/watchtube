import { useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { getApiErrorMessage } from '../../api/apiClient';
import { useAuth } from '../../auth/useAuth';
import { ChannelAvatar } from './ChannelAvatar';
import { SignInLink } from './SignInLink';

export function AccountControls() {
  const { state, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState('');

  const signOut = async () => {
    setError('');
    setIsSigningOut(true);
    try {
      navigate('/', { replace: true });
      await logout();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Sign out could not be completed. Please retry.'));
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
      {state.status === 'authenticated' ? (
        <>
          <Link
            to="/profile"
            aria-label={`Open ${state.user.email} profile`}
            title={state.user.email}
            className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <ChannelAvatar channel={state.user.channels.find((channel) => channel.avatarUrl)} />
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={isSigningOut}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <LogOut aria-hidden="true" className="h-5 w-5" />
          </button>
        </>
      ) : state.status === 'unauthenticated' ? (
        <SignInLink
          aria-label="Sign in"
          className="flex min-h-11 items-center gap-2 rounded-control bg-surface-subtle px-3 text-sm font-medium text-text-primary transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Sign in
        </SignInLink>
      ) : state.status === 'loading' ? (
        <span role="status" className="sr-only">Restoring account session…</span>
      ) : (
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Retry account verification"
          title={state.message}
          className="flex h-11 items-center gap-2 rounded-control px-3 text-sm text-text-muted hover:bg-surface-hover"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Retry
        </button>
      )}
      {error && <span role="alert" className="max-w-40 truncate text-xs text-status-warning" title={error}>{error}</span>}
    </div>
  );
}
