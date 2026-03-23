import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Truck, X, Loader2, Share2, MessageCircle, Phone, ChevronDown,
  Scale, CheckCircle, AlertCircle, FileText, Camera, Upload, Image,
  Clock, MapPin, Trash2, Plus, ClipboardList
} from 'lucide-react';
import api from '../../services/api';

interface Shipment {
  id: string; vehicleNo: string;
  status: 'GATE_IN' | 'TARE_WEIGHED' | 'LOADING' | 'GROSS_WEIGHED' | 'RELEASED' | 'EXITED';
  customerName: string; productName: string; destination: string;
  driverName: string; driverMobile: string; transporterName: string;
  capacityTon: number; vehicleType: string; gateInTime: string;
  weightTare?: number; weightGross?: number; weightNet?: number;
  dispatchRequestId?: string; challanNo?: string; ewayBill?: string; ewayBillStatus?: string; gatePassNo?: string;
  invoiceRef?: string; irn?: string; irnStatus?: string;
  grBiltyNo?: string; grBiltyDate?: string;
  tareTime?: string; grossTime?: string; releaseTime?: string; exitTime?: string;
  gatePassType?: string; purpose?: string; partyName?: string; partyGstin?: string; totalValue?: number;
  gatePassItems?: string;
  paymentTerms?: string;
  paymentStatus?: string;  // PENDING, CONFIRMED, NOT_REQUIRED
  paymentMode?: string;
  paymentRef?: string;
  paymentAmount?: number;
  linkedInvoiceId?: string | null;
  linkedInvoiceNo?: number | null;
  dispatchRequest?: { drNo?: number; customerName?: string; productName?: string; quantity?: number; unit?: string };
  documents?: { id: string; docType: string; fileName: string }[];
}

const STATUS_FLOW = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'] as const;

const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  GATE_IN:        { label: 'Gate In',  badge: 'bg-slate-100 text-slate-700' },
  TARE_WEIGHED:   { label: 'Tared',    badge: 'bg-blue-50 text-blue-700' },
  LOADING:        { label: 'Loading',  badge: 'bg-amber-50 text-amber-700' },
  GROSS_WEIGHED:  { label: 'Loaded',   badge: 'bg-orange-50 text-orange-700' },
  RELEASED:       { label: 'Released', badge: 'bg-emerald-50 text-emerald-700' },
  EXITED:         { label: 'Exited',   badge: 'bg-green-50 text-green-700' },
};

const DOC_TYPES = [
  { key: 'INVOICE', label: 'Bill', field: 'invoiceRef' },
  { key: 'EWAY_BILL', label: 'E-Way', field: 'ewayBill' },
  { key: 'GATE_PASS', label: 'Gate Pass', field: 'gatePassNo' },
  { key: 'GR_BILTY', label: 'Bilty', field: 'grBiltyNo' },
];

