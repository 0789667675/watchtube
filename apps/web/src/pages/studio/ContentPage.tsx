import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UploadModal } from '../../components/studio/UploadModal';
import { ChannelOnboardingModal } from '../../components/studio/ChannelOnboardingModal';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';

interface Channel {
  id: string;
  name: string;
  handle: string;
}

interface OwnedVideo {
  id: string;
  title: string;
  status: string;
  visibility: string;
  thumbnailUrl: string | null;
  viewsCount: number;
  createdAt: string;
}

export const ContentPage: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [videos, setVideos] = useState<OwnedVideo[]>([]);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  const refreshVideos = useCallback(async () => {
    try {
      const response = await apiClient.get<OwnedVideo[]>('/api/v1/videos/mine');
      setVideos(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load your videos.'));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadPage = async () => {
      try {
        const response = await apiClient.get<{ channels: Channel[] }>('/api/v1/auth/me');
        if (!active) return;
        const ownedChannels = response.data.channels || [];
        setChannels(ownedChannels);
        setSelectedChannelId(ownedChannels[0]?.id || '');
        setIsAuthenticated(true);
        if (ownedChannels.length === 0) setIsOnboardingOpen(true);
        await refreshVideos();
      } catch (requestError) {
        if (!active) return;
        setIsAuthenticated(false);
        setError(getApiErrorMessage(requestError, 'Sign in to manage your videos.'));
      }
    };
    void loadPage();
    return () => { active = false; };
  }, [refreshVideos]);

  const onChannelCreated = (channel: Channel) => {
    setChannels((current) => [...current, channel]);
    setSelectedChannelId(channel.id);
  };

  if (isAuthenticated === null) {
    return <p role="status" className="p-6">Loading your channel…</p>;
  }

  if (!isAuthenticated) {
    return (
      <div className="p-6 space-y-3">
        <p role="alert">{error}</p>
        <Link to="/auth/login" className="text-brand-primary">Sign in to continue</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold font-display">Channel content</h1>
        <div className="flex items-center gap-3">
          {channels.length > 1 && (
            <label className="text-sm">
              Channel
              <select
                value={selectedChannelId}
                onChange={(event) => setSelectedChannelId(event.target.value)}
                className="ml-2 rounded-control border border-border-light bg-surface-light px-3 py-2 dark:border-border-dark dark:bg-surface-dark"
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channel.name}</option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={() => setIsOnboardingOpen(true)} className="rounded-control px-4 py-2 font-medium hover:bg-surface-hover">
            Add channel
          </button>
          <button
            type="button"
            onClick={() => setIsUploadOpen(true)}
            disabled={!selectedChannelId}
            className="rounded-control bg-brand-action px-4 py-2 font-bold text-brand-foreground transition hover:bg-brand-action-hover disabled:opacity-50"
          >
            Upload Video
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="w-full overflow-x-auto border border-border-light dark:border-border-dark rounded-xl">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-divider bg-surface-subtle">
            <tr>
              <th className="p-4 font-medium">Video</th>
              <th className="p-4 font-medium">Visibility</th>
              <th className="p-4 font-medium">Status</th>
              <th className="p-4 font-medium">Date</th>
              <th className="p-4 font-medium">Views</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light dark:divide-border-dark">
            {videos.map((video) => (
              <tr key={video.id} className="transition-colors hover:bg-surface-hover">
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    {video.thumbnailUrl
                      ? <img src={video.thumbnailUrl} alt="" className="aspect-video w-24 rounded-control object-cover" />
                      : <div className="aspect-video w-24 rounded-control bg-surface-subtle" />}
                    <span className="font-medium line-clamp-2">{video.title}</span>
                  </div>
                </td>
                <td className="p-4">{video.visibility}</td>
                <td className="p-4" aria-live="polite">{video.status}</td>
                <td className="p-4">{new Date(video.createdAt).toLocaleDateString()}</td>
                <td className="p-4">{video.viewsCount}</td>
              </tr>
            ))}
            {videos.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-text-muted">No videos yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <UploadModal
        isOpen={isUploadOpen}
        channelId={selectedChannelId}
        onClose={() => setIsUploadOpen(false)}
        onUploaded={() => { void refreshVideos(); }}
      />
      <ChannelOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onCreated={onChannelCreated}
      />
    </div>
  );
};
