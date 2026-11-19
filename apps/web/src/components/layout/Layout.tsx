import React, { useEffect, useRef, useState } from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export const Layout: React.FC = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = mobileNavDialogRef.current;
    if (!dialog) return;

    if (mobileNavOpen && !dialog.open) dialog.showModal();
    else if (!mobileNavOpen && dialog.open) dialog.close();
  }, [mobileNavOpen]);

  useEffect(() => {
    const desktopBreakpoint = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktopBreakpoint.matches) setMobileNavOpen(false);
    };

    desktopBreakpoint.addEventListener('change', closeOnDesktop);
    return () => desktopBreakpoint.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <div className="min-h-screen min-h-[100dvh] bg-canvas-light text-text-primary dark:bg-canvas-obsidian">
      <Header
        isMenuOpen={mobileNavOpen}
        onMenuClick={() => setMobileNavOpen((open) => !open)}
      />
      <div className="flex min-h-[calc(100dvh-4rem)]">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 lg:block">
          <Sidebar />
        </aside>
        <main className="mobile-nav-clearance min-w-0 flex-1 lg:pb-0">
          <Outlet />
        </main>
      </div>
      <dialog
        ref={mobileNavDialogRef}
        id="mobile-navigation-dialog"
        aria-label="Mobile navigation"
        onCancel={() => setMobileNavOpen(false)}
        onClose={() => setMobileNavOpen(false)}
        className="fixed inset-x-0 bottom-0 top-16 m-0 h-auto max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-text-primary backdrop:bg-transparent"
      >
        <button
          type="button"
          aria-label="Dismiss navigation overlay"
          onClick={() => setMobileNavOpen(false)}
          className="absolute inset-0 h-full w-full bg-black/50"
        />
        {mobileNavOpen && (
          <div className="relative z-10 h-full w-64 max-w-[85vw] shadow-xl">
            <Sidebar onNavigate={() => setMobileNavOpen(false)} autoFocusFirst />
          </div>
        )}
      </dialog>
      <BottomNav />
    </div>
  );
};
