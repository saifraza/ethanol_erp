import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

/* ───── Types ───── */
interface Material {
  id: string; name: string; code: string; category: string; unit: string;
  currentStock: number; avgCost: number; hsnCode: string; gstPercent: number;
  defaultRate: number; minStock: number; maxStock: number; isActive: boolean;
}

interface DealLine {
  id: string; description: string; rate: number; unit: string;
  inventoryItemId: string; receivedQty: number; quantity: number;
  inventoryItem: { category: string; name: string } | null;
}

interface DealGrn {
  id: string; grnNo: number; totalQty: number; totalAmount: number; grnDate: string;
}

interface Deal {
  id: string; poNo: number; dealType: string; status: string; poDate: string;
  deliveryDate: string | null; remarks: string; truckCap: number | null;
  vendor: { id: string; name: string; phone: string };
  lines: DealLine[]; grns: DealGrn[];
  totalReceived: number; totalValue: number; totalPaid: number;
  outstanding: number; truckCount: number; grainTruckCount: number;
}

interface Receipt {
  id: string; grnNo: number; grnDate: string; vehicleNo: string;
  totalQty: number; totalAmount: number; status: string; remarks: string;
  po: { poNo: number; vendor: { name: string } };
  lines: Array<{ receivedQty: number; acceptedQty: number; rate: number; unit: string;
    inventoryItem: { name: string; category: string } | null }>;
  grainTruck: { moisture: number | null; starchPercent: number | null;
    damagedPercent: number | null; foreignMatter: number | null; quarantine: boolean } | null;
}

interface Summary {
  activeDeals: number; totalOutstanding: number;
  thisMonthReceived: number; thisMonthPaid: number;
}

interface Vendor { id: string; name: string; phone: string; category: string; }

interface Payment {
  id: string; paymentNo: number; paymentDate: string; amount: number;
  mode: string; reference: string; remarks: string; type: string;
}

interface TruckRow {
  id: string; grnNo?: number; vehicleNo?: string; grnDate?: string;
  totalQty?: number; totalAmount?: number; status?: string;
  moisture?: number | null; starchPercent?: number | null;
}

/* ───── Helpers ───── */
const fmtCurrency = (n: number) =>
  n === 0 ? '--' : '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

const statusColor: Record<string, string> = {
  APPROVED: 'border-green-300 bg-green-50 text-green-700',
  PARTIAL_RECEIVED: 'border-amber-300 bg-amber-50 text-amber-700',
  RECEIVED: 'border-blue-300 bg-blue-50 text-blue-700',
  CLOSED: 'border-slate-300 bg-slate-50 text-slate-600',
  DRAFT: 'border-slate-300 bg-slate-50 text-slate-500',
  CANCELLED: 'border-red-300 bg-red-50 text-red-600',
};

const dealTypeColor: Record<string, string> = {
  OPEN: 'border-blue-300 bg-blue-50 text-blue-700',
  STANDARD: 'border-slate-300 bg-slate-50 text-slate-600',
  TRUCKS: 'border-amber-300 bg-amber-50 text-amber-700',
};

const UNITS = ['MT', 'KG', 'KL', 'LTR', 'NOS', 'TRUCKS'];
const PAYMENT_TERMS = ['ADVANCE', 'COD', 'NET7', 'NET15', 'NET30'];
const PAYMENT_MODES = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'NEFT', 'RTGS'];
const TDS_SECTIONS = ['', '194C', '194O', '194Q', '194J', '194H'];

/* ───── Empty forms ───── */
const EMPTY_DEAL_FORM = {
  vendorId: '', vendorName: '', vendorPhone: '', newVendor: false,
  materialId: '', rate: '', quantity: '', unit: 'MT',
  dealType: 'OPEN' as 'OPEN' | 'FIXED',
  paymentTerms: 'COD', validUntil: '', origin: '', deliveryPoint: '',
  transportBy: '', remarks: '',
};

const EMPTY_PAYMENT_FORM = {
  amount: '', mode: 'BANK_TRANSFER', reference: '', date: '',
  tdsAmount: '', tdsSection: '', remarks: '',
};

