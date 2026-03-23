import { useState, useEffect, useCallback } from 'react';
import {
  IndianRupee, Loader2, CheckCircle, Clock, AlertCircle,
  RefreshCw, CreditCard, Banknote, Smartphone, Building2,
  ChevronDown, ChevronRight, X, Trash2, FileText, Truck,
  MapPin, Phone, User, Hash, ArrowRight, RotateCcw
} from 'lucide-react';
import api from '../../services/api';

// ── Types ──
interface PendingShipment {
  id: string;
  shipmentNo: number;
  vehicleNo: string;
  customerName: string;
  productName: string;
  destination: string;
  weightTare: number | null;
  weightGross: number | null;
  weightNet: number | null;
  netMT: number;
  bags: number | null;
  paymentTerms: string;
  status: string;
  date: string;
  gateInTime: string;
  invoiceRef: string | null;
  ewayBill: string | null;
  irn: string | null;
  rate: number;
  gstPercent: number;
  expectedAmount: number;
  customerPhone: string | null;
  customerGstin: string | null;
  orderNo: number | null;
  orderId: string | null;
  drNo: number | null;
}

interface ConfirmedPayment {
  id: string;
  shipmentNo: number;
  vehicleNo: string;
  customerName: string;
  productName: string;
  weightNet: number | null;
  destination: string;
  paymentAmount: number | null;
  paymentMode: string | null;
  paymentRef: string | null;
  paymentConfirmedAt: string | null;
  invoiceRef: string | null;
  ewayBill: string | null;
  status: string;
  date: string;
}

interface DashboardData {
  pendingCount: number;
  todayCollections: {
    count: number;
    total: number;
    breakdown: Record<string, { count: number; amount: number }>;
  };
  recentConfirmed: ConfirmedPayment[];
}

interface TimelineEntry {
  time: string;
  event: string;
  detail?: string;
}

interface ShipmentHistory {
  shipment: any;
  timeline: TimelineEntry[];
}

