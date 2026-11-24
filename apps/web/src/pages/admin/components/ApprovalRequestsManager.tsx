import React, { useEffect, useState } from 'react';
import { apiClient } from '../../../api/apiClient';
import { useAuth } from '../../../auth/useAuth';
import { CheckCircle2, XCircle, Clock, PlusCircle } from 'lucide-react';

interface ApprovalRequest {
  id: string;
  type: string;
  title: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  payload?: any;
  reviewerNotes?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  requester?: {
    id: string;
    email: string;
  };
  reviewer?: {
    id: string;
    email: string;
  };
}

export const ApprovalRequestsManager: React.FC = () => {
  const { state } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('PENDING');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // New Request Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newType, setNewType] = useState('FINANCIAL_ADJUSTMENT');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Review State for Super Admin
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);

  const fetchRequests = async () => {
    setIsLoading(true);
    setError('');
    try {
      const query = filterStatus ? `?status=${filterStatus}` : '';
      const res = await apiClient.get<ApprovalRequest[]>(`/api/v1/admin/approvals${query}`);
      setRequests(res.data);
    } catch {
      setError('Failed to load approval requests.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [filterStatus]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDesc.trim()) return;

    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await apiClient.post('/api/v1/admin/approvals', {
        type: newType,
        title: newTitle.trim(),
        description: newDesc.trim(),
      });
      setSuccessMsg('Approval request submitted to CEO successfully.');
      setShowCreateModal(false);
      setNewTitle('');
      setNewDesc('');
      fetchRequests();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to submit approval request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviewDecision = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setIsReviewing(true);
    setError('');
    setSuccessMsg('');
    try {
      await apiClient.post(`/api/v1/admin/approvals/${id}/review`, {
        status: decision,
        reviewerNotes: reviewNotes.trim() || undefined,
      });
      setSuccessMsg(`Approval request ${decision.toLowerCase()} successfully.`);
      setSelectedRequestId(null);
      setReviewNotes('');
      fetchRequests();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to record decision.');
    } finally {
      setIsReviewing(false);
    }
  };

  const formatType = (type: string) => {
    return type.replace(/_/g, ' ');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Executive Approval Requests</h2>
          <p className="text-sm text-text-muted">
            {isSuperAdmin
              ? 'Review and authorize elevated company decisions and sensitive platform adjustments.'
              : 'Escalate sensitive operations, financial compensations, and policy exceptions to the CEO for authorization.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-control bg-brand-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <PlusCircle className="w-4 h-4" />
          Request CEO Approval
        </button>
      </div>

      {error && (
        <div className="rounded-card border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="rounded-card border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-600 dark:text-green-400">
          {successMsg}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-border-light dark:border-border-dark pb-2">
        {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((status) => (
          <button
            key={status || 'ALL'}
            type="button"
            onClick={() => setFilterStatus(status)}
            className={`rounded-control px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
              filterStatus === status
                ? 'bg-brand-primary text-white'
                : 'bg-surface-subtle text-text-muted hover:text-text-primary'
            }`}
          >
            {status || 'ALL'}
          </button>
        ))}
      </div>

      {/* Requests List */}
      {isLoading ? (
        <div className="p-8 text-center text-text-muted">Loading requests…</div>
      ) : requests.length === 0 ? (
        <div className="rounded-card border border-border-light bg-surface-subtle p-8 text-center text-text-muted dark:border-border-dark">
          No approval requests found for this filter.
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((req) => (
            <div
              key={req.id}
              className="rounded-card border border-border-light bg-surface-raised p-5 shadow-sm dark:border-border-dark"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-surface-subtle px-2 py-0.5 text-xs font-mono font-medium text-text-secondary">
                      {formatType(req.type)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        req.status === 'APPROVED'
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : req.status === 'REJECTED'
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {req.status === 'APPROVED' && <CheckCircle2 className="w-3 h-3" />}
                      {req.status === 'REJECTED' && <XCircle className="w-3 h-3" />}
                      {req.status === 'PENDING' && <Clock className="w-3 h-3" />}
                      {req.status}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-text-primary">{req.title}</h3>
                  <p className="text-sm text-text-secondary whitespace-pre-line">{req.description}</p>
                </div>

                <div className="text-right text-xs text-text-muted space-y-1">
                  <div>Requested by: {req.requester?.email || 'Admin'}</div>
                  <div>Submitted: {new Date(req.createdAt).toLocaleString()}</div>
                  {req.reviewedAt && <div>Decided: {new Date(req.reviewedAt).toLocaleString()}</div>}
                </div>
              </div>

              {req.reviewerNotes && (
                <div className="mt-4 rounded-control bg-surface-subtle p-3 text-xs">
                  <span className="font-semibold text-text-primary">CEO Reviewer Notes: </span>
                  <span className="text-text-secondary">{req.reviewerNotes}</span>
                </div>
              )}

              {/* CEO Action Bar for Pending Requests */}
              {isSuperAdmin && req.status === 'PENDING' && (
                <div className="mt-4 pt-4 border-t border-border-light dark:border-border-dark">
                  {selectedRequestId === req.id ? (
                    <div className="space-y-3">
                      <label className="block text-xs font-medium text-text-muted">
                        Executive decision notes (optional for approval, recommended for rejection):
                        <textarea
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-control border border-border-light bg-canvas-light p-2 text-sm text-text-primary dark:border-border-dark dark:bg-canvas-obsidian"
                          placeholder="Provide rationale or instructions..."
                        />
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isReviewing}
                          onClick={() => handleReviewDecision(req.id, 'APPROVED')}
                          className="rounded-control bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                        >
                          Confirm Approval
                        </button>
                        <button
                          type="button"
                          disabled={isReviewing}
                          onClick={() => handleReviewDecision(req.id, 'REJECTED')}
                          className="rounded-control bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                        >
                          Confirm Rejection
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRequestId(null);
                            setReviewNotes('');
                          }}
                          className="rounded-control bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedRequestId(req.id)}
                        className="rounded-control bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-brand-primary transition hover:bg-surface-hover"
                      >
                        Review Decision
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Request Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-card border border-border-light bg-surface-raised p-6 shadow-xl dark:border-border-dark">
            <h3 className="text-lg font-bold text-text-primary mb-4">Request Executive Approval</h3>
            <form onSubmit={handleCreateRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Approval Category</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full rounded-control border border-border-light bg-canvas-light p-2 text-sm text-text-primary dark:border-border-dark dark:bg-canvas-obsidian"
                >
                  <option value="FINANCIAL_ADJUSTMENT">Financial Adjustment / Creator Compensation</option>
                  <option value="GLOBAL_MONETIZATION_CHANGE">Global Monetization Rule Change</option>
                  <option value="SECURITY_POLICY_CHANGE">Security Policy Change</option>
                  <option value="PLATFORM_CONFIG_CHANGE">Platform Configuration Change</option>
                  <option value="OTHER">Other Sensitive Exception</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Subject / Summary</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Creator #1042 manual escrow release authorization"
                  className="w-full rounded-control border border-border-light bg-canvas-light p-2 text-sm text-text-primary dark:border-border-dark dark:bg-canvas-obsidian"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Detailed Justification &amp; Impact
                </label>
                <textarea
                  required
                  rows={4}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Explain why this requires CEO approval, what channels are affected, and the proposed outcome..."
                  className="w-full rounded-control border border-border-light bg-canvas-light p-2 text-sm text-text-primary dark:border-border-dark dark:bg-canvas-obsidian"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-control bg-surface-subtle px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-control bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting…' : 'Submit for Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
