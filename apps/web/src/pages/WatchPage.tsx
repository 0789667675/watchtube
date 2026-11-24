import { useEffect, useRef, useState, type FormEvent } from 'react';
import axios from 'axios';
import { CheckCircle2, Copy, Flag, MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { SignInLink } from '../components/account/SignInLink';
import { ReportModal } from '../components/modals/ReportModal';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { VideoCard } from '../components/video/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '../components/video/ViewerState';
import { formatPublishedDate, formatViewCount, type ViewerVideo } from '../components/video/videoTypes';

export interface ViewerReply {
  id: string;
  content: string;
  createdAt: string;
  parentId?: string | null;
  user?: { channels?: { name: string; handle: string; avatarUrl?: string | null }[] };
}

export interface ViewerComment {
  id: string;
  content: string;
  createdAt: string;
  user?: { channels?: { name: string; handle: string; avatarUrl?: string | null }[] };
  _count?: { replies: number };
}

interface CommentsResponse {
  comments: ViewerComment[];
  nextCursor?: string;
}

type SubscriptionState = 'loading' | 'subscribed' | 'not-subscribed' | 'signed-out' | 'unavailable';

interface VideoResult {
  id: string;
  requestNumber: number;
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
  requestNumber: number;
  videos: ViewerVideo[];
  error: string | null;
}

interface SubscriptionResult {
  channelId: string;
  state: SubscriptionState;
}

export function WatchPage() {
  const { id = '' } = useParams();
  const [videoRequestNumber, setVideoRequestNumber] = useState(0);
  const [videoResult, setVideoResult] = useState<VideoResult>();
  const videoResultIsCurrent = videoResult?.id === id
    && videoResult.requestNumber === videoRequestNumber;
  const video = videoResultIsCurrent ? videoResult.video ?? null : null;
  const videoError = videoResultIsCurrent ? videoResult.error ?? null : null;
  const isLoadingVideo = !videoResultIsCurrent;
  const channelId = video?.channel.id ?? (video as { channelId?: string })?.channelId;
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
  const [initialPosition, setInitialPosition] = useState(0);
  const [likeState, setLikeState] = useState<'liked' | 'disliked' | 'none'>('none');
  const [likeError, setLikeError] = useState<string | null>(null);
  const [isUpdatingLike, setIsUpdatingLike] = useState(false);
  const [repliesState, setRepliesState] = useState<Record<string, {
    replies: ViewerReply[];
    isLoading: boolean;
    error: string | null;
    isExpanded: boolean;
  }>>({});
  const [activeReplyCommentId, setActiveReplyCommentId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isPostingReply, setIsPostingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; type: 'VIDEO' | 'COMMENT' } | null>(null);
  const playbackSessionRef = useRef('');
  const playbackRef = useRef({ currentTime: 0, durationWatched: 0, completed: false });
  const commentsKey = `${id}:${commentRefresh}`;
  const commentsAreCurrent = commentsResult?.key === commentsKey;
  const comments = commentsAreCurrent ? commentsResult.comments : [];
  const commentsNextCursor = commentsAreCurrent ? commentsResult.nextCursor : undefined;
  const commentsError = commentsAreCurrent ? commentsResult.error : null;
  const commentsLoading = !commentsAreCurrent;
  const [relatedResult, setRelatedResult] = useState<RelatedResult>();
  const [relatedRequestNumber, setRelatedRequestNumber] = useState(0);
  const relatedResultIsCurrent = relatedResult?.id === id
    && relatedResult.requestNumber === relatedRequestNumber;
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
    setRepliesState({});
    setActiveReplyCommentId(null);
    setReplyText('');
    setReplyError(null);
    setReportTarget(null);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    playbackSessionRef.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    playbackRef.current = { currentTime: 0, durationWatched: 0, completed: false };
    apiClient.get<{ lastPositionSeconds: number; completed: boolean }>(`/api/v1/analytics/history/${encodeURIComponent(id)}`)
      .then(({ data }) => {
        if (!data.completed && Number.isFinite(data.lastPositionSeconds)) {
          setInitialPosition(Math.max(0, data.lastPositionSeconds));
        }
      })
      .catch(() => {
        setInitialPosition(0);
      });
  }, [id]);

  useEffect(() => {
    if (!video) return;
    const controller = new AbortController();
    apiClient.get<{ isLiked: boolean; isDisliked: boolean }>(
      `/api/v1/videos/${encodeURIComponent(video.id)}/like-status`,
      { signal: controller.signal },
    )
      .then(({ data }) => {
        setLikeState(data.isLiked ? 'liked' : data.isDisliked ? 'disliked' : 'none');
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          setLikeState('none');
          return;
        }
        setLikeError(getApiErrorMessage(requestError, 'Your reaction status could not be loaded.'));
      });
    return () => controller.abort();
  }, [video?.id]);

  useEffect(() => {
    const videoId = video?.id;
    if (!videoId) return;
    const interval = window.setInterval(() => {
      const playback = playbackRef.current;
      if (playback.currentTime <= 0) return;
      void apiClient.post('/api/v1/analytics/telemetry', {
        videoId,
        sessionId: playbackSessionRef.current,
        currentPosition: playback.currentTime,
        durationWatched: playback.durationWatched,
        completed: playback.completed,
      }).catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [video?.id]);

  useEffect(() => {
    const controller = new AbortController();

    apiClient.get<ViewerVideo>(`/api/v1/videos/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(({ data }) => setVideoResult({ id, requestNumber: videoRequestNumber, video: data }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setVideoResult({
            id,
            requestNumber: videoRequestNumber,
            error: getApiErrorMessage(requestError, 'This video is unavailable.'),
          });
        }
      });

    return () => controller.abort();
  }, [id, videoRequestNumber]);

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
        requestNumber: relatedRequestNumber,
        videos: data.filter((item) => item.id !== id),
        error: null,
      }))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setRelatedResult({
            id,
            requestNumber: relatedRequestNumber,
            videos: [],
            error: getApiErrorMessage(requestError, 'Related videos could not be loaded.'),
          });
        }
      });
    return () => controller.abort();
  }, [id, relatedRequestNumber]);

  const toggleSubscription = async () => {
    if (
      !channelId ||
      (subscriptionState !== 'subscribed' && subscriptionState !== 'not-subscribed')
    ) return;
    setIsUpdatingSubscription(true);
    setSubscriptionError(null);
    try {
      const { data } = await apiClient.post<{ isSubscribed: boolean }>(
        `/api/v1/channels/${channelId}/subscribe`,
      );
      setSubscriptionResult({
        channelId,
        state: data.isSubscribed ? 'subscribed' : 'not-subscribed',
      });
      setVideoResult((current) => {
        if (current?.id !== id || !current.video) return current;
        const currentCount = current.video.channel.subscriberCount ?? 0;
        return {
          ...current,
          video: {
            ...current.video,
            channel: {
              ...current.video.channel,
              subscriberCount: Math.max(0, currentCount + (data.isSubscribed ? 1 : -1)),
            },
          },
        };
      });
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setSubscriptionResult({ channelId, state: 'signed-out' });
      } else {
        setSubscriptionError(getApiErrorMessage(requestError, 'Your subscription could not be updated.'));
      }
    } finally {
      setIsUpdatingSubscription(false);
    }
  };

  const toggleLike = async (isDislike: boolean) => {
    if (isUpdatingLike) return;
    setLikeError(null);
    setIsUpdatingLike(true);
    const previousState = likeState;
    const targetState: 'liked' | 'disliked' | 'none' =
      !isDislike
        ? likeState === 'liked' ? 'none' : 'liked'
        : likeState === 'disliked' ? 'none' : 'disliked';
    setLikeState(targetState);

    try {
      const { data } = await apiClient.post<{ isLiked: boolean; isDisliked: boolean }>(
        `/api/v1/videos/${encodeURIComponent(id)}/like`,
        { isDislike },
      );
      setLikeState(data.isLiked ? 'liked' : data.isDisliked ? 'disliked' : 'none');
    } catch (requestError) {
      setLikeState(previousState);
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setLikeError('Sign in to like or dislike this video.');
      } else {
        setLikeError(getApiErrorMessage(requestError, 'Your reaction could not be updated.'));
      }
    } finally {
      setIsUpdatingLike(false);
    }
  };

  const loadReplies = async (commentId: string) => {
    setRepliesState((prev) => ({
      ...prev,
      [commentId]: {
        replies: prev[commentId]?.replies ?? [],
        isLoading: true,
        error: null,
        isExpanded: true,
      },
    }));
    try {
      const { data } = await apiClient.get<ViewerReply[]>(
        `/api/v1/comments/${encodeURIComponent(commentId)}/replies`,
      );
      setRepliesState((prev) => ({
        ...prev,
        [commentId]: {
          replies: data,
          isLoading: false,
          error: null,
          isExpanded: true,
        },
      }));
    } catch (err) {
      setRepliesState((prev) => ({
        ...prev,
        [commentId]: {
          replies: prev[commentId]?.replies ?? [],
          isLoading: false,
          error: getApiErrorMessage(err, 'Replies could not be loaded.'),
          isExpanded: true,
        },
      }));
    }
  };

  const toggleReplies = (commentId: string) => {
    const current = repliesState[commentId];
    if (current?.isExpanded) {
      setRepliesState((prev) => ({
        ...prev,
        [commentId]: { ...prev[commentId], isExpanded: false },
      }));
    } else {
      if (!current?.replies || current.replies.length === 0) {
        void loadReplies(commentId);
      } else {
        setRepliesState((prev) => ({
          ...prev,
          [commentId]: { ...prev[commentId], isExpanded: true },
        }));
      }
    }
  };

  const submitReply = async (commentId: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = replyText.trim();
    if (!content || isPostingReply) return;
    setIsPostingReply(true);
    setReplyError(null);
    try {
      const { data: newReply } = await apiClient.post<ViewerReply>(
        `/api/v1/videos/${encodeURIComponent(id)}/comments`,
        { content, parentId: commentId },
      );
      setReplyText('');
      setActiveReplyCommentId(null);
      setRepliesState((prev) => {
        const existing = prev[commentId]?.replies ?? [];
        return {
          ...prev,
          [commentId]: {
            replies: [...existing, newReply],
            isLoading: false,
            error: null,
            isExpanded: true,
          },
        };
      });
      setCommentsResult((current) => {
        if (!current || current.key !== commentsKey) return current;
        return {
          ...current,
          comments: current.comments.map((c) =>
            c.id === commentId
              ? { ...c, _count: { replies: (c._count?.replies ?? 0) + 1 } }
              : c,
          ),
        };
      });
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setReplyError('Sign in to post a reply.');
      } else {
        setReplyError(getApiErrorMessage(requestError, 'Your reply could not be posted.'));
      }
    } finally {
      setIsPostingReply(false);
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
  if (videoError || !video) {
    return (
      <div className="px-4 py-8">
        <ErrorState
          message={videoError ?? 'This video is unavailable.'}
          onRetry={() => setVideoRequestNumber((number) => number + 1)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-[1700px] grid-cols-1 gap-8 px-0 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-7">
      <div className="min-w-0">
        <div className="overflow-hidden rounded-none bg-black sm:rounded-card">
          {playlistUrl ? (
            <VideoPlayer
              src={playlistUrl}
              initialPosition={initialPosition}
              videoId={video.id}
              viewerSessionId={playbackSessionRef.current}
              onProgress={(currentTime, duration, completed) => {
                playbackRef.current.currentTime = currentTime;
                playbackRef.current.durationWatched = Math.max(
                  playbackRef.current.durationWatched,
                  currentTime,
                );
                playbackRef.current.completed = completed || (duration > 0 && currentTime >= duration);
              }}
            />
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
                <p className="text-sm text-text-muted">
                  {video.channel.handle}
                  {video.channel.subscriberCount != null && (
                    <> · {new Intl.NumberFormat().format(video.channel.subscriberCount)} subscribers</>
                  )}
                </p>
              </div>
              {subscriptionState === 'signed-out' ? (
                <SignInLink className="ml-1 shrink-0 rounded-full bg-brand-action px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-action-hover">
                  Sign in to subscribe
                </SignInLink>
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
                onClick={() => void toggleLike(false)}
                disabled={isUpdatingLike}
                aria-pressed={likeState === 'liked'}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60 ${likeState === 'liked' ? 'bg-brand-light/20 text-brand-dark' : 'bg-surface-subtle hover:bg-surface-hover'}`}
              >
                <ThumbsUp className="h-4 w-4" /> Like
              </button>
              <button
                type="button"
                onClick={() => void toggleLike(true)}
                disabled={isUpdatingLike}
                aria-pressed={likeState === 'disliked'}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60 ${likeState === 'disliked' ? 'bg-brand-light/20 text-brand-dark' : 'bg-surface-subtle hover:bg-surface-hover'}`}
              >
                <ThumbsDown className="h-4 w-4" /> Dislike
              </button>
              <button
                type="button"
                onClick={copyVideoLink}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-subtle px-4 py-2 text-sm font-medium hover:bg-surface-hover"
              >
                <Copy className="h-4 w-4" /> Share
              </button>
              <button
                type="button"
                onClick={() => setReportTarget({ id: video.id, type: 'VIDEO' })}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-subtle px-4 py-2 text-sm font-medium hover:bg-surface-hover"
              >
                <Flag className="h-4 w-4" /> Report
              </button>
            </div>
          </div>
          {subscriptionError && <p role="alert" className="mt-3 text-sm text-status-warning">{subscriptionError}</p>}
          {subscriptionState === 'unavailable' && (
            <p role="status" className="mt-3 text-sm text-text-muted">Subscription status is unavailable right now.</p>
          )}
          {shareStatus && <p role="status" className="mt-2 text-sm text-text-muted">{shareStatus}</p>}
          {likeError && <p role="alert" className="mt-2 text-sm text-status-warning">{likeError}</p>}

          <div className="mt-4 rounded-card bg-surface-subtle p-4">
            <p className="mb-2 text-sm font-semibold">
              {formatViewCount(video.viewsCount)}
              {formatPublishedDate(video.publishedAt, video.createdAt) && <> · {formatPublishedDate(video.publishedAt, video.createdAt)}</>}
            </p>
            <p className="whitespace-pre-wrap text-sm">{video.description || 'No description provided.'}</p>
          </div>
        </section>

      </div>

      <aside className="px-4 pb-8 sm:px-0 lg:row-span-2 lg:pt-1">
        <h2 className="mb-4 text-lg font-bold">Up next</h2>
        {isLoadingRelated ? (
          <LoadingState label="Loading related videos…" />
        ) : relatedError ? (
          <div role="status" className="text-sm text-text-muted">
            <p>{relatedError}</p>
            <button
              type="button"
              onClick={() => setRelatedRequestNumber((number) => number + 1)}
              className="mt-3 min-h-11 rounded-control bg-surface-subtle px-4 font-semibold text-text-primary hover:bg-surface-hover"
            >
              Try again
            </button>
          </div>
        ) : relatedVideos.length === 0 ? (
          <p className="text-sm text-text-muted">No related videos are available.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {relatedVideos.map((relatedVideo) => (
              <VideoCard key={relatedVideo.id} video={relatedVideo} layout="horizontal" />
            ))}
          </div>
        )}
      </aside>

      <section className="px-4 py-2 sm:px-0 lg:col-start-1 lg:row-start-2">
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
                <><SignInLink className="font-semibold underline">Sign in</SignInLink> to post a comment.</>
              ) : commentError}
            </p>
          )}
          {commentStatus && <p role="status" className="mt-2 text-sm text-text-muted">{commentStatus}</p>}
        </form>

        {commentsLoading ? (
          <LoadingState label="Loading comments…" />
        ) : commentsError ? (
          <ErrorState message={commentsError} onRetry={() => setCommentRefresh((value) => value + 1)} />
        ) : comments.length === 0 ? (
          <EmptyState title="No comments yet" message="Be the first to join the conversation." />
        ) : (
          <div className="space-y-6">
            {comments.map((comment) => {
              const commentChannel = comment.user?.channels?.[0];
              const repliesInfo = repliesState[comment.id];
              const hasReplies = (comment._count?.replies != null && comment._count.replies > 0)
                || (repliesInfo?.replies && repliesInfo.replies.length > 0);
              const totalReplyCount = Math.max(
                comment._count?.replies ?? 0,
                repliesInfo?.replies?.length ?? 0,
              );
              const isReplying = activeReplyCommentId === comment.id;

              return (
                <article key={comment.id} className="flex gap-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-subtle">
                    {commentChannel?.avatarUrl ? (
                      <img src={commentChannel.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center font-semibold text-text-muted">
                        {commentChannel?.name ? commentChannel.name.slice(0, 1).toUpperCase() : 'M'}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {commentChannel?.handle ?? 'Member'}
                        <time className="ml-2 font-normal text-text-muted">
                          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(comment.createdAt))}
                        </time>
                      </p>
                      <button
                        type="button"
                        onClick={() => setReportTarget({ id: comment.id, type: 'COMMENT' })}
                        className="text-xs text-text-muted hover:text-text-primary"
                      >
                        Report
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{comment.content}</p>

                    <div className="mt-2 flex items-center gap-4 text-xs font-semibold text-text-muted">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveReplyCommentId(isReplying ? null : comment.id);
                          setReplyText('');
                          setReplyError(null);
                        }}
                        className="hover:text-text-primary"
                      >
                        {isReplying ? 'Cancel' : 'Reply'}
                      </button>
                      {hasReplies && (
                        <button
                          type="button"
                          onClick={() => toggleReplies(comment.id)}
                          className="inline-flex items-center gap-1 text-brand-dark hover:underline"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {repliesInfo?.isExpanded
                            ? 'Hide replies'
                            : `View ${totalReplyCount} ${totalReplyCount === 1 ? 'reply' : 'replies'}`}
                        </button>
                      )}
                    </div>

                    {isReplying && (
                      <form onSubmit={(e) => void submitReply(comment.id, e)} className="mt-3 border-l-2 border-border pl-4">
                        <label htmlFor={`reply-${comment.id}`} className="sr-only">Add a reply</label>
                        <textarea
                          id={`reply-${comment.id}`}
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Add a reply…"
                          maxLength={1000}
                          rows={2}
                          className="w-full resize-y border-b border-divider bg-transparent py-1.5 text-sm focus:border-focus focus:outline-none"
                        />
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-xs text-text-muted">{replyText.length}/1000</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveReplyCommentId(null);
                                setReplyText('');
                                setReplyError(null);
                              }}
                              className="rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-surface-hover"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={!replyText.trim() || isPostingReply}
                              className="rounded-full bg-brand-action px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:bg-brand-action-hover disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isPostingReply ? 'Replying…' : 'Reply'}
                            </button>
                          </div>
                        </div>
                        {replyError && (
                          <p role="alert" className="mt-1 text-xs text-status-warning">
                            {replyError === 'Sign in to post a reply.' ? (
                              <><SignInLink className="font-semibold underline">Sign in</SignInLink> to post a reply.</>
                            ) : replyError}
                          </p>
                        )}
                      </form>
                    )}

                    {repliesInfo?.isExpanded && (
                      <div className="mt-3 space-y-3 border-l-2 border-border pl-4">
                        {repliesInfo.isLoading ? (
                          <p className="text-xs text-text-muted">Loading replies…</p>
                        ) : repliesInfo.error ? (
                          <div className="text-xs text-status-warning">
                            <span>{repliesInfo.error}</span>
                            <button
                              type="button"
                              onClick={() => void loadReplies(comment.id)}
                              className="ml-2 font-semibold underline text-brand-dark"
                            >
                              Retry
                            </button>
                          </div>
                        ) : repliesInfo.replies.length === 0 ? (
                          <p className="text-xs text-text-muted">No replies yet.</p>
                        ) : (
                          repliesInfo.replies.map((reply) => {
                            const replyChannel = reply.user?.channels?.[0];
                            return (
                              <article key={reply.id} className="flex gap-2.5">
                                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-subtle">
                                  {replyChannel?.avatarUrl ? (
                                    <img src={replyChannel.avatarUrl} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-text-muted">
                                      {replyChannel?.name ? replyChannel.name.slice(0, 1).toUpperCase() : 'M'}
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold">
                                      {replyChannel?.handle ?? 'Member'}
                                      <time className="ml-2 font-normal text-text-muted">
                                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(reply.createdAt))}
                                      </time>
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => setReportTarget({ id: reply.id, type: 'COMMENT' })}
                                      className="text-xs text-text-muted hover:text-text-primary"
                                    >
                                      Report
                                    </button>
                                  </div>
                                  <p className="mt-0.5 whitespace-pre-wrap text-xs">{reply.content}</p>
                                </div>
                              </article>
                            );
                          })
                        )}
                      </div>
                    )}
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

      {reportTarget && (
        <ReportModal
          isOpen={Boolean(reportTarget)}
          onClose={() => setReportTarget(null)}
          targetId={reportTarget.id}
          targetType={reportTarget.type}
        />
      )}
    </div>
  );
}
