export interface ViewerChannel {
  id?: string;
  name: string;
  handle: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  description?: string | null;
  subscriberCount?: number;
  isVerified: boolean;
}

export interface ViewerVideo {
  id: string;
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  duration?: number | null;
  viewsCount: number;
  createdAt: string;
  publishedAt?: string | null;
  channel: ViewerChannel;
  variants?: { playlistUrl: string; resolution: string }[];
}

export function formatDuration(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);

  return hours > 0
    ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function formatViewCount(count: number): string {
  return `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'view' : 'views'}`;
}

export function formatPublishedDate(publishedAt?: string | null, createdAt?: string): string | null {
  const value = publishedAt || createdAt;
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days < 1) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}
