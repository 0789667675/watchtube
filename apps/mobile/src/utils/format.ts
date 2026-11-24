export function formatDuration(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const totalSeconds = Math.floor(seconds);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const remainingSeconds = totalSeconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${totalMinutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function formatViewCount(count: number): string {
  return `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'view' : 'views'}`;
}

export function formatChannelHandle(handle?: string | null): string {
  const trimmed = handle?.trim() ?? '';
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export function formatFileSize(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
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
