import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface LedgerLine {
  id: string;
  debit: number;
  credit: number;
  narration: string | null;
  costCenter: string | null;
  balance: number;
  journal: {
    id: string;
    entryNo: number;
    date: string;
    narration: string;
    refType: string | null;
  };
}

interface LedgerData {
  account: Account & { openingBalance: number };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  lines: LedgerLine[];
}

export default function Ledger() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get<Account[]>('/chart-of-accounts');
      setAccounts(res.data);
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const fetchLedger = useCallback(async () => {
    if (!selectedAccountId) return;
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      const res = await api.get<LedgerData>(`/api/journal-entries/ledger/${selectedAccountId}`, { params });
      setLedger(res.data);
    } catch (err) {
      console.error('Failed to fetch ledger:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, dateRange]);

  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  const fmtCurrency = (n: number): string => {
    if (n === 0) return '';
    return '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtDate = (d: string): string => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Group accounts by type for easier selection
  const groupedAccounts = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    if (!acc[a.type]) acc[a.type] = [];
    acc[a.type].push(a);
    return acc;
  }, {});

  if (loading && !ledger) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">General Ledger</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Account-wise transaction register with running balance</span>
          </div>
          {ledger && (
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${ledger.closingBalance >= 0 ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
                {ledger.closingBalance >= 0 ? 'Dr Balance' : 'Cr Balance'}
              </span>
            </div>
          )}
        </div>

        {/* Filter Toolbar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[250px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Account</label>
            <select
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            >
              <option value="">-- Select Account --</option>
              {Object.entries(groupedAccounts).map(([type, accs]) => (
                <optgroup key={type} label={type}>
                  {accs.map(a => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">From Date</label>
            <input
              type="date"
              value={dateRange.from}
              onChange={e => setDateRange(f => ({ ...f, from: e.target.value }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To Date</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={e => setDateRange(f => ({ ...f, to: e.target.value }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
        </div>

        {loading && <div className="text-xs text-slate-400 uppercase tracking-widest py-4 px-4">Loading ledger...</div>}

        {ledger && !loading && (
          <>
            {/* Account Summary Cards */}
            <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account</div>
                <div className="text-xs font-semibold text-slate-800 mt-1">{ledger.account.name}</div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">{ledger.account.code} | {ledger.account.type}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Opening Balance</div>
                <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(ledger.openingBalance) || '\u20B90.00'}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Period Movement</div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">Dr: {fmtCurrency(ledger.totalDebit) || '\u20B90.00'}</div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums">Cr: {fmtCurrency(ledger.totalCredit) || '\u20B90.00'}</div>
              </div>
              <div className="bg-white px-4 py-3 border-l-4 border-l-emerald-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Closing Balance</div>
                <div className={`text-xl font-bold mt-1 font-mono tabular-nums ${ledger.closingBalance >= 0 ? 'text-slate-800' : 'text-red-700'}`}>
                  {ledger.closingBalance < 0 ? '-' : ''}{fmtCurrency(ledger.closingBalance) || '\u20B90.00'}
                </div>
              </div>
            </div>

            {/* Ledger Table */}
            <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Entry #</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Narration</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ref Type</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Debit</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Credit</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Opening Balance Row */}
                  <tr className="bg-slate-200 border-b border-slate-300">
                    <td colSpan={4} className="px-3 py-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Opening Balance</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100"></td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100"></td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-700">
                      {fmtCurrency(ledger.openingBalance) || '\u20B90.00'}
                    </td>
                  </tr>
                  {ledger.lines.map(line => (
                    <tr key={line.id} className="hover:bg-blue-50 border-b border-slate-100 even:bg-slate-50/50">
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{fmtDate(line.journal.date)}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400 border-r border-slate-100">#{line.journal.entryNo}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">
                        {line.journal.narration}
                        {line.narration && line.narration !== line.journal.narration && (
                          <span className="text-[10px] text-slate-400 ml-1">({line.narration})</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-[10px] text-slate-500 border-r border-slate-100">{line.journal.refType || '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(line.debit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(line.credit)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-medium ${line.balance < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                        {line.balance < 0 ? '-' : ''}{fmtCurrency(line.balance)}
                      </td>
                    </tr>
                  ))}
                  {ledger.lines.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No transactions found for this period</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td colSpan={4} className="px-3 py-2 text-right text-[10px] uppercase tracking-widest border-r border-slate-700">Closing Balance</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(ledger.totalDebit)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(ledger.totalCredit)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-bold">
                      {ledger.closingBalance < 0 ? '-' : ''}{fmtCurrency(ledger.closingBalance) || '\u20B90.00'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        {!selectedAccountId && !loading && (
          <div className="min-h-[200px] flex items-center justify-center">
            <div className="text-xs text-slate-400 uppercase tracking-widest">Select an account to view its ledger</div>
          </div>
        )}
      </div>
    </div>
  );
}
