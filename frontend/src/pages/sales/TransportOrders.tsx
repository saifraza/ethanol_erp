import { useState, useEffect, Fragment } from 'react';
import { Truck, Plus, X, Loader2, CheckCircle2, Ban, Wallet, Trash2, ChevronDown } from 'lucide-react';
import api from '../../services/api';

// ── Types ──
interface WoListRow {
  id: string; twoNo: number; transporterName: string; productType: string;
  contractNo?: string | null; customerName?: string | null; depot: string;
  rateBasis: string; rate: number; status: string;
  subtotal: number; totalAmount: number; netPayable: number; paidAmount: number; balanceAmount: number;
  _count?: { lines: number };
}
interface WoLine {
  id: string; sourceType?: string | null; vehicleNo: string; dispatchDate?: string | null;
  quantity: number; unit: string; amount: number;
}
interface WoPayment {
  id: string; paymentNo: number; amount: number; tdsDeducted: number;
  paymentMode: string; paymentRef?: string | null; paymentDate: string;
}
interface WoDetail extends WoListRow {
  gstPercent: number; cgstAmount: number; sgstAmount: number; igstAmount: number; gstAmount: number;
  tdsPercent: number; tdsAmount: number; supplyType?: string | null; distanceKm?: number | null;
  estimatedDelivery?: string | null; trucksOrdered?: number | null; truckCount?: number | null; qtyPerTruck?: number | null;
  cancelReason?: string | null;
  transporter?: { id: string; name: string; gstin?: string | null; phone?: string | null };
  lines: WoLine[]; payments: WoPayment[];
}
interface Transporter { id: string; name: string; }
interface ContractOpt { id: string; contractNo: string; party: string; defaultDepot: string; }
interface SourceTruck {
  sourceType: string; sourceId: string; vehicleNo: string; dispatchDate?: string | null;
  destination?: string | null; qtyMT?: number; qtyKL?: number; qtyLiters?: number;
  distanceKm?: number | null; billedOnWo?: number | null;
}

const PRODUCTS = ['ETHANOL', 'DDGS', 'WGS', 'SUGAR', 'SCRAP'];
const BASIS_BY_PRODUCT: Record<string, string[]> = {
  ETHANOL: ['PER_LITER', 'PER_KL', 'PER_TRUCK', 'PER_KM'],
  DDGS: ['PER_MT', 'PER_TRUCK', 'PER_KM'],
  WGS: ['PER_MT', 'PER_TRUCK', 'PER_KM'],
  SUGAR: ['PER_MT', 'PER_TRUCK', 'PER_KM'],
  SCRAP: ['PER_TRUCK', 'PER_MT', 'PER_KM'],
};
const BASIS_LABEL: Record<string, string> = {
  PER_TRUCK: '₹ / truck', PER_LITER: '₹ / litre', PER_KL: '₹ / KL', PER_MT: '₹ / MT', PER_KM: '₹ / km',
};

const inputCls = 'border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400';
const labelCls = 'text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block';
const fmtINR = (n: number) => '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const errMsg = (err: unknown, fallback: string) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

const statusCls: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 border-slate-300',
  CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-300',
  PARTIAL_PAID: 'bg-amber-50 text-amber-700 border-amber-300',
  PAID: 'bg-green-50 text-green-700 border-green-300',
  CANCELLED: 'bg-slate-50 text-slate-400 border-slate-200 line-through',
};

// freight for one pulled truck under a basis (mirrors the backend)
function previewAmount(basis: string, rate: number, t: SourceTruck): number {
  const r = Number(rate) || 0;
  switch (basis) {
    case 'PER_TRUCK': return round2(r);
    case 'PER_MT': return round2(r * (t.qtyMT || 0));
    case 'PER_KL': return round2(r * (t.qtyKL || 0));
    case 'PER_LITER': return round2(r * (t.qtyLiters || 0));
    case 'PER_KM': return round2(r * (t.distanceKm || 0));
    default: return 0;
  }
}
function truckQtyLabel(basis: string, t: SourceTruck): string {
  switch (basis) {
    case 'PER_MT': return `${(t.qtyMT || 0).toFixed(2)} MT`;
    case 'PER_KL': return `${(t.qtyKL || 0).toFixed(2)} KL`;
    case 'PER_LITER': return `${(t.qtyLiters || 0).toLocaleString('en-IN')} L`;
    case 'PER_KM': return `${t.distanceKm || 0} km`;
    default: return '1 truck';
  }
}

