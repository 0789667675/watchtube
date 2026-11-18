import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerVideo } from '../components/video/videoTypes';

export function SubscriptionsPage() {
  const [videos, setVideos] = useState<ViewerVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSignedOut, setIsSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiClient.get<ViewerVideo[]>('/api/v1/feed/subscriptions', { signal: controller.signal })
      .then(({ data }) => setVideos(data))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          setIsSignedOut(true);
        } else {
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
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Subscriptions</h1>
        <p className="mt-1 text-text-muted">Recent videos from channels you follow.</p>
      </header>

      {isLoading ? (
        <LoadingState label="Loading subscriptions…" />
      ) : isSignedOut ? (
        <div className="mx-auto max-w-xl py-16 text-center">
          <h2 className="font-semibold">Sign in to see your subscriptions</h2>
          <p className="mt-2 text-sm text-text-muted">Your subscribed channels and their latest videos will appear here.</p>
          <Link to="/auth/login" className="mt-5 inline-flex rounded-control bg-brand-action px-5 py-2.5 font-semibold text-brand-foreground hover:bg-brand-action-hover">
            Sign in
          </Link>
        </div>
      ) : error ? (
        <ErrorState message={error} />
      ) : videos.length === 0 ? (
        <EmptyState title="No videos in your feed yet" message="New public videos from channels you subscribe to will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {videos.map((video) => <VideoCard key={video.id} video={video} />)}
        </div>
      )}
    </section>
  );
}
