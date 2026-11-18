import { useEffect, useState } from 'react';
import axios from 'axios';
import { CheckCircle2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import type { ViewerChannel, ViewerVideo } from '../components/video/videoTypes';

interface ChannelPageData extends ViewerChannel {
  id: string;
  subscriberCount: number;
  videos: Omit<ViewerVideo, 'channel'>[];
}

type SubscriptionState = 'loading' | 'subscribed' | 'not-subscribed' | 'signed-out' | 'unavailable';

interface ChannelResult {
  handle: string;
  channel?: ChannelPageData;
  error?: string;
}

interface SubscriptionResult {
  channelId: string;
  state: SubscriptionState;
}

function safeChannelImageUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function ChannelPage() {
  const { handle = '' } = useParams();
  const [channelResult, setChannelResult] = useState<ChannelResult>();
  const channelResultIsCurrent = channelResult?.handle === handle;
  const channel = channelResultIsCurrent ? channelResult.channel ?? null : null;
  const isLoading = !channelResultIsCurrent;
  const error = channelResultIsCurrent ? channelResult.error ?? null : null;
  const [subscriptionResult, setSubscriptionResult] = useState<SubscriptionResult>();
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(() => new Set());
  const subscriptionState = channel && subscriptionResult?.channelId === channel.id
    ? subscriptionResult.state
    : 'loading';
  const [isUpdatingSubscription, setIsUpdatingSubscription] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  useEffect(() => {
    setSubscriptionError(null);
  }, [handle]);

  useEffect(() => {
    const controller = new AbortController();

    apiClient.get<ChannelPageData>(`/api/v1/channels/${encodeURIComponent(handle)}`, { signal: controller.signal })
      .then(({ data }) => setChannelResult({ handle, channel: data }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setChannelResult({
            handle,
            error: getApiErrorMessage(requestError, 'This channel could not be loaded.'),
          });
        }
      });

    return () => controller.abort();
  }, [handle]);

  useEffect(() => {
    if (!channel?.id) return;
    const controller = new AbortController();
    const channelId = channel.id;
    apiClient.get<{ isSubscribed: boolean }>(
      `/api/v1/channels/${channelId}/subscription-status`,
      { signal: controller.signal },
    )
      .then(({ data }) => setSubscriptionResult({
        channelId,
        state: data.isSubscribed ? 'subscribed' : 'not-subscribed',
      }))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          setSubscriptionResult({ channelId, state: 'signed-out' });
        } else {
          setSubscriptionResult({ channelId, state: 'unavailable' });
        }
      });
    return () => controller.abort();
  }, [channel?.id]);

  const toggleSubscription = async () => {
    if (
      !channel ||
      (subscriptionState !== 'subscribed' && subscriptionState !== 'not-subscribed')
    ) return;
    setIsUpdatingSubscription(true);
    setSubscriptionError(null);
    try {
      const { data } = await apiClient.post<{ isSubscribed: boolean }>(
        `/api/v1/channels/${channel.id}/subscribe`,
      );
      setSubscriptionResult({
        channelId: channel.id,
        state: data.isSubscribed ? 'subscribed' : 'not-subscribed',
      });
      setChannelResult((current) => current?.handle === handle && current.channel
        ? {
          ...current,
          channel: {
            ...current.channel,
            subscriberCount: Math.max(
              0,
              current.channel.subscriberCount + (data.isSubscribed ? 1 : -1),
            ),
          },
        }
        : current);
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setSubscriptionResult({ channelId: channel.id, state: 'signed-out' });
      } else {
        setSubscriptionError(getApiErrorMessage(requestError, 'Your subscription could not be updated.'));
      }
    } finally {
      setIsUpdatingSubscription(false);
    }
  };

  const channelVideos = channel?.videos.map((video) => ({ ...video, channel })) ?? [];
  const bannerUrl = safeChannelImageUrl(channel?.bannerUrl);
  const avatarUrl = safeChannelImageUrl(channel?.avatarUrl);

  return (
    <section className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      {isLoading ? (
        <LoadingState label="Loading channel…" />
      ) : error || !channel ? (
        <ErrorState message={error ?? 'This channel is unavailable.'} />
      ) : (
        <>
          <header className="overflow-hidden rounded-card border border-border bg-surface-light dark:bg-surface-dark">
            {bannerUrl && !failedImageUrls.has(bannerUrl) && (
              <img
                src={bannerUrl}
                alt=""
                onError={() => setFailedImageUrls((current) => new Set(current).add(bannerUrl))}
                className="h-32 w-full object-cover sm:h-48"
              />
            )}
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-7">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-surface-subtle sm:h-24 sm:w-24">
                {avatarUrl && !failedImageUrls.has(avatarUrl) ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    onError={() => setFailedImageUrls((current) => new Set(current).add(avatarUrl))}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-3xl font-semibold text-text-muted">
                    {channel.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                  {channel.name}
                  {channel.isVerified && <CheckCircle2 aria-label="Verified channel" className="h-5 w-5 shrink-0 text-brand-dark" />}
                </h1>
                <p className="mt-1 text-sm text-text-muted">
                  {channel.handle} · {new Intl.NumberFormat().format(channel.subscriberCount)} subscribers
                </p>
                {channel.description && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm">{channel.description}</p>}
              </div>
              {subscriptionState === 'signed-out' ? (
                <Link to="/auth/login" className="inline-flex shrink-0 justify-center rounded-full bg-brand-action px-5 py-2.5 font-semibold text-brand-foreground hover:bg-brand-action-hover">
                  Sign in to subscribe
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={
                    subscriptionState === 'loading' ||
                    subscriptionState === 'unavailable' ||
                    isUpdatingSubscription
                  }
                  onClick={toggleSubscription}
                  className={`shrink-0 rounded-full px-5 py-2.5 font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                    subscriptionState === 'subscribed'
                      ? 'bg-surface-subtle text-text-primary hover:bg-surface-hover'
                      : 'bg-brand-action text-brand-foreground hover:bg-brand-action-hover'
                  }`}
                >
                  {isUpdatingSubscription ? 'Updating…' : subscriptionState === 'subscribed' ? 'Subscribed' : 'Subscribe'}
                </button>
              )}
            </div>
            {subscriptionError && <p role="alert" className="px-5 pb-4 text-sm text-status-warning sm:px-7">{subscriptionError}</p>}
            {subscriptionState === 'unavailable' && (
              <p role="status" className="px-5 pb-4 text-sm text-text-muted sm:px-7">Subscription status is unavailable right now.</p>
            )}
          </header>

          <section className="mt-8">
            <h2 className="mb-5 text-xl font-bold">Videos</h2>
            {channelVideos.length === 0 ? (
              <EmptyState title="No public videos yet" message="Videos this channel makes public will appear here." />
            ) : (
              <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {channelVideos.map((video) => <VideoCard key={video.id} video={video} />)}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
