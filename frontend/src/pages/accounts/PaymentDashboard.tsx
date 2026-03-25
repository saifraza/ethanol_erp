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
  try { return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); }
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
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* ── Page toolbar ── */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IndianRupee size={15} className="text-slate-400" />
            <h1 className="text-sm font-bold tracking-wide uppercase">Payment Desk</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">
              {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="px-3 py-1 border border-slate-400 text-slate-300 text-[11px] hover:bg-slate-700 flex items-center gap-1.5"
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── KPI strip ── */}
        {dashboard && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-b md:border-b-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Awaiting</div>
              <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{dashboard.pendingCount}</div>
              <div className="text-[10px] text-slate-400">Pending confirmation</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-b md:border-b-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Today's Collections</div>
              <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{fmt(dashboard.todayCollections.total)}</div>
              <div className="text-[10px] text-slate-400">{dashboard.todayCollections.count} payment{dashboard.todayCollections.count !== 1 ? 's' : ''}</div>
            </div>
            {Object.entries(dashboard.todayCollections.breakdown).slice(0, 2).map(([mode, data]) => {
              const meta = MODE_META[mode] || { icon: CreditCard, label: mode, color: 'text-gray-600' };
              const Icon = meta.icon;
              return (
                <div key={mode} className="bg-white px-4 py-3 border-r border-slate-300 last:border-r-0">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 flex items-center gap-1"><Icon size={10} />{meta.label}</div>
                  <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{fmt(data.amount)}</div>
                  <div className="text-[10px] text-slate-400">{data.count} txn{data.count !== 1 ? 's' : ''}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Flash message ── */}
        {msg && (
          <div className={`px-3 py-2 text-[11px] font-medium border -mx-3 md:-mx-6 ${
            msg.type === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-red-50 border-red-300 text-red-700'
          } flex items-center gap-2`}>
            {msg.type === 'ok' ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
            {msg.text}
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="bg-slate-100 border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-5 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
              activeTab === 'pending' ? 'bg-white border-b-2 border-slate-800 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Awaiting ({pending.length})
          </button>
          <button
            onClick={() => setActiveTab('confirmed')}
            className={`px-5 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
              activeTab === 'confirmed' ? 'bg-white border-b-2 border-slate-800 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Confirmed ({dashboard?.recentConfirmed.length || 0})
          </button>
        </div>

        {/* ── PENDING TAB ── */}
        {activeTab === 'pending' && (
          <div>
            {loading && pending.length === 0 ? (
              <div className="text-center py-16 text-slate-400 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
                <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                <p className="text-xs">Loading...</p>
              </div>
            ) : pending.length === 0 ? (
              <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
                <CheckCircle size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-xs font-medium">All clear -- no pending payments</p>
              </div>
            ) : (
              <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Shipment</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Customer</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Product</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net MT</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Expected</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Terms</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Docs</th>
                        <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map(s => {
                        const isExpanded = payId === s.id;
                        return (
                          <tr key={s.id} className="border-t border-slate-200 hover:bg-blue-50/30 even:bg-slate-50/50">
                            <td className="px-3 py-1.5 border-r border-slate-100">
                              <button onClick={() => openHistory(s.id)} className="text-left hover:underline">
                                <span className="font-semibold text-slate-800">{s.vehicleNo}</span>
                                <span className="block text-[10px] text-slate-400">#{s.shipmentNo}{s.orderNo ? ` / SO-${s.orderNo}` : ''}</span>
                              </button>
                            </td>
                            <td className="px-3 py-1.5 border-r border-slate-100">
                              <span className="text-slate-700">{s.customerName}</span>
                              {s.destination && <span className="block text-[10px] text-slate-400">{s.destination}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{s.productName}</td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{s.netMT}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-slate-800 font-mono tabular-nums border-r border-slate-100">{fmt(s.expectedAmount)}</td>
                            <td className="px-3 py-1.5 border-r border-slate-100">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                s.paymentTerms === 'ADVANCE' ? 'border-red-300 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-700'
                              }`}>{s.paymentTerms}</span>
                            </td>
                            <td className="px-3 py-1.5 border-r border-slate-100">
                              <div className="flex items-center gap-1.5">
                                {s.invoiceRef && <span className="w-2 h-2 bg-emerald-400" title="Invoice" />}
                                {s.irn && <span className="w-2 h-2 bg-blue-400" title="IRN" />}
                                {s.ewayBill && <span className="w-2 h-2 bg-purple-400" title="E-Way Bill" />}
                                {!s.invoiceRef && !s.irn && <span className="text-[10px] text-slate-300">--</span>}
                              </div>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                onClick={() => isExpanded ? setPayId(null) : openPayForm(s)}
                                className={isExpanded
                                  ? 'px-3 py-1 border border-slate-400 text-slate-600 text-[11px] hover:bg-slate-100'
                                  : 'px-3 py-1 bg-blue-600 text-white text-[11px] hover:bg-blue-700'
                                }
                              >
                                {isExpanded ? 'Cancel' : 'Confirm'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── Inline payment form ── */}
                {payId && (() => {
                  const s = pending.find(p => p.id === payId);
                  if (!s) return null;
                  return (
                    <div className="bg-slate-100 border-t border-slate-300 px-4 py-4">
                      <div className="flex items-start gap-6 max-w-3xl">
                        <div className="flex-1">
                          <p className="text-[11px] font-bold text-slate-600 mb-3 uppercase tracking-widest">
                            Confirm payment for <span className="text-slate-800">{s.vehicleNo}</span> / {s.customerName} / {fmt(s.expectedAmount)}
                          </p>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Mode</label>
                              <select
                                value={payForm.mode}
                                onChange={e => setPayForm(f => ({ ...f, mode: e.target.value }))}
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
                              >
                                {PAYMENT_MODES.map(m => (
                                  <option key={m} value={m}>{MODE_META[m]?.label || m}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">UTR / Reference</label>
                              <input
                                value={payForm.ref}
                                onChange={e => setPayForm(f => ({ ...f, ref: e.target.value }))}
                                placeholder="Transaction ID"
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount</label>
                              <input
                                type="number"
                                value={payForm.amount}
                                onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white font-semibold font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={confirmPayment}
                          disabled={paySaving}
                          className="mt-5 px-3 py-1 bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                        >
                          {paySaving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
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
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
            {dashboard.recentConfirmed.length === 0 ? (
              <div className="text-center py-16 text-slate-400 bg-white">
                <p className="text-xs">No confirmed payments yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Shipment</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Customer</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Product</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Mode</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Reference</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Confirmed</th>
                      <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recentConfirmed.map(r => {
                      const meta = MODE_META[r.paymentMode || ''] || { icon: CreditCard, label: r.paymentMode || '--', color: 'text-gray-600' };
                      const ModeIcon = meta.icon;
                      return (
                        <tr key={r.id} className="border-t border-slate-200 hover:bg-blue-50/30 even:bg-slate-50/50">
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <button onClick={() => openHistory(r.id)} className="text-left hover:underline">
                              <span className="font-semibold text-slate-800">{r.vehicleNo}</span>
                              <span className="block text-[10px] text-slate-400">#{r.shipmentNo}</span>
                            </button>
                          </td>
                          <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{r.customerName}</td>
                          <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{r.productName}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-slate-800 font-mono tabular-nums border-r border-slate-100">
                            {r.paymentAmount ? fmt(r.paymentAmount) : '--'}
                          </td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className={`flex items-center gap-1.5 text-xs ${meta.color}`}>
                              <ModeIcon size={12} /> {meta.label}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-500 font-mono text-[11px] border-r border-slate-100">{r.paymentRef || '--'}</td>
                          <td className="px-3 py-1.5 text-slate-500 text-[11px] border-r border-slate-100">
                            {r.paymentConfirmedAt ? (
                              <>
                                {fmtDate(r.paymentConfirmedAt)}{' '}
                                <span className="text-slate-400">{fmtTime(r.paymentConfirmedAt)}</span>
                              </>
                            ) : '--'}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {!r.ewayBill && (
                              <button
                                onClick={() => setDeleteId(r.id)}
                                className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
                                title="Revoke payment"
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Revoke confirmation modal ── */}
        {deleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteId(null)}>
            <div className="bg-white shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-5 py-3 flex items-center gap-2">
                <RotateCcw size={14} />
                <h2 className="text-sm font-bold">Revoke Payment</h2>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-slate-700">
                  This will move the shipment back to pending. Cannot revoke if e-way bill has already been generated.
                </p>
              </div>
              <div className="bg-slate-100 border-t border-slate-300 px-5 py-3 flex justify-end gap-2">
                <button
                  onClick={() => setDeleteId(null)}
                  className="px-3 py-1 border border-slate-400 text-slate-600 text-[11px] hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => revokePayment(deleteId)}
                  disabled={deleting}
                  className="px-3 py-1 border border-red-400 text-red-600 text-[11px] hover:bg-red-50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
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
              {/* Drawer header */}
              <div className="sticky top-0 bg-slate-800 text-white px-5 py-3 flex items-center justify-between z-10">
                <h2 className="text-sm font-bold uppercase tracking-wide">Shipment History</h2>
                <button onClick={closeHistory} className="p-1 text-white/70 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              {historyLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 size={24} className="animate-spin text-slate-400" />
                </div>
              ) : history ? (
                <div className="p-5 space-y-5">
                  {/* Shipment summary */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-lg font-bold text-slate-800">{history.shipment.vehicleNo}</p>
                        <p className="text-[11px] text-slate-500">Shipment #{history.shipment.shipmentNo}</p>
                      </div>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                        history.shipment.paymentStatus === 'CONFIRMED' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' :
                        history.shipment.paymentStatus === 'PENDING' ? 'border-amber-300 bg-amber-50 text-amber-700' :
                        'border-slate-300 bg-slate-50 text-slate-500'
                      }`}>
                        {history.shipment.paymentStatus}
                      </span>
                    </div>

                    {/* Details grid */}
                    <div className="bg-slate-50 border border-slate-300 p-3">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Details</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-slate-400">Customer:</span> <span className="text-slate-700 font-medium">{history.shipment.customerName}</span></div>
                        <div><span className="text-slate-400">Product:</span> <span className="text-slate-700 font-medium">{history.shipment.productName}</span></div>
                        <div><span className="text-slate-400">Destination:</span> <span className="text-slate-700 font-medium">{history.shipment.destination || '--'}</span></div>
                        <div><span className="text-slate-400">Net Weight:</span> <span className="text-slate-700 font-medium font-mono tabular-nums">{history.shipment.weightNet ? `${(history.shipment.weightNet / 1000).toFixed(3)} MT` : '--'}</span></div>
                      </div>
                    </div>

                    {/* Order info */}
                    {history.shipment.dispatchRequest?.order && (
                      <div className="bg-slate-50 border border-slate-300 p-3">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Sales Order</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div><span className="text-slate-400">Order:</span> <span className="text-slate-700 font-medium">SO-{history.shipment.dispatchRequest.order.orderNo}</span></div>
                          <div><span className="text-slate-400">Terms:</span> <span className="text-slate-700 font-medium">{history.shipment.dispatchRequest.order.paymentTerms || '--'}</span></div>
                          {history.shipment.dispatchRequest.order.lines?.map((l: any, i: number) => (
                            <div key={i} className="text-slate-600 col-span-2">
                              <span className="text-slate-400">{l.productName}:</span> <span className="font-mono tabular-nums text-slate-700">{fmt(l.rate)}</span>/{l.unit} + {l.gstPercent}% GST
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Payment info */}
                    {history.shipment.paymentStatus === 'CONFIRMED' && (
                      <div className="bg-slate-50 border border-slate-300 p-3">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Payment</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div><span className="text-slate-400">Amount:</span> <span className="text-slate-700 font-bold font-mono tabular-nums">{history.shipment.paymentAmount ? fmt(history.shipment.paymentAmount) : '--'}</span></div>
                          <div><span className="text-slate-400">Mode:</span> <span className="text-slate-700 font-medium">{history.shipment.paymentMode}</span></div>
                          <div><span className="text-slate-400">Ref:</span> <span className="font-mono text-slate-700">{history.shipment.paymentRef || '--'}</span></div>
                          <div><span className="text-slate-400">At:</span> <span className="text-slate-700">{history.shipment.paymentConfirmedAt ? fmtTime(history.shipment.paymentConfirmedAt) : '--'}</span></div>
                        </div>
                      </div>
                    )}

                    {/* Documents */}
                    <div className="bg-slate-50 border border-slate-300 p-3">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Documents</div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {history.shipment.invoiceRef && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-emerald-300 bg-emerald-50 text-emerald-700">{history.shipment.invoiceRef}</span>
                        )}
                        {history.shipment.irn && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700">IRN: {history.shipment.irnStatus}</span>
                        )}
                        {history.shipment.ewayBill && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-purple-300 bg-purple-50 text-purple-700">EWB: {history.shipment.ewayBill}</span>
                        )}
                        {history.shipment.challanNo && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">Challan: {history.shipment.challanNo}</span>
                        )}
                        {!history.shipment.invoiceRef && !history.shipment.irn && !history.shipment.ewayBill && (
                          <span className="text-slate-400 text-xs">No documents yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Timeline</div>
                    <div className="relative">
                      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" />
                      <div className="space-y-3">
                        {history.timeline.map((t, i) => (
                          <div key={i} className="flex gap-3 relative">
                            <div className={`w-[15px] h-[15px] border-2 bg-white z-10 flex-shrink-0 mt-0.5 ${
                              i === history.timeline.length - 1 ? 'border-emerald-500' : 'border-slate-300'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-700">{t.event}</p>
                              {t.detail && <p className="text-[10px] text-slate-400 mt-0.5">{t.detail}</p>}
                              <p className="text-[10px] text-slate-400 mt-0.5">
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
    </div>
  );
}
