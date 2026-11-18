import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, Upload, User } from 'lucide-react';
import { ApertureLogo } from '../brand/ApertureLogo';
import { ThemeToggle } from '../theme/ThemeToggle';

interface HeaderProps {
  onMenuClick: () => void;
  isMenuOpen: boolean;
}

export function Header({ onMenuClick, isMenuOpen }: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const locationKey = `${location.pathname}${location.search}`;
  const queryFromUrl = new URLSearchParams(location.search).get('q') ?? '';
  const [searchTerm, setSearchTerm] = useState({ locationKey, value: queryFromUrl });
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const currentSearchTerm = searchTerm.locationKey === locationKey ? searchTerm.value : queryFromUrl;

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = currentSearchTerm.trim();
    if (!query) return;
    navigate(`/search?q=${encodeURIComponent(query)}`);
    setMobileSearchOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-canvas-light/95 backdrop-blur dark:bg-canvas-obsidian/95">
      <div className="flex h-16 items-center gap-3 px-3 sm:px-5">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={isMenuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={isMenuOpen}
          className="rounded-full p-2 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to="/" aria-label="WatchTube home" className="shrink-0">
          <ApertureLogo />
        </Link>

        <form onSubmit={submitSearch} role="search" className="mx-auto hidden w-full max-w-2xl md:flex">
          <label htmlFor="desktop-search" className="sr-only">Search videos and channels</label>
          <div className="relative w-full">
            <input
              id="desktop-search"
              type="search"
              value={currentSearchTerm}
              onChange={(event) => setSearchTerm({ locationKey, value: event.target.value })}
              placeholder="Search videos and channels"
              className="w-full rounded-full border border-border bg-surface-light py-2 pl-4 pr-12 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-focus dark:bg-surface-dark"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute inset-y-0 right-0 flex items-center rounded-r-full px-4 text-text-muted transition hover:text-brand-dark"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
          <button
            type="button"
            onClick={() => setMobileSearchOpen((open) => !open)}
            aria-label={mobileSearchOpen ? 'Close search' : 'Open search'}
            aria-expanded={mobileSearchOpen}
            className="rounded-full p-2 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:hidden"
          >
            <Search className="h-5 w-5" />
          </button>
          <ThemeToggle />
          <Link
            to="/studio"
            className="hidden items-center gap-2 rounded-control bg-brand-action px-4 py-2 font-medium text-brand-foreground transition hover:bg-brand-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:flex"
          >
            <Upload className="h-4 w-4" /> Create
          </Link>
          <Link
            to="/auth/login"
            aria-label="Sign in"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-subtle text-text-muted transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <User className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {mobileSearchOpen && (
        <form onSubmit={submitSearch} role="search" className="border-t border-border p-3 md:hidden">
          <label htmlFor="mobile-search" className="sr-only">Search videos and channels</label>
          <div className="relative">
            <input
              id="mobile-search"
              type="search"
              autoFocus
              value={currentSearchTerm}
              onChange={(event) => setSearchTerm({ locationKey, value: event.target.value })}
              placeholder="Search videos and channels"
              className="w-full rounded-full border border-border bg-surface-light py-2 pl-4 pr-12 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-focus dark:bg-surface-dark"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute inset-y-0 right-0 flex items-center rounded-r-full px-4 text-text-muted transition hover:text-brand-dark"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>
        </form>
      )}
    </header>
  );
}
