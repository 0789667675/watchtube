import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DollarSign, Scale, CheckCircle2 } from 'lucide-react';

export const RevenuePage: React.FC = () => {
  const [isReconciling, setIsReconciling] = useState(false);
  const [monthYear, setMonthYear] = useState('2026-10');
  const [grossRevenue, setGrossRevenue] = useState('1000000');
  const [escrows, setEscrows] = useState<any[]>([]);

  useEffect(() => {
    // In reality, this would fetch active escrows from a real admin endpoint
    setEscrows([
        { id: '1', claimId: 'c1', heldAmountCents: 50000, video: { title: 'Understanding HLS' } },
        { id: '2', claimId: 'c2', heldAmountCents: 15000, video: { title: 'PostgreSQL Tricks' } }
    ]);
  }, []);

  const handleReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsReconciling(true);
    try {
        const res = await axios.post('/api/v1/admin/monetization/reconcile', {
            monthYear,
            grossProviderRevenueCents: Number(grossRevenue)
        });
        alert(`Reconciliation Successful! Creator pool disbursed: ${res.data.creatorPoolCents}`);
    } catch (error) {
        alert('Reconciliation failed or already finalized for this month.');
    } finally {
        setIsReconciling(false);
    }
  };

  const resolveEscrow = async (id: string, claimId: string, decision: 'RELEASE_TO_CREATOR' | 'TRANSFER_TO_CLAIMANT') => {
      try {
          await axios.post(`/api/v1/admin/copyright/claims/${claimId}/resolve-escrow`, { decision });
          setEscrows(escrows.filter(e => e.id !== id));
      } catch (error) {
          alert('Failed to resolve escrow. It may have already been resolved.');
      }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-bold font-display">Revenue & Escrow Management</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Reconciliation Panel */}
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-6">
                <DollarSign className="w-6 h-6 text-green-500" />
                <h2 className="text-xl font-bold">Monthly Reconciliation (50/50 Split)</h2>
            </div>

            <form onSubmit={handleReconcile} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Month-Year (YYYY-MM)</label>
                    <input value={monthYear} onChange={e => setMonthYear(e.target.value)} required type="text" className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2" />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Gross Provider Revenue (Cents)</label>
                    <input value={grossRevenue} onChange={e => setGrossRevenue(e.target.value)} required type="number" min="0" className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2" />
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg flex flex-col gap-2 mt-4 text-sm font-medium">
                    <div className="flex justify-between text-gray-500"><span>Platform Share (50%)</span><span>{Number(grossRevenue) * 0.5}</span></div>
                    <div className="flex justify-between text-gray-500 border-b border-gray-200 dark:border-gray-700 pb-2"><span>Creator Pool (50%)</span><span>{Number(grossRevenue) * 0.5}</span></div>
                    <div className="flex justify-between font-bold text-base pt-1"><span>Total Gross</span><span>{grossRevenue}</span></div>
                </div>

                <button type="submit" disabled={isReconciling} className="w-full bg-brand-light dark:bg-brand-dark text-white font-bold py-2 rounded-lg mt-2 disabled:opacity-50">
                    {isReconciling ? 'Executing Dispersals...' : 'Finalize & Distribute to Wallets'}
                </button>
            </form>
        </div>

        {/* Escrow Holds Panel */}
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-sm p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-6">
                <Scale className="w-6 h-6 text-secondary-amber" />
                <h2 className="text-xl font-bold">Active Copyright Escrow Holds</h2>
            </div>

            <div className="flex-1 overflow-y-auto">
                {escrows.map(e => (
                    <div key={e.id} className="border border-border-light dark:border-border-dark rounded-lg p-4 mb-4">
                        <div className="font-bold mb-1 truncate">{e.video.title}</div>
                        <div className="text-secondary-amber font-medium mb-4">{e.heldAmountCents} Cents Withheld</div>

                        <div className="flex flex-wrap gap-2 text-sm font-bold">
                            <button onClick={() => resolveEscrow(e.id, e.claimId, 'RELEASE_TO_CREATOR')} className="flex items-center gap-1 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-3 py-1.5 rounded flex-1 justify-center">
                                <CheckCircle2 className="w-4 h-4" /> Release to Creator
                            </button>
                            <button onClick={() => resolveEscrow(e.id, e.claimId, 'TRANSFER_TO_CLAIMANT')} className="flex items-center gap-1 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-3 py-1.5 rounded flex-1 justify-center">
                                Transfer to Claimant
                            </button>
                        </div>
                    </div>
                ))}
                {escrows.length === 0 && <div className="text-gray-500 text-center py-10">No active escrow holds.</div>}
            </div>
        </div>

      </div>
    </div>
  );
};
