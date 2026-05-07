import { useEffect, useState } from 'react';
import api from '../../services/api';
import PoLedgerPanel from './PoLedgerPanel';
import type { PoLedger } from './types';

type PayMode = 'CASH' | 'UPI' | 'NEFT' | 'RTGS' | 'BANK_TRANSFER' | 'CHEQUE';

// Fuel deals use a dedicated endpoint with its own pre-flight (confirmed-GRN
// gate). Generic PO pay (accounts page, store, contractor, transporter, etc.)
// uses /purchase-orders/:id/pay which has full validation incl. cash-voucher
// routing + auto-close. Caller picks the surface.
export type PayDialogSurface = 'fuel' | 'generic';

interface PayDialogProps {
  poId: string;
  poNo: number;
  vendorName: string;
  /** Subtitle line under the title — usually fuel name, item name, or category. */
  subtitle?: string;
  outstanding: number;
  /** Backend surface to POST against. Defaults to 'fuel'. */
  surface?: PayDialogSurface;
  fmtCurrency: (n: number) => string;
  onClose: () => void;
  onPaid: () => void;
  onOpenVendorLedger?: () => void;
}

export default function PayDialog({
  poId,
  poNo,
  vendorName,
  subtitle,
  outstanding,
  surface = 'fuel',
  fmtCurrency,
  onClose,
  onPaid,
  onOpenVendorLedger,
}: PayDialogProps) {
  const [amount, setAmount] = useState<string>(String(outstanding.toFixed(2)));
  const [mode, setMode] = useState<PayMode>('NEFT');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ledger, setLedger] = useState<PoLedger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Lazy-fetch the running ledger on mount.
  useEffect(() => {
    let cancelled = false;
    setLedger(null);
    setLedgerLoading(true);
    api.get<PoLedger>(`/fuel/payments/${poId}/ledger`)
      .then((res) => {
        if (cancelled) return;
        setLedger(res.data);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });
    return () => { cancelled = true; };
  }, [poId]);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) {
      alert('Enter a positive amount');
      return;
    }
    if (amt > outstanding + 0.01) {
      const ok = window.confirm(`Amount ₹${amt.toLocaleString('en-IN')} exceeds outstanding ₹${outstanding.toLocaleString('en-IN')}. Continue anyway?`);
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      if (surface === 'generic') {
        // /purchase-orders/:id/pay accepts hasGst (compulsory) + caps at received value.
        await api.post(`/purchase-orders/${poId}/pay`, {
          amount: amt,
          mode,
          reference: reference || '',
          remarks: remarks || '',
          hasGst: true, // accounts page is booking against received material; GST already in poTotal
        });
      } else {
        await api.post(`/fuel/deals/${poId}/payment`, {
          dealId: poId,
          amount: amt,
          mode,
          reference: reference || '',
          remarks: remarks || '',
        });
      }
      onPaid();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Payment failed';
      alert(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-[920px] max-w-[95vw] max-h-[92vh] shadow-2xl flex flex-col">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest">Pay PO-{poNo}</div>
            <div className="text-[10px] text-slate-300">{vendorName}{subtitle ? ` · ${subtitle}` : ''}</div>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-slate-300 hover:text-white text-lg leading-none disabled:opacity-50">×</button>
        </div>
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-0">
          {/* Left: form */}
          <div className="p-4 space-y-3 border-r border-slate-200">
            <div className="bg-slate-50 border border-slate-200 px-3 py-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Outstanding</div>
              <div className="text-lg font-bold text-red-700 font-mono tabular-nums">{fmtCurrency(outstanding)}</div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Amount (₹)</label>
              <input
                type="number" step="0.01" min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full mt-1 border border-slate-300 px-2 py-1.5 text-sm font-mono tabular-nums focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as PayMode)}
                className="w-full mt-1 border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="UPI">UPI</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CHEQUE">Cheque</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            {mode !== 'CASH' && (
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Reference / UTR</label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={mode === 'CHEQUE' ? 'Cheque no.' : 'UTR / UPI ref'}
                  className="w-full mt-1 border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Remarks (optional)</label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full mt-1 border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          {/* Right: PO ledger panel */}
          <div className="p-4 bg-slate-50">
            <PoLedgerPanel
              led={ledger}
              loading={ledgerLoading}
              fmtCurrency={fmtCurrency}
              onOpenVendorLedger={onOpenVendorLedger}
            />
          </div>
        </div>
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-2.5 flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-600 border border-slate-300 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={submitting || !amount} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {submitting ? 'Recording…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
