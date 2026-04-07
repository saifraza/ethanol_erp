import React, { useState, useEffect } from 'react';
import { FileText, Plus, X, Pencil, Truck, ChevronDown, Trash2, Upload, FileDown, Package } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface DispatchInvoice {
  id: string;
  invoiceNo: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
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
  irn?: string | null;
  irnStatus?: string | null;
  ackNo?: string | null;
  irnDate?: string | null;
  ewbNo?: string | null;
  ewbDate?: string | null;
  ewbStatus?: string | null;
}

interface Dispatch {
  id: string;
  dispatchDate: string;
  vehicleNo: string;
  driverName?: string;
  driverPhone?: string;
  transporterName?: string;
  destination?: string;
  bags: number;
  weightPerBag: number;
  weightGrossMT: number;
  weightTareMT: number;
  weightNetMT: number;
  rate: number;
  amount: number;
  distanceKm?: number;
  challanNo?: string;
  gatePassNo?: string;
  invoiceId?: string;
  invoice?: DispatchInvoice | null;
  status: string;
  remarks?: string;
}

interface Contract {
  id: string;
  contractNo: string;
  status: string;
  dealType: string;
  processingChargePerMT?: number | null;
  principalName?: string | null;
  customerId: string;
  buyerName: string;
  buyerAddress?: string;
  buyerGstin?: string;
  buyerState?: string;
  startDate: string;
  endDate: string;
  contractQtyMT: number;
  rate: number;
  gstPercent: number;
  paymentTermsDays?: number;
  paymentMode?: string;
  logisticsBy?: string;
  totalSuppliedMT: number;
  totalInvoicedAmt: number;
  totalReceivedAmt: number;
  remarks?: string;
  hasPdf?: boolean;
  autoGenerateEInvoice?: boolean;
  createdAt: string;
  dispatches?: Dispatch[];
}

interface SupplySummary {
  contractQtyMT: number;
  suppliedMT: number;
  remainingMT: number;
  progressPct: number;
  invoicedAmount: number;
  receivedAmount: number;
  outstanding: number;
  totalDispatches: number;
  daysRemaining: number;
}

interface Stats {
  total: number;
  active: number;
  totalContractQtyMT: number;
  totalSuppliedMT: number;
}

interface CustomerOption {
  id: string;
  name: string;
  address?: string;
  gstNo?: string;
  state?: string;
  phone?: string;
  email?: string;
}

const emptyForm = {
  contractNo: '', status: 'ACTIVE',
  dealType: 'FIXED_RATE', processingChargePerMT: '', principalName: '',
  customerId: '',
  buyerName: '', buyerAddress: '', buyerGstin: '', buyerState: '', buyerContact: '', buyerPhone: '', buyerEmail: '',
  supplyType: 'INTRA_STATE',
  startDate: '', endDate: '',
  contractQtyMT: '', rate: '', gstPercent: '5',
  paymentTermsDays: '', paymentMode: 'RTGS', logisticsBy: 'BUYER', remarks: '',
};

const emptyDispatchForm = {
  dispatchDate: new Date().toISOString().slice(0, 10),
  vehicleNo: '', driverName: '', driverPhone: '', transporterName: '', destination: '',
  bags: '', weightPerBag: '50', weightGrossMT: '', weightTareMT: '',
  rate: '', distanceKm: '', remarks: '',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-slate-50 text-slate-700 border-slate-300',
  ACTIVE: 'bg-green-50 text-green-700 border-green-300',
  EXPIRED: 'bg-red-50 text-red-700 border-red-300',
  TERMINATED: 'bg-red-100 text-red-800 border-red-400',
};

