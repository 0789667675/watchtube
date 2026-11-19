import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerVideo } from '../components/video/videoTypes';

interface SearchChannel {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  isVerified: boolean;
  subscriberCount: number;
}

interface SearchResult {
  key: string;
  videos: ViewerVideo[];
  channels: SearchChannel[];
  hasMoreVideos: boolean;
  hasMoreChannels: boolean;
  error: string | null;
}

interface SearchResponse {
  videos: ViewerVideo[];
  channels: SearchChannel[];
  pagination: {
    page: number;
    limit: number;
    hasMoreVideos: boolean;
    hasMoreChannels: boolean;
  };
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q')?.trim() ?? '';
  const parsedPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 1000 ? parsedPage : 1;
  const [result, setResult] = useState<SearchResult>({
    key: '',
    videos: [],
    channels: [],
    hasMoreVideos: false,
    hasMoreChannels: false,
    error: null,
  });
  const [requestNumber, setRequestNumber] = useState(0);

  useEffect(() => {
    if (!query) return;

    const controller = new AbortController();
    const key = `${query}:${page}:${requestNumber}`;

    apiClient.get<SearchResponse>('/api/v1/feed/search', {
      params: { q: query, page },
      signal: controller.signal,
    })
      .then(({ data }) => setResult({
        key,
        videos: data.videos,
        channels: data.channels,
        hasMoreVideos: data.pagination.hasMoreVideos,
        hasMoreChannels: data.pagination.hasMoreChannels,
        error: null,
      }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            key,
            videos: [],
            channels: [],
            hasMoreVideos: false,
            hasMoreChannels: false,
            error: getApiErrorMessage(requestError, 'Please try your search again.'),
          });
        }
      });

    return () => controller.abort();
  }, [page, query, requestNumber]);

  const requestKey = `${query}:${page}:${requestNumber}`;
  const resultIsCurrent = result.key === requestKey;
  const videos = resultIsCurrent ? result.videos : [];
  const channels = resultIsCurrent ? result.channels : [];
  const error = resultIsCurrent ? result.error : null;
  const hasMore = resultIsCurrent && (result.hasMoreVideos || result.hasMoreChannels);
  const isLoading = Boolean(query) && !resultIsCurrent;

  const goToPage = (nextPage: number) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage === 1) next.delete('page');
      else next.set('page', String(nextPage));
      return next;
    });
  };

  return (
    <section className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">
        {query ? <>Search results for <span className="break-words">“{query}”</span></> : 'Search videos and channels'}
      </h1>
      {!query ? (
        <EmptyState title="Enter a search term" message="Use the search field above to find videos and channels." />
      ) : isLoading ? (
        <LoadingState label="Searching videos and channels…" layout="grid" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRequestNumber((number) => number + 1)} />
      ) : videos.length === 0 && channels.length === 0 ? (
        <div className="space-y-4">
          <EmptyState title="No results found" message={`There are no public videos or channels matching “${query}”.`} />
          {page > 1 && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                className="min-h-11 rounded-control border border-border px-4 py-2 text-sm font-semibold"
              >
                Previous page
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-10">
          <section aria-labelledby="search-channels-heading">
            <h2 id="search-channels-heading" className="mb-4 text-xl font-semibold">Channels and creators</h2>
            {channels.length === 0 ? (
              <p className="text-sm text-text-muted">No matching channels or creators on this page.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {channels.map((channel) => (
                  <Link
                    key={channel.id}
                    to={`/channel/${encodeURIComponent(channel.handle)}`}
                    className="flex min-h-24 min-w-0 items-center gap-4 rounded-card border border-border bg-surface-light p-4 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:bg-surface-dark"
                  >
                    {channel.avatarUrl ? (
                      <img src={channel.avatarUrl} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" loading="lazy" />
                    ) : (
                      <span aria-hidden="true" className="h-14 w-14 shrink-0 rounded-full bg-surface-subtle" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {channel.name}{channel.isVerified && <span className="sr-only">, verified</span>}
                      </span>
                      <span className="block truncate text-sm text-text-muted">@{channel.handle}</span>
                      <span className="block text-xs text-text-muted">
                        {new Intl.NumberFormat().format(channel.subscriberCount)} subscribers
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="search-videos-heading">
            <h2 id="search-videos-heading" className="mb-4 text-xl font-semibold">Videos</h2>
            {videos.length === 0 ? (
              <p className="text-sm text-text-muted">No matching public videos on this page.</p>
            ) : (
              <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {videos.map((video) => <VideoCard key={video.id} video={video} />)}
              </div>
            )}
          </section>

          <nav aria-label="Search result pages" className="flex items-center justify-center gap-3">
            {page > 1 && (
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                className="min-h-11 rounded-control border border-border px-4 py-2 text-sm font-semibold"
              >
                Previous
              </button>
            )}
            <span className="text-sm text-text-muted">Page {page}</span>
            {hasMore && (
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
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
