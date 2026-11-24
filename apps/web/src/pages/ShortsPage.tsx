import { useEffect, useRef, useState, type FormEvent } from 'react';
import axios from 'axios';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Flag,
  LayoutGrid,
  MessageSquare,
  Play,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../api/apiClient';
import { SignInLink } from '../components/account/SignInLink';
import { ReportModal } from '../components/modals/ReportModal';
import { formatDuration, formatViewCount, type ViewerVideo } from '../components/video/videoTypes';

export const MAX_SHORT_DURATION_SECONDS = 180;

interface ShortsResponse {
  videos: ViewerVideo[];
  pagination: { page: number; limit: number; hasMore: boolean };
}

interface ShortComment {
  id: string;
  content: string;
  createdAt: string;
  user?: { channels?: { name: string; handle: string; avatarUrl?: string | null }[] };
}

export interface ShortsContentProps {
  page: number;
  videos: ViewerVideo[];
  hasMore: boolean;
  error: string | null;
  isLoading: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  initialVideoId?: string | null;
}

export function ShortsContent({
  page,
  videos,
  hasMore,
  error,
  isLoading,
  onRetry,
  onPageChange,
  initialVideoId,
}: ShortsContentProps) {
  // Only portrait videos with duration <= 180 seconds are eligible Shorts
  const eligibleVideos = videos.filter(
    (video) => video.duration == null || video.duration <= MAX_SHORT_DURATION_SECONDS,
  );

  const initialIndex = initialVideoId
    ? eligibleVideos.findIndex((v) => v.id === initialVideoId)
    : -1;

  const [viewMode, setViewMode] = useState<'grid' | 'viewer'>(initialIndex >= 0 ? 'viewer' : 'grid');
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, initialIndex));
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [likeStates, setLikeStates] = useState<Record<string, 'liked' | 'disliked' | 'none'>>({});
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<ShortComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);

  const videoElementRef = useRef<HTMLVideoElement>(null);
  const activeVideo = eligibleVideos[currentIndex] ?? null;
  const activePlaylistUrl = activeVideo?.variants?.find((v) => Boolean(v.playlistUrl))?.playlistUrl;

  // Sync index if initialVideoId changes
  useEffect(() => {
    if (initialVideoId) {
      const idx = eligibleVideos.findIndex((v) => v.id === initialVideoId);
      if (idx >= 0) {
        setCurrentIndex(idx);
        setViewMode('viewer');
      }
    }
  }, [initialVideoId, eligibleVideos]);

  // Load comments when comments drawer opens for current active video
  useEffect(() => {
    if (!showComments || !activeVideo?.id) return;
    setIsLoadingComments(true);
    setCommentError(null);
    const controller = new AbortController();
    apiClient
      .get<{ comments: ShortComment[] }>(`/api/v1/videos/${encodeURIComponent(activeVideo.id)}/comments`, {
        signal: controller.signal,
      })
      .then(({ data }) => setComments(data.comments || []))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setCommentError(getApiErrorMessage(err, 'Failed to load comments.'));
        }
      })
      .finally(() => setIsLoadingComments(false));

    return () => controller.abort();
  }, [showComments, activeVideo?.id]);

  // Handle keyboard navigation in viewer mode
  useEffect(() => {
    if (viewMode !== 'viewer') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        if (currentIndex < eligibleVideos.length - 1) {
          setCurrentIndex((prev) => prev + 1);
          setShowComments(false);
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        if (currentIndex > 0) {
          setCurrentIndex((prev) => prev - 1);
          setShowComments(false);
        }
      } else if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key.toLowerCase() === 'm') {
        setIsMuted((prev) => !prev);
      } else if (e.key === 'Escape') {
        if (showComments) setShowComments(false);
        else setViewMode('grid');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, currentIndex, eligibleVideos.length, showComments]);

  const toggleLike = async (isDislike: boolean) => {
    if (!activeVideo) return;
    const current = likeStates[activeVideo.id] ?? 'none';
    const target = !isDislike
      ? current === 'liked' ? 'none' : 'liked'
      : current === 'disliked' ? 'none' : 'disliked';

    setLikeStates((prev) => ({ ...prev, [activeVideo.id]: target }));
    try {
      const { data } = await apiClient.post<{ isLiked: boolean; isDisliked: boolean }>(
        `/api/v1/videos/${encodeURIComponent(activeVideo.id)}/like`,
        { isDislike },
      );
      setLikeStates((prev) => ({
        ...prev,
        [activeVideo.id]: data.isLiked ? 'liked' : data.isDisliked ? 'disliked' : 'none',
      }));
    } catch {
      // Rollback
      setLikeStates((prev) => ({ ...prev, [activeVideo.id]: current }));
    }
  };

  const copyShortLink = async () => {
    if (!activeVideo) return;
    try {
      const url = `${window.location.origin}/watch/${encodeURIComponent(activeVideo.id)}`;
      await navigator.clipboard.writeText(url);
      setShareFeedback('Link copied!');
      setTimeout(() => setShareFeedback(null), 3000);
    } catch {
      setShareFeedback('Unable to copy.');
      setTimeout(() => setShareFeedback(null), 3000);
    }
  };

  const submitShortComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeVideo || !commentInput.trim() || isPostingComment) return;
    setIsPostingComment(true);
    setCommentError(null);
    try {
      const { data } = await apiClient.post<ShortComment>(
        `/api/v1/videos/${encodeURIComponent(activeVideo.id)}/comments`,
        { content: commentInput.trim() },
      );
      setComments((prev) => [data, ...prev]);
      setCommentInput('');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setCommentError('Sign in to post a comment.');
      } else {
        setCommentError(getApiErrorMessage(err, 'Failed to post comment.'));
      }
    } finally {
      setIsPostingComment(false);
    }
  };

  return (
    <section className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Shorts</h1>
          <p className="mt-1 text-sm text-text-muted">
            Vertical 9:16 videos up to 3 minutes ({MAX_SHORT_DURATION_SECONDS}s).
          </p>
        </div>
        {eligibleVideos.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setViewMode(viewMode === 'viewer' ? 'grid' : 'viewer');
                setShowComments(false);
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-light px-4 text-sm font-semibold transition hover:bg-surface-hover dark:bg-surface-dark"
            >
              {viewMode === 'viewer' ? (
                <>
                  <LayoutGrid className="h-4 w-4" /> Browse grid
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Watch feed
                </>
              )}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" className="mt-6 rounded-card border border-border bg-surface-light p-4 text-sm dark:bg-surface-dark">
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="ml-3 font-semibold text-brand-dark">
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <p role="status" className="mt-8 text-center text-sm text-text-muted">Loading Shorts…</p>
      )}

      {!isLoading && !error && eligibleVideos.length === 0 && (
        <div className="mt-8 rounded-card border border-border bg-surface-light p-8 text-center dark:bg-surface-dark">
          <h2 className="font-semibold">No Shorts yet</h2>
          <p className="mt-1 text-sm text-text-muted">Published portrait videos will appear here.</p>
        </div>
      )}

      {!isLoading && eligibleVideos.length > 0 && viewMode === 'viewer' && activeVideo && (
        <div className="relative mx-auto flex max-w-[540px] items-center justify-center py-2">
          {/* Main 9:16 vertical player container */}
          <div className="relative aspect-[9/16] w-full max-w-[420px] overflow-hidden rounded-card bg-black shadow-2xl">
            {activePlaylistUrl ? (
              <video
                ref={videoElementRef}
                src={activePlaylistUrl}
                autoPlay={isPlaying}
                loop
                playsInline
                muted={isMuted}
                onClick={() => setIsPlaying((p) => !p)}
                className="h-full w-full cursor-pointer object-cover"
              />
            ) : activeVideo.thumbnailUrl ? (
              <img
                src={activeVideo.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/70">
                Short Preview
              </div>
            )}

            {/* Play/Pause center overlay icon */}
            {!isPlaying && (
              <button
                type="button"
                onClick={() => setIsPlaying(true)}
                aria-label="Play"
                className="absolute inset-0 flex items-center justify-center bg-black/30 text-white"
              >
                <div className="rounded-full bg-black/60 p-4">
                  <Play className="h-8 w-8 text-white" />
                </div>
              </button>
            )}

            {/* Sound toggle button */}
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              className="absolute left-3 top-3 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
            >
              {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>

            {/* Duration pill (<= 180s) */}
            {activeVideo.duration != null && (
              <span className="absolute right-3 top-3 z-10 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">
                {formatDuration(activeVideo.duration)}
              </span>
            )}

            {/* Bottom creator metadata & title */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 text-white">
              <div className="flex items-center gap-2">
                <Link
                  to={`/channel/${encodeURIComponent(activeVideo.channel.handle)}`}
                  className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/20"
                >
                  {activeVideo.channel.avatarUrl ? (
                    <img src={activeVideo.channel.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center font-bold text-white">
                      {activeVideo.channel.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </Link>
                <Link
                  to={`/channel/${encodeURIComponent(activeVideo.channel.handle)}`}
                  className="inline-flex items-center gap-1 font-semibold hover:underline"
                >
                  <span className="truncate">{activeVideo.channel.name}</span>
                  {activeVideo.channel.isVerified && (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-dark" />
                  )}
                </Link>
              </div>

              <h2 className="mt-2 line-clamp-2 text-sm font-semibold">{activeVideo.title}</h2>
              <p className="mt-1 text-xs text-white/70">
                {formatViewCount(activeVideo.viewsCount)}
              </p>
            </div>
          </div>

          {/* Right vertical action bar */}
          <div className="ml-3 flex flex-col items-center gap-4 text-text-primary dark:text-white">
            <button
              type="button"
              disabled={currentIndex <= 0}
              onClick={() => {
                if (currentIndex > 0) {
                  setCurrentIndex((prev) => prev - 1);
                  setShowComments(false);
                }
              }}
              aria-label="Previous short"
              className="rounded-full bg-surface-subtle p-3 transition hover:bg-surface-hover disabled:opacity-30 dark:bg-white/10 dark:hover:bg-white/20"
            >
              <ChevronUp className="h-6 w-6" />
            </button>

            <button
              type="button"
              disabled={currentIndex >= eligibleVideos.length - 1}
              onClick={() => {
                if (currentIndex < eligibleVideos.length - 1) {
                  setCurrentIndex((prev) => prev + 1);
                  setShowComments(false);
                }
              }}
              aria-label="Next short"
              className="rounded-full bg-surface-subtle p-3 transition hover:bg-surface-hover disabled:opacity-30 dark:bg-white/10 dark:hover:bg-white/20"
            >
              <ChevronDown className="h-6 w-6" />
            </button>

            <div className="my-1 border-t border-border" />

            <button
              type="button"
              onClick={() => void toggleLike(false)}
              aria-label="Like this short"
              aria-pressed={likeStates[activeVideo.id] === 'liked'}
              className={`flex flex-col items-center rounded-full p-2.5 transition ${
                likeStates[activeVideo.id] === 'liked'
                  ? 'bg-brand-dark text-white'
                  : 'bg-surface-subtle hover:bg-surface-hover dark:bg-white/10'
              }`}
            >
              <ThumbsUp className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => void toggleLike(true)}
              aria-label="Dislike this short"
              aria-pressed={likeStates[activeVideo.id] === 'disliked'}
              className={`flex flex-col items-center rounded-full p-2.5 transition ${
                likeStates[activeVideo.id] === 'disliked'
                  ? 'bg-brand-dark text-white'
                  : 'bg-surface-subtle hover:bg-surface-hover dark:bg-white/10'
              }`}
            >
              <ThumbsDown className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setShowComments((prev) => !prev)}
              aria-label="View comments"
              className={`rounded-full p-2.5 transition ${
                showComments
                  ? 'bg-brand-dark text-white'
                  : 'bg-surface-subtle hover:bg-surface-hover dark:bg-white/10'
              }`}
            >
              <MessageSquare className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={copyShortLink}
              aria-label="Share short"
              className="rounded-full bg-surface-subtle p-2.5 transition hover:bg-surface-hover dark:bg-white/10"
            >
              <Copy className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setReportTargetId(activeVideo.id)}
              aria-label="Report short"
              className="rounded-full bg-surface-subtle p-2.5 transition hover:bg-surface-hover dark:bg-white/10"
            >
              <Flag className="h-5 w-5" />
            </button>

            {shareFeedback && (
              <span role="status" className="text-center text-xs font-semibold text-brand-dark">
                {shareFeedback}
              </span>
            )}
          </div>

          {/* Comments side drawer */}
          {showComments && (
            <div className="absolute right-0 top-0 z-40 flex h-full w-80 flex-col rounded-card border border-border bg-surface-light p-4 shadow-2xl dark:bg-surface-dark">
              <div className="flex items-center justify-between border-b border-divider pb-2">
                <h3 className="text-sm font-bold">Comments</h3>
                <button
                  type="button"
                  onClick={() => setShowComments(false)}
                  aria-label="Close comments"
                  className="rounded-full p-1 hover:bg-surface-hover"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-3">
                {isLoadingComments ? (
                  <p className="text-center text-xs text-text-muted">Loading comments…</p>
                ) : comments.length === 0 ? (
                  <p className="text-center text-xs text-text-muted">No comments yet.</p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((comment) => (
                      <div key={comment.id} className="text-xs">
                        <span className="font-semibold">
                          {comment.user?.channels?.[0]?.handle ?? 'User'}
                        </span>
                        <p className="mt-0.5 whitespace-pre-wrap">{comment.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={submitShortComment} className="border-t border-divider pt-2">
                <input
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder="Add a comment…"
                  maxLength={500}
                  className="w-full rounded-control border border-border bg-transparent px-3 py-1.5 text-xs focus:border-focus focus:outline-none"
                />
                {commentError && (
                  <p role="alert" className="mt-1 text-xs text-status-warning">
                    {commentError === 'Sign in to post a comment.' ? (
                      <><SignInLink className="font-semibold underline">Sign in</SignInLink> to comment.</>
                    ) : commentError}
                  </p>
                )}
              </form>
            </div>
          )}
        </div>
      )}

      {!isLoading && eligibleVideos.length > 0 && viewMode === 'grid' && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {eligibleVideos.map((video, idx) => (
              <button
                key={video.id}
                type="button"
                onClick={() => {
                  setCurrentIndex(idx);
                  setViewMode('viewer');
                }}
                className="group min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              >
                <div className="relative mx-auto aspect-[9/16] w-full max-w-52 overflow-hidden rounded-card bg-surface-subtle transition-transform duration-200 group-hover:scale-[1.02]">
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-text-muted">
                      Short
                    </div>
                  )}
                  {video.duration != null && (
                    <span className="absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 text-xs font-semibold text-white">
                      {formatDuration(video.duration)}
                    </span>
                  )}
                </div>
                <h2 className="mt-2 line-clamp-2 text-sm font-semibold">{video.title}</h2>
                <p className="mt-1 text-xs text-text-muted">
                  {video.channel.name} · {formatViewCount(video.viewsCount)}
                </p>
              </button>
            ))}
          </div>

          <nav className="mt-8 flex justify-center gap-3" aria-label="Shorts pagination">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="rounded-control border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="flex items-center text-sm text-text-muted">Page {page}</span>
            <button
              type="button"
              disabled={!hasMore}
              onClick={() => onPageChange(page + 1)}
              className="rounded-control border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </nav>
        </>
      )}

      {reportTargetId && (
        <ReportModal
          isOpen={Boolean(reportTargetId)}
          onClose={() => setReportTargetId(null)}
          targetId={reportTargetId}
          targetType="VIDEO"
        />
      )}
    </section>
  );
}

export function ShortsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 1000 ? parsedPage : 1;
  const initialVideoId = searchParams.get('v');
  const [requestNumber, setRequestNumber] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    videos: ViewerVideo[];
    hasMore: boolean;
    error: string | null;
  }>();

  const requestKey = `${page}:${requestNumber}`;
  const current = result?.key === requestKey ? result : undefined;

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get<ShortsResponse>('/api/v1/feed/shorts', { params: { page }, signal: controller.signal })
      .then(({ data }) =>
        setResult({
          key: requestKey,
          videos: data.videos,
          hasMore: data.pagination.hasMore,
          error: null,
        }),
      )
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          videos: [],
          hasMore: false,
          error: getApiErrorMessage(requestError, 'Shorts could not be loaded.'),
        });
      });
    return () => controller.abort();
  }, [page, requestNumber, requestKey]);

  const goToPage = (nextPage: number) => {
    setSearchParams((currentParams) => {
      const next = new URLSearchParams(currentParams);
      if (nextPage === 1) next.delete('page');
      else next.set('page', String(nextPage));
      return next;
    });
  };

  return (
    <ShortsContent
      page={page}
      videos={current?.videos ?? []}
      hasMore={current?.hasMore ?? false}
      error={current?.error ?? null}
      isLoading={!current}
      onRetry={() => setRequestNumber((val) => val + 1)}
      onPageChange={goToPage}
      initialVideoId={initialVideoId}
    />
  );
}
