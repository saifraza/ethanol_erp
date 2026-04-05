import { useState, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface WeighmentRecord {
  id: string;
  localId: string;
  ticketNo: number | null;
  vehicleNo: string;
  direction: string;
  supplierName: string | null;
  materialName: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  grossTime: string | null;
  tareTime: string | null;
  status: string;
  labStatus: string | null;
  createdAt: string;
}

export default function History() {
  const { token } = useAuth();
  const [vehicle, setVehicle] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [results, setResults] = useState<WeighmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const search = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (vehicle) params.set('vehicle', vehicle);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      params.set('limit', '200');
      const res = await api.get(`/weighbridge/search?${params}`);
      setResults(res.data);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, [vehicle, fromDate, toDate, token]);

  const fmtKg = (n: number | null) => n == null ? '--' : n.toLocaleString('en-IN');
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Search History</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Find and reprint weighment slips</span>
        </div>
      </div>

      {/* Search Filters */}
      <div className="-mx-3 md:-mx-6 bg-slate-100 border-x border-b border-slate-300 px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Vehicle No</label>
            <input value={vehicle} onChange={e => setVehicle(e.target.value.toUpperCase())}
              className="border border-slate-300 px-2.5 py-1.5 text-xs font-mono w-40 focus:outline-none focus:ring-1 focus:ring-slate-400"
              placeholder="e.g. MP20GA1234" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">From Date</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">To Date</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <button onClick={search} disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-bold uppercase hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {/* Results Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gross Date</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tare Date</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Dir</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gross</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tare</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Print</th>
            </tr>
          </thead>
          <tbody>
            {results.map((w, i) => (
              <tr key={w.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">#{w.ticketNo || '--'}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">
                  {w.grossTime ? <><div>{fmtDate(w.grossTime)}</div><div className="text-slate-400">{fmtTime(w.grossTime)}</div></> : <span className="text-slate-300">--</span>}
                </td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">
                  {w.tareTime ? <><div>{fmtDate(w.tareTime)}</div><div className="text-slate-400">{fmtTime(w.tareTime)}</div></> : <span className="text-slate-300">--</span>}
                </td>
                <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100">{w.vehicleNo}</td>
                <td className="px-3 py-1.5 border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${w.direction === 'INBOUND' ? 'border-green-300 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-700'}`}>
                    {w.direction === 'INBOUND' ? 'IN' : 'OUT'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.supplierName || '--'}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.materialName || '--'}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtKg(w.grossWeight)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtKg(w.tareWeight)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-green-700 border-r border-slate-100">{fmtKg(w.netWeight)}</td>
                <td className="px-3 py-1.5 text-center border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                    w.status === 'COMPLETE' ? 'border-green-300 bg-green-50 text-green-700' :
                    w.status === 'FIRST_DONE' ? 'border-yellow-300 bg-yellow-50 text-yellow-700' :
                    'border-slate-300 bg-slate-50 text-slate-500'
                  }`}>
                    {w.status}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => window.open(`/api/weighbridge/print/gate-pass/${w.id}`, '_blank')}
                      className="px-1.5 py-0.5 text-[9px] font-bold uppercase border border-slate-300 text-slate-500 hover:bg-slate-100">
                      Gate
                    </button>
                    {w.grossWeight && (
                      <button onClick={() => window.open(`/api/weighbridge/print/gross-slip/${w.id}`, '_blank')}
                        className="px-1.5 py-0.5 text-[9px] font-bold uppercase border border-blue-300 text-blue-600 hover:bg-blue-50">
                        Gross
                      </button>
                    )}
                    {w.status === 'COMPLETE' && (
                      <button onClick={() => window.open(`/api/weighbridge/print/final-slip/${w.id}`, '_blank')}
                        className="px-1.5 py-0.5 text-[9px] font-bold uppercase border border-green-300 text-green-600 hover:bg-green-50">
                        Final
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {results.length === 0 && searched && !loading && (
              <tr><td colSpan={12} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No results found</td></tr>
            )}
            {!searched && (
              <tr><td colSpan={12} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">Enter search criteria and click Search</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
