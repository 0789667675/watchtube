import React, { useState } from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export const Layout: React.FC = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas-light dark:bg-canvas-obsidian text-text-primary">
      <Header
        isMenuOpen={mobileNavOpen}
        onMenuClick={() => setMobileNavOpen((open) => !open)}
      />
      <div className="flex min-h-[calc(100vh-4rem)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 lg:block">
          <Sidebar />
        </aside>
        <main className="min-w-0 flex-1 pb-16 lg:pb-0">
          <Outlet />
        </main>
      </div>
      {mobileNavOpen && (
        <div className="fixed inset-0 top-16 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Dismiss navigation overlay"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/50"
          />
          <div className="relative h-full w-64 shadow-xl">
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}
      <BottomNav />
    </div>
  );
};
