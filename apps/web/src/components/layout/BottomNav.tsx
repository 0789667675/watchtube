import React from 'react';
import { Home, TrendingUp, Video, Upload } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export const BottomNav: React.FC = () => {
  return (
    <nav aria-label="Mobile navigation" className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-around border-t border-border bg-surface-light pb-safe dark:bg-surface-dark lg:hidden">
      {[
        { to: '/', label: 'Home', icon: Home, end: true },
        { to: '/feed/trending', label: 'Trending', icon: TrendingUp },
        { to: '/feed/subscriptions', label: 'Subs', icon: Video },
        { to: '/studio', label: 'Create', icon: Upload },
      ].map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex h-full w-full flex-col items-center justify-center gap-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-focus ${
              isActive ? 'text-brand-dark' : 'text-text-muted hover:text-text-primary'
            }`
          }
        >
          <Icon className="h-5 w-5" />
          <span className="text-[10px] font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
};
