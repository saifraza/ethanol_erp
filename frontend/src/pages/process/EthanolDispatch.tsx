import { useState, useEffect, useCallback } from 'react';
import { Share2, X } from 'lucide-react';
import api from '../../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface DispatchRow {
  id: string;
  date: string;
  vehicleNo: string;
  partyName: string;
  destination: string;
  quantityBL: number;
  strength: number | null;
  status: string;
  gateInTime: string | null;
  releaseTime: string | null;
  weightGross: number | null;
  weightTare: number | null;
  weightNet: number | null;
  contractId: string | null;
  photoUrl: string | null;
  remarks: string | null;
  sealNo: string | null;
  rstNo: string | null;
  driverName: string | null;
  transporterName: string | null;
  gatePassNo: string | null;
  challanNo: string | null;
  contract: { contractNo: string; buyerName: string } | null;
}

interface Summary {
  totalBL: number;
  totalTrucks: number;
  avgPerTruck: number;
  releasedCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  GATE_IN: 'border-yellow-400 bg-yellow-50 text-yellow-700',
  TARE_WEIGHED: 'border-blue-400 bg-blue-50 text-blue-700',
  GROSS_WEIGHED: 'border-purple-400 bg-purple-50 text-purple-700',
  RELEASED: 'border-green-400 bg-green-50 text-green-700',
};

function fmtDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function fmtTime(d: string | null) {
  if (!d) return '--';
  const dt = new Date(d);
  return dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtNum(n: number) {
  return n === 0 ? '--' : n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

export default function EthanolDispatch() {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [dispatches, setDispatches] = useState<DispatchRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalBL: 0, totalTrucks: 0, avgPerTruck: 0, releasedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ from, to });
      if (status !== 'ALL') params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      const res = await api.get(`/dispatch/report?${params}`);
      setDispatches(res.data.dispatches || []);
      setSummary(res.data.summary || { totalBL: 0, totalTrucks: 0, avgPerTruck: 0, releasedCount: 0 });
    } catch (err) {
      console.error('Failed to fetch dispatches:', err);
    } finally {
      setLoading(false);
    }
  }, [from, to, status, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function shareTelegram() {
    const lines = dispatches
      .filter(d => d.quantityBL > 0)
      .map((d, i) =>
        `${i + 1}. ${d.vehicleNo} | ${d.partyName || '-'} | ${d.destination || '-'} | ${d.quantityBL} BL${d.strength ? ` @ ${d.strength}%` : ''}`
      ).join('\n');
    const text = `*Ethanol Dispatch Report*\n${from} to ${to}\n\n${lines}\n\n*Total: ${fmtNum(summary.totalBL)} BL (${summary.totalTrucks} trucks)*`;
    try {
      await api.post('/telegram/send-report', { message: text, module: 'dispatch' });
      setMsg({ type: 'ok', text: 'Report shared via Telegram' });
    } catch {
      setMsg({ type: 'err', text: 'Telegram share failed' });
    }
    setTimeout(() => setMsg(null), 3000);
  }

  if (loading && dispatches.length === 0) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Ethanol Dispatch</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Dispatch History & Reports</span>
          </div>
          <div className="flex items-center gap-2">
            {msg && <span className={`text-[10px] ${msg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</span>}
            {dispatches.length > 0 && (
              <button onClick={shareTelegram}
                className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 flex items-center gap-1">
                <Share2 size={12} /> Telegram
              </button>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
              <option value="ALL">All</option>
              <option value="GATE_IN">Gate In</option>
              <option value="TARE_WEIGHED">Tare Weighed</option>
              <option value="GROSS_WEIGHED">Gross Weighed</option>
              <option value="RELEASED">Released</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Party</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-40" />
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Dispatched</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtNum(summary.totalBL)}</div>
            <div className="text-[10px] text-slate-400">BL</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Trucks</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.totalTrucks}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg / Truck</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtNum(summary.avgPerTruck)}</div>
            <div className="text-[10px] text-slate-400">BL</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Released</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.releasedCount}</div>
          </div>
        </div>

        {/* Data Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Party / Buyer</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Destination</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Qty (BL)</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Str %</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gate In</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Released</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Contract</th>
              </tr>
            </thead>
            <tbody>
              {dispatches.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No dispatches found</td></tr>
              )}
              {dispatches.map((d, i) => (
                <tr key={d.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''} cursor-pointer`}
                  onClick={() => d.photoUrl ? setPhotoPreview(`${API_BASE}${d.photoUrl}`) : null}>
                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDate(d.date)}</td>
                  <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100 whitespace-nowrap">{d.vehicleNo || '--'}</td>
                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{d.contract?.buyerName || d.partyName || '--'}</td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{d.destination || '--'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{d.quantityBL > 0 ? fmtNum(d.quantityBL) : '--'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">{d.strength ? d.strength.toFixed(1) : '--'}</td>
                  <td className="px-3 py-1.5 text-center border-r border-slate-100">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[d.status] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                      {d.status?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center text-slate-500 border-r border-slate-100 whitespace-nowrap">{fmtTime(d.gateInTime)}</td>
                  <td className="px-3 py-1.5 text-center text-slate-500 border-r border-slate-100 whitespace-nowrap">{fmtTime(d.releaseTime)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{d.contract?.contractNo || '--'}</td>
                </tr>
              ))}
            </tbody>
            {dispatches.length > 0 && (
              <tfoot>
                <tr className="bg-slate-800 text-white font-semibold">
                  <td className="px-3 py-2 text-[10px] uppercase tracking-widest border-r border-slate-700" colSpan={4}>Total</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(summary.totalBL)}</td>
                  <td className="px-3 py-2 border-r border-slate-700"></td>
                  <td className="px-3 py-2 text-center text-[10px] border-r border-slate-700">{summary.totalTrucks} TRUCKS</td>
                  <td className="px-3 py-2 border-r border-slate-700" colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Photo Preview Modal */}
      {photoPreview && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPhotoPreview(null)}>
          <div className="relative max-w-2xl w-full">
            <button onClick={() => setPhotoPreview(null)}
              className="absolute -top-10 right-0 text-white"><X size={24} /></button>
            <img src={photoPreview} alt="Dispatch photo" className="w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