export default function TransportOrders() {
  const [orders, setOrders] = useState<WoListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // detail
  const [detail, setDetail] = useState<WoDetail | null>(null);

  // create wizard
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    transporterId: '', productType: 'ETHANOL', contractId: '', contractNo: '', customerName: '',
    depot: '', distanceKm: '', estimatedDelivery: '', rateBasis: 'PER_LITER', rate: '', gstPercent: '0', tdsPercent: '0', supplyType: 'INTRA_STATE',
    trucksOrdered: '', truckCount: '', qtyPerTruck: '',
  });
  const [contracts, setContracts] = useState<ContractOpt[]>([]);
  const [trucks, setTrucks] = useState<SourceTruck[]>([]);
  const [depotSuggestions, setDepotSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // pay / cancel modals
  const [payModal, setPayModal] = useState<{ woId: string; balance: number } | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', tdsDeducted: '0', paymentMode: 'NEFT', paymentRef: '', paymentDate: new Date().toISOString().slice(0, 10) });
  const [cancelModal, setCancelModal] = useState<{ woId: string; label: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [usedEdit, setUsedEdit] = useState(''); // actual trucks used, set at final billing

  useEffect(() => { fetchOrders(); fetchTransporters(); }, []);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const res = await api.get('/transport-work-orders');
      setOrders(res.data.orders || []);
    } catch { setError('Failed to load transport work orders'); }
    finally { setLoading(false); }
  };
  const fetchTransporters = async () => {
    try {
      const res = await api.get('/transporters');
      setTransporters(res.data.transporters || res.data || []);
    } catch { /* non-critical */ }
  };

  // ── create wizard helpers ──
  const openCreate = () => {
    setError('');
    setForm({ transporterId: '', productType: 'ETHANOL', contractId: '', contractNo: '', customerName: '', depot: '', distanceKm: '', estimatedDelivery: '', rateBasis: 'PER_LITER', rate: '', gstPercent: '0', tdsPercent: '0', supplyType: 'INTRA_STATE', trucksOrdered: '', truckCount: '', qtyPerTruck: '' });
    setContracts([]); setTrucks([]); setSelected(new Set()); setDepotSuggestions([]);
    setShowCreate(true);
    loadContracts('ETHANOL');
  };

  const loadContracts = async (productType: string) => {
    try {
      const res = await api.get('/transport-work-orders/contracts', { params: { productType } });
      setContracts(res.data.contracts || []);
    } catch { setContracts([]); }
  };

  const onProductChange = (productType: string) => {
    const basis = BASIS_BY_PRODUCT[productType][0];
    setForm(f => ({ ...f, productType, rateBasis: basis, contractId: '', contractNo: '', customerName: '' }));
    setContracts([]); setTrucks([]); setSelected(new Set()); setDepotSuggestions([]);
    loadContracts(productType);
  };

  const onContractChange = async (contractId: string) => {
    const c = contracts.find(x => x.id === contractId);
    setForm(f => ({ ...f, contractId, contractNo: c?.contractNo || '', customerName: c?.party || '', depot: c?.defaultDepot || f.depot }));
    setTrucks([]); setSelected(new Set());
    if (!contractId) return;
    try {
      const res = await api.get('/transport-work-orders/trucks', { params: { productType: form.productType, contractId } });
      setTrucks(res.data.trucks || []);
      setDepotSuggestions(res.data.depots || []);
    } catch { setError('Failed to load dispatched trucks for this contract'); }
  };

  const toggleTruck = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectableTrucks = () => trucks.filter(t => !t.billedOnWo && (!form.depot || (t.destination || '').toLowerCase().includes(form.depot.toLowerCase())));
  const allSelected = () => { const s = selectableTrucks(); return s.length > 0 && s.every(t => selected.has(t.sourceId)); };
  const toggleAll = () => {
    const s = selectableTrucks();
    if (allSelected()) setSelected(new Set());
    else setSelected(new Set(s.map(t => t.sourceId)));
  };

  // live preview totals
  const selectedTrucks = trucks.filter(t => selected.has(t.sourceId));
  const rateNum = Number(form.rate) || 0;
  const pulledSubtotal = selectedTrucks.reduce((s, t) => s + previewAmount(form.rateBasis, rateNum, t), 0);
  // Manual aggregate: N trucks × qty per truck
  const manualCount = Math.trunc(Number(form.truckCount) || 0);
  const manualQtyPer = Number(form.qtyPerTruck) || 0;
  const manualTotalQty = form.rateBasis === 'PER_TRUCK' ? manualCount : round2(manualCount * manualQtyPer);
  const manualSubtotal = round2(rateNum * manualTotalQty);
  const subtotal = round2(pulledSubtotal + manualSubtotal);
  const gstAmount = round2(subtotal * (Number(form.gstPercent) || 0) / 100);
  const tdsAmount = round2(subtotal * (Number(form.tdsPercent) || 0) / 100);
  const totalAmount = round2(subtotal + gstAmount);
  const netPayable = round2(totalAmount - tdsAmount);
  const lineCount = selectedTrucks.length + manualCount;

  const submitCreate = async () => {
    if (!form.transporterId) { setError('Select a transporter'); return; }
    if (!form.depot.trim()) { setError('Enter the depot / destination'); return; }
    if (!(rateNum > 0)) { setError('Enter a rate greater than zero'); return; }
    if (lineCount === 0) { setError('Enter the number of trucks (or select dispatched trucks)'); return; }
    if (manualCount > 0 && form.rateBasis !== 'PER_TRUCK' && !(manualQtyPer > 0)) { setError('Enter the quantity per truck'); return; }
    try {
      setBusy('create');
      await api.post('/transport-work-orders', {
        transporterId: form.transporterId,
        productType: form.productType,
        contractId: form.contractId || null,
        contractNo: form.contractNo || null,
        customerName: form.customerName || null,
        depot: form.depot.trim(),
        distanceKm: form.distanceKm || null,
        estimatedDelivery: form.estimatedDelivery || null,
        rateBasis: form.rateBasis,
        rate: form.rate,
        gstPercent: form.gstPercent,
        tdsPercent: form.tdsPercent,
        supplyType: form.supplyType,
        truckSelections: selectedTrucks.map(t => ({ sourceType: t.sourceType, sourceId: t.sourceId })),
        trucksOrdered: manualCount || undefined,
        truckCount: manualCount || undefined,
        qtyPerTruck: manualQtyPer || undefined,
      });
      setShowCreate(false);
      fetchOrders();
    } catch (err) { setError(errMsg(err, 'Failed to create work order')); }
    finally { setBusy(null); }
  };

  // ── detail + actions ──
  const openDetail = async (id: string) => {
    if (detail?.id === id) { setDetail(null); return; }
    try {
      const res = await api.get(`/transport-work-orders/${id}`);
      setDetail(res.data.wo);
      setUsedEdit(res.data.wo.truckCount != null ? String(res.data.wo.truckCount) : '');
    } catch { setError('Failed to load work order'); }
  };
  const refreshDetail = async (id: string) => {
    try { const res = await api.get(`/transport-work-orders/${id}`); setDetail(res.data.wo); setUsedEdit(res.data.wo.truckCount != null ? String(res.data.wo.truckCount) : ''); } catch { /* ignore */ }
  };

  // Set the actual trucks used (final billing) on a DRAFT manual WO, then recompute.
  const updateUsed = async (id: string) => {
    try { setBusy(id); await api.put(`/transport-work-orders/${id}`, { truckCount: Number(usedEdit) || 0 }); await refreshDetail(id); fetchOrders(); }
    catch (err) { setError(errMsg(err, 'Failed to update trucks used')); }
    finally { setBusy(null); }
  };

  const confirmWo = async (id: string) => {
    try { setBusy(id); await api.post(`/transport-work-orders/${id}/confirm`); await refreshDetail(id); fetchOrders(); }
    catch (err) { setError(errMsg(err, 'Failed to confirm')); }
    finally { setBusy(null); }
  };
  const deleteWo = async (id: string) => {
    if (!confirm('Delete this draft work order?')) return;
    try { setBusy(id); await api.delete(`/transport-work-orders/${id}`); setDetail(null); fetchOrders(); }
    catch (err) { setError(errMsg(err, 'Failed to delete')); }
    finally { setBusy(null); }
  };
  const submitPay = async () => {
    if (!payModal) return;
    try {
      setBusy(payModal.woId);
      await api.post(`/transport-work-orders/${payModal.woId}/pay`, {
        amount: payForm.amount, tdsDeducted: payForm.tdsDeducted || 0,
        paymentMode: payForm.paymentMode, paymentRef: payForm.paymentRef || null, paymentDate: payForm.paymentDate,
      });
      setPayModal(null); setPayForm({ amount: '', tdsDeducted: '0', paymentMode: 'NEFT', paymentRef: '', paymentDate: new Date().toISOString().slice(0, 10) });
      await refreshDetail(payModal.woId); fetchOrders();
    } catch (err) { setError(errMsg(err, 'Failed to record payment')); }
    finally { setBusy(null); }
  };
  const submitCancel = async () => {
    if (!cancelModal || cancelReason.trim().length < 3) return;
    try {
      setBusy(cancelModal.woId);
      await api.post(`/transport-work-orders/${cancelModal.woId}/cancel`, { reason: cancelReason.trim() });
      setCancelModal(null); setCancelReason('');
      await refreshDetail(cancelModal.woId); fetchOrders();
    } catch (err) { setError(errMsg(err, 'Failed to cancel')); }
    finally { setBusy(null); }
  };

  return (
    <div className="p-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Truck className="text-slate-700" size={20} />
          <h1 className="text-lg font-bold text-slate-800">Transport Work Orders</h1>
          <span className="text-[11px] text-slate-400">Freight for outbound product sales</span>
        </div>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white text-xs font-medium hover:bg-slate-700">
          <Plus size={14} /> New Transport WO
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-xs mb-3 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 font-bold ml-2">&times;</button>
        </div>
      )}

      {/* List */}
      <div className="border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-700 text-white">
              {['WO #', 'Transporter', 'Product', 'Contract', 'Depot', 'Rate', 'Trucks', 'Net Payable', 'Balance', 'Status', ''].map(h => (
                <th key={h} className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600 last:border-r-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-8 text-slate-400"><Loader2 className="animate-spin inline" size={18} /></td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No transport work orders yet</td></tr>
            ) : orders.map((o, i) => (
              <Fragment key={o.id}>
                <tr className={`border-b border-slate-100 hover:bg-blue-50/50 cursor-pointer ${i % 2 ? 'bg-white' : 'bg-slate-50/40'}`} onClick={() => openDetail(o.id)}>
                  <td className="px-2 py-1.5 border-r border-slate-100 font-mono font-bold text-slate-700">TWO-{o.twoNo}</td>
                  <td className="px-2 py-1.5 border-r border-slate-100">{o.transporterName}</td>
                  <td className="px-2 py-1.5 border-r border-slate-100">{o.productType}</td>
                  <td className="px-2 py-1.5 border-r border-slate-100">{o.contractNo || <span className="text-slate-300">—</span>}<div className="text-[10px] text-slate-400">{o.customerName}</div></td>
                  <td className="px-2 py-1.5 border-r border-slate-100">{o.depot}</td>
                  <td className="px-2 py-1.5 border-r border-slate-100 font-mono whitespace-nowrap">{fmtINR(o.rate)} <span className="text-[9px] text-slate-400">{BASIS_LABEL[o.rateBasis]}</span></td>
                  <td className="px-2 py-1.5 border-r border-slate-100 text-center font-mono">{o._count?.lines ?? 0}</td>
                  <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono">{fmtINR(o.netPayable)}</td>
                  <td className="px-2 py-1.5 border-r border-slate-100 text-right font-mono">{o.status === 'CANCELLED' ? '—' : fmtINR(o.balanceAmount)}</td>
                  <td className="px-2 py-1.5 border-r border-slate-100"><span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusCls[o.status] || ''}`}>{o.status.replace('_', ' ')}</span></td>
                  <td className="px-2 py-1.5 text-center"><ChevronDown size={14} className={`inline text-slate-400 transition-transform ${detail?.id === o.id ? 'rotate-180' : ''}`} /></td>
                </tr>
                {detail?.id === o.id && (
                  <tr>
                    <td colSpan={11} className="p-0 border-b-2 border-slate-300 bg-slate-50">
                      {renderDetail()}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && renderCreateModal()}
      {payModal && renderPayModal()}
      {cancelModal && renderCancelModal()}
    </div>
  );

  // ── detail panel ──
  function renderDetail() {
    if (!detail) return null;
    const d = detail;
    return (
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-2 text-[11px]">
          <span><b className="text-slate-400 uppercase tracking-widest text-[10px]">Transporter</b> {d.transporter?.name} {d.transporter?.gstin ? `· ${d.transporter.gstin}` : ''}</span>
          <span><b className="text-slate-400 uppercase tracking-widest text-[10px]">Basis</b> {fmtINR(d.rate)} {BASIS_LABEL[d.rateBasis]}</span>
          {d.distanceKm ? <span><b className="text-slate-400 uppercase tracking-widest text-[10px]">Distance</b> {d.distanceKm} km</span> : null}
          {d.truckCount ? <span><b className="text-slate-400 uppercase tracking-widest text-[10px]">Trucks used</b> {d.truckCount}{d.trucksOrdered ? ` of ${d.trucksOrdered}` : ''}</span> : null}
          {d.estimatedDelivery ? <span><b className="text-slate-400 uppercase tracking-widest text-[10px]">Est. delivery</b> {new Date(d.estimatedDelivery).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span> : null}
          {d.status === 'CANCELLED' && d.cancelReason && <span className="text-slate-500">Cancelled — {d.cancelReason}</span>}
        </div>

        {/* lines */}
        <div className="border border-slate-200 bg-white mb-2">
          <table className="w-full text-[11px]">
            <thead><tr className="bg-slate-100 text-slate-500">
              {['Vehicle', 'Date', 'Qty', 'Freight'].map(h => <th key={h} className="text-[9px] uppercase tracking-widest px-2 py-1 text-left">{h}</th>)}
            </tr></thead>
            <tbody>
              {d.lines.map(l => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-medium">{l.vehicleNo}</td>
                  <td className="px-2 py-1">{l.dispatchDate ? new Date(l.dispatchDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</td>
                  <td className="px-2 py-1 font-mono">{l.quantity.toLocaleString('en-IN')} {l.unit}</td>
                  <td className="px-2 py-1 font-mono text-right">{fmtINR(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* totals + payments + actions */}
        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-white border border-slate-200 px-3 py-2 text-[11px] space-y-0.5">
            <div className="flex justify-between"><span className="text-slate-500">Subtotal (freight)</span><span className="font-mono">{fmtINR(d.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">GST @ {d.gstPercent}%</span><span className="font-mono">{fmtINR(d.gstAmount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Total</span><span className="font-mono">{fmtINR(d.totalAmount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">TDS @ {d.tdsPercent}% (194C)</span><span className="font-mono">- {fmtINR(d.tdsAmount)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-0.5 font-bold"><span>Net Payable</span><span className="font-mono">{fmtINR(d.netPayable)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Paid</span><span className="font-mono">{fmtINR(d.paidAmount)}</span></div>
            <div className="flex justify-between font-bold text-amber-700"><span>Balance</span><span className="font-mono">{fmtINR(d.balanceAmount)}</span></div>
          </div>

          <div className="bg-white border border-slate-200 px-3 py-2 text-[11px]">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Payments</div>
            {d.payments.length === 0 ? <div className="text-slate-300">No payments</div> : d.payments.map(p => (
              <div key={p.id} className="flex justify-between border-b border-slate-50 py-0.5">
                <span>{new Date(p.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · {p.paymentMode}{p.paymentRef ? ` · ${p.paymentRef}` : ''}</span>
                <span className="font-mono">{fmtINR(p.amount)}{p.tdsDeducted ? ` (+TDS ${fmtINR(p.tdsDeducted)})` : ''}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            {d.status === 'DRAFT' && (
              <>
                {d.trucksOrdered != null && (
                  <div className="border border-slate-200 bg-white px-2.5 py-2">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Final billing — trucks used <span className="text-slate-400 normal-case">(ordered {d.trucksOrdered})</span></label>
                    <div className="flex items-center gap-1.5">
                      <input type="number" min="0" step="1" value={usedEdit} onChange={e => setUsedEdit(e.target.value)} className="border border-slate-300 px-2 py-1 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      <button onClick={() => updateUsed(d.id)} disabled={busy === d.id || usedEdit === String(d.truckCount ?? '')}
                        className="text-[11px] font-medium px-2 py-1 border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40">Update</button>
                      <span className="text-[10px] text-slate-400">freight {fmtINR(d.subtotal)}</span>
                    </div>
                  </div>
                )}
                <button onClick={() => confirmWo(d.id)} disabled={busy === d.id} className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                  <CheckCircle2 size={14} /> Confirm &amp; bill {d.truckCount != null ? `${d.truckCount} truck${d.truckCount > 1 ? 's' : ''}` : ''}
                </button>
                <button onClick={() => deleteWo(d.id)} disabled={busy === d.id} className="flex items-center justify-center gap-1.5 px-3 py-1.5 border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-50">
                  <Trash2 size={14} /> Delete draft
                </button>
              </>
            )}
            {(d.status === 'CONFIRMED' || d.status === 'PARTIAL_PAID') && (
              <button onClick={() => { setPayModal({ woId: d.id, balance: d.balanceAmount }); setPayForm(f => ({ ...f, amount: String(d.balanceAmount) })); }} disabled={busy === d.id}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                <Wallet size={14} /> Record Payment
              </button>
            )}
            {d.status !== 'CANCELLED' && d.status !== 'PAID' && d.paidAmount === 0 && (
              <button onClick={() => setCancelModal({ woId: d.id, label: `TWO-${d.twoNo}` })} disabled={busy === d.id}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 disabled:opacity-50">
                <Ban size={14} /> Cancel WO
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── create modal ──
  function renderCreateModal() {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-6">
        <div className="bg-white shadow-2xl w-full max-w-3xl mx-4">
          <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between sticky top-0">
            <h2 className="text-sm font-bold tracking-wide uppercase">New Transport Work Order</h2>
            <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Transporter *</label>
                <select value={form.transporterId} onChange={e => setForm(f => ({ ...f, transporterId: e.target.value }))} className={inputCls}>
                  <option value="">Select…</option>
                  {transporters.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Product *</label>
                <select value={form.productType} onChange={e => onProductChange(e.target.value)} className={inputCls}>
                  {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Contract</label>
                <select value={form.contractId} onChange={e => onContractChange(e.target.value)} className={inputCls} disabled={form.productType === 'SCRAP'}>
                  <option value="">{form.productType === 'SCRAP' ? 'N/A (manual)' : 'Select contract…'}</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.contractNo} — {c.party}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Depot / Destination *</label>
                <input list="depot-suggest" value={form.depot} onChange={e => setForm(f => ({ ...f, depot: e.target.value }))} className={inputCls} placeholder="e.g. Reliance Jamnagar" />
                <datalist id="depot-suggest">{depotSuggestions.map(d => <option key={d} value={d} />)}</datalist>
              </div>
              <div>
                <label className={labelCls}>Rate Basis *</label>
                <select value={form.rateBasis} onChange={e => setForm(f => ({ ...f, rateBasis: e.target.value }))} className={inputCls}>
                  {BASIS_BY_PRODUCT[form.productType].map(b => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Rate ({BASIS_LABEL[form.rateBasis]}) *</label>
                <input type="number" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} className={inputCls} placeholder="e.g. 1.4" />
              </div>
              <div>
                <label className={labelCls}>GST %</label>
                <input type="number" value={form.gstPercent} onChange={e => setForm(f => ({ ...f, gstPercent: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>TDS % (194C)</label>
                <input type="number" value={form.tdsPercent} onChange={e => setForm(f => ({ ...f, tdsPercent: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Supply Type</label>
                <select value={form.supplyType} onChange={e => setForm(f => ({ ...f, supplyType: e.target.value }))} className={inputCls}>
                  <option value="INTRA_STATE">Intra-state (CGST+SGST)</option>
                  <option value="INTER_STATE">Inter-state (IGST)</option>
                </select>
              </div>
              {form.rateBasis === 'PER_KM' && (
                <div>
                  <label className={labelCls}>Distance (km)</label>
                  <input type="number" value={form.distanceKm} onChange={e => setForm(f => ({ ...f, distanceKm: e.target.value }))} className={inputCls} />
                </div>
              )}
            </div>

            {/* trucks pulled from dispatches */}
            {form.productType !== 'SCRAP' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelCls}>Trucks dispatched on this contract {form.depot && <span className="text-slate-400 normal-case">(filtered to “{form.depot}”)</span>}</label>
                  {selectableTrucks().length > 0 && <button onClick={toggleAll} className="text-[10px] text-blue-600 hover:underline">{allSelected() ? 'Clear all' : 'Select all'}</button>}
                </div>
                <div className="border border-slate-200 max-h-52 overflow-y-auto">
                  {!form.contractId ? (
                    <div className="text-center py-4 text-[11px] text-slate-400">Select a contract to load its trucks</div>
                  ) : selectableTrucks().length === 0 ? (
                    <div className="text-center py-4 text-[11px] text-slate-400">No un-billed trucks for this contract/depot</div>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead><tr className="bg-slate-100 text-slate-500 sticky top-0">
                        <th className="px-2 py-1 w-6"></th>
                        {['Vehicle', 'Date', 'Destination', 'Qty', 'Freight'].map(h => <th key={h} className="text-[9px] uppercase tracking-widest px-2 py-1 text-left">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {trucks.map(t => {
                          const disabled = !!t.billedOnWo;
                          const sel = selected.has(t.sourceId);
                          return (
                            <tr key={t.sourceId} className={`border-t border-slate-100 ${disabled ? 'opacity-40' : 'hover:bg-blue-50/50 cursor-pointer'}`} onClick={() => !disabled && toggleTruck(t.sourceId)}>
                              <td className="px-2 py-1 text-center"><input type="checkbox" checked={sel} disabled={disabled} readOnly /></td>
                              <td className="px-2 py-1 font-medium">{t.vehicleNo}</td>
                              <td className="px-2 py-1">{t.dispatchDate ? new Date(t.dispatchDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</td>
                              <td className="px-2 py-1">{t.destination || '—'}{disabled && <span className="ml-1 text-[9px] text-red-500">billed TWO-{t.billedOnWo}</span>}</td>
                              <td className="px-2 py-1 font-mono">{truckQtyLabel(form.rateBasis, t)}</td>
                              <td className="px-2 py-1 font-mono text-right">{fmtINR(previewAmount(form.rateBasis, rateNum, t))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* manual order — no weighbridge: order N trucks now; actual used is set at billing */}
            <div>
              <label className={labelCls}>Order quantity <span className="text-slate-400 normal-case">— actual trucks used is set later, at final billing</span></label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-1">
                <div>
                  <label className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5 block">No. of trucks</label>
                  <input type="number" min="0" step="1" value={form.truckCount} onChange={e => setForm(f => ({ ...f, truckCount: e.target.value }))} className={inputCls} placeholder="e.g. 10" />
                </div>
                {form.rateBasis !== 'PER_TRUCK' && (
                  <div>
                    <label className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5 block">Qty per truck ({BASIS_LABEL[form.rateBasis].split('/')[1]?.trim()})</label>
                    <input type="number" min="0" value={form.qtyPerTruck} onChange={e => setForm(f => ({ ...f, qtyPerTruck: e.target.value }))} className={inputCls} placeholder={form.rateBasis === 'PER_LITER' ? 'e.g. 40000' : form.rateBasis === 'PER_KL' ? 'e.g. 40' : 'e.g. 25'} />
                  </div>
                )}
                <div>
                  <label className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5 block">Est. delivery</label>
                  <input type="date" value={form.estimatedDelivery} onChange={e => setForm(f => ({ ...f, estimatedDelivery: e.target.value }))} className={inputCls} />
                </div>
              </div>
              {manualCount > 0 && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Order: {manualCount} truck{manualCount > 1 ? 's' : ''}{form.rateBasis !== 'PER_TRUCK' && manualQtyPer > 0 ? ` × ${manualQtyPer.toLocaleString('en-IN')} ${BASIS_LABEL[form.rateBasis].split('/')[1]?.trim()}` : ''} → est. freight {fmtINR(manualSubtotal)} <span className="text-slate-400">(adjust to actual before you bill)</span>
                </p>
              )}
            </div>

            {/* totals preview */}
            <div className="bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] grid grid-cols-2 md:grid-cols-5 gap-2">
              <div><span className="text-slate-400 uppercase tracking-widest text-[9px] block">Trucks</span><span className="font-mono font-bold">{lineCount}</span></div>
              <div><span className="text-slate-400 uppercase tracking-widest text-[9px] block">Subtotal</span><span className="font-mono">{fmtINR(subtotal)}</span></div>
              <div><span className="text-slate-400 uppercase tracking-widest text-[9px] block">GST</span><span className="font-mono">{fmtINR(gstAmount)}</span></div>
              <div><span className="text-slate-400 uppercase tracking-widest text-[9px] block">TDS</span><span className="font-mono">- {fmtINR(tdsAmount)}</span></div>
              <div><span className="text-slate-400 uppercase tracking-widest text-[9px] block">Net Payable</span><span className="font-mono font-bold text-slate-800">{fmtINR(netPayable)}</span></div>
            </div>
          </div>
          <div className="bg-slate-50 px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 sticky bottom-0">
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
            <button onClick={submitCreate} disabled={busy === 'create'} className="px-4 py-1.5 bg-slate-800 text-white text-[11px] font-medium hover:bg-slate-700 disabled:opacity-50">
              {busy === 'create' ? 'Creating…' : 'Create Draft'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── pay modal ──
  function renderPayModal() {
    if (!payModal) return null;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white shadow-2xl w-full max-w-md mx-4">
          <div className="bg-green-700 text-white px-4 py-2.5 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-wide uppercase">Record Transport Payment</h2>
            <button onClick={() => setPayModal(null)} className="text-green-200 hover:text-white"><X size={18} /></button>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-[11px] text-slate-500">Outstanding balance: <b>{fmtINR(payModal.balance)}</b></p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Amount *</label><input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} className={inputCls} autoFocus /></div>
              <div><label className={labelCls}>TDS deducted</label><input type="number" value={payForm.tdsDeducted} onChange={e => setPayForm(f => ({ ...f, tdsDeducted: e.target.value }))} className={inputCls} /></div>
              <div><label className={labelCls}>Mode</label>
                <select value={payForm.paymentMode} onChange={e => setPayForm(f => ({ ...f, paymentMode: e.target.value }))} className={inputCls}>
                  {['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'CASH', 'BANK_TRANSFER'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Reference (UTR)</label><input value={payForm.paymentRef} onChange={e => setPayForm(f => ({ ...f, paymentRef: e.target.value }))} className={inputCls} /></div>
              <div className="col-span-2"><label className={labelCls}>Payment Date</label><input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))} className={inputCls} /></div>
            </div>
          </div>
          <div className="bg-slate-50 px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200">
            <button onClick={() => setPayModal(null)} className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
            <button onClick={submitPay} disabled={busy === payModal.woId || !(Number(payForm.amount) > 0)} className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
              {busy === payModal.woId ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── cancel modal ──
  function renderCancelModal() {
    if (!cancelModal) return null;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white shadow-2xl w-full max-w-md mx-4">
          <div className="bg-red-700 text-white px-4 py-2.5 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-wide uppercase">Cancel {cancelModal.label}</h2>
            <button onClick={() => setCancelModal(null)} className="text-red-200 hover:text-white"><X size={18} /></button>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-[11px] text-slate-600">If this WO was confirmed, its accounting entry will be reversed. Cannot cancel once a payment has been recorded.</p>
            <div>
              <label className={labelCls}>Reason *</label>
              <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3} placeholder="e.g. Wrong rate / duplicate" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-red-400" autoFocus />
            </div>
          </div>
          <div className="bg-slate-50 px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200">
            <button onClick={() => setCancelModal(null)} className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Keep</button>
            <button onClick={submitCancel} disabled={busy === cancelModal.woId || cancelReason.trim().length < 3} className="px-4 py-1.5 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 disabled:opacity-50">
              {busy === cancelModal.woId ? 'Cancelling…' : 'Cancel WO'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
