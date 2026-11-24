import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { Link, useOutletContext } from 'react-router-dom';
import { MessageSquareText, Trash2 } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import { SignInLink } from '../../components/account/SignInLink';
import { isStudioCommentPage } from './studioApi';
import type { StudioCommentPage, StudioOutletContext } from './studioApi';

type CommentRequestResult =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; data: StudioCommentPage }
  | { key: string; status: 'error'; message: string; unauthorized: boolean };

function isCommentDeletion(value: unknown, commentId: string): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'deleted' in value
    && value.deleted === true
    && 'commentId' in value
    && value.commentId === commentId;
}

export function CommentsPage() {
  const { profile } = useOutletContext<StudioOutletContext>();
  const [selectedChannelId, setSelectedChannelId] = useState(profile.channels[0]?.id ?? '');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [requestResult, setRequestResult] = useState<CommentRequestResult>({
    key: '',
    status: 'loading',
  });
  const [deletingCommentId, setDeletingCommentId] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const requestKey = JSON.stringify([selectedChannelId, page, search, refreshKey]);

  useEffect(() => {
    if (!selectedChannelId) return;

    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) query.set('search', search);

    apiClient.get<unknown>(
      `/api/v1/studio/channels/${encodeURIComponent(selectedChannelId)}/comments?${query}`,
      { signal: controller.signal },
    )
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (isStudioCommentPage(data)) {
          if (data.page > data.totalPages) {
            setPage(data.totalPages);
            return;
          }
          setRequestResult({ key: requestKey, status: 'ready', data });
        } else {
          setRequestResult({
            key: requestKey,
            status: 'error',
            message: 'The comments response could not be verified.',
            unauthorized: false,
          });
        }
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setRequestResult({
          key: requestKey,
          status: 'error',
          message: getApiErrorMessage(requestError, 'Comments could not be loaded.'),
          unauthorized: axios.isAxiosError(requestError) && requestError.response?.status === 401,
        });
      });

    return () => controller.abort();
  }, [page, refreshKey, requestKey, search, selectedChannelId]);

  const currentResult: CommentRequestResult = requestResult.key === requestKey
    ? requestResult
    : { key: requestKey, status: 'loading' };

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
    setActionError('');
    setNotice('');
    setRefreshKey((current) => current + 1);
  };

  const deleteComment = async (commentId: string) => {
    if (!window.confirm('Delete this comment permanently? This action cannot be undone.')) return;

    setDeletingCommentId(commentId);
    setActionError('');
    setNotice('');
    try {
      const { data } = await apiClient.delete<unknown>(
        `/api/v1/studio/channels/${encodeURIComponent(selectedChannelId)}/comments/${encodeURIComponent(commentId)}`,
      );
      if (!isCommentDeletion(data, commentId)) {
        throw new Error('The server did not confirm comment deletion.');
      }

      setNotice('Comment permanently deleted.');
      if (
        page > 1
        && currentResult.status === 'ready'
        && currentResult.data.comments.length === 1
      ) {
        setPage((current) => current - 1);
      } else {
        setRefreshKey((current) => current + 1);
      }
    } catch (requestError) {
      setActionError(getApiErrorMessage(requestError, 'The comment could not be deleted.'));
    } finally {
      setDeletingCommentId('');
    }
  };

  if (profile.channels.length === 0) {
    return (
      <section className="mx-auto max-w-3xl rounded-card border border-border bg-surface-light p-6 dark:bg-surface-dark sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Comments</h1>
        <p className="mt-2 text-sm text-text-muted">Create a channel before managing comments on your videos.</p>
        <Link to="/studio/content" className="mt-5 inline-flex rounded-control bg-brand-action px-4 py-2 font-semibold text-brand-foreground hover:bg-brand-action-hover">
          Go to channel content
        </Link>
      </section>
    );
  }

  const selectedChannel = profile.channels.find((channel) => channel.id === selectedChannelId);

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Comments</h1>
          <p className="mt-1 text-sm text-text-muted">Review and moderate comments on videos you own.</p>
        </div>
        {profile.channels.length > 1 ? (
          <label className="flex items-center gap-2 text-sm font-medium">
            Channel
            <select
              value={selectedChannelId}
              disabled={Boolean(deletingCommentId)}
              onChange={(event) => {
                setSelectedChannelId(event.target.value);
                setPage(1);
                setActionError('');
                setNotice('');
              }}
              className="max-w-56 rounded-control border border-border bg-surface-light px-3 py-2 dark:bg-surface-dark"
            >
              {profile.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
          </label>
        ) : selectedChannel ? (
          <p className="text-sm font-medium text-text-muted">{selectedChannel.name}</p>
        ) : null}
      </header>

      <form onSubmit={applySearch} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="studio-comment-search" className="sr-only">Search comments and video titles</label>
        <input
          id="studio-comment-search"
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          maxLength={200}
          placeholder="Search comment text or video title"
          disabled={Boolean(deletingCommentId)}
          className="min-w-0 flex-1 rounded-control border border-border bg-surface-light px-4 py-2.5 dark:bg-surface-dark"
        />
        <button
          type="submit"
          disabled={Boolean(deletingCommentId)}
          className="rounded-control bg-brand-action px-5 py-2.5 text-sm font-semibold text-brand-foreground hover:bg-brand-action-hover disabled:opacity-50"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPage(1);
              setRefreshKey((current) => current + 1);
            }}
            disabled={Boolean(deletingCommentId)}
            className="rounded-control border border-border px-4 py-2.5 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </form>

      {notice && <p role="status" className="rounded-control border border-border bg-surface-light p-3 text-sm dark:bg-surface-dark">{notice}</p>}
      {actionError && <p role="alert" className="rounded-control border border-border bg-surface-light p-3 text-sm text-status-warning dark:bg-surface-dark">{actionError}</p>}

      <div className="overflow-hidden rounded-card border border-border bg-surface-light dark:bg-surface-dark">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-4 sm:px-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <MessageSquareText aria-hidden="true" className="h-5 w-5 text-text-muted" />
            Channel comments
          </h2>
          {currentResult.status === 'ready' && (
            <span className="text-sm text-text-muted">{currentResult.data.total} {currentResult.data.total === 1 ? 'comment' : 'comments'}</span>
          )}
        </div>

        {currentResult.status === 'loading' ? (
          <p role="status" className="p-8 text-center text-sm text-text-muted">Loading comments…</p>
        ) : currentResult.status === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-6">
            <p className="text-sm text-text-muted">{currentResult.message}</p>
            {currentResult.unauthorized ? (
              <SignInLink className="text-sm font-semibold text-brand-dark hover:underline">Sign in again</SignInLink>
            ) : (
              <button
                type="button"
                onClick={() => setRefreshKey((current) => current + 1)}
                className="rounded-control bg-surface-subtle px-4 py-2 text-sm font-semibold hover:bg-surface-hover"
              >
                Retry
              </button>
            )}
          </div>
        ) : currentResult.data.comments.length === 0 ? (
          <div className="p-8 text-center">
            <h3 className="font-semibold">{search ? 'No matching comments' : 'No comments yet'}</h3>
            <p className="mt-1 text-sm text-text-muted">
              {search ? 'Try another search term.' : 'Comments on your channel videos will appear here.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {currentResult.data.comments.map((comment) => {
              const publicProfile = comment.user.channels[0];
              const authorName = publicProfile?.name ?? `Account ${comment.user.id.slice(0, 8)}`;

              return (
                <article key={comment.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-subtle">
                      {publicProfile?.avatarUrl
                        ? <img src={publicProfile.avatarUrl} alt="" className="h-full w-full object-cover" />
                        : <span aria-hidden="true" className="text-sm font-semibold text-text-muted">{authorName.slice(0, 1).toUpperCase()}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-semibold">{authorName}</span>
                        {publicProfile?.handle && <span className="text-sm text-text-muted">{publicProfile.handle}</span>}
                        <time dateTime={comment.createdAt} className="text-xs text-text-muted">
                          {new Date(comment.createdAt).toLocaleString()}
                        </time>
                        {comment.parentId && <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-text-muted">Reply</span>}
                      </div>
                      <Link
                        to={`/watch/${encodeURIComponent(comment.video.id)}?from=studio&tab=comments`}
                        className="mt-1 block text-xs text-text-muted hover:text-brand-dark hover:underline"
                      >
                        On: {comment.video.title}
                      </Link>
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{comment.content}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteComment(comment.id)}
                    disabled={Boolean(deletingCommentId)}
                    aria-label={`Delete comment by ${authorName}`}
                    className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-control border border-border px-3 py-2 text-sm font-semibold text-status-warning transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 sm:self-center"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                    {deletingCommentId === comment.id ? 'Deleting…' : 'Delete'}
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {currentResult.status === 'ready' && currentResult.data.total > 0 && (
          <nav aria-label="Comment pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-4 py-4 sm:px-5">
            <p className="text-sm text-text-muted">
              Page {currentResult.data.page} of {currentResult.data.totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || Boolean(deletingCommentId)}
                className="rounded-control border border-border px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(currentResult.data.totalPages, current + 1))}
                disabled={page >= currentResult.data.totalPages || Boolean(deletingCommentId)}
                className="rounded-control border border-border px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </nav>
        )}
      </div>
    </section>
  );
}
