import React, { useEffect, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { ShieldAlert, Users, Scale } from 'lucide-react';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';

type AdminTab = 'REPORTS' | 'WTPP' | 'COPYRIGHT';

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('REPORTS');
  const [reports, setReports] = useState<any[]>([]);
  const [wtpp, setWtpp] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    const fetchAdminData = async () => {
      setIsLoading(true);
      setLoadError('');

      try {
        if (activeTab === 'REPORTS') {
          const res = await apiClient.get('/api/v1/admin/reports');
          if (isCurrent) setReports(res.data);
        } else if (activeTab === 'WTPP') {
          const res = await apiClient.get('/api/v1/admin/wtpp/applications');
          if (isCurrent) setWtpp(res.data);
        } else {
          const res = await apiClient.get('/api/v1/admin/copyright/claims');
          if (isCurrent) setClaims(res.data);
        }
      } catch {
        if (isCurrent) setLoadError('Unable to load this queue. Please try again.');
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    fetchAdminData();
    return () => {
      isCurrent = false;
    };
  }, [activeTab, refreshKey]);

  const dismissReport = async (id: string) => {
    setPendingAction(id);
    setActionError('');
    try {
      await apiClient.patch(`/api/v1/admin/reports/${id}`, { status: 'DISMISSED' });
      setReports(current => current.filter(report => report.id !== id));
    } catch {
      setActionError('Could not dismiss this report. It may have already been resolved.');
    } finally {
      setPendingAction(null);
    }
  };

  const markReportActioned = async (id: string) => {
    setPendingAction(id);
    setActionError('');
    try {
      await apiClient.patch(`/api/v1/admin/reports/${id}`, { status: 'ACTION_TAKEN' });
      setReports(current => current.filter(report => report.id !== id));
    } catch {
      setActionError('Could not update this report. It may have already been resolved.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleWTPP = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    const reviewerNotes = reviewNotes[id]?.trim() ?? '';
    if (status === 'REJECTED' && !reviewerNotes) {
      setActionError('Enter a review reason before rejecting an application.');
      return;
    }

    setPendingAction(id);
    setActionError('');
    try {
      await apiClient.patch(`/api/v1/admin/wtpp/applications/${id}`, {
        status,
        ...(reviewerNotes ? { reviewerNotes } : {}),
      });
      setWtpp(current => current.filter(application => application.id !== id));
      setReviewNotes(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch {
      setActionError('Could not update this application. It may have already been reviewed.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleCopyrightClaim = async (id: string, status: 'APPROVED_TAKEDOWN' | 'REJECTED') => {
    setPendingAction(id);
    setActionError('');
    try {
      await apiClient.patch(`/api/v1/admin/copyright/claims/${id}`, { status });
      setClaims(current => current.filter(claim => claim.id !== id));
    } catch {
      setActionError('Could not update this claim. It may have already been resolved.');
    } finally {
      setPendingAction(null);
    }
  };

  const tabClass = (tab: AdminTab) =>
    `flex shrink-0 items-center gap-2 border-b-2 pb-3 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
      activeTab === tab
        ? 'border-brand-primary text-brand-light dark:text-brand-dark'
        : 'border-transparent text-text-muted hover:text-text-primary'
    }`;

  const actionButtonClass =
    'rounded-control px-3 py-1 text-sm font-medium transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <ApertureLogo className="shrink-0" />
          <h1 className="text-xl font-bold font-display md:text-2xl">Trust &amp; Safety Portal</h1>
        </div>
        <ThemeToggle />
      </div>

      <div role="tablist" aria-label="Admin queues" className="mb-6 flex gap-4 overflow-x-auto border-b border-border-light dark:border-border-dark">
        <button type="button" role="tab" aria-selected={activeTab === 'REPORTS'} onClick={() => setActiveTab('REPORTS')} className={tabClass('REPORTS')}>
          <ShieldAlert className="w-4 h-4" /> Moderation Queue
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'WTPP'} onClick={() => setActiveTab('WTPP')} className={tabClass('WTPP')}>
          <Users className="w-4 h-4" /> Partner Program (WTPP)
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'COPYRIGHT'} onClick={() => setActiveTab('COPYRIGHT')} className={tabClass('COPYRIGHT')}>
          <Scale className="w-4 h-4" /> Copyright Disputes
        </button>
      </div>

      <div className="overflow-hidden rounded-card border border-border-light bg-surface-raised shadow-sm dark:border-border-dark">
        <div className="p-6" role="tabpanel">
          {isLoading && <div role="status" className="mb-4 text-text-muted">Loading queue…</div>}
          {loadError && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3" role="alert">
              <span>{loadError}</span>
              <button type="button" onClick={() => setRefreshKey(key => key + 1)} className={actionButtonClass}>Retry</button>
            </div>
          )}
          {actionError && <div className="mb-4" role="alert">{actionError}</div>}

          {activeTab === 'REPORTS' && (
            <>
              <h2 className="mb-4 font-bold">Open Reports</h2>
              {reports.map(report => (
                <div key={report.id} className="mb-4 flex flex-col justify-between gap-4 rounded-lg border border-border-light p-4 dark:border-border-dark md:flex-row md:items-center">
                  <div className="min-w-0">
                    <div className="font-bold">{report.reason} on {report.targetType}</div>
                    <div className="text-sm text-text-muted">{report.details || 'No additional details provided.'}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button type="button" disabled={pendingAction !== null} onClick={() => dismissReport(report.id)} className={`${actionButtonClass} bg-surface-subtle`}>
                      {pendingAction === report.id ? 'Saving…' : 'Dismiss'}
                    </button>
                    <button type="button" disabled={pendingAction !== null} onClick={() => markReportActioned(report.id)} className={`${actionButtonClass} bg-red-600 text-white`}>
                      {pendingAction === report.id ? 'Saving…' : 'Mark action taken'}
                    </button>
                  </div>
                </div>
              ))}
              {!isLoading && !loadError && reports.length === 0 && <div className="text-text-muted">Queue is clear.</div>}
            </>
          )}

          {activeTab === 'WTPP' && (
            <>
              <h2 className="mb-4 font-bold">Pending WTPP Applications</h2>
              {wtpp.map(application => (
                <div key={application.id} className="mb-4 flex flex-col justify-between gap-4 rounded-lg border border-border-light p-4 dark:border-border-dark md:flex-row md:items-center">
                  <div className="min-w-0">
                    <div className="font-bold">{application.channel?.name || 'Unknown channel'} ({application.channel?.handle || 'No handle'})</div>
                    <div className="text-sm text-text-muted">
                      Submitted {new Date(application.submittedAt).toLocaleDateString()}.
                      {` ${application.subscriberCount} subscribers and ${Number(application.channelWatchHours || 0).toFixed(1)} watch hours at submission (context only; not eligibility thresholds).`}
                    </div>
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-2 md:w-72">
                    <label className="text-xs font-medium text-text-muted">
                      Reviewer note (required to reject)
                      <textarea
                        value={reviewNotes[application.id] ?? ''}
                        onChange={event => setReviewNotes(current => ({
                          ...current,
                          [application.id]: event.target.value,
                        }))}
                        rows={2}
                        maxLength={1000}
                        className="mt-1 w-full rounded-control border border-border-light bg-canvas-light p-2 text-sm text-text-primary dark:border-border-dark dark:bg-canvas-obsidian"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={pendingAction !== null} onClick={() => handleWTPP(application.id, 'REJECTED')} className={`${actionButtonClass} bg-surface-subtle text-red-600`}>
                      {pendingAction === application.id ? 'Saving…' : 'Reject'}
                    </button>
                    <button type="button" disabled={pendingAction !== null} onClick={() => handleWTPP(application.id, 'APPROVED')} className={`${actionButtonClass} bg-green-600 text-white`}>
                      {pendingAction === application.id ? 'Saving…' : 'Approve Partner'}
                    </button>
                    </div>
                  </div>
                </div>
              ))}
              {!isLoading && !loadError && wtpp.length === 0 && <div className="text-text-muted">Queue is clear.</div>}
            </>
          )}

          {activeTab === 'COPYRIGHT' && (
            <>
              <h2 className="mb-4 font-bold">Copyright Takedown Requests</h2>
              {claims.map(claim => (
                <div key={claim.id} className="mb-4 flex flex-col justify-between gap-4 rounded-lg border border-border-light p-4 dark:border-border-dark md:flex-row md:items-center">
                  <div className="min-w-0">
                    <div className="font-bold">{claim.video?.title || 'Video unavailable'}</div>
                    <div className="line-clamp-2 text-sm text-text-muted">{claim.description}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button type="button" disabled={pendingAction !== null} onClick={() => handleCopyrightClaim(claim.id, 'REJECTED')} className={`${actionButtonClass} bg-surface-subtle`}>
                      {pendingAction === claim.id ? 'Saving…' : 'Reject claim'}
                    </button>
                    <button type="button" disabled={pendingAction !== null} onClick={() => handleCopyrightClaim(claim.id, 'APPROVED_TAKEDOWN')} className={`${actionButtonClass} bg-red-600 text-white`}>
                      {pendingAction === claim.id ? 'Saving…' : 'Approve takedown'}
                    </button>
                  </div>
                </div>
              ))}
              {!isLoading && !loadError && claims.length === 0 && <div className="text-text-muted">Queue is clear.</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
