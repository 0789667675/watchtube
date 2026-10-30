import React from 'react';

export const ApertureLogo: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`flex items-center gap-2 ${className || ''}`}>
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 2L4 8V24L16 30L28 24V8L16 2Z" fill="currentColor" className="text-brand-light dark:text-brand-dark" />
      <circle cx="16" cy="16" r="6" fill="currentColor" className="text-secondary-amber" />
    </svg>
    <span className="font-display font-bold text-xl tracking-tight">WatchTube</span>
  </div>
);
