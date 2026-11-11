import React from 'react';
import { Home, TrendingUp, Video, MonitorPlay } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export const BottomNav: React.FC = () => {
  const location = useLocation();

  const isActive = (path: string) => {
      if (path === '/' && location.pathname !== '/') return false;
      return location.pathname.startsWith(path);
  };

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-light dark:bg-surface-dark border-t border-border-light dark:border-border-dark flex justify-around items-center h-16 pb-safe">
        <Link to="/" aria-current={isActive('/') ? 'page' : undefined} className={`flex h-full w-full flex-col items-center justify-center gap-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-focus ${isActive('/') ? 'text-brand-light dark:text-brand-dark' : 'text-text-muted hover:text-text-primary'}`}>
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-medium">Home</span>
        </Link>
        <Link to="/feed/trending" aria-current={isActive('/feed/trending') ? 'page' : undefined} className={`flex h-full w-full flex-col items-center justify-center gap-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-focus ${isActive('/feed/trending') ? 'text-brand-light dark:text-brand-dark' : 'text-text-muted hover:text-text-primary'}`}>
            <TrendingUp className="w-5 h-5" />
            <span className="text-[10px] font-medium">Trending</span>
        </Link>
        <Link to="/feed/subscriptions" aria-current={isActive('/feed/subscriptions') ? 'page' : undefined} className={`flex h-full w-full flex-col items-center justify-center gap-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-focus ${isActive('/feed/subscriptions') ? 'text-brand-light dark:text-brand-dark' : 'text-text-muted hover:text-text-primary'}`}>
            <Video className="w-5 h-5" />
            <span className="text-[10px] font-medium">Subscriptions</span>
        </Link>
        <Link to="/studio" aria-current={isActive('/studio') ? 'page' : undefined} className={`flex h-full w-full flex-col items-center justify-center gap-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-focus ${isActive('/studio') ? 'text-brand-light dark:text-brand-dark' : 'text-text-muted hover:text-text-primary'}`}>
            <MonitorPlay className="w-5 h-5" />
            <span className="text-[10px] font-medium">Library</span>
        </Link>
    </nav>
  );
};
