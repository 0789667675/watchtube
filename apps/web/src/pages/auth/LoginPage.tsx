import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';
import { getApiErrorMessage } from '../../api/apiClient';
import { useAuth } from '../../auth/useAuth';

interface LoginForm {
  email: string;
  password: string;
}

export const LoginPage: React.FC = () => {
  const { register, handleSubmit } = useForm<LoginForm>();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, login } = useAuth();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectState = location.state as {
    from?: { pathname?: unknown; search?: unknown; hash?: unknown };
  } | null;
  const requestedPath = redirectState?.from?.pathname;
  const returnTo = typeof requestedPath === 'string'
    && requestedPath.startsWith('/')
    && !requestedPath.startsWith('//')
    && requestedPath !== '/auth/login'
    ? `${requestedPath}${typeof redirectState?.from?.search === 'string' ? redirectState.from.search : ''}${typeof redirectState?.from?.hash === 'string' ? redirectState.from.hash : ''}`
    : '/studio';

  useEffect(() => {
    if (state.status === 'authenticated') {
      navigate(returnTo, { replace: true });
    }
  }, [navigate, returnTo, state.status]);

  const onSubmit = async (data: LoginForm) => {
    setError('');
    setIsSubmitting(true);
    try {
      await login(data);
      navigate(returnTo, { replace: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Sign in failed. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (state.status === 'loading' && !isSubmitting) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas-light p-6 text-text-muted dark:bg-canvas-obsidian">
        <p role="status">Restoring your WatchTube session…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas-light dark:bg-canvas-obsidian">
      <div className="w-full max-w-md p-8 bg-surface-light dark:bg-surface-dark rounded-xl shadow-lg border border-border-light dark:border-border-dark">
        <div className="relative flex justify-center mb-8">
          <ApertureLogo />
          <div className="absolute right-0 top-0">
            <ThemeToggle />
          </div>
        </div>
        <h2 className="text-2xl font-bold font-display text-center mb-6">Welcome Back</h2>
        {state.status === 'unavailable' && <p role="alert" className="mb-4 text-sm text-red-600">{state.message}</p>}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              {...register('email', { required: true })}
              type="email"
              className="w-full rounded-control border border-border-light bg-canvas-light px-4 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus dark:border-border-dark dark:bg-canvas-obsidian"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              {...register('password', { required: true })}
              type="password"
              className="w-full rounded-control border border-border-light bg-canvas-light px-4 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus dark:border-border-dark dark:bg-canvas-obsidian"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={isSubmitting} className="w-full rounded-control bg-brand-action py-2 font-bold text-brand-foreground transition hover:bg-brand-action-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {isSubmitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-text-muted">
          Need an account? <Link to="/auth/register" className="text-brand-primary">Sign up</Link>
        </p>
      </div>
    </div>
  );
};
