import { useEffect, useState } from 'react';
import { Search, Sparkles, TrendingUp, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerVideo } from '../components/video/videoTypes';

export function HomePage() {
  const [requestNumber, setRequestNumber] = useState(0);
  const [result, setResult] = useState<{
    requestNumber: number;
    videos: ViewerVideo[];
    error: string | null;
  }>();
  const resultIsCurrent = result?.requestNumber === requestNumber;
  const videos = resultIsCurrent ? result.videos : [];
  const error = resultIsCurrent ? result.error : null;
  const isLoading = !resultIsCurrent;

  useEffect(() => {
    const controller = new AbortController();

    apiClient.get<ViewerVideo[]>('/api/v1/videos', { signal: controller.signal })
      .then(({ data }) => setResult({ requestNumber, videos: data, error: null }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            requestNumber,
            videos: [],
            error: getApiErrorMessage(requestError, 'Please try again in a moment.'),
          });
        }
      });

    return () => controller.abort();
  }, [requestNumber]);

  return (
    <section className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Discover something great</h1>
          <p className="mt-1 text-text-muted">Explore the latest videos from WatchTube creators.</p>
        </div>
        <nav aria-label="Explore WatchTube" className="flex flex-wrap gap-2">
          <Link to="/feed/for-you" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-light px-4 text-sm font-medium transition hover:bg-surface-hover dark:bg-surface-dark">
            <Sparkles aria-hidden="true" className="h-4 w-4" /> For You
          </Link>
          <Link to="/feed/trending" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-light px-4 text-sm font-medium transition hover:bg-surface-hover dark:bg-surface-dark">
            <TrendingUp aria-hidden="true" className="h-4 w-4" /> Trending
          </Link>
          <Link to="/feed/subscriptions" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-light px-4 text-sm font-medium transition hover:bg-surface-hover dark:bg-surface-dark">
            <Video aria-hidden="true" className="h-4 w-4" /> Subscriptions
          </Link>
          <Link to="/search" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-light px-4 text-sm font-medium transition hover:bg-surface-hover dark:bg-surface-dark">
            <Search aria-hidden="true" className="h-4 w-4" /> Search
          </Link>
        </nav>
      </header>

      {isLoading ? (
        <LoadingState label="Loading videos…" layout="grid" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRequestNumber((number) => number + 1)} />
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
