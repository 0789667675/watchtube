import { useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerVideo } from '../components/video/videoTypes';

export function TrendingPage() {
  const [videos, setVideos] = useState<ViewerVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiClient.get<ViewerVideo[]>('/api/v1/feed/trending', { signal: controller.signal })
      .then(({ data }) => setVideos(data))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(requestError, 'Please try again in a moment.'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Trending</h1>
        <p className="mt-1 text-text-muted">Videos people are watching now.</p>
      </header>

      {isLoading ? (
        <LoadingState label="Loading trending videos…" />
      ) : error ? (
        <ErrorState message={error} />
      ) : videos.length === 0 ? (
        <EmptyState title="Nothing trending yet" message="Check back when new public videos are available." />
      ) : (
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {videos.map((video, index) => (
            <div key={video.id} className="relative">
              <span className="absolute -left-2 -top-2 z-10 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs font-bold text-brand-dark">
                #{index + 1}
              </span>
              <VideoCard video={video} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
