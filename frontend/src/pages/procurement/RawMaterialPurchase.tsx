import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import WeighbridgeTrucksModal from '../../components/WeighbridgeTrucksModal';
import VendorLedgerModal from '../../components/VendorLedgerModal';

interface MaterialItem {
  id: string;
  name: string;
  code: string;
  category: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number | null;
  avgCost: number;
  defaultRate: number;
  hsnCode: string | null;
  gstPercent: number;
  location: string | null;
  remarks: string | null;
  isActive: boolean;
}

interface ConsumptionRow {
  materialItemId: string;
  materialName: string;
  materialCode: string;
  unit: string;
  id: string | null;
  openingStock: number;
  received: number;
  consumed: number;
  closingStock: number;
  remarks: string;
}

interface Summary {
  activeDeals: number;
  totalOutstanding: number;
  thisMonthReceived: number;
  thisMonthPaid: number;
  todayConsumed: number;
  todayReceived: number;
  lowStockCount: number;
  lowStockItems: string[];
}

interface OpenDeal {
  id: string;
  poNo: number;
  dealType: string;
  status: string;
  poDate: string;
  deliveryDate: string | null;
  remarks: string | null;
  paymentTerms: string | null;
  truckCap: number | null;
  transportBy: string | null;
  deliveryAddress: string | null;
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

const EMPTY_FORM: Partial<MaterialItem> = {
  name: '', code: '', category: 'RAW_MATERIAL', unit: 'MT',
  minStock: 0, maxStock: null, defaultRate: 0, hsnCode: '', gstPercent: 5,
  location: '', remarks: '',
};

export default function RawMaterialPurchase() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const [tab, setTab] = useState<'master' | 'daily' | 'deals'>('deals');
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [deals, setDeals] = useState<OpenDeal[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDealModal, setShowDealModal] = useState(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [expandedDeals, setExpandedDeals] = useState<Set<string>>(new Set());
  const [trucksModal, setTrucksModal] = useState<{ poId: string; title: string; subtitle?: string } | null>(null);
  const [ledgerModal, setLedgerModal] = useState<{ vendorId: string; vendorName: string } | null>(null);
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());
  const [dealForm, setDealForm] = useState({ vendorId: '', vendorName: '', vendorPhone: '', materialItemId: '', rate: 0, remarks: '', quantityType: 'OPEN' });
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payDeal, setPayDeal] = useState<OpenDeal | null>(null);
  const [payForm, setPayForm] = useState({ amount: 0, mode: 'CASH', reference: '', date: new Date().toISOString().split('T')[0], tdsAmount: 0, tdsSection: '', remarks: '' });

  const fetchMaster = useCallback(async () => {
    try {
      const res = await api.get<MaterialItem[]>('/raw-material-purchase/materials');
      setMaterials(res.data);
    } catch (err) { console.error(err); }
  }, []);

  const fetchConsumption = useCallback(async () => {
    try {
      const res = await api.get<{ date: string; rows: ConsumptionRow[] }>(`/raw-material-purchase/consumption?date=${date}`);
      setRows(res.data.rows);
    } catch (err) { console.error(err); }
  }, [date]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get<Summary>(`/raw-material-purchase/summary?date=${date}`);
      setSummary(res.data);
    } catch (err) { console.error(err); }
  }, [date]);

  const fetchDeals = useCallback(async () => {
    try {
      const res = await api.get<OpenDeal[]>('/raw-material-purchase/deals');
      setDeals(res.data);
    } catch (err) { console.error(err); }
  }, []);

  const fetchVendors = useCallback(async () => {
    try {
      const res = await api.get<{ vendors: VendorOption[] } | VendorOption[]>('/vendors');
      const vData = res.data;
      const vList = Array.isArray(vData) ? vData : (vData as { vendors: VendorOption[] }).vendors || [];
      setVendors(vList);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchMaster(), fetchSummary(), fetchConsumption(), fetchDeals(), fetchVendors()]).finally(() => setLoading(false));
  }, [fetchMaster, fetchSummary, fetchConsumption, fetchDeals, fetchVendors]);

  // Group deals by material name
  interface MaterialDealLine {
    deal: OpenDeal;
    line: OpenDeal['lines'][0];
    lineValue: number;
    lineReceived: number;
  }
  interface MaterialGroup {
    materialName: string;
    materialItemId: string | null;
    unit: string;
    entries: MaterialDealLine[];
    totalReceived: number;
    totalValue: number;
    totalPaid: number;
    outstanding: number;
    dealCount: number;
    truckCount: number;
  }
  const materialGroups = useMemo(() => {
    const map = new Map<string, MaterialGroup>();
    for (const deal of deals) {
      const matLines = deal.lines.filter(l => l.inventoryItemId);
      for (const line of matLines) {
        const key = line.inventoryItemId || line.description || 'Unknown';
        if (!map.has(key)) {
          map.set(key, {
            materialName: line.description || 'Unknown',
            materialItemId: line.inventoryItemId,
            unit: line.unit || 'MT',
            entries: [],
            totalReceived: 0,
            totalValue: 0,
            totalPaid: 0,
            outstanding: 0,
            dealCount: 0,
            truckCount: 0,
          });
        }
        const grp = map.get(key)!;
        const lineReceived = line.receivedQty || 0;
        const lineValue = lineReceived * (line.rate || 0);
        grp.entries.push({ deal, line, lineValue, lineReceived });
        grp.totalReceived += lineReceived;
        grp.totalValue += lineValue;
      }
      // Handle deals with no inventoryItemId lines (legacy)
      if (matLines.length === 0 && deal.lines.length > 0) {
        const line = deal.lines[0];
        const key = line.description || 'Other';
        if (!map.has(key)) {
          map.set(key, { materialName: key, materialItemId: null, unit: line.unit || 'MT', entries: [], totalReceived: 0, totalValue: 0, totalPaid: 0, outstanding: 0, dealCount: 0, truckCount: 0 });
        }
        const grp = map.get(key)!;
        grp.entries.push({ deal, line, lineValue: deal.totalValue, lineReceived: deal.totalReceived });
        grp.totalReceived += deal.totalReceived;
        grp.totalValue += deal.totalValue;
      }
    }
    // Collapse multiple lines of the same deal into a single entry — one PO = one row
    for (const grp of map.values()) {
      const byDeal = new Map<string, MaterialDealLine>();
      for (const e of grp.entries) {
        const existing = byDeal.get(e.deal.id);
        if (!existing) {
          byDeal.set(e.deal.id, { ...e });
        } else {
          existing.lineReceived += e.lineReceived;
          existing.lineValue += e.lineValue;
          const mergedQty = (existing.line.quantity || 0) + (e.line.quantity || 0);
          const mergedRate = existing.lineValue / (existing.lineReceived || 1);
          existing.line = { ...existing.line, quantity: mergedQty, rate: mergedRate, receivedQty: existing.lineReceived };
        }
      }
      grp.entries = Array.from(byDeal.values());
      grp.dealCount = byDeal.size;
      grp.truckCount = grp.entries.reduce((s, e) => s + e.deal.truckCount, 0);
      for (const entry of grp.entries) {
        const d = entry.deal;
        const dealTotal = d.totalValue ?? 0;
        const share = dealTotal > 0 ? entry.lineValue / dealTotal : 1;
        grp.totalPaid += d.totalPaid * share;
      }
      grp.totalPaid = Math.round(grp.totalPaid * 100) / 100;
      grp.outstanding = Math.round((grp.totalValue - grp.totalPaid) * 100) / 100;
    }
    return Array.from(map.values()).sort((a, b) => b.totalValue - a.totalValue);
  }, [deals]);

  const fmtNum = (n: number) => n === 0 ? '--' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  // Master CRUD
  const openAdd = () => { setEditId(null); setForm({ ...EMPTY_FORM }); setShowModal(true); };
  const openEdit = (m: MaterialItem) => {
    setEditId(m.id);
    setForm({ name: m.name, code: m.code, category: m.category, unit: m.unit, minStock: m.minStock, maxStock: m.maxStock, defaultRate: m.defaultRate, hsnCode: m.hsnCode || '', gstPercent: m.gstPercent, location: m.location || '', remarks: m.remarks || '' });
    setShowModal(true);
  };
  const saveMaterial = async () => {
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/raw-material-purchase/materials/${editId}`, form);
      } else {
        await api.post('/raw-material-purchase/materials', form);
      }
      setShowModal(false);
      fetchMaster();
      fetchSummary();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save';
      alert(msg);
    } finally { setSaving(false); }
  };
  const deleteMaterial = async (id: string) => {
    if (!confirm('Deactivate this material?')) return;
    await api.delete(`/raw-material-purchase/materials/${id}`);
    fetchMaster();
  };

  // Daily consumption
  const updateRow = (idx: number, field: string, value: string) => {
    const newRows = [...rows];
    const row = { ...newRows[idx], [field]: parseFloat(value) || 0 };
    row.closingStock = row.openingStock + row.received - row.consumed;
    newRows[idx] = row;
    setRows(newRows);
  };

  const saveConsumption = async () => {
    setSaving(true);
    try {
      await api.post('/raw-material-purchase/consumption', { date, rows });
      fetchConsumption();
      fetchSummary();
    } catch (err) { alert('Failed to save'); }
    finally { setSaving(false); }
  };

  // Deal CRUD
  const createDeal = async () => {
    if (!dealForm.materialItemId) {
      alert('Select a material'); return;
    }
    if (!dealForm.vendorId && !dealForm.vendorName) {
      alert('Select a vendor or add a new one'); return;
    }
    if (dealForm.vendorId === '__new' && !dealForm.vendorName) {
      alert('Enter the new vendor name'); return;
    }
    setSaving(true);
    const payload = {
      ...dealForm,
      vendorId: dealForm.vendorId === '__new' ? undefined : dealForm.vendorId,
    };
    try {
      const origVendor = vendors.find(v => v.id === dealForm.vendorId);
      if (origVendor && dealForm.vendorPhone && dealForm.vendorPhone !== origVendor.phone) {
        if (confirm(`Phone number changed from ${origVendor.phone || 'empty'} to ${dealForm.vendorPhone}. Update vendor master?`)) {
          try { await api.put(`/vendors/${dealForm.vendorId}`, { phone: dealForm.vendorPhone }); } catch (_e) { /* ok */ }
        }
      }
      if (editingDealId) {
        const rParts = [(dealForm as Record<string, string>).remarks || ''];
        if ((dealForm as Record<string, string>).origin) rParts.push(`Origin: ${(dealForm as Record<string, string>).origin}`);
        if ((dealForm as Record<string, string>).deliveryPoint) rParts.push(`Delivery: ${(dealForm as Record<string, string>).deliveryPoint}`);
        if ((dealForm as Record<string, string>).transportBy) rParts.push(`Transport: ${(dealForm as Record<string, string>).transportBy}`);
        if ((dealForm as Record<string, string>).deliverySchedule) rParts.push(`Schedule: ${(dealForm as Record<string, string>).deliverySchedule}`);
        const isTrucks = (dealForm as Record<string, string>).quantityUnit === 'TRUCKS';
        if (isTrucks && (dealForm as Record<string, number>).quantity) rParts.push(`FIXED_TRUCKS:${(dealForm as Record<string, number>).quantity}`);
        await api.put(`/raw-material-purchase/deals/${editingDealId}`, {
          rate: dealForm.rate,
          remarks: rParts.filter(Boolean).join(' | '),
          vendorId: dealForm.vendorId === '__new' ? undefined : dealForm.vendorId,
          materialItemId: dealForm.materialItemId,
          paymentTerms: (dealForm as Record<string, string>).paymentTerms,
          validUntil: (dealForm as Record<string, string>).validUntil || undefined,
          deliveryPoint: (dealForm as Record<string, string>).deliveryPoint,
          transportBy: (dealForm as Record<string, string>).transportBy,
          truckCap: isTrucks && (dealForm as Record<string, number>).quantity ? Math.round((dealForm as Record<string, number>).quantity) : null,
        });
      } else {
        await api.post('/raw-material-purchase/deals', payload);
      }
      setShowDealModal(false);
      setEditingDealId(null);
      setDealForm({ vendorId: '', vendorName: '', vendorPhone: '', materialItemId: '', rate: 0, remarks: '', quantityType: 'OPEN' });
      fetchDeals();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed';
      alert(msg);
    } finally { setSaving(false); }
  };

  const closeDeal = async (id: string) => {
    if (!confirm('Close this deal? No more receipts will be accepted.')) return;
    await api.put(`/raw-material-purchase/deals/${id}`, { status: 'CLOSED' });
    fetchDeals();
  };

  const deleteDeal = async (id: string) => {
    if (!confirm('Delete this deal permanently? This cannot be undone.')) return;
    try {
      await api.delete(`/raw-material-purchase/deals/${id}`);
      fetchDeals();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete';
      alert(msg);
    }
  };

  const editDeal = (d: OpenDeal) => {
    const line = d.lines[0];
    const remarksStr = d.remarks || '';
    const parts = remarksStr.split(' | ');
    let origin = '', deliverySchedule = '', cleanRemarks = '';
    const metaKeys = ['Origin:', 'Delivery:', 'Transport:', 'Schedule:', 'FIXED_TRUCKS:'];
    cleanRemarks = parts.filter(p => !metaKeys.some(k => p.startsWith(k))).join(' | ').trim();
    for (const p of parts) {
      if (p.startsWith('Origin: ')) origin = p.replace('Origin: ', '');
      if (p.startsWith('Schedule: ')) deliverySchedule = p.replace('Schedule: ', '').replace(' Days', '');
    }
    setEditingDealId(d.id);
    setDealForm({
      vendorId: d.vendor.id,
      vendorName: d.vendor.name,
      vendorPhone: d.vendor.phone || '',
      materialItemId: line?.inventoryItemId || '',
      rate: line?.rate || 0,
      remarks: cleanRemarks,
      quantityType: d.dealType === 'JOB_WORK' ? 'JOB_WORK' : (d.dealType === 'OPEN' ? 'OPEN' : 'FIXED'),
      quantity: line?.quantity === 999999 ? 0 : (line?.quantity || 0),
      quantityUnit: d.truckCap ? 'TRUCKS' : 'MT',
      paymentTerms: d.paymentTerms || 'NET15',
      origin,
      deliveryPoint: d.deliveryAddress || 'Factory Gate',
      transportBy: d.transportBy || 'SUPPLIER',
      validUntil: d.deliveryDate ? d.deliveryDate.slice(0, 10) : '',
      deliverySchedule,
    } as typeof dealForm);
    setShowDealModal(true);
  };

  const fmtCurrency = (n: number) => n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const openPayModal = (d: OpenDeal) => {
    setPayDeal(d);
    setPayForm({ amount: d.outstanding, mode: 'CASH', reference: '', date: new Date().toISOString().split('T')[0], tdsAmount: 0, tdsSection: '', remarks: `Raw material deal PO-${d.poNo}` });
    setShowPayModal(true);
  };

  const submitPayment = async () => {
    if (!payDeal || !payForm.amount) return;
    setSaving(true);
    try {
      await api.post(`/raw-material-purchase/deals/${payDeal.id}/payment`, {
        dealId: payDeal.id,
        amount: payForm.amount,
        mode: payForm.mode,
        reference: payForm.reference,
        date: payForm.date,
        tdsAmount: payForm.tdsAmount || undefined,
        tdsSection: payForm.tdsSection || undefined,
        remarks: payForm.remarks,
      });
      setShowPayModal(false);
      setPayDeal(null);
      fetchDeals();
    } catch (err) { alert('Payment failed'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  const totalConsumed = rows.reduce((s, r) => s + r.consumed, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Raw Material Purchase</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Material Deals, Consumption & Master</span>
          </div>
          {tab === 'master' && (
            <button onClick={openAdd} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              + Add Material
            </button>
          )}
          {tab === 'daily' && (
            <button onClick={saveConsumption} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Entries'}
            </button>
          )}
          {tab === 'deals' && isAdmin && (
            <button onClick={() => { setEditingDealId(null); setDealForm({ vendorId: '', vendorName: '', vendorPhone: '', materialItemId: '', rate: 0, remarks: '', quantityType: 'OPEN' }); setShowDealModal(true); }} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              + New Deal
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          <button onClick={() => setTab('deals')} className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === 'deals' ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Deals {deals.length > 0 && <span className="ml-1 bg-orange-500 text-white text-[9px] px-1.5 py-0.5">{deals.length}</span>}
          </button>
          <button onClick={() => setTab('daily')} className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === 'daily' ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Daily Consumption
          </button>
          <button onClick={() => setTab('master')} className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === 'master' ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Materials
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Deals</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary?.activeDeals || 0}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Outstanding</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(summary?.totalOutstanding || 0)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Consumed Today</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtNum(summary?.todayConsumed || 0)} MT</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Received Today</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtNum(summary?.todayReceived || 0)} MT</div>
          </div>
        </div>

        {/* TAB: MATERIALS MASTER */}
        {tab === 'master' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Category</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Unit</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Stock</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Avg Cost</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">HSN</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GST%</th>
                  <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {materials.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No materials configured. Click + Add Material to start.</td></tr>
                ) : materials.map((m, i) => (
                  <tr key={m.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">{m.code}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">{m.name}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{m.category.replace('_', ' ')}</span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100">{m.unit}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100 ${m.currentStock < m.minStock ? 'text-red-600' : 'text-slate-800'}`}>{fmtNum(m.currentStock)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(m.avgCost)}</td>
                    <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{m.hsnCode || '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{m.gstPercent}%</td>
                    <td className="px-3 py-1.5">
                      <button onClick={() => openEdit(m)} className="text-[10px] text-blue-600 font-semibold uppercase hover:underline mr-2">Edit</button>
                      <button onClick={() => deleteMaterial(m.id)} className="text-[10px] text-red-500 font-semibold uppercase hover:underline">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB: DAILY CONSUMPTION */}
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
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Opening</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Received</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 bg-orange-900/30">Consumed</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Closing</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No materials. Add materials in the Materials tab first.</td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={r.materialItemId} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">{r.materialName}</td>
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
                      <td className="px-3 py-2"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}

        {/* TAB: DEALS */}
        {tab === 'deals' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            {materialGroups.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No open deals. Click + New Deal to create one.</div>
            ) : (
              <>
                {materialGroups.map((grp) => {
                  const isExpanded = expandedMaterials.has(grp.materialName);
                  return (
                    <div key={grp.materialName}>
                      {/* Material group header row */}
                      <div
                        className="bg-slate-200 border-b border-slate-300 px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-250"
                        onClick={() => setExpandedMaterials(prev => { const s = new Set(prev); s.has(grp.materialName) ? s.delete(grp.materialName) : s.add(grp.materialName); return s; })}
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-[9px] text-slate-500">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                          <span className="text-xs font-bold uppercase tracking-widest text-slate-800">{grp.materialName}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 border border-slate-400 bg-white text-slate-600">{grp.dealCount} DEAL{grp.dealCount !== 1 ? 'S' : ''}</span>
                        </div>
                        <div className="flex items-center gap-6 text-xs">
                          <div>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mr-1">Received:</span>
                            <span className="font-mono tabular-nums font-bold text-slate-800">{fmtNum(grp.totalReceived)} {grp.unit}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mr-1">Value:</span>
                            <span className="font-mono tabular-nums font-bold text-slate-800">{fmtCurrency(grp.totalValue)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mr-1">Paid:</span>
                            <span className="font-mono tabular-nums text-green-700">{fmtCurrency(grp.totalPaid)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mr-1">Due:</span>
                            <span className={`font-mono tabular-nums font-bold ${grp.outstanding > 0 ? 'text-red-600' : 'text-slate-500'}`}>{fmtCurrency(grp.outstanding)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Expanded: deals table for this material */}
                      {isExpanded && (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-800 text-white">
                              <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO #</th>
                              <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                              <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                              <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                              <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Received</th>
                              <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Value</th>
                              <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid</th>
                              <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Outstanding</th>
                              <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                              <th className="px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grp.entries.map((entry, ei) => {
                              const { deal: d, line, lineValue, lineReceived } = entry;
                              const dealTotal = d.totalValue ?? 0;
                              const share = dealTotal > 0
                                ? lineValue / dealTotal
                                : (d.lines.length > 0 ? 1 / d.lines.length : 0);
                              const linePaid = Math.round(d.totalPaid * share * 100) / 100;
                              const lineOutstanding = Math.round((lineValue - linePaid) * 100) / 100;
                              const dealKey = `${d.id}-${line.id}`;
                              const pipelineSteps = [
                                { label: 'Deal', done: true, value: `${fmtCurrency(line.rate)}/${line.unit || 'MT'}`, sub: d.vendor.name },
                                { label: 'Receiving', done: d.truckCount > 0, value: `${fmtNum(lineReceived)} ${line.unit || 'MT'}`, sub: `${d.truckCount} receipt${d.truckCount !== 1 ? 's' : ''}` },
                                { label: 'Value', done: lineValue > 0, value: fmtCurrency(lineValue), sub: d.truckCount > 0 ? 'Total receivable' : 'No receipts yet' },
                                { label: 'Paid', done: linePaid > 0, value: fmtCurrency(linePaid), sub: lineOutstanding > 0 ? `${fmtCurrency(lineOutstanding)} due` : 'Cleared' },
                              ];
                              return (
                                <React.Fragment key={dealKey}>
                                  <tr
                                    className={`border-b border-slate-100 cursor-pointer hover:bg-blue-50/60 ${ei % 2 ? 'bg-slate-50/70' : ''}`}
                                    onClick={() => setExpandedDeals(prev => { const s = new Set(prev); s.has(dealKey) ? s.delete(dealKey) : s.add(dealKey); return s; })}
                                  >
                                    <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">
                                      <span className="text-[9px] mr-1">{expandedDeals.has(dealKey) ? '\u25BC' : '\u25B6'}</span>PO-{d.poNo}
                                    </td>
                                    <td className="px-3 py-1.5 border-r border-slate-100">
                                      <div className="font-semibold text-slate-800">{d.vendor.name}</div>
                                      {d.vendor.phone && <div className="text-[9px] text-slate-400">{d.vendor.phone}</div>}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">
                                      {d.dealType === 'JOB_WORK' ? <span className="text-[9px] font-bold text-purple-600 uppercase">Job Work</span> : `${fmtCurrency(line.rate)}/${line.unit || 'MT'}`}
                                    </td>
                                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                        d.dealType === 'OPEN' ? 'border-blue-300 bg-blue-50 text-blue-700' :
                                        d.dealType === 'JOB_WORK' ? 'border-purple-300 bg-purple-50 text-purple-700' :
                                        'border-slate-300 bg-slate-50 text-slate-600'}`}>
                                        {d.dealType === 'JOB_WORK' ? 'JOB WORK' : d.dealType}
                                      </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100">
                                      {fmtNum(lineReceived)} {line.unit || 'MT'}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(lineValue)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">{fmtCurrency(linePaid)}</td>
                                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100 ${lineOutstanding > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                                      {fmtCurrency(lineOutstanding)}
                                    </td>
                                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                        d.status === 'CLOSED' ? 'border-slate-300 bg-slate-100 text-slate-500' :
                                        d.status === 'RECEIVED' ? 'border-green-300 bg-green-50 text-green-700' :
                                        d.status === 'PARTIAL_RECEIVED' ? 'border-orange-300 bg-orange-50 text-orange-700' :
                                        'border-blue-300 bg-blue-50 text-blue-700'
                                      }`}>{d.status.replace('_', ' ')}</span>
                                    </td>
                                    <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                                      <div className="flex gap-1 flex-wrap">
                                        {isAdmin && <button onClick={() => editDeal(d)} className="text-[10px] text-blue-600 font-semibold uppercase hover:underline">Edit</button>}
                                        {d.status !== 'CLOSED' && <button onClick={() => openPayModal(d)} className="text-[10px] text-green-600 font-semibold uppercase hover:underline">Pay</button>}
                                        {d.truckCount > 0 && <button onClick={() => setTrucksModal({ poId: d.id, title: `PO-${d.poNo}`, subtitle: `${d.vendor?.name || ''} · ${grp.materialName}` })} className="text-[10px] text-purple-600 font-semibold uppercase hover:underline">Trucks</button>}
                                        <button onClick={() => setLedgerModal({ vendorId: d.vendor.id, vendorName: d.vendor.name })} className="text-[10px] text-indigo-600 font-semibold uppercase hover:underline">Ledger</button>
                                        {isAdmin && d.status !== 'CLOSED' && <button onClick={() => closeDeal(d.id)} className="text-[10px] text-orange-500 font-semibold uppercase hover:underline">Close</button>}
                                        {isAdmin && d.truckCount === 0 && <button onClick={() => deleteDeal(d.id)} className="text-[10px] text-red-600 font-semibold uppercase hover:underline">Del</button>}
                                      </div>
                                    </td>
                                  </tr>
                                  {/* Pipeline detail row */}
                                  {expandedDeals.has(dealKey) && (
                                    <tr className="border-b border-slate-200">
                                      <td colSpan={10} className="px-3 py-2 bg-slate-50/30">
                                        <div className="flex items-center gap-0">
                                          {pipelineSteps.map((step, si) => (
                                            <React.Fragment key={step.label}>
                                              {si > 0 && <div className={`h-0.5 w-6 ${step.done ? 'bg-green-400' : 'bg-slate-200'}`} />}
                                              <div className={`flex-1 border ${step.done ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white'} px-3 py-1.5 text-center`}>
                                                <div className={`text-[9px] font-bold uppercase tracking-widest ${step.done ? 'text-green-700' : 'text-slate-400'}`}>{step.label}</div>
                                                <div className="text-xs font-bold text-slate-800 font-mono tabular-nums mt-0.5">{step.value}</div>
                                                <div className={`text-[9px] mt-0.5 ${step.label === 'Paid' && lineOutstanding > 0 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>{step.sub}</div>
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
                          {/* Material group subtotal */}
                          <tfoot>
                            <tr className="bg-slate-700 text-white font-semibold">
                              <td colSpan={4} className="px-3 py-1.5 text-[10px] uppercase tracking-widest border-r border-slate-600">{grp.materialName} Total</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-600">{fmtNum(grp.totalReceived)} {grp.unit}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-600">{fmtCurrency(grp.totalValue)}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-600">{fmtCurrency(grp.totalPaid)}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-600 text-red-300">{fmtCurrency(grp.outstanding)}</td>
                              <td colSpan={2} className="px-3 py-1.5"></td>
                            </tr>
                          </tfoot>
                        </table>
                      )}
                    </div>
                  );
                })}
                {/* Grand total footer */}
                <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest">Grand Total</span>
                  <div className="flex items-center gap-6 text-xs">
                    <div>
                      <span className="text-[9px] text-slate-400 mr-1">Value:</span>
                      <span className="font-mono tabular-nums font-bold">{fmtCurrency(materialGroups.reduce((s, g) => s + g.totalValue, 0))}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 mr-1">Paid:</span>
                      <span className="font-mono tabular-nums text-green-300">{fmtCurrency(materialGroups.reduce((s, g) => s + g.totalPaid, 0))}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 mr-1">Due:</span>
                      <span className="font-mono tabular-nums font-bold text-red-300">{fmtCurrency(materialGroups.reduce((s, g) => s + g.outstanding, 0))}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ADD/EDIT MATERIAL MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-[520px] max-w-[95vw] shadow-2xl">
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <div className="text-xs font-bold uppercase tracking-widest">{editId ? 'Edit Material' : 'Add Material'}</div>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Material Name</label>
                  <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., Enzyme Alpha" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                  <select value={form.category || 'RAW_MATERIAL'} onChange={e => setForm({ ...form, category: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="RAW_MATERIAL">Raw Material</option>
                    <option value="CHEMICAL">Chemical</option>
                    <option value="PACKING">Packing</option>
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
                    <option value="NOS">Nos</option>
                    <option value="PKT">Packet</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Min Stock</label>
                  <input type="number" value={form.minStock ?? ''} onChange={e => setForm({ ...form, minStock: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Max Stock</label>
                  <input type="number" value={form.maxStock ?? ''} onChange={e => setForm({ ...form, maxStock: e.target.value ? parseFloat(e.target.value) : null })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Optional" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Default Rate</label>
                  <input type="number" value={form.defaultRate ?? ''} onChange={e => setForm({ ...form, defaultRate: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">HSN Code</label>
                  <input value={form.hsnCode || ''} onChange={e => setForm({ ...form, hsnCode: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 3507" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST %</label>
                  <input type="number" value={form.gstPercent ?? 5} onChange={e => setForm({ ...form, gstPercent: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
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
              <button onClick={saveMaterial} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* NEW/EDIT DEAL MODAL */}
      {showDealModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-[600px] max-w-[95vw] shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <div className="text-xs font-bold uppercase tracking-widest">{editingDealId ? 'Edit Deal' : 'New Material Deal'}</div>
            </div>
            <div className="p-4 space-y-3">
              {/* Section: Vendor */}
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-1">Vendor Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor</label>
                  <select value={dealForm.vendorId} onChange={e => {
                    const v = vendors.find(v => v.id === e.target.value);
                    setDealForm({ ...dealForm, vendorId: e.target.value, vendorName: v?.name || '', vendorPhone: v?.phone || dealForm.vendorPhone });
                  }} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">-- Select Vendor --</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    <option value="__new">+ Add New Vendor</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
                  <input value={dealForm.vendorPhone} onChange={e => {
                    setDealForm({ ...dealForm, vendorPhone: e.target.value });
                  }}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Auto-filled from vendor" />
                </div>
              </div>
              {dealForm.vendorId === '__new' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">New Vendor Name</label>
                    <input value={dealForm.vendorName} onChange={e => setDealForm({ ...dealForm, vendorName: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., ABC Chemicals" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Address</label>
                    <input value={(dealForm as Record<string, string>).vendorAddress || ''} onChange={e => setDealForm({ ...dealForm, vendorAddress: e.target.value } as typeof dealForm)}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., Narsinghpur" />
                  </div>
                </div>
              )}

              {/* Section: Material & Pricing */}
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-1 mt-2">Material & Pricing</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Material</label>
                  <select value={dealForm.materialItemId} onChange={e => setDealForm({ ...dealForm, materialItemId: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">-- Select Material --</option>
                    {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Deal Type</label>
                  <select value={(dealForm as Record<string, string>).quantityType || 'OPEN'} onChange={e => {
                    const v = e.target.value;
                    setDealForm({ ...dealForm, quantityType: v, rate: v === 'JOB_WORK' ? 0 : dealForm.rate } as typeof dealForm);
                  }}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="OPEN">Open (No fixed qty)</option>
                    <option value="FIXED">Fixed Quantity</option>
                    <option value="JOB_WORK">Job Work</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {(dealForm as Record<string, string>).quantityType !== 'JOB_WORK' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate</label>
                  <input type="number" value={dealForm.rate || ''} onChange={e => setDealForm({ ...dealForm, rate: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 500" />
                </div>
                )}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity</label>
                  <div className="flex">
                    <input type="number" max={99999} value={(dealForm as Record<string, number>).quantity || ''} onChange={e => setDealForm({ ...dealForm, quantity: parseFloat(e.target.value) || 0 } as typeof dealForm)}
                      className="w-full border border-slate-300 border-r-0 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 100" />
                    <select value={(dealForm as Record<string, string>).quantityUnit || 'MT'} onChange={e => setDealForm({ ...dealForm, quantityUnit: e.target.value } as typeof dealForm)}
                      className="border border-slate-300 px-1.5 py-1.5 text-[10px] bg-slate-50 text-slate-600 focus:outline-none" style={{ minWidth: '62px' }}>
                      <option value="MT">MT</option>
                      <option value="KG">KG</option>
                      <option value="LTR">LTR</option>
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
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Valid Until</label>
                  <input type="date" value={(dealForm as Record<string, string>).validUntil || ''} onChange={e => setDealForm({ ...dealForm, validUntil: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
              </div>

              {/* Section: Delivery */}
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-1 mt-2">Delivery Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Origin / Source</label>
                  <input value={(dealForm as Record<string, string>).origin || ''} onChange={e => { const v = e.target.value; setDealForm({ ...dealForm, origin: v.charAt(0).toUpperCase() + v.slice(1) } as typeof dealForm); }}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., Mumbai, Indore" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Delivery Point</label>
                  <select value={(dealForm as Record<string, string>).deliveryPoint || 'Factory Gate'} onChange={e => setDealForm({ ...dealForm, deliveryPoint: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="Factory Gate">Factory Gate</option>
                    <option value="Store Room">Store Room</option>
                    <option value="Chemical Store">Chemical Store</option>
                    <option value="Main Warehouse">Main Warehouse</option>
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
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Expected Delivery (Days)</label>
                  <input type="number" min="1" value={(dealForm as Record<string, string>).deliverySchedule || ''} onChange={e => setDealForm({ ...dealForm, deliverySchedule: e.target.value } as typeof dealForm)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g., 7" />
                </div>
              </div>

              {/* Section: Remarks */}
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-1 mt-2">Notes</div>
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

      {/* PAYMENT MODAL */}
      {showPayModal && payDeal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-[480px] max-w-[95vw] shadow-2xl">
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <div className="text-xs font-bold uppercase tracking-widest">Record Payment</div>
              <div className="text-[9px] text-slate-400 mt-0.5">PO-{payDeal.poNo} | {payDeal.vendor.name} | Outstanding: {fmtCurrency(payDeal.outstanding)}</div>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount</label>
                  <input type="number" value={payForm.amount || ''} onChange={e => setPayForm({ ...payForm, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Mode</label>
                  <select value={payForm.mode} onChange={e => setPayForm({ ...payForm, mode: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="NEFT">NEFT</option>
                    <option value="RTGS">RTGS</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference (UTR/Ref)</label>
                  <input value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="UTR / Cheque No" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Date</label>
                  <input type="date" value={payForm.date} onChange={e => setPayForm({ ...payForm, date: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Amount</label>
                  <input type="number" value={payForm.tdsAmount || ''} onChange={e => setPayForm({ ...payForm, tdsAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Section</label>
                  <select value={payForm.tdsSection} onChange={e => setPayForm({ ...payForm, tdsSection: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">None</option>
                    <option value="194C">194C - Contractor</option>
                    <option value="194Q">194Q - Purchase of Goods</option>
                    <option value="194J">194J - Professional</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                <input value={payForm.remarks} onChange={e => setPayForm({ ...payForm, remarks: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 flex justify-end gap-2">
              <button onClick={() => setShowPayModal(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={submitPayment} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Record Payment'}</button>
            </div>
          </div>
        </div>
      )}

      {trucksModal && (
        <WeighbridgeTrucksModal
          poId={trucksModal.poId}
          title={trucksModal.title}
          subtitle={trucksModal.subtitle}
          onClose={() => setTrucksModal(null)}
        />
      )}

      {ledgerModal && (
        <VendorLedgerModal
          vendorId={ledgerModal.vendorId}
          vendorName={ledgerModal.vendorName}
          onClose={() => setLedgerModal(null)}
        />
      )}
    </div>
  );
}
