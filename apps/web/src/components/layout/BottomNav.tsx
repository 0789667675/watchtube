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
        <Link to="/" className={`flex flex-col items-center justify-center w-full h-full gap-1 transition ${isActive('/') ? 'text-brand-light dark:text-brand-dark' : 'text-gray-500'}`}>
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-medium">Home</span>
        </Link>
        <Link to="/feed/trending" className={`flex flex-col items-center justify-center w-full h-full gap-1 transition ${isActive('/feed/trending') ? 'text-brand-light dark:text-brand-dark' : 'text-gray-500'}`}>
            <TrendingUp className="w-5 h-5" />
            <span className="text-[10px] font-medium">Trending</span>
        </Link>
        <Link to="/feed/subscriptions" className={`flex flex-col items-center justify-center w-full h-full gap-1 transition ${isActive('/feed/subscriptions') ? 'text-brand-light dark:text-brand-dark' : 'text-gray-500'}`}>
            <Video className="w-5 h-5" />
            <span className="text-[10px] font-medium">Subscriptions</span>
        </Link>
        <Link to="/studio" className={`flex flex-col items-center justify-center w-full h-full gap-1 transition ${isActive('/studio') ? 'text-brand-light dark:text-brand-dark' : 'text-gray-500'}`}>
            <MonitorPlay className="w-5 h-5" />
            <span className="text-[10px] font-medium">Library</span>
        </Link>
    </nav>
  );
};
