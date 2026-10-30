import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { LayoutDashboard, Video, BarChart2, Settings, Upload } from 'lucide-react';
import { ApertureLogo } from '../../components/brand/ApertureLogo';

export const StudioLayout: React.FC = () => {
  return (
    <div className="flex h-screen bg-canvas-light dark:bg-canvas-obsidian text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border-light dark:border-border-dark flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border-light dark:border-border-dark">
          <Link to="/studio"><ApertureLogo /></Link>
        </div>

        <div className="flex flex-col items-center py-6 border-b border-border-light dark:border-border-dark">
          <div className="w-20 h-20 rounded-full bg-gray-300 dark:bg-gray-700 mb-3" />
          <h3 className="font-bold">Your Channel</h3>
          <p className="text-sm text-gray-500">@yourhandle</p>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <Link to="/studio" className="flex items-center gap-3 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-brand-light dark:text-brand-dark font-medium">
            <LayoutDashboard className="w-5 h-5" /> Dashboard
          </Link>
          <Link to="/studio/content" className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition">
            <Video className="w-5 h-5" /> Content
          </Link>
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-not-allowed opacity-50">
            <BarChart2 className="w-5 h-5" /> Analytics
          </div>
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-not-allowed opacity-50">
            <Settings className="w-5 h-5" /> Settings
          </div>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border-light dark:border-border-dark flex items-center justify-end px-6">
          <button className="flex items-center gap-2 bg-brand-light dark:bg-brand-dark text-white font-bold px-4 py-2 rounded-full hover:opacity-90 transition">
            <Upload className="w-4 h-4" /> Create
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 bg-surface-light dark:bg-surface-dark">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
