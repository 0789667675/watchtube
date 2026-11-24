import React, { useState } from 'react';
import { apiClient } from '../../../api/apiClient';
import { Search, ShieldCheck, Lock, AlertCircle } from 'lucide-react';

interface CreatorFinancialSummary {
  channelId: string;
  channelName: string;
  handle?: string;
  isMonetized: boolean;
  totalSubscribers: number;
  totalVideos: number;
  earnings: {
    totalEarnedCents: number;
    pendingPayoutCents: number;
    paidOutCents: number;
    currency: string;
  };
  subscriptions: {
    activeSubscribers: number;
    monthlySubscriptionRevenueCents: number;
  };
  recentTransactions?: Array<{
    id: string;
    type: string;
    amountCents: number;
    status: string;
    createdAt: string;
  }>;
}

export const CreatorFinancialLookup: React.FC = () => {
  const [channelIdInput, setChannelIdInput] = useState('');
  const [summary, setSummary] = useState<CreatorFinancialSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = channelIdInput.trim();
    if (!id) return;

    setIsLoading(true);
    setError('');
    setSummary(null);
    try {
      const res = await apiClient.get<CreatorFinancialSummary>(
        `/api/v1/admin/creator-support/channels/${id}/financial-summary`
      );
      setSummary(res.data);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setError('Access denied: You do not have the required permission (finance.creator_support_view) to inspect creator financial data.');
      } else if (err?.response?.status === 404) {
        setError('Channel not found or has no financial records.');
      } else {
        setError('Failed to retrieve creator financial summary.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const formatCents = (cents: number) => {
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-text-primary">Creator Financial Support Lookup</h2>
          <span className="flex items-center gap-1 rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-semibold text-text-secondary border border-border-light dark:border-border-dark">
            <Lock className="w-3 h-3 text-brand-primary" /> Creator-Scoped Support Only
          </span>
        </div>
        <p className="text-sm text-text-muted mt-1">
          Inspect channel-specific earnings, monetization standing, and pending payouts to resolve creator support inquiries.
          Platform-wide financial models, aggregate revenue, and operating expenses remain restricted to executive oversight.
        </p>
      </div>

      {/* Lookup Form */}
      <form onSubmit={handleLookup} className="flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            required
            value={channelIdInput}
            onChange={(e) => setChannelIdInput(e.target.value)}
            placeholder="Enter Channel UUID to inspect..."
            className="w-full rounded-control border border-border-light bg-canvas-light pl-9 pr-3 py-2 text-sm text-text-primary focus:border-brand-primary dark:border-border-dark dark:bg-canvas-obsidian"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-control bg-brand-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-primary/90 disabled:opacity-50"
        >
          {isLoading ? 'Looking up…' : 'Inspect Channel'}
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-card border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Financial Details Card */}
      {summary && (
        <div className="space-y-6">
          <div className="rounded-card border border-border-light bg-surface-raised p-6 shadow-sm dark:border-border-dark space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-light pb-4 dark:border-border-dark">
              <div>
                <h3 className="text-xl font-bold text-text-primary">{summary.channelName}</h3>
                <div className="text-xs text-text-muted font-mono">
                  {summary.handle ? `@${summary.handle} • ` : ''}ID: {summary.channelId}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                    summary.isMonetized
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {summary.isMonetized ? 'WTPP Monetized' : 'Monetization Inactive'}
                </span>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-control bg-surface-subtle p-4">
                <div className="text-xs font-medium text-text-muted">Total Earned</div>
                <div className="mt-1 text-lg font-bold text-text-primary">
                  {formatCents(summary.earnings?.totalEarnedCents ?? 0)}
                </div>
              </div>
              <div className="rounded-control bg-surface-subtle p-4">
                <div className="text-xs font-medium text-text-muted">Pending Balance</div>
                <div className="mt-1 text-lg font-bold text-brand-primary">
                  {formatCents(summary.earnings?.pendingPayoutCents ?? 0)}
                </div>
              </div>
              <div className="rounded-control bg-surface-subtle p-4">
                <div className="text-xs font-medium text-text-muted">Disbursed Payouts</div>
                <div className="mt-1 text-lg font-bold text-text-primary">
                  {formatCents(summary.earnings?.paidOutCents ?? 0)}
                </div>
              </div>
              <div className="rounded-control bg-surface-subtle p-4">
                <div className="text-xs font-medium text-text-muted">Subscribers</div>
                <div className="mt-1 text-lg font-bold text-text-primary">
                  {summary.totalSubscribers.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Subscriptions breakdown */}
            <div className="rounded-control border border-border-light p-4 dark:border-border-dark space-y-2">
              <div className="text-sm font-semibold text-text-primary">Channel Memberships &amp; Subscriptions</div>
              <div className="flex flex-wrap gap-6 text-xs text-text-secondary">
                <div>
                  Active Channel Subscribers: <span className="font-bold text-text-primary">{summary.subscriptions?.activeSubscribers ?? 0}</span>
                </div>
                <div>
                  Estimated Monthly Subscription Run-rate: <span className="font-bold text-text-primary">{formatCents(summary.subscriptions?.monthlySubscriptionRevenueCents ?? 0)}</span>
                </div>
              </div>
            </div>

            {/* Recent Transactions */}
            {summary.recentTransactions && summary.recentTransactions.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-text-primary">Recent Channel Payouts &amp; Settlements</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border-light text-text-muted dark:border-border-dark">
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium">Amount</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {summary.recentTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td className="py-2 font-medium text-text-primary">{tx.type}</td>
                          <td className="py-2 font-mono">{formatCents(tx.amountCents)}</td>
                          <td className="py-2">
                            <span className="rounded bg-surface-subtle px-2 py-0.5 text-[11px] font-medium">
                              {tx.status}
                            </span>
                          </td>
                          <td className="py-2 text-text-muted">{new Date(tx.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
