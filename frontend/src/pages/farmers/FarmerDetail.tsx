import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Wallet, X, Save } from 'lucide-react';
import api from '../../services/api';

interface Farmer {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  aadhaar: string | null;
  maanNumber: string | null;
  village: string | null;
  tehsil: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  rawMaterialTypes: string | null;
  kycStatus: string;
  kycNotes: string | null;
  isRCM: boolean;
  isActive: boolean;
  remarks: string | null;
  createdAt: string;
}

interface LedgerEvent {
  date: string;
  type: 'PURCHASE' | 'PAYMENT';
  refNo: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  sourceId: string;
}

interface Summary {
  totalTrips: number;
  totalPurchased: number;
  totalPaid: number;
  outstanding: number;
}

const PAY_MODES = ['CASH', 'UPI', 'NEFT', 'RTGS', 'BANK_TRANSFER'];

export default function FarmerDetail() {
  const { id } = useParams<{ id: string }>();
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('CASH');
  const [payRef, setPayRef] = useState('');
  const [payRemarks, setPayRemarks] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/farmers/${id}/ledger`);
      setFarmer(res.data.farmer);
      setEvents(res.data.events);
      setSummary(res.data.summary);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submitPayment = async () => {
    setPayError('');
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { setPayError('Enter a positive amount'); return; }
    setPaySaving(true);
    try {
      await api.post(`/farmers/${id}/payments`, {
        amount: amt,
        mode: payMode,
        reference: payRef || null,
        remarks: payRemarks || null,
      });
      setPayAmount(''); setPayRef(''); setPayRemarks('');
      setShowPay(false);
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setPayError(err.response?.data?.error || 'Failed to record payment');
    } finally { setPaySaving(false); }
  };

  if (loading) return <div className="p-12 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (!farmer) return <div className="p-6 text-slate-500">Farmer not found.</div>;

  return (
    <div className="p-3 md:p-6 space-y-4">
      <div className="bg-white border border-slate-300 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/farmers" className="text-slate-500 hover:text-slate-800"><ArrowLeft className="w-4 h-4" /></Link>
          <h1 className="text-base font-bold tracking-wide uppercase text-slate-800">{farmer.name}</h1>
          <span className="text-xs font-mono text-slate-500">{farmer.code}</span>
        </div>
        <button onClick={() => setShowPay(true)}
          className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-800 flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5" /> Record Payment
        </button>
      </div>

      {/* KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Kpi label="Trips" value={String(summary.totalTrips)} />
          <Kpi label="Purchased" value={`₹${summary.totalPurchased.toLocaleString('en-IN')}`} />
          <Kpi label="Paid" value={`₹${summary.totalPaid.toLocaleString('en-IN')}`} />
          <Kpi label="Outstanding" value={`₹${summary.outstanding.toLocaleString('en-IN')}`}
            tone={summary.outstanding > 0 ? 'amber' : 'green'} />
        </div>
      )}

      {/* Profile */}
      <div className="bg-white border border-slate-300 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 px-4 py-3 text-xs">
        <Field k="Phone" v={farmer.phone} mono />
        <Field k="Aadhaar" v={farmer.aadhaar} mono />
        <Field k="Maan No." v={farmer.maanNumber} mono />
        <Field k="Material" v={farmer.rawMaterialTypes} />
        <Field k="Village" v={farmer.village} />
        <Field k="Tehsil" v={farmer.tehsil} />
        <Field k="District" v={farmer.district} />
        <Field k="State / Pin" v={`${farmer.state || ''}${farmer.pincode ? ' - ' + farmer.pincode : ''}` || null} />
        <Field k="Bank A/C" v={farmer.bankAccount} mono />
        <Field k="IFSC" v={farmer.bankIfsc} mono />
        <Field k="UPI" v={farmer.upiId} mono />
        <Field k="KYC" v={farmer.kycStatus} />
      </div>

      {/* Ledger */}
      <div className="bg-white border border-slate-300 overflow-x-auto">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600">
          Ledger — Running Balance
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-[11px] uppercase tracking-widest text-slate-500">
              <th className="px-3 py-2 text-left font-bold">Date</th>
              <th className="px-3 py-2 text-left font-bold">Type</th>
              <th className="px-3 py-2 text-left font-bold">Ref</th>
              <th className="px-3 py-2 text-left font-bold">Description</th>
              <th className="px-3 py-2 text-right font-bold">Paid (Dr)</th>
              <th className="px-3 py-2 text-right font-bold">Owed (Cr)</th>
              <th className="px-3 py-2 text-right font-bold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400 text-sm">
                No transactions yet.
              </td></tr>
            )}
            {events.map(e => (
              <tr key={`${e.type}-${e.sourceId}`} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1.5 text-xs">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                <td className="px-3 py-1.5">
                  <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase border ${e.type === 'PURCHASE' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-emerald-50 border-emerald-300 text-emerald-700'}`}>
                    {e.type}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{e.refNo}</td>
                <td className="px-3 py-1.5 text-xs">{e.description}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{e.debit > 0 ? `₹${e.debit.toLocaleString('en-IN')}` : ''}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{e.credit > 0 ? `₹${e.credit.toLocaleString('en-IN')}` : ''}</td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs font-bold ${e.balance > 0 ? 'text-amber-700' : e.balance < 0 ? 'text-red-700' : 'text-slate-400'}`}>
                  ₹{e.balance.toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showPay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md border border-slate-300">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest">Record Payment</h2>
              <button onClick={() => { setShowPay(false); setPayError(''); }} className="hover:bg-slate-700 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Amount *</label>
                <input value={payAmount} onChange={e => setPayAmount(e.target.value)} type="number" step="0.01"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Mode</label>
                  <select value={payMode} onChange={e => setPayMode(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                    {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Reference</label>
                  <input value={payRef} onChange={e => setPayRef(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="UTR / cheque no" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Remarks</label>
                <input value={payRemarks} onChange={e => setPayRemarks(e.target.value)}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
              {payError && <div className="bg-red-50 border border-red-300 text-red-700 px-3 py-2 text-xs">{payError}</div>}
            </div>
            <div className="border-t border-slate-300 px-4 py-2.5 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => { setShowPay(false); setPayError(''); }}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-bold uppercase hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={submitPayment} disabled={paySaving}
                className="px-4 py-1.5 bg-emerald-700 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-800 disabled:opacity-50 flex items-center gap-1.5">
                {paySaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'amber' | 'green' }) {
  const toneCls = tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-800';
  return (
    <div className="bg-white border border-slate-300 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</div>
      <div className={`text-lg font-bold font-mono ${toneCls}`}>{value}</div>
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{k}</span>{' '}
      <span className={`text-slate-800 ${mono ? 'font-mono' : ''}`}>{v || '—'}</span>
    </div>
  );
}
