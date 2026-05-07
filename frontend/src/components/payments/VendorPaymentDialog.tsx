import { useEffect, useState } from 'react';
import api from '../../services/api';

type PayMode = 'CASH' | 'UPI' | 'NEFT' | 'RTGS' | 'BANK_TRANSFER' | 'CHEQUE';
type PaymentKind = 'ADVANCE' | 'AGAINST_PO';

interface OpenPoOption {
  id: string;
  poNo: number;
  outstanding: number;
  dealType: string;
}

interface VendorPaymentDialogProps {
  vendorId: string;
  vendorName: string;
  fmtCurrency: (n: number) => string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Vendor-level payment recorder. Used from the Vendor Ledger tab in
 * PaymentsOut so accounts can:
 *   - record an advance payment (no PO yet)
 *   - record a missed/historical payment against a specific PO
 *   - record a vendor-level adjustment
 *
 * Routes:
 *   ADVANCE     → POST /api/vendor-payments/        (isAdvance: true)
 *   AGAINST_PO  → POST /api/purchase-orders/:id/pay (canonical, full validation)
 */
export default function VendorPaymentDialog({
  vendorId,
  vendorName,
  fmtCurrency,
  onClose,
  onSaved,
}: VendorPaymentDialogProps) {
  const [kind, setKind] = useState<PaymentKind>('ADVANCE');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PayMode>('NEFT');
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [poId, setPoId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Open POs for this vendor — fetched lazily when user picks "Against PO".
  const [openPos, setOpenPos] = useState<OpenPoOption[]>([]);
  const [posLoading, setPosLoading] = useState(false);

  useEffect(() => {
    if (kind !== 'AGAINST_PO') return;
    let cancelled = false;
    setPosLoading(true);
    // Reuse the unified-payments pending feed and filter to this vendor.
    api.get<{ items: Array<{ poId: string; poNo: number; vendorId: string; balance: number; dealType: string }> }>('/unified-payments/outgoing/pending')
      .then((res) => {
        if (cancelled) return;
        const mine = (res.data.items || [])
          .filter((p) => p.vendorId === vendorId && p.balance > 0.01)
          .map<OpenPoOption>((p) => ({ id: p.poId, poNo: p.poNo, outstanding: p.balance, dealType: p.dealType }));
        setOpenPos(mine);
        // Auto-select first PO if any.
        if (mine.length > 0 && !poId) setPoId(mine[0].id);
      })
      .catch((err) => { console.error(err); })
      .finally(() => { if (!cancelled) setPosLoading(false); });
    return () => { cancelled = true; };
  }, [kind, vendorId, poId]);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) {
      alert('Enter a positive amount');
      return;
    }
    setSubmitting(true);
    try {
      if (kind === 'AGAINST_PO') {
        if (!poId) {
          alert('Pick a PO or switch to Advance');
          setSubmitting(false);
          return;
        }
        await api.post(`/purchase-orders/${poId}/pay`, {
          amount: amt,
          mode,
          reference: reference || '',
          remarks: remarks || '',
          hasGst: true,
        });
      } else {
        // Advance — no PO link.
        await api.post('/vendor-payments/', {
          vendorId,
          amount: amt,
          mode,
          reference: reference || '',
          paymentDate,
          isAdvance: true,
          remarks: remarks || `Advance payment to ${vendorName}`,
          hasGst: false,
        });
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Payment failed';
      alert(msg);
      setSubmitting(false);
    }
  };

  const selectedPo = openPos.find((p) => p.id === poId);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-[520px] max-w-[95vw] shadow-2xl">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest">Record Payment</div>
            <div className="text-[10px] text-slate-300">{vendorName}</div>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-slate-300 hover:text-white text-lg leading-none disabled:opacity-50">×</button>
        </div>
        <div className="p-4 space-y-3">
          {/* Type toggle */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Type</label>
            <div className="mt-1 flex gap-0 border border-slate-300">
              <button
                type="button"
                onClick={() => setKind('ADVANCE')}
                className={`flex-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest border-r border-slate-300 ${kind === 'ADVANCE' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                Advance
              </button>
              <button
                type="button"
                onClick={() => setKind('AGAINST_PO')}
                className={`flex-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest ${kind === 'AGAINST_PO' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                Against PO
              </button>
            </div>
            <div className="mt-1 text-[9px] text-slate-400">
              {kind === 'ADVANCE'
                ? 'No PO linked — sits as an open advance until adjusted later.'
                : 'Posts against a specific PO with full validation.'}
            </div>
          </div>

          {/* PO picker when AGAINST_PO */}
          {kind === 'AGAINST_PO' && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Purchase Order</label>
              {posLoading ? (
                <div className="mt-1 text-[11px] text-slate-400 italic">Loading vendor's open POs…</div>
              ) : openPos.length === 0 ? (
                <div className="mt-1 text-[11px] text-amber-600">No open POs for this vendor — switch to Advance.</div>
              ) : (
                <select
                  value={poId}
                  onChange={(e) => setPoId(e.target.value)}
                  className="w-full mt-1 border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500">
                  {openPos.map((p) => (
                    <option key={p.id} value={p.id}>
                      PO-{p.poNo} · {p.dealType} · Outstanding {fmtCurrency(p.outstanding)}
                    </option>
                  ))}
                </select>
              )}
              {selectedPo && (
                <div className="mt-1 text-[9px] text-slate-400 font-mono tabular-nums">
                  Outstanding on this PO: {fmtCurrency(selectedPo.outstanding)}
                </div>
              )}
            </div>
          )}

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

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as PayMode)}
                className="w-full mt-1 border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500">
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="UPI">UPI</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CHEQUE">Cheque</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full mt-1 border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
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
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-2.5 flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-600 border border-slate-300 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !amount || (kind === 'AGAINST_PO' && !poId)}
            className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {submitting ? 'Recording…' : kind === 'ADVANCE' ? 'Record Advance' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
