import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

interface DashboardData {
  total: number;
  compliantPercent: number;
  statusCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  riskCounts: Record<string, number>;
  heatmap: Record<string, Record<string, number>>;
  expiringSoon: { id: string; title: string; category: string; dueDate: string; riskLevel: string; status: string }[];
  recentActions: { id: string; actionType: string; description: string; performedBy: string; performedDate: string; obligation: { id: string; title: string; category: string } }[];
}

const CATEGORY_LABELS: Record<string, string> = {
  FACTORY_LABOR: 'Factory & Labor',
  ENVIRONMENTAL: 'Environmental',
  EXCISE_DISTILLERY: 'Excise & Distillery',
  POWER_ENERGY: 'Power & Energy',
  SUGAR_MILL: 'Sugar Mill',
  TAX_STATUTORY: 'Tax & Statutory',
  SEBI_LISTING: 'SEBI & Listing',
  HR_PEOPLE: 'HR & People',
  LEGAL_CORPORATE: 'Legal & Corporate',
};

const STATUS_COLORS: Record<string, string> = {
  COMPLIANT: 'border-green-600 bg-green-50 text-green-700',
  NON_COMPLIANT: 'border-red-600 bg-red-50 text-red-700',
  EXPIRING: 'border-amber-600 bg-amber-50 text-amber-700',
  PENDING: 'border-blue-600 bg-blue-50 text-blue-700',
  NOT_APPLICABLE: 'border-slate-400 bg-slate-50 text-slate-500',
};

const RISK_COLORS: Record<string, string> = {
  CRITICAL: 'border-red-600 bg-red-50 text-red-700',
  HIGH: 'border-orange-600 bg-orange-50 text-orange-700',
  MEDIUM: 'border-yellow-600 bg-yellow-50 text-yellow-700',
  LOW: 'border-green-600 bg-green-50 text-green-700',
};

const HEATMAP_BG: Record<string, string> = {
  COMPLIANT: 'bg-green-500 text-white',
  NON_COMPLIANT: 'bg-red-500 text-white',
  EXPIRING: 'bg-amber-500 text-white',
  PENDING: 'bg-blue-400 text-white',
  NOT_APPLICABLE: 'bg-slate-200 text-slate-500',
};

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ComplianceDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<DashboardData>('/compliance/dashboard');
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch compliance dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await api.post('/compliance/seed');
      alert(`Seeded: ${res.data.created} created, ${res.data.skipped} skipped`);
      fetchData();
    } catch (err) {
      console.error('Seed failed:', err);
    } finally {
      setSeeding(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading compliance data...</div>
    </div>
  );

  if (!data) return null;

  const statuses = ['COMPLIANT', 'NON_COMPLIANT', 'EXPIRING', 'PENDING', 'NOT_APPLICABLE'];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Compliance Management</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Regulatory Obligation Tracker</span>
          </div>
          <div className="flex items-center gap-2">
            {data.total === 0 && (
              <button onClick={handleSeed} disabled={seeding}
                className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
                {seeding ? 'Seeding...' : 'Seed Default Obligations'}
              </button>
            )}
            <button onClick={() => navigate('/compliance/register')}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              View Register
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Obligations</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{data.total}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Compliant</div>
            <div className="text-xl font-bold text-green-700 mt-1 font-mono tabular-nums">{data.compliantPercent}%</div>
            <div className="text-[10px] text-slate-400">{data.statusCounts['COMPLIANT'] || 0} of {data.total}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Expiring (30d)</div>
            <div className="text-xl font-bold text-amber-700 mt-1 font-mono tabular-nums">{data.expiringSoon.length}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Non-Compliant</div>
            <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{data.statusCounts['NON_COMPLIANT'] || 0}</div>
          </div>
          <div className="bg-white px-4 py-3 border-slate-300 border-l-4 border-l-red-600">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Critical Items</div>
            <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{data.riskCounts['CRITICAL'] || 0}</div>
          </div>
        </div>

        {/* Category Heatmap */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-48">Category</th>
                {statuses.map(s => (
                  <th key={s} className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">
                    {s.replace('_', ' ')}
                  </th>
                ))}
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(CATEGORY_LABELS).map((cat, i) => {
                const row = data.heatmap[cat] || {};
                const rowTotal = Object.values(row).reduce((a, b) => a + b, 0);
                if (rowTotal === 0) return null;
                return (
                  <tr key={cat} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-2 font-medium text-slate-700 border-r border-slate-100">
                      {CATEGORY_LABELS[cat]}
                    </td>
                    {statuses.map(s => (
                      <td key={s} className="text-center px-3 py-2 border-r border-slate-100">
                        {row[s] ? (
                          <span className={`inline-block w-8 h-6 leading-6 text-[10px] font-bold ${HEATMAP_BG[s]}`}>
                            {row[s]}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    ))}
                    <td className="text-center px-3 py-2 font-bold text-slate-700 font-mono">{rowTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Two columns: Expiring Soon + Recent Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 -mx-3 md:-mx-6">
          {/* Expiring Soon */}
          <div className="border-x border-b border-slate-300">
            <div className="bg-slate-200 border-b border-slate-300 px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Upcoming Due Dates (30 Days)</span>
            </div>
            {data.expiringSoon.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No obligations due in next 30 days</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {data.expiringSoon.map((item, i) => {
                    const days = daysUntil(item.dueDate);
                    return (
                      <tr key={item.id} className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''}`}
                        onClick={() => navigate(`/compliance/register?id=${item.id}`)}>
                        <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{item.title}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 w-24">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${RISK_COLORS[item.riskLevel] || ''}`}>
                            {item.riskLevel}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 w-20 text-right font-mono tabular-nums">
                          <span className={days !== null && days <= 7 ? 'text-red-600 font-bold' : days !== null && days <= 15 ? 'text-amber-600' : 'text-slate-600'}>
                            {days !== null ? `${days}d` : '--'}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 w-24 text-right text-slate-500">{fmtDate(item.dueDate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent Actions */}
          <div className="border-x border-b border-slate-300 lg:border-l-0">
            <div className="bg-slate-200 border-b border-slate-300 px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Recent Compliance Activity</span>
            </div>
            {data.recentActions.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No recent activity</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.recentActions.map(action => (
                  <div key={action.id} className="px-4 py-2 hover:bg-blue-50/60 cursor-pointer"
                    onClick={() => navigate(`/compliance/register?id=${action.obligation.id}`)}>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS['COMPLIANT']}`}>
                        {action.actionType}
                      </span>
                      <span className="text-xs text-slate-700 truncate">{action.obligation.title}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{action.description} &middot; {fmtDate(action.performedDate)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
