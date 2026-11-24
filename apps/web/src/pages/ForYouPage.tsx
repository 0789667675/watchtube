import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerVideo } from '../components/video/videoTypes';

interface ForYouResponse {
  videos: ViewerVideo[];
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
  };
  strategy: 'personalized' | 'discovery';
}

interface ForYouContentProps {
  page: number;
  videos: ViewerVideo[];
  hasMore: boolean;
  strategy: 'personalized' | 'discovery';
  error: string | null;
  isLoading: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

export function ForYouContent({
  page,
  videos,
  hasMore,
  strategy,
  error,
  isLoading,
  onRetry,
  onPageChange,
}: ForYouContentProps) {
  return (
    <section className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">For You</h1>
        <p className="mt-1 text-text-muted">
          {strategy === 'personalized'
            ? 'Recommendations shaped by your public-video viewing and interactions.'
            : 'Explore eligible public videos. Your viewing and interactions can make recommendations more relevant.'}
        </p>
      </header>

      {isLoading ? (
        <LoadingState label="Loading For You recommendations…" layout="grid" />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : videos.length === 0 ? (
        <div className="space-y-4">
          <EmptyState title="No recommendations yet" message="Public videos will appear here when creators publish them." />
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
            {videos.map((video) => <VideoCard key={video.id} video={video} />)}
          </div>
          <nav aria-label="For You pages" className="flex items-center justify-center gap-3">
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

export function ForYouPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 1000 ? parsedPage : 1;
  const [requestNumber, setRequestNumber] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    videos: ViewerVideo[];
    hasMore: boolean;
    strategy: 'personalized' | 'discovery';
    error: string | null;
  }>();
  const requestKey = `${page}:${requestNumber}`;
  const resultIsCurrent = result?.key === requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${page}:${requestNumber}`;
    apiClient.get<ForYouResponse>('/api/v1/feed/for-you', {
      params: { page },
      signal: controller.signal,
    })
      .then(({ data }) => setResult({
        key,
        videos: data.videos,
        hasMore: data.pagination.hasMore,
        strategy: data.strategy,
        error: null,
      }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            key,
            videos: [],
            hasMore: false,
            strategy: 'discovery',
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
    <ForYouContent
      page={page}
      videos={resultIsCurrent ? result.videos : []}
      hasMore={resultIsCurrent && result.hasMore}
      strategy={resultIsCurrent ? result.strategy : 'discovery'}
      error={resultIsCurrent ? result.error : null}
      isLoading={!resultIsCurrent}
      onRetry={() => setRequestNumber((number) => number + 1)}
      onPageChange={goToPage}
    />
  );
}
