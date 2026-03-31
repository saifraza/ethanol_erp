import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface FuelItem {
  id: string;
  name: string;
  code: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number | null;
  avgCost: number;
  defaultRate: number;
  steamRate: number | null;
  calorificValue: number | null;
  hsnCode: string | null;
  gstPercent: number;
  location: string | null;
  remarks: string | null;
  isActive: boolean;
}

interface ConsumptionRow {
  fuelItemId: string;
  fuelName: string;
  fuelCode: string;
  unit: string;
  steamRate: number;
  id: string | null;
  openingStock: number;
  received: number;
  consumed: number;
  closingStock: number;
  steamGenerated: number;
  remarks: string;
}

interface Summary {
  fuelTypes: number;
  lowStockCount: number;
  lowStockItems: string[];
  todayConsumed: number;
  todayReceived: number;
  todaySteam: number;
}

const EMPTY_FORM: Partial<FuelItem> = {
  name: '', code: '', unit: 'MT', steamRate: null, calorificValue: null,
  minStock: 0, maxStock: null, defaultRate: 0, hsnCode: '', gstPercent: 5,
  location: '', remarks: '',
};

export default function FuelManagement() {
  const [tab, setTab] = useState<'master' | 'daily'>('master');
  const [fuels, setFuels] = useState<FuelItem[]>([]);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchMaster = useCallback(async () => {
    try {
      const res = await api.get<FuelItem[]>('/fuel/master');
      setFuels(res.data);
    } catch (err) { console.error(err); }
  }, []);

  const fetchConsumption = useCallback(async () => {
    try {
      const res = await api.get<{ date: string; rows: ConsumptionRow[] }>(`/fuel/consumption?date=${date}`);
      setRows(res.data.rows);
    } catch (err) { console.error(err); }
  }, [date]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get<Summary>(`/fuel/summary?date=${date}`);
      setSummary(res.data);
    } catch (err) { console.error(err); }
  }, [date]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchMaster(), fetchSummary(), fetchConsumption()]).finally(() => setLoading(false));
  }, [fetchMaster, fetchSummary, fetchConsumption]);

  const fmtNum = (n: number) => n === 0 ? '--' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  // Master CRUD
  const openAdd = () => { setEditId(null); setForm({ ...EMPTY_FORM }); setShowModal(true); };
  const openEdit = (f: FuelItem) => {
    setEditId(f.id);
    setForm({ name: f.name, code: f.code, unit: f.unit, steamRate: f.steamRate, calorificValue: f.calorificValue, minStock: f.minStock, maxStock: f.maxStock, defaultRate: f.defaultRate, hsnCode: f.hsnCode || '', gstPercent: f.gstPercent, location: f.location || '', remarks: f.remarks || '' });
    setShowModal(true);
  };
  const saveFuel = async () => {
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/fuel/master/${editId}`, form);
      } else {
        await api.post('/fuel/master', form);
      }
      setShowModal(false);
      fetchMaster();
      fetchSummary();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save';
      alert(msg);
    } finally { setSaving(false); }
  };
  const deleteFuel = async (id: string) => {
    if (!confirm('Deactivate this fuel type?')) return;
    await api.delete(`/fuel/master/${id}`);
    fetchMaster();
  };

  // Daily consumption
  const updateRow = (idx: number, field: string, value: string) => {
    const newRows = [...rows];
    const row = { ...newRows[idx], [field]: parseFloat(value) || 0 };
    row.closingStock = row.openingStock + row.received - row.consumed;
    row.steamGenerated = Math.round(row.consumed * row.steamRate * 100) / 100;
    newRows[idx] = row;
    setRows(newRows);
  };

  const saveConsumption = async () => {
    setSaving(true);
    try {
      await api.post('/fuel/consumption', { date, rows });
      fetchConsumption();
      fetchSummary();
    } catch (err) { alert('Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  const totalSteam = rows.reduce((s, r) => s + r.steamGenerated, 0);
  const totalConsumed = rows.reduce((s, r) => s + r.consumed, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Fuel Management</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Boiler Fuel Master & Daily Consumption</span>
          </div>
          {tab === 'master' && (
            <button onClick={openAdd} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              + Add Fuel
            </button>
          )}
          {tab === 'daily' && (
            <button onClick={saveConsumption} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Entries'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          <button onClick={() => setTab('master')} className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === 'master' ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Fuel Master
          </button>
          <button onClick={() => setTab('daily')} className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === 'daily' ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Daily Consumption
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fuel Types</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary?.fuelTypes || 0}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Low Stock</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary?.lowStockCount || 0}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Consumed Today</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtNum(summary?.todayConsumed || 0)} MT</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Steam Today</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtNum(summary?.todaySteam || 0)} MT</div>
          </div>
        </div>

        {/* ═══ TAB: FUEL MASTER ═══ */}
        {tab === 'master' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Fuel Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Unit</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Steam Rate</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Calorific</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Stock</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Min Stock</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Location</th>
                  <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {fuels.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No fuel types configured. Click + Add Fuel to start.</td></tr>
                ) : fuels.map((f, i) => (
                  <tr key={f.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">{f.code}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">{f.name}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">{f.unit}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{f.steamRate ? `${f.steamRate} ton/ton` : '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{f.calorificValue ? `${f.calorificValue}` : '--'}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100 ${f.currentStock < f.minStock ? 'text-red-600' : 'text-slate-800'}`}>{fmtNum(f.currentStock)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">{fmtNum(f.minStock)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtNum(f.defaultRate)}</td>
                    <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{f.location || '--'}</td>
                    <td className="px-3 py-1.5">
                      <button onClick={() => openEdit(f)} className="text-[10px] text-blue-600 font-semibold uppercase hover:underline mr-2">Edit</button>
                      <button onClick={() => deleteFuel(f.id)} className="text-[10px] text-red-500 font-semibold uppercase hover:underline">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══ TAB: DAILY CONSUMPTION ═══ */}
        {tab === 'daily' && (
          <>
            {/* Date picker */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
            </div>

            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Fuel</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Opening (MT)</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Received (MT)</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 bg-orange-900/30">Consumed (MT)</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Closing (MT)</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Steam Rate</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 bg-green-900/30">Steam (MT)</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No fuel types. Add fuels in the Fuel Master tab first.</td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={r.fuelItemId} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">{r.fuelName}</td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <input type="number" value={r.openingStock || ''} onChange={e => updateRow(i, 'openingStock', e.target.value)}
                          className="w-full text-right font-mono tabular-nums text-xs px-2 py-1 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <input type="number" value={r.received || ''} onChange={e => updateRow(i, 'received', e.target.value)}
                          className="w-full text-right font-mono tabular-nums text-xs px-2 py-1 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100 bg-orange-50/50">
                        <input type="number" value={r.consumed || ''} onChange={e => updateRow(i, 'consumed', e.target.value)}
                          className="w-full text-right font-mono tabular-nums text-xs px-2 py-1 border border-orange-300 bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-400 font-bold" />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100">
                        {fmtNum(r.closingStock)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">
                        {r.steamRate || '--'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-green-700 border-r border-slate-100 bg-green-50/50">
                        {fmtNum(r.steamGenerated)}
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="text" value={r.remarks} onChange={e => { const nr = [...rows]; nr[i] = { ...nr[i], remarks: e.target.value }; setRows(nr); }}
                          className="w-full text-xs px-2 py-1 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="..." />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td className="px-3 py-2 text-[10px] uppercase tracking-widest border-r border-slate-700">Total</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(rows.reduce((s, r) => s + r.openingStock, 0))}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(rows.reduce((s, r) => s + r.received, 0))}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(totalConsumed)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(rows.reduce((s, r) => s + r.closingStock, 0))}</td>
                      <td className="px-3 py-2 border-r border-slate-700"></td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700 text-green-300">{fmtNum(totalSteam)}</td>
                      <td className="px-3 py-2"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>

      {/* ═══ ADD/EDIT MODAL ═══ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-[520px] max-w-[95vw] shadow-2xl">
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <div className="text-xs font-bold uppercase tracking-widest">{editId ? 'Edit Fuel' : 'Add Fuel'}</div>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Fuel Name</label>
                  <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., Rice Husk" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Code</label>
                  <input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., FUEL-RH" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit</label>
                  <select value={form.unit || 'MT'} onChange={e => setForm({ ...form, unit: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="MT">MT (Metric Ton)</option>
                    <option value="KG">KG</option>
                    <option value="LTR">Litre</option>
                    <option value="KL">KL (Kilo Litre)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Steam Rate (ton/ton)</label>
                  <input type="number" step="0.1" value={form.steamRate ?? ''} onChange={e => setForm({ ...form, steamRate: e.target.value ? parseFloat(e.target.value) : null })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 3.0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Calorific (kcal/kg)</label>
                  <input type="number" value={form.calorificValue ?? ''} onChange={e => setForm({ ...form, calorificValue: e.target.value ? parseFloat(e.target.value) : null })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 3500" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Min Stock</label>
                  <input type="number" value={form.minStock ?? ''} onChange={e => setForm({ ...form, minStock: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Default Rate</label>
                  <input type="number" value={form.defaultRate ?? ''} onChange={e => setForm({ ...form, defaultRate: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST %</label>
                  <input type="number" value={form.gstPercent ?? 5} onChange={e => setForm({ ...form, gstPercent: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">HSN Code</label>
                  <input value={form.hsnCode || ''} onChange={e => setForm({ ...form, hsnCode: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 2701" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Storage Location</label>
                  <input value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., Boiler Yard" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                <input value={form.remarks || ''} onChange={e => setForm({ ...form, remarks: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={saveFuel} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
