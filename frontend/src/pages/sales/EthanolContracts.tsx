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
  createdAt: string;
  liftings?: Lifting[];
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
  status: string;
  deliveredQtyKL?: number;
  shortageKL?: number;
  omcReceiptNo?: string;
  remarks?: string;
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
  JOB_WORK: 'bg-amber-100 text-amber-800 border-amber-300',
  FIXED_PRICE: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  OMC: 'bg-blue-100 text-blue-800 border-blue-300',
};
const typeIcons: Record<string, any> = { JOB_WORK: Factory, FIXED_PRICE: Building2, OMC: Landmark };
const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700', ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-red-100 text-red-700', TERMINATED: 'bg-red-200 text-red-800',
};
const omcOptions = ['IOCL', 'BPCL', 'HPCL', 'JioBP', 'Nayara'];

const EthanolContracts: React.FC = () => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, jobWork: 0, fixedPrice: 0, omc: 0, totalContractQtyKL: 0, totalSuppliedKL: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Contract form
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // Lifting form
  const [liftingContractId, setLiftingContractId] = useState<string | null>(null);
  const [liftForm, setLiftForm] = useState({ ...emptyLiftingForm });
  const [liftSaving, setLiftSaving] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/ethanol-contracts');
      setContracts(res.data.contracts || []);
      setStats(res.data.stats || stats);
    } catch (err) {
      setError('Failed to load contracts');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
  };

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

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
      setSaving(true);
      setError('');
      if (editId) {
        await api.put(`/ethanol-contracts/${editId}`, form);
      } else {
        await api.post('/ethanol-contracts', form);
      }
      setShowForm(false);
      setEditId(null);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contract?')) return;
    try {
      await api.delete(`/ethanol-contracts/${id}`);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to delete');
    }
  };

  const handleLiftingSubmit = async () => {
    if (!liftingContractId) return;
    try {
      setLiftSaving(true);
      await api.post(`/ethanol-contracts/${liftingContractId}/liftings`, liftForm);
      setLiftingContractId(null);
      setLiftForm({ ...emptyLiftingForm });
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to add lifting');
    } finally {
      setLiftSaving(false);
    }
  };

  const handleDeleteLifting = async (liftingId: string) => {
    if (!confirm('Delete this lifting?')) return;
    try {
      await api.delete(`/ethanol-contracts/liftings/${liftingId}`);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to delete');
    }
  };

  const handlePdfUpload = async (contractId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append('pdf', file);
        await api.post(`/ethanol-contracts/${contractId}/pdf`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        fetchData();
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to upload PDF');
      }
    };
    input.click();
  };

  const viewPdf = (contractId: string) => {
    window.open(`/api/ethanol-contracts/${contractId}/pdf`, '_blank');
  };

  const filtered = typeFilter === 'ALL' ? contracts : contracts.filter(c => c.contractType === typeFilter);

  const pctUsed = (c: Contract) => c.contractQtyKL ? Math.round((c.totalSuppliedKL / c.contractQtyKL) * 100) : 0;
  const daysLeft = (c: Contract) => {
    const d = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000);
    return d > 0 ? d : 0;
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="text-lg text-gray-600">Loading...</div></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-700 to-green-800 text-white p-6 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Fuel size={32} />
            <div>
              <h1 className="text-3xl font-bold">Ethanol Supply</h1>
              <p className="text-green-200 text-sm mt-1">Contracts, Liftings & Tracking</p>
            </div>
          </div>
          <button onClick={openCreate} className="px-5 py-2 bg-white text-green-800 rounded-lg font-semibold hover:bg-green-50 transition-colors flex items-center gap-2">
            <Plus size={18} /> New Contract
          </button>
        </div>
      </div>

      <div className="p-6">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}<button onClick={() => setError('')} className="float-right text-red-400 hover:text-red-600">&times;</button></div>}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <div className="bg-white rounded-lg shadow p-4"><div className="text-gray-500 text-xs font-semibold uppercase">Total</div><div className="text-2xl font-bold mt-1">{stats.total}</div></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="text-green-600 text-xs font-semibold uppercase">Active</div><div className="text-2xl font-bold text-green-700 mt-1">{stats.active}</div></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="text-amber-600 text-xs font-semibold uppercase">Job Work</div><div className="text-2xl font-bold text-amber-700 mt-1">{stats.jobWork}</div></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="text-emerald-600 text-xs font-semibold uppercase">Fixed Price</div><div className="text-2xl font-bold text-emerald-700 mt-1">{stats.fixedPrice}</div></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="text-blue-600 text-xs font-semibold uppercase">OMC</div><div className="text-2xl font-bold text-blue-700 mt-1">{stats.omc}</div></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="text-gray-500 text-xs font-semibold uppercase">Contract Qty</div><div className="text-xl font-bold mt-1">{stats.totalContractQtyKL.toFixed(0)} <span className="text-sm font-normal text-gray-400">KL</span></div></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="text-gray-500 text-xs font-semibold uppercase">Supplied</div><div className="text-xl font-bold text-green-700 mt-1">{stats.totalSuppliedKL.toFixed(0)} <span className="text-sm font-normal text-gray-400">KL</span></div></div>
        </div>

        {/* Type filter tabs */}
        <div className="flex gap-2 mb-6 border-b">
          {['ALL', 'JOB_WORK', 'FIXED_PRICE', 'OMC'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${typeFilter === t ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'ALL' ? 'All' : typeLabels[t]}
            </button>
          ))}
        </div>

        {/* Contract cards */}
        <div className="space-y-4">
          {filtered.map(c => {
            const Icon = typeIcons[c.contractType] || FileText;
            const isExpanded = expanded === c.id;
            const pct = pctUsed(c);
            const days = daysLeft(c);

            return (
              <div key={c.id} className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
                {/* Card header */}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`p-2.5 rounded-lg ${c.contractType === 'JOB_WORK' ? 'bg-amber-50' : c.contractType === 'OMC' ? 'bg-blue-50' : 'bg-emerald-50'}`}>
                        <Icon size={22} className={c.contractType === 'JOB_WORK' ? 'text-amber-600' : c.contractType === 'OMC' ? 'text-blue-600' : 'text-emerald-600'} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-lg font-bold text-gray-900">{c.contractNo}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeColors[c.contractType]}`}>{typeLabels[c.contractType]}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[c.status] || 'bg-gray-100 text-gray-700'}`}>{c.status}</span>
                        </div>
                        <div className="text-sm text-gray-700 font-medium mt-0.5">{c.buyerName}</div>
                        {c.omcName && <div className="text-xs text-blue-600 mt-0.5">{c.omcName} — {c.omcDepot || 'No depot'}</div>}
                        {c.principalName && <div className="text-xs text-amber-600 mt-0.5">Principal: {c.principalName}</div>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-gray-400 uppercase font-semibold">Rate</div>
                      <div className="text-lg font-bold text-gray-900">
                        {c.contractType === 'JOB_WORK' ? `₹${c.conversionRate || 0}/BL` : `₹${c.ethanolRate || 0}/L`}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1">
                        {new Date(c.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} — {new Date(c.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {c.contractQtyKL && c.contractQtyKL > 0 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-500">{c.totalSuppliedKL.toFixed(0)} / {c.contractQtyKL.toFixed(0)} KL supplied</span>
                        <span className="font-semibold text-gray-700">{pct}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2.5">
                        <div className={`h-2.5 rounded-full transition-all ${pct >= 90 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Quick stats row */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                    <div className="flex gap-4 text-xs">
                      {c.dailyTargetKL && <span className="text-gray-500">Daily: <b className="text-gray-700">{c.dailyTargetKL} KL</b></span>}
                      {c.paymentTermsDays && <span className="text-gray-500">Pay: <b className="text-gray-700">{c.paymentTermsDays}d</b></span>}
                      <span className="text-gray-500">Days left: <b className={days <= 30 ? 'text-red-600' : 'text-gray-700'}>{days}</b></span>
                      {c.liftings && c.liftings.length > 0 && (
                        <span className="text-gray-500">Liftings: <b className="text-gray-700">{c.liftings.length}</b></span>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      {c.hasPdf ? (
                        <button onClick={() => viewPdf(c.id)}
                          className="px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium flex items-center gap-1"
                          title={c.contractPdfName || 'View PDF'}>
                          <FileDown size={12} /> PDF
                        </button>
                      ) : (
                        <button onClick={() => handlePdfUpload(c.id)}
                          className="px-3 py-1 text-xs bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 font-medium flex items-center gap-1">
                          <Upload size={12} /> PDF
                        </button>
                      )}
                      <button onClick={() => { setLiftingContractId(c.id); setLiftForm({ ...emptyLiftingForm, destination: c.omcDepot || '' }); }}
                        className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium flex items-center gap-1">
                        <Truck size={12} /> Lifting
                      </button>
                      <button onClick={() => openEdit(c)} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><Pencil size={12} /></button>
                      <button onClick={() => setExpanded(isExpanded ? null : c.id)} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {c.status === 'DRAFT' && <button onClick={() => handleDelete(c.id)} className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><Trash2 size={12} /></button>}
                    </div>
                  </div>
                </div>

                {/* Expanded: lifting history */}
                {isExpanded && (
                  <div className="border-t bg-gray-50 px-5 py-4">
                    <h4 className="text-sm font-bold text-gray-700 mb-3">Recent Liftings</h4>
                    {c.liftings && c.liftings.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 border-b">
                              <th className="text-left py-1.5 font-semibold">Date</th>
                              <th className="text-left py-1.5 font-semibold">Vehicle</th>
                              <th className="text-left py-1.5 font-semibold">Destination</th>
                              <th className="text-right py-1.5 font-semibold">Qty (BL)</th>
                              <th className="text-right py-1.5 font-semibold">Qty (KL)</th>
                              <th className="text-right py-1.5 font-semibold">Amount</th>
                              <th className="text-center py-1.5 font-semibold">Status</th>
                              <th className="text-center py-1.5 font-semibold">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.liftings.map(l => (
                              <tr key={l.id} className="border-b border-gray-100 hover:bg-white">
                                <td className="py-1.5">{new Date(l.liftingDate).toLocaleDateString('en-IN')}</td>
                                <td className="py-1.5 font-medium">{l.vehicleNo}</td>
                                <td className="py-1.5">{l.destination || '-'}</td>
                                <td className="py-1.5 text-right font-medium">{l.quantityBL.toLocaleString()}</td>
                                <td className="py-1.5 text-right">{l.quantityKL.toFixed(2)}</td>
                                <td className="py-1.5 text-right">₹{(l.amount || 0).toLocaleString()}</td>
                                <td className="py-1.5 text-center">
                                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${l.status === 'DELIVERED' ? 'bg-green-100 text-green-700' : l.status === 'SHORTAGE' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {l.status}
                                  </span>
                                </td>
                                <td className="py-1.5 text-center">
                                  <button onClick={() => handleDeleteLifting(l.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-gray-400 text-sm text-center py-4">No liftings yet</div>
                    )}

                    {/* Contract details */}
                    <div className="mt-4 pt-3 border-t border-gray-200">
                      <h4 className="text-sm font-bold text-gray-700 mb-2">Contract Details</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        {c.buyerGst && <div><span className="text-gray-400">GST:</span> <span className="font-medium">{c.buyerGst}</span></div>}
                        {c.buyerContact && <div><span className="text-gray-400">Contact:</span> <span className="font-medium">{c.buyerContact}</span></div>}
                        {c.buyerPhone && <div><span className="text-gray-400">Phone:</span> <span className="font-medium">{c.buyerPhone}</span></div>}
                        {c.gstPercent && <div><span className="text-gray-400">GST%:</span> <span className="font-medium">{c.gstPercent}%</span></div>}
                        {c.supplyType && <div><span className="text-gray-400">Supply:</span> <span className="font-medium">{c.supplyType === 'INTRA_STATE' ? 'Intra' : 'Inter'}</span></div>}
                        {c.logisticsBy && <div><span className="text-gray-400">Logistics:</span> <span className="font-medium">{c.logisticsBy}</span></div>}
                        {c.tankerCapacityKL && <div><span className="text-gray-400">Tanker:</span> <span className="font-medium">{c.tankerCapacityKL} KL</span></div>}
                        {c.contractType === 'JOB_WORK' && (
                          <>
                            {c.ethanolBenchmark && <div><span className="text-gray-400">Ethanol Yield:</span> <span className="font-medium">{c.ethanolBenchmark} BL/T</span></div>}
                            {c.ddgsBenchmark && <div><span className="text-gray-400">DDGS Yield:</span> <span className="font-medium">{c.ddgsBenchmark} kg/BL</span></div>}
                            {c.ddgsRate && <div><span className="text-gray-400">DDGS Rate:</span> <span className="font-medium">₹{c.ddgsRate}/kg</span></div>}
                          </>
                        )}
                        {c.totalInvoicedAmt > 0 && <div><span className="text-gray-400">Invoiced:</span> <span className="font-medium">₹{c.totalInvoicedAmt.toLocaleString()}</span></div>}
                        {c.remarks && <div className="col-span-2"><span className="text-gray-400">Remarks:</span> <span className="font-medium">{c.remarks}</span></div>}
                      </div>
                      {/* PDF Attachment */}
                      <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-3">
                        <span className="text-xs text-gray-400 font-semibold">Contract PDF:</span>
                        {c.hasPdf ? (
                          <>
                            <button onClick={() => viewPdf(c.id)} className="text-xs text-purple-600 hover:underline font-medium flex items-center gap-1">
                              <FileDown size={12} /> {c.contractPdfName || 'View PDF'}
                            </button>
                            <button onClick={() => handlePdfUpload(c.id)} className="text-xs text-gray-400 hover:text-gray-600">Replace</button>
                          </>
                        ) : (
                          <button onClick={() => handlePdfUpload(c.id)} className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1">
                            <Upload size={12} /> Upload PDF
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <Fuel size={48} className="mx-auto text-gray-300 mb-3" />
              <div className="text-gray-400 text-lg">No contracts found</div>
              <button onClick={openCreate} className="mt-3 text-green-600 font-medium hover:underline">Create your first contract</button>
            </div>
          )}
        </div>
      </div>

      {/* ── CREATE/EDIT CONTRACT MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-6">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-xl font-bold text-gray-900">{editId ? 'Edit Contract' : 'New Ethanol Contract'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
            </div>
            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Type + Status + Contract No */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract Type *</label>
                  <select name="contractType" value={form.contractType} onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500">
                    <option value="JOB_WORK">Job Work (3rd Party Mfg)</option>
                    <option value="FIXED_PRICE">Fixed Price Party</option>
                    <option value="OMC">OMC Direct</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract No *</label>
                  <input type="text" name="contractNo" value={form.contractNo} onChange={handleFormChange} required placeholder="e.g. SMPPL/2025-26/387"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select name="status" value={form.status} onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500">
                    <option value="DRAFT">Draft</option>
                    <option value="ACTIVE">Active</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="TERMINATED">Terminated</option>
                  </select>
                </div>
              </div>

              {/* Buyer details */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="text-sm font-bold text-gray-700 mb-3">
                  {form.contractType === 'JOB_WORK' ? 'Principal (Grain Owner)' : form.contractType === 'OMC' ? 'OMC / Buyer' : 'Buyer'}
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                    <input type="text" name="buyerName" value={form.buyerName} onChange={handleFormChange} required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">GST No</label>
                    <input type="text" name="buyerGst" value={form.buyerGst} onChange={handleFormChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Contact Person</label>
                    <input type="text" name="buyerContact" value={form.buyerContact} onChange={handleFormChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                    <input type="text" name="buyerPhone" value={form.buyerPhone} onChange={handleFormChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                    <input type="text" name="buyerEmail" value={form.buyerEmail} onChange={handleFormChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                    <input type="text" name="buyerAddress" value={form.buyerAddress} onChange={handleFormChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                  </div>
                </div>
              </div>

              {/* OMC-specific */}
              {form.contractType === 'OMC' && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="text-sm font-bold text-blue-700 mb-3">OMC Details</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">OMC Company *</label>
                      <select name="omcName" value={form.omcName} onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                        <option value="">Select OMC</option>
                        {omcOptions.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Depot / Location</label>
                      <input type="text" name="omcDepot" value={form.omcDepot} onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Allocation (KL)</label>
                      <input type="number" name="allocationQtyKL" value={form.allocationQtyKL} onChange={handleFormChange} step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
              )}

              {/* Job Work-specific */}
              {form.contractType === 'JOB_WORK' && (
                <div className="bg-amber-50 p-4 rounded-lg">
                  <h3 className="text-sm font-bold text-amber-700 mb-3">Job Work Terms</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Conversion Rate (₹/BL)</label>
                      <input type="number" name="conversionRate" value={form.conversionRate} onChange={handleFormChange} step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">DDGS Rate (₹/kg)</label>
                      <input type="number" name="ddgsRate" value={form.ddgsRate} onChange={handleFormChange} step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">PRC Penalty (₹/BL)</label>
                      <input type="number" name="prcPenalty" value={form.prcPenalty} onChange={handleFormChange} step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Ethanol Yield (BL/1000kg)</label>
                      <input type="number" name="ethanolBenchmark" value={form.ethanolBenchmark} onChange={handleFormChange} step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">DDGS Yield (kg/BL)</label>
                      <input type="number" name="ddgsBenchmark" value={form.ddgsBenchmark} onChange={handleFormChange} step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Principal Name</label>
                      <input type="text" name="principalName" value={form.principalName} onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" />
                    </div>
                  </div>
                </div>
              )}

              {/* Fixed Price / OMC rate */}
              {(form.contractType === 'FIXED_PRICE' || form.contractType === 'OMC') && (
                <div className="bg-emerald-50 p-4 rounded-lg">
                  <h3 className="text-sm font-bold text-emerald-700 mb-3">Pricing</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Ethanol Rate (₹/Litre) *</label>
                      <input type="number" name="ethanolRate" value={form.ethanolRate} onChange={handleFormChange} step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">GST %</label>
                      <input type="number" name="gstPercent" value={form.gstPercent} onChange={handleFormChange} step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Supply Type</label>
                      <select name="supplyType" value={form.supplyType} onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500">
                        <option value="INTRA_STATE">Intra State</option>
                        <option value="INTER_STATE">Inter State</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Common: duration, qty, logistics */}
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Date *</label>
                  <input type="date" name="startDate" value={form.startDate} onChange={handleFormChange} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Date *</label>
                  <input type="date" name="endDate" value={form.endDate} onChange={handleFormChange} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Total Qty (KL)</label>
                  <input type="number" name="contractQtyKL" value={form.contractQtyKL} onChange={handleFormChange} step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Daily Target (KL)</label>
                  <input type="number" name="dailyTargetKL" value={form.dailyTargetKL} onChange={handleFormChange} step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Tankers/Day</label>
                  <input type="number" name="minLiftingPerDay" value={form.minLiftingPerDay} onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tanker Capacity (KL)</label>
                  <input type="text" name="tankerCapacityKL" value={form.tankerCapacityKL} onChange={handleFormChange} placeholder="20/30/35/40"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms (days)</label>
                  <input type="number" name="paymentTermsDays" value={form.paymentTermsDays} onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Logistics By</label>
                  <select name="logisticsBy" value={form.logisticsBy} onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500">
                    <option value="BUYER">Buyer</option>
                    <option value="SELLER">Seller (Us)</option>
                    <option value="PRINCIPAL">Principal</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
                <textarea name="remarks" value={form.remarks} onChange={handleFormChange} rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t">
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium disabled:opacity-50">
                {saving ? 'Saving...' : editId ? 'Update Contract' : 'Create Contract'}
              </button>
              <button onClick={() => setShowForm(false)} className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD LIFTING MODAL ── */}
      {liftingContractId && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Truck size={20} className="text-green-600" /> Record Lifting</h2>
              <button onClick={() => setLiftingContractId(null)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input type="date" value={liftForm.liftingDate} onChange={e => setLiftForm(p => ({ ...p, liftingDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Vehicle No *</label>
                  <input type="text" value={liftForm.vehicleNo} onChange={e => setLiftForm(p => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))} placeholder="MP 24 XX 1234"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Destination</label>
                  <input type="text" value={liftForm.destination} onChange={e => setLiftForm(p => ({ ...p, destination: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Driver Name</label>
                  <input type="text" value={liftForm.driverName} onChange={e => setLiftForm(p => ({ ...p, driverName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Driver Phone</label>
                  <input type="text" value={liftForm.driverPhone} onChange={e => setLiftForm(p => ({ ...p, driverPhone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Transporter</label>
                  <input type="text" value={liftForm.transporterName} onChange={e => setLiftForm(p => ({ ...p, transporterName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Qty (BL) *</label>
                  <input type="number" value={liftForm.quantityBL} step="0.01"
                    onChange={e => {
                      const bl = e.target.value;
                      setLiftForm(p => ({ ...p, quantityBL: bl, quantityKL: bl ? String(parseFloat(bl) / 1000) : '' }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Qty (KL)</label>
                  <input type="number" value={liftForm.quantityKL} step="0.001" readOnly
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Strength %</label>
                  <input type="number" value={liftForm.strength} step="0.01" onChange={e => setLiftForm(p => ({ ...p, strength: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Invoice No</label>
                  <input type="text" value={liftForm.invoiceNo} onChange={e => setLiftForm(p => ({ ...p, invoiceNo: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
                <input type="text" value={liftForm.remarks} onChange={e => setLiftForm(p => ({ ...p, remarks: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t">
              <button onClick={handleLiftingSubmit} disabled={liftSaving}
                className="px-6 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 font-medium disabled:opacity-50">
                {liftSaving ? 'Saving...' : 'Record Lifting'}
              </button>
              <button onClick={() => setLiftingContractId(null)} className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EthanolContracts;
