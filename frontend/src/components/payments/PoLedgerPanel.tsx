import type { PoLedger } from './types';

// Reusable running-ledger panel — same KPIs + scrollable event list rendered
// in the Pay modal and the upload-staging modal. Keeps the two flows visually
// consistent with the accounts Payments Out ledger style.
export default function PoLedgerPanel({ led, loading, fmtCurrency, onOpenVendorLedger }: { led: PoLedger | null; loading: boolean; fmtCurrency: (n: number) => string; onOpenVendorLedger?: () => void }) {
  if (loading) {
    return <div className="text-xs text-slate-400 uppercase tracking-widest text-center py-6">Loading PO ledger…</div>;
  }
  if (!led) {
    return <div className="text-xs text-slate-400 uppercase tracking-widest text-center py-6">No ledger data.</div>;
  }
  // "Settled" only makes sense once something has actually been paid AND the
  // payable basis is fully covered. A PO with received=0 / invoiced=0 / no
  // payments hangs on the planned amount and should read as Pending.
  const trulySettled = led.totalPaid > 0 && led.outstanding <= 0.01;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">PO-{led.poNo} Running Ledger</div>
        {onOpenVendorLedger && (
          <button onClick={onOpenVendorLedger} className="text-[10px] text-indigo-700 font-bold uppercase tracking-widest hover:underline">
            View Vendor Ledger →
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-0 border border-slate-300">
        <div className="px-3 py-2 border-r border-b border-slate-300 bg-white">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Received Value</div>
          <div className="text-sm font-mono tabular-nums font-bold text-slate-800">{fmtCurrency(led.receivedValue)}</div>
        </div>
        <div className="px-3 py-2 border-b border-slate-300 bg-white">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Invoiced</div>
          <div className="text-sm font-mono tabular-nums font-bold text-slate-800">{fmtCurrency(led.totalInvoiced)}</div>
        </div>
        <div className="px-3 py-2 border-r border-slate-300 bg-white">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Paid (Confirmed)</div>
          <div className="text-sm font-mono tabular-nums font-bold text-emerald-700">{fmtCurrency(led.totalPaid)}</div>
        </div>
        <div className="px-3 py-2 bg-white">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
            Outstanding
            {led.basisSource !== 'RECEIVED' && (
              <span className={`ml-1 normal-case text-[8px] font-bold ${led.basisSource === 'INVOICED' ? 'text-indigo-500' : 'text-amber-600'}`}>
                ({led.basisSource === 'INVOICED' ? 'billed basis' : 'planned basis'})
              </span>
            )}
          </div>
          <div className={`text-sm font-mono tabular-nums font-bold ${led.outstanding > 0.01 ? 'text-red-700' : trulySettled ? 'text-emerald-700' : 'text-slate-400'}`}>
            {led.outstanding > 0.01 ? fmtCurrency(led.outstanding) : trulySettled ? '✓ Settled' : '—'}
          </div>
        </div>
      </div>
      <div className="border border-slate-300 bg-white">
        <div className="bg-slate-100 border-b border-slate-300 px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest grid grid-cols-12 gap-2">
          <div className="col-span-2">Date</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-4">Ref</div>
          <div className="col-span-2 text-right">Amount</div>
          <div className="col-span-2 text-right">Balance</div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {led.ledger.length === 0 ? (
            <div className="px-3 py-6 text-center text-[10px] text-slate-400 uppercase tracking-widest">No invoice or payment events yet.</div>
          ) : (
            led.ledger.map((row, i) => (
              <div key={`${row.type}-${row.id}`} className={`px-2 py-1.5 text-[10px] border-b border-slate-100 grid grid-cols-12 gap-2 ${i % 2 ? 'bg-slate-50/60' : ''}`}>
                <div className="col-span-2 font-mono text-slate-500">
                  {new Date(row.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                </div>
                <div className="col-span-2">
                  <span className={`font-bold uppercase tracking-widest ${
                    row.type === 'INVOICE' ? 'text-indigo-700'
                    : row.type === 'CASH_VOUCHER' ? 'text-amber-700'
                    : 'text-emerald-700'
                  }`}>
                    {row.type === 'INVOICE' ? 'Bill' : row.type === 'CASH_VOUCHER' ? 'Cash' : 'Pay'}
                  </span>
                </div>
                <div className="col-span-4 truncate">
                  {row.type === 'INVOICE' ? (
                    row.filePath ? (
                      <a href={`/uploads/${row.filePath}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {row.vendorInvNo || row.fileName || 'Invoice'}
                      </a>
                    ) : (row.vendorInvNo || row.fileName || '—')
                  ) : row.type === 'CASH_VOUCHER' ? (
                    <>
                      <span className="font-mono text-slate-700">CV-{row.voucherNo}</span>
                      <span className="text-slate-400 mx-1">·</span>
                      <span className="text-slate-600">{row.mode}</span>
                      {row.reference && <span className="text-slate-400 ml-1 font-mono">{row.reference}</span>}
                      {row.status === 'ACTIVE' && <span className="ml-1 text-amber-700 font-bold">(pending settlement)</span>}
                      {row.status === 'CANCELLED' && <span className="ml-1 text-slate-400 font-bold">(cancelled)</span>}
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-slate-700">#{row.paymentNo}</span>
                      <span className="text-slate-400 mx-1">·</span>
                      <span className="text-slate-600">{row.mode}</span>
                      {row.reference && <span className="text-slate-400 ml-1 font-mono">{row.reference}</span>}
                      {row.paymentStatus === 'INITIATED' && <span className="ml-1 text-amber-700 font-bold">(pending UTR)</span>}
                    </>
                  )}
                </div>
                <div className={`col-span-2 text-right font-mono tabular-nums ${
                  row.type === 'PAYMENT' ? 'text-emerald-700'
                  : row.type === 'CASH_VOUCHER' ? 'text-amber-700'
                  : 'text-slate-700'
                }`}>
                  {row.type === 'PAYMENT' || row.type === 'CASH_VOUCHER' ? '−' : '+'}{fmtCurrency(row.amount)}
                </div>
                <div className={`col-span-2 text-right font-mono tabular-nums font-bold ${row.runningBalance > 0.01 ? 'text-red-700' : 'text-slate-500'}`}>
                  {fmtCurrency(row.runningBalance)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
