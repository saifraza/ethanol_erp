import React, { useState, useEffect } from 'react';
import { FileText, Plus, X, Pencil, Truck, ChevronDown, ChevronUp, Fuel, Factory, Building2, Landmark, Trash2, Upload, FileDown } from 'lucide-react';
import api from '../../services/api';

interface Contract {
  id: string;
  contractNo: string;
  contractType: 'JOB_WORK' | 'FIXED_PRICE' | 'OMC';
  status: string;
  buyerName: string;
  buyerAddress?: string;
  buyerGst?: string;
  buyerPan?: string;
  buyerContact?: string;
  buyerPhone?: string;
  buyerEmail?: string;
  omcName?: string;
  omcDepot?: string;
  allocationQtyKL?: number;
  principalName?: string;
  conversionRate?: number;
  ddgsRate?: number;
  ethanolBenchmark?: number;
  ddgsBenchmark?: number;
  prcPenalty?: number;
  ethanolRate?: number;
  startDate: string;
  endDate: string;
  contractQtyKL?: number;
  dailyTargetKL?: number;
  minLiftingPerDay?: number;
  tankerCapacityKL?: string;
  paymentTermsDays?: number;
  paymentMode?: string;
  gstPercent?: number;
  supplyType?: string;
  logisticsBy?: string;
  totalSuppliedKL: number;
  totalInvoicedAmt: number;
  totalReceivedAmt: number;
  remarks?: string;
  contractPdfName?: string;
  hasPdf?: boolean;
  autoGenerateEInvoice?: boolean;
  buyerCustomerId?: string;
  createdAt: string;
  liftings?: Lifting[];
}

interface LiftingInvoice {
  id: string;
  invoiceNo: number;
  totalAmount: number;
  paidAmount: number;
  status: string;
  irn?: string | null;
  irnStatus?: string | null;
  ackNo?: string | null;
  irnDate?: string | null;
  ewbNo?: string | null;
  ewbDate?: string | null;
  ewbStatus?: string | null;
}

interface Lifting {
  id: string;
  liftingDate: string;
  vehicleNo: string;
  driverName?: string;
  driverPhone?: string;
  transporterName?: string;
  destination?: string;
  quantityBL: number;
  quantityKL: number;
  strength?: number;
  rate?: number;
  amount?: number;
  invoiceNo?: string;
  invoiceId?: string;
  distanceKm?: number;
  invoice?: LiftingInvoice | null;
  status: string;
  deliveredQtyKL?: number;
  shortageKL?: number;
  omcReceiptNo?: string;
  remarks?: string;
}

interface SupplySummary {
  contractQtyKL: number;
  suppliedKL: number;
  remainingKL: number;
  progressPct: number;
  invoicedAmount: number;
  receivedAmount: number;
  outstanding: number;
  inTransitCount: number;
  inTransitKL: number;
  deliveredCount: number;
  totalLiftings: number;
  daysRemaining: number;
}

interface Stats {
  total: number;
  active: number;
  jobWork: number;
  fixedPrice: number;
  omc: number;
  totalContractQtyKL: number;
  totalSuppliedKL: number;
}

const emptyForm = {
  contractNo: '', contractType: 'JOB_WORK' as string, status: 'ACTIVE',
  buyerName: '', buyerAddress: '', buyerGst: '', buyerPan: '', buyerContact: '', buyerPhone: '', buyerEmail: '',
  omcName: '', omcDepot: '', allocationQtyKL: '',
  principalName: '', conversionRate: '', ddgsRate: '', ethanolBenchmark: '374', ddgsBenchmark: '0.76', prcPenalty: '2',
  ethanolRate: '',
  startDate: '', endDate: '', contractQtyKL: '', dailyTargetKL: '', minLiftingPerDay: '', tankerCapacityKL: '',
  paymentTermsDays: '', paymentMode: 'RTGS', gstPercent: '18', supplyType: 'INTRA_STATE', logisticsBy: 'BUYER',
  remarks: '',
};

const emptyLiftingForm = {
  liftingDate: new Date().toISOString().slice(0, 10), vehicleNo: '', driverName: '', driverPhone: '',
  transporterName: '', destination: '', quantityBL: '', quantityKL: '', strength: '', rate: '', invoiceNo: '', remarks: '',
};

