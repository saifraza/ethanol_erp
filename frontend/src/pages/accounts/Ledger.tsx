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
      const res = await api.get<LedgerData>(`/journal-entries/ledger/${selectedAccountId}`, { params });
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
    return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtDate = (d: string): string => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Group accounts by type for easier selection
  const groupedAccounts = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    if (!acc[a.type]) acc[a.type] = [];
    acc[a.type].push(a);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-gray-800">Ledger</h1>

      {/* Account Selector + Date Range */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[250px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Select Account</label>
          <select
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="">— Select Account —</option>
            {Object.entries(groupedAccounts).map(([type, accs]) => (
              <optgroup key={type} label={type}>
                {accs.map(a => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={e => setDateRange(f => ({ ...f, from: e.target.value }))}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
          <input
            type="date"
            value={dateRange.to}
            onChange={e => setDateRange(f => ({ ...f, to: e.target.value }))}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading ledger...</div>}

      {ledger && !loading && (
        <>
          {/* Account Header */}
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-mono text-gray-400 mr-2">{ledger.account.code}</span>
                <span className="text-lg font-bold text-gray-800">{ledger.account.name}</span>
                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{ledger.account.type}</span>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Closing Balance</div>
                <div className={`text-xl font-bold ${ledger.closingBalance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {ledger.closingBalance < 0 ? '-' : ''}{fmtCurrency(ledger.closingBalance) || '₹0.00'}
                </div>
              </div>
            </div>
            <div className="flex gap-6 mt-3 text-sm">
              <span className="text-gray-500">Opening: <strong>{fmtCurrency(ledger.openingBalance) || '₹0.00'}</strong></span>
              <span className="text-blue-600">Total Debit: <strong>{fmtCurrency(ledger.totalDebit)}</strong></span>
              <span className="text-red-600">Total Credit: <strong>{fmtCurrency(ledger.totalCredit)}</strong></span>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Entry #</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Narration</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Type</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-600">Debit (₹)</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-600">Credit (₹)</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-600">Balance (₹)</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening Balance Row */}
                <tr className="bg-blue-50 border-b">
                  <td colSpan={4} className="px-4 py-2 font-medium text-gray-600">Opening Balance</td>
                  <td className="px-4 py-2 text-right font-mono"></td>
                  <td className="px-4 py-2 text-right font-mono"></td>
                  <td className="px-4 py-2 text-right font-mono font-medium">
                    {fmtCurrency(ledger.openingBalance) || '₹0.00'}
                  </td>
                </tr>
                {ledger.lines.map(line => (
                  <tr key={line.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600">{fmtDate(line.journal.date)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-400">#{line.journal.entryNo}</td>
                    <td className="px-4 py-2">
                      {line.journal.narration}
                      {line.narration && line.narration !== line.journal.narration && (
                        <span className="text-xs text-gray-400 ml-1">({line.narration})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{line.journal.refType || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtCurrency(line.debit)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtCurrency(line.credit)}</td>
                    <td className={`px-4 py-2 text-right font-mono font-medium ${line.balance < 0 ? 'text-red-600' : ''}`}>
                      {line.balance < 0 ? '-' : ''}{fmtCurrency(line.balance)}
                    </td>
                  </tr>
                ))}
                {ledger.lines.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">No transactions found for this period</td></tr>
                )}
                {/* Closing Balance Row */}
                <tr className="bg-gray-100 border-t-2 font-medium">
                  <td colSpan={4} className="px-4 py-2 text-right text-gray-600">Closing Balance</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtCurrency(ledger.totalDebit)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtCurrency(ledger.totalCredit)}</td>
                  <td className={`px-4 py-2 text-right font-mono font-bold ${ledger.closingBalance < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {ledger.closingBalance < 0 ? '-' : ''}{fmtCurrency(ledger.closingBalance) || '₹0.00'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {!selectedAccountId && !loading && (
        <div className="text-center py-12 text-gray-400">Select an account to view its ledger</div>
      )}
    </div>
  );
}
