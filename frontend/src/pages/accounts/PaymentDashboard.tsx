import { useState, useEffect, useCallback } from 'react';
import {
  IndianRupee, Loader2, CheckCircle, Clock, Truck, AlertCircle,
  RefreshCw, CreditCard, Banknote, Smartphone, Building2
} from 'lucide-react';
import api from '../../services/api';

interface PendingShipment {
  id: string;
  shipmentNo: number;
  vehicleNo: string;
  customerName: string;
  productName: string;
  destination: string;
  weightNet: number | null;
  netMT: number;
  bags: number | null;
  paymentTerms: string;
  status: string;
  date: string;
  gateInTime: string;
  invoiceRef: string | null;
  ewayBill: string | null;
  rate: number;
  gstPercent: number;
  expectedAmount: number;
  customerPhone: string | null;
  orderNo: number | null;
}

interface DashboardData {
  pendingCount: number;
  todayCollections: {
    count: number;
    total: number;
    breakdown: Record<string, { count: number; amount: number }>;
  };
  recentConfirmed: {
    id: string;
    shipmentNo: number;
    vehicleNo: string;
    customerName: string;
    productName: string;
    weightNet: number | null;
    paymentAmount: number | null;
    paymentMode: string | null;
    paymentRef: string | null;
    paymentConfirmedAt: string | null;
  }[];
}

const MODE_ICONS: Record<string, any> = {
  CASH: Banknote, UPI: Smartphone, NEFT: Building2, RTGS: Building2,
  CHEQUE: CreditCard, BANK_TRANSFER: Building2,
};

