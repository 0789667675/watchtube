import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerVideo } from '../components/video/videoTypes';

interface SearchResult {
  query: string;
  videos: ViewerVideo[];
  error: string | null;
}

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q')?.trim() ?? '';
  const [result, setResult] = useState<SearchResult>({ query: '', videos: [], error: null });

  useEffect(() => {
    if (!query) return;

    const controller = new AbortController();

    apiClient.get<ViewerVideo[]>('/api/v1/feed/search', {
      params: { q: query },
      signal: controller.signal,
    })
      .then(({ data }) => setResult({ query, videos: data, error: null }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            query,
            videos: [],
            error: getApiErrorMessage(requestError, 'Please try your search again.'),
          });
        }
      });

    return () => controller.abort();
  }, [query]);

  const resultIsCurrent = result.query === query;
  const videos = resultIsCurrent ? result.videos : [];
  const error = resultIsCurrent ? result.error : null;
  const isLoading = Boolean(query) && !resultIsCurrent;

  return (
    <section className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">
        {query ? <>Search results for <span className="break-words">“{query}”</span></> : 'Search videos and channels'}
      </h1>
      {!query ? (
        <EmptyState title="Enter a search term" message="Use the search field above to find videos and channels." />
      ) : isLoading ? (
        <LoadingState label="Searching videos…" />
      ) : error ? (
        <ErrorState message={error} />
      ) : videos.length === 0 ? (
        <EmptyState title="No results found" message={`There are no videos matching “${query}”.`} />
      ) : (
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {videos.map((video) => <VideoCard key={video.id} video={video} />)}
        </div>
      )}
    </section>
  );
}
