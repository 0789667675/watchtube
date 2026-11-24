import React, { useEffect, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { useAuth } from '../../auth/useAuth';
import {
  ShieldAlert,
  Users,
  Scale,
  LifeBuoy,
  FileCheck2,
  DollarSign,
  ScrollText,
  UserCheck,
  LayoutDashboard,
  Activity,
  UserCog,
} from 'lucide-react';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';
import { Link } from 'react-router-dom';

// Admin Sub-components
import { CeoCompanyDashboard } from './components/CeoCompanyDashboard';
import { AdminPositionsManager } from './components/AdminPositionsManager';
import { SupportCaseManager } from './components/SupportCaseManager';
import { ApprovalRequestsManager } from './components/ApprovalRequestsManager';
import { AuditLogsViewer } from './components/AuditLogsViewer';
import { CreatorFinancialLookup } from './components/CreatorFinancialLookup';
import { UserManagementViewer } from './components/UserManagementViewer';
import { PlatformHealthCenter } from './components/PlatformHealthCenter';

type AdminTab =
  | 'CEO_OVERVIEW'
  | 'POSITIONS'
  | 'USERS'
  | 'CASES'
  | 'HEALTH'
  | 'APPROVALS'
  | 'CREATOR_FINANCE'
  | 'REPORTS'
  | 'WTPP'
  | 'COPYRIGHT'
  | 'AUDIT_LOGS';

export const AdminDashboard: React.FC = () => {
  const { state } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [activeTab, setActiveTab] = useState<AdminTab>(isSuperAdmin ? 'CEO_OVERVIEW' : 'CASES');
  const [reports, setReports] = useState<any[]>([]);
  const [wtpp, setWtpp] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  // Synchronize default tab if auth state loads later
  useEffect(() => {
    if (isSuperAdmin && activeTab === 'CASES') {
      setActiveTab('CEO_OVERVIEW');
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    let isCurrent = true;
    if (activeTab !== 'REPORTS' && activeTab !== 'WTPP' && activeTab !== 'COPYRIGHT') {
      return;
    }

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
        } else if (activeTab === 'COPYRIGHT') {
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
      setReports((current) => current.filter((report) => report.id !== id));
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
      setReports((current) => current.filter((report) => report.id !== id));
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
      setWtpp((current) => current.filter((application) => application.id !== id));
      setReviewNotes((current) => {
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
      setClaims((current) => current.filter((claim) => claim.id !== id));
    } catch {
      setActionError('Could not update this claim. It may have already been resolved.');
    } finally {
      setPendingAction(null);
    }
  };

  const tabClass = (tab: AdminTab) =>
    `flex shrink-0 items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
      activeTab === tab
        ? 'border-brand-primary text-brand-light dark:text-brand-dark'
        : 'border-transparent text-text-muted hover:text-text-primary'
    }`;

  const actionButtonClass =
    'rounded-control px-3 py-1 text-sm font-medium transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <ApertureLogo className="shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-display md:text-2xl text-text-primary">
                WatchTube Admin Portal
              </h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  isSuperAdmin
                    ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                    : 'bg-brand-primary/10 text-brand-primary'
                }`}
              >
                {isSuperAdmin
                  ? 'SUPER_ADMIN (Owner & CEO)'
                  : user?.positionNumber
                  ? `ADMIN ${user.positionNumber} (${user.assignment || 'Partner'})`
                  : 'ADMIN Partner'}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              {isSuperAdmin
                ? 'Complete executive platform governance, company oversight, and administrative partner control.'
                : 'Shared operations center for creator support, channel assistance, and platform management.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isSuperAdmin && (
            <Link
              to="/admin/revenue"
              className="rounded-control bg-surface-subtle px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Shorts Monetization Rates
            </Link>
          )}
          <ThemeToggle />
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Admin Navigation Tabs"
        className="flex gap-4 overflow-x-auto border-b border-border-light dark:border-border-dark scrollbar-none"
      >
        {isSuperAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'CEO_OVERVIEW'}
            onClick={() => setActiveTab('CEO_OVERVIEW')}
            className={tabClass('CEO_OVERVIEW')}
          >
            <LayoutDashboard className="w-4 h-4" /> CEO Overview
          </button>
        )}

        {isSuperAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'POSITIONS'}
            onClick={() => setActiveTab('POSITIONS')}
            className={tabClass('POSITIONS')}
          >
            <UserCheck className="w-4 h-4" /> Admin Positions (3)
          </button>
        )}

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'USERS'}
          onClick={() => setActiveTab('USERS')}
          className={tabClass('USERS')}
        >
          <UserCog className="w-4 h-4" /> User Directory
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'CASES'}
          onClick={() => setActiveTab('CASES')}
          className={tabClass('CASES')}
        >
          <LifeBuoy className="w-4 h-4" /> Creator Support Cases
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'HEALTH'}
          onClick={() => setActiveTab('HEALTH')}
          className={tabClass('HEALTH')}
        >
          <Activity className="w-4 h-4" /> Health & Telemetry
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'APPROVALS'}
          onClick={() => setActiveTab('APPROVALS')}
          className={tabClass('APPROVALS')}
        >
          <FileCheck2 className="w-4 h-4" /> Approvals
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'CREATOR_FINANCE'}
          onClick={() => setActiveTab('CREATOR_FINANCE')}
          className={tabClass('CREATOR_FINANCE')}
        >
          <DollarSign className="w-4 h-4" /> Creator Financials
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'REPORTS'}
          onClick={() => setActiveTab('REPORTS')}
          className={tabClass('REPORTS')}
        >
          <ShieldAlert className="w-4 h-4" /> Moderation Queue
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'WTPP'}
          onClick={() => setActiveTab('WTPP')}
          className={tabClass('WTPP')}
        >
          <Users className="w-4 h-4" /> Partner Program (WTPP)
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'COPYRIGHT'}
          onClick={() => setActiveTab('COPYRIGHT')}
          className={tabClass('COPYRIGHT')}
        >
          <Scale className="w-4 h-4" /> Copyright Disputes
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'AUDIT_LOGS'}
          onClick={() => setActiveTab('AUDIT_LOGS')}
          className={tabClass('AUDIT_LOGS')}
        >
          <ScrollText className="w-4 h-4" /> Audit Ledger
        </button>
      </div>

      {/* Main Tab Panel */}
      <div className="overflow-hidden rounded-card border border-border-light bg-surface-raised shadow-sm dark:border-border-dark">
        <div className="p-6" role="tabpanel">
          {/* Sub-component views */}
          {activeTab === 'CEO_OVERVIEW' && isSuperAdmin && <CeoCompanyDashboard />}
          {activeTab === 'POSITIONS' && isSuperAdmin && <AdminPositionsManager />}
          {activeTab === 'USERS' && <UserManagementViewer />}
          {activeTab === 'CASES' && <SupportCaseManager />}
          {activeTab === 'HEALTH' && <PlatformHealthCenter />}
          {activeTab === 'APPROVALS' && <ApprovalRequestsManager />}
          {activeTab === 'CREATOR_FINANCE' && <CreatorFinancialLookup />}
          {activeTab === 'AUDIT_LOGS' && <AuditLogsViewer />}

          {/* Legacy Queue Tabs */}
          {(activeTab === 'REPORTS' || activeTab === 'WTPP' || activeTab === 'COPYRIGHT') && (
            <>
              {isLoading && <div role="status" className="mb-4 text-text-muted">Loading queue…</div>}
              {loadError && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3" role="alert">
                  <span className="text-red-600">{loadError}</span>
                  <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className={actionButtonClass}>
                    Retry
                  </button>
                </div>
              )}
              {actionError && <div className="mb-4 text-red-600" role="alert">{actionError}</div>}

              {activeTab === 'REPORTS' && (
                <>
                  <h2 className="mb-4 font-bold text-text-primary">Open Reports</h2>
                  {reports.map((report) => (
                    <div
                      key={report.id}
                      className="mb-4 flex flex-col justify-between gap-4 rounded-lg border border-border-light p-4 dark:border-border-dark md:flex-row md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-text-primary">
                          {report.reason} on {report.targetType}
                        </div>
                        <div className="text-sm text-text-muted">
                          {report.details || 'No additional details provided.'}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() => dismissReport(report.id)}
                          className={`${actionButtonClass} bg-surface-subtle`}
                        >
                          {pendingAction === report.id ? 'Saving…' : 'Dismiss'}
                        </button>
                        <button
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() => markReportActioned(report.id)}
                          className={`${actionButtonClass} bg-red-600 text-white`}
                        >
                          {pendingAction === report.id ? 'Saving…' : 'Mark action taken'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {!isLoading && !loadError && reports.length === 0 && (
                    <div className="text-text-muted">Queue is clear.</div>
                  )}
                </>
              )}

              {activeTab === 'WTPP' && (
                <>
                  <h2 className="mb-4 font-bold text-text-primary">Pending WTPP Applications</h2>
                  {wtpp.map((application) => (
                    <div
                      key={application.id}
                      className="mb-4 flex flex-col justify-between gap-4 rounded-lg border border-border-light p-4 dark:border-border-dark md:flex-row md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-text-primary">
                          {application.channel?.name || 'Unknown channel'} ({application.channel?.handle || 'No handle'})
                        </div>
                        <div className="text-sm text-text-muted">
                          Submitted {new Date(application.submittedAt).toLocaleDateString()}.
                          {` ${application.subscriberCount} subscribers and ${Number(
                            application.channelWatchHours || 0,
                          ).toFixed(1)} watch hours at submission (context only; not eligibility thresholds).`}
                        </div>
                      </div>
                      <div className="flex w-full shrink-0 flex-col gap-2 md:w-72">
                        <label className="text-xs font-medium text-text-muted">
                          Reviewer note (required to reject)
                          <textarea
                            value={reviewNotes[application.id] ?? ''}
                            onChange={(event) =>
                              setReviewNotes((current) => ({
                                ...current,
                                [application.id]: event.target.value,
                              }))
                            }
                            rows={2}
                            maxLength={1000}
                            className="mt-1 w-full rounded-control border border-border-light bg-canvas-light p-2 text-sm text-text-primary dark:border-border-dark dark:bg-canvas-obsidian"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={pendingAction !== null}
                            onClick={() => handleWTPP(application.id, 'REJECTED')}
                            className={`${actionButtonClass} bg-surface-subtle text-red-600`}
                          >
                            {pendingAction === application.id ? 'Saving…' : 'Reject'}
                          </button>
                          <button
                            type="button"
                            disabled={pendingAction !== null}
                            onClick={() => handleWTPP(application.id, 'APPROVED')}
                            className={`${actionButtonClass} bg-green-600 text-white`}
                          >
                            {pendingAction === application.id ? 'Saving…' : 'Approve Partner'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!isLoading && !loadError && wtpp.length === 0 && (
                    <div className="text-text-muted">Queue is clear.</div>
                  )}
                </>
              )}

              {activeTab === 'COPYRIGHT' && (
                <>
                  <h2 className="mb-4 font-bold text-text-primary">Copyright Takedown Requests</h2>
                  {claims.map((claim) => (
                    <div
                      key={claim.id}
                      className="mb-4 flex flex-col justify-between gap-4 rounded-lg border border-border-light p-4 dark:border-border-dark md:flex-row md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-text-primary">{claim.video?.title || 'Video unavailable'}</div>
                        <div className="line-clamp-2 text-sm text-text-muted">{claim.description}</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() => handleCopyrightClaim(claim.id, 'REJECTED')}
                          className={`${actionButtonClass} bg-surface-subtle`}
                        >
                          {pendingAction === claim.id ? 'Saving…' : 'Reject claim'}
                        </button>
                        <button
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() => handleCopyrightClaim(claim.id, 'APPROVED_TAKEDOWN')}
                          className={`${actionButtonClass} bg-red-600 text-white`}
                        >
                          {pendingAction === claim.id ? 'Saving…' : 'Approve takedown'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {!isLoading && !loadError && claims.length === 0 && (
                    <div className="text-text-muted">Queue is clear.</div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
