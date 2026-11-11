import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldAlert, Users, Scale } from 'lucide-react';
import { ApertureLogo } from '../../components/brand/ApertureLogo';
import { ThemeToggle } from '../../components/theme/ThemeToggle';

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'REPORTS' | 'WTPP' | 'COPYRIGHT'>('REPORTS');
  const [reports, setReports] = useState<any[]>([]);
  const [wtpp, setWtpp] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);

  useEffect(() => {
    const fetchAdminData = async () => {
      try {
        if (activeTab === 'REPORTS') {
          const res = await axios.get('/api/v1/admin/reports');
          setReports(res.data);
        } else if (activeTab === 'WTPP') {
          const res = await axios.get('/api/v1/admin/wtpp/applications');
          setWtpp(res.data);
        } else if (activeTab === 'COPYRIGHT') {
          const res = await axios.get('/api/v1/admin/copyright/claims');
          setClaims(res.data);
        }
      } catch (error) {
        console.error('Failed to fetch admin data:', error);
      }
    };
    fetchAdminData();
  }, [activeTab]);

  const dismissReport = async (id: string) => {
    await axios.patch(`/api/v1/admin/reports/${id}`, { status: 'DISMISSED' });
    setReports(reports.filter(r => r.id !== id));
  };

  const handleWTPP = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    await axios.patch(`/api/v1/admin/wtpp/applications/${id}`, { status });
    setWtpp(wtpp.filter(w => w.id !== id));
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <ApertureLogo className="shrink-0" />
          <h1 className="text-xl font-bold font-display md:text-2xl">Trust & Safety Portal</h1>
        </div>
        <ThemeToggle />
      </div>

      <div className="mb-6 flex gap-4 overflow-x-auto border-b border-border-light dark:border-border-dark">
        <button
          onClick={() => setActiveTab('REPORTS')}
          className={`flex shrink-0 items-center gap-2 border-b-2 pb-3 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${activeTab === 'REPORTS' ? 'border-brand-primary text-brand-light dark:text-brand-dark' : 'border-transparent text-text-muted hover:text-text-primary'}`}
        >
          <ShieldAlert className="w-4 h-4" /> Moderation Queue
        </button>
        <button
          onClick={() => setActiveTab('WTPP')}
          className={`flex shrink-0 items-center gap-2 border-b-2 pb-3 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${activeTab === 'WTPP' ? 'border-brand-primary text-brand-light dark:text-brand-dark' : 'border-transparent text-text-muted hover:text-text-primary'}`}
        >
          <Users className="w-4 h-4" /> Partner Program (WTPP)
        </button>
        <button
          onClick={() => setActiveTab('COPYRIGHT')}
          className={`flex shrink-0 items-center gap-2 border-b-2 pb-3 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${activeTab === 'COPYRIGHT' ? 'border-brand-primary text-brand-light dark:text-brand-dark' : 'border-transparent text-text-muted hover:text-text-primary'}`}
        >
          <Scale className="w-4 h-4" /> Copyright Disputes
        </button>
      </div>

      <div className="overflow-hidden rounded-card border border-border-light bg-surface-raised shadow-sm dark:border-border-dark">
        {activeTab === 'REPORTS' && (
          <div className="p-6">
            <h2 className="font-bold mb-4">Open Reports</h2>
            {reports.map(r => (
              <div key={r.id} className="border border-border-light dark:border-border-dark p-4 rounded-lg mb-4 flex justify-between items-center">
                <div>
                  <div className="font-bold">{r.reason} on {r.targetType}</div>
                  <div className="text-sm text-text-muted">{r.details || 'No additional details provided.'}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => dismissReport(r.id)} className="rounded-control bg-surface-subtle px-3 py-1 text-sm font-medium transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Dismiss</button>
                  <button className="px-3 py-1 bg-red-600 text-white rounded font-medium text-sm">Review & Action</button>
                </div>
              </div>
            ))}
            {reports.length === 0 && <div className="text-text-muted">Queue is clear.</div>}
          </div>
        )}

        {activeTab === 'WTPP' && (
          <div className="p-6">
            <h2 className="font-bold mb-4">Pending WTPP Applications</h2>
            {wtpp.map(w => (
              <div key={w.id} className="border border-border-light dark:border-border-dark p-4 rounded-lg mb-4 flex justify-between items-center">
                <div>
                  <div className="font-bold">{w.channel.name} ({w.channel.handle})</div>
                  <div className="text-sm text-text-muted">{w.subscriberCount} Subs • {w.channelWatchHours.toFixed(1)} Watch Hours</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleWTPP(w.id, 'REJECTED')} className="rounded-control bg-surface-subtle px-3 py-1 text-sm font-medium text-red-600 transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Reject</button>
                  <button onClick={() => handleWTPP(w.id, 'APPROVED')} className="px-3 py-1 bg-green-600 text-white rounded font-medium text-sm">Approve Partner</button>
                </div>
              </div>
            ))}
            {wtpp.length === 0 && <div className="text-text-muted">Queue is clear.</div>}
          </div>
        )}

        {activeTab === 'COPYRIGHT' && (
          <div className="p-6">
            <h2 className="font-bold mb-4">Copyright Takedown Requests</h2>
            {claims.map(c => (
              <div key={c.id} className="border border-border-light dark:border-border-dark p-4 rounded-lg mb-4 flex justify-between items-center">
                <div>
                  <div className="font-bold">{c.video.title}</div>
                  <div className="line-clamp-2 text-sm text-text-muted">{c.description}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="rounded-control bg-surface-subtle px-3 py-1 text-sm font-medium transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Dismiss</button>
                  <button className="px-3 py-1 bg-red-600 text-white rounded font-medium text-sm">Approve Takedown</button>
                </div>
              </div>
            ))}
            {claims.length === 0 && <div className="text-text-muted">Queue is clear.</div>}
          </div>
        )}
      </div>
    </div>
  );
};