const EMPTY_MATERIAL_FORM = {
  name: '', code: '', category: 'RAW_MATERIAL', unit: 'MT',
  hsnCode: '', gstPercent: 5, defaultRate: 0, minStock: 0, maxStock: 0,
};

/* ═══════════════════════ COMPONENT ═══════════════════════ */
export default function RawMaterialPurchase() {
  /* ── State ── */
  const [tab, setTab] = useState<'deals' | 'receipts' | 'materials'>('deals');
  const [loading, setLoading] = useState(true);

  // Data
  const [deals, setDeals] = useState<Deal[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [summary, setSummary] = useState<Summary>({ activeDeals: 0, totalOutstanding: 0, thisMonthReceived: 0, thisMonthPaid: 0 });
  const [vendors, setVendors] = useState<Vendor[]>([]);

  // Expanded deal
  const [expandedDeal, setExpandedDeal] = useState<string | null>(null);
  const [expandedTrucks, setExpandedTrucks] = useState<TruckRow[]>([]);
  const [expandedPayments, setExpandedPayments] = useState<Payment[]>([]);
  const [expandLoading, setExpandLoading] = useState(false);

  // Modals
  const [showDealModal, setShowDealModal] = useState(false);
  const [dealForm, setDealForm] = useState({ ...EMPTY_DEAL_FORM });
  const [dealSaving, setDealSaving] = useState(false);

  const [showPayModal, setShowPayModal] = useState(false);
  const [payDealId, setPayDealId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ ...EMPTY_PAYMENT_FORM });
  const [paySaving, setPaySaving] = useState(false);

  const [showMatModal, setShowMatModal] = useState(false);
  const [matForm, setMatForm] = useState({ ...EMPTY_MATERIAL_FORM });
  const [editingMatId, setEditingMatId] = useState<string | null>(null);
  const [matSaving, setMatSaving] = useState(false);

  /* ── Fetchers ── */
  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get<Summary>('/raw-material-purchase/summary');
      setSummary(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchDeals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<Deal[]>('/raw-material-purchase/deals');
      setDeals(res.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  const fetchReceipts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<Receipt[]>('/raw-material-purchase/receipts');
      setReceipts(res.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  const fetchMaterials = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<Material[]>('/raw-material-purchase/materials');
      setMaterials(res.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  const fetchVendors = useCallback(async () => {
    try {
      const res = await api.get<Vendor[]>('/vendors', { params: { category: 'RAW_MATERIAL,CHEMICAL,TRADER,GENERAL' } });
      setVendors(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchSummary();
    fetchVendors();
    fetchMaterials();
  }, [fetchSummary, fetchVendors, fetchMaterials]);

  useEffect(() => {
    if (tab === 'deals') fetchDeals();
    else if (tab === 'receipts') fetchReceipts();
    else fetchMaterials();
  }, [tab, fetchDeals, fetchReceipts, fetchMaterials]);

  /* ── Expand deal row ── */
  const toggleExpand = useCallback(async (dealId: string) => {
    if (expandedDeal === dealId) { setExpandedDeal(null); return; }
    setExpandedDeal(dealId);
    setExpandLoading(true);
    try {
      const [trucksRes, payRes] = await Promise.all([
        api.get<{ grns: TruckRow[]; grainTrucks: unknown[] }>(`/raw-material-purchase/deals/${dealId}/trucks`),
        api.get<Payment[]>(`/raw-material-purchase/deals/${dealId}/payments`),
      ]);
      setExpandedTrucks(trucksRes.data.grns || []);
      setExpandedPayments(payRes.data);
    } catch { /* ignore */ }
    setExpandLoading(false);
  }, [expandedDeal]);

  /* ── Deal CRUD ── */
  const openNewDeal = () => {
    setDealForm({ ...EMPTY_DEAL_FORM });
    setShowDealModal(true);
  };

  const submitDeal = async () => {
    setDealSaving(true);
    try {
      const body: Record<string, unknown> = {
        materialItemId: dealForm.materialId,
        rate: parseFloat(dealForm.rate) || 0,
        quantityType: dealForm.dealType,
        paymentTerms: dealForm.paymentTerms,
        origin: dealForm.origin,
        deliveryPoint: dealForm.deliveryPoint,
        transportBy: dealForm.transportBy,
        remarks: dealForm.remarks,
      };
      if (dealForm.newVendor) {
        body.vendorName = dealForm.vendorName;
        body.vendorPhone = dealForm.vendorPhone;
      } else {
        body.vendorId = dealForm.vendorId;
      }
      if (dealForm.dealType === 'FIXED') {
        body.quantity = parseFloat(dealForm.quantity) || 0;
        body.quantityUnit = dealForm.unit;
      }
      if (dealForm.validUntil) body.validUntil = dealForm.validUntil;

      await api.post('/raw-material-purchase/deals', body);
      setShowDealModal(false);
      fetchDeals();
      fetchSummary();
    } catch { /* ignore */ }
    setDealSaving(false);
  };

  /* ── Payment ── */
  const openPayModal = (dealId: string) => {
    setPayDealId(dealId);
    setPayForm({ ...EMPTY_PAYMENT_FORM });
    setShowPayModal(true);
  };

  const submitPayment = async () => {
    if (!payDealId) return;
    setPaySaving(true);
    try {
      await api.post(`/raw-material-purchase/deals/${payDealId}/payment`, {
        dealId: payDealId,
        amount: parseFloat(payForm.amount) || 0,
        mode: payForm.mode,
        reference: payForm.reference,
        paymentDate: payForm.date || undefined,
        tdsDeducted: payForm.tdsAmount ? parseFloat(payForm.tdsAmount) : 0,
        tdsSection: payForm.tdsSection || undefined,
        remarks: payForm.remarks,
      });
      setShowPayModal(false);
      fetchDeals();
      fetchSummary();
      if (expandedDeal === payDealId) toggleExpand(payDealId);
    } catch { /* ignore */ }
    setPaySaving(false);
  };

  /* ── Material CRUD ── */
  const openNewMaterial = () => {
    setEditingMatId(null);
    setMatForm({ ...EMPTY_MATERIAL_FORM });
    setShowMatModal(true);
  };

  const openEditMaterial = (m: Material) => {
    setEditingMatId(m.id);
    setMatForm({
      name: m.name, code: m.code, category: m.category, unit: m.unit,
      hsnCode: m.hsnCode || '', gstPercent: m.gstPercent, defaultRate: m.defaultRate,
      minStock: m.minStock, maxStock: m.maxStock,
    });
    setShowMatModal(true);
  };

  const submitMaterial = async () => {
    setMatSaving(true);
    try {
      if (editingMatId) {
        await api.put(`/raw-material-purchase/materials/${editingMatId}`, matForm);
      } else {
        await api.post('/raw-material-purchase/materials', matForm);
      }
      setShowMatModal(false);
      fetchMaterials();
    } catch { /* ignore */ }
    setMatSaving(false);
  };

  /* ── Render helpers ── */
  const Badge = ({ text, colors }: { text: string; colors: string }) => (
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${colors}`}>{text}</span>
  );

  const TabBtn = ({ label, value }: { label: string; value: typeof tab }) => (
    <button
      onClick={() => setTab(value)}
      className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
        tab === value ? 'border-blue-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >{label}</button>
  );

  /* ═══════════════════════ LOADING ═══════════════════════ */
  if (loading && deals.length === 0 && receipts.length === 0 && materials.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  /* ═══════════════════════ MAIN RENDER ═══════════════════════ */
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">

        {/* ─── Toolbar ─── */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Raw Material Purchase</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Deals & Running Balance</span>
          </div>
          <div className="flex items-center gap-2">
            <TabBtn label="Deals" value="deals" />
            <TabBtn label="Receipts" value="receipts" />
            <TabBtn label="Materials" value="materials" />
            <div className="w-px h-5 bg-slate-600 mx-1" />
            {tab === 'deals' && (
              <button onClick={openNewDeal} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
                + New Deal
              </button>
            )}
            {tab === 'materials' && (
              <button onClick={openNewMaterial} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
                + New Material
              </button>
            )}
          </div>
        </div>

        {/* ─── KPI Strip (deals tab only) ─── */}
        {tab === 'deals' && (
          <div className="grid grid-cols-2 md:grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Deals</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.activeDeals}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Outstanding</div>
              <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{fmtCurrency(summary.totalOutstanding)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">This Month Received</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.thisMonthReceived.toFixed(1)} MT</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">This Month Paid</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(summary.thisMonthPaid)}</div>
            </div>
          </div>
        )}

        {/* ═══════════════ TAB: DEALS ═══════════════ */}
        {tab === 'deals' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
            <table className="w-full text-xs min-w-[1100px]">
              <thead>
                <tr className="bg-slate-800 text-white">
                  {['PO#', 'Vendor', 'Material', 'Rate', 'Type', 'Received', 'Value', 'Paid', 'Outstanding', 'Trucks', 'Status', ''].map((h, i) => (
                    <th key={i} className={`text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${
                      ['Rate', 'Received', 'Value', 'Paid', 'Outstanding', 'Trucks'].includes(h) ? 'text-right' : ''
                    } ${h === '' ? 'border-r-0 w-24' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No deals found</td></tr>
                )}
                {deals.map((d, i) => {
                  const mat = d.lines[0]?.inventoryItem?.name || d.lines[0]?.description || '--';
                  const rate = d.lines[0]?.rate || 0;
                  const dtype = d.remarks?.includes('FIXED_TRUCKS') ? 'TRUCKS' : d.dealType;
                  const isExpanded = expandedDeal === d.id;

                  return (
                    <React.Fragment key={d.id}>
                      <tr
                        className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''}`}
                        onClick={() => toggleExpand(d.id)}
                      >
                        <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">PO-{d.poNo}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <div className="text-slate-800">{d.vendor.name}</div>
                          {d.vendor.phone && <div className="text-[10px] text-slate-400">{d.vendor.phone}</div>}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{mat}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-700">{fmtCurrency(rate)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <Badge text={dtype} colors={dealTypeColor[dtype] || dealTypeColor.STANDARD} />
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-700">
                          {d.totalReceived > 0 ? d.totalReceived.toFixed(2) : '--'}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-700">{fmtCurrency(d.totalValue)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">
                          <span className={d.totalPaid > 0 ? 'text-green-700' : 'text-slate-400'}>{fmtCurrency(d.totalPaid)}</span>
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">
                          <span className={d.outstanding > 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}>{fmtCurrency(d.outstanding)}</span>
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-700">
                          {d.truckCount}{d.grainTruckCount !== d.truckCount ? ` / ${d.grainTruckCount}` : ''}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <Badge text={d.status.replace('_', ' ')} colors={statusColor[d.status] || statusColor.DRAFT} />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={(e) => { e.stopPropagation(); openPayModal(d.id); }}
                              className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700"
                            >Pay</button>
                            <span className={`text-slate-400 text-[10px] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                              &#9660;
                            </span>
                          </div>
                        </td>
                      </tr>

                      {/* ─── Expanded detail ─── */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={12} className="bg-slate-50 border-b border-slate-200 p-0">
                            {expandLoading ? (
                              <div className="px-6 py-4 text-xs text-slate-400 uppercase tracking-widest">Loading details...</div>
                            ) : (
                              <div className="px-6 py-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Trucks / GRNs */}
                                <div>
                                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                                    Receipts / GRNs ({expandedTrucks.length})
                                  </div>
                                  {expandedTrucks.length === 0 ? (
                                    <div className="text-[10px] text-slate-400 uppercase tracking-widest">No receipts yet</div>
                                  ) : (
                                    <table className="w-full text-[11px]">
                                      <thead>
                                        <tr className="bg-slate-200 border-b border-slate-300">
                                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase tracking-widest">GRN#</th>
                                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Vehicle</th>
                                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Date</th>
                                          <th className="text-right px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Qty</th>
                                          <th className="text-right px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Amount</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {expandedTrucks.map((t) => (
                                          <tr key={t.id} className="border-b border-slate-100">
                                            <td className="px-2 py-1 font-medium">GRN-{t.grnNo}</td>
                                            <td className="px-2 py-1">{t.vehicleNo || '--'}</td>
                                            <td className="px-2 py-1">{t.grnDate ? fmtDate(t.grnDate) : '--'}</td>
                                            <td className="px-2 py-1 text-right font-mono tabular-nums">{t.totalQty?.toFixed(2) || '--'}</td>
                                            <td className="px-2 py-1 text-right font-mono tabular-nums">{fmtCurrency(t.totalAmount || 0)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                                {/* Payments */}
                                <div>
                                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                                    Payments ({expandedPayments.length})
                                  </div>
                                  {expandedPayments.length === 0 ? (
                                    <div className="text-[10px] text-slate-400 uppercase tracking-widest">No payments yet</div>
                                  ) : (
                                    <table className="w-full text-[11px]">
                                      <thead>
                                        <tr className="bg-slate-200 border-b border-slate-300">
                                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Pay#</th>
                                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Date</th>
                                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Mode</th>
                                          <th className="text-right px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Amount</th>
                                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase tracking-widest">Ref</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {expandedPayments.map((p) => (
                                          <tr key={p.id} className="border-b border-slate-100">
                                            <td className="px-2 py-1 font-medium">#{p.paymentNo}</td>
                                            <td className="px-2 py-1">{fmtDate(p.paymentDate)}</td>
                                            <td className="px-2 py-1">{p.mode.replace('_', ' ')}</td>
                                            <td className="px-2 py-1 text-right font-mono tabular-nums text-green-700">{fmtCurrency(p.amount)}</td>
                                            <td className="px-2 py-1 text-slate-500">{p.reference || '--'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════ TAB: RECEIPTS ═══════════════ */}
        {tab === 'receipts' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className="bg-slate-800 text-white">
                  {['GRN#', 'Date', 'Vendor', 'Material', 'Vehicle', 'Qty', 'Amount', 'Quality', 'Status'].map((h, i) => (
                    <th key={i} className={`text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${
                      ['Qty', 'Amount'].includes(h) ? 'text-right' : ''
                    } ${h === 'Status' ? 'border-r-0' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {receipts.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No receipts found</td></tr>
                )}
                {receipts.map((r, i) => {
                  const matName = r.lines[0]?.inventoryItem?.name || '--';
                  const gt = r.grainTruck;
                  return (
                    <tr key={r.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">GRN-{r.grnNo}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">{fmtDate(r.grnDate)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{r.po.vendor.name}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{matName}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-600">{r.vehicleNo || '--'}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-700">{r.totalQty.toFixed(2)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-700">{fmtCurrency(r.totalAmount)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <div className="flex items-center gap-1 flex-wrap">
                          {gt?.moisture != null && (
                            <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-sky-300 bg-sky-50 text-sky-700">
                              M:{gt.moisture}%
                            </span>
                          )}
                          {gt?.starchPercent != null && (
                            <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-violet-300 bg-violet-50 text-violet-700">
                              S:{gt.starchPercent}%
                            </span>
                          )}
                          {gt?.quarantine && (
                            <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-red-300 bg-red-50 text-red-700">Q</span>
                          )}
                          {!gt && <span className="text-slate-300">--</span>}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge text={r.status} colors={statusColor[r.status] || statusColor.DRAFT} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════ TAB: MATERIALS ═══════════════ */}
        {tab === 'materials' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
            <table className="w-full text-xs min-w-[800px]">
              <thead>
                <tr className="bg-slate-800 text-white">
                  {['Code', 'Name', 'Category', 'Unit', 'Stock', 'Avg Cost', 'HSN', 'GST%', ''].map((h, i) => (
                    <th key={i} className={`text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${
                      ['Stock', 'Avg Cost', 'GST%'].includes(h) ? 'text-right' : ''
                    } ${h === '' ? 'border-r-0 w-16' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {materials.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No materials found</td></tr>
                )}
                {materials.map((m, i) => (
                  <tr key={m.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">{m.code}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700">{m.name}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <Badge text={m.category.replace('_', ' ')} colors="border-slate-300 bg-slate-50 text-slate-600" />
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{m.unit}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-700">
                      <span className={m.currentStock <= m.minStock ? 'text-red-600 font-semibold' : ''}>
                        {m.currentStock.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-700">{fmtCurrency(m.avgCost)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-500">{m.hsnCode || '--'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-600">{m.gstPercent}%</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => openEditMaterial(m)}
                        className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50"
                      >Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════════ MODAL: NEW DEAL ═══════════════ */}
      {showDealModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40" onClick={() => setShowDealModal(false)}>
          <div className="bg-white shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">New Deal</span>
              <button onClick={() => setShowDealModal(false)} className="text-slate-400 hover:text-white text-lg leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {/* Vendor */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor</label>
                {dealForm.newVendor ? (
                  <div className="space-y-2">
                    <input
                      placeholder="Vendor Name"
                      value={dealForm.vendorName}
                      onChange={(e) => setDealForm({ ...dealForm, vendorName: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <input
                      placeholder="Phone"
                      value={dealForm.vendorPhone}
                      onChange={(e) => setDealForm({ ...dealForm, vendorPhone: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <button
                      onClick={() => setDealForm({ ...dealForm, newVendor: false, vendorName: '', vendorPhone: '' })}
                      className="text-[10px] text-blue-600 hover:underline"
                    >Select existing vendor</button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <select
                      value={dealForm.vendorId}
                      onChange={(e) => setDealForm({ ...dealForm, vendorId: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                      <option value="">-- Select Vendor --</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.name} {v.phone ? `(${v.phone})` : ''}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setDealForm({ ...dealForm, newVendor: true, vendorId: '' })}
                      className="text-[10px] text-blue-600 hover:underline"
                    >+ New Vendor</button>
                  </div>
                )}
              </div>

              {/* Material */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Material</label>
                <select
                  value={dealForm.materialId}
                  onChange={(e) => setDealForm({ ...dealForm, materialId: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="">-- Select Material --</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.code})</option>
                  ))}
                </select>
              </div>

              {/* Rate */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate (per unit)</label>
                <input
                  type="number"
                  value={dealForm.rate}
                  onChange={(e) => setDealForm({ ...dealForm, rate: e.target.value })}
                  placeholder="0.00"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                />
              </div>

              {/* Deal Type */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity Type</label>
                <div className="flex gap-4 mt-1">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input type="radio" checked={dealForm.dealType === 'OPEN'} onChange={() => setDealForm({ ...dealForm, dealType: 'OPEN' })} />
                    Open (no fixed qty)
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input type="radio" checked={dealForm.dealType === 'FIXED'} onChange={() => setDealForm({ ...dealForm, dealType: 'FIXED' })} />
                    Fixed Quantity
                  </label>
                </div>
              </div>

              {/* Quantity (if fixed) */}
              {dealForm.dealType === 'FIXED' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity</label>
                    <input
                      type="number"
                      value={dealForm.quantity}
                      onChange={(e) => setDealForm({ ...dealForm, quantity: e.target.value })}
                      placeholder="0"
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit</label>
                    <select
                      value={dealForm.unit}
                      onChange={(e) => setDealForm({ ...dealForm, unit: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Payment Terms + Valid Until */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Terms</label>
                  <select
                    value={dealForm.paymentTerms}
                    onChange={(e) => setDealForm({ ...dealForm, paymentTerms: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Valid Until</label>
                  <input
                    type="date"
                    value={dealForm.validUntil}
                    onChange={(e) => setDealForm({ ...dealForm, validUntil: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              {/* Origin, Delivery, Transport */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Origin</label>
                  <input
                    value={dealForm.origin}
                    onChange={(e) => setDealForm({ ...dealForm, origin: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Delivery Point</label>
                  <input
                    value={dealForm.deliveryPoint}
                    onChange={(e) => setDealForm({ ...dealForm, deliveryPoint: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Transport By</label>
                  <input
                    value={dealForm.transportBy}
                    onChange={(e) => setDealForm({ ...dealForm, transportBy: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                <textarea
                  value={dealForm.remarks}
                  onChange={(e) => setDealForm({ ...dealForm, remarks: e.target.value })}
                  rows={2}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowDealModal(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
              >Cancel</button>
              <button
                onClick={submitDeal}
                disabled={dealSaving}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
              >{dealSaving ? 'Saving...' : 'Create Deal'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ MODAL: PAYMENT ═══════════════ */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40" onClick={() => setShowPayModal(false)}>
          <div className="bg-white shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">Record Payment</span>
              <button onClick={() => setShowPayModal(false)} className="text-slate-400 hover:text-white text-lg leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-3">
              {/* Amount */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount</label>
                <input
                  type="number"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                />
              </div>

              {/* Mode + Date */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Mode</label>
                  <select
                    value={payForm.mode}
                    onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Date</label>
                  <input
                    type="date"
                    value={payForm.date}
                    onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              {/* Reference */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference / UTR</label>
                <input
                  value={payForm.reference}
                  onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              {/* TDS */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Amount</label>
                  <input
                    type="number"
                    value={payForm.tdsAmount}
                    onChange={(e) => setPayForm({ ...payForm, tdsAmount: e.target.value })}
                    placeholder="0.00"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Section</label>
                  <select
                    value={payForm.tdsSection}
                    onChange={(e) => setPayForm({ ...payForm, tdsSection: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {TDS_SECTIONS.map((s) => <option key={s} value={s}>{s || '-- None --'}</option>)}
                  </select>
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                <input
                  value={payForm.remarks}
                  onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowPayModal(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
              >Cancel</button>
              <button
                onClick={submitPayment}
                disabled={paySaving}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
              >{paySaving ? 'Saving...' : 'Record Payment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ MODAL: MATERIAL ═══════════════ */}
      {showMatModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40" onClick={() => setShowMatModal(false)}>
          <div className="bg-white shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">{editingMatId ? 'Edit Material' : 'New Material'}</span>
              <button onClick={() => setShowMatModal(false)} className="text-slate-400 hover:text-white text-lg leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Name</label>
                  <input
                    value={matForm.name}
                    onChange={(e) => setMatForm({ ...matForm, name: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Code</label>
                  <input
                    value={matForm.code}
                    onChange={(e) => setMatForm({ ...matForm, code: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                  <select
                    value={matForm.category}
                    onChange={(e) => setMatForm({ ...matForm, category: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="RAW_MATERIAL">Raw Material</option>
                    <option value="CHEMICAL">Chemical</option>
                    <option value="PACKING">Packing</option>
                    <option value="CONSUMABLE">Consumable</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit</label>
                  <select
                    value={matForm.unit}
                    onChange={(e) => setMatForm({ ...matForm, unit: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">HSN Code</label>
                  <input
                    value={matForm.hsnCode}
                    onChange={(e) => setMatForm({ ...matForm, hsnCode: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST %</label>
                  <input
                    type="number"
                    value={matForm.gstPercent}
                    onChange={(e) => setMatForm({ ...matForm, gstPercent: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Default Rate</label>
                  <input
                    type="number"
                    value={matForm.defaultRate}
                    onChange={(e) => setMatForm({ ...matForm, defaultRate: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Min Stock</label>
                  <input
                    type="number"
                    value={matForm.minStock}
                    onChange={(e) => setMatForm({ ...matForm, minStock: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Max Stock</label>
                  <input
                    type="number"
                    value={matForm.maxStock}
                    onChange={(e) => setMatForm({ ...matForm, maxStock: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowMatModal(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
              >Cancel</button>
              <button
                onClick={submitMaterial}
                disabled={matSaving}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
              >{matSaving ? 'Saving...' : (editingMatId ? 'Update' : 'Create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
