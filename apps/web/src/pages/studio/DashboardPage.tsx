import { useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import { Link, useOutletContext } from 'react-router-dom';
import { Clock3, Eye, Users, Wallet } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import { isStudioAnalytics } from './studioApi';
import type { StudioAnalytics, StudioOutletContext } from './studioApi';

type AnalyticsState = 'loading' | 'ready' | 'no-channel' | 'unavailable';

function localDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: localDateInput(from), to: localDateInput(to) };
}

export function DashboardPage() {
  const { profile } = useOutletContext<StudioOutletContext>();
  const [initialRange] = useState(defaultDateRange);
  const [selectedChannelId, setSelectedChannelId] = useState(profile.channels[0]?.id ?? '');
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [today] = useState(() => localDateInput(new Date()));
  const [analytics, setAnalytics] = useState<StudioAnalytics | null>(null);
  const [analyticsState, setAnalyticsState] = useState<AnalyticsState>('loading');
  const [analyticsError, setAnalyticsError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const activeChannelId = profile.channels.some((channel) => channel.id === selectedChannelId)
    ? selectedChannelId
    : profile.channels[0]?.id ?? '';

  useEffect(() => {
    if (!activeChannelId) return;

    const controller = new AbortController();
    apiClient.get<unknown>('/api/v1/studio/analytics', {
      signal: controller.signal,
      params: { channelId: activeChannelId, from: dateFrom, to: dateTo },
    })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!isStudioAnalytics(data)) {
          setAnalytics(null);
          setAnalyticsState('unavailable');
          setAnalyticsError('The analytics response could not be verified.');
          return;
        }
        setAnalytics(data);
        setAnalyticsState('ready');
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(requestError) && requestError.response?.status === 404) {
          setAnalytics(null);
          setAnalyticsState('no-channel');
          return;
        }
        setAnalytics(null);
        setAnalyticsState('unavailable');
        setAnalyticsError(getApiErrorMessage(requestError, 'Channel analytics are unavailable right now.'));
      });

    return () => controller.abort();
  }, [activeChannelId, dateFrom, dateTo, refreshKey]);

  if (profile.channels.length === 0 || analyticsState === 'no-channel') {
    return (
      <section className="mx-auto max-w-3xl rounded-card border border-border bg-surface-light p-6 dark:bg-surface-dark sm:p-8">
        <h1 className="text-2xl font-bold">Create your first channel</h1>
        <p className="mt-2 text-sm text-text-muted">
          Channel analytics and creator tools become available after you create a channel.
        </p>
        <Link to="/studio/content" className="mt-5 inline-flex rounded-control bg-brand-action px-5 py-2.5 font-semibold text-brand-foreground hover:bg-brand-action-hover">
          Go to channel content
        </Link>
      </section>
    );
  }

  if (analyticsState === 'loading') {
    return <p role="status" className="p-4 text-sm text-text-muted">Loading channel overview…</p>;
  }

  if (analyticsState === 'unavailable' || !analytics) {
    return (
      <section role="alert" className="mx-auto max-w-3xl rounded-card border border-border bg-surface-light p-6 dark:bg-surface-dark">
        <h1 className="text-xl font-bold">Channel analytics unavailable</h1>
        <p className="mt-2 text-sm text-text-muted">{analyticsError || 'The analytics service did not return verifiable data.'}</p>
        <button
          type="button"
          onClick={() => {
            setAnalyticsState('loading');
            setAnalyticsError('');
            setRefreshKey((current) => current + 1);
          }}
          className="mt-4 rounded-control bg-surface-subtle px-4 py-2 text-sm font-semibold hover:bg-surface-hover"
        >
          Retry
        </button>
      </section>
    );
  }

  const selectedChannel = profile.channels.find((channel) => channel.id === activeChannelId);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channel overview</h1>
          <p className="mt-1 text-sm text-text-muted">Recorded performance for the selected channel and date range.</p>
        </div>
        <Link to="/studio/content" className="text-sm font-semibold text-brand-dark hover:underline">Manage content</Link>
      </header>

      <form
        className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface-light p-4 dark:bg-surface-dark"
        onSubmit={(event) => {
          event.preventDefault();
          setAnalyticsState('loading');
          setAnalyticsError('');
          setRefreshKey((current) => current + 1);
        }}
      >
        {profile.channels.length > 1 && (
          <label className="min-w-52 flex-1 text-sm font-medium">
            Channel
            <select
              value={selectedChannelId}
              onChange={(event) => {
                setAnalyticsState('loading');
                setAnalyticsError('');
                setSelectedChannelId(event.target.value);
              }}
              className="mt-1 w-full rounded-control border border-border bg-canvas-light px-3 py-2 dark:bg-canvas-obsidian"
            >
              {profile.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name} ({channel.handle})</option>
              ))}
            </select>
          </label>
        )}
        {profile.channels.length === 1 && <p className="mr-auto text-sm font-semibold">{selectedChannel?.name}</p>}
        <label className="text-sm font-medium">
          From
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(event) => {
              setAnalyticsState('loading');
              setAnalyticsError('');
              setDateFrom(event.target.value);
            }}
            required
            className="mt-1 block rounded-control border border-border bg-canvas-light px-3 py-2 dark:bg-canvas-obsidian"
          />
        </label>
        <label className="text-sm font-medium">
          To
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            max={today}
            onChange={(event) => {
              setAnalyticsState('loading');
              setAnalyticsError('');
              setDateTo(event.target.value);
            }}
            required
            className="mt-1 block rounded-control border border-border bg-canvas-light px-3 py-2 dark:bg-canvas-obsidian"
          />
        </label>
        <button type="submit" className="rounded-control bg-surface-subtle px-4 py-2 text-sm font-semibold hover:bg-surface-hover">
          Update report
        </button>
      </form>

      <section aria-label="Channel metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <MetricCard label="Subscribers" value={new Intl.NumberFormat().format(analytics.subscriberCount)} icon={<Users className="h-5 w-5" />} />
        <MetricCard label="Views in period" value={new Intl.NumberFormat().format(analytics.totalViews)} icon={<Eye className="h-5 w-5" />} />
        <MetricCard label="Watch time in period" value={`${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(analytics.totalWatchHours)} hrs`} icon={<Clock3 className="h-5 w-5" />} />
        <article className="flex min-h-36 flex-col justify-between rounded-card border border-border bg-surface-light p-5 dark:bg-surface-dark">
          <div className="flex items-center gap-2 text-sm font-medium text-text-muted"><Wallet className="h-5 w-5" /> Earnings and payouts</div>
          <p className="text-sm font-semibold">Unavailable</p>
          <p className="text-xs text-text-muted">No verified ad allocations or payment integration are configured.</p>
        </article>
      </section>

      <section className="min-w-0 overflow-hidden rounded-card border border-border bg-surface-light dark:bg-surface-dark">
        <div className="border-b border-divider px-5 py-4">
          <h2 className="font-semibold">Video performance</h2>
          <p className="mt-1 text-xs text-text-muted">
            {analytics.period.from} to {analytics.period.to}. Views, watch time, likes, and comments are backed by recorded events.
          </p>
        </div>
        {analytics.recentPerformance.length === 0 ? (
          <p className="p-6 text-sm text-text-muted">No valid view events were recorded for this channel during the selected period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-surface-subtle text-text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Video</th>
                  <th scope="col" className="px-4 py-3 font-medium">Views</th>
                  <th scope="col" className="px-4 py-3 font-medium">Watch hours</th>
                  <th scope="col" className="px-4 py-3 font-medium">Likes</th>
                  <th scope="col" className="px-4 py-3 font-medium">Comments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {analytics.recentPerformance.map((video) => (
                  <tr key={video.id} className="hover:bg-surface-hover">
                    <td className="max-w-xs px-4 py-3 font-medium">
                      <Link to={`/watch/${encodeURIComponent(video.id)}?from=studio`} className="line-clamp-2 hover:text-brand-dark hover:underline">
                        {video.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{new Intl.NumberFormat().format(video.views)}</td>
                    <td className="px-4 py-3 tabular-nums">{new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(video.watchHours)}</td>
                    <td className="px-4 py-3 tabular-nums">{new Intl.NumberFormat().format(video._count.likes)}</td>
                    <td className="px-4 py-3 tabular-nums">{new Intl.NumberFormat().format(video._count.comments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <article className="flex min-h-36 flex-col justify-between rounded-card border border-border bg-surface-light p-5 dark:bg-surface-dark">
      <div className="flex items-center gap-2 text-sm font-medium text-text-muted">
        {icon}
        {label}
      </div>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
    </article>
  );
}
