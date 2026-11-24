import React, { useEffect, useState, type FormEvent } from 'react';
import { apiClient } from '../../../api/apiClient';
import {
  LifeBuoy,
  Plus,
  Search,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  X,
  RefreshCw,
  Send,
  Lock,
} from 'lucide-react';

interface SupportCase {
  id: string;
  caseReference: string;
  category: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING_FOR_USER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
  title: string;
  description: string;
  reporterEmail: string | null;
  assignedAdminId: string | null;
  assignedPositionNumber: number | null;
  createdAt: string;
  updatedAt: string;
  assignedAdmin?: { id: string; email: string } | null;
  channel?: { id: string; name: string; handle: string } | null;
  video?: { id: string; title: string } | null;
  _count?: { notes: number; activities: number };
}

interface CaseDetail extends SupportCase {
  resolutionNotes: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  notes: Array<{
    id: string;
    content: string;
    isInternal: boolean;
    createdAt: string;
    author: { email: string; role: string };
  }>;
  activities: Array<{
    id: string;
    action: string;
    details: string | null;
    previousValue: string | null;
    newValue: string | null;
    createdAt: string;
    actor: { email: string };
  }>;
}

interface AdminPartner {
  positionNumber: number;
  userId: string | null;
  user?: { id: string; email: string } | null;
}

const CATEGORIES = [
  { id: 'ONBOARDING', label: 'Creator Onboarding' },
  { id: 'CHANNEL_ISSUE', label: 'Channel Issues' },
  { id: 'STUDIO_SUPPORT', label: 'Creator Studio' },
  { id: 'UPLOAD_ISSUE', label: 'Upload Problems' },
  { id: 'PROCESSING_FAILURE', label: 'Video Processing' },
  { id: 'METADATA_THUMBNAIL', label: 'Thumbnail & Metadata' },
  { id: 'SUBSCRIPTION_INQUIRY', label: 'Subscriptions' },
  { id: 'MONETIZATION_SUPPORT', label: 'WTPP & Monetization' },
  { id: 'USER_COMPLAINT', label: 'User Feedback' },
  { id: 'CONTENT_REPORT', label: 'Content Report' },
  { id: 'PAYOUT_STATUS', label: 'Payout Question' },
  { id: 'OTHER', label: 'Other Operational Issue' },
];

