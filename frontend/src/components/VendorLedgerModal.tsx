import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api';

interface LedgerItem {
  date: string;
  type: string;
  reference: string;
  debit: number;
  credit: number;
  runningBalance: number;
  info?: string;
}

interface Vendor {
  id: string;
  name: string;
  phone: string | null;
  gstin?: string | null;
  address?: string | null;
}

interface Props {
  vendorId: string;
  vendorName?: string;
  onClose: () => void;
}

export default function VendorLedgerModal({ vendorId, vendorName, onClose }: Props) {
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchLedger = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<{ vendor: Vendor; ledger: LedgerItem[]; currentBalance: number }>(`/vendor-payments/ledger/${vendorId}`);
      setLedger(res.data.ledger || []);
      setVendor(res.data.vendor || null);
      setBalance(res.data.currentBalance || 0);
    } catch (err) {
      console.error('Failed to load ledger', err);
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const dd = String(ist.getUTCDate()).padStart(2, '0');
    const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${ist.getUTCFullYear()}`;
  };
  const fmtCurrency = (n: number) => n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totals = ledger.reduce((acc, l) => ({ debit: acc.debit + (l.debit || 0), credit: acc.credit + (l.credit || 0) }), { debit: 0, credit: 0 });

  const downloadExcel = () => {
    const headers = ['Date', 'Type', 'Reference', 'Particulars', 'Debit (₹)', 'Credit (₹)', 'Balance (₹)'];
    const rows = ledger.map(l => [
      fmtDate(l.date),
      l.type,
      l.reference || '',
      l.info || '',
      l.debit ? l.debit.toFixed(2) : '',
      l.credit ? l.credit.toFixed(2) : '',
      l.runningBalance.toFixed(2),
    ]);
    rows.push([]);
    rows.push(['TOTAL', '', '', '', totals.debit.toFixed(2), totals.credit.toFixed(2), balance.toFixed(2)]);
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = (vendor?.name || vendorName || 'vendor').replace(/[^A-Za-z0-9_-]+/g, '_');
    a.download = `${safe}_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const typeColor = (t: string) => {
    if (t === 'PO') return 'border-slate-300 bg-slate-50 text-slate-600';
    if (t === 'INVOICE') return 'border-blue-300 bg-blue-50 text-blue-700';
    if (t === 'PAYMENT') return 'border-green-300 bg-green-50 text-green-700';
    if (t === 'CASH PAYMENT') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    return 'border-slate-300 bg-slate-50 text-slate-600';
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest">Vendor Ledger — {vendor?.name || vendorName || '...'}</h2>
            {vendor?.gstin && <>
              <span className="text-[10px] text-slate-400">|</span>
              <span className="text-[10px] text-slate-400">GSTIN {vendor.gstin}</span>
            </>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadExcel}
              disabled={!ledger.length}
              className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium uppercase tracking-widest hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed"
            >
              Download Excel
            </button>
            <button onClick={onClose} className="px-3 py-1 bg-white border border-slate-300 text-slate-700 text-[11px] font-medium hover:bg-slate-50">Close</button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-0 border-b border-slate-300">
          <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Entries</div>
            <div className="text-lg font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{ledger.length}</div>
          </div>
          <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Debit</div>
            <div className="text-lg font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtCurrency(totals.debit)}</div>
          </div>
          <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Credit</div>
            <div className="text-lg font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtCurrency(totals.credit)}</div>
          </div>
          <div className={`bg-white px-4 py-2 border-l-4 ${balance > 0 ? 'border-l-red-500' : 'border-l-slate-400'}`}>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Outstanding</div>
            <div className={`text-lg font-bold mt-0.5 font-mono tabular-nums ${balance > 0 ? 'text-red-600' : 'text-slate-500'}`}>{fmtCurrency(balance)}</div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-10 text-center text-xs text-slate-400 uppercase tracking-widest">Loading ledger...</div>
          ) : ledger.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-400 uppercase tracking-widest">No ledger entries</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Reference</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Particulars</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Debit</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Credit</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l, i) => (
                  <tr key={i} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(l.date)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${typeColor(l.type)}`}>{l.type}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums border-r border-slate-100">{l.reference || '--'}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{l.info || '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{l.debit ? fmtCurrency(l.debit) : '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">{l.credit ? fmtCurrency(l.credit) : '--'}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold ${l.runningBalance > 0 ? 'text-red-600' : 'text-slate-500'}`}>{fmtCurrency(l.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-800 text-white font-semibold sticky bottom-0">
                  <td colSpan={4} className="px-3 py-1.5 text-[10px] uppercase tracking-widest border-r border-slate-700">Total</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(totals.debit)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(totals.credit)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${balance > 0 ? 'text-red-300' : ''}`}>{fmtCurrency(balance)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
