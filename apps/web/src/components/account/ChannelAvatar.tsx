import { useState } from 'react';
import { UserRound } from 'lucide-react';
import type { AuthChannel } from '../../auth/authTypes';

interface ChannelAvatarProps {
  channel?: Pick<AuthChannel, 'name' | 'avatarUrl'>;
  size?: 'small' | 'large';
}

function safeAvatarUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function ChannelAvatar({ channel, size = 'small' }: ChannelAvatarProps) {
  const avatarUrl = safeAvatarUrl(channel?.avatarUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const dimensions = size === 'large' ? 'h-20 w-20 text-2xl' : 'h-10 w-10 text-base';

  if (avatarUrl && failedUrl !== avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        onError={() => setFailedUrl(avatarUrl)}
        className={`${dimensions} shrink-0 rounded-full bg-surface-subtle object-cover`}
      />
    );
  }

  return (
    <span className={`${dimensions} flex shrink-0 items-center justify-center rounded-full bg-surface-subtle font-semibold text-text-muted`}>
      {channel?.name ? channel.name.slice(0, 1).toUpperCase() : <UserRound aria-hidden="true" className="h-5 w-5" />}
    </span>
  );
}
