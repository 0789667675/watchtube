import React, { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../../api/apiClient';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';
import { ShieldCheck, AlertCircle, CheckCircle, Lock, Loader2 } from 'lucide-react';

interface InvitationDetails {
  id: string;
  email: string;
  positionNumber: number;
  assignment: string;
  invitedByEmail: string;
  expiresAt: string;
}

export const AcceptInvitationPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(!token ? false : true);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState<string>(
    !token ? 'No invitation token was provided. Please check the invitation link.' : ''
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      setError('No invitation token was provided. Please check the invitation link.');
      return;
    }

    let isCurrent = true;
    const verifyToken = async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await apiClient.get<InvitationDetails>(`/api/v1/admin/invitations/verify/${encodeURIComponent(token)}`);
        if (isCurrent) {
          setInvitation(res.data);
        }
      } catch (err: any) {
        if (isCurrent) {
          const message = err.response?.data?.error || 'Unable to verify invitation. It may have expired or already been used.';
          setError(message);
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    verifyToken();
    return () => {
      isCurrent = false;
    };
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post('/api/v1/admin/invitations/accept', {
        token,
        password,
      });
      setIsSuccess(true);
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to accept invitation. Please retry or contact the founder.';
      setFormError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas-light text-text-primary dark:bg-canvas-obsidian flex flex-col items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-lg p-6 sm:p-8">
        <div className="flex justify-center mb-6">
          <ApertureLogo />
        </div>

        {isLoading ? (
          <div className="text-center py-12 space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-brand-dark" />
            <p className="text-sm text-text-muted">Verifying your Admin invitation…</p>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
            <div className="text-center pt-2">
              <Link
                to="/"
                className="text-sm font-medium text-brand-dark hover:underline"
              >
                Return to WatchTube Home
              </Link>
            </div>
          </div>
        ) : isSuccess ? (
          <div className="text-center py-6 space-y-4">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold font-display">Account Established!</h2>
            <p className="text-sm text-text-muted">
              You are now assigned to <strong>Admin Position {invitation?.positionNumber}</strong> for WatchTube.
            </p>
            <div className="pt-4">
              <button
                type="button"
                onClick={() => navigate('/auth/login')}
                className="w-full py-2.5 px-4 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground font-medium transition"
              >
                Proceed to Sign In
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-dark/10 text-brand-dark mb-3">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h1 className="text-xl font-bold font-display">Admin Partner Invitation</h1>
              <p className="text-xs text-text-muted mt-1">
                Designated Position #{invitation?.positionNumber} · {invitation?.assignment}
              </p>
            </div>

            <div className="mb-6 p-3 rounded-lg bg-surface-subtle text-xs space-y-1.5 border border-border-light dark:border-border-dark">
              <div className="flex justify-between">
                <span className="text-text-muted">Invited Email:</span>
                <span className="font-semibold">{invitation?.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Position:</span>
                <span className="font-semibold">ADMIN {invitation?.positionNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Assignment:</span>
                <span className="font-semibold truncate max-w-[180px]">{invitation?.assignment}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 text-red-500 text-xs font-medium border border-red-500/20">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Set Your Individual Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="At least 8 characters"
                    className="w-full px-3.5 py-2 pl-9 text-sm rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                  <Lock className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="Re-enter password"
                    className="w-full px-3.5 py-2 pl-9 text-sm rounded-control border border-border bg-surface-light dark:bg-surface-dark focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                  <Lock className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-control bg-brand-action hover:bg-brand-action-hover text-brand-foreground font-medium transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSubmitting ? 'Establishing Account…' : 'Accept Invitation & Activate'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
