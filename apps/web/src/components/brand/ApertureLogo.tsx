import React from 'react';
import { useTheme } from '../theme/useTheme';

export const ApertureLogo: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`flex items-center ${className || ''}`}>
    <ThemedWordmark />
  </div>
);

function ThemedWordmark() {
  const { theme } = useTheme();

  return (
    <img
      src={`/brand/watchtube-wordmark-${theme}.png`}
      alt="WatchTube: Watch, Create, Share"
      className="h-8 w-auto sm:h-10"
    />
  );
}
