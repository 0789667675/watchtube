import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { LayoutDashboard, Video, BarChart2, Settings, Upload } from 'lucide-react';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';

export const StudioLayout: React.FC = () => {
  return (
    <div className="flex h-screen overflow-hidden bg-canvas-light text-text-primary dark:bg-canvas-obsidian">
      {/* Sidebar */}
      <div className="w-64 border-r border-border-light dark:border-border-dark flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border-light dark:border-border-dark">
          <Link to="/studio"><ApertureLogo /></Link>
        </div>

        <div className="flex flex-col items-center py-6 border-b border-border-light dark:border-border-dark">
          <div className="mb-3 h-20 w-20 rounded-full bg-surface-subtle" />
          <h3 className="font-bold">Your Channel</h3>
          <p className="text-sm text-text-muted">@yourhandle</p>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <Link to="/studio" aria-current="page" className="flex items-center gap-3 rounded-control bg-surface-subtle px-4 py-2 font-medium text-brand-light dark:text-brand-dark">
            <LayoutDashboard className="w-5 h-5" /> Dashboard
          </Link>
          <Link to="/studio/content" className="flex items-center gap-3 rounded-control px-4 py-2 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <Video className="w-5 h-5" /> Content
          </Link>
          <div className="flex cursor-not-allowed items-center gap-3 rounded-control px-4 py-2 opacity-50 transition hover:bg-surface-hover">
            <BarChart2 className="w-5 h-5" /> Analytics
          </div>
          <div className="flex cursor-not-allowed items-center gap-3 rounded-control px-4 py-2 opacity-50 transition hover:bg-surface-hover">
            <Settings className="w-5 h-5" /> Settings
          </div>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border-light dark:border-border-dark flex items-center justify-end gap-4 px-6">
          <ThemeToggle />
          <button className="flex items-center gap-2 rounded-control bg-brand-action px-4 py-2 font-bold text-brand-foreground transition hover:bg-brand-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <Upload className="w-4 h-4" /> Create
          </button>
        </header>

        <main className="flex-1 overflow-y-auto bg-canvas-light p-6 dark:bg-canvas-obsidian">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
