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
  worker?: { running: boolean; consecutiveFailures: number; lastPush?: { synced: number; failed: number; at: string }; lastPull?: { at: string } };
}

interface SyncWeighment {
  id: string;
  vehicleNo: string;
  materialName: string | null;
  materialCategory: string | null;
  direction: string;
  status: string;
  purchaseType: string | null;
  supplierName: string | null;
  netWeight: number | null;
  cloudSynced: boolean;
  cloudSyncedAt: string | null;
  cloudError: string | null;
  syncAttempts: number;
  createdAt: string;
}

interface SyncSummary {
  totalToday: number;
  syncedToday: number;
  pendingToday: number;
  failedToday: number;
}

export default function AdminDashboard() {
  const { token } = useAuth();
  const [pcs, setPcs] = useState<PcStatus[]>([]);
  const [sync, setSync] = useState<SyncStatus>({ pendingSync: { weighments: 0, gateEntries: 0 }, failedQueue: 0 });
  const [syncing, setSyncing] = useState('');
  const [weighments, setWeighments] = useState<SyncWeighment[]>([]);
  const [summary, setSummary] = useState<SyncSummary>({ totalToday: 0, syncedToday: 0, pendingToday: 0, failedToday: 0 });
  const [filter, setFilter] = useState<'all' | 'pending' | 'failed' | 'synced'>('all');
  const [resyncingIds, setResyncingIds] = useState<Set<string>>(new Set());
  const [date, setDate] = useState<string>(() => {
    // default = today IST as YYYY-MM-DD
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().slice(0, 10);
  });
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const fetchData = useCallback(async () => {
    try {
      const [pcRes, syncRes, wRes] = await Promise.all([
        api.get('/factory-pcs'),
        api.get('/sync/status'),
        api.get(`/sync/weighments?filter=${filter}&date=${date}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
      ]);
      setPcs(pcRes.data);
      setSync(syncRes.data);
      setWeighments(wRes.data.weighments || []);
      setTotal(wRes.data.total || 0);
      setSummary(wRes.data.summary || { totalToday: 0, syncedToday: 0, pendingToday: 0, failedToday: 0 });
    } catch (err) { console.error(err); }
  }, [token, filter, date, page]);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 15000); return () => clearInterval(iv); }, [fetchData]);
  useEffect(() => { setPage(0); }, [filter, date]);

  const triggerSync = async (type: 'to-cloud' | 'from-cloud') => {
    setSyncing(type);
    try {
      await api.post(`/sync/${type}`);
      fetchData();
    } catch { /* ignore */ }
    finally { setSyncing(''); }
  };

  const resyncItem = async (id: string) => {
    setResyncingIds(prev => new Set(prev).add(id));
    try {
      await api.post('/sync/resync', { ids: [id] });
      fetchData();
    } catch { /* ignore */ }
    finally { setResyncingIds(prev => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const resyncAllFailed = async () => {
    setSyncing('resync');
    try {
      await api.post('/sync/resync');
      fetchData();
    } catch { /* ignore */ }
    finally { setSyncing(''); }
  };

  const onlinePcs = pcs.filter(p => p.alive).length;
  const totalPending = sync.pendingSync.weighments + sync.pendingSync.gateEntries;

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };
  const fmtWeight = (kg: number | null) => kg ? (kg / 1000).toFixed(2) + ' MT' : '--';

  const statusColor = (w: SyncWeighment) => {
    if (w.cloudSynced && !w.cloudError) return 'border-green-300 bg-green-50 text-green-700';
    if (w.cloudError) return 'border-red-300 bg-red-50 text-red-700';
    return 'border-yellow-300 bg-yellow-50 text-yellow-700';
  };
  const statusLabel = (w: SyncWeighment) => {
    if (w.cloudSynced && !w.cloudError) return 'SYNCED';
    if (w.cloudSynced && w.cloudError) return 'WARN';
    if (w.cloudError) return 'FAILED';
    return 'PENDING';
  };

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

      {/* Cloud Sync Detail */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Cloud Sync</span>
            <span className="text-[10px] text-slate-400">|</span>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-slate-300 px-2 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            <button
              onClick={() => {
                const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
                setDate(ist.toISOString().slice(0, 10));
              }}
              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50"
            >
              Today
            </button>
          </div>
          <div className="flex gap-1 items-center">
            {sync.worker?.lastPush && (
              <span className="text-[9px] text-slate-400 mr-3">
                Last push: {fmtTime(sync.worker.lastPush.at)} ({sync.worker.lastPush.synced}ok/{sync.worker.lastPush.failed}fail)
              </span>
            )}
            {sync.worker && sync.worker.consecutiveFailures > 0 && (
              <span className="text-[9px] font-bold text-red-600 mr-3">
                {sync.worker.consecutiveFailures} consecutive failures
              </span>
            )}
            <button onClick={resyncAllFailed} disabled={syncing === 'resync' || summary.failedToday === 0}
              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-30">
              {syncing === 'resync' ? 'Resetting...' : 'Retry All Failed'}
            </button>
          </div>
        </div>

        {/* Sync KPIs */}
        <div className="grid grid-cols-4 gap-0 border-b border-slate-300">
          <div className="bg-white px-4 py-2 border-r border-slate-300 cursor-pointer hover:bg-slate-50" onClick={() => setFilter('all')}>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Total</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${filter === 'all' ? 'text-blue-600' : 'text-slate-800'}`}>{summary.totalToday}</div>
          </div>
          <div className="bg-white px-4 py-2 border-r border-slate-300 cursor-pointer hover:bg-slate-50" onClick={() => setFilter('synced')}>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Synced</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${filter === 'synced' ? 'text-green-600' : 'text-green-700'}`}>{summary.syncedToday}</div>
          </div>
          <div className="bg-white px-4 py-2 border-r border-slate-300 cursor-pointer hover:bg-slate-50" onClick={() => setFilter('pending')}>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Pending</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${filter === 'pending' ? 'text-yellow-600' : 'text-yellow-700'}`}>{summary.pendingToday}</div>
          </div>
          <div className="bg-white px-4 py-2 cursor-pointer hover:bg-slate-50" onClick={() => setFilter('failed')}>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Errors</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${filter === 'failed' ? 'text-red-600' : 'text-red-700'}`}>{summary.failedToday}</div>
          </div>
        </div>

        {/* Weighment Sync Table */}
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-center px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Sync</th>
              <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
              <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
              <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
              <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
              <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net Wt</th>
              <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
              <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Time</th>
              <th className="text-center px-2 py-2 font-semibold text-[10px] uppercase tracking-widest w-16">Act</th>
            </tr>
          </thead>
          <tbody>
            {weighments.map((w, i) => (
              <tr key={w.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                <td className="px-2 py-1.5 text-center border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor(w)}`}>
                    {statusLabel(w)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-slate-800 font-bold border-r border-slate-100">{w.vehicleNo}</td>
                <td className="px-2 py-1.5 border-r border-slate-100">
                  <span className="text-slate-700">{w.materialName || '--'}</span>
                  {w.materialCategory && (
                    <span className={`ml-1 text-[8px] font-bold uppercase px-1 py-0.5 border ${
                      w.materialCategory === 'FUEL' ? 'border-orange-200 bg-orange-50 text-orange-600' :
                      w.materialCategory === 'RAW_MATERIAL' ? 'border-green-200 bg-green-50 text-green-600' :
                      w.materialCategory === 'DDGS' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                      'border-slate-200 bg-slate-50 text-slate-500'
                    }`}>{w.materialCategory}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-slate-500 border-r border-slate-100">
                  {w.direction === 'INBOUND' ? 'IN' : 'OUT'}
                  {w.purchaseType && <span className="ml-1 text-[9px] text-slate-400">({w.purchaseType})</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-600 border-r border-slate-100 max-w-[140px] truncate">{w.supplierName || '--'}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtWeight(w.netWeight)}</td>
                <td className="px-2 py-1.5 border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                    w.status === 'COMPLETE' ? 'border-green-300 bg-green-50 text-green-700' :
                    w.status === 'FIRST_DONE' ? 'border-blue-300 bg-blue-50 text-blue-700' :
                    w.status === 'GATE_ENTRY' ? 'border-slate-300 bg-slate-50 text-slate-600' :
                    'border-slate-200 bg-slate-50 text-slate-500'
                  }`}>{w.status}</span>
                </td>
                <td className="px-2 py-1.5 text-slate-500 font-mono border-r border-slate-100">{fmtTime(w.createdAt)}</td>
                <td className="px-2 py-1.5 text-center">
                  {(w.cloudError || !w.cloudSynced) && w.status === 'COMPLETE' && (
                    <button onClick={() => resyncItem(w.id)} disabled={resyncingIds.has(w.id)}
                      className="px-1.5 py-0.5 bg-white border border-slate-300 text-slate-500 text-[9px] font-medium hover:bg-slate-50 hover:text-slate-700 disabled:opacity-30">
                      {resyncingIds.has(w.id) ? '...' : 'Retry'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {weighments.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">
                {filter === 'all' ? `No weighments for ${date}` : `No ${filter} weighments for ${date}`}
              </td></tr>
            )}
          </tbody>
        </table>
        {/* Pagination footer */}
        <div className="bg-slate-100 border-t border-slate-300 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">
            {total === 0
              ? 'No rows'
              : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total} for ${date}`}
          </span>
          <div className="flex gap-1 items-center">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-[10px] text-slate-500 font-mono tabular-nums px-2">
              Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <button
              onClick={() => setPage(p => ((p + 1) * PAGE_SIZE < total ? p + 1 : p))}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
        {weighments.length > 0 && weighments.some(w => w.cloudError) && (
          <div className="border-t border-slate-200 bg-red-50/50 p-3">
            <div className="text-[10px] font-bold text-red-600 uppercase tracking-widest mb-2">Error Details</div>
            {weighments.filter(w => w.cloudError).slice(0, 5).map(w => (
              <div key={w.id} className="text-[10px] text-red-700 font-mono mb-1">
                {w.vehicleNo}: {w.cloudError}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
