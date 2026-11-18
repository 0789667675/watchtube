import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import axios from 'axios';
import { Link, useOutletContext } from 'react-router-dom';
import { ArrowUpRight, Clock3, Eye, Users, Wallet } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import { isStudioAnalytics, isStudioLedger, isStudioWalletBalance } from './studioApi';
import type {
  StudioAnalytics,
  StudioLedgerEntry,
  StudioOutletContext,
  StudioWalletBalance,
} from './studioApi';

type AnalyticsState = 'loading' | 'ready' | 'no-channel' | 'unavailable';

function isPayoutSubmission(value: unknown): value is { id: string; status: 'PENDING'; amountCents: string } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'id' in value
    && typeof value.id === 'string'
    && 'status' in value
    && value.status === 'PENDING'
    && 'amountCents' in value
    && typeof value.amountCents === 'string'
    && /^-\d+$/.test(value.amountCents);
}

function formatRwfFromCents(value: string): string {
  const amount = Number(value) / 100;
  if (!Number.isFinite(amount)) return 'Unavailable';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'RWF',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function DashboardPage() {
  const { profile } = useOutletContext<StudioOutletContext>();
  const [analytics, setAnalytics] = useState<StudioAnalytics | null>(null);
  const [analyticsState, setAnalyticsState] = useState<AnalyticsState>('loading');
  const [analyticsError, setAnalyticsError] = useState('');
  const [wallet, setWallet] = useState<StudioWalletBalance | null>(null);
  const [walletError, setWalletError] = useState('');
  const [ledger, setLedger] = useState<StudioLedgerEntry[] | null>(null);
  const [ledgerError, setLedgerError] = useState('');
  const [isPayoutOpen, setIsPayoutOpen] = useState(false);
  const [isSubmittingPayout, setIsSubmittingPayout] = useState(false);
  const [payoutError, setPayoutError] = useState('');
  const [payoutNotice, setPayoutNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (profile.channels.length === 0) return;
    const controller = new AbortController();
    const config = { signal: controller.signal };

    void Promise.allSettled([
      apiClient.get<unknown>('/api/v1/studio/analytics', config),
      apiClient.get<unknown>('/api/v1/wallet/balance', config),
      apiClient.get<unknown>('/api/v1/wallet/ledger', config),
    ]).then(([analyticsResult, balanceResult, ledgerResult]) => {
      if (controller.signal.aborted) return;

      if (analyticsResult.status === 'fulfilled' && isStudioAnalytics(analyticsResult.value.data)) {
        setAnalytics(analyticsResult.value.data);
        setAnalyticsState('ready');
        setAnalyticsError('');
      } else if (
        analyticsResult.status === 'rejected' &&
        axios.isAxiosError(analyticsResult.reason) &&
        analyticsResult.reason.response?.status === 404
      ) {
        setAnalyticsState('no-channel');
      } else {
        const reason = analyticsResult.status === 'rejected'
          ? analyticsResult.reason
          : undefined;
        setAnalyticsState('unavailable');
        setAnalyticsError(
          reason
            ? getApiErrorMessage(reason, 'Channel analytics are unavailable right now.')
            : 'The analytics response could not be verified.',
        );
      }

      if (balanceResult.status === 'fulfilled' && isStudioWalletBalance(balanceResult.value.data)) {
        setWallet(balanceResult.value.data);
        setWalletError('');
      } else {
        setWallet(null);
        setWalletError(balanceResult.status === 'rejected'
          ? getApiErrorMessage(balanceResult.reason, 'Wallet balance is unavailable.')
          : 'Wallet balance could not be verified.');
      }

      if (ledgerResult.status === 'fulfilled' && isStudioLedger(ledgerResult.value.data)) {
        setLedger(ledgerResult.value.data);
        setLedgerError('');
      } else {
        setLedger(null);
        setLedgerError(ledgerResult.status === 'rejected'
          ? getApiErrorMessage(ledgerResult.reason, 'Wallet history is unavailable.')
          : 'Wallet history could not be verified.');
      }
    });

    return () => controller.abort();
  }, [profile.channels.length, refreshKey]);

  const requestPayout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!wallet || isSubmittingPayout) return;

    const formData = new FormData(event.currentTarget);
    const amountRwf = Number(formData.get('amountRwf'));
    const amountCents = amountRwf * 100;
    const provider = formData.get('provider');
    const phoneNumber = formData.get('phoneNumber');
    const balanceCents = Number(wallet.balanceCents);

    if (
      !Number.isSafeInteger(amountRwf) ||
      amountRwf < 1 ||
      !Number.isSafeInteger(amountCents) ||
      !Number.isSafeInteger(balanceCents) ||
      amountCents > balanceCents ||
      (provider !== 'MTN_MOMO' && provider !== 'AIRTEL_MONEY') ||
      typeof phoneNumber !== 'string' ||
      !phoneNumber.trim()
    ) {
      setPayoutError('Enter a whole RWF amount within your available balance and a phone number.');
      return;
    }

    setPayoutError('');
    setPayoutNotice('');
    setIsSubmittingPayout(true);
    try {
      const { data } = await apiClient.post<unknown>('/api/v1/wallet/request-payout', {
        amountCents,
        provider,
        phoneNumber: phoneNumber.trim(),
      });
      if (!isPayoutSubmission(data)) {
        throw new Error('The server did not confirm a pending payout request.');
      }
      setIsPayoutOpen(false);
      setPayoutNotice(`Payout request ${data.id} was recorded as pending. Payment is not yet confirmed.`);
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setPayoutError(getApiErrorMessage(requestError, 'The payout request could not be confirmed.'));
    } finally {
      setIsSubmittingPayout(false);
    }
  };

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
            setRefreshKey((current) => current + 1);
          }}
          className="mt-4 rounded-control bg-surface-subtle px-4 py-2 text-sm font-semibold hover:bg-surface-hover"
        >
          Retry
        </button>
      </section>
    );
  }

  const availableRwf = Math.floor(Number(wallet?.balanceCents ?? 0) / 100);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channel overview</h1>
          <p className="mt-1 text-sm text-text-muted">Performance and creator account activity reported by WatchTube.</p>
        </div>
        <Link to="/studio/content" className="text-sm font-semibold text-brand-dark hover:underline">Manage content</Link>
      </header>

      {payoutNotice && (
        <p role="status" className="rounded-control border border-border bg-surface-light p-4 text-sm dark:bg-surface-dark">
          {payoutNotice}
        </p>
      )}

      <section aria-label="Channel metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <MetricCard label="Subscribers" value={new Intl.NumberFormat().format(analytics.subscriberCount)} icon={<Users className="h-5 w-5" />} />
        <MetricCard label="Total views" value={new Intl.NumberFormat().format(analytics.totalViews)} icon={<Eye className="h-5 w-5" />} />
        <MetricCard label="Watch time" value={`${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(analytics.totalWatchHours)} hrs`} icon={<Clock3 className="h-5 w-5" />} />
        <div className="flex min-h-36 flex-col justify-between rounded-card border border-border bg-surface-light p-5 dark:bg-surface-dark">
          <div className="flex items-center justify-between gap-3 text-sm text-text-muted">
            <span className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Wallet balance</span>
            <button
              type="button"
              onClick={() => { setPayoutError(''); setIsPayoutOpen(true); }}
              disabled={!wallet || availableRwf < 1}
              className="inline-flex items-center gap-1 rounded-control bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Request payout <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5 text-2xl font-bold tabular-nums">
            {wallet ? formatRwfFromCents(wallet.balanceCents) : 'Unavailable'}
          </div>
          {!wallet && <p className="mt-1 text-xs text-text-muted">{walletError}</p>}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div id="analytics" className="min-w-0 overflow-hidden rounded-card border border-border bg-surface-light dark:bg-surface-dark">
          <div className="border-b border-divider px-5 py-4">
            <h2 className="font-semibold">Recent video performance</h2>
            <p className="mt-1 text-xs text-text-muted">Actual totals returned by the Studio analytics API.</p>
          </div>
          {analytics.recentPerformance.length === 0 ? (
            <p className="p-6 text-sm text-text-muted">No video performance is available yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-surface-subtle text-text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Video</th>
                    <th scope="col" className="px-4 py-3 font-medium">Views</th>
                    <th scope="col" className="px-4 py-3 font-medium">Likes</th>
                    <th scope="col" className="px-4 py-3 font-medium">Comments</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {analytics.recentPerformance.map((video) => (
                    <tr key={video.id} className="hover:bg-surface-hover">
                      <td className="max-w-xs px-4 py-3 font-medium"><span className="line-clamp-2">{video.title}</span></td>
                      <td className="px-4 py-3 tabular-nums">{new Intl.NumberFormat().format(video.viewsCount)}</td>
                      <td className="px-4 py-3 tabular-nums">{new Intl.NumberFormat().format(video._count.likes)}</td>
                      <td className="px-4 py-3 tabular-nums">{new Intl.NumberFormat().format(video._count.comments)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <section id="payouts" className="overflow-hidden rounded-card border border-border bg-surface-light dark:bg-surface-dark">
          <div className="border-b border-divider px-5 py-4">
            <h2 className="font-semibold">Wallet activity</h2>
            <p className="mt-1 text-xs text-text-muted">Transactions and statuses returned by the wallet API.</p>
          </div>
          {ledger === null ? (
            <p role="status" className="p-5 text-sm text-text-muted">{ledgerError || 'Wallet history is unavailable.'}</p>
          ) : ledger.length === 0 ? (
            <p className="p-5 text-sm text-text-muted">No wallet transactions yet.</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-divider overflow-y-auto">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{entry.transactionType}</p>
                    <time className="text-xs text-text-muted">{new Date(entry.createdAt).toLocaleDateString()}</time>
                    {'status' in entry && typeof entry.status === 'string' && (
                      <span className="ml-2 text-xs text-text-muted">{entry.status}</span>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{formatRwfFromCents(entry.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      {isPayoutOpen && wallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payout-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface-light p-5 shadow-xl dark:bg-surface-dark sm:p-6"
          >
            <h2 id="payout-title" className="text-xl font-bold">Request payout</h2>
            <p className="mt-1 text-sm text-text-muted">Available: {formatRwfFromCents(wallet.balanceCents)}</p>
            <p className="mt-2 text-xs text-text-muted">A submitted request is recorded as pending; this does not confirm a completed transfer.</p>
            <form onSubmit={requestPayout} className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                Amount (RWF)
                <input
                  name="amountRwf"
                  type="number"
                  min="1"
                  max={availableRwf}
                  step="1"
                  required
                  disabled={isSubmittingPayout}
                  className="mt-1 w-full rounded-control border border-border bg-canvas-light px-4 py-2 dark:bg-canvas-obsidian"
                />
              </label>
              <label className="block text-sm font-medium">
                Payout provider
                <select name="provider" required disabled={isSubmittingPayout} className="mt-1 w-full rounded-control border border-border bg-canvas-light px-4 py-2 dark:bg-canvas-obsidian">
                  <option value="MTN_MOMO">MTN Mobile Money</option>
                  <option value="AIRTEL_MONEY">Airtel Money</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Phone number
                <input
                  name="phoneNumber"
                  type="tel"
                  autoComplete="tel"
                  required
                  disabled={isSubmittingPayout}
                  placeholder="Mobile Money number"
                  className="mt-1 w-full rounded-control border border-border bg-canvas-light px-4 py-2 dark:bg-canvas-obsidian"
                />
              </label>
              {payoutError && <p role="alert" className="text-sm text-status-warning">{payoutError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" disabled={isSubmittingPayout} onClick={() => setIsPayoutOpen(false)} className="rounded-control px-4 py-2 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingPayout} className="rounded-control bg-brand-action px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-action-hover disabled:opacity-50">
                  {isSubmittingPayout ? 'Submitting…' : 'Submit request'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
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
