import { Home, TrendingUp, Video, Upload } from 'lucide-react';
import { NavLink } from 'react-router-dom';

interface SidebarProps {
  onNavigate?: () => void;
}

const links = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/feed/trending', label: 'Trending', icon: TrendingUp },
  { to: '/feed/subscriptions', label: 'Subscriptions', icon: Video },
];

export function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <nav aria-label="Main navigation" className="h-full w-64 border-r border-border bg-canvas-light p-4 dark:bg-canvas-obsidian">
      <div className="space-y-1">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-4 rounded-control px-4 py-3 text-sm font-medium transition ${
                isActive
                  ? 'bg-surface-subtle text-brand-dark'
                  : 'text-text-primary hover:bg-surface-hover'
              }`
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </div>

      <div className="my-5 border-t border-divider" />
      <p className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Your space</p>
      <NavLink
        to="/studio"
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-4 rounded-control px-4 py-3 text-sm font-medium transition ${
            isActive ? 'bg-surface-subtle text-brand-dark' : 'text-text-primary hover:bg-surface-hover'
          }`
        }
      >
        <Upload className="h-5 w-5 shrink-0" />
        Creator Studio
      </NavLink>
    </nav>
  );
}
