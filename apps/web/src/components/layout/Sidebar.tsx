import { Home, TrendingUp, Video, Upload, Clapperboard, UserRound, Shield, Sparkles } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { ChannelAvatar } from '../account/ChannelAvatar';

interface SidebarProps {
  onNavigate?: () => void;
  autoFocusFirst?: boolean;
}

const links = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/feed/for-you', label: 'For You', icon: Sparkles },
  { to: '/feed/trending', label: 'Trending', icon: TrendingUp },
  { to: '/feed/shorts', label: 'Shorts', icon: Clapperboard },
  { to: '/feed/subscriptions', label: 'Subscriptions', icon: Video },
];

export function Sidebar({ onNavigate, autoFocusFirst = false }: SidebarProps) {
  const { state } = useAuth();

  return (
    <nav aria-label="Main navigation" className="h-full w-64 overflow-y-auto overscroll-contain border-r border-border bg-canvas-light p-4 dark:bg-canvas-obsidian">
      <div className="space-y-1">
        {links.map(({ to, label, icon: Icon, end }, index) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            autoFocus={autoFocusFirst && index === 0}
            className={({ isActive }: { isActive: boolean }) =>
              `flex min-h-11 items-center gap-4 rounded-control px-4 py-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
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
        to="/profile"
        onClick={onNavigate}
        className={({ isActive }: { isActive: boolean }) =>
          `mb-1 flex min-h-11 items-center gap-4 rounded-control px-4 py-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            isActive ? 'bg-surface-subtle text-brand-dark' : 'text-text-primary hover:bg-surface-hover'
          }`
        }
      >
        {state.status === 'authenticated' ? (
          <ChannelAvatar channel={state.user.channels.find((channel) => channel.avatarUrl)} />
        ) : (
          <UserRound className="h-5 w-5 shrink-0" />
        )}
        <span className="min-w-0 truncate">
          {state.status === 'authenticated' ? state.user.email : 'Profile'}
        </span>
      </NavLink>
      <NavLink
        to="/studio"
        onClick={onNavigate}
        className={({ isActive }: { isActive: boolean }) =>
          `flex min-h-11 items-center gap-4 rounded-control px-4 py-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            isActive ? 'bg-surface-subtle text-brand-dark' : 'text-text-primary hover:bg-surface-hover'
          }`
        }
      >
        <Upload className="h-5 w-5 shrink-0" />
        Creator Studio
      </NavLink>
      {state.status === 'authenticated' &&
        (state.user.role === 'ADMIN' || state.user.role === 'SUPER_ADMIN') && (
          <NavLink
            to="/admin"
            onClick={onNavigate}
            className={({ isActive }: { isActive: boolean }) =>
              `mt-1 flex min-h-11 items-center gap-4 rounded-control px-4 py-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                isActive ? 'bg-surface-subtle text-brand-dark' : 'text-text-primary hover:bg-surface-hover'
              }`
            }
          >
            <Shield className="h-5 w-5 shrink-0 text-brand-primary" />
            Admin Portal
          </NavLink>
        )}
    </nav>
  );
}
