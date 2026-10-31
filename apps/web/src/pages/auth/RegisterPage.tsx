import React from 'react';
import { useForm } from 'react-hook-form';
import { ApertureLogo } from '../../components/brand/ApertureLogo';

export const RegisterPage: React.FC = () => {
  const { register, handleSubmit } = useForm();

  const onSubmit = (data: any) => {
    console.log('Register', data);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas-light dark:bg-canvas-obsidian">
      <div className="w-full max-w-md p-8 bg-surface-light dark:bg-surface-dark rounded-xl shadow-lg border border-border-light dark:border-border-dark">
        <div className="flex justify-center mb-8">
          <ApertureLogo />
        </div>
        <h2 className="text-2xl font-bold font-display text-center mb-6">Create Account</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              {...register('email')}
              type="email"
              className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-2 focus:ring-brand-light dark:focus:ring-brand-dark focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              {...register('password')}
              type="password"
              className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-2 focus:ring-brand-light dark:focus:ring-brand-dark focus:outline-none"
            />
          </div>
          <button type="submit" className="w-full bg-brand-light dark:bg-brand-dark text-white font-bold py-2 rounded-lg hover:opacity-90 transition">
            Sign Up
          </button>
        </form>
      </div>
    </div>
  );
};
