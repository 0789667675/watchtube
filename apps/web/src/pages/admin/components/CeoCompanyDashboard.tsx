import React, { useEffect, useState } from 'react';
import { apiClient } from '../../../api/apiClient';
import {
  Users,
  Video,
  DollarSign,
  Shield,
  Activity,
  AlertTriangle,
  Server,
  Database,
  Cloud,
  CheckCircle2,
  RefreshCw,
  Clock,
} from 'lucide-react';

interface CompanyOverviewData {
  users: {
    total: number;
    activeLast30Days: number;
    newLast7Days: number;
    newLast30Days: number;
  };
  creators: {
    totalChannels: number;
    verifiedChannels: number;
    monetizedChannels: number;
  };
  content: {
    totalVideos: number;
    publishedVideos: number;
    shortsCount: number;
    standardVideosCount: number;
    totalViews: number;
  };
  engagement: {
    totalSubscriptions: number;
  };
}

interface FinancialData {
  summary: {
    grossAdRevenueCents: string;
    platformShareCents: string;
    creatorPoolCents: string;
    totalPayoutsCents: string;
    activeEscrowHeldCents: string;
    currency: string;
  };
  reconciliationStatus: {
    isConfigured: boolean;
    message: string;
  };
  recentTransactions: Array<{
    id: string;
    type: string;
    amountCents: string;
    balanceAfterCents: string;
    status: string;
    referenceId: string;
    createdAt: string;
    channel?: { name: string; handle: string };
  }>;
}

interface HealthData {
  apiHealth: string;
  database: string;
  storage: {
    status: string;
    missing: string[];
  };
  redisQueue: {
    status: string;
  };
  timestamp: string;
}

