import React, { useEffect, useState, type FormEvent } from 'react';
import { apiClient } from '../../../api/apiClient';
import {
  ShieldCheck,
  UserPlus,
  UserX,
  UserCheck,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  X,
  Edit2,
  Lock,
} from 'lucide-react';

interface AdminPosition {
  positionNumber: number;
  status: 'VACANT' | 'OCCUPIED' | 'SUSPENDED';
  userId: string | null;
  assignment: string | null;
  assignedAt: string | null;
  permissions: string[];
  user?: {
    id: string;
    email: string;
    status: string;
    createdAt: string;
  } | null;
}

interface AdminInvitation {
  id: string;
  email: string;
  positionNumber: number;
  assignment: string;
  customPermissions: string[];
  status: string;
  expiresAt: string;
  createdAt: string;
}

const AVAILABLE_OPTIONAL_PERMISSIONS = [
  { id: 'monetization.view', label: 'View Monetization Settings' },
  { id: 'subscriptions.view', label: 'View Subscriptions Data' },
  { id: 'finance.creator_support_view', label: 'Creator-Specific Financial Lookup' },
  { id: 'content.takedown', label: 'Execute Content Takedowns' },
  { id: 'community.manage_strikes', label: 'Issue Community Strikes' },
  { id: 'users.suspend', label: 'Suspend User Accounts' },
];