export default function Shipments() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // track which shipment is saving
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Exit gate: doc check before exit
  const [exitConfirm, setExitConfirm] = useState<Shipment | null>(null);
  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<Shipment | null>(null);
  // Inline weigh input — shown directly in row
  const [weighing, setWeighing] = useState<{ id: string; type: 'tare' | 'gross' } | null>(null);
  const [weighVal, setWeighVal] = useState('');
  const weighRef = useRef<HTMLInputElement>(null);
  // Bill generation
  const [billShipment, setBillShipment] = useState<Shipment | null>(null);
  const [billForm, setBillForm] = useState({
    productName: '', customerName: '', quantity: '', unit: 'MT', rate: '',
    gstPercent: '18', freightCharge: '0', remarks: '', challanNo: '', ewayBill: '',
  });
  const [billSaving, setBillSaving] = useState(false);
  // E-Way Bill generation
  const [ewbLoading, setEwbLoading] = useState<string | null>(null);
  // Payment confirmation
  const [paymentShipment, setPaymentShipment] = useState<Shipment | null>(null);
  const [paymentForm, setPaymentForm] = useState({ mode: 'UPI', ref: '', amount: '' });
  const [paymentSaving, setPaymentSaving] = useState(false);
  // Gate Pass form
  const [showGPForm, setShowGPForm] = useState(false);
  const [gpForm, setGpForm] = useState({
    gatePassType: 'RETURNABLE' as string,
    purpose: '',
    partyName: '', partyAddress: '', partyGstin: '',
    vehicleNo: '', driverName: '', driverMobile: '', transporterName: '',
    totalValue: '',
    items: [{ desc: '', hsnCode: '', qty: '1', unit: 'NOS', value: '' }] as { desc: string; hsnCode: string; qty: string; unit: string; value: string }[],
  });
  const [gpSaving, setGpSaving] = useState(false);
  const [gpLinkedShipment, setGpLinkedShipment] = useState<Shipment | null>(null);

  const addGPItem = () => setGpForm(f => ({ ...f, items: [...f.items, { desc: '', hsnCode: '', qty: '1', unit: 'NOS', value: '' }] }));
  const removeGPItem = (i: number) => setGpForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateGPItem = (i: number, field: string, val: string) => setGpForm(f => ({
    ...f, items: f.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item),
  }));

  // Auto-fill gate pass from vehicle number match
  const onGPVehicleChange = (vNo: string) => {
    setGpForm(f => ({ ...f, vehicleNo: vNo }));
    if (vNo.length >= 4) {
      const match = shipments.find(s => s.vehicleNo?.toUpperCase() === vNo.toUpperCase() && s.status !== 'EXITED' && s.status !== 'CANCELLED');
      if (match) {
        setGpLinkedShipment(match);
        setGpForm(f => ({
          ...f,
          gatePassType: 'SALE',
          partyName: match.customerName || match.partyName || '',
          partyGstin: match.partyGstin || '',
          vehicleNo: match.vehicleNo,
          driverName: match.driverName || '',
          driverMobile: match.driverMobile || '',
          transporterName: match.transporterName || '',
          totalValue: match.totalValue?.toString() || '',
          items: [{ desc: match.productName || '', hsnCode: '', qty: match.weightNet ? (match.weightNet / 1000).toFixed(3) : '1', unit: 'MT', value: match.totalValue?.toString() || '' }],
        }));
      } else {
        setGpLinkedShipment(null);
      }
    } else {
      setGpLinkedShipment(null);
    }
  };

  const createGatePass = async () => {
    if (!gpForm.partyName) { flash('err', 'Party name required'); return; }
    if (!gpForm.vehicleNo) { flash('err', 'Vehicle number required'); return; }
    setGpSaving(true);
    try {
      const totalVal = gpForm.items.reduce((s, item) => s + (parseFloat(item.value) || 0), 0);

      if (gpLinkedShipment) {
        // Update existing shipment with gate pass info
        await api.put(`/shipments/${gpLinkedShipment.id}`, {
          gatePassType: gpForm.gatePassType,
          purpose: gpForm.purpose,
          partyName: gpForm.partyName,
          partyGstin: gpForm.partyGstin,
          totalValue: totalVal || parseFloat(gpForm.totalValue) || 0,
          gatePassItems: JSON.stringify(gpForm.items.filter(i => i.desc)),
        });
        flash('ok', `Gate Pass added to ${gpLinkedShipment.vehicleNo}`);
      } else {
        // Create new shipment for standalone gate pass
        await api.post('/shipments', {
          gatePassType: gpForm.gatePassType,
          purpose: gpForm.purpose,
          partyName: gpForm.partyName,
          partyAddress: gpForm.partyAddress,
          partyGstin: gpForm.partyGstin,
          vehicleNo: gpForm.vehicleNo,
          driverName: gpForm.driverName,
          driverMobile: gpForm.driverMobile,
          transporterName: gpForm.transporterName,
          totalValue: totalVal || parseFloat(gpForm.totalValue) || 0,
          gatePassItems: gpForm.items.filter(i => i.desc),
          productName: gpForm.items.map(i => i.desc).filter(Boolean).join(', ').substring(0, 100) || 'Gate Pass Material',
          gateInTime: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        });
        flash('ok', 'Gate Pass created');
      }

      setShowGPForm(false);
      setGpLinkedShipment(null);
      setGpForm({ gatePassType: 'RETURNABLE', purpose: '', partyName: '', partyAddress: '', partyGstin: '', vehicleNo: '', driverName: '', driverMobile: '', transporterName: '', totalValue: '', items: [{ desc: '', hsnCode: '', qty: '1', unit: 'NOS', value: '' }] });
      load();
    } catch (e: any) { flash('err', e?.response?.data?.error || 'Failed to create gate pass'); }
    setGpSaving(false);
  };

  const generateEwb = async (s: Shipment) => {
    setEwbLoading(s.id);
    try {
      const r = await api.post(`/shipments/${s.id}/eway-bill`);
      const invMsg = r.data.invoiceNo ? `INV-${r.data.invoiceNo}` : '';
      const irnMsg = r.data.irn ? ` → IRN ✓` : '';
      const sandbox = r.data.message?.includes('SANDBOX') ? ' (sandbox)' : '';
      flash('ok', `${invMsg}${irnMsg} → EWB: ${r.data.ewayBillNo}${sandbox}`);
      load();
    } catch (e: any) {
      const errData = e.response?.data;
      const step = errData?.step;
      const errMsg = errData?.error || '';
      if (step === 'invoice-missing') {
        flash('err', 'Create an Invoice first (click Generate Invoice), then generate e-Invoice + EWB.');
      } else if (step === 'customer-incomplete') {
        flash('err', errMsg || 'Customer GSTIN/State/Pincode missing. Update in Sales → Customers.');
      } else if (step === 'invoice-incomplete') {
        flash('err', errMsg || 'Invoice data incomplete.');
      } else if (step === 'e-invoice') {
        // Parse common e-Invoice errors for user-friendly messages
        if (errMsg.includes('Invalid Token') || errMsg.includes('1005')) {
          flash('err', 'e-Invoice auth token expired. Please try again — it will re-authenticate.');
        } else if (errMsg.includes('GSTIN') && errMsg.includes('invalid')) {
          flash('err', 'Customer GSTIN is invalid on the GST portal. Verify the GSTIN in Sales → Customers.');
        } else if (errMsg.includes('Network error') || errMsg.includes('socket') || errMsg.includes('fetch failed')) {
          flash('err', 'Network error connecting to e-Invoice portal. Please try again in a moment.');
        } else if (errMsg.includes('Duplicate')) {
          flash('err', 'e-Invoice already exists for this invoice number. Check the IRN status.');
        } else {
          flash('err', `e-Invoice failed: ${errMsg || 'Unknown error. Check server logs.'}`);
        }
      } else if (step === 'eway-bill') {
        flash('err', `IRN generated ✓ but E-Way Bill failed: ${errMsg || 'Unknown error'}`);
      } else {
        flash('err', errMsg || 'e-Invoice + EWB generation failed. Check server logs.');
      }
    }
    setEwbLoading(null);
  };

  const confirmPayment = async () => {
    if (!paymentShipment) return;
    setPaymentSaving(true);
    try {
      await api.post(`/shipments/${paymentShipment.id}/confirm-payment`, {
        paymentMode: paymentForm.mode,
        paymentRef: paymentForm.ref,
        paymentAmount: parseFloat(paymentForm.amount) || undefined,
      });
      flash('ok', `Payment confirmed (${paymentForm.mode}${paymentForm.ref ? ': ' + paymentForm.ref : ''})`);
      setPaymentShipment(null);
      setPaymentForm({ mode: 'UPI', ref: '', amount: '' });
      load();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Payment confirmation failed');
    } finally { setPaymentSaving(false); }
  };

  const load = async () => {
    try {
      setLoading(true);
      const r = await api.get('/shipments/active');
      setShipments(r.data.shipments || []);
    } catch { flash('err', 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (weighing && weighRef.current) weighRef.current.focus(); }, [weighing]);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), type === 'err' ? 10000 : 4000);
  };

  // ── Grouped by order ──
  const grouped = useMemo(() => {
    const filtered = filterStatus === 'ALL' ? shipments : shipments.filter(s => s.status === filterStatus);
    const groups: Record<string, { dr: Shipment['dispatchRequest']; shipments: Shipment[]; drId: string }> = {};
    filtered.forEach(s => {
      const key = s.dispatchRequestId || 'unlinked';
      if (!groups[key]) groups[key] = { dr: s.dispatchRequest, shipments: [], drId: key };
      groups[key].shipments.push(s);
    });
    return Object.entries(groups);
  }, [shipments, filterStatus]);

  // ── Actions ──
  const doWeigh = async (id: string, type: 'tare' | 'gross') => {
    if (!weighVal) { flash('err', 'Enter weight'); return; }
    setSaving(id);
    try {
      const w = parseFloat(weighVal) * 1000;
      const body = type === 'tare'
        ? { weightTare: w, tareTime: new Date().toISOString() }
        : { weightGross: w, grossTime: new Date().toISOString() };
      await api.put(`/shipments/${id}/weighbridge`, body);
      flash('ok', `${type === 'tare' ? 'Tare' : 'Gross'}: ${weighVal} T ✓`);
      setWeighing(null); setWeighVal('');
      // After tare → auto start loading
      if (type === 'tare') {
        await api.put(`/shipments/${id}/status`, { status: 'LOADING', loadStartTime: new Date().toISOString() });
      }
      load();
    } catch { flash('err', 'Failed to save weight'); }
    setSaving(null);
  };

  const doStatus = async (id: string, status: string, extra?: any) => {
    setSaving(id);
    try {
      await api.put(`/shipments/${id}/status`, { status, ...extra });
      flash('ok', STATUS_CFG[status]?.label || status);
      load();
    } catch { flash('err', 'Failed'); }
    setSaving(null);
  };

  const doDelete = async (id: string) => {
    setSaving(id);
    try {
      await api.delete(`/shipments/${id}`);
      flash('ok', 'Truck removed');
      setDeleteConfirm(null);
      load();
    } catch (e: any) {
      flash('err', e?.response?.data?.error || 'Delete failed');
    }
    setSaving(null);
  };

  // Exit with doc check
  const handleExit = (s: Shipment) => {
    const docs = s.documents || [];
    const missingDocs = DOC_TYPES.filter(dt => !docs.some(d => d.docType === dt.key));
    if (missingDocs.length > 0) {
      setExitConfirm(s);
    } else {
      doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() });
    }
  };

  const uploadDoc = async (shipmentId: string, docType: string, source: 'file' | 'camera' | 'gallery') => {
    const input = document.createElement('input');
    input.type = 'file';
    if (source === 'camera') { input.accept = 'image/*'; input.setAttribute('capture', 'environment'); }
    else if (source === 'gallery') { input.accept = 'image/*'; }
    else { input.accept = 'image/*,.pdf,.doc,.docx'; }
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return;
      setUploadingDoc(`${shipmentId}_${docType}`);
      try {
        const fd = new FormData();
        fd.append('file', file); fd.append('docType', docType); fd.append('shipmentId', shipmentId);
        await api.post('/shipment-documents/upload', fd);
        flash('ok', `${docType.replace(/_/g, ' ')} uploaded`);
        load();
      } catch { flash('err', 'Upload failed'); }
      setUploadingDoc(null);
    };
    input.click();
  };

  const saveField = async (shipmentId: string, field: string, value: string) => {
    try { await api.put(`/shipments/${shipmentId}`, { [field]: value || null }); }
    catch { flash('err', 'Save failed'); }
  };

  const shareStatus = (s: Shipment) => {
    const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
    const text = `🚛 ${s.vehicleNo}\n${s.productName} → ${s.customerName}\n${s.destination}\nStatus: ${STATUS_CFG[s.status]?.label}\n${net ? `Net: ${(net / 1000).toFixed(2)} MT\n` : ''}${s.driverName ? `Driver: ${s.driverName}` : ''}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  // ── Bill generation ──
  const openBillForm = (s: Shipment) => {
    const netMT = s.weightNet ? (s.weightNet / 1000) : 0;
    const dr = s.dispatchRequest as any;
    const ol = dr?.orderLine;
    // Auto-fill rate + GST from Sales Order Line
    setBillForm({
      productName: s.productName || dr?.productName || '',
      customerName: s.customerName || dr?.customerName || '',
      quantity: netMT.toFixed(3),
      unit: ol?.unit || (s.productName?.toUpperCase().includes('ETHANOL') ? 'KL' : 'MT'),
      rate: ol?.rate ? String(ol.rate) : '',
      gstPercent: ol?.gstPercent ? String(ol.gstPercent) : '18',
      freightCharge: dr?.freightRate ? String(dr.freightRate) : '0',
      remarks: `Vehicle: ${s.vehicleNo}`,
      challanNo: s.challanNo || '',
      ewayBill: s.ewayBill || '',
    });
    setBillShipment(s);
  };

  const generateBill = async () => {
    if (!billShipment) return;
    const qty = parseFloat(billForm.quantity) || 0;
    const rate = parseFloat(billForm.rate) || 0;
    if (!rate) { flash('err', 'Enter rate'); return; }
    if (!billForm.customerName) { flash('err', 'Customer name required'); return; }

    setBillSaving(true);
    try {
      // Find or use customer — search by name
      const custRes = await api.get('/customers', { params: { search: billForm.customerName } });
      const customers = custRes.data.customers || custRes.data || [];
      let customerId = customers[0]?.id;
      if (!customerId) {
        // Create minimal customer
        const newCust = await api.post('/customers', { name: billForm.customerName });
        customerId = newCust.data.id || newCust.data.customer?.id;
      }

      const invoiceData = {
        customerId,
        shipmentId: billShipment.id,
        productName: billForm.productName,
        quantity: qty,
        unit: billForm.unit,
        rate,
        gstPercent: parseFloat(billForm.gstPercent) || 0,
        freightCharge: parseFloat(billForm.freightCharge) || 0,
        challanNo: billForm.challanNo || null,
        ewayBill: billForm.ewayBill || null,
        remarks: billForm.remarks || null,
      };

      const res = await api.post('/invoices', invoiceData);
      const inv = res.data;
      // Update shipment invoiceRef
      if (inv.invoiceNo) {
        await api.put(`/shipments/${billShipment.id}`, { invoiceRef: `INV-${inv.invoiceNo}` });
      }
      flash('ok', `Bill #${inv.invoiceNo} created — ₹${inv.totalAmount?.toLocaleString('en-IN')}`);
      setBillShipment(null);
      load();
    } catch (e: any) {
      flash('err', e?.response?.data?.error || 'Bill creation failed');
    }
    setBillSaving(false);
  };

  // ── Stats ──
  const stats = useMemo(() => ({
    total: shipments.length,
    atGate: shipments.filter(s => s.status === 'GATE_IN').length,
    tared: shipments.filter(s => s.status === 'TARE_WEIGHED').length,
    loading: shipments.filter(s => s.status === 'LOADING').length,
    loaded: shipments.filter(s => s.status === 'GROSS_WEIGHED').length,
    released: shipments.filter(s => s.status === 'RELEASED').length,
  }), [shipments]);

  const fmtTon = (kg?: number) => kg ? (kg / 1000).toFixed(2) : null;
  const timeSince = (iso?: string) => {
    if (!iso) return null;
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h${mins % 60}m`;
  };

  /* ── The single next-action for each truck (shown as primary button) ── */
  const NextAction = ({ s }: { s: Shipment }) => {
    const isSaving = saving === s.id;
    const isWeighing = weighing?.id === s.id;

    // GATE_IN → show weight input directly (1 click to open, Enter to save)
    if (s.status === 'GATE_IN') {
      if (isWeighing) return null; // input shown below
      return (
        <button onClick={() => { setWeighing({ id: s.id, type: 'tare' }); setWeighVal(''); }}
          className="px-2 py-1 bg-slate-700 text-white rounded text-[10px] font-bold flex items-center gap-1 hover:bg-slate-800 active:scale-95">
          <Scale size={10} /> Tare
        </button>
      );
    }
    // TARE_WEIGHED → shouldn't normally appear because we auto-advance to LOADING, but just in case
    if (s.status === 'TARE_WEIGHED') {
      return (
        <button onClick={() => doStatus(s.id, 'LOADING', { loadStartTime: new Date().toISOString() })}
          disabled={isSaving}
          className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700 active:scale-95 disabled:opacity-50">
          {isSaving ? <Loader2 size={10} className="animate-spin" /> : '▶ Start Load'}
        </button>
      );
    }
    // LOADING → Gross weigh
    if (s.status === 'LOADING') {
      if (isWeighing) return null;
      return (
        <button onClick={() => { setWeighing({ id: s.id, type: 'gross' }); setWeighVal(''); }}
          className="px-2 py-1 bg-amber-600 text-white rounded text-[10px] font-bold flex items-center gap-1 hover:bg-amber-700 active:scale-95">
          <Scale size={10} /> Gross
        </button>
      );
    }
    // GROSS_WEIGHED → ① Bill → ② Pay (ADVANCE/COD only) → ③ EWB (+IRN) → Release
    if (s.status === 'GROSS_WEIGHED') {
      const needsPayment = s.paymentStatus === 'PENDING';
      const isPaid = s.paymentStatus === 'CONFIRMED' || s.paymentStatus === 'NOT_REQUIRED';
      const hasBill = !!s.invoiceRef;
      const hasEwb = !!s.ewayBill;

      return (
        <div className="flex items-center gap-1 flex-wrap">
          {/* ① Bill — always first */}
          {!hasBill && (
            <button onClick={() => openBillForm(s)}
              className="px-2 py-1 bg-purple-600 text-white rounded text-[10px] font-bold flex items-center gap-0.5 hover:bg-purple-700 active:scale-95">
              <FileText size={9} /> ① Bill
            </button>
          )}
          {hasBill && (
            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold flex items-center gap-0.5">
              <CheckCircle size={8} /> {s.invoiceRef}
            </span>
          )}

          {/* ② Payment gate — after bill, before EWB (ADVANCE/COD only) */}
          {hasBill && needsPayment && (
            <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-[9px] font-bold flex items-center gap-0.5 animate-pulse"
              title="Accounts team must confirm payment from Accounts → Payment Desk">
              <Clock size={8} /> ② Awaiting Payment
            </span>
          )}
          {hasBill && s.paymentStatus === 'CONFIRMED' && (
            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold flex items-center gap-0.5">
              <CheckCircle size={8} /> Paid
            </span>
          )}

          {/* ③ EWB — only after bill AND payment confirmed */}
          {hasBill && isPaid && !hasEwb && s.dispatchRequestId && (
            <button onClick={() => generateEwb(s)} disabled={ewbLoading === s.id}
              className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] font-bold flex items-center gap-0.5 hover:bg-indigo-700 active:scale-95 disabled:opacity-50">
              {ewbLoading === s.id ? <Loader2 size={9} className="animate-spin" /> : <Truck size={9} />} ③ EWB
            </button>
          )}
          {hasBill && needsPayment && !hasEwb && s.dispatchRequestId && (
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-[9px] font-bold" title="Confirm payment before generating EWB">
              <Truck size={8} /> EWB
            </span>
          )}
          {!hasBill && !hasEwb && s.dispatchRequestId && (
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-[9px] font-bold" title="Create Invoice first">
              <Truck size={8} /> EWB
            </span>
          )}
          {hasEwb && (
            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[9px] font-bold flex items-center gap-0.5">
              <Truck size={8} /> {s.ewayBill}
            </span>
          )}

          {/* Release — only after EWB (or if no DR / standalone) */}
          <button onClick={() => doStatus(s.id, 'RELEASED', { releaseTime: new Date().toISOString() })}
            disabled={isSaving || needsPayment}
            title={needsPayment ? 'Confirm payment first' : 'Release truck'}
            className="px-2 py-1 bg-orange-600 text-white rounded text-[10px] font-bold hover:bg-orange-700 active:scale-95 disabled:opacity-50">
            {isSaving ? <Loader2 size={10} className="animate-spin" /> : '🔓 Release'}
          </button>
        </div>
      );
    }
    // RELEASED → Exit (with doc check)
    if (s.status === 'RELEASED') {
      return (
        <button onClick={() => handleExit(s)}
          disabled={isSaving}
          className="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold hover:bg-emerald-700 active:scale-95 disabled:opacity-50">
          {isSaving ? <Loader2 size={10} className="animate-spin" /> : '🚀 Gate Out'}
        </button>
      );
    }
    // EXITED
    if (s.status === 'EXITED') {
      return <span className="text-green-600 text-[10px] font-bold flex items-center gap-0.5"><CheckCircle size={10} /> Done</span>;
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-4 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <h1 className="text-base font-bold flex items-center gap-1.5"><Scale size={16} /> Weighbridge</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowGPForm(true)}
              className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 hover:bg-emerald-700 active:scale-95">
              <ClipboardList size={12} /> Gate Pass
            </button>
            <span className="text-[10px] text-slate-400">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {[
            { l: 'Gate', c: stats.atGate, bg: 'bg-slate-600' },
            { l: 'Tare', c: stats.tared, bg: 'bg-blue-600' },
            { l: 'Loading', c: stats.loading, bg: 'bg-amber-600' },
            { l: 'Loaded', c: stats.loaded, bg: 'bg-orange-600' },
            { l: 'Out', c: stats.released, bg: 'bg-emerald-600' },
            { l: 'All', c: stats.total, bg: 'bg-white/10' },
          ].map(s => (
            <div key={s.l} className={`${s.bg} rounded-md px-2.5 py-1 text-center min-w-[44px]`}>
              <div className="text-sm font-bold leading-tight">{s.c}</div>
              <div className="text-[8px] text-white/70">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 py-2">
        {msg && (
          <div className={`rounded-lg p-2.5 mb-2 text-xs flex items-start gap-1.5 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            <span className="mt-0.5 shrink-0">{msg.type === 'ok' ? <CheckCircle size={13} /> : <AlertCircle size={13} />}</span>
            <span className="flex-1 font-medium">{msg.text}</span>
            <button onClick={() => setMsg(null)} className="shrink-0 ml-2 opacity-60 hover:opacity-100"><X size={13} /></button>
          </div>
        )}

        {/* Filter pills */}
        <div className="flex gap-1 mb-2 overflow-x-auto pb-0.5">
          {[
            { key: 'ALL', label: 'All', count: shipments.length },
            { key: 'GATE_IN', label: 'Gate', count: stats.atGate },
            { key: 'LOADING', label: 'Loading', count: stats.loading },
            { key: 'GROSS_WEIGHED', label: 'Loaded', count: stats.loaded },
            { key: 'RELEASED', label: 'Released', count: stats.released },
          ].map(tab => (
            <button key={tab.key} onClick={() => setFilterStatus(tab.key)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                filterStatus === tab.key ? 'bg-slate-800 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              }`}>
              {tab.label} {tab.count > 0 && `(${tab.count})`}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="text-center py-16 text-gray-400"><Loader2 size={28} className="animate-spin mx-auto mb-2" /><p className="text-xs">Loading...</p></div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16"><Truck size={40} className="mx-auto text-gray-300 mb-2" /><p className="text-gray-400 text-sm">No active vehicles</p></div>
        ) : (
          <div className="space-y-2">
            {grouped.map(([drId, group]) => {
              const dr = group.dr;
              const orderQty = dr?.quantity || 0;
              const orderUnit = dr?.unit || 'MT';
              const isUnlinked = drId === 'unlinked';
              const exitedNetMT = group.shipments.filter(s => s.status === 'EXITED').reduce((sum, s) => {
                const n = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
                return sum + (n ? n / 1000 : 0);
              }, 0);
              const pct = orderQty > 0 ? Math.min(100, (exitedNetMT / orderQty) * 100) : 0;

              return (
                <div key={drId} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  {/* Order header */}
                  <div className="px-3 py-1.5 bg-gray-50/80 border-b flex items-center gap-2">
                    {dr?.drNo ? (
                      <span className="bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-px rounded">#{dr.drNo}</span>
                    ) : (
                      <span className="bg-gray-400 text-white text-[9px] font-bold px-1.5 py-px rounded">—</span>
                    )}
                    <span className="font-semibold text-xs text-gray-800 truncate">{dr?.customerName || 'Unlinked Trucks'}</span>
                    {dr?.productName && <span className="text-[10px] text-gray-400 hidden sm:inline">• {dr.productName}</span>}
                    {orderQty > 0 && (
                      <div className="ml-auto flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px]">
                          <span className="font-bold text-green-700">{exitedNetMT.toFixed(1)}</span>
                          <span className="text-gray-400">/{orderQty}{orderUnit}</span>
                        </span>
                        <div className="w-10 h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-[9px] font-bold ${pct >= 100 ? 'text-green-600' : 'text-indigo-600'}`}>{pct.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>

                  {/* Vehicle rows */}
                  {group.shipments.map(s => {
                    const cfg = STATUS_CFG[s.status];
                    const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                    const stepIdx = STATUS_FLOW.indexOf(s.status);
                    const tareTon = fmtTon(s.weightTare);
                    const grossTon = fmtTon(s.weightGross);
                    const netTon = net ? (net / 1000).toFixed(2) : null;
                    const docs = s.documents || [];
                    const isExp = expandedId === s.id;
                    const isWeighingThis = weighing?.id === s.id;
                    const elapsed = timeSince(s.gateInTime);

                    return (
                      <div key={s.id} className={`border-b last:border-b-0 ${isExp ? 'bg-slate-50/40' : ''}`}>
                        {/* ── Main row ── */}
                        <div className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setExpandedId(isExp ? null : s.id)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
                              <Truck size={11} className="text-gray-400 shrink-0" />
                              <span className="font-bold text-[13px] text-gray-900">{s.vehicleNo}</span>
                              <span className={`text-[8px] font-bold px-1.5 py-px rounded-full ${cfg.badge}`}>{cfg.label}</span>
                              {elapsed && <span className="text-[9px] text-gray-400 flex items-center gap-0.5"><Clock size={8} />{elapsed}</span>}
                              <ChevronDown size={10} className={`text-gray-300 shrink-0 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Weight chips */}
                            <div className="flex items-center gap-1 shrink-0">
                              {tareTon && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 py-px rounded font-medium">T:{tareTon}</span>}
                              {grossTon && <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-px rounded font-medium">G:{grossTon}</span>}
                              {netTon && <span className="text-[9px] bg-green-50 text-green-700 px-1.5 py-px rounded font-bold ring-1 ring-green-200">{netTon}T</span>}
                            </div>

                            {/* Doc badges on main row */}
                            {docs.length > 0 && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                {DOC_TYPES.map(dt => {
                                  const has = docs.some(d => d.docType === dt.key);
                                  return has ? (
                                    <span key={dt.key} className="text-[7px] font-bold px-1 py-px rounded bg-green-100 text-green-700">{dt.label.split(' ')[0]}</span>
                                  ) : null;
                                })}
                              </div>
                            )}

                            {/* Delete for unlinked */}
                            {isUnlinked && (
                              <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(s); }}
                                className="text-gray-300 hover:text-red-500 p-0.5 transition-colors shrink-0">
                                <Trash2 size={12} />
                              </button>
                            )}

                            <NextAction s={s} />
                          </div>

                          {/* Inline weigh input */}
                          {isWeighingThis && (
                            <div className="flex gap-1.5 items-center mt-1.5 bg-blue-50 rounded-lg p-1.5">
                              <Scale size={12} className="text-blue-500 shrink-0" />
                              <input ref={weighRef} type="number" step="0.01" value={weighVal} onChange={e => setWeighVal(e.target.value)}
                                placeholder={`${weighing.type === 'tare' ? 'Tare' : 'Gross'} weight (Tons)`}
                                className="flex-1 px-2 py-1 text-sm border rounded-md bg-white focus:ring-2 focus:ring-blue-300 outline-none"
                                onKeyDown={e => e.key === 'Enter' && doWeigh(s.id, weighing.type)} />
                              <button onClick={() => doWeigh(s.id, weighing.type)} disabled={saving === s.id}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded-md font-semibold hover:bg-blue-700 disabled:opacity-50">
                                {saving === s.id ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                              </button>
                              <button onClick={() => setWeighing(null)} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={14} /></button>
                            </div>
                          )}

                          {/* Progress bar */}
                          <div className="flex gap-px mt-1">
                            {STATUS_FLOW.map((st, i) => (
                              <div key={st} className={`h-[2px] flex-1 rounded-full ${
                                i <= stepIdx ? (i === stepIdx && stepIdx < 5 ? 'bg-blue-400 animate-pulse' : 'bg-green-400') : 'bg-gray-200'
                              }`} />
                            ))}
                          </div>
                        </div>

                        {/* ── Expanded panel ── */}
                        {isExp && (
                          <div className="border-t border-gray-100 px-3 py-2 bg-gray-50/50 space-y-2">
                            {/* Gate Pass type badge */}
                            {s.gatePassType && (
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  s.gatePassType === 'RETURNABLE' ? 'bg-blue-100 text-blue-700' :
                                  s.gatePassType === 'SALE' ? 'bg-green-100 text-green-700' :
                                  s.gatePassType === 'JOB_WORK' ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {s.gatePassType.replace('_', '-')} GATE PASS
                                </span>
                                {s.partyName && <span className="text-[10px] text-gray-500">→ {s.partyName}</span>}
                                {s.purpose && <span className="text-[10px] text-gray-400">({s.purpose})</span>}
                              </div>
                            )}

                            {/* Driver row */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                              {s.driverName && <span className="text-gray-700 font-medium">🧑 {s.driverName}</span>}
                              {s.driverMobile && (
                                <a href={`tel:${s.driverMobile}`} className="text-blue-600 flex items-center gap-0.5"><Phone size={10} /> {s.driverMobile}</a>
                              )}
                              {s.transporterName && <span className="text-gray-400">🚚 {s.transporterName}</span>}
                              {s.destination && <span className="text-gray-400 flex items-center gap-0.5"><MapPin size={10} /> {s.destination}</span>}
                              <div className="ml-auto flex gap-1">
                                <button onClick={() => shareStatus(s)} className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[9px] font-medium flex items-center gap-0.5 hover:bg-gray-300">
                                  <Share2 size={9} /> Share
                                </button>
                                {s.driverMobile && (
                                  <a href={`https://api.whatsapp.com/send?phone=91${s.driverMobile.replace(/\D/g, '').slice(-10)}`}
                                    target="_blank" rel="noopener"
                                    className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-medium flex items-center gap-0.5 hover:bg-green-200">
                                    <MessageCircle size={9} /> WA
                                  </a>
                                )}
                              </div>
                            </div>

                            {/* Weights */}
                            <div className="grid grid-cols-3 gap-1.5">
                              {[
                                { label: 'Tare', val: tareTon, time: s.tareTime, color: 'blue' },
                                { label: 'Gross', val: grossTon, time: s.grossTime, color: 'amber' },
                                { label: 'Net', val: netTon, time: null, color: netTon ? 'green' : 'gray' },
                              ].map(w => (
                                <div key={w.label} className={`bg-${w.color}-50 rounded-lg p-1.5 text-center`}>
                                  <div className={`text-[8px] text-${w.color}-400 font-bold uppercase`}>{w.label}</div>
                                  <div className={`text-xs font-bold text-${w.color}-700`}>{w.val ? `${w.val} T` : '—'}</div>
                                  {w.time && <div className={`text-[8px] text-${w.color}-300`}>{new Date(w.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>}
                                </div>
                              ))}
                            </div>

                            {/* ═══ DOCUMENT FLOW ═══ */}
                            <div className="space-y-3">
                              {/* Flow tracker — shows current step */}
                              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Document Flow</div>
                              <div className="flex items-center gap-0.5 text-[9px] font-bold overflow-x-auto pb-1">
                                {[
                                  { label: 'Gate In', done: true },
                                  { label: 'Weighed', done: !!s.weightNet },
                                  { label: 'Invoice', done: !!s.invoiceRef },
                                  { label: 'e-Invoice', done: !!s.irn },
                                  { label: 'E-Way Bill', done: !!s.ewayBill },
                                  { label: 'Released', done: s.status === 'RELEASED' || s.status === 'EXITED' },
                                ].map((step, i, arr) => (
                                  <span key={step.label} className="flex items-center gap-0.5 whitespace-nowrap">
                                    <span className={`px-1.5 py-0.5 rounded ${step.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                                      {step.done ? '✓' : (i + 1)} {step.label}
                                    </span>
                                    {i < arr.length - 1 && <span className="text-gray-300">→</span>}
                                  </span>
                                ))}
                              </div>

                              {/* Action buttons — generate documents */}
                              {s.weightNet && (
                                <div className="space-y-1.5">
                                  <div className="flex gap-2">
                                    {/* Invoice */}
                                    {!s.invoiceRef ? (
                                      <button onClick={() => openBillForm(s)}
                                        className="flex-1 py-1.5 text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 rounded-lg flex items-center justify-center gap-1 hover:bg-purple-100">
                                        <FileText size={11} /> Generate Invoice
                                      </button>
                                    ) : (
                                      <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/invoices/${s.linkedInvoiceId}/pdf?token=${token}`, '_blank'); }}
                                        className="flex-1 py-1.5 text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200 rounded-lg flex items-center justify-center gap-1 hover:bg-green-100">
                                        <CheckCircle size={11} /> {s.invoiceRef} — View
                                      </button>
                                    )}
                                    {/* EWB */}
                                    {!s.ewayBill && s.dispatchRequestId && s.invoiceRef ? (
                                      <button onClick={() => generateEwb(s)} disabled={ewbLoading === s.id}
                                        className="flex-1 py-1.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg flex items-center justify-center gap-1 hover:bg-indigo-100 disabled:opacity-50">
                                        {ewbLoading === s.id ? <Loader2 size={11} className="animate-spin" /> : <Truck size={11} />}
                                        {ewbLoading === s.id ? 'Generating...' : 'e-Invoice + EWB'}
                                      </button>
                                    ) : !s.ewayBill && s.dispatchRequestId && !s.invoiceRef ? (
                                      <span className="flex-1 py-1.5 text-[10px] font-semibold bg-gray-50 text-gray-400 border border-gray-200 rounded-lg flex items-center justify-center gap-1">
                                        <Truck size={11} /> EWB (needs Invoice)
                                      </span>
                                    ) : s.ewayBill ? (
                                      <span className="flex-1 py-1.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg flex items-center justify-center gap-1">
                                        <CheckCircle size={11} /> EWB: {s.ewayBill}
                                      </span>
                                    ) : null}
                                  </div>

                                  {/* Cancel IRN button — only if IRN exists and not already cancelled */}
                                  {s.irn && s.irnStatus !== 'CANCELLED' && (
                                    <div className="flex gap-2">
                                      <button onClick={async () => {
                                        if (!confirm(`Cancel e-Invoice IRN for ${s.invoiceRef || 'this shipment'}?\n\nReason: Data entry mistake\n\nThis cannot be undone after 24 hours.`)) return;
                                        try {
                                          const token = localStorage.getItem('token');
                                          const r = await fetch(`/api/shipments/${s.id}/cancel-irn`, {
                                            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                            body: JSON.stringify({ reason: '2', remarks: 'Cancelled from ERP' }),
                                          });
                                          const d = await r.json();
                                          if (d.success) { flash('ok', `IRN cancelled. ${d.cancelDate ? 'Date: ' + d.cancelDate : ''}`); fetchShipments(); }
                                          else flash('err', `Cancel failed: ${d.error}`);
                                        } catch (e: any) { flash('err', e.message); }
                                      }}
                                        className="flex-1 py-1 text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-center justify-center gap-1 hover:bg-red-100">
                                        Cancel IRN
                                      </button>
                                    </div>
                                  )}
                                  {s.irnStatus === 'CANCELLED' && (
                                    <span className="text-[10px] font-semibold text-red-500">IRN Cancelled</span>
                                  )}

                                  {/* Generated Document PDFs — view buttons */}
                                  <div className="text-[9px] font-bold text-gray-400 uppercase mt-2">View Documents</div>
                                  <div className="flex gap-1.5 flex-wrap">
                                    <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/shipments/${s.id}/challan-pdf?token=${token}`, '_blank'); }}
                                      className="py-1 px-2.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg flex items-center gap-1 hover:bg-blue-100">
                                      <FileText size={10} /> Challan
                                    </button>
                                    {s.gatePassType && (
                                      <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/shipments/${s.id}/gate-pass-pdf?token=${token}`, '_blank'); }}
                                        className="py-1 px-2.5 text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 rounded-lg flex items-center gap-1 hover:bg-teal-100">
                                        <ClipboardList size={10} /> Gate Pass
                                      </button>
                                    )}
                                    {s.linkedInvoiceId && (
                                      <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/invoices/${s.linkedInvoiceId}/pdf?token=${token}`, '_blank'); }}
                                        className="py-1 px-2.5 text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 rounded-lg flex items-center gap-1 hover:bg-purple-100">
                                        <FileText size={10} /> Invoice
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* ═══ GATE ENTRY DETAILS ═══ */}
                            <div className="space-y-2">
                              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Gate Entry Details</div>
                              <div className="grid grid-cols-4 gap-1.5">
                                {DOC_TYPES.map(dt => {
                                  const fieldVal = (s as any)[dt.field] || '';
                                  return (
                                    <div key={dt.key}>
                                      <label className="text-[9px] text-gray-400 font-medium">{dt.label} No</label>
                                      <input defaultValue={fieldVal} placeholder={`${dt.label} No`}
                                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:ring-1 focus:ring-blue-200 outline-none"
                                        onBlur={(e) => { if (e.target.value !== fieldVal) saveField(s.id, dt.field, e.target.value); }}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                              {/* GR/Bilty date */}
                              {s.grBiltyNo && (
                                <input type="date" defaultValue={s.grBiltyDate || ''}
                                  className="px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:ring-1 focus:ring-blue-200 outline-none"
                                  onBlur={(e) => { if (e.target.value !== (s.grBiltyDate || '')) saveField(s.id, 'grBiltyDate', e.target.value); }}
                                />
                              )}
                            </div>

                            {/* ═══ UPLOAD DOCUMENTS ═══ */}
                            <div className="space-y-2">
                              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Upload Documents</div>
                              <div className="grid grid-cols-4 gap-1.5">
                                {DOC_TYPES.map(dt => {
                                  const hasDoc = docs.some(d => d.docType === dt.key);
                                  const isUploading = uploadingDoc === `${s.id}_${dt.key}`;
                                  return (
                                    <div key={dt.key} className={`rounded-lg border p-1.5 text-center ${hasDoc ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
                                      <div className="text-[9px] font-bold text-gray-700 mb-1">{hasDoc ? '✓' : ''} {dt.label}</div>
                                      <div className="flex gap-0.5">
                                        <button onClick={() => uploadDoc(s.id, dt.key, 'camera')} disabled={isUploading}
                                          className="flex-1 py-1 rounded text-[8px] font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50">
                                          {isUploading ? '...' : '📷'}
                                        </button>
                                        <button onClick={() => uploadDoc(s.id, dt.key, 'gallery')} disabled={isUploading}
                                          className="flex-1 py-1 rounded text-[8px] font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50">
                                          🖼
                                        </button>
                                        <button onClick={() => uploadDoc(s.id, dt.key, 'file')} disabled={isUploading}
                                          className="flex-1 py-1 rounded text-[8px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                                          📎
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payment confirmation moved to Accounts → Payment Desk */}

      {/* ── Exit confirm modal (missing docs warning) ── */}
      {exitConfirm && (() => {
        const s = exitConfirm;
        const docs = s.documents || [];
        const missing = DOC_TYPES.filter(dt => !docs.some(d => d.docType === dt.key));
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setExitConfirm(null)}>
            <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle size={20} className="text-amber-500" />
                  <h3 className="font-bold text-sm">Missing Documents</h3>
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  <span className="font-bold">{s.vehicleNo}</span> is missing {missing.length} document{missing.length > 1 ? 's' : ''}:
                </p>
                <div className="flex flex-wrap gap-1 mb-4">
                  {missing.map(m => (
                    <span key={m.key} className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-medium rounded-full border border-red-200">
                      ✗ {m.label}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setExitConfirm(null); setExpandedId(s.id); }}
                    className="flex-1 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Upload Docs
                  </button>
                  <button onClick={() => { setExitConfirm(null); doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() }); }}
                    className="flex-1 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    Exit Anyway
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Delete confirm modal ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trash2 size={20} className="text-red-500" />
                <h3 className="font-bold text-sm">Delete Truck?</h3>
              </div>
              <p className="text-xs text-gray-600 mb-4">
                Remove <span className="font-bold">{deleteConfirm.vehicleNo}</span> from the weighbridge? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                  Cancel
                </button>
                <button onClick={() => doDelete(deleteConfirm.id)} disabled={saving === deleteConfirm.id}
                  className="flex-1 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                  {saving === deleteConfirm.id ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Generate Bill modal ── */}
      {billShipment && (() => {
        const qty = parseFloat(billForm.quantity) || 0;
        const rate = parseFloat(billForm.rate) || 0;
        const amount = qty * rate;
        const gst = (amount * (parseFloat(billForm.gstPercent) || 0)) / 100;
        const freight = parseFloat(billForm.freightCharge) || 0;
        const total = amount + gst + freight;

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-2" onClick={() => setBillShipment(null)}>
            <div className="bg-white rounded-xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-sm flex items-center gap-1.5"><FileText size={16} className="text-purple-600" /> Generate Bill</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5">{billShipment.vehicleNo} — Net: {billShipment.weightNet ? (billShipment.weightNet / 1000).toFixed(3) : '—'} MT</p>
                  </div>
                  <button onClick={() => setBillShipment(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>

                {/* Form */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Customer</label>
                      <input value={billForm.customerName} onChange={e => setBillForm(f => ({ ...f, customerName: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-200 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Product</label>
                      <input value={billForm.productName} onChange={e => setBillForm(f => ({ ...f, productName: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-200 outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Quantity</label>
                      <input type="number" step="0.001" value={billForm.quantity} onChange={e => setBillForm(f => ({ ...f, quantity: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-200 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Unit</label>
                      <select value={billForm.unit} onChange={e => setBillForm(f => ({ ...f, unit: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-200 outline-none bg-white">
                        <option>MT</option><option>KL</option><option>BL</option><option>TON</option><option>KG</option><option>BAG</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-purple-600 uppercase">Rate (₹)*</label>
                      <input type="number" step="0.01" value={billForm.rate} onChange={e => setBillForm(f => ({ ...f, rate: e.target.value }))}
                        placeholder="Enter rate"
                        className="w-full px-2 py-1.5 text-xs border-2 border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-300 outline-none bg-purple-50" autoFocus />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">GST %</label>
                      <input type="number" step="0.01" value={billForm.gstPercent} onChange={e => setBillForm(f => ({ ...f, gstPercent: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-200 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Freight (₹)</label>
                      <input type="number" step="0.01" value={billForm.freightCharge} onChange={e => setBillForm(f => ({ ...f, freightCharge: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-200 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Challan No</label>
                      <input value={billForm.challanNo} onChange={e => setBillForm(f => ({ ...f, challanNo: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-200 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Remarks</label>
                    <input value={billForm.remarks} onChange={e => setBillForm(f => ({ ...f, remarks: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-200 outline-none" />
                  </div>
                </div>

                {/* Summary */}
                <div className="mt-3 bg-gray-50 rounded-lg p-2.5 space-y-1">
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Amount ({qty} × ₹{rate.toLocaleString('en-IN')})</span>
                    <span>₹{amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>GST ({billForm.gstPercent}%)</span>
                    <span>₹{gst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                  {freight > 0 && (
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>Freight</span>
                      <span>₹{freight.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-gray-900 border-t pt-1">
                    <span>Total</span>
                    <span>₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setBillShipment(null)}
                    className="flex-1 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    Cancel
                  </button>
                  <button onClick={generateBill} disabled={billSaving || !billForm.rate}
                    className="flex-1 py-2 text-xs font-bold bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1">
                    {billSaving ? <Loader2 size={14} className="animate-spin" /> : <><FileText size={12} /> Generate Bill</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Gate Pass Form modal ── */}
      {showGPForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-2 pt-8 overflow-y-auto" onClick={() => setShowGPForm(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm flex items-center gap-1.5"><ClipboardList size={16} className="text-emerald-600" /> New Gate Pass</h3>
                <button onClick={() => setShowGPForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>

              <div className="space-y-2">
                {/* Quick-pick: vehicles at gate without gate pass */}
                {(() => {
                  const noGP = shipments.filter(s => s.vehicleNo && !s.gatePassType && s.status !== 'EXITED' && s.status !== 'CANCELLED');
                  return noGP.length > 0 ? (
                    <div>
                      <label className="text-[10px] font-bold text-emerald-600 uppercase">Select Vehicle at Gate (no gate pass yet)</label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {noGP.map(s => (
                          <button key={s.id} onClick={() => onGPVehicleChange(s.vehicleNo)}
                            className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${gpForm.vehicleNo === s.vehicleNo ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50'}`}>
                            {s.vehicleNo}
                            <span className="ml-1 font-normal text-[10px] opacity-70">{s.customerName?.split(' ')[0] || s.productName}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Type + Purpose */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Type</label>
                    <select value={gpForm.gatePassType} onChange={e => setGpForm(f => ({ ...f, gatePassType: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 outline-none">
                      <option value="RETURNABLE">Returnable</option>
                      <option value="NON_RETURNABLE">Non-Returnable</option>
                      <option value="JOB_WORK">Job Work</option>
                      <option value="SALE">Sale</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Purpose</label>
                    <input value={gpForm.purpose} onChange={e => setGpForm(f => ({ ...f, purpose: e.target.value }))}
                      placeholder="e.g. Deshelling & Reshelling"
                      className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-emerald-200 outline-none" />
                  </div>
                </div>

                {/* Party */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-emerald-600 uppercase">Party Name *</label>
                    <input value={gpForm.partyName} onChange={e => setGpForm(f => ({ ...f, partyName: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs border-2 border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-200 outline-none bg-emerald-50" autoFocus />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">GSTIN</label>
                    <input value={gpForm.partyGstin} onChange={e => setGpForm(f => ({ ...f, partyGstin: e.target.value }))}
                      placeholder="e.g. 09AGOPS9267M1Z5"
                      className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-emerald-200 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase">Party Address</label>
                  <input value={gpForm.partyAddress} onChange={e => setGpForm(f => ({ ...f, partyAddress: e.target.value }))}
                    className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-emerald-200 outline-none" />
                </div>

                {/* Linked shipment info */}
                {gpLinkedShipment && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-xs space-y-1">
                    <div className="font-bold text-emerald-700 flex items-center gap-1"><CheckCircle size={12} /> Linked to Shipment #{gpLinkedShipment.id.slice(-6)}</div>
                    <div className="flex gap-3 text-gray-600">
                      {gpLinkedShipment.invoiceRef && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold">Bill: {gpLinkedShipment.invoiceRef}</span>}
                      {gpLinkedShipment.ewayBill && <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">E-Way: {gpLinkedShipment.ewayBill}</span>}
                      {gpLinkedShipment.challanNo && <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-semibold">Challan: {gpLinkedShipment.challanNo}</span>}
                      {!gpLinkedShipment.invoiceRef && !gpLinkedShipment.ewayBill && <span className="text-amber-600">⚠ No bill/e-way yet</span>}
                    </div>
                    <div className="text-gray-500">{gpLinkedShipment.productName} • {gpLinkedShipment.weightNet ? (gpLinkedShipment.weightNet / 1000).toFixed(3) + ' MT' : '—'} • {gpLinkedShipment.customerName}</div>
                  </div>
                )}

                {/* Vehicle */}
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-emerald-600 uppercase">Vehicle *</label>
                    <input value={gpForm.vehicleNo} onChange={e => onGPVehicleChange(e.target.value.toUpperCase())}
                      placeholder="e.g. MP09EF34"
                      className="w-full px-2 py-1.5 text-xs border-2 border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-200 outline-none bg-emerald-50" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Driver</label>
                    <input value={gpForm.driverName} onChange={e => setGpForm(f => ({ ...f, driverName: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-emerald-200 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Mobile</label>
                    <input value={gpForm.driverMobile} onChange={e => setGpForm(f => ({ ...f, driverMobile: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-emerald-200 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Transporter</label>
                    <input value={gpForm.transporterName} onChange={e => setGpForm(f => ({ ...f, transporterName: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-emerald-200 outline-none" />
                  </div>
                </div>

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Items</label>
                    <button onClick={addGPItem} className="text-[10px] text-emerald-600 font-bold flex items-center gap-0.5 hover:text-emerald-700">
                      <Plus size={10} /> Add Item
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {gpForm.items.map((item, i) => (
                      <div key={i} className="flex gap-1 items-start">
                        <input value={item.desc} onChange={e => updateGPItem(i, 'desc', e.target.value)}
                          placeholder="Description" className="flex-[3] px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-emerald-200 outline-none" />
                        <input value={item.hsnCode} onChange={e => updateGPItem(i, 'hsnCode', e.target.value)}
                          placeholder="HSN" className="flex-1 px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-emerald-200 outline-none" />
                        <input type="number" value={item.qty} onChange={e => updateGPItem(i, 'qty', e.target.value)}
                          placeholder="Qty" className="w-12 px-1 py-1 text-xs border rounded text-center focus:ring-1 focus:ring-emerald-200 outline-none" />
                        <input type="number" value={item.value} onChange={e => updateGPItem(i, 'value', e.target.value)}
                          placeholder="Value ₹" className="w-20 px-1 py-1 text-xs border rounded text-right focus:ring-1 focus:ring-emerald-200 outline-none" />
                        {gpForm.items.length > 1 && (
                          <button onClick={() => removeGPItem(i)} className="text-gray-300 hover:text-red-500 mt-0.5"><X size={14} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="text-right text-xs font-bold text-gray-600 mt-1">
                    Total: ₹{gpForm.items.reduce((s, item) => s + (parseFloat(item.value) || 0), 0).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-3">
                <button onClick={() => setShowGPForm(false)}
                  className="flex-1 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                  Cancel
                </button>
                <button onClick={createGatePass} disabled={gpSaving}
                  className="flex-1 py-2 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1">
                  {gpSaving ? <Loader2 size={14} className="animate-spin" /> : <><ClipboardList size={12} /> Create Gate Pass</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