export const SupportCaseManager: React.FC = () => {
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected case for Drawer
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [isLoadingCase, setIsLoadingCase] = useState(false);

  // Available admins for assignment
  const [adminPartners, setAdminPartners] = useState<AdminPartner[]>([]);

  // New Case Modal
  const [isNewCaseOpen, setIsNewCaseOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('STUDIO_SUPPORT');
  const [newPriority, setNewPriority] = useState('NORMAL');
  const [newReporterEmail, setNewReporterEmail] = useState('');
  const [isSubmittingNewCase, setIsSubmittingNewCase] = useState(false);
  const [newCaseError, setNewCaseError] = useState('');

  // Note form in Drawer
  const [noteContent, setNoteContent] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

  // Status transition form in Drawer
  const [newStatus, setNewStatus] = useState<string>('');
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Escalation form in Drawer
  const [isEscalating, setIsEscalating] = useState(false);
  const [escalationReason, setEscalationReason] = useState('');

  useEffect(() => {
    let isCurrent = true;
    const fetchCases = async () => {
      setIsLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.append('status', statusFilter);
        if (priorityFilter) params.append('priority', priorityFilter);
        if (categoryFilter) params.append('category', categoryFilter);
        if (searchQuery.trim()) params.append('search', searchQuery.trim());

        const [casesRes, posRes] = await Promise.all([
          apiClient.get<{ cases: SupportCase[]; total: number }>(`/api/v1/admin/cases?${params.toString()}`),
          apiClient.get<AdminPartner[]>('/api/v1/admin/management/positions'),
        ]);

        if (isCurrent) {
          setCases(casesRes.data.cases);
          setTotalCount(casesRes.data.total);
          setAdminPartners(posRes.data.filter((p) => p.userId && p.user));
        }
      } catch (err: any) {
        if (isCurrent) {
          setError(err.response?.data?.error || 'Unable to load support cases.');
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    fetchCases();
    return () => {
      isCurrent = false;
    };
  }, [statusFilter, priorityFilter, categoryFilter, searchQuery, refreshKey]);

  useEffect(() => {
    if (!selectedCaseId) {
      setSelectedCase(null);
      return;
    }

    let isCurrent = true;
    const fetchCaseDetail = async () => {
      setIsLoadingCase(true);
      try {
        const res = await apiClient.get<CaseDetail>(`/api/v1/admin/cases/${selectedCaseId}`);
        if (isCurrent) {
          setSelectedCase(res.data);
          setNewStatus(res.data.status);
          setResolutionNotes(res.data.resolutionNotes || '');
        }
      } catch (err) {
        console.error('Failed to load case detail:', err);
      } finally {
        if (isCurrent) {
          setIsLoadingCase(false);
        }
      }
    };

    fetchCaseDetail();
    return () => {
      isCurrent = false;
    };
  }, [selectedCaseId]);

  const handleCreateCase = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmittingNewCase(true);
    setNewCaseError('');
    try {
      const res = await apiClient.post<SupportCase>('/api/v1/admin/cases', {
        title: newTitle.trim(),
        description: newDescription.trim(),
        category: newCategory,
        priority: newPriority,
        reporterEmail: newReporterEmail.trim() || undefined,
      });

      setIsNewCaseOpen(false);
      setNewTitle('');
      setNewDescription('');
      setNewReporterEmail('');
      setRefreshKey((k) => k + 1);
      setSelectedCaseId(res.data.id);
    } catch (err: any) {
      setNewCaseError(err.response?.data?.error || 'Failed to create support case.');
    } finally {
      setIsSubmittingNewCase(false);
    }
  };

  const handleAssign = async (adminId: string, posNum?: number) => {
    if (!selectedCaseId) return;
    try {
      await apiClient.post(`/api/v1/admin/cases/${selectedCaseId}/assign`, {
        assignedAdminId: adminId,
        assignedPositionNumber: posNum,
      });
      const updated = await apiClient.get<CaseDetail>(`/api/v1/admin/cases/${selectedCaseId}`);
      setSelectedCase(updated.data);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to reassign case.');
    }
  };

  const handleUpdateStatus = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId) return;
    setIsUpdatingStatus(true);
    try {
      await apiClient.patch(`/api/v1/admin/cases/${selectedCaseId}/status`, {
        status: newStatus,
        resolutionNotes: ['RESOLVED', 'CLOSED'].includes(newStatus) ? resolutionNotes.trim() : undefined,
      });
      const updated = await apiClient.get<CaseDetail>(`/api/v1/admin/cases/${selectedCaseId}`);
      setSelectedCase(updated.data);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update case status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleEscalate = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !escalationReason.trim()) return;
    try {
      await apiClient.post(`/api/v1/admin/cases/${selectedCaseId}/escalate`, {
        escalationReason: escalationReason.trim(),
      });
      setIsEscalating(false);
      setEscalationReason('');
      const updated = await apiClient.get<CaseDetail>(`/api/v1/admin/cases/${selectedCaseId}`);
      setSelectedCase(updated.data);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to escalate case.');
    }
  };

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !noteContent.trim()) return;
    setIsSubmittingNote(true);
    try {
      await apiClient.post(`/api/v1/admin/cases/${selectedCaseId}/notes`, {
        content: noteContent.trim(),
        isInternal: true,
      });
      setNoteContent('');
      const updated = await apiClient.get<CaseDetail>(`/api/v1/admin/cases/${selectedCaseId}`);
      setSelectedCase(updated.data);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add internal note.');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-red-500/10 text-red-600 border-red-500/20 font-bold';
      case 'HIGH':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20 font-semibold';
      case 'NORMAL':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      default:
        return 'bg-text-muted/10 text-text-muted border-border';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RESOLVED':
      case 'CLOSED':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'ESCALATED':
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20 font-bold';
      case 'IN_PROGRESS':
      case 'ASSIGNED':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'WAITING_FOR_USER':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      default:
        return 'bg-surface-subtle text-text-muted border-border';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-border-light dark:border-border-dark">
        <div>
          <div className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-brand-dark" />
            <h2 className="text-xl font-bold font-display">Creator Support &amp; Issue Management</h2>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Collaborative case handling · Shared between all three Admins &amp; SUPER_ADMIN
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsNewCaseOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground text-xs font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4" /> Open Support Case
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by case code, title, or reporter email…"
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
        >
          <option value="">All Statuses</option>
          <option value="OPEN">Open (Unassigned)</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="WAITING_FOR_USER">Waiting for Creator</option>
          <option value="ESCALATED">Escalated</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
        >
          <option value="">All Priorities</option>
          <option value="URGENT">Urgent</option>
          <option value="HIGH">High</option>
          <option value="NORMAL">Normal</option>
          <option value="LOW">Low</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-text-muted">{totalCount} cases</span>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="p-1.5 rounded-control text-text-muted hover:bg-surface-hover"
            title="Refresh cases"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Cases Table */}
      <div className="rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-text-muted space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-dark" />
            <p className="text-xs">Loading support cases…</p>
          </div>
        ) : error ? (
          <div role="alert" className="p-6 text-center text-red-500 text-xs">
            {error}
          </div>
        ) : cases.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-subtle border-b border-border-light dark:border-border-dark text-text-muted font-semibold">
                <tr>
                  <th className="p-3">Reference</th>
                  <th className="p-3">Issue Title &amp; Category</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Assigned To</th>
                  <th className="p-3">Channel / Creator</th>
                  <th className="p-3 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light dark:divide-border-dark">
                {cases.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCaseId(c.id)}
                    className={`cursor-pointer transition hover:bg-surface-hover/70 ${
                      selectedCaseId === c.id ? 'bg-brand-dark/5 dark:bg-brand-dark/10' : ''
                    }`}
                  >
                    <td className="p-3 font-mono font-bold text-brand-dark">{c.caseReference}</td>
                    <td className="p-3 max-w-xs">
                      <div className="font-semibold text-text-primary truncate">{c.title}</div>
                      <div className="text-[11px] text-text-muted">
                        {CATEGORIES.find((cat) => cat.id === c.category)?.label || c.category}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded border text-[10px] ${getPriorityBadge(c.priority)}`}>
                        {c.priority}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded border text-[10px] ${getStatusBadge(c.status)}`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-3">
                      {c.assignedAdmin ? (
                        <div className="font-medium text-text-primary truncate max-w-[150px]">
                          {c.assignedPositionNumber ? `Admin #${c.assignedPositionNumber}` : c.assignedAdmin.email}
                        </div>
                      ) : (
                        <span className="text-text-muted italic">Unassigned</span>
                      )}
                    </td>
                    <td className="p-3 text-text-muted">
                      {c.channel?.name || c.reporterEmail || '—'}
                    </td>
                    <td className="p-3 text-right text-text-muted">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center text-text-muted space-y-2">
            <CheckCircle2 className="w-8 h-8 mx-auto text-green-500" />
            <p className="text-sm font-semibold text-text-primary">All Caught Up!</p>
            <p className="text-xs">No support cases matching your selected filters.</p>
          </div>
        )}
      </div>

      {/* Case Details Drawer / Modal */}
      {selectedCaseId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-xl h-full bg-surface-light dark:bg-surface-dark border-l border-border-light dark:border-border-dark shadow-2xl flex flex-col justify-between overflow-y-auto">
            {isLoadingCase || !selectedCase ? (
              <div className="p-12 text-center text-text-muted">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-dark" />
                <p className="text-xs mt-3">Loading case details…</p>
              </div>
            ) : (
              <div className="p-6 space-y-6 flex-1">
                {/* Drawer Header */}
                <div className="flex items-center justify-between pb-3 border-b border-border-light dark:border-border-dark">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-brand-dark">
                      {selectedCase.caseReference}
                    </span>
                    <span className={`px-2 py-0.5 rounded border text-[10px] ${getPriorityBadge(selectedCase.priority)}`}>
                      {selectedCase.priority}
                    </span>
                    <span className={`px-2 py-0.5 rounded border text-[10px] ${getStatusBadge(selectedCase.status)}`}>
                      {selectedCase.status}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCaseId(null)}
                    className="p-1.5 rounded-full text-text-muted hover:bg-surface-hover"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Case Info */}
                <div className="space-y-2">
                  <h3 className="text-lg font-bold font-display text-text-primary">
                    {selectedCase.title}
                  </h3>
                  <div className="p-3.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark text-xs leading-relaxed whitespace-pre-wrap">
                    {selectedCase.description}
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-text-muted pt-1">
                    <div>Category: <strong>{selectedCase.category}</strong></div>
                    {selectedCase.channel && (
                      <div>Channel: <strong>{selectedCase.channel.name}</strong> (@{selectedCase.channel.handle})</div>
                    )}
                    {selectedCase.reporterEmail && (
                      <div>Reporter: <strong>{selectedCase.reporterEmail}</strong></div>
                    )}
                  </div>
                </div>

                {/* Assignment & Status Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-border-light dark:border-border-dark bg-surface-subtle text-xs">
                  <div>
                    <label className="block text-text-muted font-medium mb-1">
                      Assigned Admin:
                    </label>
                    <select
                      value={selectedCase.assignedAdminId || ''}
                      onChange={(e) => {
                        const targetPos = adminPartners.find((p) => p.userId === e.target.value);
                        if (e.target.value) {
                          handleAssign(e.target.value, targetPos?.positionNumber);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                    >
                      <option value="">Unassigned</option>
                      {adminPartners.map((partner) => (
                        <option key={partner.userId} value={partner.userId!}>
                          Admin #{partner.positionNumber} ({partner.user?.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-text-muted font-medium mb-1">
                      Change Status:
                    </label>
                    <form onSubmit={handleUpdateStatus} className="flex gap-1.5">
                      <select
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                      >
                        <option value="OPEN">Open</option>
                        <option value="ASSIGNED">Assigned</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="WAITING_FOR_USER">Waiting for Creator</option>
                        <option value="ESCALATED">Escalated</option>
                        <option value="RESOLVED">Resolved</option>
                        <option value="CLOSED">Closed</option>
                      </select>
                      <button
                        type="submit"
                        disabled={isUpdatingStatus || newStatus === selectedCase.status}
                        className="px-2.5 py-1.5 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground font-semibold disabled:opacity-40"
                      >
                        Save
                      </button>
                    </form>
                  </div>
                </div>

                {['RESOLVED', 'CLOSED'].includes(newStatus) && (
                  <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 text-xs space-y-1.5">
                    <label className="block font-bold text-green-700 dark:text-green-400">
                      Resolution Notes (Required):
                    </label>
                    <textarea
                      rows={2}
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="Explain how this case was resolved for the creator…"
                      className="w-full p-2 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                    />
                  </div>
                )}

                {/* Escalation */}
                {selectedCase.status !== 'ESCALATED' ? (
                  <div>
                    {isEscalating ? (
                      <form onSubmit={handleEscalate} className="p-3.5 rounded-xl border border-purple-500/30 bg-purple-500/5 space-y-2 text-xs">
                        <div className="font-bold text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" /> Escalate to SUPER_ADMIN
                        </div>
                        <textarea
                          required
                          rows={2}
                          value={escalationReason}
                          onChange={(e) => setEscalationReason(e.target.value)}
                          placeholder="Provide the reason for escalating to executive review…"
                          className="w-full p-2 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setIsEscalating(false)}
                            className="px-2.5 py-1 rounded-control text-text-muted hover:bg-surface-hover"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="px-3 py-1 rounded-control bg-purple-600 hover:bg-purple-700 text-white font-semibold"
                          >
                            Confirm Escalation
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsEscalating(true)}
                        className="w-full py-1.5 px-3 rounded-control border border-purple-500/30 bg-purple-500/5 text-purple-600 hover:bg-purple-500/10 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" /> Escalate Case to Executive Review
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-700 dark:text-purple-300">
                    <span className="font-bold">Escalated to SUPER_ADMIN:</span> {selectedCase.escalationReason}
                  </div>
                )}

                {/* Internal Notes */}
                <div className="space-y-3 pt-2 border-t border-border-light dark:border-border-dark">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                      <Lock className="w-3.5 h-3.5" /> Confidential Internal Staff Notes
                    </div>
                    <span className="text-[10px] text-text-muted">Never shown to creator</span>
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedCase.notes.length > 0 ? (
                      selectedCase.notes.map((note) => (
                        <div
                          key={note.id}
                          className="p-2.5 rounded-lg bg-surface-subtle border border-border-light dark:border-border-dark text-xs space-y-1"
                        >
                          <div className="flex justify-between text-[10px] text-text-muted">
                            <span className="font-semibold">{note.author.email} ({note.author.role})</span>
                            <span>{new Date(note.createdAt).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-text-primary whitespace-pre-wrap">{note.content}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-text-muted italic text-center py-2">No internal notes yet.</p>
                    )}
                  </div>

                  <form onSubmit={handleAddNote} className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Add an internal note or update…"
                      className="flex-1 px-3 py-1.5 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isSubmittingNote || !noteContent.trim()}
                      className="px-3 py-1.5 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground text-xs font-semibold disabled:opacity-40 flex items-center gap-1"
                    >
                      <Send className="w-3.5 h-3.5" /> Note
                    </button>
                  </form>
                </div>

                {/* Activity History */}
                <div className="space-y-2 pt-2 border-t border-border-light dark:border-border-dark">
                  <div className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Activity &amp; Reassignment Timeline
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto text-[11px] text-text-muted">
                    {selectedCase.activities.map((act) => (
                      <div key={act.id} className="flex items-start gap-2 py-1 border-b border-border-light/50 dark:border-border-dark/50">
                        <Clock className="w-3 h-3 text-text-muted shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold text-text-primary">{act.actor.email}</span>{' '}
                          <span>{act.details || act.action}</span>{' '}
                          <span className="text-[10px] text-text-muted">({new Date(act.createdAt).toLocaleTimeString()})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Case Modal */}
      {isNewCaseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-light dark:border-border-dark">
              <h3 className="text-base font-bold font-display">Open New Creator Support Case</h3>
              <button
                type="button"
                onClick={() => setIsNewCaseOpen(false)}
                className="p-1 rounded-full text-text-muted hover:bg-surface-hover"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCase} className="space-y-4">
              {newCaseError && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
                  {newCaseError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Case Title
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Summary of the issue…"
                  className="w-full px-3 py-2 text-sm rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Category
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Priority
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                  >
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Creator / User Email (Optional)
                </label>
                <input
                  type="email"
                  value={newReporterEmail}
                  onChange={(e) => setNewReporterEmail(e.target.value)}
                  placeholder="creator@example.com"
                  className="w-full px-3 py-2 text-sm rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Detailed Issue Description
                </label>
                <textarea
                  required
                  rows={4}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Explain the background, error logs, or problem observed…"
                  className="w-full px-3 py-2 text-xs rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewCaseOpen(false)}
                  className="py-2 px-3 rounded-control text-xs font-medium hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingNewCase}
                  className="py-2 px-4 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground text-xs font-semibold disabled:opacity-60"
                >
                  {isSubmittingNewCase ? 'Opening Case…' : 'Open Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
