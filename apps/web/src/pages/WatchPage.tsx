import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { CheckCircle2, Copy } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import { formatPublishedDate, formatViewCount, type ViewerVideo } from '../components/video/videoTypes';

interface ViewerComment {
  id: string;
  content: string;
  createdAt: string;
  user?: { channels?: { name: string; handle: string; avatarUrl?: string | null }[] };
}

interface CommentsResponse {
  comments: ViewerComment[];
  nextCursor?: string;
}

type SubscriptionState = 'loading' | 'subscribed' | 'not-subscribed' | 'signed-out' | 'unavailable';

interface VideoResult {
  id: string;
  video?: ViewerVideo;
  error?: string;
}

interface CommentsResult {
  key: string;
  comments: ViewerComment[];
  nextCursor?: string;
  error: string | null;
}

interface RelatedResult {
  id: string;
  videos: ViewerVideo[];
  error: string | null;
}

interface SubscriptionResult {
  channelId: string;
  state: SubscriptionState;
}

export function WatchPage() {
  const { id = '' } = useParams();
  const [videoResult, setVideoResult] = useState<VideoResult>();
  const videoResultIsCurrent = videoResult?.id === id;
  const video = videoResultIsCurrent ? videoResult.video ?? null : null;
  const videoError = videoResultIsCurrent ? videoResult.error ?? null : null;
  const isLoadingVideo = !videoResultIsCurrent;
  const channelId = video?.channel.id;
  const [subscriptionResult, setSubscriptionResult] = useState<SubscriptionResult>();
  const subscriptionState = channelId && subscriptionResult?.channelId === channelId
    ? subscriptionResult.state
    : 'loading';
  const [isUpdatingSubscription, setIsUpdatingSubscription] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [commentsResult, setCommentsResult] = useState<CommentsResult>();
  const [commentText, setCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentStatus, setCommentStatus] = useState<string | null>(null);
  const [commentRefresh, setCommentRefresh] = useState(0);
  const [isLoadingMoreComments, setIsLoadingMoreComments] = useState(false);
  const [commentLoadError, setCommentLoadError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const commentsKey = `${id}:${commentRefresh}`;
  const commentsAreCurrent = commentsResult?.key === commentsKey;
  const comments = commentsAreCurrent ? commentsResult.comments : [];
  const commentsNextCursor = commentsAreCurrent ? commentsResult.nextCursor : undefined;
  const commentsError = commentsAreCurrent ? commentsResult.error : null;
  const commentsLoading = !commentsAreCurrent;
  const [relatedResult, setRelatedResult] = useState<RelatedResult>();
  const relatedResultIsCurrent = relatedResult?.id === id;
  const relatedVideos = relatedResultIsCurrent ? relatedResult.videos : [];
  const relatedError = relatedResultIsCurrent ? relatedResult.error : null;
  const isLoadingRelated = !relatedResultIsCurrent;

  useEffect(() => {
    setCommentText('');
    setCommentError(null);
    setCommentStatus(null);
    setCommentLoadError(null);
    setSubscriptionError(null);
    setShareStatus(null);
    setCommentRefresh(0);
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();

    apiClient.get<ViewerVideo>(`/api/v1/videos/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(({ data }) => setVideoResult({ id, video: data }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setVideoResult({ id, error: getApiErrorMessage(requestError, 'This video is unavailable.') });
        }
      });

    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${id}:${commentRefresh}`;
    apiClient.get<CommentsResponse>(`/api/v1/videos/${encodeURIComponent(id)}/comments`, { signal: controller.signal })
      .then(({ data }) => setCommentsResult({
        key,
        comments: data.comments,
        nextCursor: data.nextCursor,
        error: null,
      }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setCommentsResult({
            key,
            comments: [],
            nextCursor: undefined,
            error: getApiErrorMessage(requestError, 'Comments could not be loaded.'),
          });
        }
      });
    return () => controller.abort();
  }, [id, commentRefresh]);

  useEffect(() => {
    if (!channelId) return;
    const controller = new AbortController();
    const currentChannelId = channelId;
    apiClient.get<{ isSubscribed: boolean }>(
      `/api/v1/channels/${currentChannelId}/subscription-status`,
      { signal: controller.signal },
    )
      .then(({ data }) => setSubscriptionResult({
        channelId: currentChannelId,
        state: data.isSubscribed ? 'subscribed' : 'not-subscribed',
      }))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          setSubscriptionResult({ channelId: currentChannelId, state: 'signed-out' });
        } else {
          setSubscriptionResult({ channelId: currentChannelId, state: 'unavailable' });
        }
      });
    return () => controller.abort();
  }, [channelId]);

  useEffect(() => {
    const controller = new AbortController();
    apiClient.get<ViewerVideo[]>('/api/v1/videos', {
      params: { limit: 8 },
      signal: controller.signal,
    })
      .then(({ data }) => setRelatedResult({
        id,
        videos: data.filter((item) => item.id !== id),
        error: null,
      }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setRelatedResult({
            id,
            videos: [],
            error: getApiErrorMessage(requestError, 'Related videos could not be loaded.'),
          });
        }
      });
    return () => controller.abort();
  }, [id]);

  const toggleSubscription = async () => {
    if (
      !video?.channel.id ||
      (subscriptionState !== 'subscribed' && subscriptionState !== 'not-subscribed')
    ) return;
    setIsUpdatingSubscription(true);
    setSubscriptionError(null);
    try {
      const { data } = await apiClient.post<{ isSubscribed: boolean }>(
        `/api/v1/channels/${video.channel.id}/subscribe`,
      );
      setSubscriptionResult({
        channelId: video.channel.id,
        state: data.isSubscribed ? 'subscribed' : 'not-subscribed',
      });
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setSubscriptionResult({ channelId: video.channel.id, state: 'signed-out' });
      } else {
        setSubscriptionError(getApiErrorMessage(requestError, 'Your subscription could not be updated.'));
      }
    } finally {
      setIsUpdatingSubscription(false);
    }
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = commentText.trim();
    if (!content || isPostingComment) return;
    setCommentError(null);
    setCommentStatus(null);
    setIsPostingComment(true);
    try {
      await apiClient.post(`/api/v1/videos/${encodeURIComponent(id)}/comments`, { content });
      setCommentText('');
      setCommentStatus('Comment posted.');
      setCommentRefresh((value) => value + 1);
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setCommentError('Sign in to post a comment.');
      } else {
        setCommentError(getApiErrorMessage(requestError, 'Your comment could not be posted.'));
      }
    } finally {
      setIsPostingComment(false);
    }
  };

  const copyVideoLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus('Link copied.');
    } catch {
      setShareStatus('Unable to copy the link in this browser.');
    }
  };

  const loadMoreComments = async () => {
    if (!commentsNextCursor || isLoadingMoreComments) return;
    setIsLoadingMoreComments(true);
    setCommentLoadError(null);
    try {
      const { data } = await apiClient.get<CommentsResponse>(
        `/api/v1/videos/${encodeURIComponent(id)}/comments`,
        { params: { cursor: commentsNextCursor } },
      );
      setCommentsResult((current) => {
        if (current?.key !== commentsKey) return current;
        const existingIds = new Set(current.comments.map((comment) => comment.id));
        return {
          ...current,
          comments: [
            ...current.comments,
            ...data.comments.filter((comment) => !existingIds.has(comment.id)),
          ],
          nextCursor: data.nextCursor,
          error: null,
        };
      });
    } catch (requestError) {
      setCommentLoadError(getApiErrorMessage(requestError, 'More comments could not be loaded.'));
    } finally {
      setIsLoadingMoreComments(false);
    }
  };

  const playlistUrl = video?.variants?.find((variant) => Boolean(variant.playlistUrl))?.playlistUrl;

  if (isLoadingVideo) return <LoadingState label="Loading video…" />;
  if (videoError || !video) return <div className="px-4 py-8"><ErrorState message={videoError ?? 'This video is unavailable.'} /></div>;

  return (
    <div className="mx-auto grid max-w-[1700px] grid-cols-1 gap-8 px-0 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-7">
      <div className="min-w-0">
        <div className="overflow-hidden rounded-none bg-black sm:rounded-card">
          {playlistUrl ? (
            <VideoPlayer src={playlistUrl} />
          ) : (
            <div role="status" className="flex aspect-video items-center justify-center px-6 text-center text-sm text-white/75">
              Playback is unavailable for this video right now.
            </div>
          )}
        </div>

        <section className="px-4 pt-4 sm:px-0">
          <h1 className="text-xl font-bold leading-snug sm:text-2xl">{video.title}</h1>
          <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Link to={`/channel/${encodeURIComponent(video.channel.handle)}`} className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-surface-subtle">
                {video.channel.avatarUrl ? (
                  <img src={video.channel.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center font-semibold text-text-muted">
                    {video.channel.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </Link>
              <div className="min-w-0">
                <Link to={`/channel/${encodeURIComponent(video.channel.handle)}`} className="inline-flex max-w-full items-center gap-1 font-semibold hover:text-brand-dark">
                  <span className="truncate">{video.channel.name}</span>
                  {video.channel.isVerified && <CheckCircle2 aria-label="Verified channel" className="h-4 w-4 shrink-0 text-brand-dark" />}
                </Link>
                <p className="text-sm text-text-muted">{video.channel.handle}</p>
              </div>
              {subscriptionState === 'signed-out' ? (
                <Link to="/auth/login" className="ml-1 shrink-0 rounded-full bg-brand-action px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-action-hover">
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
                  className={`ml-1 shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    subscriptionState === 'subscribed'
                      ? 'bg-surface-subtle text-text-primary hover:bg-surface-hover'
                      : 'bg-brand-action text-brand-foreground hover:bg-brand-action-hover'
                  }`}
                >
                  {isUpdatingSubscription ? 'Updating…' : subscriptionState === 'subscribed' ? 'Subscribed' : 'Subscribe'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-surface-subtle px-4 py-2 text-sm text-text-muted">
                {formatViewCount(video.viewsCount)}
              </span>
              <button
                type="button"
                onClick={copyVideoLink}
                className="inline-flex items-center gap-2 rounded-full bg-surface-subtle px-4 py-2 text-sm font-medium hover:bg-surface-hover"
              >
                <Copy className="h-4 w-4" /> Share
              </button>
            </div>
          </div>
          {subscriptionError && <p role="alert" className="mt-3 text-sm text-status-warning">{subscriptionError}</p>}
          {subscriptionState === 'unavailable' && (
            <p role="status" className="mt-3 text-sm text-text-muted">Subscription status is unavailable right now.</p>
          )}
          {shareStatus && <p role="status" className="mt-2 text-sm text-text-muted">{shareStatus}</p>}

          <div className="mt-4 rounded-card bg-surface-subtle p-4">
            <p className="mb-2 text-sm font-semibold">
              {formatViewCount(video.viewsCount)}
              {formatPublishedDate(video.publishedAt, video.createdAt) && <> · {formatPublishedDate(video.publishedAt, video.createdAt)}</>}
            </p>
            <p className="whitespace-pre-wrap text-sm">{video.description || 'No description provided.'}</p>
          </div>
        </section>

        <section className="px-4 py-8 sm:px-0">
          <h2 className="mb-5 text-xl font-bold">Comments</h2>
          <form onSubmit={submitComment} className="mb-7">
            <label htmlFor="comment" className="sr-only">Add a comment</label>
            <textarea
              id="comment"
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Add a comment…"
              className="w-full resize-y border-b border-divider bg-transparent py-2 text-sm focus:border-focus focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-4">
              <p className="text-xs text-text-muted">{commentText.length}/1000</p>
              <button
                type="submit"
                disabled={!commentText.trim() || isPostingComment}
                className="rounded-full bg-brand-action px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-action-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPostingComment ? 'Posting…' : 'Comment'}
              </button>
            </div>
            {commentError && (
              <p role="alert" className="mt-2 text-sm text-status-warning">
                {commentError === 'Sign in to post a comment.' ? (
                  <><Link to="/auth/login" className="font-semibold underline">Sign in</Link> to post a comment.</>
                ) : commentError}
              </p>
            )}
            {commentStatus && <p role="status" className="mt-2 text-sm text-text-muted">{commentStatus}</p>}
          </form>

          {commentsLoading ? (
            <LoadingState label="Loading comments…" />
          ) : commentsError ? (
            <ErrorState message={commentsError} />
          ) : comments.length === 0 ? (
            <EmptyState title="No comments yet" message="Be the first to join the conversation." />
          ) : (
            <div className="space-y-6">
              {comments.map((comment) => {
                const commentChannel = comment.user?.channels?.[0];
                return (
                  <article key={comment.id} className="flex gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-subtle">
                      {commentChannel?.avatarUrl && (
                        <img src={commentChannel.avatarUrl} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {commentChannel?.handle ?? 'Member'}
                        <time className="ml-2 font-normal text-text-muted">
                          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(comment.createdAt))}
                        </time>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{comment.content}</p>
                    </div>
                  </article>
                );
              })}
              {commentsNextCursor && (
                <div className="text-center">
                  <button
                    type="button"
                    disabled={isLoadingMoreComments}
                    onClick={loadMoreComments}
                    className="rounded-full bg-surface-subtle px-4 py-2 text-sm font-semibold hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoadingMoreComments ? 'Loading…' : 'Load more comments'}
                  </button>
                  {commentLoadError && <p role="alert" className="mt-2 text-sm text-status-warning">{commentLoadError}</p>}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <aside className="px-4 pb-8 sm:px-0 lg:pt-1">
        <h2 className="mb-4 text-lg font-bold">Up next</h2>
        {isLoadingRelated ? (
          <LoadingState label="Loading related videos…" />
        ) : relatedError ? (
          <p role="status" className="text-sm text-text-muted">{relatedError}</p>
        ) : relatedVideos.length === 0 ? (
          <p className="text-sm text-text-muted">No related videos are available.</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1">
            {relatedVideos.map((relatedVideo) => (
              <VideoCard key={relatedVideo.id} video={relatedVideo} />
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
