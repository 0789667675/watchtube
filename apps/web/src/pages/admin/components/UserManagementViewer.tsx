import React, { useEffect, useState } from 'react';
import { apiClient } from '../../../api/apiClient';
import { useAuth } from '../../../auth/useAuth';
import {
  Search,
  UserX,
  UserCheck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Eye,
  X,
  Tv,
} from 'lucide-react';

interface ChannelSummary {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string | null;
  isVerified: boolean;
  isMonetized: boolean;
  subscriberCount: number;
}

interface UserSummary {
  id: string;
  email: string;
  role: string;
  status: 'GOOD_STANDING' | 'WARNING' | 'RESTRICTED' | 'SUSPENDED';
  createdAt: string;
  updatedAt: string;
  channels: ChannelSummary[];
  _count?: {
    strikes: number;
    reports: number;
  };
}

interface UserDetail extends UserSummary {
  strikes: Array<{
    id: string;
    reason: string;
    strikeType: string;
    expiresAt: string;
    createdAt: string;
  }>;
  userSupportCases: Array<{
    id: string;
    caseReference: string;
    title: string;
    status: string;
    priority: string;
    category: string;
    createdAt: string;
  }>;
}

export const UserManagementViewer: React.FC = () => {
  const { state } = useAuth();
  const currentUser = state.status === 'authenticated' ? state.user : null;

  const [users, setUsers] = useState<UserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Detail Modal
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);

  // Suspend Modal
  const [userToSuspend, setUserToSuspend] = useState<UserSummary | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [isSubmittingSuspend, setIsSubmittingSuspend] = useState(false);

  // Reinstate Modal
  const [userToReinstate, setUserToReinstate] = useState<UserSummary | null>(null);
  const [reinstateReason, setReinstateReason] = useState('');
  const [isSubmittingReinstate, setIsSubmittingReinstate] = useState(false);

  const fetchUsers = async (targetPage: number) => {
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', targetPage.toString());
      params.set('limit', '20');
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (roleFilter) params.set('role', roleFilter);

      const res = await apiClient.get<{
        users: UserSummary[];
        total: number;
        page: number;
        totalPages: number;
      }>(`/api/v1/admin/users?${params.toString()}`);

      setUsers(res.data.users || []);
      setTotal(res.data.total || 0);
      setPage(res.data.page || 1);
      setTotalPages(res.data.totalPages || 1);
    } catch {
      setError('Failed to load user directory. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers(1);
  }, [search, statusFilter, roleFilter]);

  const viewUserDetail = async (userId: string) => {
    try {
      const res = await apiClient.get<UserDetail>(`/api/v1/admin/users/${userId}`);
      setSelectedUser(res.data);
    } catch {
      setFeedback({ type: 'error', message: 'Failed to retrieve detailed user record.' });
    }
  };

  const handleSuspendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToSuspend || !suspendReason.trim()) return;

    setIsSubmittingSuspend(true);
    setFeedback(null);
    try {
      await apiClient.post(`/api/v1/admin/users/${userToSuspend.id}/suspend`, {
        reason: suspendReason.trim(),
      });
      setFeedback({ type: 'success', message: `User ${userToSuspend.email} has been suspended.` });
      setUserToSuspend(null);
      setSuspendReason('');
      fetchUsers(page);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Failed to suspend user account.',
      });
    } finally {
      setIsSubmittingSuspend(false);
    }
  };

  const handleReinstateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToReinstate) return;

    setIsSubmittingReinstate(true);
    setFeedback(null);
    try {
      await apiClient.post(`/api/v1/admin/users/${userToReinstate.id}/reinstate`, {
        reason: reinstateReason.trim() || undefined,
      });
      setFeedback({ type: 'success', message: `User ${userToReinstate.email} has been reinstated.` });
      setUserToReinstate(null);
      setReinstateReason('');
      fetchUsers(page);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Failed to reinstate user account.',
      });
    } finally {
      setIsSubmittingReinstate(false);
    }
  };

  const statusBadge = (status: UserSummary['status']) => {
    switch (status) {
      case 'GOOD_STANDING':
        return (
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            Good Standing
          </span>
        );
      case 'WARNING':
        return (
          <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
            Warning
          </span>
        );
      case 'RESTRICTED':
        return (
          <span className="rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-semibold text-orange-600 dark:text-orange-400">
            Restricted
          </span>
        );
      case 'SUSPENDED':
        return (
          <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
            Suspended
          </span>
        );
      default:
        return <span className="text-xs text-text-muted">{status}</span>;
    }
  };

  const roleBadge = (role: string) => {
    if (role === 'SUPER_ADMIN') {
      return (
        <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-semibold text-purple-600 dark:text-purple-400">
          SUPER_ADMIN
        </span>
      );
    }
    if (role === 'ADMIN') {
      return (
        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
          ADMIN
        </span>
      );
    }
    return (
      <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-medium text-text-secondary">
        User
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Title & Stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary">User Directory & Governance</h2>
          <p className="text-sm text-text-muted mt-0.5">
            Search, inspect, and manage platform user accounts, standing status, and policy enforcement.
          </p>
        </div>
        <div className="text-sm text-text-muted">
          Showing <span className="font-semibold text-text-primary">{users.length}</span> of{' '}
          <span className="font-semibold text-text-primary">{total}</span> total accounts
        </div>
      </div>

      {/* Notifications / Feedback */}
      {feedback && (
        <div
          role="alert"
          className={`flex items-center justify-between rounded-lg p-4 text-sm font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
              : 'bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-text-muted hover:text-text-primary"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search email, handle, channel..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-control border border-border-light bg-surface-raised pl-9 pr-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none dark:border-border-dark"
          />
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by standing status"
            className="w-full rounded-control border border-border-light bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none dark:border-border-dark"
          >
            <option value="">All Account Standings</option>
            <option value="GOOD_STANDING">Good Standing</option>
            <option value="WARNING">Warning</option>
            <option value="RESTRICTED">Restricted</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>

        <div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by platform role"
            className="w-full rounded-control border border-border-light bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none dark:border-border-dark"
          >
            <option value="">All Platform Roles</option>
            <option value="USER">User / Creator</option>
            <option value="ADMIN">ADMIN Partner</option>
            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          </select>
        </div>

        <div className="flex items-center justify-end">
          {(search || statusFilter || roleFilter) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setRoleFilter('');
              }}
              className="text-xs font-medium text-brand-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-hidden rounded-card border border-border-light bg-surface-raised shadow-sm dark:border-border-dark">
        {isLoading ? (
          <div className="p-8 text-center text-text-muted" role="status">
            Loading user directory…
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600" role="alert">
            {error}
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-text-muted">
            No user accounts match the selected criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-light bg-surface-subtle text-xs font-semibold text-text-muted uppercase dark:border-border-dark">
                <tr>
                  <th scope="col" className="px-4 py-3">Account</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Standing</th>
                  <th scope="col" className="px-4 py-3">Channels</th>
                  <th scope="col" className="px-4 py-3">Strikes</th>
                  <th scope="col" className="px-4 py-3">Joined</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light dark:divide-border-dark">
                {users.map((u) => {
                  const isSelf = currentUser?.id === u.id;
                  const isTargetSuperAdmin = u.role === 'SUPER_ADMIN';
                  const canSuspend = !isSelf && !isTargetSuperAdmin && u.status !== 'SUSPENDED';
                  const canReinstate = u.status === 'SUSPENDED';

                  return (
                    <tr key={u.id} className="hover:bg-surface-hover/50 transition">
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary">{u.email}</div>
                        <div className="text-xs text-text-muted font-mono">{u.id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{roleBadge(u.role)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{statusBadge(u.status)}</td>
                      <td className="px-4 py-3">
                        {u.channels && u.channels.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {u.channels.slice(0, 2).map((c) => (
                              <span
                                key={c.id}
                                className="inline-flex items-center gap-1 rounded bg-surface-subtle px-2 py-0.5 text-xs text-text-secondary"
                              >
                                <Tv className="w-3 h-3 text-text-muted" />
                                {c.name}
                              </span>
                            ))}
                            {u.channels.length > 2 && (
                              <span className="text-xs text-text-muted">+{u.channels.length - 2} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-text-muted italic">No channels</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {u._count?.strikes && u._count.strikes > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            {u._count.strikes}
                          </span>
                        ) : (
                          <span className="text-xs text-text-muted">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-text-muted">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => viewUserDetail(u.id)}
                            className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
                            title="Inspect full user record"
                          >
                            <Eye className="w-3.5 h-3.5" /> Inspect
                          </button>

                          {canSuspend && (
                            <button
                              type="button"
                              onClick={() => {
                                setUserToSuspend(u);
                                setSuspendReason('');
                              }}
                              className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                              title="Suspend this user account"
                            >
                              <UserX className="w-3.5 h-3.5" /> Suspend
                            </button>
                          )}

                          {canReinstate && (
                            <button
                              type="button"
                              onClick={() => {
                                setUserToReinstate(u);
                                setReinstateReason('');
                              }}
                              className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                              title="Reinstate to good standing"
                            >
                              <UserCheck className="w-3.5 h-3.5" /> Reinstate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="flex items-center justify-between border-t border-border-light px-4 py-3 text-xs text-text-muted dark:border-border-dark">
          <div>
            Page <span className="font-semibold text-text-primary">{page}</span> of{' '}
            <span className="font-semibold text-text-primary">{totalPages}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => fetchUsers(page - 1)}
              className="inline-flex items-center gap-1 rounded border border-border-light px-2.5 py-1 hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent dark:border-border-dark"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => fetchUsers(page + 1)}
              className="inline-flex items-center gap-1 rounded border border-border-light px-2.5 py-1 hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent dark:border-border-dark"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Inspect User Detail Modal */}
      {selectedUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-card border border-border-light bg-surface-raised p-6 shadow-xl dark:border-border-dark">
            <div className="flex items-center justify-between border-b border-border-light pb-4 dark:border-border-dark">
              <div>
                <h3 id="user-detail-title" className="text-lg font-bold text-text-primary">
                  Account Details
                </h3>
                <p className="text-xs text-text-muted font-mono">{selectedUser.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="text-text-muted hover:text-text-primary"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-text-muted">Email</div>
                  <div className="font-semibold text-text-primary break-all">{selectedUser.email}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Platform Role</div>
                  <div className="mt-0.5">{roleBadge(selectedUser.role)}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Standing</div>
                  <div className="mt-0.5">{statusBadge(selectedUser.status)}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Joined</div>
                  <div className="font-medium text-text-primary">
                    {new Date(selectedUser.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Channels List */}
              <div className="border-t border-border-light pt-4 dark:border-border-dark">
                <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Channels ({selectedUser.channels?.length || 0})
                </h4>
                {selectedUser.channels?.length > 0 ? (
                  <div className="space-y-2">
                    {selectedUser.channels.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between rounded-lg border border-border-light p-3 text-sm dark:border-border-dark"
                      >
                        <div>
                          <div className="font-medium text-text-primary">{c.name}</div>
                          <div className="text-xs text-text-muted font-mono">@{c.handle}</div>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {c.isVerified && (
                            <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-600 font-medium">
                              Verified
                            </span>
                          )}
                          {c.isMonetized && (
                            <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-600 font-medium">
                              Monetized
                            </span>
                          )}
                          <span className="text-text-muted">{c.subscriberCount} subscribers</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted italic">No channels created.</div>
                )}
              </div>

              {/* Strikes History */}
              <div className="border-t border-border-light pt-4 dark:border-border-dark">
                <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Policy Strikes ({selectedUser.strikes?.length || 0})
                </h4>
                {selectedUser.strikes?.length > 0 ? (
                  <div className="space-y-2">
                    {selectedUser.strikes.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between font-semibold text-red-600">
                          <span>{s.strikeType}</span>
                          <span className="text-text-muted font-normal">
                            Expires: {new Date(s.expiresAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="mt-1 text-text-secondary">{s.reason}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted italic">Zero active strikes on record.</div>
                )}
              </div>

              {/* Support Cases */}
              <div className="border-t border-border-light pt-4 dark:border-border-dark">
                <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Recent Support Cases ({selectedUser.userSupportCases?.length || 0})
                </h4>
                {selectedUser.userSupportCases?.length > 0 ? (
                  <div className="space-y-2">
                    {selectedUser.userSupportCases.map((cs) => (
                      <div
                        key={cs.id}
                        className="flex items-center justify-between rounded-lg border border-border-light p-2.5 text-xs dark:border-border-dark"
                      >
                        <div>
                          <span className="font-mono text-brand-primary">{cs.caseReference}</span>: {cs.title}
                        </div>
                        <span className="rounded bg-surface-subtle px-2 py-0.5 text-text-muted font-medium">
                          {cs.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted italic">No support inquiries filed.</div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-control bg-surface-subtle px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend Confirmation Dialog */}
      {userToSuspend && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="suspend-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-card border border-red-500/30 bg-surface-raised p-6 shadow-xl dark:border-red-500/30">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 id="suspend-dialog-title" className="text-base font-bold text-text-primary">
                Suspend Account: {userToSuspend.email}
              </h3>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Suspending an account revokes access to creator studio tools, uploads, commenting, and monetization.
              This action is strictly logged in the immutable audit ledger.
            </p>

            <form onSubmit={handleSuspendSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="suspend-reason" className="block text-xs font-semibold text-text-primary mb-1">
                  Reason for Suspension (Required)
                </label>
                <textarea
                  id="suspend-reason"
                  rows={3}
                  required
                  placeholder="Describe the policy violation or security justification..."
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  className="w-full rounded-control border border-border-light bg-surface-raised p-2.5 text-xs text-text-primary focus:border-red-500 focus:outline-none dark:border-border-dark"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isSubmittingSuspend}
                  onClick={() => setUserToSuspend(null)}
                  className="rounded-control bg-surface-subtle px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSuspend || suspendReason.trim().length < 3}
                  className="rounded-control bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isSubmittingSuspend ? 'Suspending…' : 'Confirm Suspension'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reinstate Confirmation Dialog */}
      {userToReinstate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reinstate-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-card border border-emerald-500/30 bg-surface-raised p-6 shadow-xl dark:border-emerald-500/30">
            <div className="flex items-center gap-3 text-emerald-600">
              <UserCheck className="w-6 h-6 shrink-0" />
              <h3 id="reinstate-dialog-title" className="text-base font-bold text-text-primary">
                Reinstate Account: {userToReinstate.email}
              </h3>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Reinstating this account will restore its status to Good Standing and notify the user via a security
              alert.
            </p>

            <form onSubmit={handleReinstateSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="reinstate-reason" className="block text-xs font-semibold text-text-primary mb-1">
                  Reinstatement Note (Optional)
                </label>
                <input
                  id="reinstate-reason"
                  type="text"
                  placeholder="e.g. Appeal granted, resolved dispute..."
                  value={reinstateReason}
                  onChange={(e) => setReinstateReason(e.target.value)}
                  className="w-full rounded-control border border-border-light bg-surface-raised p-2.5 text-xs text-text-primary focus:border-emerald-500 focus:outline-none dark:border-border-dark"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isSubmittingReinstate}
                  onClick={() => setUserToReinstate(null)}
                  className="rounded-control bg-surface-subtle px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReinstate}
                  className="rounded-control bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isSubmittingReinstate ? 'Reinstating…' : 'Confirm Reinstatement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
