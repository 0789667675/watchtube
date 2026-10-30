import React, { useState, useEffect } from 'react';
import { Search, Moon, Sun, Upload, User, Video, Menu, Bell } from 'lucide-react';
import { ApertureLogo } from '../brand/ApertureLogo';
import { Link } from 'react-router-dom';

export const Header: React.FC = () => {
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('theme') === 'dark' ||
      (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

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
            <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full">
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
              className="w-full rounded-full border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark px-4 py-2 pl-10 focus:outline-none focus:ring-1 focus:ring-brand-light dark:focus:ring-brand-dark"
            />
            <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={() => setIsDark(!isDark)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 hidden sm:block">
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          <Link to="/feed/subscriptions" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full hidden sm:block" title="Subscriptions">
             <Video className="w-5 h-5" />
          </Link>

          <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full hidden sm:block">
            <Bell className="w-5 h-5" />
          </button>

          <Link to="/studio" className="hidden sm:flex items-center gap-2 bg-brand-light dark:bg-brand-dark text-white px-4 py-2 rounded-full font-medium hover:opacity-90">
            <Upload className="h-4 w-4" /> Create
          </Link>

          <Link to="/auth/login" className="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
            <User className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </Link>
        </div>
      </div>
    </header>
  );
};
