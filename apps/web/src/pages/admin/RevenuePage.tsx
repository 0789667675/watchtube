import React, { useEffect, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { Scale } from 'lucide-react';

export const RevenuePage: React.FC = () => {
  const [escrows, setEscrows] = useState<any[]>([]);
  const [isLoadingEscrows, setIsLoadingEscrows] = useState(true);
  const [escrowLoadError, setEscrowLoadError] = useState('');
  const [escrowRefreshKey, setEscrowRefreshKey] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    const fetchEscrows = async () => {
      setIsLoadingEscrows(true);
      setEscrowLoadError('');
      try {
        const res = await apiClient.get('/api/v1/admin/copyright/escrows');
        if (isCurrent) setEscrows(res.data);
      } catch {
        if (isCurrent) setEscrowLoadError('Unable to load active escrow holds.');
      } finally {
        if (isCurrent) setIsLoadingEscrows(false);
      }
    };

    fetchEscrows();
    return () => {
      isCurrent = false;
    };
  }, [escrowRefreshKey]);

  const centsLabel = (amount: number | string) => {
    if (typeof amount === 'string') {
      try {
        return `${BigInt(amount).toLocaleString()} cents`;
      } catch {
        return `${amount} cents`;
      }
    }
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })} cents`;
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-bold font-display">Revenue &amp; Escrow Management</h1>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-border-light bg-surface-light p-6 shadow-sm dark:border-border-dark dark:bg-surface-dark">
          <div className="mb-4 flex items-center gap-3">
            <Scale className="w-6 h-6 text-status-warning" />
            <h2 className="text-xl font-bold">Revenue reconciliation unavailable</h2>
          </div>
          <p className="text-sm text-text-muted">
            No verified advertising allocation or payment-provider settlement is available. Revenue cannot be entered manually,
            estimated, split, or distributed from this screen.
          </p>
          <p className="mt-3 text-sm text-text-muted">
            The approved target split is 50% WatchTube / 50% creator. Provider fees, invalid-traffic deductions, calculation basis,
            payout minimum and schedule, and tax treatment still require documented policy decisions.
          </p>
        </div>

        <div className="flex flex-col rounded-xl border border-border-light bg-surface-light p-6 shadow-sm dark:border-border-dark dark:bg-surface-dark">
          <div className="mb-6 flex items-center gap-3">
            <Scale className="w-6 h-6 text-status-warning" />
            <h2 className="text-xl font-bold">Active Copyright Escrow Holds</h2>
          </div>

          {isLoadingEscrows && <div role="status" className="mb-4 text-text-muted">Loading escrow holds…</div>}
          {escrowLoadError && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3" role="alert">
              <span className="text-red-600">{escrowLoadError}</span>
              <button type="button" onClick={() => setEscrowRefreshKey(key => key + 1)} className="rounded-control bg-surface-subtle px-3 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Retry</button>
            </div>
          )}
          <p className="mb-4 rounded-control bg-surface-subtle p-3 text-sm text-text-muted">
            Escrow settlement is disabled until each held amount has a verified allocation source and an auditable resolution workflow.
          </p>
          <div className="flex-1 overflow-y-auto">
            {escrows.map(escrow => (
              <div key={escrow.id} className="mb-4 rounded-lg border border-border-light p-4 dark:border-border-dark">
                <div className="mb-1 truncate font-bold">{escrow.video?.title || 'Video unavailable'}</div>
                <div className="mb-4 font-medium text-status-warning">{centsLabel(String(escrow.heldAmountCents))} withheld</div>

                <p className="text-sm font-medium text-text-muted">Resolution unavailable pending verified allocation.</p>
              </div>
            ))}
            {!isLoadingEscrows && !escrowLoadError && escrows.length === 0 && <div className="py-10 text-center text-text-muted">No active escrow holds.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
