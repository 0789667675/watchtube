import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DollarSign, CheckCircle2, ShieldAlert } from 'lucide-react';
import { isStudioMonetizationStatus } from './studioApi';
import type { StudioMonetizationStatus } from './studioApi';

export const MonetizationPage: React.FC = () => {
  const [status, setStatus] = useState<StudioMonetizationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await axios.get<unknown>('/api/v1/wtpp/status');
        if (isStudioMonetizationStatus(response.data)) {
          setStatus(response.data);
        } else {
          console.error('Monetization status response did not match the expected format.');
          setStatus(null);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStatus();
  }, []);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await axios.post('/api/v1/wtpp/apply', {});
      setStatus(current => current ? { ...current, applicationStatus: 'PENDING' } : current);
    } catch (error) {
      console.error('Failed to submit monetization application:', error);
      alert('Failed to submit application');
    } finally {
      setIsApplying(false);
    }
  };

  if (isLoading) return <div className="p-6">Loading monetization status...</div>;
  if (!status) return <div className="p-6 text-text-muted" role="alert">Monetization status is unavailable. Check the API connection and try again.</div>;

  const subPercent = Math.min((status.subscriberCount / 1000) * 100, 100);
  const hoursPercent = Math.min((status.totalWatchHours / 4000) * 100, 100);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display mb-2">WatchTube Partner Program</h1>
        <p className="text-text-muted">Join the WTPP to monetize your content and get access to creator support.</p>
      </div>

      {status.isMonetized ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6 flex items-start gap-4">
          <div className="bg-green-100 dark:bg-green-800 p-3 rounded-full shrink-0">
            <DollarSign className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-green-800 dark:text-green-400 mb-2">You are a WatchTube Partner!</h2>
            <p className="text-green-700 dark:text-green-500">Your channel is currently monetized. Revenue will automatically accumulate in your Creator Wallet.</p>
          </div>
        </div>
      ) : (
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl p-6">
          <h2 className="text-lg font-bold mb-6">Eligibility Requirements</h2>

          <div className="space-y-6 mb-8">
            <div>
              <div className="flex justify-between text-sm font-medium mb-2">
                <span>{status.subscriberCount} Subscribers</span>
                <span className="text-text-muted">1,000 required</span>
              </div>
              <div className="h-2 w-full rounded-full bg-surface-subtle">
                <div className="bg-brand-primary h-2 rounded-full" style={{ width: `${subPercent}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm font-medium mb-2">
                <span>{status.totalWatchHours.toFixed(1)} Watch Hours</span>
                <span className="text-text-muted">4,000 required</span>
              </div>
              <div className="h-2 w-full rounded-full bg-surface-subtle">
                <div className="bg-brand-primary h-2 rounded-full" style={{ width: `${hoursPercent}%` }} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              {status.activeStrikes === 0 ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-red-500" />
              )}
              <span className="font-medium text-sm">
                {status.activeStrikes} Active Community Guidelines Strikes
              </span>
            </div>
          </div>

          <div className="border-t border-border-light dark:border-border-dark pt-6">
            {status.applicationStatus === 'PENDING' && (
              <button disabled className="rounded-full bg-surface-subtle px-6 py-2 font-bold text-text-muted">
                Application Pending Review
              </button>
            )}

            {status.applicationStatus === 'REJECTED' && (
              <div className="text-red-600 font-bold mb-4">Your previous application was rejected. Please review community guidelines before reapplying.</div>
            )}

            {(status.applicationStatus === 'NOT_APPLIED' || status.applicationStatus === 'REJECTED') && (
              <button
                onClick={handleApply}
                disabled={!status.isEligible || isApplying}
                className="rounded-full bg-brand-action px-6 py-2 font-bold text-brand-foreground transition hover:bg-brand-action-hover disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {isApplying ? 'Submitting...' : 'Apply Now'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
