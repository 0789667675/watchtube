import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useOutletContext } from 'react-router-dom';
import { UploadModal } from '../../components/studio/UploadModal';
import { ChannelOnboardingModal } from '../../components/studio/ChannelOnboardingModal';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import type { StudioChannel, StudioOutletContext } from './studioApi';

interface OwnedVideo {
  id: string;
  channelId: string;
  title: string;
  status: string;
  visibility: string;
  thumbnailUrl: string | null;
  viewsCount: number;
  createdAt: string;
}

interface VideoListResult {
  key: number;
  status: 'loading' | 'ready' | 'error';
  videos: OwnedVideo[];
  error: string;
  unauthorized: boolean;
}

export function ContentPage() {
  const { profile, addChannel } = useOutletContext<StudioOutletContext>();
  const [selectedChannelId, setSelectedChannelId] = useState(profile.channels[0]?.id ?? '');
  const [refreshKey, setRefreshKey] = useState(0);
  const [videoListResult, setVideoListResult] = useState<VideoListResult>({
    key: 0,
    status: 'loading',
    videos: [],
    error: '',
    unauthorized: false,
  });
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(profile.channels.length === 0);

  useEffect(() => {
    const controller = new AbortController();
    apiClient.get<OwnedVideo[]>('/api/v1/videos/mine', { signal: controller.signal })
      .then(({ data }) => setVideoListResult({
        key: refreshKey,
        status: 'ready',
        videos: data,
        error: '',
        unauthorized: false,
      }))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setVideoListResult({
          key: refreshKey,
          status: 'error',
          videos: [],
          error: getApiErrorMessage(requestError, 'Your videos could not be loaded.'),
          unauthorized: axios.isAxiosError(requestError) && requestError.response?.status === 401,
        });
      });
    return () => controller.abort();
  }, [refreshKey]);

  const isLoadingVideos = videoListResult.key !== refreshKey || videoListResult.status === 'loading';
  const videos = videoListResult.key === refreshKey ? videoListResult.videos : [];
  const contentError = videoListResult.key === refreshKey ? videoListResult.error : '';
  const isUnauthorized = videoListResult.key === refreshKey && videoListResult.unauthorized;
  const refreshVideos = () => setRefreshKey((current) => current + 1);

  const onChannelCreated = (channel: StudioChannel) => {
    addChannel(channel);
    setSelectedChannelId(channel.id);
  };

  return (
    <section className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channel content</h1>
          <p className="mt-1 text-sm text-text-muted">Manage uploads across your channels.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {profile.channels.length > 1 && (
            <label className="flex items-center gap-2 text-sm font-medium">
              Upload to
              <select
                value={selectedChannelId}
                onChange={(event) => setSelectedChannelId(event.target.value)}
                className="max-w-52 rounded-control border border-border bg-surface-light px-3 py-2 dark:bg-surface-dark"
              >
                {profile.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channel.name}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => setIsOnboardingOpen(true)}
            className="rounded-control border border-border px-4 py-2 text-sm font-semibold transition hover:bg-surface-hover"
          >
            Add channel
          </button>
          <button
            type="button"
            onClick={() => setIsUploadOpen(true)}
            disabled={!selectedChannelId}
            className="rounded-control bg-brand-action px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-action-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Upload video
          </button>
        </div>
      </header>

      {contentError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-light p-4 text-sm dark:bg-surface-dark">
          <span>{contentError}</span>
          {isUnauthorized ? (
            <Link to="/auth/login" className="font-semibold text-brand-dark hover:underline">Sign in again</Link>
          ) : (
            <button type="button" onClick={refreshVideos} className="font-semibold text-brand-dark hover:underline">
              Retry
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-card border border-border bg-surface-light dark:bg-surface-dark">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-4 py-4 sm:px-5">
          <h2 className="font-semibold">Videos</h2>
          {!isLoadingVideos && !contentError && (
            <span className="text-sm text-text-muted">{videos.length} {videos.length === 1 ? 'video' : 'videos'}</span>
          )}
        </div>
        {isLoadingVideos ? (
          <p role="status" className="p-8 text-center text-sm text-text-muted">Loading your videos…</p>
        ) : videos.length === 0 ? (
          <div className="p-8 text-center">
            {contentError ? (
              <p role="status" className="text-sm text-text-muted">Your video library is unavailable right now.</p>
            ) : (
              <>
                <h3 className="font-semibold">No videos yet</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Upload a video to a channel you own to start building your library.
                </p>
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(true)}
                  disabled={!selectedChannelId}
                  className="mt-4 rounded-control bg-brand-action px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-action-hover disabled:opacity-50"
                >
                  Upload video
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-subtle text-text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Video</th>
                  <th scope="col" className="px-4 py-3 font-medium">Channel</th>
                  <th scope="col" className="px-4 py-3 font-medium">Visibility</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Uploaded</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Views</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {videos.map((video) => {
                  const channel = profile.channels.find((item) => item.id === video.channelId);
                  return (
                    <tr key={video.id} className="hover:bg-surface-hover">
                      <td className="max-w-sm px-4 py-4 sm:px-5">
                        <div className="flex min-w-56 items-center gap-3">
                          {video.thumbnailUrl
                            ? <img src={video.thumbnailUrl} alt="" loading="lazy" className="aspect-video w-24 shrink-0 rounded-control object-cover" />
                            : <div aria-hidden="true" className="aspect-video w-24 shrink-0 rounded-control bg-surface-subtle" />}
                          <span className="line-clamp-2 font-medium">{video.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">{channel?.name ?? 'Channel unavailable'}</td>
                      <td className="px-4 py-4">{video.visibility}</td>
                      <td className="px-4 py-4">
                        <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium">{video.status}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-text-muted">{new Date(video.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-4 text-right tabular-nums">{new Intl.NumberFormat().format(video.viewsCount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UploadModal
        isOpen={isUploadOpen}
        channelId={selectedChannelId}
        onClose={() => setIsUploadOpen(false)}
        onUploaded={refreshVideos}
      />
      <ChannelOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onCreated={onChannelCreated}
      />
    </section>
  );
}
