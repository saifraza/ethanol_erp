import { useState, useEffect, useCallback, useMemo } from 'react';
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
  materialCategory: string | null;
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
  byCategory?: Record<string, number>;
}

type TabKey = 'ALL' | 'RAW_MATERIAL' | 'FUEL' | 'OUTBOUND' | 'OTHER';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'RAW_MATERIAL', label: 'Raw Material' },
  { key: 'FUEL', label: 'Fuel' },
  { key: 'OUTBOUND', label: 'Outbound' },
  { key: 'OTHER', label: 'Other' },
];

const KNOWN_CATS = new Set(['RAW_MATERIAL', 'FUEL', 'CHEMICAL', 'PACKING']);

function getCategoryForTab(w: WeighmentItem): TabKey {
  if (w.direction === 'OUTBOUND') return 'OUTBOUND';
  if (w.materialCategory === 'RAW_MATERIAL') return 'RAW_MATERIAL';
  if (w.materialCategory === 'FUEL') return 'FUEL';
  return 'OTHER';
}

function categoryBorderColor(cat: TabKey): string {
  switch (cat) {
    case 'RAW_MATERIAL': return 'border-l-green-500';
    case 'FUEL': return 'border-l-orange-500';
    case 'OUTBOUND': return 'border-l-blue-500';
    default: return 'border-l-slate-300';
  }
}

/** Check if a date string is from today (IST) */
function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  // Compare in IST by using locale date string
  return d.toLocaleDateString('en-IN') === now.toLocaleDateString('en-IN');
}

function dateBadge(dateStr: string): string | null {
  if (isToday(dateStr)) return null;
  const d = new Date(dateStr);
  const now = new Date();
  // Check if yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toLocaleDateString('en-IN') === yesterday.toLocaleDateString('en-IN')) return 'YESTERDAY';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase();
}

export default function Weighment() {
  const { token } = useAuth();
  const [weighments, setWeighments] = useState<WeighmentItem[]>([]);
  const [stats, setStats] = useState<Stats>({ today: { total: 0, completed: 0, pending: 0 }, unsynced: 0 });
  const [activeTab, setActiveTab] = useState<TabKey>('ALL');
  const [lightbox, setLightbox] = useState<{ url: string; weighment: WeighmentItem; type: string } | null>(null);
  const [date, setDate] = useState<string>(() => {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().slice(0, 10);
  });
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const fetchData = useCallback(async () => {
    try {
      const [wRes, sRes] = await Promise.all([
        api.get(`/weighbridge/weighments?date=${date}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
        api.get('/weighbridge/stats'),
      ]);
      setWeighments(wRes.data.weighments || []);
      setTotal(wRes.data.total || 0);
      setStats(sRes.data);
    } catch (err) { console.error(err); }
  }, [token, date, page]);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 10000); return () => clearInterval(iv); }, [fetchData]);
  useEffect(() => { setPage(0); }, [date]);

  // Compute tab counts from loaded data
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { ALL: weighments.length, RAW_MATERIAL: 0, FUEL: 0, OUTBOUND: 0, OTHER: 0 };
    for (const w of weighments) {
      counts[getCategoryForTab(w)]++;
    }
    return counts;
  }, [weighments]);

  // Filter by active tab
  const filtered = useMemo(() => {
    if (activeTab === 'ALL') return weighments;
    return weighments.filter(w => getCategoryForTab(w) === activeTab);
  }, [weighments, activeTab]);

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
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-slate-600 bg-slate-700 text-white px-2 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={() => {
              const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
              setDate(ist.toISOString().slice(0, 10));
            }}
            className="px-2 py-0.5 bg-slate-700 border border-slate-600 text-slate-200 text-[10px] font-medium hover:bg-slate-600"
          >
            Today
          </button>
          <button onClick={fetchData} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
            Refresh
          </button>
        </div>
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

      {/* Category Tabs */}
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap transition ${
              activeTab === t.key ? 'border-b-2 border-blue-600 text-blue-700 bg-white' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
            <span className={`ml-1 text-[9px] ${activeTab === t.key ? 'text-blue-500' : 'text-slate-400'}`}>
              ({tabCounts[t.key]})
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
              <th className="text-center px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Dir</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gross</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tare</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Sync</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Photos</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w, i) => {
              const cat = getCategoryForTab(w);
              const badge = dateBadge(w.createdAt);
              return (
                <tr key={w.id} className={`border-b border-slate-100 hover:bg-blue-50/60 border-l-4 ${categoryBorderColor(cat)} ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-800 font-mono font-bold">{w.vehicleNo}</span>
                      {badge && (
                        <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-orange-100 text-orange-700 border border-orange-300 whitespace-nowrap">{badge}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center border-r border-slate-100">
                    <span className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${
                      w.direction === 'OUTBOUND' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-green-300 bg-green-50 text-green-700'
                    }`}>{w.direction === 'OUTBOUND' ? 'OUT' : 'IN'}</span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.purchaseType || '--'}</td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.supplierName || '--'}</td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">
                    <span>{w.materialName || '--'}</span>
                    {w.materialCategory && activeTab === 'ALL' && (
                      <span className={`ml-1 text-[8px] font-bold uppercase px-1 py-0.5 border ${
                        w.materialCategory === 'RAW_MATERIAL' ? 'border-green-200 bg-green-50 text-green-600' :
                        w.materialCategory === 'FUEL' ? 'border-orange-200 bg-orange-50 text-orange-600' :
                        'border-slate-200 bg-slate-50 text-slate-500'
                      }`}>{w.materialCategory === 'RAW_MATERIAL' ? 'RM' : w.materialCategory}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtKg(w.grossWeight)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtKg(w.tareWeight)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-800 border-r border-slate-100">{fmtKg(w.netWeight)}</td>
                  <td className="px-3 py-1.5 text-center border-r border-slate-100">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                      w.status === 'COMPLETE' ? 'border-green-300 bg-green-50 text-green-700' :
                      w.status === 'GROSS_DONE' || w.status === 'FIRST_DONE' ? 'border-yellow-300 bg-yellow-50 text-yellow-700' :
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
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No weighments for {date}</td></tr>
            )}
          </tbody>
        </table>
        {/* Pagination footer */}
        <div className="bg-slate-100 border-t border-slate-300 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">
            {total === 0
              ? `No rows for ${date}`
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