const typeLabels: Record<string, string> = { JOB_WORK: 'Job Work', FIXED_PRICE: 'Fixed Price', OMC: 'OMC Direct' };
const typeColors: Record<string, string> = {
  JOB_WORK: 'bg-amber-50 text-amber-800 border-amber-300',
  FIXED_PRICE: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  OMC: 'bg-blue-50 text-blue-800 border-blue-300',
};
const typeIcons: Record<string, any> = { JOB_WORK: Factory, FIXED_PRICE: Building2, OMC: Landmark };
const statusColors: Record<string, string> = {
  DRAFT: 'bg-slate-50 text-slate-700 border-slate-300', ACTIVE: 'bg-green-50 text-green-700 border-green-300',
  EXPIRED: 'bg-red-50 text-red-700 border-red-300', TERMINATED: 'bg-red-100 text-red-800 border-red-400',
};
const omcOptions = ['IOCL', 'BPCL', 'HPCL', 'JioBP', 'Nayara'];

const EthanolContracts: React.FC = () => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, jobWork: 0, fixedPrice: 0, omc: 0, totalContractQtyKL: 0, totalSuppliedKL: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [liftingContractId, setLiftingContractId] = useState<string | null>(null);
  const [liftForm, setLiftForm] = useState({ ...emptyLiftingForm });
  const [liftSaving, setLiftSaving] = useState(false);

  // Supply detail state
  const [detailSummary, setDetailSummary] = useState<SupplySummary | null>(null);
  const [detailLiftings, setDetailLiftings] = useState<Lifting[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showIrnDetail, setShowIrnDetail] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/ethanol-contracts');
      setContracts(res.data.contracts || []);
      setStats(res.data.stats || stats);
    } catch (err) {
      setError('Failed to load contracts');
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
  };

  const openCreate = () => { setEditId(null); setForm({ ...emptyForm }); setShowForm(true); };

  const openEdit = (c: Contract) => {
    setEditId(c.id);
    setForm({
      contractNo: c.contractNo, contractType: c.contractType, status: c.status,
      buyerName: c.buyerName, buyerAddress: c.buyerAddress || '', buyerGst: c.buyerGst || '',
      buyerPan: c.buyerPan || '', buyerContact: c.buyerContact || '', buyerPhone: c.buyerPhone || '', buyerEmail: c.buyerEmail || '',
      omcName: c.omcName || '', omcDepot: c.omcDepot || '', allocationQtyKL: String(c.allocationQtyKL || ''),
      principalName: c.principalName || '', conversionRate: String(c.conversionRate || ''),
      ddgsRate: String(c.ddgsRate || ''), ethanolBenchmark: String(c.ethanolBenchmark || '374'),
      ddgsBenchmark: String(c.ddgsBenchmark || '0.76'), prcPenalty: String(c.prcPenalty || ''),
      ethanolRate: String(c.ethanolRate || ''),
      startDate: c.startDate?.slice(0, 10) || '', endDate: c.endDate?.slice(0, 10) || '',
      contractQtyKL: String(c.contractQtyKL || ''), dailyTargetKL: String(c.dailyTargetKL || ''),
      minLiftingPerDay: String(c.minLiftingPerDay || ''), tankerCapacityKL: c.tankerCapacityKL || '',
      paymentTermsDays: String(c.paymentTermsDays || ''), paymentMode: c.paymentMode || 'RTGS',
      gstPercent: String(c.gstPercent || '18'), supplyType: c.supplyType || 'INTRA_STATE',
      logisticsBy: c.logisticsBy || 'BUYER', remarks: c.remarks || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true); setError('');
      if (editId) { await api.put(`/ethanol-contracts/${editId}`, form); }
      else { await api.post('/ethanol-contracts', form); }
      setShowForm(false); setEditId(null); fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contract?')) return;
    try { await api.delete(`/ethanol-contracts/${id}`); fetchData(); }
    catch (err: any) { setError(err?.response?.data?.error || 'Failed to delete'); }
  };

  const handleLiftingSubmit = async () => {
    if (!liftingContractId) return;
    try {
      setLiftSaving(true);
      await api.post(`/ethanol-contracts/${liftingContractId}/liftings`, liftForm);
      const contractIdToRefresh = liftingContractId;
      setLiftingContractId(null); setLiftForm({ ...emptyLiftingForm }); fetchData();
      if (expanded === contractIdToRefresh) loadSupplyDetail(contractIdToRefresh);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to add lifting');
    } finally { setLiftSaving(false); }
  };

  const handleDeleteLifting = async (liftingId: string) => {
    if (!confirm('Delete this lifting?')) return;
    try {
      await api.delete(`/ethanol-contracts/liftings/${liftingId}`);
      fetchData();
      if (expanded) loadSupplyDetail(expanded);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to delete'); }
  };

  const handlePdfUpload = async (contractId: string) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.pdf';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return;
      try {
        const formData = new FormData(); formData.append('pdf', file);
        await api.post(`/ethanol-contracts/${contractId}/pdf`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        fetchData();
      } catch (err: any) { setError(err?.response?.data?.error || 'Failed to upload PDF'); }
    };
    input.click();
  };

  const viewPdf = (contractId: string) => { window.open(`/api/ethanol-contracts/${contractId}/pdf`, '_blank'); };

  // Load supply summary when expanding a contract
  const loadSupplyDetail = async (contractId: string) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/ethanol-contracts/${contractId}/supply-summary`);
      setDetailSummary(res.data.summary);
      setDetailLiftings(res.data.liftings || []);
    } catch { setError('Failed to load supply details'); }
    finally { setDetailLoading(false); }
  };

  const handleExpand = (contractId: string) => {
    if (expanded === contractId) {
      setExpanded(null);
      setDetailSummary(null);
      setDetailLiftings([]);
    } else {
      setExpanded(contractId);
      loadSupplyDetail(contractId);
    }
  };

  const handleCreateInvoice = async (contractId: string, liftingId: string) => {
    try {
      setActionLoading(liftingId);
      await api.post(`/ethanol-contracts/${contractId}/liftings/${liftingId}/create-invoice`);
      loadSupplyDetail(contractId);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to create invoice'); }
    finally { setActionLoading(null); }
  };

  const handleGenerateEInvoice = async (contractId: string, liftingId: string) => {
    try {
      setActionLoading(liftingId);
      const res = await api.post(`/ethanol-contracts/${contractId}/liftings/${liftingId}/e-invoice`);
      const d = res.data;
      if (d.ewbError) { setError(`IRN generated. E-Way Bill failed: ${d.ewbError}`); }
      loadSupplyDetail(contractId);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to generate e-invoice'); }
    finally { setActionLoading(null); }
  };

  const handleToggleAutoEInvoice = async (contractId: string, enabled: boolean) => {
    try {
      await api.patch(`/ethanol-contracts/${contractId}/auto-einvoice`, { enabled });
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to toggle'); }
  };

  const filtered = typeFilter === 'ALL' ? contracts : contracts.filter(c => c.contractType === typeFilter);
  const pctUsed = (c: Contract) => c.contractQtyKL ? Math.round((c.totalSuppliedKL / c.contractQtyKL) * 100) : 0;
  const daysLeft = (c: Contract) => { const d = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000); return d > 0 ? d : 0; };

  const inputCls = "border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400";
  const labelCls = "text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block";

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <p className="text-xs text-slate-400 uppercase tracking-widest">Loading...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Fuel size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Ethanol Supply</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Contracts, Liftings & Tracking</span>
          </div>
          <button onClick={openCreate}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5">
            <Plus size={12} /> New Contract
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 md:grid-cols-7 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-slate-500 border-r border-slate-300 bg-white px-3 py-2.5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total</div>
            <div className="text-xl font-bold text-slate-800">{stats.total}</div>
          </div>
          <div className="border-l-4 border-l-green-500 border-r border-slate-300 bg-white px-3 py-2.5">
            <div className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-0.5">Active</div>
            <div className="text-xl font-bold text-green-700">{stats.active}</div>
          </div>
          <div className="border-l-4 border-l-amber-500 border-r border-slate-300 bg-white px-3 py-2.5 hidden md:block">
            <div className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-0.5">Job Work</div>
            <div className="text-xl font-bold text-amber-700">{stats.jobWork}</div>
          </div>
          <div className="border-l-4 border-l-emerald-500 border-r border-slate-300 bg-white px-3 py-2.5 hidden md:block">
            <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-0.5">Fixed Price</div>
            <div className="text-xl font-bold text-emerald-700">{stats.fixedPrice}</div>
          </div>
          <div className="border-l-4 border-l-blue-500 border-r border-slate-300 bg-white px-3 py-2.5 hidden md:block">
            <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-0.5">OMC</div>
            <div className="text-xl font-bold text-blue-700">{stats.omc}</div>
          </div>
          <div className="border-l-4 border-l-indigo-500 border-r border-slate-300 bg-white px-3 py-2.5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Contract Qty</div>
            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{stats.totalContractQtyKL.toFixed(0)} <span className="text-xs font-normal text-slate-400">KL</span></div>
          </div>
          <div className="border-l-4 border-l-green-500 bg-white px-3 py-2.5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Supplied</div>
            <div className="text-lg font-bold text-green-700 font-mono tabular-nums">{stats.totalSuppliedKL.toFixed(0)} <span className="text-xs font-normal text-slate-400">KL</span></div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border-x border-b border-red-200 text-red-700 px-4 py-2 text-xs -mx-3 md:-mx-6">
            {error}<button onClick={() => setError('')} className="float-right text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}

        {/* Type filter tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-1">
          {['ALL', 'JOB_WORK', 'FIXED_PRICE', 'OMC'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap transition ${
                typeFilter === t ? 'border-b-2 border-blue-600 text-blue-700 bg-white' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t === 'ALL' ? 'All' : typeLabels[t]}
            </button>
          ))}
        </div>

        {/* Contract Table */}
        <div className="-mx-3 md:-mx-6 border-x border-slate-300">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Contract</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700 hidden md:table-cell">Buyer</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Type</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Status</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700 hidden md:table-cell">Rate</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700 hidden md:table-cell">Supplied / Qty</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const isExpanded = expanded === c.id;
                const pct = pctUsed(c);
                const days = daysLeft(c);

                return (
                  <React.Fragment key={c.id}>
                    <tr className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60 cursor-pointer"
                      onClick={() => handleExpand(c.id)}>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                        <div className="font-bold text-slate-900">{c.contractNo}</div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(c.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} - {new Date(c.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                          {days > 0 && <span className={`ml-1 ${days <= 30 ? 'text-red-500' : ''}`}>({days}d left)</span>}
                        </div>
                        {c.omcName && <div className="text-[10px] text-blue-600">{c.omcName} - {c.omcDepot || ''}</div>}
                        {c.principalName && <div className="text-[10px] text-amber-600">Principal: {c.principalName}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 hidden md:table-cell text-slate-700 font-medium">{c.buyerName}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${typeColors[c.contractType]}`}>{typeLabels[c.contractType]}</span>
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColors[c.status] || 'bg-slate-50 text-slate-700 border-slate-300'}`}>{c.status}</span>
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right hidden md:table-cell font-mono tabular-nums font-bold">
                        {c.contractType === 'JOB_WORK' ? `${c.conversionRate || 0}/BL` : `${c.ethanolRate || 0}/L`}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right hidden md:table-cell">
                        <div className="font-mono tabular-nums">{c.totalSuppliedKL.toFixed(0)} / {(c.contractQtyKL || 0).toFixed(0)} KL</div>
                        {c.contractQtyKL && c.contractQtyKL > 0 && (
                          <div className="w-full h-1.5 bg-slate-200 mt-1 overflow-hidden">
                            <div className={`h-full transition-all ${pct >= 90 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
                              style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-center">
                        <div className="flex items-center justify-center gap-1">
                          {c.hasPdf ? (
                            <button onClick={(e) => { e.stopPropagation(); viewPdf(c.id); }}
                              className="px-2 py-0.5 text-[10px] bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 font-medium flex items-center gap-0.5">
                              <FileDown size={10} /> PDF
                            </button>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); handlePdfUpload(c.id); }}
                              className="px-2 py-0.5 text-[10px] bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 font-medium flex items-center gap-0.5">
                              <Upload size={10} /> PDF
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setLiftingContractId(c.id); setLiftForm({ ...emptyLiftingForm, destination: c.omcDepot || '' }); }}
                            className="px-2 py-0.5 text-[10px] bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-medium flex items-center gap-0.5">
                            <Truck size={10} /> Lift
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                            className="px-1.5 py-0.5 text-[10px] bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">
                            <Pencil size={10} />
                          </button>
                          {c.status === 'DRAFT' && (
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                              className="px-1.5 py-0.5 text-[10px] bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">
                              <Trash2 size={10} />
                            </button>
                          )}
                          <ChevronDown size={14} className={`text-slate-400 transition ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </td>
                    </tr>

                    {/* Expanded: Supply Dashboard */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 border-b border-slate-300">
                          {detailLoading ? (
                            <div className="text-center py-8"><span className="text-xs text-slate-400 uppercase tracking-widest">Loading supply data...</span></div>
                          ) : detailSummary ? (
                            <div className="space-y-0">
                              {/* Supply Progress Bar */}
                              <div className="px-4 py-3 border-b border-slate-200 bg-white">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Supply Progress</span>
                                  <span className="text-xs font-bold font-mono tabular-nums text-slate-700">
                                    {detailSummary.suppliedKL.toFixed(1)} / {detailSummary.contractQtyKL.toFixed(0)} KL
                                    <span className="text-slate-400 ml-1">({detailSummary.progressPct}%)</span>
                                  </span>
                                </div>
                                <div className="w-full h-2.5 bg-slate-200 overflow-hidden">
                                  <div className={`h-full transition-all ${detailSummary.progressPct >= 90 ? 'bg-green-500' : detailSummary.progressPct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
                                    style={{ width: `${Math.min(detailSummary.progressPct, 100)}%` }} />
                                </div>
                                <div className="flex justify-between mt-1 text-[10px] text-slate-400">
                                  <span>{detailSummary.remainingKL.toFixed(1)} KL remaining</span>
                                  <span>{detailSummary.daysRemaining}d left</span>
                                </div>
                              </div>

                              {/* Document Pipeline KPIs */}
                              {(() => {
                                const withInvoice = detailLiftings.filter(l => l.invoice).length;
                                const withIRN = detailLiftings.filter(l => l.invoice?.irnStatus === 'GENERATED').length;
                                const withEWB = detailLiftings.filter(l => l.invoice?.ewbStatus === 'GENERATED').length;
                                const pending = detailLiftings.length - withInvoice;
                                return (
                                  <div className="grid grid-cols-2 md:grid-cols-5 border-b border-slate-200">
                                    <div className="bg-white px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-slate-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Liftings</div>
                                      <div className="text-lg font-bold text-slate-800 font-mono tabular-nums mt-0.5">{detailSummary.totalLiftings}</div>
                                    </div>
                                    <div className="bg-white px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-amber-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In-Transit</div>
                                      <div className="text-lg font-bold text-amber-700 font-mono tabular-nums mt-0.5">
                                        {detailSummary.inTransitCount > 0 ? `${detailSummary.inTransitCount}` : '0'}
                                      </div>
                                      {detailSummary.inTransitKL > 0 && <div className="text-[10px] text-amber-600 font-mono">{detailSummary.inTransitKL.toFixed(1)} KL</div>}
                                    </div>
                                    <div className="bg-white px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-blue-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Invoiced</div>
                                      <div className="text-lg font-bold text-blue-700 font-mono tabular-nums mt-0.5">{withInvoice} <span className="text-xs text-slate-400 font-normal">/ {detailSummary.totalLiftings}</span></div>
                                      {pending > 0 && <div className="text-[10px] text-red-500 font-medium">{pending} pending</div>}
                                    </div>
                                    <div className="bg-white px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-green-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">IRN Generated</div>
                                      <div className="text-lg font-bold text-green-700 font-mono tabular-nums mt-0.5">{withIRN} <span className="text-xs text-slate-400 font-normal">/ {withInvoice}</span></div>
                                    </div>
                                    <div className="bg-white px-4 py-2.5 border-l-4 border-l-green-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">E-Way Bill</div>
                                      <div className="text-lg font-bold text-green-700 font-mono tabular-nums mt-0.5">{withEWB} <span className="text-xs text-slate-400 font-normal">/ {withIRN}</span></div>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Inline error for e-invoice actions */}
                              {error && (
                                <div className="bg-red-50 border-b border-red-200 text-red-700 px-4 py-2 text-xs flex items-center justify-between">
                                  <span>{error}</span>
                                  <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-2 font-bold">&times;</button>
                                </div>
                              )}

                              {/* Auto E-Invoice Toggle + Contract Info */}
                              <div className="px-4 py-2 bg-white border-b border-slate-200 flex items-center justify-between">
                                <div className="flex items-center gap-4 text-xs text-slate-500">
                                  {c.buyerGst && <span><span className="text-[10px] font-bold uppercase tracking-widest">GST:</span> {c.buyerGst}</span>}
                                  {c.paymentTermsDays && <span><span className="text-[10px] font-bold uppercase tracking-widest">Pay:</span> {c.paymentTermsDays}d</span>}
                                  {c.hasPdf && (
                                    <button onClick={() => viewPdf(c.id)} className="text-purple-600 hover:underline font-medium flex items-center gap-0.5">
                                      <FileDown size={10} /> PDF
                                    </button>
                                  )}
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer" onClick={e => e.stopPropagation()}>
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Auto E-Invoice</span>
                                  <button
                                    onClick={() => handleToggleAutoEInvoice(c.id, !c.autoGenerateEInvoice)}
                                    className={`relative w-9 h-5 transition-colors ${c.autoGenerateEInvoice ? 'bg-green-500' : 'bg-slate-300'}`}>
                                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white transition-transform shadow ${c.autoGenerateEInvoice ? 'translate-x-4' : ''}`} />
                                  </button>
                                </label>
                              </div>

                              {/* Lifting History Table */}
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-slate-700 text-white">
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600">Date</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600">Vehicle</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600 hidden md:table-cell">Dest</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-right border-r border-slate-600">BL</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-right border-r border-slate-600">KL</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-right border-r border-slate-600">Amount</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center border-r border-slate-600">Status</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center border-r border-slate-600">Invoice</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center border-r border-slate-600">IRN</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center border-r border-slate-600">EWB</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailLiftings.length === 0 ? (
                                      <tr><td colSpan={11} className="text-center py-6 text-xs text-slate-400 uppercase tracking-widest">No liftings yet</td></tr>
                                    ) : detailLiftings.map((l, i) => (
                                      <React.Fragment key={l.id}>
                                      <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                        <td className="px-2 py-1.5 border-r border-slate-100 whitespace-nowrap">{new Date(l.liftingDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 font-medium">{l.vehicleNo}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 hidden md:table-cell">{l.destination || '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{l.quantityBL.toLocaleString()}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{l.quantityKL.toFixed(2)}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{(l.amount || 0).toLocaleString('en-IN')}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                            l.status === 'DELIVERED' ? 'bg-green-50 text-green-700 border-green-200' :
                                            l.status === 'SHORTAGE' ? 'bg-red-50 text-red-700 border-red-200' :
                                            l.status === 'IN_TRANSIT' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                            'bg-blue-50 text-blue-700 border-blue-200'
                                          }`}>{l.status}</span>
                                        </td>
                                        {/* Invoice */}
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          {l.invoice ? (
                                            <span className="text-[10px] font-medium text-slate-700">INV-{l.invoice.invoiceNo}</span>
                                          ) : (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleCreateInvoice(c.id, l.id); }}
                                              disabled={actionLoading === l.id}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                                              {actionLoading === l.id ? '...' : 'Create'}
                                            </button>
                                          )}
                                        </td>
                                        {/* IRN */}
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          {l.invoice?.irnStatus === 'GENERATED' ? (
                                            <button onClick={(e) => { e.stopPropagation(); setShowIrnDetail(showIrnDetail === l.id ? null : l.id); }}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer">IRN</button>
                                          ) : l.invoice ? (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleGenerateEInvoice(c.id, l.id); }}
                                              disabled={actionLoading === l.id}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                              {actionLoading === l.id ? '...' : 'Gen'}
                                            </button>
                                          ) : (
                                            <span className="text-slate-300">--</span>
                                          )}
                                        </td>
                                        {/* EWB */}
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          {l.invoice?.ewbStatus === 'GENERATED' ? (
                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">EWB</span>
                                          ) : l.invoice?.irnStatus === 'GENERATED' && !l.invoice?.ewbNo ? (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleGenerateEInvoice(c.id, l.id); }}
                                              disabled={actionLoading === l.id}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                              {actionLoading === l.id ? '...' : 'EWB'}
                                            </button>
                                          ) : (
                                            <span className="text-slate-300">--</span>
                                          )}
                                        </td>
                                        {/* Actions */}
                                        <td className="px-2 py-1.5 text-center">
                                          <button onClick={(e) => { e.stopPropagation(); handleDeleteLifting(l.id); }} className="text-red-400 hover:text-red-600"><Trash2 size={11} /></button>
                                        </td>
                                      </tr>
                                      {/* IRN/EWB detail row */}
                                      {showIrnDetail === l.id && l.invoice && (
                                        <tr className="bg-green-50/50">
                                          <td colSpan={11} className="px-3 py-2 text-[10px] border-b border-slate-200">
                                            <div className="flex flex-wrap gap-x-6 gap-y-1">
                                              {l.invoice.irn && (
                                                <div><span className="font-bold text-slate-500 uppercase tracking-widest">IRN:</span> <span className="font-mono text-slate-700 break-all">{l.invoice.irn}</span></div>
                                              )}
                                              {l.invoice.ackNo && (
                                                <div><span className="font-bold text-slate-500 uppercase tracking-widest">Ack No:</span> <span className="font-mono text-slate-700">{l.invoice.ackNo}</span></div>
                                              )}
                                              {l.invoice.irnDate && (
                                                <div><span className="font-bold text-slate-500 uppercase tracking-widest">IRN Date:</span> <span className="font-mono text-slate-700">{new Date(l.invoice.irnDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
                                              )}
                                              {l.invoice.ewbNo && (
                                                <div><span className="font-bold text-slate-500 uppercase tracking-widest">EWB No:</span> <span className="font-mono text-slate-700">{l.invoice.ewbNo}</span></div>
                                              )}
                                              {l.invoice.ewbDate && (
                                                <div><span className="font-bold text-slate-500 uppercase tracking-widest">EWB Date:</span> <span className="font-mono text-slate-700">{new Date(l.invoice.ewbDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
                                              )}
                                              <div><span className="font-bold text-slate-500 uppercase tracking-widest">Invoice Total:</span> <span className="font-mono text-slate-700">{l.invoice.totalAmount?.toLocaleString('en-IN')}</span></div>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                      </React.Fragment>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <p className="text-xs text-slate-400 uppercase tracking-widest">No contracts found</p>
                    <button onClick={openCreate} className="mt-2 text-blue-600 text-xs font-medium hover:underline">Create your first contract</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE/EDIT CONTRACT MODAL */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-6">
          <div className="bg-white shadow-2xl w-full max-w-4xl mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide uppercase">{editId ? 'Edit Contract' : 'New Ethanol Contract'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Type + Status + Contract No */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Contract Type *</label>
                  <select name="contractType" value={form.contractType} onChange={handleFormChange} className={inputCls}>
                    <option value="JOB_WORK">Job Work (3rd Party Mfg)</option>
                    <option value="FIXED_PRICE">Fixed Price Party</option>
                    <option value="OMC">OMC Direct</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Contract No *</label>
                  <input type="text" name="contractNo" value={form.contractNo} onChange={handleFormChange} required placeholder="e.g. SMPPL/2025-26/387" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <select name="status" value={form.status} onChange={handleFormChange} className={inputCls}>
                    <option value="DRAFT">Draft</option>
                    <option value="ACTIVE">Active</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="TERMINATED">Terminated</option>
                  </select>
                </div>
              </div>

              {/* Buyer details */}
              <div className="bg-slate-50 p-4 border border-slate-200">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                  {form.contractType === 'JOB_WORK' ? 'Principal (Grain Owner)' : form.contractType === 'OMC' ? 'OMC / Buyer' : 'Buyer'}
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className={labelCls}>Name *</label><input type="text" name="buyerName" value={form.buyerName} onChange={handleFormChange} required className={inputCls} /></div>
                  <div><label className={labelCls}>GST No</label><input type="text" name="buyerGst" value={form.buyerGst} onChange={handleFormChange} className={inputCls} /></div>
                  <div><label className={labelCls}>Contact Person</label><input type="text" name="buyerContact" value={form.buyerContact} onChange={handleFormChange} className={inputCls} /></div>
                  <div><label className={labelCls}>Phone</label><input type="text" name="buyerPhone" value={form.buyerPhone} onChange={handleFormChange} className={inputCls} /></div>
                  <div><label className={labelCls}>Email</label><input type="text" name="buyerEmail" value={form.buyerEmail} onChange={handleFormChange} className={inputCls} /></div>
                  <div><label className={labelCls}>Address</label><input type="text" name="buyerAddress" value={form.buyerAddress} onChange={handleFormChange} className={inputCls} /></div>
                </div>
              </div>

              {/* OMC-specific */}
              {form.contractType === 'OMC' && (
                <div className="bg-blue-50 p-4 border border-blue-200">
                  <h3 className="text-[10px] font-bold text-blue-700 uppercase tracking-widest mb-3">OMC Details</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className={labelCls}>OMC Company *</label>
                      <select name="omcName" value={form.omcName} onChange={handleFormChange} className={inputCls}>
                        <option value="">Select OMC</option>
                        {omcOptions.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div><label className={labelCls}>Depot / Location</label><input type="text" name="omcDepot" value={form.omcDepot} onChange={handleFormChange} className={inputCls} /></div>
                    <div><label className={labelCls}>Allocation (KL)</label><input type="number" name="allocationQtyKL" value={form.allocationQtyKL} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                  </div>
                </div>
              )}

              {/* Job Work-specific */}
              {form.contractType === 'JOB_WORK' && (
                <div className="bg-amber-50 p-4 border border-amber-200">
                  <h3 className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-3">Job Work Terms</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className={labelCls}>Conversion Rate (/BL)</label><input type="number" name="conversionRate" value={form.conversionRate} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                    <div><label className={labelCls}>DDGS Rate (/kg)</label><input type="number" name="ddgsRate" value={form.ddgsRate} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                    <div><label className={labelCls}>PRC Penalty (/BL)</label><input type="number" name="prcPenalty" value={form.prcPenalty} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                    <div><label className={labelCls}>Ethanol Yield (BL/1000kg)</label><input type="number" name="ethanolBenchmark" value={form.ethanolBenchmark} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                    <div><label className={labelCls}>DDGS Yield (kg/BL)</label><input type="number" name="ddgsBenchmark" value={form.ddgsBenchmark} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                    <div><label className={labelCls}>Principal Name</label><input type="text" name="principalName" value={form.principalName} onChange={handleFormChange} className={inputCls} /></div>
                  </div>
                </div>
              )}

              {/* Fixed Price / OMC rate */}
              {(form.contractType === 'FIXED_PRICE' || form.contractType === 'OMC') && (
                <div className="bg-emerald-50 p-4 border border-emerald-200">
                  <h3 className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest mb-3">Pricing</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className={labelCls}>Ethanol Rate (/Litre) *</label><input type="number" name="ethanolRate" value={form.ethanolRate} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                    <div><label className={labelCls}>GST %</label><input type="number" name="gstPercent" value={form.gstPercent} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                    <div><label className={labelCls}>Supply Type</label>
                      <select name="supplyType" value={form.supplyType} onChange={handleFormChange} className={inputCls}>
                        <option value="INTRA_STATE">Intra State</option>
                        <option value="INTER_STATE">Inter State</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Common: duration, qty, logistics */}
              <div className="grid grid-cols-4 gap-3">
                <div><label className={labelCls}>Start Date *</label><input type="date" name="startDate" value={form.startDate} onChange={handleFormChange} required className={inputCls} /></div>
                <div><label className={labelCls}>End Date *</label><input type="date" name="endDate" value={form.endDate} onChange={handleFormChange} required className={inputCls} /></div>
                <div><label className={labelCls}>Total Qty (KL)</label><input type="number" name="contractQtyKL" value={form.contractQtyKL} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                <div><label className={labelCls}>Daily Target (KL)</label><input type="number" name="dailyTargetKL" value={form.dailyTargetKL} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div><label className={labelCls}>Min Tankers/Day</label><input type="number" name="minLiftingPerDay" value={form.minLiftingPerDay} onChange={handleFormChange} className={inputCls} /></div>
                <div><label className={labelCls}>Tanker Capacity (KL)</label><input type="text" name="tankerCapacityKL" value={form.tankerCapacityKL} onChange={handleFormChange} placeholder="20/30/35/40" className={inputCls} /></div>
                <div><label className={labelCls}>Payment Terms (days)</label><input type="number" name="paymentTermsDays" value={form.paymentTermsDays} onChange={handleFormChange} className={inputCls} /></div>
                <div><label className={labelCls}>Logistics By</label>
                  <select name="logisticsBy" value={form.logisticsBy} onChange={handleFormChange} className={inputCls}>
                    <option value="BUYER">Buyer</option>
                    <option value="SELLER">Seller (Us)</option>
                    <option value="PRINCIPAL">Principal</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Remarks</label>
                <textarea name="remarks" value={form.remarks} onChange={handleFormChange} rows={2} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-200">
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving...' : editId ? 'Update Contract' : 'Create Contract'}
              </button>
              <button onClick={() => setShowForm(false)} className="px-6 py-2 bg-slate-200 text-slate-800 text-[11px] font-medium hover:bg-slate-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD LIFTING MODAL */}
      {liftingContractId && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white shadow-2xl w-full max-w-2xl mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide uppercase flex items-center gap-2"><Truck size={16} /> Record Lifting</h2>
              <button onClick={() => setLiftingContractId(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>Date *</label><input type="date" value={liftForm.liftingDate} onChange={e => setLiftForm(p => ({ ...p, liftingDate: e.target.value }))} className={inputCls} /></div>
                <div><label className={labelCls}>Vehicle No *</label><input type="text" value={liftForm.vehicleNo} onChange={e => setLiftForm(p => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))} placeholder="MP 24 XX 1234" className={inputCls} /></div>
                <div><label className={labelCls}>Destination</label><input type="text" value={liftForm.destination} onChange={e => setLiftForm(p => ({ ...p, destination: e.target.value }))} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>Driver Name</label><input type="text" value={liftForm.driverName} onChange={e => setLiftForm(p => ({ ...p, driverName: e.target.value }))} className={inputCls} /></div>
                <div><label className={labelCls}>Driver Phone</label><input type="text" value={liftForm.driverPhone} onChange={e => setLiftForm(p => ({ ...p, driverPhone: e.target.value }))} className={inputCls} /></div>
                <div><label className={labelCls}>Transporter</label><input type="text" value={liftForm.transporterName} onChange={e => setLiftForm(p => ({ ...p, transporterName: e.target.value }))} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div><label className={labelCls}>Qty (BL) *</label>
                  <input type="number" value={liftForm.quantityBL} step="0.01"
                    onChange={e => { const bl = e.target.value; setLiftForm(p => ({ ...p, quantityBL: bl, quantityKL: bl ? String(parseFloat(bl) / 1000) : '' })); }}
                    className={inputCls} />
                </div>
                <div><label className={labelCls}>Qty (KL)</label><input type="number" value={liftForm.quantityKL} step="0.001" readOnly className="border border-slate-200 px-2.5 py-1.5 text-xs w-full bg-slate-50" /></div>
                <div><label className={labelCls}>Strength %</label><input type="number" value={liftForm.strength} step="0.01" onChange={e => setLiftForm(p => ({ ...p, strength: e.target.value }))} className={inputCls} /></div>
                <div><label className={labelCls}>Invoice No</label><input type="text" value={liftForm.invoiceNo} onChange={e => setLiftForm(p => ({ ...p, invoiceNo: e.target.value }))} className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>Remarks</label><input type="text" value={liftForm.remarks} onChange={e => setLiftForm(p => ({ ...p, remarks: e.target.value }))} className={inputCls} /></div>
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-200">
              <button onClick={handleLiftingSubmit} disabled={liftSaving}
                className="px-6 py-2 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {liftSaving ? 'Saving...' : 'Record Lifting'}
              </button>
              <button onClick={() => setLiftingContractId(null)} className="px-6 py-2 bg-slate-200 text-slate-800 text-[11px] font-medium hover:bg-slate-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EthanolContracts;
