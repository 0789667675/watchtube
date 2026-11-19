import { useState } from 'react';
import { CheckCircle2, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDuration, formatPublishedDate, formatViewCount, type ViewerVideo } from './videoTypes';

interface VideoCardProps {
  video: ViewerVideo;
  layout?: 'grid' | 'horizontal';
}

export function VideoCard({ video, layout = 'grid' }: VideoCardProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const duration = formatDuration(video.duration);
  const publishedDate = formatPublishedDate(video.publishedAt, video.createdAt);
  const channelUrl = `/channel/${encodeURIComponent(video.channel.handle)}`;
  const isHorizontal = layout === 'horizontal';

  return (
    <article className={`group min-w-0 ${isHorizontal ? 'flex gap-3' : ''}`}>
      <Link
        to={`/watch/${video.id}`}
        aria-label={`Watch ${video.title}`}
        className={`block ${isHorizontal ? 'w-[42%] shrink-0' : ''}`}
      >
        <div className="relative aspect-video overflow-hidden rounded-card bg-surface-subtle">
          {video.thumbnailUrl && !thumbnailFailed ? (
            <img
              src={video.thumbnailUrl}
              alt=""
              loading="lazy"
              onError={() => setThumbnailFailed(true)}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-subtle to-surface-raised text-text-muted">
              <Play aria-hidden="true" className="h-9 w-9" />
            </div>
          )}
          {duration && (
            <span className="absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">
              {duration}
            </span>
          )}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/15 group-hover:opacity-100 group-focus-within:opacity-100">
            <Play aria-hidden="true" className="h-8 w-8 drop-shadow" />
          </span>
        </div>
      </Link>

      <div className={`${isHorizontal ? 'min-w-0 flex-1' : 'mt-3 flex gap-3'}`}>
        {!isHorizontal && (
          <Link to={channelUrl} aria-label={`${video.channel.name} channel`} className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-subtle">
            {video.channel.avatarUrl ? (
              <img src={video.channel.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-text-muted">
                {video.channel.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </Link>
        )}
        <div className="min-w-0">
          <Link to={`/watch/${video.id}`} className="block">
            <h2 className={`line-clamp-2 font-semibold leading-snug text-text-primary transition group-hover:text-brand-dark ${isHorizontal ? 'text-sm' : ''}`}>
              {video.title}
            </h2>
          </Link>
          <Link to={channelUrl} className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-sm text-text-muted transition hover:text-text-primary">
            <span className="truncate">{video.channel.name}</span>
            {video.channel.isVerified && <CheckCircle2 aria-label="Verified channel" className="h-3.5 w-3.5 shrink-0 text-brand-dark" />}
          </Link>
          <p className="text-xs text-text-muted sm:text-sm">
            {formatViewCount(video.viewsCount)}
            {publishedDate && <> · {publishedDate}</>}
          </p>
        </div>
      </div>
    </article>
  );
}
