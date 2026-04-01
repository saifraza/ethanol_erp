import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface PcStatus {
  pcId: string;
  pcName: string;
  pcRole: string;
  lanIp: string;
  port: number;
  alive: boolean;
  lastChecked: string;
  data: Record<string, unknown> | null;
}

interface SyncStatus {
  pendingSync: { weighments: number; gateEntries: number };
  failedQueue: number;
}

export default function AdminDashboard() {
  const { token } = useAuth();
  const [pcs, setPcs] = useState<PcStatus[]>([]);
  const [sync, setSync] = useState<SyncStatus>({ pendingSync: { weighments: 0, gateEntries: 0 }, failedQueue: 0 });
  const [syncing, setSyncing] = useState('');

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const fetchData = useCallback(async () => {
    try {
      const [pcRes, syncRes] = await Promise.all([
        api.get('/factory-pcs'),
        api.get('/sync/status'),
      ]);
      setPcs(pcRes.data);
      setSync(syncRes.data);
    } catch (err) { console.error(err); }
  }, [token]);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 15000); return () => clearInterval(iv); }, [fetchData]);

  const triggerSync = async (type: 'to-cloud' | 'from-cloud') => {
    setSyncing(type);
    try {
      await api.post(`/sync/${type}`);
      fetchData();
    } catch { /* ignore */ }
    finally { setSyncing(''); }
  };

  const onlinePcs = pcs.filter(p => p.alive).length;
  const totalPending = sync.pendingSync.weighments + sync.pendingSync.gateEntries;

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Dashboard</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Factory System Overview</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => triggerSync('from-cloud')} disabled={syncing === 'from-cloud'}
            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50">
            {syncing === 'from-cloud' ? 'Pulling...' : 'Pull Master Data'}
          </button>
          <button onClick={() => triggerSync('to-cloud')} disabled={syncing === 'to-cloud'}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
            {syncing === 'to-cloud' ? 'Pushing...' : 'Push to Cloud'}
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Factory PCs</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{pcs.length}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Online</div>
          <div className="text-xl font-bold text-green-700 mt-1 font-mono tabular-nums">{onlinePcs}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-yellow-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending Sync</div>
          <div className="text-xl font-bold text-yellow-700 mt-1 font-mono tabular-nums">{totalPending}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Failed Queue</div>
          <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{sync.failedQueue}</div>
        </div>
      </div>

      {/* PC Status Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300">
          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Factory PCs</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Status</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PC Name</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Role</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">LAN IP</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Port</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Last Checked</th>
            </tr>
          </thead>
          <tbody>
            {pcs.map((pc, i) => (
              <tr key={pc.pcId} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                <td className="px-3 py-1.5 text-center border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${pc.alive ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                    {pc.alive ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-800 font-bold border-r border-slate-100">{pc.pcName}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{pc.pcRole}</td>
                <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">{pc.lanIp}</td>
                <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">{pc.port}</td>
                <td className="px-3 py-1.5 text-slate-500 font-mono">
                  {new Date(pc.lastChecked).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </td>
              </tr>
            ))}
            {pcs.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No PCs reporting</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sync Details */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300">
          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Cloud Sync</span>
        </div>
        <div className="bg-white p-4 grid grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Weighments Pending</div>
            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums mt-1">{sync.pendingSync.weighments}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gate Entries Pending</div>
            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums mt-1">{sync.pendingSync.gateEntries}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Failed (Dead Letter)</div>
            <div className="text-lg font-bold text-red-700 font-mono tabular-nums mt-1">{sync.failedQueue}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
