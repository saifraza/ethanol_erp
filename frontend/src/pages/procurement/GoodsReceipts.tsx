import React, { useState, useEffect, useCallback } from 'react';
import { PackageCheck, Plus, X, AlertCircle, CheckCircle, Clock, Upload, Sparkles, Truck, Fuel, Wheat, Package, FileText } from 'lucide-react';
import api from '../../services/api';

// ── Arrivals types ──
type Source = 'FUEL' | 'GRAIN' | 'STORE';
type PaidStatus = 'UNPAID' | 'ADVANCE' | 'FULL';
interface ArrivalRow {
  source: Source;
  poId: string;
  poNo: number;
  vendor: string;
  vendorId: string;
  dealType: string | null;
  truckCap: number | null;
  pendingQty: number;
  pendingValue: number;
  paidStatus: PaidStatus;
  hasOpenGrn: boolean;
  expectedDate: string | null;
  items: Array<{ name: string; pending: number; unit: string; rate: number }>;
}
interface PRRow {
  id: string; reqNo: string; itemName: string; quantity: number; unit: string;
  estimatedCost: number; urgency: string; requestedByPerson: string; department: string; createdAt: string;
}
interface PartialGrnRow {
  id: string; grnNo: number; grnDate: string; expectedDate: string | null;
  fullyPaid: boolean; paymentLinkedAt: string | null; totalAmount: number;
  po: { id: string; poNo: number; grandTotal: number };
  vendor: { id: string; name: string };
  lines: Array<{ description: string; receivedQty: number; unit: string; rate: number }>;
}
interface GrainTruckInFlight {
  id: string; date: string; vehicleNo: string; supplier: string; weightNet: number; ticketNo: number | null;
  purchaseOrder: { id: string; poNo: number } | null;
}
interface ArrivalsPayload {
  fuel: ArrivalRow[];
  grain: { pos: ArrivalRow[]; trucksInFlight: GrainTruckInFlight[] };
  store: ArrivalRow[];
  pr: PRRow[];
  partial: PartialGrnRow[];
  summary: {
    expectedValue: number;
    expectedLines: number;
    paidAwaiting: number;
    partialCount: number;
    todayReceived: number;
  };
}

type MainTab = 'EXPECTED' | 'PARTIAL' | 'RECEIVED' | 'ALL';
type SourceChip = 'ALL' | 'FUEL' | 'GRAIN' | 'STORE' | 'PR';

interface GRNLine {
  poLineId: string;
  inventoryItemId: string;
  description: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unit: string;
  rate: number;
  storageLocation: string;
  warehouseCode: string;
  batchNo: string;
  remarks: string;
}

interface CreateGRNForm {
  poId: string;
  grnDate: string;
  vehicleNo: string;
  invoiceNo: string;
  invoiceDate: string;
  ewayBill: string;
  remarks: string;
  lines: GRNLine[];
  invoiceFilePath?: string;
  ewayBillFilePath?: string;
}

interface AIExtracted {
  invoice_number?: string | null;
  invoice_date?: string | null;
  vendor_name?: string | null;
  vendor_gstin?: string | null;
  eway_bill_number?: string | null;
  vehicle_number?: string | null;
  items?: Array<{ description: string; hsn?: string; qty: number; unit: string; rate: number; amount: number }>;
  total_amount?: number;
}

interface GRNDetail {
  id: string;
  grnNo: number;
  grnDate: string;
  vehicleNo: string;
  challanNo: string;
  invoiceNo?: string;
  invoiceDate?: string;
  ewayBill?: string;
  invoiceFilePath?: string;
  ewayBillFilePath?: string;
  qualityStatus?: string;
  qualityRemarks?: string;
  inspectedBy?: string;
  remarks?: string;
  archived?: boolean;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  totalAmount: number;
  totalQty: number;
  totalAccepted: number;
  totalRejected: number;
  po: { id: string; poNo: string };
  vendor: { id: string; name: string };
  lines: Array<{
    id: string;
    poLineId: string;
    inventoryItemId: string;
    description: string;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    unit: string;
    rate: number;
    amount: number;
    batchNo: string;
    storageLocation: string;
    remarks: string;
  }>;
}

interface GRN {
  id: string;
  grnNo: number;
  grnDate: string;
  vehicleNo: string;
  challanNo: string;
  invoiceNo?: string;
  archived?: boolean;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  grnType?: 'ACTUAL' | 'EXPECTED';
  expectedDate?: string | null;
  totalAmount: number;
  totalAccepted: number;
  totalRejected: number;
  po: { id: string; poNo: string };
  vendor: { name: string };
  lines: GRNLine[];
}

interface PO {
  id: string;
  poNo: string;
  vendor: { name: string };
  lines: POLine[];
}

interface POLine {
  id: string;
  description: string;
  quantity: number;
  pendingQty: number;
  unit: string;
  rate: number;
  inventoryItemId: string;
  materialId?: string;
}

interface WH {
  id: string;
  code: string;
  name: string;
}

interface Stats {
  totalGRNs: number;
  draftCount: number;
  confirmedCount: number;
  todayCount: number;
}

