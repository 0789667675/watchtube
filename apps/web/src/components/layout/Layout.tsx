import React from 'react';
import { Header } from './Header';
import { Outlet } from 'react-router-dom';

export const Layout: React.FC = () => {
  return (
    <div className="min-h-screen bg-canvas-light dark:bg-canvas-obsidian text-slate-900 dark:text-slate-100">
      <Header />
      <main className="mx-auto">
        <Outlet />
      </main>
    </div>
  );
};
