import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface Warehouse {
  id: string;
  code: string;
  name: string;
}

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

interface OpenDeal {
  id: string;
  poNo: number;
  dealType: string;
  status: string;
  poDate: string;
  remarks: string | null;
  vendor: { id: string; name: string; phone: string | null };
  lines: Array<{ id: string; description: string; rate: number; unit: string; inventoryItemId: string | null; receivedQty: number; quantity: number }>;
  totalReceived: number;
  totalValue: number;
  totalPaid: number;
  outstanding: number;
  truckCount: number;
}

interface VendorOption {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  category?: string;
}

const EMPTY_FORM: Partial<FuelItem> = {
  name: '', code: '', unit: 'MT', steamRate: null, calorificValue: null,
  minStock: 0, maxStock: null, defaultRate: 0, hsnCode: '', gstPercent: 5,
  location: '', remarks: '',
};

export default function FuelManagement() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [tab, setTab] = useState<'master' | 'daily' | 'deals'>('deals');
  const [fuels, setFuels] = useState<FuelItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [deals, setDeals] = useState<OpenDeal[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDealModal, setShowDealModal] = useState(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [expandedDeals, setExpandedDeals] = useState<Set<string>>(new Set());
  const [dealForm, setDealForm] = useState({ vendorId: '', vendorName: '', vendorPhone: '', fuelItemId: '', rate: 0, remarks: '' });
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchMaster = useCallback(async () => {
    try {
      const [fuelRes, whRes] = await Promise.all([
        api.get<FuelItem[]>('/fuel/master'),
        api.get<Warehouse[]>('/fuel/warehouses'),
      ]);
      setFuels(fuelRes.data);
      setWarehouses(whRes.data);
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

  const fetchDeals = useCallback(async () => {
    try {
      const [dealsRes, vendorsRes] = await Promise.all([
        api.get<OpenDeal[]>('/fuel/deals'),
        api.get<{ vendors: VendorOption[] } | VendorOption[]>('/vendors', { params: { active: true } }),
      ]);
      setDeals(dealsRes.data);
      const vData = vendorsRes.data;
      const vList = Array.isArray(vData) ? vData : (vData as { vendors: VendorOption[] }).vendors || [];
      setVendors(vList);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchMaster(), fetchSummary(), fetchConsumption(), fetchDeals()]).finally(() => setLoading(false));
  }, [fetchMaster, fetchSummary, fetchConsumption, fetchDeals]);

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

  // Deal CRUD
  const createDeal = async () => {
    if (!dealForm.fuelItemId || !dealForm.rate) {
      alert('Select fuel type and enter rate'); return;
    }
    if (!dealForm.vendorId && !dealForm.vendorName) {
      alert('Select a vendor or add a new trader'); return;
    }
    if (dealForm.vendorId === '__new' && !dealForm.vendorName) {
      alert('Enter the new trader name'); return;
    }
    setSaving(true);
    const payload = {
      ...dealForm,
      vendorId: dealForm.vendorId === '__new' ? undefined : dealForm.vendorId,
    };
    try {
      // Update vendor phone if changed
      const origVendor = vendors.find(v => v.id === dealForm.vendorId);
      if (origVendor && dealForm.vendorPhone && dealForm.vendorPhone !== origVendor.phone) {
        if (confirm(`Phone number changed from ${origVendor.phone || 'empty'} to ${dealForm.vendorPhone}. Update vendor master?`)) {
          try { await api.put(`/vendors/${dealForm.vendorId}`, { phone: dealForm.vendorPhone }); } catch (_e) { /* ok */ }
        }
      }
      if (editingDealId) {
        await api.put(`/fuel/deals/${editingDealId}`, { rate: dealForm.rate, remarks: dealForm.remarks });
      } else {
        await api.post('/fuel/deals', payload);
      }
      setShowDealModal(false);
      setEditingDealId(null);
      setDealForm({ vendorId: '', vendorName: '', vendorPhone: '', fuelItemId: '', rate: 0, remarks: '' });
      fetchDeals();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed';
      alert(msg);
    } finally { setSaving(false); }
  };

  const closeDeal = async (id: string) => {
    if (!confirm('Close this deal? No more trucks will be accepted.')) return;
    await api.put(`/fuel/deals/${id}`, { status: 'CLOSED' });
    fetchDeals();
  };

  const deleteDeal = async (id: string) => {
    if (!confirm('Delete this deal permanently? This cannot be undone.')) return;
    try {
      await api.delete(`/fuel/deals/${id}`);
      fetchDeals();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete';
      alert(msg);
    }
  };

  const editDeal = (d: OpenDeal) => {
    const line = d.lines[0];
    setEditingDealId(d.id);
    setDealForm({
      vendorId: d.vendor.id,
      vendorName: d.vendor.name,
      vendorPhone: d.vendor.phone || '',
      fuelItemId: line?.inventoryItemId || '',
      rate: line?.rate || 0,
      remarks: d.remarks || '',
      quantityType: d.dealType === 'OPEN' ? 'OPEN' : 'FIXED',
      quantity: line?.quantity === 999999 ? 0 : (line?.quantity || 0),
      paymentTerms: '',
    } as typeof dealForm);
    setShowDealModal(true);
  };

  const updateRate = async (id: string) => {
    const newRate = prompt('Enter new rate (₹/MT):');
    if (!newRate) return;
    await api.put(`/fuel/deals/${id}`, { rate: parseFloat(newRate) });
    fetchDeals();
  };

  const fmtCurrency = (n: number) => n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const recordPayment = async (dealId: string, vendorName: string, outstanding: number) => {
    const amount = prompt(`Pay ${vendorName}\nOutstanding: ₹${outstanding.toLocaleString()}\n\nEnter payment amount:`);
    if (!amount) return;
    const mode = prompt('Payment mode:\n1. CASH\n2. UPI\n3. BANK_TRANSFER\n4. NEFT\n\nEnter mode (or press Enter for CASH):');
    const modeMap: Record<string, string> = { '1': 'CASH', '2': 'UPI', '3': 'BANK_TRANSFER', '4': 'NEFT' };
    const ref = (mode === '2' || mode === 'UPI' || mode === '3' || mode === 'BANK_TRANSFER' || mode === '4' || mode === 'NEFT')
      ? prompt('Enter reference (UTR / UPI ref):') : '';
    try {
      await api.post(`/fuel/deals/${dealId}/payment`, {
        dealId,
        amount: parseFloat(amount),
        mode: modeMap[mode || '1'] || mode || 'CASH',
        reference: ref || '',
      });
      fetchDeals();
    } catch (err) { alert('Payment failed'); }
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
          {tab === 'deals' && (
            <button onClick={() => { setEditingDealId(null); setDealForm({ vendorId: '', vendorName: '', vendorPhone: '', fuelItemId: '', rate: 0, remarks: '' }); setShowDealModal(true); }} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              + New Fuel Deal
            </button>
          )}
        </div>

        {/* Tabs — Deals first */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          <button onClick={() => setTab('deals')} className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === 'deals' ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Fuel Deals {deals.length > 0 && <span className="ml-1 bg-orange-500 text-white text-[9px] px-1.5 py-0.5">{deals.length}</span>}
          </button>
          <button onClick={() => setTab('daily')} className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === 'daily' ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Daily Consumption
          </button>
          <button onClick={() => setTab('master')} className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === 'master' ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Fuel Master
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
        {/* ═══ TAB: OPEN DEALS ═══ */}
        {tab === 'deals' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Deal #</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Fuel</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ordered</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Received</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Pending</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Total Value</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Outstanding</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Trucks</th>
                  <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deals.length === 0 ? (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No open deals. Click + New Deal to create one.</td></tr>
                ) : deals.map((d, i) => {
                  const line = d.lines[0];
                  const pipelineSteps = [
                    { label: 'Deal', done: true, value: `${fmtCurrency(line?.rate || 0)}/${line?.unit || 'MT'}`, sub: line?.description || '' },
                    { label: 'Receiving', done: d.truckCount > 0, value: `${fmtNum(d.totalReceived)} ${line?.unit || 'MT'}`, sub: `${d.truckCount} truck${d.truckCount !== 1 ? 's' : ''}` },
                    { label: 'Value', done: d.totalValue > 0, value: fmtCurrency(d.totalValue), sub: d.truckCount > 0 ? 'Total receivable' : 'No receipts yet' },
                    { label: 'Paid', done: d.totalPaid > 0, value: fmtCurrency(d.totalPaid), sub: d.outstanding > 0 ? `${fmtCurrency(d.outstanding)} due` : 'Cleared' },
                  ];
                  return (
                    <React.Fragment key={d.id}>
                    {/* Deal header row */}
                    <tr className={`border-b border-slate-100 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''}`} onClick={() => setExpandedDeals(prev => { const s = new Set(prev); s.has(d.id) ? s.delete(d.id) : s.add(d.id); return s; })}>
                      <td className="px-3 py-2 font-mono text-slate-500 border-r border-slate-100">
                        <span className="text-[9px] mr-1">{expandedDeals.has(d.id) ? '\u25BC' : '\u25B6'}</span>PO-{d.poNo}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-800 border-r border-slate-100">
                        <div>{d.vendor.name}</div>
                        {d.vendor.phone && <div className="text-[9px] text-slate-400">{d.vendor.phone}</div>}
                      </td>
                      <td className="px-3 py-2 border-r border-slate-100">{line?.description || '--'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-100">
                        {fmtCurrency(line?.rate || 0)}/{line?.unit || 'MT'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-100">
                        {line?.quantity && line.quantity < 900000 ? `${fmtNum(line.quantity)} ${line?.unit || 'MT'}` : <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700">Open</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-bold border-r border-slate-100">
                        {fmtNum(d.totalReceived)} {line?.unit || 'MT'}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono tabular-nums font-bold border-r border-slate-100 ${line?.quantity && line.quantity < 900000 && (line.quantity - d.totalReceived) > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                        {line?.quantity && line.quantity < 900000 ? `${fmtNum(line.quantity - d.totalReceived)} ${line?.unit || 'MT'}` : '--'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(d.totalValue)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">{fmtCurrency(d.totalPaid)}</td>
                      <td className={`px-3 py-2 text-right font-mono tabular-nums font-bold border-r border-slate-100 ${d.outstanding > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                        {fmtCurrency(d.outstanding)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-100">{d.truckCount}</td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        {d.truckCount === 0 && <button onClick={() => editDeal(d)} className="text-[10px] text-blue-600 font-semibold uppercase hover:underline mr-2">Edit</button>}
                        <button onClick={() => closeDeal(d.id)} className="text-[10px] text-orange-500 font-semibold uppercase hover:underline mr-2">Close</button>
                        {isAdmin && d.truckCount === 0 && <button onClick={() => deleteDeal(d.id)} className="text-[10px] text-red-600 font-semibold uppercase hover:underline">Del</button>}
                      </td>
                    </tr>
                    {/* Pipeline row — collapsed by default */}
                    {expandedDeals.has(d.id) && (
                    <tr className="border-b border-slate-200">
                      <td colSpan={10} className="px-3 py-2 bg-slate-50/30">
                        <div className="flex items-center gap-0">
                          {pipelineSteps.map((step, si) => (
                            <React.Fragment key={step.label}>
                              {si > 0 && <div className={`h-0.5 w-6 ${step.done ? 'bg-green-400' : 'bg-slate-200'}`} />}
                              <div className={`flex-1 border ${step.done ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white'} px-3 py-1.5 text-center`}>
                                <div className={`text-[9px] font-bold uppercase tracking-widest ${step.done ? 'text-green-700' : 'text-slate-400'}`}>{step.label}</div>
                                <div className="text-xs font-bold text-slate-800 font-mono tabular-nums mt-0.5">{step.value}</div>
                                <div className={`text-[9px] mt-0.5 ${step.label === 'Paid' && d.outstanding > 0 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>{step.sub}</div>
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </td>
                    </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              {deals.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td colSpan={4} className="px-3 py-2 text-[10px] uppercase tracking-widest border-r border-slate-700">Total</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">--</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(deals.reduce((s, d) => s + d.totalReceived, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">--</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(deals.reduce((s, d) => s + d.totalValue, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(deals.reduce((s, d) => s + d.totalPaid, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700 text-red-300">{fmtCurrency(deals.reduce((s, d) => s + d.outstanding, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{deals.reduce((s, d) => s + d.truckCount, 0)}</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
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
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Storage Location</label>
                  <select value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">-- Select Warehouse --</option>
                    {warehouses.map(w => <option key={w.id} value={w.code}>{w.name} ({w.code})</option>)}
                  </select>
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
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <input value={form.remarks || ''} onChange={e => setForm({ ...form, remarks: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
              </div>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={saveFuel} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ NEW DEAL MODAL ═══ */}
      {showDealModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-[600px] max-w-[95vw] shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <div className="text-xs font-bold uppercase tracking-widest">{editingDealId ? 'Edit Fuel Deal' : 'New Fuel Deal'}</div>
            </div>
            <div className="p-4 space-y-3">
              {/* Section: Vendor */}
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-1">Vendor Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor / Trader</label>
                  <select value={dealForm.vendorId} onChange={e => {
                    const v = vendors.find(v => v.id === e.target.value);
                    setDealForm({ ...dealForm, vendorId: e.target.value, vendorName: v?.name || '', vendorPhone: v?.phone || dealForm.vendorPhone });
                  }} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">-- Select Vendor --</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    <option value="__new">+ Add New Trader</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
                  <input value={dealForm.vendorPhone} onChange={e => {
                    setDealForm({ ...dealForm, vendorPhone: e.target.value });
                    // If phone changed from original vendor phone, mark for update
                    const origVendor = vendors.find(v => v.id === dealForm.vendorId);
                    if (origVendor && origVendor.phone && e.target.value !== origVendor.phone) {
                      setDealForm(prev => ({ ...prev, vendorPhone: e.target.value, _phoneChanged: true } as typeof prev));
                    }
                  }}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Auto-filled from vendor" />
                </div>
              </div>
              {dealForm.vendorId === '__new' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">New Trader Name</label>
                    <input value={dealForm.vendorName} onChange={e => setDealForm({ ...dealForm, vendorName: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., Ram Singh" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Address / Village</label>
                    <input value={(dealForm as Record<string, string>).vendorAddress || ''} onChange={e => setDealForm({ ...dealForm, vendorAddress: e.target.value } as typeof dealForm)}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., Narsinghpur" />
                  </div>
                </div>
              )}

              {/* Section: Fuel & Pricing */}
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-1 mt-2">Fuel & Pricing</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Fuel Type</label>
                  <select value={dealForm.fuelItemId} onChange={e => setDealForm({ ...dealForm, fuelItemId: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">-- Select Fuel --</option>
                    {fuels.map(f => <option key={f.id} value={f.id}>{f.name} ({f.unit})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Deal Type</label>
                  <select value={(dealForm as Record<string, string>).quantityType || 'OPEN'} onChange={e => setDealForm({ ...dealForm, quantityType: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="OPEN">Open (No fixed qty)</option>
                    <option value="FIXED">Fixed Quantity</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate (₹/MT)</label>
                  <input type="number" value={dealForm.rate || ''} onChange={e => setDealForm({ ...dealForm, rate: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 6000" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity</label>
                  <div className="flex">
                    <input type="number" max={99999} value={(dealForm as Record<string, number>).quantity || ''} onChange={e => setDealForm({ ...dealForm, quantity: parseFloat(e.target.value) || 0 } as typeof dealForm)}
                      className="w-full border border-slate-300 border-r-0 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 10000" />
                    <select value={(dealForm as Record<string, string>).quantityUnit || 'MT'} onChange={e => setDealForm({ ...dealForm, quantityUnit: e.target.value } as typeof dealForm)}
                      className="border border-slate-300 px-1.5 py-1.5 text-[10px] bg-slate-50 text-slate-600 focus:outline-none" style={{ minWidth: '62px' }}>
                      <option value="MT">MT</option>
                      <option value="TRUCKS">Trucks</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Terms</label>
                  <select value={(dealForm as Record<string, string>).paymentTerms || 'NET15'} onChange={e => setDealForm({ ...dealForm, paymentTerms: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="ADVANCE">Advance</option>
                    <option value="COD">Cash on Delivery</option>
                    <option value="NET2">Net 2 Days</option>
                    <option value="NET7">Net 7 Days</option>
                    <option value="NET10">Net 10 Days</option>
                    <option value="NET15">Net 15 Days</option>
                    <option value="NET30">Net 30 Days</option>
                  </select>
                </div>
              </div>

              {/* Section: Delivery */}
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-1 mt-2">Delivery Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Origin / Source</label>
                  <input value={(dealForm as Record<string, string>).origin || ''} onChange={e => { const v = e.target.value; setDealForm({ ...dealForm, origin: v.charAt(0).toUpperCase() + v.slice(1) } as typeof dealForm); }}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., Katni, Jabalpur" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Delivery Point</label>
                  <select value={(dealForm as Record<string, string>).deliveryPoint || 'Boiler Warehouse'} onChange={e => setDealForm({ ...dealForm, deliveryPoint: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="Boiler Warehouse">Boiler Warehouse</option>
                    <option value="Factory Gate 1">Factory Gate 1</option>
                    <option value="Fuel Yard">Fuel Yard</option>
                    <option value="Coal Yard">Coal Yard</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Transport By</label>
                  <select value={(dealForm as Record<string, string>).transportBy || 'SUPPLIER'} onChange={e => setDealForm({ ...dealForm, transportBy: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="SUPPLIER">Supplier</option>
                    <option value="SELF">Our Transport</option>
                    <option value="THIRD_PARTY">Third Party</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Valid Until</label>
                  <input type="date" value={(dealForm as Record<string, string>).validUntil || ''} onChange={e => setDealForm({ ...dealForm, validUntil: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Expected Delivery (Days)</label>
                  <input type="number" min="1" value={(dealForm as Record<string, string>).deliverySchedule || ''} onChange={e => setDealForm({ ...dealForm, deliverySchedule: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 7" />
                </div>
              </div>

              {/* Section: Documents */}
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-1 mt-2">Documents</div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">PI / Invoice / WhatsApp Screenshot</label>
                <input type="file" accept="image/*,.pdf" onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) setDealForm({ ...dealForm, remarks: `PI: ${file.name} | ${dealForm.remarks || ''}` });
                }}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                <input value={dealForm.remarks} onChange={e => { const v = e.target.value; setDealForm({ ...dealForm, remarks: v.charAt(0).toUpperCase() + v.slice(1) }); }}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Any additional notes" />
              </div>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 flex justify-end gap-2">
              <button onClick={() => setShowDealModal(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={createDeal} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : (editingDealId ? 'Update Deal' : 'Create Deal')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