export default function GoodsReceipts() {
  const [grns, setGrns] = useState<GRN[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>('EXPECTED');
  const [sourceChip, setSourceChip] = useState<SourceChip>('ALL');
  const [paidOnly, setPaidOnly] = useState(false);
  const [arrivals, setArrivals] = useState<ArrivalsPayload | null>(null);
  const [arrivalsLoading, setArrivalsLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'ACTUAL' | 'EXPECTED'>('ALL');
  const [pendingPOs, setPendingPOs] = useState<PO[]>([]);
  const [stats, setStats] = useState<Stats>({ totalGRNs: 0, draftCount: 0, confirmedCount: 0, todayCount: 0 });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Expandable detail
  const [expandedGrnId, setExpandedGrnId] = useState<string | null>(null);
  const [grnDetail, setGrnDetail] = useState<GRNDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const toggleGrnDetail = async (grnId: string) => {
    if (expandedGrnId === grnId) { setExpandedGrnId(null); setGrnDetail(null); return; }
    setExpandedGrnId(grnId);
    setDetailLoading(true);
    try {
      const res = await api.get<GRNDetail>(`/goods-receipts/${grnId}`);
      setGrnDetail(res.data);
    } catch { setGrnDetail(null); } finally { setDetailLoading(false); }
  };

  const getToken = () => localStorage.getItem('token') || '';

  const [formData, setFormData] = useState<CreateGRNForm>({
    poId: '', grnDate: new Date().toISOString().split('T')[0], vehicleNo: '', invoiceNo: '', invoiceDate: '', ewayBill: '', remarks: '', lines: [],
  });

  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [warehouses, setWarehouses] = useState<WH[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  // AI upload state
  const [aiExtracting, setAiExtracting] = useState(false);
  const [aiExtracted, setAiExtracted] = useState<AIExtracted | null>(null);
  const [aiMatchedVendor, setAiMatchedVendor] = useState<{ id: string; name: string } | null>(null);
  const [aiMatchedPOs, setAiMatchedPOs] = useState<Array<{ id: string; poNo: number }>>([]);

  const handleAiUpload = async (invoiceFile?: File, ewayBillFile?: File) => {
    if (!invoiceFile && !ewayBillFile) return;
    try {
      setAiExtracting(true);
      setError(null);
      const fd = new FormData();
      if (invoiceFile) fd.append('invoice', invoiceFile);
      if (ewayBillFile) fd.append('ewayBill', ewayBillFile);
      const res = await api.post<{
        invoiceFilePath: string | null; ewayBillFilePath: string | null;
        extracted: AIExtracted | null;
        matchedVendor: { id: string; name: string } | null;
        matchedPOs: Array<{ id: string; poNo: number }>;
        error?: string;
      }>('/goods-receipts/upload-extract', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });

      const { extracted, matchedVendor, matchedPOs, invoiceFilePath, ewayBillFilePath } = res.data;
      if (res.data.error) { setError(`AI: ${res.data.error}`); return; }

      setAiExtracted(extracted);
      setAiMatchedVendor(matchedVendor || null);
      setAiMatchedPOs(matchedPOs || []);

      // Auto-fill form fields from extraction
      if (extracted) {
        setFormData(prev => ({
          ...prev,
          invoiceNo: extracted.invoice_number || prev.invoiceNo,
          invoiceDate: extracted.invoice_date || prev.invoiceDate,
          vehicleNo: extracted.vehicle_number || prev.vehicleNo,
          ewayBill: extracted.eway_bill_number || prev.ewayBill,
          invoiceFilePath: invoiceFilePath || undefined,
          ewayBillFilePath: ewayBillFilePath || undefined,
        }));
      }

      // If vendor matched and has POs, auto-select first PO
      if (matchedVendor && matchedPOs?.length === 1 && !formData.poId) {
        // Auto-select the single matching PO
        const poId = matchedPOs[0].id;
        const poMatch = pendingPOs.find(p => p.id === poId);
        if (poMatch) {
          setSelectedPO(poMatch);
          setFormData(prev => ({
            ...prev,
            poId,
            lines: poMatch.lines.map(pl => ({
              poLineId: pl.id, description: pl.description,
              receivedQty: extracted?.items?.find(ei => pl.description.toLowerCase().includes(ei.description?.toLowerCase()?.slice(0, 15) || ''))?.qty || pl.pendingQty,
              acceptedQty: extracted?.items?.find(ei => pl.description.toLowerCase().includes(ei.description?.toLowerCase()?.slice(0, 15) || ''))?.qty || pl.pendingQty,
              rejectedQty: 0, unit: pl.unit, rate: pl.rate,
              storageLocation: '', warehouseCode: '', batchNo: '', remarks: '',
              inventoryItemId: pl.inventoryItemId,
            })),
          }));
        }
      }

      setSuccessMessage('AI extracted document data successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch {
      setError('Failed to extract from uploaded documents');
    } finally {
      setAiExtracting(false);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const res = await api.get('/inventory/warehouses');
      const list = Array.isArray(res.data) ? res.data : res.data.warehouses ?? [];
      setWarehouses(list);
      if (list.length > 0 && !selectedWarehouseId) setSelectedWarehouseId(list[0].id);
    } catch (err) { console.error('Failed to load warehouses:', err); }
  };

  const fetchGRNs = async () => {
    try {
      setLoading(true);
      const response = await api.get('/goods-receipts');
      setGrns(response.data.grns);
      calculateStats(response.data.grns);
      setError(null);
    } catch (err) {
      setError('Failed to load GRNs. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingPOs = async () => {
    try {
      const response = await api.get('/goods-receipts/pending-pos');
      setPendingPOs(response.data.pos);
    } catch (err) {
      console.error('Failed to load pending POs:', err);
    }
  };

  const fetchArrivals = useCallback(async () => {
    try {
      setArrivalsLoading(true);
      const res = await api.get<ArrivalsPayload>('/goods-receipts/arrivals');
      setArrivals(res.data);
    } catch (err) {
      console.error('Failed to load arrivals:', err);
    } finally {
      setArrivalsLoading(false);
    }
  }, []);

  const handleCreatePartial = async (poId: string) => {
    try {
      await api.post(`/goods-receipts/partial/${poId}`);
      setSuccessMessage('Partial GRN created (paid & awaiting)');
      await Promise.all([fetchArrivals(), fetchGRNs()]);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      setError(err?.response?.data?.error || 'Failed to create partial GRN');
    }
  };

  const calculateStats = (grnList: GRN[]) => {
    const today = new Date().toISOString().split('T')[0];
    setStats({
      totalGRNs: grnList.length,
      draftCount: grnList.filter((g) => g.status === 'DRAFT').length,
      confirmedCount: grnList.filter((g) => g.status === 'CONFIRMED').length,
      todayCount: grnList.filter((g) => g.grnDate === today).length,
    });
  };

  useEffect(() => {
    fetchGRNs();
    fetchPendingPOs();
    fetchWarehouses();
    fetchArrivals();
  }, [fetchArrivals]);

  const handlePOChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const poId = e.target.value;
    setFormData((prev) => ({ ...prev, poId }));
    const selected = pendingPOs.find((po) => po.id === poId);
    setSelectedPO(selected || null);
    if (selected) {
      const lines = selected.lines.map((line) => ({
        poLineId: line.id, inventoryItemId: line.inventoryItemId || line.materialId, description: line.description,
        receivedQty: line.pendingQty, acceptedQty: line.pendingQty, rejectedQty: 0,
        unit: line.unit, rate: line.rate, storageLocation: '', batchNo: '', remarks: '',
      }));
      setFormData((prev) => ({ ...prev, lines }));
    } else {
      setFormData((prev) => ({ ...prev, lines: [] }));
    }
  };

  const handleLineChange = (index: number, field: keyof GRNLine, value: string | number) => {
    const updatedLines = [...formData.lines];
    const line = { ...updatedLines[index], [field]: value };
    // Auto-calculate: accepted = received - rejected
    if (field === 'receivedQty') {
      line.acceptedQty = Math.max(0, (value as number) - (line.rejectedQty || 0));
    } else if (field === 'rejectedQty') {
      line.acceptedQty = Math.max(0, (line.receivedQty || 0) - (value as number));
    }
    updatedLines[index] = line;
    setFormData((prev) => ({ ...prev, lines: updatedLines }));
  };

  const calculateLineTotal = (line: GRNLine): number => line.acceptedQty * line.rate;
  const calculateFormTotal = (): number => formData.lines.reduce((sum, line) => sum + calculateLineTotal(line), 0);

  const handleSubmitGRN = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.poId) { setError('Please select a PO'); return; }
    if (formData.lines.length === 0) { setError('Please add line items'); return; }
    if (!formData.vehicleNo.trim()) { setError('Vehicle number is required'); return; }
    if (!formData.invoiceNo.trim()) { setError('Invoice number is required'); return; }

    try {
      setSubmitting(true);
      await api.post('/goods-receipts', {
        poId: formData.poId, vendorId: selectedPO?.id || '', grnDate: formData.grnDate,
        vehicleNo: formData.vehicleNo, invoiceNo: formData.invoiceNo, invoiceDate: formData.invoiceDate,
        ewayBill: formData.ewayBill, remarks: formData.remarks, lines: formData.lines,
        warehouseId: selectedWarehouseId || undefined,
        invoiceFilePath: formData.invoiceFilePath || null,
        ewayBillFilePath: formData.ewayBillFilePath || null,
      });
      setSuccessMessage('GRN created successfully');
      setShowCreateForm(false);
      setFormData({ poId: '', grnDate: new Date().toISOString().split('T')[0], vehicleNo: '', invoiceNo: '', invoiceDate: '', ewayBill: '', remarks: '', lines: [] });
      setSelectedPO(null);
      await fetchGRNs();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError('Failed to create GRN. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmGRN = async (grnId: string) => {
    try {
      await api.put(`/goods-receipts/${grnId}/status`, { newStatus: 'CONFIRMED' });
      setSuccessMessage('GRN confirmed successfully');
      await fetchGRNs();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError('Failed to confirm GRN');
      console.error(err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'border-gray-400 bg-gray-50 text-gray-700';
      case 'CONFIRMED': return 'border-green-400 bg-green-50 text-green-700';
      case 'CANCELLED': return 'border-red-400 bg-red-50 text-red-700';
      default: return 'border-gray-400 bg-gray-50 text-gray-700';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PackageCheck size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Goods Receipt Notes</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Inward material receipts</span>
          </div>
          <button onClick={() => setShowCreateForm(!showCreateForm)} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
            <Plus size={12} /> NEW GRN
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="px-4 py-2 text-xs border-x border-b -mx-3 md:-mx-6 bg-red-50 text-red-700 border-red-300 flex items-center justify-between">
            <div className="flex items-center gap-2"><AlertCircle size={14} /> {error}</div>
            <button onClick={() => setError(null)}><X size={14} /></button>
          </div>
        )}
        {successMessage && (
          <div className="px-4 py-2 text-xs border-x border-b -mx-3 md:-mx-6 bg-green-50 text-green-700 border-green-300 flex items-center gap-2">
            <CheckCircle size={14} /> {successMessage}
          </div>
        )}

        {/* KPI Strip — Arrivals oriented */}
        <div className="grid grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-blue-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Expected Value</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">₹{((arrivals?.summary.expectedValue || 0) / 100000).toFixed(2)}L</div>
          </div>
          <div className="border-l-4 border-l-amber-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Expected Lines</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{arrivals?.summary.expectedLines || 0}</div>
          </div>
          <div className="border-l-4 border-l-emerald-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paid &amp; Awaiting</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{arrivals?.summary.paidAwaiting || 0}</div>
          </div>
          <div className="border-l-4 border-l-rose-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Partial GRNs</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{arrivals?.summary.partialCount || 0}</div>
          </div>
          <div className="border-l-4 border-l-slate-500 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Today Received</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{arrivals?.summary.todayReceived || 0}</div>
          </div>
        </div>

        {/* Main Tab Bar */}
        <div className="-mx-3 md:-mx-6 bg-white border-x border-b border-slate-300 px-4 flex items-center gap-0">
          {([
            { id: 'EXPECTED' as MainTab, label: 'Expected to Arrive' },
            { id: 'PARTIAL' as MainTab, label: `Partial GRNs (${arrivals?.summary.partialCount || 0})` },
            { id: 'RECEIVED' as MainTab, label: 'Received' },
            { id: 'ALL' as MainTab, label: 'All' },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setMainTab(t.id)}
              className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 -mb-px ${mainTab === t.id ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Pending POs — legacy amber callout, kept hidden (replaced by Expected tab) */}
        {false && pendingPOs.length > 0 && !showCreateForm && (
          <div className="-mx-3 md:-mx-6">
            <div className="bg-amber-50 border-x border-b border-amber-300 px-4 py-2">
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">Pending Purchase Orders — Awaiting Goods Receipt ({pendingPOs.length})</span>
            </div>
            <div className="border-x border-b border-slate-300 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-amber-100">
                    <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-amber-200 text-amber-800">PO #</th>
                    <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-amber-200 text-amber-800">Vendor</th>
                    <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-amber-200 text-amber-800">Items Pending</th>
                    <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-amber-200 text-amber-800">Pending Qty</th>
                    <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-center text-amber-800">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPOs.map((po) => {
                    const totalPending = po.lines.reduce((s, l) => s + l.pendingQty, 0);
                    return (
                      <tr key={po.id} className="border-b border-amber-100 hover:bg-amber-50/60">
                        <td className="px-3 py-1.5 text-xs border-r border-amber-100 font-bold text-slate-800">{po.poNo}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-amber-100">{po.vendor.name}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-amber-100">
                          {po.lines.map((l) => l.description).join(', ')}
                        </td>
                        <td className="px-3 py-1.5 text-xs border-r border-amber-100 text-right font-mono tabular-nums font-semibold">{totalPending.toFixed(1)}</td>
                        <td className="px-3 py-1.5 text-xs text-center">
                          <button
                            onClick={() => {
                              setShowCreateForm(true);
                              // Auto-select this PO
                              setFormData((prev) => ({ ...prev, poId: po.id }));
                              setSelectedPO(po);
                              const lines = po.lines.map((line) => ({
                                poLineId: line.id, inventoryItemId: line.inventoryItemId || line.materialId, description: line.description,
                                receivedQty: line.pendingQty, acceptedQty: line.pendingQty, rejectedQty: 0,
                                unit: line.unit, rate: line.rate, storageLocation: '', batchNo: '', remarks: '',
                              }));
                              setFormData((prev) => ({ ...prev, poId: po.id, lines }));
                            }}
                            className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700"
                          >
                            CREATE GRN
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Create GRN Form */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-5xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-bold tracking-wide uppercase">Create New GRN</span>
                <button onClick={() => setShowCreateForm(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>

              <form onSubmit={handleSubmitGRN} className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
                {/* AI Document Upload */}
                <div className="border border-violet-200 bg-violet-50/50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-violet-600" />
                    <span className="text-[10px] font-bold text-violet-700 uppercase tracking-widest">AI Auto-Fill from Invoice / E-Way Bill</span>
                  </div>
                  {aiExtracting ? (
                    <div className="flex items-center gap-2 text-xs text-violet-600 py-2">
                      <Sparkles className="w-4 h-4 animate-pulse" />
                      Extracting data from documents...
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <label className="flex-1 cursor-pointer">
                        <div className="border border-dashed border-violet-300 bg-white px-3 py-2 flex items-center gap-2 hover:bg-violet-50 transition-colors">
                          <Upload className="w-4 h-4 text-violet-500" />
                          <span className="text-xs text-violet-700">{aiExtracted ? 'Invoice uploaded' : 'Upload Invoice (photo/PDF)'}</span>
                        </div>
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleAiUpload(f, undefined);
                        }} />
                      </label>
                      <label className="flex-1 cursor-pointer">
                        <div className="border border-dashed border-violet-300 bg-white px-3 py-2 flex items-center gap-2 hover:bg-violet-50 transition-colors">
                          <Upload className="w-4 h-4 text-violet-500" />
                          <span className="text-xs text-violet-700">Upload E-Way Bill (optional)</span>
                        </div>
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleAiUpload(undefined, f);
                        }} />
                      </label>
                    </div>
                  )}
                  {aiExtracted && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-green-700">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>AI extracted: {aiExtracted.vendor_name || 'vendor'} | Inv #{aiExtracted.invoice_number || '?'} | Vehicle: {aiExtracted.vehicle_number || '?'}</span>
                      {aiMatchedVendor && <span className="text-violet-600 font-medium ml-1">| Matched: {aiMatchedVendor.name}</span>}
                    </div>
                  )}
                  {aiMatchedPOs.length > 1 && (
                    <div className="mt-1 text-xs text-amber-700">
                      Multiple POs found for this vendor — please select the correct one below.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Select PO *</label>
                    <select value={formData.poId} onChange={handlePOChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="">Choose a Purchase Order</option>
                      {pendingPOs.map((po) => (<option key={po.id} value={po.id}>{po.poNo} - {po.vendor.name}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GRN Date *</label>
                    <input type="date" value={formData.grnDate} onChange={(e) => setFormData((prev) => ({ ...prev, grnDate: e.target.value }))} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vehicle No *</label>
                    <input type="text" placeholder="MH01AB1234" value={formData.vehicleNo} onChange={(e) => setFormData((prev) => ({ ...prev, vehicleNo: e.target.value }))} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Invoice No *</label>
                    <input type="text" placeholder="INV-001" value={formData.invoiceNo} onChange={(e) => setFormData((prev) => ({ ...prev, invoiceNo: e.target.value }))} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Invoice Date</label>
                    <input type="date" value={formData.invoiceDate} onChange={(e) => setFormData((prev) => ({ ...prev, invoiceDate: e.target.value }))} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">E-Way Bill</label>
                    <input type="text" placeholder="12ABC34567890123" value={formData.ewayBill} onChange={(e) => setFormData((prev) => ({ ...prev, ewayBill: e.target.value }))} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Receive to Warehouse *</label>
                    <select value={selectedWarehouseId} onChange={(e) => setSelectedWarehouseId(e.target.value)} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="">Select Warehouse</option>
                      {warehouses.map((wh) => (<option key={wh.id} value={wh.id}>{wh.code} - {wh.name}</option>))}
                    </select>
                  </div>
                </div>

                {selectedPO && (
                  <div className="bg-slate-100 border border-slate-300 p-3">
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">PO No</span><p className="font-semibold text-slate-900">{selectedPO.poNo}</p></div>
                      <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vendor</span><p className="font-semibold text-slate-900">{selectedPO.vendor.name}</p></div>
                      <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Items</span><p className="font-semibold text-slate-900">{selectedPO.lines.length}</p></div>
                    </div>
                  </div>
                )}

                {formData.lines.length > 0 && (
                  <div className="border border-slate-300">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-800 text-white">
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-slate-700">Material</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">PO Qty</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">Pending</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">Received</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">Accepted</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">Rejected</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-slate-700">Location</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left">Batch</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formData.lines.map((line, index) => {
                          const poLine = selectedPO?.lines.find((pl) => pl.id === line.poLineId);
                          return (
                            <tr key={index} className="border-b border-slate-100 even:bg-slate-50/70">
                              <td className="px-3 py-1.5 border-r border-slate-100 font-medium">{line.description}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{poLine?.quantity || '-'}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{poLine?.pendingQty || '-'}</td>
                              <td className="px-2 py-1 border-r border-slate-100">
                                <input type="number" min="0" value={line.receivedQty} onChange={(e) => handleLineChange(index, 'receivedQty', parseFloat(e.target.value))} className="border border-slate-300 px-1.5 py-1 text-xs w-20 text-right focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </td>
                              <td className="px-2 py-1 border-r border-slate-100">
                                <input type="number" min="0" value={line.acceptedQty} onChange={(e) => handleLineChange(index, 'acceptedQty', parseFloat(e.target.value))} className="border border-slate-300 px-1.5 py-1 text-xs w-20 text-right focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </td>
                              <td className="px-2 py-1 border-r border-slate-100">
                                <input type="number" min="0" value={line.rejectedQty} onChange={(e) => handleLineChange(index, 'rejectedQty', parseFloat(e.target.value))} className="border border-slate-300 px-1.5 py-1 text-xs w-20 text-right focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </td>
                              <td className="px-2 py-1 border-r border-slate-100">
                                <input type="text" placeholder="Loc" value={line.storageLocation} onChange={(e) => handleLineChange(index, 'storageLocation', e.target.value)} className="border border-slate-300 px-1.5 py-1 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </td>
                              <td className="px-2 py-1">
                                <input type="text" placeholder="Batch" value={line.batchNo} onChange={(e) => handleLineChange(index, 'batchNo', e.target.value)} className="border border-slate-300 px-1.5 py-1 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-800 text-white font-semibold">
                          <td colSpan={7} className="px-3 py-2 text-xs text-right uppercase tracking-widest">Total Amount</td>
                          <td className="px-3 py-2 text-xs font-mono tabular-nums">{calculateFormTotal().toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <textarea value={formData.remarks} onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))} rows={2} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Additional remarks..." />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                  <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-1.5 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">CANCEL</button>
                  <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {submitting ? 'CREATING...' : 'CREATE GRN'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ─── EXPECTED TO ARRIVE TAB ─── */}
        {mainTab === 'EXPECTED' && (
          <ExpectedArrivalsView
            arrivals={arrivals}
            loading={arrivalsLoading}
            sourceChip={sourceChip}
            setSourceChip={setSourceChip}
            paidOnly={paidOnly}
            setPaidOnly={setPaidOnly}
            onCreateGrn={(po) => {
              setShowCreateForm(true);
              const fullPo = pendingPOs.find(p => p.id === po.poId);
              if (fullPo) {
                setSelectedPO(fullPo);
                const lines = fullPo.lines.map((line) => ({
                  poLineId: line.id, inventoryItemId: line.inventoryItemId || line.materialId || '', description: line.description,
                  receivedQty: line.pendingQty, acceptedQty: line.pendingQty, rejectedQty: 0,
                  unit: line.unit, rate: line.rate, storageLocation: '', warehouseCode: '', batchNo: '', remarks: '',
                }));
                setFormData((prev) => ({ ...prev, poId: po.poId, lines }));
              }
            }}
            onCreatePartial={handleCreatePartial}
          />
        )}

        {/* ─── PARTIAL GRNs TAB ─── */}
        {mainTab === 'PARTIAL' && (
          <PartialGrnsView
            partials={arrivals?.partial || []}
            loading={arrivalsLoading}
            onComplete={async (grnId) => {
              try {
                await api.put(`/goods-receipts/${grnId}/status`, { newStatus: 'CONFIRMED' });
                setSuccessMessage('GRN confirmed');
                await Promise.all([fetchArrivals(), fetchGRNs()]);
                setTimeout(() => setSuccessMessage(null), 3000);
              } catch (err: unknown) {
                setError(err?.response?.data?.error || 'Failed to confirm GRN');
              }
            }}
          />
        )}

        {/* ─── RECEIVED / ALL TAB — secondary type filter ─── */}
        {(mainTab === 'RECEIVED' || mainTab === 'ALL') && !loading && (
          <div className="-mx-3 md:-mx-6 bg-slate-100 border-x border-b border-slate-300 px-4 py-1.5 flex items-center gap-1">
            {(['ALL', 'ACTUAL', 'EXPECTED'] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${typeFilter === t ? 'bg-slate-800 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                {t === 'EXPECTED' ? `Expected (${grns.filter(g => g.grnType === 'EXPECTED').length})` : t === 'ACTUAL' ? `Actual (${grns.filter(g => g.grnType !== 'EXPECTED').length})` : `All (${grns.length})`}
              </button>
            ))}
          </div>
        )}

        {/* GRN Table — only on RECEIVED / ALL tabs */}
        {(mainTab === 'RECEIVED' || mainTab === 'ALL') && (
        <>
        {loading ? (
          <div className="text-center py-12">
            <Clock size={24} className="animate-spin mx-auto mb-2 text-slate-400" />
            <p className="text-xs text-slate-400 uppercase tracking-widest">Loading GRNs...</p>
          </div>
        ) : grns.filter(g => (mainTab === 'RECEIVED' ? g.status === 'CONFIRMED' : true) && (typeFilter === 'ALL' || (typeFilter === 'EXPECTED' ? g.grnType === 'EXPECTED' : g.grnType !== 'EXPECTED'))).length === 0 ? (
          <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No GRNs found. Create one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-slate-300">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">GRN #</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">PO Ref</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Vendor</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Date</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Vehicle</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Challan</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Accepted</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Rejected</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Amount</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Status</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grns.filter(g => (mainTab === 'RECEIVED' ? g.status === 'CONFIRMED' : true) && (typeFilter === 'ALL' || (typeFilter === 'EXPECTED' ? g.grnType === 'EXPECTED' : g.grnType !== 'EXPECTED'))).map((grn, idx) => (
                  <React.Fragment key={grn.id}>
                  <tr className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${idx % 2 ? 'bg-slate-50/70' : ''} ${expandedGrnId === grn.id ? 'bg-blue-50' : ''}`} onClick={() => toggleGrnDetail(grn.id)}>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-bold text-blue-700">GRN-{grn.grnNo}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{grn.po.poNo}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{grn.vendor.name}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{new Date(grn.grnDate).toLocaleDateString()}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{grn.vehicleNo}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{grn.invoiceNo || grn.challanNo || '--'}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums text-green-700 font-semibold">{grn.lines?.reduce((s: number, l: any) => s + (l.acceptedQty || 0), 0) || '-'}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums text-red-600 font-semibold">{grn.lines?.reduce((s: number, l: any) => s + (l.rejectedQty || 0), 0) || '-'}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-bold">{grn.totalAmount.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${getStatusBadge(grn.status)}`}>{grn.status}</span>
                      {grn.grnType === 'EXPECTED' && <span className="ml-1 text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-400 bg-amber-50 text-amber-700">Expected</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {grn.status === 'DRAFT' && (
                          <>
                            <button onClick={() => handleConfirmGRN(grn.id)} className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700">CONFIRM</button>
                            <button
                              onClick={async () => {
                                if (!confirm(`Delete GRN-${grn.grnNo}?`)) return;
                                try {
                                  await api.delete(`/goods-receipts/${grn.id}`);
                                  setSuccessMessage('GRN deleted');
                                  await fetchGRNs();
                                  setTimeout(() => setSuccessMessage(null), 3000);
                                } catch (err) { console.error(err); }
                              }}
                              className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-medium hover:bg-red-700"
                            >DEL</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Expandable Detail Panel */}
                  {expandedGrnId === grn.id && (
                    <tr>
                      <td colSpan={11} className="bg-white border-b-2 border-blue-300 p-0">
                        {detailLoading ? (
                          <div className="p-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading GRN details...</div>
                        ) : grnDetail ? (
                          <div className="p-4 space-y-3">
                            {/* Header: GRN Info + Action Buttons */}
                            <div className="flex items-start justify-between">
                              <div className="grid grid-cols-4 gap-4 text-xs flex-1">
                                <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PO Reference</span><div className="mt-0.5 font-bold text-slate-800">{grnDetail.po.poNo}</div></div>
                                <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Invoice #</span><div className="mt-0.5 text-slate-700">{grnDetail.invoiceNo || '--'}</div></div>
                                <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">E-Way Bill</span><div className="mt-0.5 text-slate-700">{grnDetail.ewayBill || '--'}</div></div>
                                <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vehicle</span><div className="mt-0.5 text-slate-700">{grnDetail.vehicleNo || '--'}</div></div>
                              </div>
                              <div className="flex gap-1 ml-4">
                                <a href={`/api/goods-receipts/${grn.id}/pdf?token=${getToken()}`} target="_blank" rel="noreferrer" className="px-2 py-1 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700" onClick={e => e.stopPropagation()}>GRN PDF</a>
                                <a href={`/api/purchase-orders/${grnDetail.po.id}/pdf?token=${getToken()}`} target="_blank" rel="noreferrer" className="px-2 py-1 bg-slate-600 text-white text-[10px] font-medium hover:bg-slate-700" onClick={e => e.stopPropagation()}>PO PDF</a>
                              </div>
                            </div>

                            {/* Documents Row */}
                            {(grnDetail.invoiceFilePath || grnDetail.ewayBillFilePath) && (
                              <div className="flex gap-3">
                                {grnDetail.invoiceFilePath && (
                                  <a href={`/uploads/${grnDetail.invoiceFilePath}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2 py-1 border border-blue-300 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase hover:bg-blue-100" onClick={e => e.stopPropagation()}>
                                    Vendor Invoice File
                                  </a>
                                )}
                                {grnDetail.ewayBillFilePath && (
                                  <a href={`/uploads/${grnDetail.ewayBillFilePath}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2 py-1 border border-amber-300 bg-amber-50 text-amber-700 text-[10px] font-bold uppercase hover:bg-amber-100" onClick={e => e.stopPropagation()}>
                                    E-Way Bill File
                                  </a>
                                )}
                              </div>
                            )}

                            {/* Line Items Table */}
                            <div className="border border-slate-200 overflow-hidden">
                              <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">Line Items ({grnDetail.lines.length})</div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="text-left px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase border-r border-slate-200">Description</th>
                                    <th className="text-right px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase border-r border-slate-200">Received</th>
                                    <th className="text-right px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase border-r border-slate-200">Accepted</th>
                                    <th className="text-right px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase border-r border-slate-200">Rejected</th>
                                    <th className="text-left px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase border-r border-slate-200">Unit</th>
                                    <th className="text-right px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase border-r border-slate-200">Rate</th>
                                    <th className="text-right px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {grnDetail.lines.map((line, li) => (
                                    <tr key={line.id || li} className="border-b border-slate-100">
                                      <td className="px-3 py-1 text-slate-800 border-r border-slate-100">{line.description}</td>
                                      <td className="px-3 py-1 text-right font-mono tabular-nums border-r border-slate-100">{line.receivedQty}</td>
                                      <td className="px-3 py-1 text-right font-mono tabular-nums text-green-700 font-semibold border-r border-slate-100">{line.acceptedQty}</td>
                                      <td className="px-3 py-1 text-right font-mono tabular-nums text-red-600 font-semibold border-r border-slate-100">{line.rejectedQty}</td>
                                      <td className="px-3 py-1 border-r border-slate-100">{line.unit}</td>
                                      <td className="px-3 py-1 text-right font-mono tabular-nums border-r border-slate-100">{(line.rate || 0).toFixed(2)}</td>
                                      <td className="px-3 py-1 text-right font-mono tabular-nums font-bold">{((line.acceptedQty || 0) * (line.rate || 0)).toFixed(2)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-slate-100 font-bold">
                                    <td className="px-3 py-1.5 text-right uppercase text-[10px] tracking-widest text-slate-500" colSpan={6}>Total</td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{(grnDetail.totalAmount || 0).toFixed(2)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>

                            {/* Quality + Remarks */}
                            {(grnDetail.qualityStatus || grnDetail.remarks) && (
                              <div className="grid grid-cols-3 gap-3 text-xs">
                                {grnDetail.qualityStatus && (
                                  <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quality</span><div className="mt-0.5"><span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${grnDetail.qualityStatus === 'ACCEPTED' ? 'border-green-300 text-green-700 bg-green-50' : grnDetail.qualityStatus === 'REJECTED' ? 'border-red-300 text-red-700 bg-red-50' : 'border-slate-300 text-slate-600'}`}>{grnDetail.qualityStatus}</span></div></div>
                                )}
                                {grnDetail.inspectedBy && (
                                  <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inspector</span><div className="mt-0.5 text-slate-700">{grnDetail.inspectedBy}</div></div>
                                )}
                                {grnDetail.remarks && (
                                  <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Remarks</span><div className="mt-0.5 text-slate-700">{grnDetail.remarks}</div></div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="p-6 text-center text-xs text-red-400">Failed to load GRN details</div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// ─── Expected to Arrive view ───
function ExpectedArrivalsView({
  arrivals, loading, sourceChip, setSourceChip, paidOnly, setPaidOnly, onCreateGrn, onCreatePartial,
}: {
  arrivals: ArrivalsPayload | null;
  loading: boolean;
  sourceChip: SourceChip;
  setSourceChip: (s: SourceChip) => void;
  paidOnly: boolean;
  setPaidOnly: (p: boolean) => void;
  onCreateGrn: (row: ArrivalRow) => void;
  onCreatePartial: (poId: string) => void;
}) {
  if (loading && !arrivals) {
    return <div className="text-center py-12 text-xs text-slate-400 uppercase tracking-widest">Loading arrivals...</div>;
  }
  if (!arrivals) {
    return <div className="text-center py-12 text-xs text-slate-400 uppercase tracking-widest">No arrivals data</div>;
  }

  const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const filterRow = (r: ArrivalRow) => !paidOnly || r.paidStatus !== 'UNPAID';
  const fuel = arrivals.fuel.filter(filterRow);
  const grain = arrivals.grain.pos.filter(filterRow);
  const store = arrivals.store.filter(filterRow);

  const showFuel = sourceChip === 'ALL' || sourceChip === 'FUEL';
  const showGrain = sourceChip === 'ALL' || sourceChip === 'GRAIN';
  const showStore = sourceChip === 'ALL' || sourceChip === 'STORE';
  const showPR = sourceChip === 'ALL' || sourceChip === 'PR';

  const PaidBadge = ({ s }: { s: PaidStatus }) => {
    const cls = s === 'FULL' ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
      : s === 'ADVANCE' ? 'border-amber-400 bg-amber-50 text-amber-700'
      : 'border-slate-300 bg-slate-50 text-slate-500';
    return <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${cls}`}>{s}</span>;
  };

  const renderGroup = (label: string, icon: React.ReactNode, rows: ArrivalRow[]) => {
    if (rows.length === 0) return null;
    const total = rows.reduce((s, r) => s + r.pendingValue, 0);
    return (
      <React.Fragment>
        <tr className="bg-slate-200 border-b border-slate-300">
          <td colSpan={9} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-700">
            <div className="flex items-center gap-2">{icon} {label} ({rows.length}) <span className="ml-auto font-mono">{fmtINR(total)}</span></div>
          </td>
        </tr>
        {rows.map((r, i) => (
          <tr key={r.poId} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
            <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-bold text-blue-700">PO-{r.poNo}</td>
            <td className="px-3 py-1.5 text-xs border-r border-slate-100">{r.vendor}</td>
            <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-600">{r.items.map(i => i.name).slice(0, 2).join(', ')}{r.items.length > 2 ? ` +${r.items.length - 2}` : ''}</td>
            <td className="px-3 py-1.5 text-xs border-r border-slate-100">{r.dealType || '--'}{r.truckCap ? ` (${r.truckCap}T)` : ''}</td>
            <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{r.pendingQty.toFixed(2)}</td>
            <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-semibold">{fmtINR(r.pendingValue)}</td>
            <td className="px-3 py-1.5 text-xs border-r border-slate-100"><PaidBadge s={r.paidStatus} /></td>
            <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-500">{r.expectedDate ? new Date(r.expectedDate).toLocaleDateString() : '--'}</td>
            <td className="px-3 py-1.5 text-xs text-center">
              <div className="flex items-center justify-center gap-1">
                <button onClick={() => onCreateGrn(r)} className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">CREATE GRN</button>
                {!r.hasOpenGrn && r.paidStatus !== 'UNPAID' && (
                  <button onClick={() => onCreatePartial(r.poId)} className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-medium hover:bg-emerald-700" title="Mark as paid & awaiting goods">PARTIAL</button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </React.Fragment>
    );
  };

  return (
    <>
      {/* Filter toolbar */}
      <div className="-mx-3 md:-mx-6 bg-slate-100 border-x border-b border-slate-300 px-4 py-2 flex items-center gap-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Source:</span>
        {(['ALL', 'FUEL', 'GRAIN', 'STORE', 'PR'] as SourceChip[]).map(c => (
          <button
            key={c}
            onClick={() => setSourceChip(c)}
            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border ${sourceChip === c ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            {c}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest cursor-pointer">
          <input type="checkbox" checked={paidOnly} onChange={e => setPaidOnly(e.target.checked)} className="h-3 w-3" />
          Paid Only
        </label>
      </div>

      {/* Grouped table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO #</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Items</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Deal</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Pending Qty</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Value</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Expected</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
            </tr>
          </thead>
          <tbody>
            {showFuel && renderGroup('Fuel Arrivals', <Fuel size={12} />, fuel)}
            {showGrain && renderGroup('Raw Material / Grain', <Wheat size={12} />, grain)}
            {showStore && renderGroup('Store / Spares / Consumables', <Package size={12} />, store)}
            {showPR && arrivals.pr.length > 0 && (
              <React.Fragment>
                <tr className="bg-slate-200 border-b border-slate-300">
                  <td colSpan={9} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-700">
                    <div className="flex items-center gap-2"><FileText size={12} /> PR Generated — No PO Yet ({arrivals.pr.length})</div>
                  </td>
                </tr>
                {arrivals.pr.map((p, i) => {
                  const days = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86400000);
                  return (
                    <tr key={p.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-bold text-amber-700">{p.reqNo}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">{p.requestedByPerson || p.department || '--'}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">{p.itemName}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-500">{p.urgency || '--'}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{p.quantity} {p.unit}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{fmtINR(p.estimatedCost || 0)}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100"><span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-400 bg-amber-50 text-amber-700">PR</span></td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-500">{days}d waiting</td>
                      <td className="px-3 py-1.5 text-xs text-center">
                        <a href={`/procurement/purchase-orders?prId=${p.id}`} className="px-2 py-0.5 bg-amber-600 text-white text-[10px] font-medium hover:bg-amber-700">CREATE PO</a>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            )}
            {fuel.length === 0 && grain.length === 0 && store.length === 0 && arrivals.pr.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-xs text-slate-400 uppercase tracking-widest">No expected arrivals</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Grain trucks in flight (weighbridge but no GRN yet) */}
      {arrivals.grain.trucksInFlight.length > 0 && (sourceChip === 'ALL' || sourceChip === 'GRAIN') && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 mt-0">
          <div className="bg-slate-100 px-4 py-1.5 border-b border-slate-300">
            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2"><Truck size={12} /> Grain Trucks At Weighbridge — Awaiting GRN ({arrivals.grain.trucksInFlight.length})</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-700 text-white">
                <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Ticket</th>
                <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Vehicle</th>
                <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Supplier</th>
                <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">PO</th>
                <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Net (T)</th>
                <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Date</th>
              </tr>
            </thead>
            <tbody>
              {arrivals.grain.trucksInFlight.map((t, i) => (
                <tr key={t.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100">{t.ticketNo || '--'}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100">{t.vehicleNo}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100">{t.supplier}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100">{t.purchaseOrder ? `PO-${t.purchaseOrder.poNo}` : '--'}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{(t.weightNet || 0).toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{new Date(t.date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Partial GRNs view ───
function PartialGrnsView({
  partials, loading, onComplete,
}: {
  partials: PartialGrnRow[];
  loading: boolean;
  onComplete: (grnId: string) => void;
}) {
  if (loading) return <div className="text-center py-12 text-xs text-slate-400 uppercase tracking-widest">Loading...</div>;
  if (partials.length === 0) {
    return (
      <div className="text-center py-16 -mx-3 md:-mx-6 border-x border-b border-slate-300">
        <p className="text-xs text-slate-400 uppercase tracking-widest">No partial GRNs — paid &amp; awaiting goods will appear here</p>
      </div>
    );
  }
  const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (
    <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-800 text-white">
            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GRN #</th>
            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO #</th>
            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Created</th>
            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid On</th>
            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO Value</th>
            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
            <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
          </tr>
        </thead>
        <tbody>
          {partials.map((g, i) => (
            <tr key={g.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
              <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-bold text-blue-700">GRN-{g.grnNo}</td>
              <td className="px-3 py-1.5 text-xs border-r border-slate-100">PO-{g.po.poNo}</td>
              <td className="px-3 py-1.5 text-xs border-r border-slate-100">{g.vendor.name}</td>
              <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-500">{new Date(g.grnDate).toLocaleDateString()}</td>
              <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-500">{g.paymentLinkedAt ? new Date(g.paymentLinkedAt).toLocaleDateString() : '--'}</td>
              <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{fmtINR(g.po.grandTotal || 0)}</td>
              <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${g.fullyPaid ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-amber-400 bg-amber-50 text-amber-700'}`}>
                  {g.fullyPaid ? 'PAID · AWAITING' : 'PARTIAL'}
                </span>
              </td>
              <td className="px-3 py-1.5 text-xs text-center">
                <button onClick={() => onComplete(g.id)} className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-medium hover:bg-emerald-700">MARK RECEIVED</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
