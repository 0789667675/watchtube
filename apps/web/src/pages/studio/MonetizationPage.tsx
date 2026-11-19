import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useOutletContext } from 'react-router-dom';
import { CircleDollarSign } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import { isStudioMonetizationStatus } from './studioApi';
import type { StudioMonetizationStatus, StudioOutletContext } from './studioApi';

type StatusResult =
  | { state: 'loading' }
  | { state: 'ready'; value: StudioMonetizationStatus }
  | { state: 'no-channel' }
  | { state: 'error'; message: string };

function isPendingApplication(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'status' in value
    && value.status === 'PENDING';
}

export function MonetizationPage() {
  const { profile } = useOutletContext<StudioOutletContext>();
  const [attempt, setAttempt] = useState(0);
  const [selectedChannelId, setSelectedChannelId] = useState(profile.channels[0]?.id ?? '');
  const [result, setResult] = useState<StatusResult>({ state: 'loading' });
  const [isApplying, setIsApplying] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationNotice, setApplicationNotice] = useState('');
  const activeChannelId = profile.channels.some((channel) => channel.id === selectedChannelId)
    ? selectedChannelId
    : profile.channels[0]?.id ?? '';

  useEffect(() => {
    if (!activeChannelId) return;
    const controller = new AbortController();
    apiClient.get<unknown>('/api/v1/wtpp/status', {
      signal: controller.signal,
      params: { channelId: activeChannelId },
    })
      .then(({ data }) => {
        if (isStudioMonetizationStatus(data) && data.channelId === activeChannelId) {
          setResult({ state: 'ready', value: data });
        } else {
          setResult({ state: 'error', message: 'Monetization status could not be verified.' });
        }
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(requestError) && requestError.response?.status === 404) {
          setResult({ state: 'no-channel' });
        } else {
          setResult({
            state: 'error',
            message: getApiErrorMessage(requestError, 'Monetization status is unavailable right now.'),
          });
        }
      });
    return () => controller.abort();
  }, [activeChannelId, attempt]);

  const handleApply = async () => {
    if (result.state !== 'ready' || result.value.channelId !== activeChannelId || !result.value.canApply || isApplying) return;

    setIsApplying(true);
    setApplicationError('');
    setApplicationNotice('');
    try {
      const { data } = await apiClient.post<unknown>('/api/v1/wtpp/apply', { channelId: activeChannelId });
      if (!isPendingApplication(data)) {
        throw new Error('The server did not confirm a pending application.');
      }
      setResult({
        state: 'ready',
        value: { ...result.value, applicationStatus: 'PENDING', canApply: false, reviewerNotes: null, reviewedAt: null },
      });
      setApplicationNotice('Your application was submitted and is pending administrator review.');
    } catch (requestError) {
      setApplicationError(getApiErrorMessage(requestError, 'The application could not be confirmed.'));
    } finally {
      setIsApplying(false);
    }
  };

  if (profile.channels.length === 0 || result.state === 'no-channel') {
    return (
      <section className="mx-auto max-w-3xl rounded-card border border-border bg-surface-light p-6 dark:bg-surface-dark sm:p-8">
        <h1 className="text-xl font-bold">Create a channel to continue</h1>
        <p className="mt-2 text-sm text-text-muted">Create a channel to submit a monetization application.</p>
        <Link to="/studio/content" className="mt-5 inline-flex rounded-control bg-brand-action px-4 py-2 font-semibold text-brand-foreground hover:bg-brand-action-hover">
          Go to channel content
        </Link>
      </section>
    );
  }

  if (result.state === 'loading') {
    return <p role="status" className="p-4 text-sm text-text-muted">Loading monetization status…</p>;
  }

  if (result.state === 'error') {
    return (
      <section role="alert" className="mx-auto max-w-3xl rounded-card border border-border bg-surface-light p-6 dark:bg-surface-dark">
        <h1 className="text-xl font-bold">Monetization status unavailable</h1>
        <p className="mt-2 text-sm text-text-muted">{result.message}</p>
        <button
          type="button"
          onClick={() => {
            setResult({ state: 'loading' });
            setAttempt((current) => current + 1);
          }}
          className="mt-4 rounded-control bg-surface-subtle px-4 py-2 text-sm font-semibold hover:bg-surface-hover"
        >
          Retry
        </button>
      </section>
    );
  }

  const status = result.value;

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">WatchTube Partner Program</h1>
        <p className="mt-1 text-sm text-text-muted">
          All creators may apply; administrators review applications manually. There are no subscriber or watch-hour thresholds.
        </p>
        {profile.channels.length > 1 && (
          <label className="mt-4 block max-w-lg text-sm font-medium">
            Channel
            <select
              value={activeChannelId}
              onChange={(event) => {
                setResult({ state: 'loading' });
                setApplicationError('');
                setApplicationNotice('');
                setSelectedChannelId(event.target.value);
              }}
              className="mt-1 w-full rounded-control border border-border bg-surface-light px-3 py-2 dark:bg-surface-dark"
            >
              {profile.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name} ({channel.handle})</option>
              ))}
            </select>
          </label>
        )}
      </header>

      {applicationNotice && (
        <p role="status" className="rounded-control border border-border bg-surface-light p-4 text-sm dark:bg-surface-dark">
          {applicationNotice}
        </p>
      )}

      {status.isMonetized ? (
        <section className="rounded-card border border-green-300 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950/30">
          <div className="flex items-start gap-4">
            <CircleDollarSign aria-hidden="true" className="h-8 w-8 shrink-0 text-green-700 dark:text-green-400" />
            <div>
              <h2 className="text-lg font-bold text-green-900 dark:text-green-300">Advertising eligibility approved</h2>
              <p className="mt-1 text-sm text-green-800 dark:text-green-200">
                This channel has administrator approval. No verified advertising revenue or payout provider is currently available.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-card border border-border bg-surface-light p-5 dark:bg-surface-dark sm:p-6">
          <h2 className="text-lg font-semibold">Application status</h2>
          <p className="mt-1 text-sm text-text-muted">
            Creators may upload and publish videos regardless of monetization status. Applying does not guarantee approval.
          </p>

          <div className="mt-5 border-t border-divider pt-5">
            {status.applicationStatus === 'PENDING' && (
              <p role="status" className="font-semibold">Application pending administrator review.</p>
            )}
            {status.applicationStatus === 'REJECTED' && (
              <div className="space-y-2">
                <p className="font-semibold text-status-warning">The previous application was rejected.</p>
                {status.reviewerNotes && (
                  <p className="rounded-control bg-surface-subtle p-3 text-sm">
                    Reviewer note: {status.reviewerNotes}
                  </p>
                )}
                <p className="text-sm text-text-muted">You may reapply immediately after addressing the reviewer’s feedback.</p>
              </div>
            )}
            {status.canApply && (
              <button
                type="button"
                onClick={handleApply}
                disabled={isApplying}
                className="mt-4 rounded-full bg-brand-action px-6 py-2.5 font-semibold text-brand-foreground transition hover:bg-brand-action-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isApplying ? 'Submitting…' : status.applicationStatus === 'REJECTED' ? 'Reapply to WTPP' : 'Apply to WTPP'}
              </button>
            )}
            {applicationError && <p role="alert" className="mt-3 text-sm text-status-warning">{applicationError}</p>}
          </div>
        </section>
      )}

      <section className="rounded-card border border-border bg-surface-light p-5 dark:bg-surface-dark sm:p-6">
        <h2 className="font-semibold">Revenue reporting is unavailable</h2>
        <p className="mt-2 text-sm text-text-muted">
          The planned revenue split is 50% WatchTube / 50% creator, but no verified ad-provider allocation or payment integration is active.
          Gross revenue, earnings, balances, adjustments, and payouts will not be estimated or displayed until those systems are verified.
          Provider fees, invalid-traffic deductions, payout terms, and tax treatment also require documented decisions.
        </p>
      </section>
    </section>
  );
}