export const AdminPositionsManager: React.FC = () => {
  const [positions, setPositions] = useState<AdminPosition[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // Invite modal state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [invitePosition, setInvitePosition] = useState<number>(1);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteAssignment, setInviteAssignment] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // Edit permissions modal state
  const [editingPosition, setEditingPosition] = useState<AdminPosition | null>(null);
  const [editAssignment, setEditAssignment] = useState('');
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [editError, setEditError] = useState('');

  // Confirmation state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'suspend' | 'restore' | 'revoke';
    positionNumber: number;
  } | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    const fetchPositionsAndInvites = async () => {
      setIsLoading(true);
      setError('');
      try {
        const [posRes, invRes] = await Promise.all([
          apiClient.get<AdminPosition[]>('/api/v1/admin/management/positions'),
          apiClient.get<AdminInvitation[]>('/api/v1/admin/management/invitations'),
        ]);

        if (isCurrent) {
          setPositions(posRes.data);
          setInvitations(invRes.data);
        }
      } catch (err: any) {
        if (isCurrent) {
          setError(err.response?.data?.error || 'Unable to load Admin positions.');
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    fetchPositionsAndInvites();
    return () => {
      isCurrent = false;
    };
  }, [refreshKey]);

  const handleOpenInvite = (posNumber: number) => {
    setInvitePosition(posNumber);
    setInviteEmail('');
    setInviteAssignment(
      posNumber === 1
        ? 'Creator Support & Onboarding Coordination'
        : posNumber === 2
        ? 'Community Operations & User Assistance'
        : 'Platform Ingest & Content Review Operations',
    );
    setSelectedPermissions([]);
    setInviteError('');
    setGeneratedInviteLink('');
    setIsInviteOpen(true);
  };

  const handleSendInvite = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmittingInvite(true);
    setInviteError('');
    try {
      const res = await apiClient.post<{ invitation: AdminInvitation; inviteToken: string }>(
        '/api/v1/admin/management/invitations',
        {
          email: inviteEmail.trim(),
          positionNumber: invitePosition,
          assignment: inviteAssignment.trim(),
          customPermissions: selectedPermissions,
        },
      );

      const link = `${window.location.origin}/auth/accept-invite?token=${res.data.inviteToken}`;
      setGeneratedInviteLink(link);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setInviteError(err.response?.data?.error || 'Failed to issue Admin invitation.');
    } finally {
      setIsSubmittingInvite(false);
    }
  };

  const handleCopyLink = () => {
    if (generatedInviteLink) {
      navigator.clipboard.writeText(generatedInviteLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleExecuteAction = async () => {
    if (!confirmAction) return;
    setActionInProgress(true);
    try {
      const { type, positionNumber } = confirmAction;
      await apiClient.post(`/api/v1/admin/management/positions/${positionNumber}/${type}`);
      setConfirmAction(null);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      alert(err.response?.data?.error || `Failed to ${confirmAction.type} admin position.`);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleOpenEdit = (pos: AdminPosition) => {
    setEditingPosition(pos);
    setEditAssignment(pos.assignment || '');
    setEditPermissions(pos.permissions || []);
    setEditError('');
  };

  const handleSavePermissions = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingPosition) return;
    setIsSavingPermissions(true);
    setEditError('');
    try {
      await apiClient.patch(
        `/api/v1/admin/management/positions/${editingPosition.positionNumber}/permissions`,
        {
          assignment: editAssignment.trim(),
          permissions: editPermissions,
        },
      );
      setEditingPosition(null);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setEditError(err.response?.data?.error || 'Failed to update admin permissions.');
    } finally {
      setIsSavingPermissions(false);
    }
  };

  const handleRevokeInvitation = async (invId: string) => {
    if (!confirm('Are you sure you want to revoke this invitation?')) return;
    try {
      await apiClient.post(`/api/v1/admin/management/invitations/${invId}/revoke`);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to revoke invitation.');
    }
  };

  if (isLoading) {
    return (
      <div className="py-16 text-center text-text-muted space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-dark" />
        <p className="text-sm">Loading company administration hierarchy…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-border-light dark:border-border-dark">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-brand-dark" />
            <h2 className="text-xl font-bold font-display">Company Administration &amp; Partner Management</h2>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Strict founder-controlled structure · Exactly three individual ADMIN positions
          </p>
        </div>
      </div>

      {/* The 3 Admin Positions Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((posNum) => {
          const pos = positions.find((p) => p.positionNumber === posNum);
          const isOccupied = pos?.status === 'OCCUPIED';
          const isSuspended = pos?.status === 'SUSPENDED';
          const isVacant = !pos || pos.status === 'VACANT';

          return (
            <div
              key={posNum}
              className={`p-6 rounded-xl border flex flex-col justify-between transition shadow-sm ${
                isOccupied
                  ? 'border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark'
                  : isSuspended
                  ? 'border-red-500/30 bg-red-500/5'
                  : 'border-dashed border-border-light dark:border-border-dark bg-surface-subtle/50'
              }`}
            >
              <div>
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-surface-subtle border border-border">
                      ADMIN {posNum}
                    </span>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      isOccupied
                        ? 'bg-green-500/10 text-green-600 border border-green-500/20'
                        : isSuspended
                        ? 'bg-red-500/10 text-red-600 border border-red-500/20'
                        : 'bg-text-muted/10 text-text-muted border border-border'
                    }`}
                  >
                    {isOccupied ? 'OCCUPIED' : isSuspended ? 'SUSPENDED' : 'VACANT'}
                  </span>
                </div>

                {/* Content */}
                {isOccupied || isSuspended ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-text-muted">Assigned Partner:</div>
                      <div className="text-sm font-semibold truncate" title={pos?.user?.email}>
                        {pos?.user?.email}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-text-muted">Role Assignment:</div>
                      <div className="text-xs font-medium text-text-primary mt-0.5">
                        {pos?.assignment || 'General Creator Support'}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-text-muted">Assigned Date:</div>
                      <div className="text-xs text-text-muted">
                        {pos?.assignedAt ? new Date(pos.assignedAt).toLocaleDateString() : 'N/A'}
                      </div>
                    </div>

                    {pos?.permissions && pos.permissions.length > 0 && (
                      <div>
                        <div className="text-xs text-text-muted mb-1">Additional Permissions:</div>
                        <div className="flex flex-wrap gap-1">
                          {pos.permissions.map((p) => (
                            <span
                              key={p}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-subtle border border-border"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-6 text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-surface-subtle flex items-center justify-center mx-auto text-text-muted">
                      <Lock className="w-5 h-5" />
                    </div>
                    <p className="text-xs text-text-muted font-medium">Position #{posNum} is currently vacant.</p>
                    <p className="text-[11px] text-text-muted">
                      Invite a trusted partner to activate this seat.
                    </p>
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="pt-6 mt-6 border-t border-border-light dark:border-border-dark flex flex-wrap gap-2">
                {isVacant ? (
                  <button
                    type="button"
                    onClick={() => handleOpenInvite(posNum)}
                    className="w-full py-2 px-3 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground text-xs font-medium transition flex items-center justify-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Invite Partner to Position #{posNum}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(pos!)}
                      className="flex-1 py-1.5 px-2 rounded-control bg-surface-subtle hover:bg-surface-hover text-xs font-medium border border-border transition flex items-center justify-center gap-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>

                    {isSuspended ? (
                      <button
                        type="button"
                        onClick={() => setConfirmAction({ type: 'restore', positionNumber: posNum })}
                        className="py-1.5 px-2.5 rounded-control bg-green-500/10 hover:bg-green-500/20 text-green-600 text-xs font-medium border border-green-500/20 transition flex items-center gap-1"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmAction({ type: 'suspend', positionNumber: posNum })}
                        className="py-1.5 px-2.5 rounded-control bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 text-xs font-medium border border-amber-500/20 transition flex items-center gap-1"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" /> Suspend
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setConfirmAction({ type: 'revoke', positionNumber: posNum })}
                      className="py-1.5 px-2.5 rounded-control bg-red-500/10 hover:bg-red-500/20 text-red-600 text-xs font-medium border border-red-500/20 transition flex items-center gap-1"
                      title="Revoke position & vacate"
                    >
                      <UserX className="w-3.5 h-3.5" /> Revoke
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Invitations History Table */}
      <div className="p-6 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold font-display">Admin Invitations Log</h3>
          <span className="text-xs text-text-muted">{invitations.length} total invitations issued</span>
        </div>

        {invitations.length > 0 ? (
          <div className="overflow-x-auto border border-border-light dark:border-border-dark rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-subtle border-b border-border-light dark:border-border-dark text-text-muted">
                <tr>
                  <th className="p-2.5">Invited Email</th>
                  <th className="p-2.5">Position</th>
                  <th className="p-2.5">Assignment</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Expires</th>
                  <th className="p-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light dark:divide-border-dark">
                {invitations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface-hover/50">
                    <td className="p-2.5 font-medium">{inv.email}</td>
                    <td className="p-2.5 font-semibold">Position #{inv.positionNumber}</td>
                    <td className="p-2.5 text-text-muted truncate max-w-[200px]">{inv.assignment}</td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          inv.status === 'ACCEPTED'
                            ? 'bg-green-500/10 text-green-600'
                            : inv.status === 'PENDING'
                            ? 'bg-blue-500/10 text-blue-600'
                            : 'bg-red-500/10 text-red-600'
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="p-2.5 text-text-muted">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="p-2.5 text-right">
                      {inv.status === 'PENDING' && (
                        <button
                          type="button"
                          onClick={() => handleRevokeInvitation(inv.id)}
                          className="px-2 py-1 rounded text-red-600 hover:bg-red-500/10 font-medium transition"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-text-muted italic py-4 text-center">No invitations have been issued.</p>
        )}
      </div>

      {/* Invite Modal */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-xl p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-border-light dark:border-border-dark">
              <h3 className="text-base font-bold font-display">
                Invite Partner to Admin Position #{invitePosition}
              </h3>
              <button
                type="button"
                onClick={() => setIsInviteOpen(false)}
                className="p-1 rounded-full text-text-muted hover:bg-surface-hover"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {generatedInviteLink ? (
              <div className="space-y-4 py-2">
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 text-xs font-medium space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Check className="w-4 h-4" /> Invitation Generated Successfully
                  </div>
                  <p>
                    Provide this single-use, time-limited link to your trusted partner. The link expires in 48 hours.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Secure Activation Link:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedInviteLink}
                      className="flex-1 px-3 py-2 text-xs rounded-control border border-border bg-surface-subtle font-mono text-text-muted select-all focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="px-3 py-2 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground text-xs font-semibold flex items-center gap-1.5 transition"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedLink ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setIsInviteOpen(false)}
                    className="w-full py-2 px-4 rounded-control bg-surface-subtle hover:bg-surface-hover text-xs font-medium border border-border"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSendInvite} className="space-y-4">
                {inviteError && (
                  <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
                    {inviteError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Partner Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="partner@example.com"
                    className="w-full px-3 py-2 text-sm rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Responsibility Assignment Description
                  </label>
                  <input
                    type="text"
                    required
                    value={inviteAssignment}
                    onChange={(e) => setInviteAssignment(e.target.value)}
                    placeholder="e.g. Creator Support Coordination"
                    className="w-full px-3 py-2 text-sm rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">
                    Additional Permissions (Beyond Base Creator Support)
                  </label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto p-2 border border-border rounded-lg bg-surface-subtle">
                    {AVAILABLE_OPTIONAL_PERMISSIONS.map((perm) => (
                      <label key={perm.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(perm.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPermissions((prev) => [...prev, perm.id]);
                            } else {
                              setSelectedPermissions((prev) => prev.filter((p) => p !== perm.id));
                            }
                          }}
                          className="rounded text-brand-dark focus:ring-brand-dark"
                        />
                        <span>{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsInviteOpen(false)}
                    className="py-2 px-3 rounded-control text-xs font-medium hover:bg-surface-hover"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingInvite}
                    className="py-2 px-4 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground text-xs font-semibold disabled:opacity-60"
                  >
                    {isSubmittingInvite ? 'Issuing Invitation…' : 'Generate Invitation Link'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Permissions Modal */}
      {editingPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-light dark:border-border-dark">
              <h3 className="text-base font-bold font-display">
                Edit Assignment — Admin Position #{editingPosition.positionNumber}
              </h3>
              <button
                type="button"
                onClick={() => setEditingPosition(null)}
                className="p-1 rounded-full text-text-muted hover:bg-surface-hover"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePermissions} className="space-y-4">
              {editError && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
                  {editError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Assignment Description
                </label>
                <input
                  type="text"
                  required
                  value={editAssignment}
                  onChange={(e) => setEditAssignment(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Granted Custom Permissions
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto p-2 border border-border rounded-lg bg-surface-subtle">
                  {AVAILABLE_OPTIONAL_PERMISSIONS.map((perm) => (
                    <label key={perm.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editPermissions.includes(perm.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditPermissions((prev) => [...prev, perm.id]);
                          } else {
                            setEditPermissions((prev) => prev.filter((p) => p !== perm.id));
                          }
                        }}
                        className="rounded text-brand-dark focus:ring-brand-dark"
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPosition(null)}
                  className="py-2 px-3 rounded-control text-xs font-medium hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingPermissions}
                  className="py-2 px-4 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground text-xs font-semibold disabled:opacity-60"
                >
                  {isSavingPermissions ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-500 font-bold text-base">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>Confirm {confirmAction.type.toUpperCase()}</span>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Are you sure you want to <strong>{confirmAction.type}</strong> Admin Position #{confirmAction.positionNumber}?
              {confirmAction.type === 'revoke' && ' This will vacate the position and remove all admin capabilities from this partner account.'}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={actionInProgress}
                onClick={() => setConfirmAction(null)}
                className="py-2 px-3 rounded-control text-xs font-medium hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionInProgress}
                onClick={handleExecuteAction}
                className="py-2 px-4 rounded-control bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-60"
              >
                {actionInProgress ? 'Executing…' : 'Confirm & Execute'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