export const CeoCompanyDashboard: React.FC = () => {
  const [overview, setOverview] = useState<CompanyOverviewData | null>(null);
  const [finances, setFinances] = useState<FinancialData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    const fetchCeoData = async () => {
      setIsLoading(true);
      setError('');
      try {
        const [overviewRes, financeRes, healthRes] = await Promise.all([
          apiClient.get<CompanyOverviewData>('/api/v1/admin/ceo/overview'),
          apiClient.get<FinancialData>('/api/v1/admin/ceo/financial-intelligence'),
          apiClient.get<HealthData>('/api/v1/admin/platform/health'),
        ]);

        if (isCurrent) {
          setOverview(overviewRes.data);
          setFinances(financeRes.data);
          setHealth(healthRes.data);
        }
      } catch (err: any) {
        if (isCurrent) {
          setError(err.response?.data?.error || 'Unable to load company intelligence.');
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    fetchCeoData();
    return () => {
      isCurrent = false;
    };
  }, [refreshKey]);

  const formatCents = (centsStr: string | undefined) => {
    if (!centsStr) return '0 RWF';
    try {
      const num = Number(centsStr);
      return `${num.toLocaleString()} RWF`;
    } catch {
      return `${centsStr} RWF`;
    }
  };

  if (isLoading) {
    return (
      <div className="py-16 text-center text-text-muted space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-dark" />
        <p className="text-sm">Aggregating platform intelligence and company ledger…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 space-y-2">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>Access Restricted or Failed</span>
        </div>
        <p className="text-sm">{error}</p>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-control bg-surface-light dark:bg-surface-dark border border-border"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-border-light dark:border-border-dark">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-dark" />
            <h2 className="text-xl font-bold font-display">Executive Platform &amp; Financial Overview</h2>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Founder &amp; SUPER_ADMIN exclusive view · Database-verified company metrics
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-control text-xs font-medium border border-border bg-surface-light dark:bg-surface-dark hover:bg-surface-hover transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh Intelligence
        </button>
      </div>

      {/* High-level company metrics cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Users */}
        <div className="p-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Users</span>
            <Users className="w-4 h-4 text-brand-dark" />
          </div>
          <div className="text-2xl font-bold font-display">{overview?.users.total.toLocaleString()}</div>
          <div className="text-xs text-text-muted mt-2 space-y-0.5">
            <div>{overview?.users.activeLast30Days.toLocaleString()} active in last 30d</div>
            <div className="text-status-success font-medium">+{overview?.users.newLast7Days} new this week</div>
          </div>
        </div>

        {/* Creators */}
        <div className="p-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Creators &amp; Channels</span>
            <Video className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold font-display">{overview?.creators.totalChannels.toLocaleString()}</div>
          <div className="text-xs text-text-muted mt-2 space-y-0.5">
            <div>{overview?.creators.verifiedChannels.toLocaleString()} verified channels</div>
            <div>{overview?.creators.monetizedChannels.toLocaleString()} enrolled in WTPP</div>
          </div>
        </div>

        {/* Content & Playback */}
        <div className="p-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Content &amp; Views</span>
            <Activity className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold font-display">{overview?.content.totalViews.toLocaleString()} views</div>
          <div className="text-xs text-text-muted mt-2 space-y-0.5">
            <div>{overview?.content.publishedVideos.toLocaleString()} published videos</div>
            <div>{overview?.content.shortsCount.toLocaleString()} Shorts · {overview?.content.standardVideosCount.toLocaleString()} Long</div>
          </div>
        </div>

        {/* Subscriptions */}
        <div className="p-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm">
          <div className="flex items-center justify-between text-text-muted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Audience Retention</span>
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          </div>
          <div className="text-2xl font-bold font-display">{overview?.engagement.totalSubscriptions.toLocaleString()}</div>
          <div className="text-xs text-text-muted mt-2">
            Active channel follow relationships across the platform
          </div>
        </div>
      </div>

      {/* Financial Intelligence (SUPER_ADMIN ONLY) */}
      <div className="p-6 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <DollarSign className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-bold font-display">Company Financial Intelligence</h3>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
            CEO Confidential
          </span>
        </div>

        {/* Financial Numbers Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark">
            <div className="text-xs text-text-muted">Gross Ad Revenue</div>
            <div className="text-xl font-bold mt-1 text-green-600 font-display">
              {formatCents(finances?.summary.grossAdRevenueCents)}
            </div>
            <div className="text-[11px] text-text-muted mt-1">Total recorded ad impressions</div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark">
            <div className="text-xs text-text-muted">Platform Share</div>
            <div className="text-xl font-bold mt-1 text-brand-dark font-display">
              {formatCents(finances?.summary.platformShareCents)}
            </div>
            <div className="text-[11px] text-text-muted mt-1">WatchTube operating share</div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark">
            <div className="text-xs text-text-muted">Creator Earnings Pool</div>
            <div className="text-xl font-bold mt-1 text-purple-600 font-display">
              {formatCents(finances?.summary.creatorPoolCents)}
            </div>
            <div className="text-[11px] text-text-muted mt-1">Creator allocation pool</div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark">
            <div className="text-xs text-text-muted">Active Copyright Escrows</div>
            <div className="text-xl font-bold mt-1 text-amber-600 font-display">
              {formatCents(finances?.summary.activeEscrowHeldCents)}
            </div>
            <div className="text-[11px] text-text-muted mt-1">Temporarily withheld during disputes</div>
          </div>
        </div>

        {/* Honest Disclosure Alert */}
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-text-muted space-y-1">
          <div className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Provider Settlement Status
          </div>
          <p>{finances?.reconciliationStatus.message}</p>
        </div>

        {/* Recent Transactions Ledger */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Recent Platform Ledger Transactions
          </h4>
          {finances?.recentTransactions && finances.recentTransactions.length > 0 ? (
            <div className="overflow-x-auto border border-border-light dark:border-border-dark rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-subtle border-b border-border-light dark:border-border-dark text-text-muted">
                  <tr>
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Channel</th>
                    <th className="p-2.5">Type</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5">Balance After</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light dark:divide-border-dark">
                  {finances.recentTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-surface-hover/50">
                      <td className="p-2.5 text-text-muted">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-2.5 font-medium">
                        {tx.channel?.name || 'Platform'}
                      </td>
                      <td className="p-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-subtle border border-border">
                          {tx.type}
                        </span>
                      </td>
                      <td className="p-2.5 font-semibold text-green-600">
                        {formatCents(tx.amountCents)}
                      </td>
                      <td className="p-2.5 text-text-muted">
                        {formatCents(tx.balanceAfterCents)}
                      </td>
                      <td className="p-2.5">
                        <span className="text-status-success font-medium">{tx.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-text-muted italic py-3 text-center">
              No recent wallet transactions recorded.
            </p>
          )}
        </div>
      </div>

      {/* Platform Health & Infrastructure Indicators */}
      <div className="p-6 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-brand-dark" />
          <h3 className="text-lg font-bold font-display">System Architecture Health</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark space-y-1">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Activity className="w-4 h-4 text-status-success" /> API Server
            </div>
            <div className="font-semibold text-status-success">{health?.apiHealth}</div>
            <div className="text-[11px] text-text-muted">Loopback / Authenticated CORS</div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark space-y-1">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Database className="w-4 h-4 text-status-success" /> PostgreSQL Database
            </div>
            <div className="font-semibold text-status-success">{health?.database}</div>
            <div className="text-[11px] text-text-muted">Prisma Engine &amp; Migrations</div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark space-y-1">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Cloud className="w-4 h-4 text-brand-dark" /> Cloudflare R2 Storage
            </div>
            <div className="font-semibold">{health?.storage.status}</div>
            <div className="text-[11px] text-text-muted">
              {health?.storage.missing.length === 0 ? 'Raw & Public Buckets Ready' : `Missing: ${health?.storage.missing.join(', ')}`}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark space-y-1">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Clock className="w-4 h-4 text-blue-500" /> BullMQ Video Queue
            </div>
            <div className="font-semibold">{health?.redisQueue.status}</div>
            <div className="text-[11px] text-text-muted">Transcode job workers</div>
          </div>
        </div>
      </div>
    </div>
  );
};
