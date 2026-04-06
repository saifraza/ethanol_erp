import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface WeighmentItem {
  id: string;
  localId: string;
  pcId: string;
  pcName: string;
  vehicleNo: string;
  direction: string;
  purchaseType: string | null;
  poNumber: string | null;
  supplierName: string | null;
  materialName: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  grossTime: string | null;
  tareTime: string | null;
  status: string;
  grossPhotos: string | null;
  tarePhotos: string | null;
  cloudSynced: boolean;
  createdAt: string;
}

interface Stats {
  today: { total: number; completed: number; pending: number };
  unsynced: number;
}

export default function Weighment() {
  const { token } = useAuth();
  const [weighments, setWeighments] = useState<WeighmentItem[]>([]);
  const [stats, setStats] = useState<Stats>({ today: { total: 0, completed: 0, pending: 0 }, unsynced: 0 });
  const [lightbox, setLightbox] = useState<{ url: string; weighment: WeighmentItem; type: string } | null>(null);

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const fetchData = useCallback(async () => {
    try {
      const [wRes, sRes] = await Promise.all([
        api.get('/weighbridge/weighments?limit=50'),
        api.get('/weighbridge/stats'),
      ]);
      setWeighments(wRes.data);
      setStats(sRes.data);
    } catch (err) { console.error(err); }
  }, [token]);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 10000); return () => clearInterval(iv); }, [fetchData]);

  const fmtKg = (n: number | null) => n == null ? '--' : n.toLocaleString('en-IN') + ' kg';
  const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--';

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Weighment</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Weighbridge Records</span>
        </div>
        <button onClick={fetchData} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Today</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.today.total}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Complete</div>
          <div className="text-xl font-bold text-green-700 mt-1 font-mono tabular-nums">{stats.today.completed}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-yellow-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending</div>
          <div className="text-xl font-bold text-yellow-700 mt-1 font-mono tabular-nums">{stats.today.pending}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unsynced</div>
          <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{stats.unsynced}</div>
        </div>
      </div>

      {/* Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gross</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tare</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Sync</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PC</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Photos</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Time</th>
            </tr>
          </thead>
          <tbody>
            {weighments.map((w, i) => (
              <tr key={w.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                <td className="px-3 py-1.5 text-slate-800 font-mono font-bold border-r border-slate-100">{w.vehicleNo}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.purchaseType || '--'}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.supplierName || '--'}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.materialName || '--'}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtKg(w.grossWeight)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtKg(w.tareWeight)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-800 border-r border-slate-100">{fmtKg(w.netWeight)}</td>
                <td className="px-3 py-1.5 text-center border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                    w.status === 'COMPLETE' ? 'border-green-300 bg-green-50 text-green-700' :
                    w.status === 'GROSS_DONE' ? 'border-yellow-300 bg-yellow-50 text-yellow-700' :
                    'border-slate-300 bg-slate-50 text-slate-500'
                  }`}>
                    {w.status}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-center border-r border-slate-100">
                  {w.cloudSynced ? (
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">OK</span>
                  ) : (
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-400">--</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{w.pcName || w.pcId}</td>
                <td className="px-2 py-1.5 text-center border-r border-slate-100">
                  {(w.grossPhotos || w.tarePhotos) ? (
                    <div className="flex gap-1 justify-center">
                      {[...(w.grossPhotos?.split(',') || []).map(p => ({p, type: 'GROSS'})), ...(w.tarePhotos?.split(',') || []).map(p => ({p, type: 'TARE'}))].filter(x => x.p).map((x, j) => (
                        <img key={j} src={`/snapshots/${x.p}`} alt="" className="w-10 h-8 object-cover cursor-pointer border-2 border-slate-300 hover:border-blue-500 hover:scale-110 transition-transform"
                          onClick={() => setLightbox({ url: `/snapshots/${x.p}`, weighment: w, type: x.type })} loading="lazy" />
                      ))}
                    </div>
                  ) : <span className="text-[9px] text-slate-300">--</span>}
                </td>
                <td className="px-3 py-1.5 text-slate-500 font-mono">{fmtTime(w.createdAt)}</td>
              </tr>
            ))}
            {weighments.length === 0 && (
              <tr><td colSpan={12} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No weighments</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Lightbox with weighment info overlay */}
      {lightbox && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center" onClick={() => setLightbox(null)}>
          <div className="relative w-full h-full flex items-center justify-center">
            <img src={lightbox.url} alt="Weighbridge snapshot" className="max-w-full max-h-full object-contain" />
            {/* Info overlay — top bar */}
            <div className="absolute top-0 left-0 right-0 bg-black/70 px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-white font-mono font-bold text-lg">{lightbox.weighment.vehicleNo}</span>
                <span className="text-yellow-400 font-bold text-xs uppercase px-2 py-0.5 border border-yellow-400">{lightbox.type} WEIGHT</span>
                <span className="text-slate-300 text-xs uppercase">{lightbox.weighment.direction === 'OUTBOUND' ? 'OUT' : 'IN'}</span>
              </div>
              <span className="text-slate-400 text-xs font-mono">{lightbox.weighment.supplierName}</span>
            </div>
            {/* Info overlay — bottom bar */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-4 py-2">
              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-6">
                  <div>
                    <div className="text-[9px] text-slate-400 uppercase">Gross</div>
                    <div className="font-mono font-bold">{lightbox.weighment.grossWeight ? lightbox.weighment.grossWeight.toLocaleString('en-IN') + ' kg' : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400 uppercase">Tare</div>
                    <div className="font-mono font-bold">{lightbox.weighment.tareWeight ? lightbox.weighment.tareWeight.toLocaleString('en-IN') + ' kg' : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400 uppercase">Net</div>
                    <div className="font-mono font-bold text-green-400">{lightbox.weighment.netWeight ? lightbox.weighment.netWeight.toLocaleString('en-IN') + ' kg' : '--'}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] text-slate-400 uppercase">Time</div>
                  <div className="font-mono text-sm">{fmtTime(lightbox.type === 'GROSS' ? lightbox.weighment.grossTime : lightbox.weighment.tareTime)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
