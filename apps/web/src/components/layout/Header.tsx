import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, Upload } from 'lucide-react';
import { ApertureLogo } from '../brand/ApertureLogo';
import { ThemeToggle } from '../theme/ThemeToggle';
import { AccountControls } from '../account/AccountControls';

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
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const currentSearchTerm = searchTerm.locationKey === locationKey ? searchTerm.value : queryFromUrl;

  const closeMobileSearch = () => {
    setMobileSearchOpen(false);
    mobileSearchTriggerRef.current?.focus();
  };

  const handleMobileSearchKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobileSearch();
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = currentSearchTerm.trim();
    if (!query) return;
    navigate(`/search?q=${encodeURIComponent(query)}`);
    if (mobileSearchOpen) closeMobileSearch();
  };

  useEffect(() => {
    if (mobileSearchOpen) mobileSearchInputRef.current?.focus();
  }, [mobileSearchOpen]);

  useEffect(() => {
    const desktopSearchBreakpoint = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => {
      if (desktopSearchBreakpoint.matches) setMobileSearchOpen(false);
    };

    desktopSearchBreakpoint.addEventListener('change', closeOnDesktop);
    return () => desktopSearchBreakpoint.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-canvas-light/95 backdrop-blur dark:bg-canvas-obsidian/95">
      <div className="flex h-16 items-center gap-1 px-3 sm:gap-3 sm:px-5">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={isMenuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={isMenuOpen}
          aria-controls="mobile-navigation-dialog"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to="/" aria-label="WatchTube home" className="min-w-0 max-w-[32vw] shrink-0 [&_img]:max-w-full sm:max-w-none">
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
              className="h-11 w-full rounded-full border border-border bg-surface-light pl-4 pr-12 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-focus dark:bg-surface-dark"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute inset-y-0 right-0 flex h-11 min-w-11 items-center justify-center rounded-r-full text-text-muted transition hover:text-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
          <button
            type="button"
            ref={mobileSearchTriggerRef}
            onClick={() => {
              if (mobileSearchOpen) closeMobileSearch();
              else setMobileSearchOpen(true);
            }}
            aria-label={mobileSearchOpen ? 'Close search' : 'Open search'}
            aria-expanded={mobileSearchOpen}
            aria-controls={mobileSearchOpen ? 'mobile-search-form' : undefined}
            className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:hidden"
          >
            <Search className="h-5 w-5" />
          </button>
          <div className="flex h-11 w-11 items-center justify-center [&>button]:h-11 [&>button]:w-11 [&>button]:p-0">
            <ThemeToggle />
          </div>
          <Link
            to="/studio"
            className="hidden min-h-11 items-center gap-2 rounded-control bg-brand-action px-4 py-2 font-medium text-brand-foreground transition hover:bg-brand-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:flex"
          >
            <Upload className="h-4 w-4" /> Create
          </Link>
          <AccountControls />
        </div>
      </div>

      {mobileSearchOpen && (
        <form
          id="mobile-search-form"
          onSubmit={submitSearch}
          onKeyDown={handleMobileSearchKeyDown}
          role="search"
          className="border-t border-border p-3 md:hidden"
        >
          <label htmlFor="mobile-search" className="sr-only">Search videos and channels</label>
          <div className="relative">
            <input
              id="mobile-search"
              type="search"
              ref={mobileSearchInputRef}
              value={currentSearchTerm}
              onChange={(event) => setSearchTerm({ locationKey, value: event.target.value })}
              placeholder="Search videos and channels"
              className="h-11 w-full rounded-full border border-border bg-surface-light pl-4 pr-12 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-focus dark:bg-surface-dark"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute inset-y-0 right-0 flex h-11 min-w-11 items-center justify-center rounded-r-full text-text-muted transition hover:text-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>
        </form>
      )}
    </header>
  );
}
