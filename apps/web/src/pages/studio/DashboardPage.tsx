import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Play, Clock, Wallet, ArrowUpRight } from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const [analytics, setAnalytics] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [isPayoutOpen, setIsPayoutOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [anRes, balRes, ledRes] = await Promise.all([
            axios.get('/api/v1/studio/analytics').catch(() => ({ data: null })),
            axios.get('/api/v1/wallet/balance').catch(() => ({ data: { balanceCents: '0', currency: 'RWF' } })),
            axios.get('/api/v1/wallet/ledger').catch(() => ({ data: [] }))
        ]);
        setAnalytics(anRes.data);
        setWallet(balRes.data);
        setLedger(ledRes.data);
      } catch (e) {
          console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const requestPayout = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const amount = Number(formData.get('amount'));
      const provider = formData.get('provider');
      const phone = formData.get('phone');

      try {
          await axios.post('/api/v1/wallet/request-payout', {
              amountCents: amount,
              provider,
              phoneNumber: phone
          });
          setIsPayoutOpen(false);
          // Refetch logic would go here
      } catch (error) {
          alert('Failed to request payout. Check balance.');
      }
  };

  if (isLoading) return <div className="p-6">Loading dashboard...</div>;
  if (!analytics) return <div className="p-6">Create a channel first.</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold font-display">Channel Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-3 text-gray-500 mb-2">
                <Users className="w-5 h-5" /> <span className="font-medium">Subscribers</span>
            </div>
            <div className="text-3xl font-bold tabular-nums">{analytics.subscriberCount}</div>
        </div>
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-3 text-gray-500 mb-2">
                <Play className="w-5 h-5" /> <span className="font-medium">Total Views</span>
            </div>
            <div className="text-3xl font-bold tabular-nums">{analytics.totalViews}</div>
        </div>
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-3 text-gray-500 mb-2">
                <Clock className="w-5 h-5" /> <span className="font-medium">Watch Time (hrs)</span>
            </div>
            <div className="text-3xl font-bold tabular-nums">{analytics.totalWatchHours.toFixed(1)}</div>
        </div>
        <div className="bg-gradient-to-br from-brand-light to-brand-dark text-white p-6 rounded-xl shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2 mb-2 opacity-90">
                    <Wallet className="w-5 h-5" /> <span className="font-medium">Wallet Balance</span>
                </div>
                <button onClick={() => setIsPayoutOpen(true)} className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded text-sm font-bold transition flex items-center gap-1">
                    Payout <ArrowUpRight className="w-4 h-4" />
                </button>
            </div>
            <div className="text-3xl font-bold tabular-nums">{wallet.balanceCents} <span className="text-lg opacity-80">{wallet.currency}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-sm overflow-hidden">
              <div className="p-6 border-b border-border-light dark:border-border-dark font-bold">Recent Video Performance</div>
              <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                      <tr>
                          <th className="p-4 font-medium">Video</th>
                          <th className="p-4 font-medium">Views</th>
                          <th className="p-4 font-medium">Likes</th>
                          <th className="p-4 font-medium">Comments</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light dark:divide-border-dark">
                      {analytics.recentPerformance.map((vid: any) => (
                          <tr key={vid.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                              <td className="p-4 font-medium max-w-xs truncate">{vid.title}</td>
                              <td className="p-4 tabular-nums">{vid.viewsCount}</td>
                              <td className="p-4 tabular-nums">{vid._count.likes}</td>
                              <td className="p-4 tabular-nums">{vid._count.comments}</td>
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>

          <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="p-6 border-b border-border-light dark:border-border-dark font-bold">Wallet Ledger</div>
              <div className="flex-1 overflow-y-auto max-h-[400px]">
                  {ledger.length > 0 ? ledger.map((tx: any) => (
                      <div key={tx.id} className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center text-sm">
                          <div>
                              <div className="font-bold">{tx.transactionType}</div>
                              <div className="text-xs text-gray-500">{new Date(tx.createdAt).toLocaleDateString()}</div>
                          </div>
                          <div className={`font-bold tabular-nums ${tx.amountCents.startsWith('-') ? 'text-red-500' : 'text-green-500'}`}>
                              {tx.amountCents.startsWith('-') ? '' : '+'}{tx.amountCents}
                          </div>
                      </div>
                  )) : <div className="p-6 text-center text-gray-500">No transactions yet.</div>}
              </div>
          </div>
      </div>

      {isPayoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-surface-light dark:bg-surface-dark p-6 rounded-2xl shadow-xl">
                <h2 className="text-xl font-bold font-display mb-4">Request Payout</h2>
                <form onSubmit={requestPayout} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Amount (RWF)</label>
                        <input name="amount" type="number" max={wallet.balanceCents} required className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Provider</label>
                        <select name="provider" className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2">
                            <option value="MTN_MOMO">MTN Mobile Money</option>
                            <option value="AIRTEL_MONEY">Airtel Money</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Phone Number</label>
                        <input name="phone" type="tel" required placeholder="e.g. 078XXXXXXX" className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2" />
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                        <button type="button" onClick={() => setIsPayoutOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
                        <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold bg-brand-light dark:bg-brand-dark text-white hover:opacity-90">Confirm Payout</button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};
