import React, { useState, useEffect } from 'react';
import { FileText, Plus, X, Pencil, Truck, ChevronDown, ChevronUp, Fuel, Factory, Building2, Landmark, Trash2, Upload, FileDown } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

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
  balanceAmount: number;
  status: string;
  // Financial details
  amount: number;
  quantity: number;
  rate: number;
  unit: string;
  productName: string;
  gstPercent: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  supplyType: string;
  freightCharge: number;
  // E-Invoice
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
  rstNo?: string;
  challanNo?: string;
  dispatchMode?: string;
  productRatePerLtr?: number;
  productValue?: number;
  invoice?: LiftingInvoice | null;
  dispatchTruck?: { id: string } | null;
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
  transporterName: '', destination: '', quantityBL: '', quantityKL: '', strength: '', rate: '', invoiceNo: '', distanceKm: '',
  rstNo: '', challanNo: '', dispatchMode: 'TANKER', productRatePerLtr: '', productValue: '',
  consigneeName: '', consigneeGstin: '', consigneeAddress: '', consigneeState: '', consigneePincode: '',
  remarks: '',
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
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, jobWork: 0, fixedPrice: 0, omc: 0, totalContractQtyKL: 0, totalSuppliedKL: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);
  const expandedRowRef = useRef<HTMLTableRowElement | null>(null);
  const [scrollAnchor, setScrollAnchor] = useState<{ liftingId: string | null; ts: number }>({ liftingId: null, ts: 0 });

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
  const [activeTrucks, setActiveTrucks] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showIrnDetail, setShowIrnDetail] = useState<string | null>(null);
  const [liftingPage, setLiftingPage] = useState(1);
  const LIFTS_PER_PAGE = 15;

  // EWB generation modal
  const [ewbModal, setEwbModal] = useState<{ contractId: string; liftingId: string; vehicleNo: string; destination: string; transporterName: string; distanceKm: number } | null>(null);
  const [ewbForm, setEwbForm] = useState({ distanceKm: '', transporterName: '', transporterGstin: '', vehicleNo: '' });
  const [manualEwb, setManualEwb] = useState<{ liftingId: string; ewbNo: string; file: File | null } | null>(null);

  // Truck detail modal (before release)
  const [truckDetail, setTruckDetail] = useState<{ truck: any; contract: Contract } | null>(null);

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
      setActiveTrucks(res.data.activeTrucks || []);
      setLiftingPage(1);
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

  // Track just-released lifting for highlight + auto-expand
  const [justReleasedId, setJustReleasedId] = useState<string | null>(null);

  const handleRelease = async (truckId: string, contractId: string) => {
    if (!confirm('Release this truck? This will create the invoice, lifting record, gate pass, and delivery challan.')) return;
    try {
      setActionLoading(truckId);
      const res = await api.post(`/ethanol-gate-pass/${truckId}/release`);
      const d = res.data;
      // Open all 3 documents via authenticated blob fetch
      const openPdf = async (url: string) => {
        try {
          const r = await api.get(url, { responseType: 'blob' });
          window.open(URL.createObjectURL(r.data), '_blank');
        } catch { /* non-critical */ }
      };
      if (d.invoiceId) openPdf(`/ethanol-gate-pass/${truckId}/invoice-pdf`);
      setTimeout(() => openPdf(`/ethanol-gate-pass/${truckId}/delivery-challan-pdf`), 300);
      setTimeout(() => openPdf(`/ethanol-gate-pass/${truckId}/gate-pass-pdf`), 600);
      // Auto-expand the new lifting's IRN detail row
      if (d.liftingId) {
        setJustReleasedId(d.liftingId);
        setShowIrnDetail(d.liftingId);
      }
      loadSupplyDetail(contractId);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to release truck'); }
    finally { setActionLoading(null); }
  };

  // Track last used EWB values per contract for auto-fill
  const [lastEwbValues, setLastEwbValues] = useState<Record<string, { distanceKm: string; transporterName: string; transporterGstin: string }>>({});

  const openEwbModal = (contractId: string, lifting: Lifting) => {
    const last = lastEwbValues[contractId];
    const contract = contracts.find(c => c.id === contractId);
    const distKm = String(lifting.distanceKm || last?.distanceKm || '');
    const transName = lifting.transporterName || last?.transporterName || '';
    const transGstin = last?.transporterGstin || '';

    // Auto-generate if distance is available (most important field for EWB)
    if (distKm) {
      handleGenerateEInvoice(contractId, lifting.id, {
        distanceKm: distKm, transporterName: transName,
        transporterGstin: transGstin, vehicleNo: lifting.vehicleNo,
      });
      return;
    }

    // Otherwise show modal to collect missing distance
    setEwbModal({ contractId, liftingId: lifting.id, vehicleNo: lifting.vehicleNo, destination: lifting.destination || contract?.buyerAddress || '', transporterName: transName, distanceKm: lifting.distanceKm || 0 });
    setEwbForm({ distanceKm: distKm, transporterName: transName, transporterGstin: transGstin, vehicleNo: lifting.vehicleNo });
  };

  const handleGenerateEInvoice = async (contractId: string, liftingId: string, ewbData?: { distanceKm?: string; transporterName?: string; transporterGstin?: string; vehicleNo?: string }) => {
    try {
      setActionLoading(liftingId);
      // Save distance/transporter to lifting first if provided
      if (ewbData?.distanceKm || ewbData?.transporterName) {
        await api.put(`/ethanol-contracts/liftings/${liftingId}`, {
          distanceKm: ewbData.distanceKm || undefined,
          transporterName: ewbData.transporterName || undefined,
        });
      }
      const res = await api.post(`/ethanol-contracts/${contractId}/liftings/${liftingId}/e-invoice`, {
        distanceKm: ewbData?.distanceKm || undefined,
        transporterGstin: ewbData?.transporterGstin || undefined,
      });
      const d = res.data;
      if (d.ewbError) { setError(`IRN generated. E-Way Bill failed: ${d.ewbError}`); }
      // Remember values for next lifting on same contract
      if (ewbData) {
        setLastEwbValues(prev => ({ ...prev, [contractId]: { distanceKm: ewbData.distanceKm || '', transporterName: ewbData.transporterName || '', transporterGstin: ewbData.transporterGstin || '' } }));
      }
      setEwbModal(null);
      loadSupplyDetail(contractId);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to generate e-invoice'); }
    finally { setActionLoading(null); }
  };

  const handleSaveManualEwb = async (contractId: string, liftingId: string) => {
    if (!manualEwb?.ewbNo.trim()) return;
    try {
      setActionLoading(liftingId);
      const formData = new FormData();
      formData.append('ewbNo', manualEwb.ewbNo.trim());
      if (manualEwb.file) formData.append('ewbPdf', manualEwb.file);
      await api.patch(`/ethanol-contracts/${contractId}/liftings/${liftingId}/manual-ewb`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setManualEwb(null);
      loadSupplyDetail(contractId);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to save EWB'); }
    finally { setActionLoading(null); }
  };

  const handleToggleAutoEInvoice = async (contractId: string, enabled: boolean) => {
    try {
      await api.patch(`/ethanol-contracts/${contractId}/auto-einvoice`, { enabled });
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to toggle'); }
  };

  // Excel export
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportContractId, setExportContractId] = useState('');
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (exportContractId) params.set('contractId', exportContractId);
      if (exportFrom) params.set('from', exportFrom);
      if (exportTo) params.set('to', exportTo);
      const res = await api.get(`/ethanol-contracts/export/excel?${params}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url;
      a.download = `Ethanol-Liftings-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click(); window.URL.revokeObjectURL(url);
    } catch { setError('Export failed'); }
    setExporting(false);
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

        {/* Export bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Party</label>
            <select value={exportContractId} onChange={e => setExportContractId(e.target.value)}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-48">
              <option value="">All Contracts</option>
              {contracts.map(c => <option key={c.id} value={c.id}>{c.buyerName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">From</label>
            <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">To</label>
            <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <button onClick={handleExport} disabled={exporting}
            className="px-3 py-1 bg-green-700 text-white text-[11px] font-medium hover:bg-green-800 disabled:opacity-50 flex items-center gap-1.5">
            <FileDown size={12} /> {exporting ? 'Exporting...' : 'Export Excel'}
          </button>
        </div>

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
                          <button onClick={(e) => { e.stopPropagation(); setLiftingContractId(c.id); setLiftForm({ ...emptyLiftingForm, destination: c.omcDepot || '', consigneeName: c.buyerName || '', consigneeGstin: c.buyerGst || '', consigneeAddress: c.buyerAddress || '', consigneeState: '', consigneePincode: '' }); }}
                            className="px-2 py-0.5 text-[10px] bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-medium flex items-center gap-0.5">
                            <Truck size={10} /> Lift
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                            className="px-1.5 py-0.5 text-[10px] bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">
                            <Pencil size={10} />
                          </button>
                          {c.status === 'DRAFT' && isSuperAdmin && (
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
                                  <div className="grid grid-cols-2 md:grid-cols-6 border-b border-slate-200">
                                    {activeTrucks.length > 0 && (
                                    <div className="bg-orange-50 px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-orange-500">
                                      <div className="text-[10px] font-bold text-orange-600 uppercase tracking-widest">Loading at Site</div>
                                      <div className="text-lg font-bold text-orange-700 font-mono tabular-nums mt-0.5">{activeTrucks.length}</div>
                                      <div className="text-[10px] text-orange-500 font-mono">{activeTrucks.map(t => t.vehicleNo).join(', ')}</div>
                                    </div>
                                    )}
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
                                    {/* Active trucks at site (not yet released) */}
                                    {activeTrucks.map((t: any) => (
                                      <tr key={`truck-${t.id}`} className={`border-b border-orange-200 ${t.status === 'GROSS_WEIGHED' ? 'bg-green-50/80' : 'bg-orange-50/80'}`}>
                                        <td className="px-2 py-1.5 border-r border-orange-100 whitespace-nowrap">{(t.gateInTime || t.date) ? new Date(t.gateInTime || t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 font-medium">
                                          <button onClick={(e) => { e.stopPropagation(); setTruckDetail({ truck: t, contract: c }); }} className="text-blue-700 underline hover:text-blue-900">{t.vehicleNo}</button>
                                        </td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 hidden md:table-cell">{t.destination || '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-right font-mono tabular-nums">{t.quantityBL ? t.quantityBL.toLocaleString() : '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-right font-mono tabular-nums">{t.quantityBL ? (t.quantityBL / 1000).toFixed(2) : '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-right font-mono tabular-nums">{t.quantityBL ? (t.quantityBL * (c.contractType === 'JOB_WORK' ? (c.conversionRate || 0) : (c.ethanolRate || 0))).toLocaleString('en-IN') : '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-center">
                                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                            t.status === 'GROSS_WEIGHED' ? 'border-green-300 bg-green-100 text-green-700' : 'border-orange-300 bg-orange-100 text-orange-700'
                                          }`}>
                                            {t.status === 'GATE_IN' ? 'AT GATE' : t.status === 'TARE_WEIGHED' ? 'LOADING' : 'DISPATCHED'}
                                          </span>
                                        </td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-center">
                                          {t.status === 'GROSS_WEIGHED' ? (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleRelease(t.id, c.id); }}
                                              disabled={actionLoading === t.id}
                                              className="text-[9px] font-bold uppercase px-2 py-0.5 border border-green-500 bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                                              {actionLoading === t.id ? '...' : 'Release'}
                                            </button>
                                          ) : <span className="text-[10px] text-orange-500">--</span>}
                                        </td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-center">--</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-center">--</td>
                                        <td className="px-2 py-1.5 text-center text-[10px] text-orange-500">{t.driverName || '-'}</td>
                                      </tr>
                                    ))}
                                    {detailLiftings.length === 0 && activeTrucks.length === 0 ? (
                                      <tr><td colSpan={11} className="text-center py-6 text-xs text-slate-400 uppercase tracking-widest">No liftings yet</td></tr>
                                    ) : detailLiftings.slice((liftingPage - 1) * LIFTS_PER_PAGE, liftingPage * LIFTS_PER_PAGE).map((l, i) => (
                                      <React.Fragment key={l.id}>
                                      <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${justReleasedId === l.id ? 'bg-green-50 ring-2 ring-inset ring-green-400' : i % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                        <td className="px-2 py-1.5 border-r border-slate-100 whitespace-nowrap">{new Date(l.liftingDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 font-medium">{l.vehicleNo}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 hidden md:table-cell">{l.destination || '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{l.quantityBL.toLocaleString()}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{l.quantityKL.toFixed(2)}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{(l.amount || 0).toLocaleString('en-IN')}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          {(() => {
                                            const allDocsReady = !!(l.invoice && l.invoice.irn && l.invoice.ewbNo);
                                            const effectiveStatus = l.status === 'DELIVERED' ? 'DELIVERED' : (allDocsReady ? 'DELIVERED' : l.status);
                                            return (
                                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                                effectiveStatus === 'DELIVERED' ? 'bg-green-50 text-green-700 border-green-200' :
                                                effectiveStatus === 'SHORTAGE' ? 'bg-red-50 text-red-700 border-red-200' :
                                                effectiveStatus === 'IN_TRANSIT' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                'bg-blue-50 text-blue-700 border-blue-200'
                                              }`}>{effectiveStatus}</span>
                                            );
                                          })()}
                                        </td>
                                        {/* Invoice */}
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          {l.invoice ? (
                                            <button onClick={(e) => { e.stopPropagation(); setShowIrnDetail(showIrnDetail === l.id ? null : l.id); }} className="text-[10px] font-medium text-blue-700 underline hover:text-blue-900 cursor-pointer">{l.invoiceNo || `INV-${l.invoice.invoiceNo}`}</button>
                                          ) : (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleCreateInvoice(c.id, l.id); }}
                                              disabled={actionLoading === l.id}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                                              {actionLoading === l.id ? '...' : 'Gen Invoice'}
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
                                              onClick={(e) => { e.stopPropagation(); openEwbModal(c.id, l); }}
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
                                          {l.invoice?.ewbStatus === 'GENERATED' && manualEwb?.liftingId !== l.id ? (
                                            <button onClick={(e) => { e.stopPropagation(); setManualEwb({ liftingId: l.id, ewbNo: l.invoice!.ewbNo || '', file: null }); }}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer" title={`${l.invoice.ewbNo || ''} — click to upload PDF`}>EWB</button>
                                          ) : (l.invoice?.irnStatus === 'GENERATED' || l.invoice?.ewbStatus === 'GENERATED') ? (
                                            manualEwb?.liftingId === l.id ? (
                                              <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center gap-0.5">
                                                  <input type="text" value={manualEwb.ewbNo} onChange={e => setManualEwb({ ...manualEwb, ewbNo: e.target.value })}
                                                    placeholder="EWB No" className="border border-slate-300 px-1 py-0.5 text-[9px] w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveManualEwb(c.id, l.id); }} autoFocus />
                                                  <button onClick={() => handleSaveManualEwb(c.id, l.id)}
                                                    disabled={actionLoading === l.id}
                                                    className="text-[8px] font-bold px-1 py-0.5 border border-green-400 bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
                                                    {actionLoading === l.id ? '...' : 'OK'}</button>
                                                  <button onClick={() => setManualEwb(null)} className="text-[8px] px-0.5 text-slate-400 hover:text-slate-600">X</button>
                                                </div>
                                                <label className="flex items-center gap-1 text-[8px] text-slate-500 cursor-pointer">
                                                  <input type="file" accept=".pdf" className="hidden" onChange={e => setManualEwb({ ...manualEwb, file: e.target.files?.[0] || null })} />
                                                  <span className="border border-slate-300 px-1 py-0.5 bg-white hover:bg-slate-50">{manualEwb.file ? manualEwb.file.name.slice(0, 15) : 'Attach PDF'}</span>
                                                </label>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-0.5">
                                                {c.contractType !== 'JOB_WORK' && (
                                                  <button onClick={(e) => { e.stopPropagation(); openEwbModal(c.id, l); }}
                                                    disabled={actionLoading === l.id}
                                                    className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                                    {actionLoading === l.id ? '...' : 'Gen'}
                                                  </button>
                                                )}
                                                <button onClick={(e) => { e.stopPropagation(); setManualEwb({ liftingId: l.id, ewbNo: '', file: null }); }}
                                                  className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">
                                                  Enter
                                                </button>
                                              </div>
                                            )
                                          ) : (
                                            <span className="text-slate-300">--</span>
                                          )}
                                        </td>
                                        {/* Actions */}
                                        <td className="px-2 py-1.5 text-center">
                                          <div className="flex items-center justify-center gap-1 flex-wrap">
                                            {/* Per-row RATE button removed — rate is locked at contract level.
                                                If a rate change is needed, edit the contract rate (cascades to un-IRN invoices). */}
                                            {l.invoice && (
                                              <button onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                  const res = await api.get(`/invoices/${l.invoice!.id}/pdf`, { responseType: 'blob' });
                                                  window.open(URL.createObjectURL(res.data), '_blank');
                                                } catch { setError('Failed to load invoice PDF'); }
                                              }} className="text-[8px] font-bold uppercase px-1 py-0.5 border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" title="Print Invoice">INV</button>
                                            )}
                                            <button onClick={async (e) => {
                                              e.stopPropagation();
                                              try {
                                                const res = await api.get(`/ethanol-contracts/${c.id}/liftings/${l.id}/delivery-challan-pdf`, { responseType: 'blob' });
                                                window.open(URL.createObjectURL(res.data), '_blank');
                                              } catch { setError('Failed to load Delivery Challan'); }
                                            }} className="text-[8px] font-bold uppercase px-1 py-0.5 border border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100" title="Delivery Challan">DCH</button>
                                            <button onClick={async (e) => {
                                              e.stopPropagation();
                                              try {
                                                const res = await api.get(`/ethanol-contracts/${c.id}/liftings/${l.id}/gate-pass-pdf`, { responseType: 'blob' });
                                                window.open(URL.createObjectURL(res.data), '_blank');
                                              } catch { setError('Failed to load Gate Pass'); }
                                            }} className="text-[8px] font-bold uppercase px-1 py-0.5 border border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100" title="Gate Pass">GP</button>
                                            {l.invoice?.ewbNo && (
                                              <button onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                  const res = await api.get(`/ethanol-contracts/${c.id}/liftings/${l.id}/ewb-pdf`, { responseType: 'blob' });
                                                  window.open(URL.createObjectURL(res.data), '_blank');
                                                } catch { setError('Failed to load E-Way Bill PDF'); }
                                              }} className="text-[8px] font-bold uppercase px-1 py-0.5 border border-green-300 bg-green-50 text-green-600 hover:bg-green-100" title="E-Way Bill PDF">EWB</button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                      {/* IRN/EWB detail row */}
                                      {showIrnDetail === l.id && l.invoice && (
                                        <tr>
                                          <td colSpan={12} className="p-0 border-b-2 border-slate-300">
                                            <div className="bg-slate-800 text-white px-3 py-1.5 flex items-center justify-between">
                                              <span className="text-[10px] font-bold uppercase tracking-widest">Invoice: {l.invoiceNo || `INV-${l.invoice.invoiceNo}`}</span>
                                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                                l.invoice.status === 'PAID' ? 'bg-green-900/50 text-green-300 border-green-600' :
                                                l.invoice.status === 'PARTIAL' ? 'bg-amber-900/50 text-amber-300 border-amber-600' :
                                                'bg-red-900/50 text-red-300 border-red-600'
                                              }`}>{l.invoice.status}</span>
                                              <button onClick={async () => {
                                                try {
                                                  const res = await api.get(`/invoices/${l.invoice!.id}/pdf`, { responseType: 'blob' });
                                                  window.open(URL.createObjectURL(res.data), '_blank');
                                                } catch { setError('Failed to load invoice PDF'); }
                                              }} className="px-2 py-0.5 text-[9px] font-bold uppercase bg-white/10 text-white border border-white/30 hover:bg-white/20 ml-2">PDF</button>
                                            </div>
                                            <div className="bg-slate-50 px-3 py-2 text-[10px] border-l-4 border-l-blue-500">
                                            {/* Invoice Financial Details */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-1.5 mb-2">
                                              <div>
                                                <span className="font-bold text-slate-400 uppercase tracking-widest">Product</span>
                                                <div className="font-medium text-slate-700 mt-0.5">{l.invoice.productName || 'ETHANOL'}</div>
                                              </div>
                                              <div>
                                                <span className="font-bold text-slate-400 uppercase tracking-widest">Qty</span>
                                                <div className="font-mono text-slate-700 mt-0.5">{l.invoice.quantity?.toLocaleString('en-IN')} {l.invoice.unit || 'BL'}</div>
                                              </div>
                                              <div>
                                                <span className="font-bold text-slate-400 uppercase tracking-widest">Rate</span>
                                                <div className="font-mono text-slate-700 mt-0.5">₹{l.invoice.rate?.toLocaleString('en-IN')}/{l.invoice.unit || 'BL'}</div>
                                              </div>
                                              <div>
                                                <span className="font-bold text-slate-400 uppercase tracking-widest">Base Amount</span>
                                                <div className="font-mono text-slate-700 mt-0.5">₹{l.invoice.amount?.toLocaleString('en-IN')}</div>
                                              </div>
                                              <div>
                                                <span className="font-bold text-slate-400 uppercase tracking-widest">{l.invoice.supplyType === 'INTER_STATE' ? `IGST ${l.invoice.gstPercent}%` : `GST ${l.invoice.gstPercent}%`}</span>
                                                <div className="font-mono text-slate-700 mt-0.5">₹{l.invoice.gstAmount?.toLocaleString('en-IN')}</div>
                                              </div>
                                              <div>
                                                <span className="font-bold text-slate-400 uppercase tracking-widest">Total</span>
                                                <div className="font-mono font-bold text-slate-800 mt-0.5">₹{l.invoice.totalAmount?.toLocaleString('en-IN')}</div>
                                              </div>
                                            </div>
                                            {/* Transport/Dispatch details from lifting */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-1.5 mb-2 pt-1 border-t border-slate-200">
                                              {l.rstNo && <div><span className="font-bold text-slate-400 uppercase tracking-widest">RST No</span><div className="font-mono text-slate-700 mt-0.5">{l.rstNo}</div></div>}
                                              {l.challanNo && <div><span className="font-bold text-slate-400 uppercase tracking-widest">DCH No</span><div className="font-mono text-slate-700 mt-0.5">{l.challanNo}</div></div>}
                                              <div><span className="font-bold text-slate-400 uppercase tracking-widest">Vehicle</span><div className="font-mono text-slate-700 mt-0.5">{l.vehicleNo}</div></div>
                                              {l.driverName && <div><span className="font-bold text-slate-400 uppercase tracking-widest">Driver</span><div className="text-slate-700 mt-0.5">{l.driverName}{l.driverPhone ? ` (${l.driverPhone})` : ''}</div></div>}
                                              {l.transporterName && <div><span className="font-bold text-slate-400 uppercase tracking-widest">Transporter</span><div className="text-slate-700 mt-0.5">{l.transporterName}</div></div>}
                                              {l.dispatchMode && <div><span className="font-bold text-slate-400 uppercase tracking-widest">Dispatched Via</span><div className="text-slate-700 mt-0.5">{l.dispatchMode}</div></div>}
                                              {l.productRatePerLtr && <div><span className="font-bold text-slate-400 uppercase tracking-widest">Product Rate</span><div className="font-mono text-slate-700 mt-0.5">₹{l.productRatePerLtr}/Ltr (Value: ₹{l.productValue?.toLocaleString('en-IN')})</div></div>}
                                            </div>
                                            {/* IRN/EWB details */}
                                            {(l.invoice.irn || l.invoice.ewbNo) && (
                                            <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 border-t border-slate-200">
                                              {l.invoice.irn && (
                                                <div><span className="font-bold text-slate-400 uppercase tracking-widest">IRN:</span> <span className="font-mono text-slate-600 break-all">{l.invoice.irn}</span></div>
                                              )}
                                              {l.invoice.ackNo && (
                                                <div><span className="font-bold text-slate-400 uppercase tracking-widest">Ack No:</span> <span className="font-mono text-slate-600">{l.invoice.ackNo}</span></div>
                                              )}
                                              {l.invoice.irnDate && (
                                                <div><span className="font-bold text-slate-400 uppercase tracking-widest">IRN Date:</span> <span className="font-mono text-slate-600">{new Date(l.invoice.irnDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
                                              )}
                                              {l.invoice.ewbNo && (
                                                <div><span className="font-bold text-slate-400 uppercase tracking-widest">EWB No:</span> <span className="font-mono text-slate-600">{l.invoice.ewbNo}</span></div>
                                              )}
                                              {l.invoice.ewbDate && (
                                                <div><span className="font-bold text-slate-400 uppercase tracking-widest">EWB Date:</span> <span className="font-mono text-slate-600">{new Date(l.invoice.ewbDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
                                              )}
                                            </div>
                                            )}
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                      </React.Fragment>
                                    ))}
                                  </tbody>
                                </table>
                                {/* Pagination */}
                                {detailLiftings.length > LIFTS_PER_PAGE && (
                                  <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 border-t border-slate-200">
                                    <span className="text-[10px] text-slate-500">
                                      Showing {((liftingPage - 1) * LIFTS_PER_PAGE) + 1}-{Math.min(liftingPage * LIFTS_PER_PAGE, detailLiftings.length)} of {detailLiftings.length}
                                    </span>
                                    <div className="flex gap-1">
                                      {Array.from({ length: Math.ceil(detailLiftings.length / LIFTS_PER_PAGE) }, (_, p) => (
                                        <button key={p} onClick={() => setLiftingPage(p + 1)}
                                          className={`px-2 py-0.5 text-[10px] font-medium border ${liftingPage === p + 1 ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                                          {p + 1}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
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
                  <label className={labelCls}>Contract No</label>
                  {editId ? (
                    <input type="text" value={form.contractNo} readOnly className={`${inputCls} bg-slate-100 text-slate-600`} />
                  ) : (
                    <div className={`${inputCls} bg-slate-50 text-slate-400 italic`}>Auto-generated on save</div>
                  )}
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
              <div className="grid grid-cols-4 gap-3">
                <div><label className={labelCls}>RST No</label><input type="text" value={liftForm.rstNo} onChange={e => setLiftForm(p => ({ ...p, rstNo: e.target.value }))} placeholder="e.g. 1053" className={inputCls} /></div>
                <div><label className={labelCls}>Challan No</label><input type="text" value={liftForm.challanNo} onChange={e => setLiftForm(p => ({ ...p, challanNo: e.target.value }))} className={inputCls} /></div>
                <div><label className={labelCls}>Product Rate (₹/Ltr)</label><input type="number" value={liftForm.productRatePerLtr} step="0.01" onChange={e => {
                  const r = e.target.value; const bl = parseFloat(liftForm.quantityBL) || 0;
                  setLiftForm(p => ({ ...p, productRatePerLtr: r, productValue: r ? String(Math.round(bl * parseFloat(r))) : '' }));
                }} placeholder="71.86" className={inputCls} /></div>
                <div><label className={labelCls}>Product Value</label><input type="number" value={liftForm.productValue} readOnly className="border border-slate-200 px-2.5 py-1.5 text-xs w-full bg-slate-50" /></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div><label className={labelCls}>Distance (km)</label><input type="number" value={liftForm.distanceKm} onChange={e => setLiftForm(p => ({ ...p, distanceKm: e.target.value }))} placeholder="for E-Way Bill" className={inputCls} /></div>
                <div><label className={labelCls}>Dispatch Mode</label>
                  <select value={liftForm.dispatchMode} onChange={e => setLiftForm(p => ({ ...p, dispatchMode: e.target.value }))} className={inputCls}>
                    <option value="TANKER">TANKER</option><option value="TRUCK">TRUCK</option><option value="PIPELINE">PIPELINE</option>
                  </select>
                </div>
                <div className="col-span-2"><label className={labelCls}>Remarks</label><input type="text" value={liftForm.remarks} onChange={e => setLiftForm(p => ({ ...p, remarks: e.target.value }))} className={inputCls} /></div>
              </div>

              {/* Consignee (Ship To) — collapsible */}
              <details className="border border-slate-200 bg-slate-50">
                <summary className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest cursor-pointer hover:bg-slate-100">
                  Ship To (Consignee) — if different from buyer
                </summary>
                <div className="p-3 pt-2 grid grid-cols-2 gap-3">
                  <div><label className={labelCls}>Consignee Name</label><input type="text" value={liftForm.consigneeName} onChange={e => setLiftForm(p => ({ ...p, consigneeName: e.target.value }))} className={inputCls} /></div>
                  <div><label className={labelCls}>Consignee GSTIN</label><input type="text" value={liftForm.consigneeGstin} onChange={e => setLiftForm(p => ({ ...p, consigneeGstin: e.target.value.toUpperCase() }))} maxLength={15} className={inputCls} /></div>
                  <div className="col-span-2"><label className={labelCls}>Consignee Address</label><input type="text" value={liftForm.consigneeAddress} onChange={e => setLiftForm(p => ({ ...p, consigneeAddress: e.target.value }))} className={inputCls} /></div>
                  <div><label className={labelCls}>State</label><input type="text" value={liftForm.consigneeState} onChange={e => setLiftForm(p => ({ ...p, consigneeState: e.target.value }))} className={inputCls} /></div>
                  <div><label className={labelCls}>Pincode</label><input type="text" value={liftForm.consigneePincode} onChange={e => setLiftForm(p => ({ ...p, consigneePincode: e.target.value }))} maxLength={6} className={inputCls} /></div>
                </div>
              </details>
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

      {/* E-INVOICE / E-WAY BILL GENERATION MODAL */}
      {ewbModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white shadow-2xl w-full max-w-lg mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide uppercase">Generate E-Invoice + E-Way Bill</h2>
              <button onClick={() => setEwbModal(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
                <div className="flex gap-6">
                  <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vehicle:</span> <span className="font-medium">{ewbForm.vehicleNo}</span></div>
                  {ewbModal.destination && <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Destination:</span> <span className="font-medium">{ewbModal.destination}</span></div>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Distance (km) *</label>
                  <input type="number" value={ewbForm.distanceKm} onChange={e => setEwbForm(p => ({ ...p, distanceKm: e.target.value }))}
                    placeholder="e.g. 900" className={inputCls} />
                  <div className="text-[9px] text-slate-400 mt-0.5">NIC validates against pincodes</div>
                </div>
                <div>
                  <label className={labelCls}>Vehicle No</label>
                  <input type="text" value={ewbForm.vehicleNo} onChange={e => setEwbForm(p => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))}
                    className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Transporter Name</label>
                  <input type="text" value={ewbForm.transporterName} onChange={e => setEwbForm(p => ({ ...p, transporterName: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Transporter GSTIN</label>
                  <input type="text" value={ewbForm.transporterGstin} onChange={e => setEwbForm(p => ({ ...p, transporterGstin: e.target.value.toUpperCase() }))}
                    placeholder="15-digit GSTIN" maxLength={15} className={inputCls} />
                </div>
              </div>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-xs">{error}</div>}
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => handleGenerateEInvoice(ewbModal.contractId, ewbModal.liftingId, ewbForm)}
                disabled={actionLoading === ewbModal.liftingId || !ewbForm.distanceKm}
                className="px-6 py-2 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {actionLoading === ewbModal.liftingId ? 'Generating...' : 'Generate E-Invoice + EWB'}
              </button>
              <button onClick={() => setEwbModal(null)} className="px-6 py-2 bg-slate-200 text-slate-800 text-[11px] font-medium hover:bg-slate-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* Truck Detail Modal */}
      {truckDetail && (() => {
        const t = truckDetail.truck;
        const c = truckDetail.contract;
        const rate = c.contractType === 'JOB_WORK' ? (c.conversionRate || 0) : (c.ethanolRate || 0);
        const amount = t.quantityBL ? t.quantityBL * rate : 0;
        const fmtTime = (d: string | null) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '--';
        const Row = ({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) => (
          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
            <span className={`text-xs text-slate-800 ${mono ? 'font-mono tabular-nums' : ''}`}>{value || '--'}</span>
          </div>
        );
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setTruckDetail(null)}>
            <div className="bg-white shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest">Truck Details</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{t.vehicleNo} | {c.contractNo}</div>
                </div>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                  t.status === 'GROSS_WEIGHED' ? 'border-green-400 bg-green-500 text-white' : 'border-orange-400 bg-orange-500 text-white'
                }`}>{t.status === 'GATE_IN' ? 'AT GATE' : t.status === 'TARE_WEIGHED' ? 'LOADING' : 'DISPATCHED'}</span>
              </div>
              <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
                {/* Quantity & Value */}
                <div className="border border-slate-200 p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Quantity & Value</div>
                  <Row label="Quantity (BL)" value={t.quantityBL ? t.quantityBL.toLocaleString() : null} mono />
                  <Row label="Quantity (KL)" value={t.quantityBL ? (t.quantityBL / 1000).toFixed(2) : null} mono />
                  <Row label="Strength" value={t.strength ? `${t.strength}%` : null} mono />
                  <Row label="Rate" value={rate ? `${rate}/${c.contractType === 'JOB_WORK' ? 'BL' : 'L'}` : null} mono />
                  <Row label="Amount" value={amount ? `₹${amount.toLocaleString('en-IN')}` : null} mono />
                  <Row label="Batch No" value={t.batchNo} />
                </div>
                {/* Weighment */}
                <div className="border border-slate-200 p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Weighment</div>
                  <Row label="Gross Weight" value={t.weightGross ? `${t.weightGross.toLocaleString()} kg` : null} mono />
                  <Row label="Tare Weight" value={t.weightTare ? `${t.weightTare.toLocaleString()} kg` : null} mono />
                  <Row label="Net Weight" value={t.weightNet ? `${t.weightNet.toLocaleString()} kg` : null} mono />
                </div>
                {/* Driver & Transport */}
                <div className="border border-slate-200 p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Driver & Transport</div>
                  <Row label="Driver" value={t.driverName} />
                  <Row label="Phone" value={t.driverPhone} />
                  <Row label="License (DL)" value={t.driverLicense} />
                  <Row label="Transporter" value={t.transporterName} />
                  <Row label="Destination" value={t.destination} />
                </div>
                {/* Documents & Compliance */}
                <div className="border border-slate-200 p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Documents & Compliance</div>
                  <Row label="RST No" value={t.rstNo} />
                  <Row label="Seal No" value={t.sealNo} />
                  <Row label="PESO Date" value={t.pesoDate} />
                  <Row label="Gate Pass No" value={t.gatePassNo} />
                  <Row label="Challan No" value={t.challanNo} />
                </div>
                {/* Timeline */}
                <div className="border border-slate-200 p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Timeline</div>
                  <Row label="Gate In" value={fmtTime(t.gateInTime)} />
                  <Row label="Tare Weighed" value={fmtTime(t.tareTime)} />
                  <Row label="Gross Weighed" value={fmtTime(t.grossTime)} />
                </div>
              </div>
              <div className="flex gap-3 p-4 border-t border-slate-200">
                {t.status === 'GROSS_WEIGHED' && (
                  <button
                    onClick={() => { setTruckDetail(null); handleRelease(t.id, c.id); }}
                    disabled={actionLoading === t.id}
                    className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-bold uppercase hover:bg-green-700 disabled:opacity-50">
                    {actionLoading === t.id ? 'Releasing...' : 'Release Truck'}
                  </button>
                )}
                <button onClick={() => setTruckDetail(null)} className="px-4 py-1.5 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default EthanolContracts;