const DDGSContracts: React.FC = () => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, totalContractQtyMT: 0, totalSuppliedMT: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  const [dispatchContractId, setDispatchContractId] = useState<string | null>(null);
  const [dispatchForm, setDispatchForm] = useState({ ...emptyDispatchForm });
  const [dispatchSaving, setDispatchSaving] = useState(false);

  const [detailSummary, setDetailSummary] = useState<SupplySummary | null>(null);
  const [detailDispatches, setDetailDispatches] = useState<Dispatch[]>([]);
  const [activeTrucks, setActiveTrucks] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showIrnDetail, setShowIrnDetail] = useState<string | null>(null);
  const [dispatchPage, setDispatchPage] = useState(1);
  const ITEMS_PER_PAGE = 15;

  const [ewbModal, setEwbModal] = useState<{ contractId: string; dispatchId: string; vehicleNo: string; destination: string; transporterName: string; distanceKm: number } | null>(null);
  const [ewbForm, setEwbForm] = useState({ distanceKm: '', transporterName: '', transporterGstin: '', vehicleNo: '' });
  const [manualEwb, setManualEwb] = useState<{ dispatchId: string; ewbNo: string; file: File | null } | null>(null);

  useEffect(() => { fetchData(); fetchCustomers(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/ddgs-contracts');
      setContracts(res.data.contracts || []);
      setStats(res.data.stats || stats);
    } catch {
      setError('Failed to load contracts');
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      const res = await api.get('/customers');
      const list = Array.isArray(res.data) ? res.data : (res.data?.customers || []);
      setCustomers(list.map((c: any) => ({ id: c.id, name: c.name, address: c.address, gstNo: c.gstNo, state: c.state, phone: c.phone, email: c.email })));
    } catch { /* ignore */ }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'customerId') {
      const cust = customers.find(c => c.id === value);
      if (cust) {
        setForm(p => ({
          ...p, customerId: value,
          buyerName: cust.name || '', buyerAddress: cust.address || '',
          buyerGstin: cust.gstNo || '', buyerState: cust.state || '',
          buyerPhone: cust.phone || '', buyerEmail: cust.email || '',
        }));
        return;
      }
    }
    setForm(p => ({ ...p, [name]: value }));
  };

  const openCreate = () => { setEditId(null); setForm({ ...emptyForm }); setShowForm(true); };

  const openEdit = (c: Contract) => {
    setEditId(c.id);
    setForm({
      contractNo: c.contractNo, status: c.status,
      dealType: c.dealType || 'FIXED_RATE',
      processingChargePerMT: c.processingChargePerMT != null ? String(c.processingChargePerMT) : '',
      principalName: c.principalName || '',
      customerId: c.customerId,
      buyerName: c.buyerName || '', buyerAddress: c.buyerAddress || '',
      buyerGstin: c.buyerGstin || '', buyerState: c.buyerState || '',
      buyerContact: (c as any).buyerContact || '', buyerPhone: (c as any).buyerPhone || '', buyerEmail: (c as any).buyerEmail || '',
      supplyType: (c as any).supplyType || 'INTRA_STATE',
      startDate: c.startDate?.slice(0, 10) || '', endDate: c.endDate?.slice(0, 10) || '',
      contractQtyMT: String(c.contractQtyMT || ''), rate: String(c.rate || ''),
      gstPercent: String(c.gstPercent || '5'),
      paymentTermsDays: String(c.paymentTermsDays || ''), paymentMode: c.paymentMode || 'RTGS',
      logisticsBy: c.logisticsBy || 'BUYER', remarks: c.remarks || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.customerId) { setError('Please select a buyer'); return; }
    try {
      setSaving(true); setError('');
      if (editId) { await api.put(`/ddgs-contracts/${editId}`, form); }
      else { await api.post('/ddgs-contracts', form); }
      setShowForm(false); setEditId(null); fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contract?')) return;
    try { await api.delete(`/ddgs-contracts/${id}`); fetchData(); }
    catch (err: any) { setError(err?.response?.data?.error || 'Failed to delete'); }
  };

  const handleDispatchSubmit = async () => {
    if (!dispatchContractId) return;
    try {
      setDispatchSaving(true);
      await api.post(`/ddgs-contracts/${dispatchContractId}/dispatches`, dispatchForm);
      const cid = dispatchContractId;
      setDispatchContractId(null); setDispatchForm({ ...emptyDispatchForm }); fetchData();
      if (expanded === cid) loadSupplyDetail(cid);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to add dispatch');
    } finally { setDispatchSaving(false); }
  };

  const handleDeleteDispatch = async (dispatchId: string) => {
    if (!confirm('Delete this dispatch?')) return;
    try {
      await api.delete(`/ddgs-contracts/dispatches/${dispatchId}`);
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
        await api.post(`/ddgs-contracts/${contractId}/pdf`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        fetchData();
      } catch (err: any) { setError(err?.response?.data?.error || 'Failed to upload PDF'); }
    };
    input.click();
  };

  const viewPdf = (contractId: string) => { window.open(`/api/ddgs-contracts/${contractId}/pdf`, '_blank'); };

  const loadSupplyDetail = async (contractId: string) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/ddgs-contracts/${contractId}/supply-summary`);
      setDetailSummary(res.data.summary);
      setDetailDispatches(res.data.dispatches || []);
      setActiveTrucks(res.data.activeTrucks || []);
      setDispatchPage(1);
    } catch { setError('Failed to load supply details'); }
    finally { setDetailLoading(false); }
  };

  const handleExpand = (contractId: string) => {
    if (expanded === contractId) {
      setExpanded(null); setDetailSummary(null); setDetailDispatches([]); setActiveTrucks([]);
    } else {
      setExpanded(contractId); loadSupplyDetail(contractId);
    }
  };

  const handleCreateInvoice = async (contractId: string, dispatchId: string) => {
    try {
      setActionLoading(dispatchId);
      await api.post(`/ddgs-contracts/${contractId}/dispatches/${dispatchId}/create-invoice`);
      loadSupplyDetail(contractId);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to create invoice'); }
    finally { setActionLoading(null); }
  };

  const handleRelease = async (truckId: string, contractId: string) => {
    if (!confirm('Release this truck? This will create the invoice and dispatch record.')) return;
    try {
      setActionLoading(truckId);
      const res = await api.post(`/ddgs-contracts/${contractId}/release-truck/${truckId}`);
      const d = res.data;
      // Open invoice PDF
      if (d.invoiceId) {
        try {
          const r = await api.get(`/invoices/${d.invoiceId}/pdf`, { responseType: 'blob' });
          window.open(URL.createObjectURL(r.data), '_blank');
        } catch { /* non-critical */ }
      }
      loadSupplyDetail(contractId);
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to release truck'); }
    finally { setActionLoading(null); }
  };

  const openEwbModal = (contractId: string, d: Dispatch) => {
    const distKm = String(d.distanceKm || '');
    const transName = d.transporterName || '';
    if (distKm) {
      handleGenerateEInvoice(contractId, d.id, { distanceKm: distKm, transporterName: transName, transporterGstin: '', vehicleNo: d.vehicleNo });
      return;
    }
    setEwbModal({ contractId, dispatchId: d.id, vehicleNo: d.vehicleNo, destination: d.destination || '', transporterName: transName, distanceKm: d.distanceKm || 0 });
    setEwbForm({ distanceKm: distKm, transporterName: transName, transporterGstin: '', vehicleNo: d.vehicleNo });
  };

  const handleGenerateEInvoice = async (contractId: string, dispatchId: string, ewbData?: { distanceKm?: string; transporterName?: string; transporterGstin?: string; vehicleNo?: string }) => {
    try {
      setActionLoading(dispatchId);
      if (ewbData?.distanceKm || ewbData?.transporterName) {
        await api.put(`/ddgs-contracts/dispatches/${dispatchId}`, {
          distanceKm: ewbData.distanceKm || undefined,
          transporterName: ewbData.transporterName || undefined,
        });
      }
      await api.post(`/ddgs-contracts/${contractId}/dispatches/${dispatchId}/e-invoice`, {
        distanceKm: ewbData?.distanceKm || undefined,
        transporterGstin: ewbData?.transporterGstin || undefined,
      });
      setEwbModal(null);
      loadSupplyDetail(contractId);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to generate e-invoice'); }
    finally { setActionLoading(null); }
  };

  const handleSaveManualEwb = async (contractId: string, dispatchId: string) => {
    if (!manualEwb?.ewbNo.trim()) return;
    try {
      setActionLoading(dispatchId);
      const formData = new FormData();
      formData.append('ewbNo', manualEwb.ewbNo.trim());
      if (manualEwb.file) formData.append('ewbPdf', manualEwb.file);
      await api.patch(`/ddgs-contracts/${contractId}/dispatches/${dispatchId}/manual-ewb`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setManualEwb(null);
      loadSupplyDetail(contractId);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to save EWB'); }
    finally { setActionLoading(null); }
  };

  const handleToggleAutoEInvoice = async (contractId: string, enabled: boolean) => {
    try {
      await api.patch(`/ddgs-contracts/${contractId}/auto-einvoice`, { enabled });
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to toggle'); }
  };

  const pctUsed = (c: Contract) => c.contractQtyMT ? Math.round((c.totalSuppliedMT / c.contractQtyMT) * 100) : 0;
  const daysLeft = (c: Contract) => { const d = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000); return d > 0 ? d : 0; };
  const fmtMT = (n: number) => n.toFixed(2);
  const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

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
            <Package size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">DDGS Supply</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Contracts & Dispatch Tracking</span>
          </div>
          <button onClick={openCreate}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5">
            <Plus size={12} /> New Contract
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-slate-500 border-r border-slate-300 bg-white px-3 py-2.5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total</div>
            <div className="text-xl font-bold text-slate-800">{stats.total}</div>
          </div>
          <div className="border-l-4 border-l-green-500 border-r border-slate-300 bg-white px-3 py-2.5">
            <div className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-0.5">Active</div>
            <div className="text-xl font-bold text-green-700">{stats.active}</div>
          </div>
          <div className="border-l-4 border-l-indigo-500 border-r border-slate-300 bg-white px-3 py-2.5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Contract Qty</div>
            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{stats.totalContractQtyMT.toFixed(0)} <span className="text-xs font-normal text-slate-400">MT</span></div>
          </div>
          <div className="border-l-4 border-l-green-500 bg-white px-3 py-2.5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Supplied</div>
            <div className="text-lg font-bold text-green-700 font-mono tabular-nums">{stats.totalSuppliedMT.toFixed(0)} <span className="text-xs font-normal text-slate-400">MT</span></div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border-x border-b border-red-200 text-red-700 px-4 py-2 text-xs -mx-3 md:-mx-6">
            {error}<button onClick={() => setError('')} className="float-right text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}

        {/* Contract Table */}
        <div className="-mx-3 md:-mx-6 border-x border-slate-300">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Contract</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700 hidden md:table-cell">Buyer</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Status</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700 hidden md:table-cell">Rate /MT</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700 hidden md:table-cell">Supplied / Qty</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(c => {
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
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 hidden md:table-cell text-slate-700 font-medium">{c.buyerName}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColors[c.status] || 'bg-slate-50 text-slate-700 border-slate-300'}`}>{c.status}</span>
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right hidden md:table-cell font-mono tabular-nums font-bold">
                        {fmtINR(c.rate)}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right hidden md:table-cell">
                        <div className="font-mono tabular-nums">{c.totalSuppliedMT.toFixed(0)} / {c.contractQtyMT.toFixed(0)} MT</div>
                        {c.contractQtyMT > 0 && (
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
                          <button onClick={(e) => { e.stopPropagation(); const contract = contracts.find(x => x.id === c.id); setDispatchContractId(c.id); setDispatchForm({ ...emptyDispatchForm, destination: contract?.buyerAddress || '', rate: String(c.rate || '') }); }}
                            className="px-2 py-0.5 text-[10px] bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-medium flex items-center gap-0.5">
                            <Truck size={10} /> Dispatch
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
                        <td colSpan={6} className="bg-slate-50 border-b border-slate-300">
                          {detailLoading ? (
                            <div className="text-center py-8"><span className="text-xs text-slate-400 uppercase tracking-widest">Loading supply data...</span></div>
                          ) : detailSummary ? (
                            <div className="space-y-0">
                              {/* Supply Progress Bar */}
                              <div className="px-4 py-3 border-b border-slate-200 bg-white">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Supply Progress</span>
                                  <span className="text-xs font-bold font-mono tabular-nums text-slate-700">
                                    {fmtMT(detailSummary.suppliedMT)} / {detailSummary.contractQtyMT.toFixed(0)} MT
                                    <span className="text-slate-400 ml-1">({detailSummary.progressPct}%)</span>
                                  </span>
                                </div>
                                <div className="w-full h-2.5 bg-slate-200 overflow-hidden">
                                  <div className={`h-full transition-all ${detailSummary.progressPct >= 90 ? 'bg-green-500' : detailSummary.progressPct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
                                    style={{ width: `${Math.min(detailSummary.progressPct, 100)}%` }} />
                                </div>
                                <div className="flex justify-between mt-1 text-[10px] text-slate-400">
                                  <span>{fmtMT(detailSummary.remainingMT)} MT remaining</span>
                                  <span>{detailSummary.daysRemaining}d left</span>
                                </div>
                              </div>

                              {/* Document Pipeline KPIs */}
                              {(() => {
                                const withInvoice = detailDispatches.filter(d => d.invoice).length;
                                const withIRN = detailDispatches.filter(d => d.invoice?.irnStatus === 'GENERATED').length;
                                const withEWB = detailDispatches.filter(d => d.invoice?.ewbStatus === 'GENERATED').length;
                                const pending = detailDispatches.length - withInvoice;
                                return (
                                  <div className="grid grid-cols-2 md:grid-cols-6 border-b border-slate-200">
                                    {activeTrucks.length > 0 && (
                                    <div className="bg-orange-50 px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-orange-500">
                                      <div className="text-[10px] font-bold text-orange-600 uppercase tracking-widest">At Weighbridge</div>
                                      <div className="text-lg font-bold text-orange-700 font-mono tabular-nums mt-0.5">{activeTrucks.length}</div>
                                      <div className="text-[10px] text-orange-500 font-mono">{activeTrucks.map((t: any) => t.vehicleNo).join(', ')}</div>
                                    </div>
                                    )}
                                    <div className="bg-white px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-slate-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Dispatches</div>
                                      <div className="text-lg font-bold text-slate-800 font-mono tabular-nums mt-0.5">{detailSummary.totalDispatches}</div>
                                    </div>
                                    <div className="bg-white px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-blue-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Invoiced</div>
                                      <div className="text-lg font-bold text-blue-700 font-mono tabular-nums mt-0.5">{withInvoice} <span className="text-xs text-slate-400 font-normal">/ {detailSummary.totalDispatches}</span></div>
                                      {pending > 0 && <div className="text-[10px] text-red-500 font-medium">{pending} pending</div>}
                                    </div>
                                    <div className="bg-white px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-green-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">IRN Generated</div>
                                      <div className="text-lg font-bold text-green-700 font-mono tabular-nums mt-0.5">{withIRN} <span className="text-xs text-slate-400 font-normal">/ {withInvoice}</span></div>
                                    </div>
                                    <div className="bg-white px-4 py-2.5 border-r border-slate-200 border-l-4 border-l-green-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">E-Way Bill</div>
                                      <div className="text-lg font-bold text-green-700 font-mono tabular-nums mt-0.5">{withEWB} <span className="text-xs text-slate-400 font-normal">/ {withIRN}</span></div>
                                    </div>
                                    <div className="bg-white px-4 py-2.5 border-l-4 border-l-amber-500">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Outstanding</div>
                                      <div className="text-lg font-bold text-amber-700 font-mono tabular-nums mt-0.5">{fmtINR(detailSummary.outstanding)}</div>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Inline error */}
                              {error && (
                                <div className="bg-red-50 border-b border-red-200 text-red-700 px-4 py-2 text-xs flex items-center justify-between">
                                  <span>{error}</span>
                                  <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-2 font-bold">&times;</button>
                                </div>
                              )}

                              {/* Auto E-Invoice Toggle + Contract Info */}
                              <div className="px-4 py-2 bg-white border-b border-slate-200 flex items-center justify-between">
                                <div className="flex items-center gap-4 text-xs text-slate-500">
                                  {c.buyerGstin && <span><span className="text-[10px] font-bold uppercase tracking-widest">GST:</span> {c.buyerGstin}</span>}
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

                              {/* Dispatch History Table */}
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-slate-700 text-white">
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600">Date</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600">Vehicle</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-right border-r border-slate-600">Bags</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-right border-r border-slate-600">MT</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-right border-r border-slate-600">Amount</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center border-r border-slate-600">Status</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center border-r border-slate-600">Invoice</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center border-r border-slate-600">IRN</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center border-r border-slate-600">EWB</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {/* Active trucks at weighbridge (not yet released) */}
                                    {activeTrucks.map((t: any) => (
                                      <tr key={`truck-${t.id}`} className={`border-b border-orange-200 ${t.status === 'GROSS_WEIGHED' ? 'bg-green-50/80' : 'bg-orange-50/80'}`}>
                                        <td className="px-2 py-1.5 border-r border-orange-100 whitespace-nowrap">{t.gateInTime ? new Date(t.gateInTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 font-medium">{t.vehicleNo}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-right font-mono tabular-nums">{t.bags || '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-right font-mono tabular-nums">{t.weightNet > 0 ? t.weightNet.toFixed(2) : '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-right font-mono tabular-nums">{t.weightNet > 0 ? fmtINR(t.weightNet * c.rate) : '-'}</td>
                                        <td className="px-2 py-1.5 border-r border-orange-100 text-center">
                                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                            t.status === 'GROSS_WEIGHED' ? 'border-green-300 bg-green-100 text-green-700' : 'border-orange-300 bg-orange-100 text-orange-700'
                                          }`}>
                                            {t.status === 'GATE_IN' ? 'AT GATE' : t.status === 'TARE_WEIGHED' ? 'LOADING' : 'WEIGHED'}
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
                                    {detailDispatches.length === 0 && activeTrucks.length === 0 ? (
                                      <tr><td colSpan={10} className="text-center py-6 text-xs text-slate-400 uppercase tracking-widest">No dispatches yet</td></tr>
                                    ) : detailDispatches.slice((dispatchPage - 1) * ITEMS_PER_PAGE, dispatchPage * ITEMS_PER_PAGE).map((d, i) => (
                                      <React.Fragment key={d.id}>
                                      <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                        <td className="px-2 py-1.5 border-r border-slate-100 whitespace-nowrap">{new Date(d.dispatchDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 font-medium">{d.vehicleNo}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{d.bags}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmtMT(d.weightNetMT)}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmtINR(d.amount)}</td>
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                            d.status === 'DELIVERED' ? 'bg-green-50 text-green-700 border-green-200' :
                                            d.status === 'IN_TRANSIT' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                            'bg-blue-50 text-blue-700 border-blue-200'
                                          }`}>{d.status}</span>
                                        </td>
                                        {/* Invoice */}
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          {d.invoice ? (
                                            <button onClick={(e) => { e.stopPropagation(); setShowIrnDetail(showIrnDetail === d.id ? null : d.id); }} className="text-[10px] font-medium text-blue-700 underline hover:text-blue-900 cursor-pointer">INV-{d.invoice.invoiceNo}</button>
                                          ) : (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleCreateInvoice(c.id, d.id); }}
                                              disabled={actionLoading === d.id}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                                              {actionLoading === d.id ? '...' : 'Gen Invoice'}
                                            </button>
                                          )}
                                        </td>
                                        {/* IRN */}
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          {d.invoice?.irnStatus === 'GENERATED' ? (
                                            <button onClick={(e) => { e.stopPropagation(); setShowIrnDetail(showIrnDetail === d.id ? null : d.id); }}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer">IRN</button>
                                          ) : d.invoice ? (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); openEwbModal(c.id, d); }}
                                              disabled={actionLoading === d.id}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                              {actionLoading === d.id ? '...' : 'Gen'}
                                            </button>
                                          ) : (
                                            <span className="text-slate-300">--</span>
                                          )}
                                        </td>
                                        {/* EWB */}
                                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                          {d.invoice?.ewbStatus === 'GENERATED' && manualEwb?.dispatchId !== d.id ? (
                                            <button onClick={(e) => { e.stopPropagation(); setManualEwb({ dispatchId: d.id, ewbNo: d.invoice!.ewbNo || '', file: null }); }}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer" title={`${d.invoice.ewbNo || ''}`}>EWB</button>
                                          ) : (d.invoice?.irnStatus === 'GENERATED' || d.invoice?.ewbStatus === 'GENERATED') ? (
                                            manualEwb?.dispatchId === d.id ? (
                                              <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center gap-0.5">
                                                  <input type="text" value={manualEwb.ewbNo} onChange={e => setManualEwb({ ...manualEwb, ewbNo: e.target.value })}
                                                    placeholder="EWB No" className="border border-slate-300 px-1 py-0.5 text-[9px] w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveManualEwb(c.id, d.id); }} autoFocus />
                                                  <button onClick={() => handleSaveManualEwb(c.id, d.id)}
                                                    disabled={actionLoading === d.id}
                                                    className="text-[8px] font-bold px-1 py-0.5 border border-green-400 bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
                                                    {actionLoading === d.id ? '...' : 'OK'}</button>
                                                  <button onClick={() => setManualEwb(null)} className="text-[8px] px-0.5 text-slate-400 hover:text-slate-600">X</button>
                                                </div>
                                                <label className="flex items-center gap-1 text-[8px] text-slate-500 cursor-pointer">
                                                  <input type="file" accept=".pdf" className="hidden" onChange={e => setManualEwb({ ...manualEwb, file: e.target.files?.[0] || null })} />
                                                  <span className="border border-slate-300 px-1 py-0.5 bg-white hover:bg-slate-50">{manualEwb.file ? manualEwb.file.name.slice(0, 15) : 'Attach PDF'}</span>
                                                </label>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-0.5">
                                                <button onClick={(e) => { e.stopPropagation(); openEwbModal(c.id, d); }}
                                                  disabled={actionLoading === d.id}
                                                  className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                                  {actionLoading === d.id ? '...' : 'Gen'}
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); setManualEwb({ dispatchId: d.id, ewbNo: '', file: null }); }}
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
                                            {d.invoice && (
                                              <button onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                  const res = await api.get(`/invoices/${d.invoice!.id}/pdf`, { responseType: 'blob' });
                                                  window.open(URL.createObjectURL(res.data), '_blank');
                                                } catch { setError('Failed to load invoice PDF'); }
                                              }} className="text-[8px] font-bold uppercase px-1 py-0.5 border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" title="Print Invoice">INV</button>
                                            )}
                                            {d.invoice?.ewbNo && (
                                              <button onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                  const res = await api.get(`/ddgs-contracts/${c.id}/dispatches/${d.id}/ewb-pdf`, { responseType: 'blob' });
                                                  window.open(URL.createObjectURL(res.data), '_blank');
                                                } catch { setError('Failed to load EWB PDF'); }
                                              }} className="text-[8px] font-bold uppercase px-1 py-0.5 border border-green-300 bg-green-50 text-green-600 hover:bg-green-100" title="E-Way Bill PDF">EWB</button>
                                            )}
                                            {isSuperAdmin && <button onClick={(e) => { e.stopPropagation(); handleDeleteDispatch(d.id); }} className="text-red-300 hover:text-red-600"><Trash2 size={10} /></button>}
                                          </div>
                                        </td>
                                      </tr>
                                      {/* IRN/Invoice detail row */}
                                      {showIrnDetail === d.id && d.invoice && (
                                        <tr>
                                          <td colSpan={10} className="p-0 border-b-2 border-slate-300">
                                            <div className="bg-slate-800 text-white px-3 py-1.5 flex items-center justify-between">
                                              <span className="text-[10px] font-bold uppercase tracking-widest">Invoice: INV-{d.invoice.invoiceNo}</span>
                                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                                d.invoice.status === 'PAID' ? 'bg-green-900/50 text-green-300 border-green-600' :
                                                d.invoice.status === 'PARTIAL' ? 'bg-amber-900/50 text-amber-300 border-amber-600' :
                                                'bg-red-900/50 text-red-300 border-red-600'
                                              }`}>{d.invoice.status}</span>
                                            </div>
                                            <div className="bg-slate-50 px-3 py-2 text-[10px] border-l-4 border-l-blue-500">
                                              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-1.5 mb-2">
                                                <div>
                                                  <span className="font-bold text-slate-400 uppercase tracking-widest">Product</span>
                                                  <div className="font-medium text-slate-700 mt-0.5">DDGS</div>
                                                </div>
                                                <div>
                                                  <span className="font-bold text-slate-400 uppercase tracking-widest">Qty</span>
                                                  <div className="font-mono text-slate-700 mt-0.5">{d.invoice.quantity?.toLocaleString('en-IN')} MT</div>
                                                </div>
                                                <div>
                                                  <span className="font-bold text-slate-400 uppercase tracking-widest">Rate</span>
                                                  <div className="font-mono text-slate-700 mt-0.5">{fmtINR(d.invoice.rate)}/MT</div>
                                                </div>
                                                <div>
                                                  <span className="font-bold text-slate-400 uppercase tracking-widest">Base Amount</span>
                                                  <div className="font-mono text-slate-700 mt-0.5">{fmtINR(d.invoice.amount)}</div>
                                                </div>
                                                <div>
                                                  <span className="font-bold text-slate-400 uppercase tracking-widest">{d.invoice.supplyType === 'INTER_STATE' ? `IGST ${d.invoice.gstPercent}%` : `GST ${d.invoice.gstPercent}%`}</span>
                                                  <div className="font-mono text-slate-700 mt-0.5">{fmtINR(d.invoice.gstAmount)}</div>
                                                </div>
                                                <div>
                                                  <span className="font-bold text-slate-400 uppercase tracking-widest">Total</span>
                                                  <div className="font-mono font-bold text-slate-800 mt-0.5">{fmtINR(d.invoice.totalAmount)}</div>
                                                </div>
                                              </div>
                                              {/* Transport details */}
                                              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 mb-2 pt-1 border-t border-slate-200">
                                                <div><span className="font-bold text-slate-400 uppercase tracking-widest">Vehicle</span><div className="font-mono text-slate-700 mt-0.5">{d.vehicleNo}</div></div>
                                                {d.driverName && <div><span className="font-bold text-slate-400 uppercase tracking-widest">Driver</span><div className="text-slate-700 mt-0.5">{d.driverName}{d.driverPhone ? ` (${d.driverPhone})` : ''}</div></div>}
                                                {d.transporterName && <div><span className="font-bold text-slate-400 uppercase tracking-widest">Transporter</span><div className="text-slate-700 mt-0.5">{d.transporterName}</div></div>}
                                                {d.destination && <div><span className="font-bold text-slate-400 uppercase tracking-widest">Destination</span><div className="text-slate-700 mt-0.5">{d.destination}</div></div>}
                                              </div>
                                              {/* IRN/EWB details */}
                                              {(d.invoice.irn || d.invoice.ewbNo) && (
                                              <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 border-t border-slate-200">
                                                {d.invoice.irn && <div><span className="font-bold text-slate-400 uppercase tracking-widest">IRN:</span> <span className="font-mono text-slate-600 break-all">{d.invoice.irn}</span></div>}
                                                {d.invoice.ackNo && <div><span className="font-bold text-slate-400 uppercase tracking-widest">Ack No:</span> <span className="font-mono text-slate-600">{d.invoice.ackNo}</span></div>}
                                                {d.invoice.irnDate && <div><span className="font-bold text-slate-400 uppercase tracking-widest">IRN Date:</span> <span className="font-mono text-slate-600">{new Date(d.invoice.irnDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>}
                                                {d.invoice.ewbNo && <div><span className="font-bold text-slate-400 uppercase tracking-widest">EWB No:</span> <span className="font-mono text-slate-600">{d.invoice.ewbNo}</span></div>}
                                                {d.invoice.ewbDate && <div><span className="font-bold text-slate-400 uppercase tracking-widest">EWB Date:</span> <span className="font-mono text-slate-600">{new Date(d.invoice.ewbDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>}
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
                                {detailDispatches.length > ITEMS_PER_PAGE && (
                                  <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 border-t border-slate-200">
                                    <span className="text-[10px] text-slate-500">
                                      Showing {((dispatchPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(dispatchPage * ITEMS_PER_PAGE, detailDispatches.length)} of {detailDispatches.length}
                                    </span>
                                    <div className="flex gap-1">
                                      {Array.from({ length: Math.ceil(detailDispatches.length / ITEMS_PER_PAGE) }, (_, p) => (
                                        <button key={p} onClick={() => setDispatchPage(p + 1)}
                                          className={`px-2 py-0.5 text-[10px] font-medium border ${dispatchPage === p + 1 ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
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
              {contracts.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12">
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
              <h2 className="text-sm font-bold tracking-wide uppercase">{editId ? 'Edit Contract' : 'New DDGS Contract'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Contract No + Deal Type + Status */}
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>Contract No</label>
                  {editId ? (
                    <input type="text" value={form.contractNo} readOnly className={`${inputCls} bg-slate-100 text-slate-600`} />
                  ) : (
                    <div className={`${inputCls} bg-slate-50 text-slate-400 italic`}>Auto-generated on save</div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Deal Type *</label>
                  <select name="dealType" value={form.dealType} onChange={handleFormChange} className={inputCls}>
                    <option value="FIXED_RATE">Fixed Rate</option>
                    <option value="JOB_WORK">Job Work</option>
                    <option value="SPOT">Spot Sale</option>
                  </select>
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
                <div>
                  <label className={labelCls}>Select from Customer Master</label>
                  <select name="customerId" value={form.customerId} onChange={handleFormChange} className={inputCls}>
                    <option value="">Select Buyer (auto-fills below)</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.gstNo ? ` (${c.gstNo})` : ''}</option>)}
                  </select>
                </div>
              </div>

              {/* Job Work fields (only when dealType = JOB_WORK) */}
              {form.dealType === 'JOB_WORK' && (
                <div className="bg-amber-50 p-4 border border-amber-200">
                  <h3 className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-3">Job Work Details</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Principal Name *</label><input type="text" name="principalName" value={form.principalName} onChange={handleFormChange} className={inputCls} /></div>
                    <div><label className={labelCls}>Processing Charge per MT (Rs) *</label><input type="number" name="processingChargePerMT" value={form.processingChargePerMT} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                  </div>
                </div>
              )}

              {/* Buyer Details */}
              <div className="bg-slate-50 p-4 border border-slate-200">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Buyer Details</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className={labelCls}>Name *</label><input type="text" name="buyerName" value={form.buyerName} onChange={handleFormChange} required className={inputCls} /></div>
                  <div><label className={labelCls}>GSTIN</label><input type="text" name="buyerGstin" value={form.buyerGstin} onChange={handleFormChange} maxLength={15} className={inputCls} /></div>
                  <div><label className={labelCls}>Contact Person</label><input type="text" name="buyerContact" value={form.buyerContact} onChange={handleFormChange} className={inputCls} /></div>
                  <div><label className={labelCls}>Phone</label><input type="text" name="buyerPhone" value={form.buyerPhone} onChange={handleFormChange} className={inputCls} /></div>
                  <div><label className={labelCls}>Email</label><input type="text" name="buyerEmail" value={form.buyerEmail} onChange={handleFormChange} className={inputCls} /></div>
                  <div><label className={labelCls}>State</label><input type="text" name="buyerState" value={form.buyerState} onChange={handleFormChange} className={inputCls} /></div>
                  <div className="col-span-3"><label className={labelCls}>Address</label><input type="text" name="buyerAddress" value={form.buyerAddress} onChange={handleFormChange} className={inputCls} /></div>
                </div>
              </div>

              {/* Pricing */}
              <div className="bg-emerald-50 p-4 border border-emerald-200">
                <h3 className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest mb-3">Pricing</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className={labelCls}>Rate per MT (Rs) *</label><input type="number" name="rate" value={form.rate} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                  <div><label className={labelCls}>GST %</label><input type="number" name="gstPercent" value={form.gstPercent} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                  <div><label className={labelCls}>Supply Type</label>
                    <select name="supplyType" value={form.supplyType} onChange={handleFormChange} className={inputCls}>
                      <option value="INTRA_STATE">Intra State</option>
                      <option value="INTER_STATE">Inter State</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Duration, Qty, Logistics */}
              <div className="grid grid-cols-4 gap-3">
                <div><label className={labelCls}>Start Date *</label><input type="date" name="startDate" value={form.startDate} onChange={handleFormChange} required className={inputCls} /></div>
                <div><label className={labelCls}>End Date *</label><input type="date" name="endDate" value={form.endDate} onChange={handleFormChange} required className={inputCls} /></div>
                <div><label className={labelCls}>Total Qty (MT) *</label><input type="number" name="contractQtyMT" value={form.contractQtyMT} onChange={handleFormChange} step="0.01" className={inputCls} /></div>
                <div><label className={labelCls}>Payment Terms (Days)</label><input type="number" name="paymentTermsDays" value={form.paymentTermsDays} onChange={handleFormChange} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div><label className={labelCls}>Payment Mode</label>
                  <select name="paymentMode" value={form.paymentMode} onChange={handleFormChange} className={inputCls}>
                    <option value="RTGS">RTGS</option>
                    <option value="NEFT">NEFT</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
                <div><label className={labelCls}>Logistics By</label>
                  <select name="logisticsBy" value={form.logisticsBy} onChange={handleFormChange} className={inputCls}>
                    <option value="BUYER">Buyer</option>
                    <option value="SELLER">Seller (Us)</option>
                  </select>
                </div>
                <div className="col-span-2"><label className={labelCls}>Remarks</label><textarea name="remarks" value={form.remarks} onChange={handleFormChange} rows={2} className={inputCls} /></div>
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

      {/* NEW DISPATCH MODAL */}
      {dispatchContractId && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-6">
          <div className="bg-white shadow-2xl w-full max-w-3xl mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide uppercase">Record DDGS Dispatch</h2>
              <button onClick={() => setDispatchContractId(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Dispatch Date *</label>
                  <input type="date" name="dispatchDate" value={dispatchForm.dispatchDate} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Vehicle No *</label>
                  <input type="text" name="vehicleNo" value={dispatchForm.vehicleNo} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} placeholder="MP 20 XX 1234" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Destination</label>
                  <input type="text" name="destination" value={dispatchForm.destination} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>Driver Name</label>
                  <input type="text" name="driverName" value={dispatchForm.driverName} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Driver Phone</label>
                  <input type="text" name="driverPhone" value={dispatchForm.driverPhone} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Transporter</label>
                  <input type="text" name="transporterName" value={dispatchForm.transporterName} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Distance (KM)</label>
                  <input type="number" name="distanceKm" value={dispatchForm.distanceKm} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} className={inputCls} />
                </div>
              </div>

              <div className="bg-slate-50 p-4 border border-slate-200">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Weight Details</h3>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <label className={labelCls}>Bags</label>
                    <input type="number" name="bags" value={dispatchForm.bags} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Weight/Bag (kg)</label>
                    <input type="number" name="weightPerBag" value={dispatchForm.weightPerBag} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} step="0.1" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Gross (MT)</label>
                    <input type="number" name="weightGrossMT" value={dispatchForm.weightGrossMT} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} step="0.001" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Tare (MT)</label>
                    <input type="number" name="weightTareMT" value={dispatchForm.weightTareMT} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} step="0.001" className={inputCls} />
                  </div>
                </div>
                {dispatchForm.weightGrossMT && dispatchForm.weightTareMT && (
                  <div className="mt-2 text-xs font-mono font-bold text-slate-700">
                    Net: {(parseFloat(dispatchForm.weightGrossMT) - parseFloat(dispatchForm.weightTareMT)).toFixed(3)} MT
                  </div>
                )}
                {!dispatchForm.weightGrossMT && dispatchForm.bags && dispatchForm.weightPerBag && (
                  <div className="mt-2 text-xs font-mono text-slate-500">
                    Estimated: {(parseInt(dispatchForm.bags) * parseFloat(dispatchForm.weightPerBag) / 1000).toFixed(3)} MT (bags x weight/bag)
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Rate per MT</label>
                  <input type="number" name="rate" value={dispatchForm.rate} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} step="0.01" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Remarks</label>
                  <input type="text" name="remarks" value={dispatchForm.remarks} onChange={e => setDispatchForm(p => ({ ...p, [e.target.name]: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200">
              <button onClick={() => setDispatchContractId(null)} className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={handleDispatchSubmit} disabled={dispatchSaving}
                className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {dispatchSaving ? 'Saving...' : 'Record Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EWB GENERATION MODAL */}
      {ewbModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white shadow-2xl w-full max-w-md mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide uppercase">Generate E-Invoice + EWB</h2>
              <button onClick={() => setEwbModal(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>Vehicle No</label>
                <input type="text" value={ewbForm.vehicleNo} onChange={e => setEwbForm(p => ({ ...p, vehicleNo: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Distance (KM) *</label>
                <input type="number" value={ewbForm.distanceKm} onChange={e => setEwbForm(p => ({ ...p, distanceKm: e.target.value }))} className={inputCls} autoFocus />
              </div>
              <div>
                <label className={labelCls}>Transporter Name</label>
                <input type="text" value={ewbForm.transporterName} onChange={e => setEwbForm(p => ({ ...p, transporterName: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Transporter GSTIN</label>
                <input type="text" value={ewbForm.transporterGstin} onChange={e => setEwbForm(p => ({ ...p, transporterGstin: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200">
              <button onClick={() => setEwbModal(null)} className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={() => handleGenerateEInvoice(ewbModal.contractId, ewbModal.dispatchId, ewbForm)}
                disabled={actionLoading === ewbModal.dispatchId}
                className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {actionLoading === ewbModal.dispatchId ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DDGSContracts;
