import React, { useState, useEffect } from 'react';
import { Search, Upload, User, Video, Menu, Bell } from 'lucide-react';
import { ApertureLogo } from '../brand/ApertureLogo';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../theme/ThemeToggle';

export const Header: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
        if (searchTerm) {
            console.log('Searching for:', searchTerm);
        }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border-light dark:border-border-dark bg-canvas-light/80 dark:bg-canvas-obsidian/80 backdrop-blur">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">

        <div className="flex items-center gap-4">
            <button className="rounded-full p-2 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                <Menu className="w-6 h-6" />
            </button>
            <Link to="/">
                <ApertureLogo />
            </Link>
        </div>

        <div className="hidden md:flex flex-1 max-w-xl mx-4">
          <div className="relative w-full">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-control border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark px-4 py-2 pl-10 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-focus"
            />
            <Search className="absolute left-3 top-2.5 h-5 w-5 text-text-muted" />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle />

          <Link to="/feed/subscriptions" className="hidden rounded-full p-2 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:block" title="Subscriptions">
             <Video className="w-5 h-5" />
          </Link>

          <button className="hidden rounded-full p-2 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:block">
            <Bell className="w-5 h-5" />
          </button>

          <Link to="/studio" className="hidden items-center gap-2 rounded-control bg-brand-action px-4 py-2 font-medium text-brand-foreground transition hover:bg-brand-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:flex">
            <Upload className="h-4 w-4" /> Create
          </Link>

          <Link to="/auth/login" aria-label="Sign in" className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-subtle text-text-muted transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <User className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </header>
  );
};
