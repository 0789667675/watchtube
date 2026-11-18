import { useEffect, useState } from 'react';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerVideo } from '../components/video/videoTypes';

export function HomePage() {
  const [videos, setVideos] = useState<ViewerVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    apiClient.get<ViewerVideo[]>('/api/v1/videos', { signal: controller.signal })
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
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Discover something great</h1>
        <p className="mt-1 text-text-muted">Explore the latest videos from WatchTube creators.</p>
      </header>

      {isLoading ? (
        <LoadingState label="Loading videos…" />
      ) : error ? (
        <ErrorState message={error} />
      ) : videos.length === 0 ? (
        <EmptyState title="No videos yet" message="Public videos will appear here when creators publish them." />
      ) : (
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {videos.map((video) => <VideoCard key={video.id} video={video} />)}
        </div>
      )}
    </section>
  );
}
