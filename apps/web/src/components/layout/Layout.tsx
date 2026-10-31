import React from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Outlet } from 'react-router-dom';

export const Layout: React.FC = () => {
  return (
    <div className="min-h-screen bg-canvas-light dark:bg-canvas-obsidian text-slate-900 dark:text-slate-100">
      <Header />
      <main className="mx-auto pb-16 sm:pb-0">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
};
