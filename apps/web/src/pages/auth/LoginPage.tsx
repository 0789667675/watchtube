import React from 'react';
import { useForm } from 'react-hook-form';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';

export const LoginPage: React.FC = () => {
  const { register, handleSubmit } = useForm();

  const onSubmit = (data: any) => {
    console.log('Login', data);
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
        <h2 className="text-2xl font-bold font-display text-center mb-6">Welcome Back</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              {...register('email')}
              type="email"
              className="w-full rounded-control border border-border-light bg-canvas-light px-4 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus dark:border-border-dark dark:bg-canvas-obsidian"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              {...register('password')}
              type="password"
              className="w-full rounded-control border border-border-light bg-canvas-light px-4 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus dark:border-border-dark dark:bg-canvas-obsidian"
            />
          </div>
          <button type="submit" className="w-full rounded-control bg-brand-action py-2 font-bold text-brand-foreground transition hover:bg-brand-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
};