// ── Helpers ──
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
const fmtTime = (d: string) => {
  try { return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
  catch { return d; }
};

const MODE_META: Record<string, { icon: any; label: string; color: string }> = {
  CASH: { icon: Banknote, label: 'Cash', color: 'text-green-600' },
  UPI: { icon: Smartphone, label: 'UPI', color: 'text-purple-600' },
  NEFT: { icon: Building2, label: 'NEFT', color: 'text-blue-600' },
  RTGS: { icon: Building2, label: 'RTGS', color: 'text-blue-700' },
  CHEQUE: { icon: CreditCard, label: 'Cheque', color: 'text-amber-600' },
  BANK_TRANSFER: { icon: Building2, label: 'Bank Transfer', color: 'text-indigo-600' },
};

const PAYMENT_MODES = ['UPI', 'CASH', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER'] as const;

export default function PaymentDashboard() {
  const [pending, setPending] = useState<PendingShipment[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'confirmed'>('pending');

  // Payment form state
  const [payId, setPayId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ mode: 'UPI', ref: '', amount: '' });
  const [paySaving, setPaySaving] = useState(false);

  // History drawer
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<ShipmentHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [pRes, dRes] = await Promise.all([
        api.get('/accounts/pending'),
        api.get('/accounts/dashboard'),
      ]);
      setPending(pRes.data.pending || []);
      setDashboard(dRes.data);
    } catch {
      flash('err', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  // ── Payment actions ──
  const openPayForm = (s: PendingShipment) => {
    setPayId(s.id);
    setPayForm({ mode: 'UPI', ref: '', amount: String(s.expectedAmount || '') });
  };

  const confirmPayment = async () => {
    if (!payId) return;
    const amt = parseFloat(payForm.amount);
    if (!amt || amt <= 0) { flash('err', 'Enter valid amount'); return; }
    setPaySaving(true);
    try {
      await api.post(`/accounts/${payId}/confirm-payment`, {
        paymentMode: payForm.mode,
        paymentRef: payForm.ref,
        paymentAmount: amt,
      });
      flash('ok', `Payment confirmed — ${fmt(amt)}`);
      setPayId(null);
      setPayForm({ mode: 'UPI', ref: '', amount: '' });
      loadData();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Confirmation failed');
    } finally {
      setPaySaving(false);
    }
  };

  const revokePayment = async (id: string) => {
    setDeleting(true);
    try {
      await api.delete(`/accounts/${id}/payment`);
      flash('ok', 'Payment revoked — moved back to pending');
      setDeleteId(null);
      loadData();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to revoke');
    } finally {
      setDeleting(false);
    }
  };

  // ── History ──
  const openHistory = async (id: string) => {
    setHistoryId(id);
    setHistoryLoading(true);
    try {
      const res = await api.get(`/accounts/${id}/history`);
      setHistory(res.data);
    } catch {
      flash('err', 'Failed to load history');
      setHistoryId(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeHistory = () => { setHistoryId(null); setHistory(null); };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1200px] mx-auto">
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <IndianRupee size={20} className="text-emerald-600" />
            Payment Desk
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <button onClick={loadData} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition" title="Refresh">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── KPI strip ── */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <p className="text-[11px] text-gray-500 font-medium">Awaiting</p>
            <p className="text-2xl font-bold text-amber-600">{dashboard.pendingCount}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <p className="text-[11px] text-gray-500 font-medium">Today's Collections</p>
            <p className="text-2xl font-bold text-emerald-700">{fmt(dashboard.todayCollections.total)}</p>
            <p className="text-[10px] text-gray-400">{dashboard.todayCollections.count} payment{dashboard.todayCollections.count !== 1 ? 's' : ''}</p>
          </div>
          {Object.entries(dashboard.todayCollections.breakdown).slice(0, 2).map(([mode, data]) => {
            const meta = MODE_META[mode] || { icon: CreditCard, label: mode, color: 'text-gray-600' };
            const Icon = meta.icon;
            return (
              <div key={mode} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <p className="text-[11px] text-gray-500 font-medium flex items-center gap-1"><Icon size={12} />{meta.label}</p>
                <p className={`text-xl font-bold ${meta.color}`}>{fmt(data.amount)}</p>
                <p className="text-[10px] text-gray-400">{data.count} txn{data.count !== 1 ? 's' : ''}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Flash message ── */}
      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${
          msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {msg.type === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {msg.text}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            activeTab === 'pending' ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Clock size={14} className="inline mr-1.5 -mt-0.5" />
          Awaiting ({pending.length})
        </button>
        <button
          onClick={() => setActiveTab('confirmed')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            activeTab === 'confirmed' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <CheckCircle size={14} className="inline mr-1.5 -mt-0.5" />
          Confirmed ({dashboard?.recentConfirmed.length || 0})
        </button>
      </div>

      {/* ── PENDING TAB ── */}
      {activeTab === 'pending' && (
        <div>
          {loading && pending.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin mx-auto mb-2" />
              <p className="text-sm">Loading...</p>
            </div>
          ) : pending.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle size={36} className="mx-auto text-emerald-300 mb-3" />
              <p className="text-gray-500 text-sm font-medium">All clear — no pending payments</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 uppercase">
                    <th className="px-4 py-2.5 text-left font-medium">Shipment</th>
                    <th className="px-4 py-2.5 text-left font-medium">Customer</th>
                    <th className="px-4 py-2.5 text-left font-medium">Product</th>
                    <th className="px-4 py-2.5 text-right font-medium">Net MT</th>
                    <th className="px-4 py-2.5 text-right font-medium">Expected</th>
                    <th className="px-4 py-2.5 text-left font-medium">Terms</th>
                    <th className="px-4 py-2.5 text-left font-medium">Docs</th>
                    <th className="px-4 py-2.5 text-center font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pending.map(s => {
                    const isExpanded = payId === s.id;
                    return (
                      <tr key={s.id} className="group">
                        <td className="px-4 py-3">
                          <button onClick={() => openHistory(s.id)} className="text-left hover:underline">
                            <span className="font-semibold text-gray-900">{s.vehicleNo}</span>
                            <span className="block text-[11px] text-gray-400">#{s.shipmentNo}{s.orderNo ? ` · SO-${s.orderNo}` : ''}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-800">{s.customerName}</span>
                          {s.destination && <span className="block text-[11px] text-gray-400">{s.destination}</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{s.productName}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-800">{s.netMT}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(s.expectedAmount)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            s.paymentTerms === 'ADVANCE' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                          }`}>{s.paymentTerms}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {s.invoiceRef && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Invoice" />}
                            {s.irn && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title="IRN" />}
                            {s.ewayBill && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" title="E-Way Bill" />}
                            {!s.invoiceRef && !s.irn && <span className="text-[10px] text-gray-300">—</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => isExpanded ? setPayId(null) : openPayForm(s)}
                            className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
                              isExpanded
                                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                          >
                            {isExpanded ? 'Cancel' : 'Confirm'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* ── Inline payment form (slides under selected row) ── */}
              {payId && (() => {
                const s = pending.find(p => p.id === payId);
                if (!s) return null;
                return (
                  <div className="border-t border-emerald-200 bg-emerald-50/50 px-4 py-4">
                    <div className="flex items-start gap-6 max-w-3xl">
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-gray-700 mb-3">
                          Confirm payment for <span className="text-emerald-700">{s.vehicleNo}</span> · {s.customerName} · {fmt(s.expectedAmount)}
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-[11px] text-gray-500 font-medium block mb-1">Payment Mode</label>
                            <select
                              value={payForm.mode}
                              onChange={e => setPayForm(f => ({ ...f, mode: e.target.value }))}
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                            >
                              {PAYMENT_MODES.map(m => (
                                <option key={m} value={m}>{MODE_META[m]?.label || m}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] text-gray-500 font-medium block mb-1">UTR / Reference</label>
                            <input
                              value={payForm.ref}
                              onChange={e => setPayForm(f => ({ ...f, ref: e.target.value }))}
                              placeholder="Transaction ID"
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-gray-500 font-medium block mb-1">Amount (₹)</label>
                            <input
                              type="number"
                              value={payForm.amount}
                              onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-semibold focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={confirmPayment}
                        disabled={paySaving}
                        className="mt-7 px-6 py-2.5 bg-emerald-600 text-white rounded-md text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                      >
                        {paySaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        Confirm {payForm.amount ? fmt(parseFloat(payForm.amount)) : ''}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── CONFIRMED TAB ── */}
      {activeTab === 'confirmed' && dashboard && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {dashboard.recentConfirmed.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-sm">No confirmed payments yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 uppercase">
                  <th className="px-4 py-2.5 text-left font-medium">Shipment</th>
                  <th className="px-4 py-2.5 text-left font-medium">Customer</th>
                  <th className="px-4 py-2.5 text-left font-medium">Product</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-left font-medium">Mode</th>
                  <th className="px-4 py-2.5 text-left font-medium">Reference</th>
                  <th className="px-4 py-2.5 text-left font-medium">Confirmed</th>
                  <th className="px-4 py-2.5 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dashboard.recentConfirmed.map(r => {
                  const meta = MODE_META[r.paymentMode || ''] || { icon: CreditCard, label: r.paymentMode || '—', color: 'text-gray-600' };
                  const ModeIcon = meta.icon;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <button onClick={() => openHistory(r.id)} className="text-left hover:underline">
                          <span className="font-semibold text-gray-900">{r.vehicleNo}</span>
                          <span className="block text-[11px] text-gray-400">#{r.shipmentNo}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.customerName}</td>
                      <td className="px-4 py-3 text-gray-600">{r.productName}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {r.paymentAmount ? fmt(r.paymentAmount) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1.5 ${meta.color}`}>
                          <ModeIcon size={13} /> {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.paymentRef || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {r.paymentConfirmedAt ? (
                          <>
                            {fmtDate(r.paymentConfirmedAt)}{' '}
                            <span className="text-gray-400">{fmtTime(r.paymentConfirmedAt)}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {!r.ewayBill && (
                          <button
                            onClick={() => setDeleteId(r.id)}
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition"
                            title="Revoke payment"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Delete/Revoke confirmation dialog ── */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setDeleteId(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <RotateCcw size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">Revoke Payment?</h3>
                <p className="text-xs text-gray-500">This will move the shipment back to pending</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Cannot revoke if e-way bill has already been generated against this payment.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">
                Cancel
              </button>
              <button
                onClick={() => revokePayment(deleteId)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── History drawer (right panel) ── */}
      {historyId && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closeHistory}>
          <div className="absolute inset-0 bg-black/20" />
          <div
            className="relative w-full max-w-md bg-white shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between z-10">
              <h2 className="font-semibold text-gray-900 text-sm">Shipment History</h2>
              <button onClick={closeHistory} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <X size={18} />
              </button>
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-gray-400" />
              </div>
            ) : history ? (
              <div className="p-5 space-y-5">
                {/* Shipment summary */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-bold text-gray-900">{history.shipment.vehicleNo}</p>
                      <p className="text-xs text-gray-500">Shipment #{history.shipment.shipmentNo}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                      history.shipment.paymentStatus === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' :
                      history.shipment.paymentStatus === 'PENDING' ? 'bg-amber-50 text-amber-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>
                      {history.shipment.paymentStatus}
                    </span>
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded-md p-2.5">
                      <p className="text-gray-400 font-medium mb-0.5">Customer</p>
                      <p className="text-gray-800 font-medium">{history.shipment.customerName}</p>
                    </div>
                    <div className="bg-gray-50 rounded-md p-2.5">
                      <p className="text-gray-400 font-medium mb-0.5">Product</p>
                      <p className="text-gray-800 font-medium">{history.shipment.productName}</p>
                    </div>
                    <div className="bg-gray-50 rounded-md p-2.5">
                      <p className="text-gray-400 font-medium mb-0.5">Destination</p>
                      <p className="text-gray-800">{history.shipment.destination || '—'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-md p-2.5">
                      <p className="text-gray-400 font-medium mb-0.5">Net Weight</p>
                      <p className="text-gray-800 font-medium">
                        {history.shipment.weightNet ? `${(history.shipment.weightNet / 1000).toFixed(3)} MT` : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Order info */}
                  {history.shipment.dispatchRequest?.order && (
                    <div className="bg-blue-50/50 border border-blue-100 rounded-md p-3">
                      <p className="text-[11px] font-semibold text-blue-700 mb-1.5">Sales Order</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <p className="text-gray-600">Order: <span className="font-medium text-gray-800">SO-{history.shipment.dispatchRequest.order.orderNo}</span></p>
                        <p className="text-gray-600">Terms: <span className="font-medium text-gray-800">{history.shipment.dispatchRequest.order.paymentTerms || '—'}</span></p>
                        {history.shipment.dispatchRequest.order.lines?.map((l: any, i: number) => (
                          <p key={i} className="text-gray-600 col-span-2">
                            {l.productName}: <span className="font-mono">{fmt(l.rate)}</span>/{l.unit} + {l.gstPercent}% GST
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Payment info */}
                  {history.shipment.paymentStatus === 'CONFIRMED' && (
                    <div className="bg-emerald-50/50 border border-emerald-100 rounded-md p-3">
                      <p className="text-[11px] font-semibold text-emerald-700 mb-1.5">Payment</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <p className="text-gray-600">Amount: <span className="font-bold text-gray-900">{history.shipment.paymentAmount ? fmt(history.shipment.paymentAmount) : '—'}</span></p>
                        <p className="text-gray-600">Mode: <span className="font-medium text-gray-800">{history.shipment.paymentMode}</span></p>
                        <p className="text-gray-600">Ref: <span className="font-mono text-gray-800">{history.shipment.paymentRef || '—'}</span></p>
                        <p className="text-gray-600">At: <span className="text-gray-800">{history.shipment.paymentConfirmedAt ? fmtTime(history.shipment.paymentConfirmedAt) : '—'}</span></p>
                      </div>
                    </div>
                  )}

                  {/* Documents */}
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase">Documents</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {history.shipment.invoiceRef && (
                        <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded font-medium">{history.shipment.invoiceRef}</span>
                      )}
                      {history.shipment.irn && (
                        <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded font-medium">IRN: {history.shipment.irnStatus}</span>
                      )}
                      {history.shipment.ewayBill && (
                        <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded font-medium">EWB: {history.shipment.ewayBill}</span>
                      )}
                      {history.shipment.challanNo && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded">Challan: {history.shipment.challanNo}</span>
                      )}
                      {!history.shipment.invoiceRef && !history.shipment.irn && !history.shipment.ewayBill && (
                        <span className="text-gray-400">No documents yet</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase mb-3">Timeline</p>
                  <div className="relative">
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" />
                    <div className="space-y-3">
                      {history.timeline.map((t, i) => (
                        <div key={i} className="flex gap-3 relative">
                          <div className={`w-[15px] h-[15px] rounded-full border-2 bg-white z-10 flex-shrink-0 mt-0.5 ${
                            i === history.timeline.length - 1 ? 'border-emerald-500' : 'border-gray-300'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{t.event}</p>
                            {t.detail && <p className="text-xs text-gray-500 mt-0.5">{t.detail}</p>}
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {t.time && t.time.includes('T') ? fmtTime(t.time) : t.time || ''}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
