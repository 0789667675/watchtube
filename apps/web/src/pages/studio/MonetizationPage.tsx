import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDollarSign, ShieldAlert } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import { isStudioMonetizationStatus } from './studioApi';
import type { StudioMonetizationStatus } from './studioApi';

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
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<StatusResult>({ state: 'loading' });
  const [isApplying, setIsApplying] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationNotice, setApplicationNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    apiClient.get<unknown>('/api/v1/wtpp/status', { signal: controller.signal })
      .then(({ data }) => {
        if (isStudioMonetizationStatus(data)) {
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
  }, [attempt]);

  const handleApply = async () => {
    if (
      result.state !== 'ready' ||
      !result.value.isEligible ||
      (result.value.applicationStatus !== 'NOT_APPLIED' && result.value.applicationStatus !== 'REJECTED') ||
      isApplying
    ) return;

    setIsApplying(true);
    setApplicationError('');
    setApplicationNotice('');
    try {
      const { data } = await apiClient.post<unknown>('/api/v1/wtpp/apply', {});
      if (!isPendingApplication(data)) {
        throw new Error('The server did not confirm a pending application.');
      }
      setResult({
        state: 'ready',
        value: { ...result.value, applicationStatus: 'PENDING' },
      });
      setApplicationNotice('Your application was submitted and is pending review.');
    } catch (requestError) {
      setApplicationError(getApiErrorMessage(requestError, 'The application could not be confirmed.'));
    } finally {
      setIsApplying(false);
    }
  };

  if (result.state === 'loading') {
    return <p role="status" className="p-4 text-sm text-text-muted">Loading monetization status…</p>;
  }

  if (result.state === 'no-channel') {
    return (
      <section className="mx-auto max-w-3xl rounded-card border border-border bg-surface-light p-6 dark:bg-surface-dark sm:p-8">
        <h1 className="text-xl font-bold">Create a channel to continue</h1>
        <p className="mt-2 text-sm text-text-muted">WTPP eligibility is available after you create a channel.</p>
        <Link to="/studio/content" className="mt-5 inline-flex rounded-control bg-brand-action px-4 py-2 font-semibold text-brand-foreground hover:bg-brand-action-hover">
          Go to channel content
        </Link>
      </section>
    );
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
  const subscriberProgress = Math.min((status.subscriberCount / 1000) * 100, 100);
  const watchHoursProgress = Math.min((status.totalWatchHours / 4000) * 100, 100);

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">WatchTube Partner Program</h1>
        <p className="mt-1 text-sm text-text-muted">Eligibility and application status from the WTPP service.</p>
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
              <h2 className="text-lg font-bold text-green-900 dark:text-green-300">Monetization is enabled</h2>
              <p className="mt-1 text-sm text-green-800 dark:text-green-200">
                This channel is marked as monetized by the WTPP service. Review recorded wallet activity on the overview page.
              </p>
              <Link to="/studio#payouts" className="mt-3 inline-flex text-sm font-semibold text-green-900 underline dark:text-green-200">
                View wallet activity
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-card border border-border bg-surface-light p-5 dark:bg-surface-dark sm:p-6">
          <h2 className="text-lg font-semibold">Eligibility requirements</h2>
          <p className="mt-1 text-sm text-text-muted">Progress is based on the metrics currently reported by the service.</p>

          <div className="mt-6 space-y-6">
            <ProgressMetric
              label="Subscribers"
              value={new Intl.NumberFormat().format(status.subscriberCount)}
              target="1,000"
              progress={subscriberProgress}
            />
            <ProgressMetric
              label="Watch time"
              value={`${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(status.totalWatchHours)} hours`}
              target="4,000 hours"
              progress={watchHoursProgress}
            />
            <div className="flex items-start gap-3 rounded-control bg-surface-subtle p-4">
              {status.activeStrikes === 0
                ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                : <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-status-warning" />}
              <div>
                <p className="font-medium">{new Intl.NumberFormat().format(status.activeStrikes)} active strikes</p>
                <p className="mt-1 text-sm text-text-muted">
                  {status.activeStrikes === 0 ? 'No active strikes are reported.' : 'An active strike is reported for this account.'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-divider pt-5">
            {status.applicationStatus === 'PENDING' && (
              <p role="status" className="font-semibold">Application pending review</p>
            )}
            {status.applicationStatus === 'REJECTED' && (
              <p className="mb-3 text-sm text-status-warning">The previous application was rejected. You may reapply if the current eligibility requirements are met.</p>
            )}
            {(status.applicationStatus === 'NOT_APPLIED' || status.applicationStatus === 'REJECTED') && (
              <>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={!status.isEligible || isApplying}
                  className="rounded-full bg-brand-action px-6 py-2.5 font-semibold text-brand-foreground transition hover:bg-brand-action-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isApplying ? 'Submitting…' : 'Apply to WTPP'}
                </button>
                {!status.isEligible && <p className="mt-2 text-sm text-text-muted">Application is unavailable until the service reports all requirements met.</p>}
              </>
            )}
            {applicationError && <p role="alert" className="mt-3 text-sm text-status-warning">{applicationError}</p>}
          </div>
        </section>
      )}
    </section>
  );
}

function ProgressMetric({
  label,
  value,
  target,
  progress,
}: {
  label: string;
  value: string;
  target: string;
  progress: number;
}) {
  const progressValue = Math.round(progress);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}: {value}</span>
        <span className="text-text-muted">Target: {target}</span>
      </div>
      <progress
        aria-label={`${label} progress`}
        max={100}
        value={progressValue}
        className="h-2 w-full accent-brand-primary"
      >
        {progressValue}%
      </progress>
    </div>
  );
}
