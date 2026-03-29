import React, { useState, useEffect, useCallback } from 'react';
import { Truck, X, CheckCircle, XCircle, Plus } from 'lucide-react';
import api from '../../services/api';

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

interface ShipmentRef {
  id: string;
  vehicleNo: string | null;
  customerName: string | null;
  productName: string | null;
  weightNet: number | null;
  grBiltyNo: string | null;
  grReceivedBack: boolean | null;
}

interface TransporterPayment {
  id: string;
  paymentNo: number;
  shipmentId: string;
  shipment: ShipmentRef;
  transporterId: string | null;
  transporterName: string;
  paymentType: string;
  amount: number;
  paymentDate: string;
  mode: string;
  reference: string | null;
  freightRate: number | null;
  freightTotal: number | null;
  status: string;
  paidAt: string | null;
  approvedBy: string | null;
  remarks: string | null;
  createdAt: string;
}

interface Summary {
  name: string;
  totalFreight: number;
  advance: number;
  balance: number;
  paid: number;
  pending: number;
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

const fmtCurrency = (n: number): string =>
  n === 0 ? '--' : '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 0 });

const fmtDate = (d: string | null): string =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';

const statusColor = (s: string): string => {
  switch (s) {
    case 'PAID': return 'border-green-300 bg-green-50 text-green-700';
    case 'PENDING': return 'border-amber-300 bg-amber-50 text-amber-700';
    case 'CANCELLED': return 'border-red-300 bg-red-50 text-red-700';
    default: return 'border-slate-300 bg-slate-50 text-slate-600';
  }
};

const typeColor = (t: string): string => {
  switch (t) {
    case 'ADVANCE': return 'border-blue-300 bg-blue-50 text-blue-700';
    case 'BALANCE': return 'border-green-300 bg-green-50 text-green-700';
    case 'FULL': return 'border-violet-300 bg-violet-50 text-violet-700';
    case 'DEDUCTION': return 'border-red-300 bg-red-50 text-red-700';
    default: return 'border-slate-300 bg-slate-50 text-slate-600';
  }
};

// ═══════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════

export default function TransporterPayments() {
  const [payments, setPayments] = useState<TransporterPayment[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'PAID' | 'CANCELLED'>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (filter !== 'ALL') params.status = filter;
      const [payRes, sumRes] = await Promise.all([
        api.get<{ payments: TransporterPayment[] }>('/transporter-payments', { params }),
        api.get<{ summary: Summary[] }>('/transporter-payments/summary'),
      ]);
      setPayments(payRes.data.payments || []);
      setSummary(sumRes.data.summary || []);
    } catch {
      setError('Failed to load transporter payments');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleMarkPaid = async (id: string, reference: string) => {
    try {
      setMarkingPaid(id);
      await api.put(`/transporter-payments/${id}`, { status: 'PAID', reference: reference || undefined });
      setSuccessMsg('Payment marked as paid');
      fetchData();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr.response?.data?.error || 'Failed to update');
    } finally {
      setMarkingPaid(null);
    }
  };

  // Totals
  const totalPaid = payments.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter(p => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0);
  const totalAdvance = payments.filter(p => p.paymentType === 'ADVANCE').reduce((s, p) => s + p.amount, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck className="w-4 h-4" />
            <h1 className="text-sm font-bold tracking-wide uppercase">Transporter Payments</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Freight Advance & Balance Tracking</span>
          </div>
        </div>

        {/* Messages */}
        {successMsg && (
          <div className="border border-green-300 bg-green-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
            <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-600" /><span className="text-xs text-green-800">{successMsg}</span></div>
            <button onClick={() => setSuccessMsg(null)}><X className="w-3.5 h-3.5 text-green-600" /></button>
          </div>
        )}
        {error && (
          <div className="border border-red-300 bg-red-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
            <div className="flex items-center gap-2"><XCircle className="w-4 h-4 text-red-600" /><span className="text-xs text-red-800">{error}</span></div>
            <button onClick={() => setError(null)}><X className="w-3.5 h-3.5 text-red-600" /></button>
          </div>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Paid</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(totalPaid)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(totalPending)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Advances Given</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(totalAdvance)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-slate-400">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Transporters</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.length}</div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2.5 bg-slate-100 flex items-center gap-1.5">
          {(['ALL', 'PENDING', 'PAID', 'CANCELLED'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                filter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Payments Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          {payments.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">No transporter payments found</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">#</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Transporter</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Customer</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Mode</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Reference</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-slate-500">{p.paymentNo}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-800">{p.transporterName}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{p.shipment?.vehicleNo || '--'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{p.shipment?.customerName || '--'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${typeColor(p.paymentType)}`}>{p.paymentType}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums font-medium text-slate-800">{fmtCurrency(p.amount)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{p.mode}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-[10px] text-slate-500">{p.reference || '--'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor(p.status)}`}>{p.status}</span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-500">{fmtDate(p.createdAt)}</td>
                    <td className="px-3 py-1.5">
                      {p.status === 'PENDING' && (
                        <button
                          onClick={() => {
                            const ref = prompt('Enter payment reference (UTR/cheque no):');
                            if (ref !== null) handleMarkPaid(p.id, ref);
                          }}
                          disabled={markingPaid === p.id}
                          className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700 disabled:opacity-50"
                        >
                          {markingPaid === p.id ? '...' : 'Mark Paid'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-800 text-white font-semibold">
                  <td className="px-3 py-2 border-r border-slate-700" colSpan={5}>
                    <span className="text-[10px] uppercase tracking-widest">{payments.length} payments</span>
                  </td>
                  <td className="px-3 py-2 text-right border-r border-slate-700 font-mono tabular-nums text-[10px] uppercase tracking-widest">
                    {fmtCurrency(payments.reduce((s, p) => s + p.amount, 0))}
                  </td>
                  <td className="px-3 py-2" colSpan={5}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Transporter Summary */}
        {summary.length > 0 && (
          <>
            <div className="bg-slate-200 border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Summary by Transporter</span>
            </div>
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-700 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Transporter</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Total Freight</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Advance Paid</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Balance Paid</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Total Paid</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s, i) => (
                    <tr key={s.name} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-800">{s.name}</td>
                      <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums">{fmtCurrency(s.totalFreight)}</td>
                      <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums text-blue-700">{fmtCurrency(s.advance)}</td>
                      <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums">{fmtCurrency(s.balance)}</td>
                      <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums text-green-700 font-medium">{fmtCurrency(s.paid)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-700 font-medium">{fmtCurrency(s.pending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
