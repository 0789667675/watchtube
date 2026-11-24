import React, { useEffect, useState } from 'react';
import { apiClient } from '../../../api/apiClient';
import { useAuth } from '../../../auth/useAuth';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface AuditLog {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetResource: string;
  targetId?: string | null;
  outcome: 'SUCCESS' | 'FAILED' | 'DENIED';
  metadata?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  actor?: {
    id: string;
    email: string;
  };
}

interface AuditLogResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const AuditLogsViewer: React.FC = () => {
  const { state } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [targetResource, setTargetResource] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = async (targetPage: number) => {
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', targetPage.toString());
      params.set('limit', '25');
      if (targetResource) params.set('targetResource', targetResource);
      if (actionFilter) params.set('action', actionFilter);
      if (outcomeFilter) params.set('outcome', outcomeFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await apiClient.get<AuditLogResponse>(`/api/v1/admin/audit-logs?${params.toString()}`);
      setLogs(res.data.logs || []);
      setTotal(res.data.total || 0);
      setPage(res.data.page || 1);
      setTotalPages(res.data.totalPages || 1);
    } catch {
      setError('Failed to load audit logs.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, [targetResource, actionFilter, outcomeFilter, startDate, endDate]);

  const toggleExpand = (id: string) => {
    setExpandedLogId(current => (current === id ? null : id));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-text-primary">Platform Audit Logs</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isSuperAdmin
                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                  : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              }`}
            >
              {isSuperAdmin ? 'Full CEO Company Scope' : 'Operational Scope'}
            </span>
          </div>
          <p className="text-sm text-text-muted mt-0.5">
            {isSuperAdmin
              ? 'Complete immutable administrative activity ledger across security, finances, admin assignments, and creator support.'
              : 'Authorized activity record for creator cases, channel operations, and moderation actions.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-card border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={targetResource}
          onChange={(e) => setTargetResource(e.target.value)}
          aria-label="Filter by target resource"
          className="rounded-control border border-border-light bg-surface-subtle px-3 py-1.5 text-xs font-medium text-text-primary dark:border-border-dark"
        >
          <option value="">All Resources</option>
          <option value="USER">User Directory</option>
          <option value="SUPPORT_CASE">Support Cases</option>
          <option value="APPROVAL_REQUEST">Approval Requests</option>
          <option value="REPORT">Moderation Reports</option>
          <option value="WTPP">Partner Program</option>
          <option value="COPYRIGHT">Copyright Claims</option>
          {isSuperAdmin && (
            <>
              <option value="ADMIN_POSITION">Admin Positions</option>
              <option value="ADMIN_INVITATION">Admin Invitations</option>
              <option value="FINANCE">Financial Operations</option>
              <option value="SECURITY">Security Policies</option>
              <option value="EMAIL_OUTBOX">Email Outbox</option>
            </>
          )}
        </select>

        <select
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value)}
          aria-label="Filter by outcome"
          className="rounded-control border border-border-light bg-surface-subtle px-3 py-1.5 text-xs font-medium text-text-primary dark:border-border-dark"
        >
          <option value="">All Outcomes</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="DENIED">Denied</option>
        </select>

        <input
          type="text"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          placeholder="Filter by action (e.g. USER_SUSPENDED)..."
          className="rounded-control border border-border-light bg-surface-subtle px-3 py-1.5 text-xs font-medium text-text-primary placeholder:text-text-muted dark:border-border-dark"
        />

        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span>From:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
            className="rounded-control border border-border-light bg-surface-subtle px-2 py-1 text-xs text-text-primary dark:border-border-dark"
          />
          <span>To:</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End date"
            className="rounded-control border border-border-light bg-surface-subtle px-2 py-1 text-xs text-text-primary dark:border-border-dark"
          />
        </div>

        {(targetResource || actionFilter || outcomeFilter || startDate || endDate) && (
          <button
            type="button"
            onClick={() => {
              setTargetResource('');
              setActionFilter('');
              setOutcomeFilter('');
              setStartDate('');
              setEndDate('');
            }}
            className="text-xs font-medium text-brand-primary hover:underline"
          >
            Reset
          </button>
        )}

        <div className="ml-auto text-xs text-text-muted">
          Showing {logs.length} of {total} records
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-card border border-border-light bg-surface-raised shadow-sm dark:border-border-dark">
        {isLoading ? (
          <div className="p-8 text-center text-text-muted">Loading audit ledger…</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-text-muted">No audit log records found matching filters.</div>
        ) : (
          <div className="divide-y divide-border-light dark:divide-border-dark">
            {logs.map((log) => (
              <div key={log.id} className="p-4 transition hover:bg-surface-subtle/50">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        log.outcome === 'SUCCESS'
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : log.outcome === 'DENIED'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-red-500/10 text-red-600 dark:text-red-400'
                      }`}
                    >
                      {log.outcome === 'SUCCESS' && <CheckCircle2 className="w-3 h-3" />}
                      {log.outcome === 'DENIED' && <AlertTriangle className="w-3 h-3" />}
                      {log.outcome === 'FAILED' && <XCircle className="w-3 h-3" />}
                      {log.outcome}
                    </span>
                    <span className="font-mono font-bold text-text-primary">{log.action}</span>
                    <span className="rounded bg-surface-subtle px-2 py-0.5 text-text-muted">
                      {log.targetResource}
                      {log.targetId ? ` (${log.targetId.slice(0, 8)}…)` : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-text-muted">
                    <div>
                      Actor: <span className="font-medium text-text-secondary">{log.actor?.email || log.actorRole}</span>
                    </div>
                    <div>{new Date(log.createdAt).toLocaleString()}</div>
                    {log.metadata && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(log.id)}
                        className="rounded bg-surface-subtle px-2 py-1 text-text-primary hover:bg-surface-hover"
                      >
                        {expandedLogId === log.id ? 'Hide Details' : 'Details'}
                      </button>
                    )}
                  </div>
                </div>

                {expandedLogId === log.id && log.metadata && (
                  <div className="mt-3 rounded-control bg-canvas-light p-3 text-xs dark:bg-canvas-obsidian border border-border-light dark:border-border-dark">
                    <div className="mb-1 text-text-muted font-medium">Metadata (Sanitized / Redacted):</div>
                    <pre className="font-mono text-text-primary overflow-x-auto text-[11px] leading-relaxed">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                    {log.ipAddress && (
                      <div className="mt-2 text-[11px] text-text-muted">
                        Client IP: {log.ipAddress} {log.userAgent ? `| UA: ${log.userAgent}` : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border-light bg-surface-subtle px-4 py-3 dark:border-border-dark">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => fetchLogs(page - 1)}
              className="flex items-center gap-1 rounded-control px-3 py-1 text-xs font-semibold text-text-primary hover:bg-surface-hover disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <span className="text-xs text-text-muted">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || isLoading}
              onClick={() => fetchLogs(page + 1)}
              className="flex items-center gap-1 rounded-control px-3 py-1 text-xs font-semibold text-text-primary hover:bg-surface-hover disabled:opacity-40"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
