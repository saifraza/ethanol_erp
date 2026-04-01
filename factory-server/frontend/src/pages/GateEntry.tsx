import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface GateEntryItem {
  id: string;
  vehicleNo: string;
  direction: string;
  purpose: string;
  driverName: string | null;
  driverPhone: string | null;
  supplierName: string | null;
  poNumber: string | null;
  entryTime: string;
  exitTime: string | null;
  status: string;
  createdAt: string;
}

const PURPOSES = ['RAW_MATERIAL', 'FUEL', 'CHEMICAL', 'DDGS_DISPATCH', 'VISITOR', 'OTHER'];

export default function GateEntry() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<GateEntryItem[]>([]);
  const [inside, setInside] = useState<GateEntryItem[]>([]);
  const [showForm] = useState(true); // Always open — gate entry is the primary job
  const [form, setForm] = useState({ vehicleNo: '', direction: 'INBOUND', purpose: 'RAW_MATERIAL', driverName: '', driverPhone: '', supplierName: '', poNumber: '' });
  const [saving, setSaving] = useState(false);

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const fetchData = useCallback(async () => {
    try {
      const [entriesRes, insideRes] = await Promise.all([
        api.get('/gate-entry?limit=50'),
        api.get('/gate-entry/inside'),
      ]);
      setEntries(entriesRes.data);
      setInside(insideRes.data);
    } catch (err) { console.error(err); }
  }, [token]);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 15000); return () => clearInterval(iv); }, [fetchData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/gate-entry', { ...form, vehicleNo: form.vehicleNo.toUpperCase().replace(/\s/g, '') });
      setForm({ vehicleNo: '', direction: 'INBOUND', purpose: 'RAW_MATERIAL', driverName: '', driverPhone: '', supplierName: '', poNumber: '' }); // Reset form but keep open
      fetchData();
    } catch { alert('Failed to create entry'); }
    finally { setSaving(false); }
  };

  const handleExit = async (id: string) => {
    try { await api.patch(`/gate-entry/${id}/exit`); fetchData(); }
    catch { alert('Failed to mark exit'); }
  };

  const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Gate Entry</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Vehicle In/Out Register</span>
        </div>
        <button onClick={fetchData} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inside Now</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{inside.length}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Today Total</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{entries.length}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-orange-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inbound</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{entries.filter(e => e.direction === 'INBOUND').length}</div>
        </div>
      </div>

      {/* New Entry Form */}
      {showForm && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
          <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300">
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">New Vehicle Entry</span>
          </div>
          <form onSubmit={handleCreate} className="p-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Vehicle No</label>
                <input value={form.vehicleNo} onChange={e => setForm({ ...form, vehicleNo: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="MP 20 XX 1234" required autoFocus />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Direction</label>
                <select value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none">
                  <option value="INBOUND">INBOUND</option>
                  <option value="OUTBOUND">OUTBOUND</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Purpose</label>
                <select value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none">
                  {PURPOSES.map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Driver Name</label>
                <input value={form.driverName} onChange={e => setForm({ ...form, driverName: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none" placeholder="Driver name" />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Driver Phone</label>
                <input value={form.driverPhone} onChange={e => setForm({ ...form, driverPhone: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none" placeholder="Phone number" />
              </div>
              <div className="md:col-span-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Supplier / Company</label>
                <input value={form.supplierName} onChange={e => setForm({ ...form, supplierName: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none" placeholder="Supplier or company name" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">PO Number</label>
                <input value={form.poNumber} onChange={e => setForm({ ...form, poNumber: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none" placeholder="Optional" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Entry'}
              </button>
              <button type="reset" onClick={() => setForm({ vehicleNo: '', direction: 'INBOUND', purpose: 'RAW_MATERIAL', driverName: '', driverPhone: '', supplierName: '', poNumber: '' })} className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Clear
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Dir</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Purpose</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Driver</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Entry</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                <td className="px-3 py-1.5 text-slate-800 font-mono font-bold border-r border-slate-100">{e.vehicleNo}</td>
                <td className="px-3 py-1.5 border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${e.direction === 'INBOUND' ? 'border-green-300 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-700'}`}>
                    {e.direction === 'INBOUND' ? 'IN' : 'OUT'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{e.purpose?.replace(/_/g, ' ')}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{e.supplierName || '--'}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{e.driverName || '--'}</td>
                <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">{fmtDate(e.entryTime)} {fmtTime(e.entryTime)}</td>
                <td className="px-3 py-1.5 text-center border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${e.status === 'INSIDE' ? 'border-yellow-300 bg-yellow-50 text-yellow-700' : 'border-slate-300 bg-slate-50 text-slate-500'}`}>
                    {e.status}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-center">
                  {e.status === 'INSIDE' && (
                    <button onClick={() => handleExit(e.id)} className="px-3 py-1 bg-red-600 text-white text-[10px] font-bold uppercase hover:bg-red-700">
                      Exit
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No entries today</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