export default function PaymentDashboard() {
  const [pending, setPending] = useState<PendingShipment[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Payment form
  const [payId, setPayId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ mode: 'UPI', ref: '', amount: '' });
  const [paySaving, setPaySaving] = useState(false);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
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
      flash('err', 'Failed to load accounts data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  const openPayForm = (s: PendingShipment) => {
    setPayId(s.id);
    setPayForm({ mode: 'UPI', ref: '', amount: String(s.expectedAmount || '') });
  };

  const confirmPayment = async () => {
    if (!payId) return;
    if (!payForm.amount || parseFloat(payForm.amount) <= 0) {
      flash('err', 'Enter payment amount');
      return;
    }
    setPaySaving(true);
    try {
      await api.post(`/accounts/${payId}/confirm-payment`, {
        paymentMode: payForm.mode,
        paymentRef: payForm.ref,
        paymentAmount: parseFloat(payForm.amount),
      });
      flash('ok', `Payment confirmed — ₹${parseFloat(payForm.amount).toLocaleString('en-IN')}`);
      setPayId(null);
      setPayForm({ mode: 'UPI', ref: '', amount: '' });
      loadData();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Payment confirmation failed');
    } finally {
      setPaySaving(false);
    }
  };

  const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 to-emerald-800 text-white">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <IndianRupee size={22} /> Accounts — Payment Desk
              </h1>
              <p className="text-xs text-emerald-200 mt-1">
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <button onClick={loadData} className="p-2 hover:bg-emerald-600 rounded-lg transition" title="Refresh">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Stats */}
          {dashboard && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-600/40 rounded-lg px-4 py-3 backdrop-blur-sm">
                <p className="text-emerald-200 text-[10px] font-medium uppercase">Awaiting Payment</p>
                <p className="text-white text-2xl font-bold">{dashboard.pendingCount}</p>
              </div>
              <div className="bg-emerald-600/40 rounded-lg px-4 py-3 backdrop-blur-sm">
                <p className="text-emerald-200 text-[10px] font-medium uppercase">Today Collected</p>
                <p className="text-white text-2xl font-bold">{fmt(dashboard.todayCollections.total)}</p>
                <p className="text-emerald-300 text-[10px]">{dashboard.todayCollections.count} payments</p>
              </div>
              <div className="bg-emerald-600/40 rounded-lg px-4 py-3 backdrop-blur-sm">
                <p className="text-emerald-200 text-[10px] font-medium uppercase">Mode Split</p>
                <div className="mt-1 space-y-0.5">
                  {Object.entries(dashboard.todayCollections.breakdown).map(([mode, data]) => (
                    <p key={mode} className="text-[10px] text-emerald-100">
                      {mode}: {data.count}× {fmt(data.amount)}
                    </p>
                  ))}
                  {Object.keys(dashboard.todayCollections.breakdown).length === 0 && (
                    <p className="text-[10px] text-emerald-300">No payments today</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />} {msg.text}
          </div>
        )}

        {/* Pending Payments */}
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3 flex items-center gap-2">
          <Clock size={14} /> Awaiting Payment ({pending.length})
        </h2>

        {loading && pending.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
          </div>
        ) : pending.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
            <CheckCircle size={40} className="mx-auto text-green-400 mb-2" />
            <p className="text-gray-500 text-sm">All payments confirmed — no trucks waiting!</p>
          </div>
        ) : (
          <div className="space-y-2 mb-8">
            {pending.map(s => {
              const isExpanded = payId === s.id;
              return (
                <div key={s.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="p-3 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-gray-900">{s.vehicleNo}</span>
                        <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-[10px] font-bold">{s.paymentTerms}</span>
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">{s.productName}</span>
                        {s.invoiceRef && <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded text-[10px]">{s.invoiceRef}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{s.customerName}</span>
                        <span>•</span>
                        <span>{s.netMT} MT</span>
                        {s.bags && <><span>•</span><span>{s.bags} bags</span></>}
                        <span>•</span>
                        <span className="font-semibold text-gray-700">{fmt(s.expectedAmount)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => isExpanded ? setPayId(null) : openPayForm(s)}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                        isExpanded
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                      }`}
                    >
                      {isExpanded ? 'Cancel' : <><IndianRupee size={12} /> Confirm Payment</>}
                    </button>
                  </div>

                  {/* Payment form (inline expand) */}
                  {isExpanded && (
                    <div className="border-t bg-emerald-50 p-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] text-gray-500 font-medium uppercase">Mode</label>
                          <select value={payForm.mode} onChange={e => setPayForm(f => ({ ...f, mode: e.target.value }))}
                            className="input-field w-full text-sm mt-0.5">
                            <option value="UPI">UPI</option>
                            <option value="CASH">Cash</option>
                            <option value="NEFT">NEFT</option>
                            <option value="RTGS">RTGS</option>
                            <option value="CHEQUE">Cheque</option>
                            <option value="BANK_TRANSFER">Bank Transfer</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-medium uppercase">UTR / Reference</label>
                          <input value={payForm.ref} onChange={e => setPayForm(f => ({ ...f, ref: e.target.value }))}
                            placeholder="Transaction ID" className="input-field w-full text-sm mt-0.5" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-medium uppercase">Amount (₹)</label>
                          <input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                            placeholder="₹" className="input-field w-full text-sm mt-0.5 font-semibold" />
                        </div>
                      </div>
                      <div className="flex justify-end mt-3">
                        <button onClick={confirmPayment} disabled={paySaving}
                          className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 shadow-md">
                          {paySaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                          Confirm ₹{payForm.amount ? parseFloat(payForm.amount).toLocaleString('en-IN') : '0'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Recent Confirmed */}
        {dashboard && dashboard.recentConfirmed.length > 0 && (
          <>
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <CheckCircle size={14} className="text-green-500" /> Recent Confirmations
            </h2>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                    <th className="px-3 py-2 text-left">Vehicle</th>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-left">Mode</th>
                    <th className="px-3 py-2 text-left">Reference</th>
                    <th className="px-3 py-2 text-left">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dashboard.recentConfirmed.map(r => {
                    const ModeIcon = MODE_ICONS[r.paymentMode || ''] || CreditCard;
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{r.vehicleNo}</td>
                        <td className="px-3 py-2 text-gray-600">{r.customerName}</td>
                        <td className="px-3 py-2 text-gray-600">{r.productName}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900">
                          {r.paymentAmount ? fmt(r.paymentAmount) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1 text-gray-600">
                            <ModeIcon size={11} /> {r.paymentMode}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-[10px]">{r.paymentRef || '—'}</td>
                        <td className="px-3 py-2 text-gray-400">
                          {r.paymentConfirmedAt ? new Date(r.paymentConfirmedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
