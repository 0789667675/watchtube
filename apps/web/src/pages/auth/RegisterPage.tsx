import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';

interface RegisterForm {
  email: string;
  password: string;
}

export const RegisterPage: React.FC = () => {
  const { register, handleSubmit } = useForm<RegisterForm>();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (data: RegisterForm) => {
    setError('');
    setIsSubmitting(true);
    try {
      await apiClient.post('/api/v1/auth/register', data);
      navigate('/auth/login', { state: { registered: true } });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Account creation failed. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas-light dark:bg-canvas-obsidian">
      <div className="w-full max-w-md p-8 bg-surface-light dark:bg-surface-dark rounded-xl shadow-lg border border-border-light dark:border-border-dark">
        <div className="relative flex justify-center mb-8">
          <ApertureLogo />
          <div className="absolute right-0 top-0">
            <ThemeToggle />
          </div>
        </div>
        <h2 className="text-2xl font-bold font-display text-center mb-6">Create Account</h2>

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
              {...register('password', { required: true, minLength: 8 })}
              type="password"
              className="w-full rounded-control border border-border-light bg-canvas-light px-4 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus dark:border-border-dark dark:bg-canvas-obsidian"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={isSubmitting} className="w-full rounded-control bg-brand-action py-2 font-bold text-brand-foreground transition hover:bg-brand-action-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {isSubmitting ? 'Creating account…' : 'Sign Up'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-text-muted">
          Already registered? <Link to="/auth/login" className="text-brand-primary">Sign in</Link>
        </p>
      </div>
    </div>
  );
};
