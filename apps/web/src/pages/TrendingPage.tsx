import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerVideo } from '../components/video/videoTypes';

interface TrendingResponse {
  videos: ViewerVideo[];
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

interface TrendingContentProps {
  page: number;
  videos: ViewerVideo[];
  hasMore: boolean;
  error: string | null;
  isLoading: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

export function TrendingContent({
  page,
  videos,
  hasMore,
  error,
  isLoading,
  onRetry,
  onPageChange,
}: TrendingContentProps) {
  return (
    <section className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Trending</h1>
        <p className="mt-1 text-text-muted">Public videos ranked by valid views, likes, and comments from the past seven days.</p>
      </header>

      {isLoading ? (
        <LoadingState label="Loading trending videos…" layout="grid" />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : videos.length === 0 ? (
        <div className="space-y-4">
          <EmptyState title="Nothing trending yet" message="No public videos have recorded valid views, likes, or comments in the past seven days." />
          {page > 1 && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                className="min-h-11 rounded-control border border-border px-4 py-2 text-sm font-semibold"
              >
                Previous page
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {videos.map((video, index) => (
              <div key={video.id} className="relative">
                <span className="absolute -left-2 -top-2 z-10 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs font-bold text-brand-dark">
                  #{(page - 1) * 12 + index + 1}
                </span>
                <VideoCard video={video} />
              </div>
            ))}
          </div>
          <nav aria-label="Trending pages" className="flex items-center justify-center gap-3">
            {page > 1 && (
              <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                className="min-h-11 rounded-control border border-border px-4 py-2 text-sm font-semibold"
              >
                Previous
              </button>
            )}
            <span className="text-sm text-text-muted">Page {page}</span>
            {hasMore && (
              <button
                type="button"
                onClick={() => onPageChange(page + 1)}
                className="min-h-11 rounded-control border border-border px-4 py-2 text-sm font-semibold"
              >
                Next
              </button>
            )}
          </nav>
        </div>
      )}
    </section>
  );
}

export function TrendingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 1000 ? parsedPage : 1;
  const [requestNumber, setRequestNumber] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    videos: ViewerVideo[];
    hasMore: boolean;
    error: string | null;
  }>();
  const requestKey = `${page}:${requestNumber}`;
  const resultIsCurrent = result?.key === requestKey;
  const videos = resultIsCurrent ? result.videos : [];
  const hasMore = resultIsCurrent && result.hasMore;
  const error = resultIsCurrent ? result.error : null;
  const isLoading = !resultIsCurrent;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${page}:${requestNumber}`;
    apiClient.get<TrendingResponse>('/api/v1/feed/trending', {
      params: { page },
      signal: controller.signal,
    })
      .then(({ data }) => setResult({
        key,
        videos: data.videos,
        hasMore: data.pagination.hasMore,
        error: null,
      }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            key,
            videos: [],
            hasMore: false,
            error: getApiErrorMessage(requestError, 'Please try again in a moment.'),
          });
        }
      });
    return () => controller.abort();
  }, [page, requestNumber]);

  const goToPage = (nextPage: number) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage === 1) next.delete('page');
      else next.set('page', String(nextPage));
      return next;
    });
  };

  return (
    <TrendingContent
      page={page}
      videos={videos}
      hasMore={hasMore}
      error={error}
      isLoading={isLoading}
      onRetry={() => setRequestNumber((number) => number + 1)}
      onPageChange={goToPage}
    />
  );
}
