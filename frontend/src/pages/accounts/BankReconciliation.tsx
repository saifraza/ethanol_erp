import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  subType: string | null;
}

interface BankTxn {
  id: string;
  accountId: string;
  date: string;
  description: string;
  refNo: string | null;
  debit: number;
  credit: number;
  balance: number;
  isReconciled: boolean;
  reconciledAt: string | null;
  journalEntryId: string | null;
  journalEntry?: {
    id: string;
    entryNo: number;
    date: string;
    narration: string;
  } | null;
}

interface ReconSummary {
  bookBalance: number;
  bankBalance: number;
  difference: number;
  unreconciledCount: number;
}

interface JournalOption {
  id: string;
  entryNo: number;
  date: string;
  narration: string;
  amount: number;
}

const fmtCurrency = (n: number): string => {
  if (n === 0) return '--';
  return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (d: string): string => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function BankReconciliation() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [summary, setSummary] = useState<ReconSummary | null>(null);
  const [unreconciled, setUnreconciled] = useState<BankTxn[]>([]);
  const [reconciled, setReconciled] = useState<BankTxn[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'unreconciled' | 'reconciled'>('unreconciled');

  // Import modal
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  // Match modal
  const [showMatch, setShowMatch] = useState(false);
  const [matchTxn, setMatchTxn] = useState<BankTxn | null>(null);
  const [journalOptions, setJournalOptions] = useState<JournalOption[]>([]);
  const [selectedJournalId, setSelectedJournalId] = useState('');
  const [matching, setMatching] = useState(false);

  // Auto match
  const [autoMatching, setAutoMatching] = useState(false);
  const [autoMatchResult, setAutoMatchResult] = useState<{ matched: number; unmatched: number } | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get<Account[]>('/chart-of-accounts');
      const bankAccounts = res.data.filter(a => a.code.startsWith('100') || a.subType === 'BANK');
      setAccounts(bankAccounts);
      if (bankAccounts.length > 0 && !selectedAccountId) {
        setSelectedAccountId(bankAccounts[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  }, [selectedAccountId]);

  const fetchData = useCallback(async () => {
    if (!selectedAccountId) return;
    try {
      setLoading(true);
      const [summaryRes, unreconRes, reconRes] = await Promise.all([
        api.get<ReconSummary>(`/bank-reconciliation/summary/${selectedAccountId}`),
        api.get<{ items: BankTxn[] }>('/bank-reconciliation', { params: { accountId: selectedAccountId, isReconciled: 'false' } }),
        api.get<{ items: BankTxn[] }>('/bank-reconciliation', { params: { accountId: selectedAccountId, isReconciled: 'true' } }),
      ]);
      setSummary(summaryRes.data);
      setUnreconciled(unreconRes.data.items || []);
      setReconciled(reconRes.data.items || []);
    } catch (err) {
      console.error('Failed to fetch reconciliation data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const handleImport = async () => {
    try {
      setImporting(true);
      const transactions = JSON.parse(importText);
      await api.post('/bank-reconciliation/import', { accountId: selectedAccountId, transactions });
      setShowImport(false);
      setImportText('');
      await fetchData();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Import failed. Check JSON format.';
      alert(msg);
    } finally {
      setImporting(false);
    }
  };

  const handleAutoMatch = async () => {
    try {
      setAutoMatching(true);
      setAutoMatchResult(null);
      const res = await api.post<{ matched: number; unmatched: number }>('/bank-reconciliation/auto-match', { accountId: selectedAccountId });
      setAutoMatchResult(res.data);
      await fetchData();
    } catch (err) {
      console.error('Auto match failed:', err);
    } finally {
      setAutoMatching(false);
    }
  };

  const openMatchModal = async (txn: BankTxn) => {
    setMatchTxn(txn);
    setSelectedJournalId('');
    setShowMatch(true);
    try {
      const amount = txn.debit > 0 ? txn.debit : txn.credit;
      const res = await api.get<JournalOption[]>('/bank-reconciliation/journal-suggestions', {
        params: { accountId: selectedAccountId, amount, date: txn.date },
      });
      setJournalOptions(res.data);
    } catch (err) {
      console.error('Failed to fetch journal suggestions:', err);
      setJournalOptions([]);
    }
  };

  const handleMatch = async () => {
    if (!matchTxn || !selectedJournalId) return;
    try {
      setMatching(true);
      await api.post(`/bank-reconciliation/${matchTxn.id}/match`, { journalEntryId: selectedJournalId });
      setShowMatch(false);
      setMatchTxn(null);
      await fetchData();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Match failed';
      alert(msg);
    } finally {
      setMatching(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* ── Page toolbar ── */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Bank Reconciliation</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Match bank statement entries with journal entries</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              disabled={!selectedAccountId}
              className="px-3 py-1 border border-slate-400 text-slate-300 text-[11px] hover:bg-slate-700 disabled:opacity-50"
            >
              Import Statement
            </button>
            <button
              onClick={handleAutoMatch}
              disabled={!selectedAccountId || autoMatching}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-50"
            >
              {autoMatching ? 'Matching...' : 'Auto Match'}
            </button>
          </div>
        </div>

        {/* ── Account Selector toolbar ── */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Bank Account</label>
            <select
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="w-full max-w-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            >
              <option value="">Select a bank account</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.code} -- {a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Auto Match Result ── */}
        {autoMatchResult && (
          <div className="px-3 py-2 text-[11px] font-medium border border-emerald-300 bg-emerald-50 text-emerald-700 -mx-3 md:-mx-6">
            Auto-match complete: <strong>{autoMatchResult.matched}</strong> matched, <strong>{autoMatchResult.unmatched}</strong> unmatched.
          </div>
        )}

        {/* ── Summary KPI Cards ── */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-b md:border-b-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Book Balance</div>
              <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{fmtCurrency(summary.bookBalance)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-b md:border-b-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Bank Balance</div>
              <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{fmtCurrency(summary.bankBalance)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Difference</div>
              <div className={`text-xl font-bold font-mono tabular-nums ${summary.difference === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {fmtCurrency(summary.difference)}
              </div>
            </div>
            <div className="bg-white px-4 py-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Unreconciled</div>
              <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{summary.unreconciledCount}</div>
              <div className="text-[10px] text-slate-400">Pending match</div>
            </div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="bg-slate-100 border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          <button
            onClick={() => setActiveTab('unreconciled')}
            className={`px-5 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
              activeTab === 'unreconciled' ? 'bg-white border-b-2 border-slate-800 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Unreconciled ({unreconciled.length})
          </button>
          <button
            onClick={() => setActiveTab('reconciled')}
            className={`px-5 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
              activeTab === 'reconciled' ? 'bg-white border-b-2 border-slate-800 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Reconciled ({reconciled.length})
          </button>
        </div>

        {/* ── Transaction Table ── */}
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
          {loading ? (
            <div className="p-6 text-slate-400 text-center text-xs bg-white">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ref No</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Debit</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Credit</th>
                    {activeTab === 'reconciled' && (
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Matched Journal</th>
                    )}
                    {activeTab === 'unreconciled' && (
                      <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(activeTab === 'unreconciled' ? unreconciled : reconciled).map(txn => (
                    <tr key={txn.id} className="border-t border-slate-200 hover:bg-blue-50/30 even:bg-slate-50/50">
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{fmtDate(txn.date)}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{txn.description}</td>
                      <td className="px-3 py-1.5 text-slate-500 font-mono text-[11px] border-r border-slate-100">{txn.refNo || '--'}</td>
                      <td className="px-3 py-1.5 text-right text-slate-700 font-mono tabular-nums border-r border-slate-100">{txn.debit > 0 ? fmtCurrency(txn.debit) : '--'}</td>
                      <td className="px-3 py-1.5 text-right text-slate-700 font-mono tabular-nums border-r border-slate-100">{txn.credit > 0 ? fmtCurrency(txn.credit) : '--'}</td>
                      {activeTab === 'reconciled' && (
                        <td className="px-3 py-1.5 text-slate-500 text-[11px] border-r border-slate-100">
                          {txn.journalEntry ? `#${txn.journalEntry.entryNo} -- ${txn.journalEntry.narration}` : '--'}
                        </td>
                      )}
                      {activeTab === 'unreconciled' && (
                        <td className="px-3 py-1.5 text-center">
                          <button
                            onClick={() => openMatchModal(txn)}
                            className="px-3 py-1 bg-blue-600 text-white text-[11px] hover:bg-blue-700"
                          >
                            Match
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {(activeTab === 'unreconciled' ? unreconciled : reconciled).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-slate-400 text-xs">
                        No {activeTab} transactions
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Import Modal ── */}
        {showImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white shadow-xl w-full max-w-lg">
              <div className="bg-slate-800 text-white px-5 py-3">
                <h2 className="text-sm font-bold">Import Bank Statement</h2>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-slate-500">
                  Paste a JSON array of transactions. Each object should have: date, description, refNo (optional), debit, credit, balance.
                </p>
                <textarea
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  rows={10}
                  placeholder={`[{"date":"2024-01-15","description":"NEFT-CR","refNo":"UTR123","debit":0,"credit":50000,"balance":150000}]`}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white font-mono focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
                />
              </div>
              <div className="bg-slate-100 border-t border-slate-300 px-5 py-3 flex justify-end gap-2">
                <button
                  onClick={() => setShowImport(false)}
                  className="px-3 py-1 border border-slate-400 text-slate-600 text-[11px] hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || !importText.trim()}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-50"
                >
                  {importing ? 'Importing...' : 'Import'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Match Modal ── */}
        {showMatch && matchTxn && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white shadow-xl w-full max-w-lg">
              <div className="bg-slate-800 text-white px-5 py-3">
                <h2 className="text-sm font-bold">Match Transaction</h2>
              </div>
              <div className="p-5 space-y-4">
                <div className="bg-slate-50 border border-slate-300 p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Transaction Details</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-slate-400">Date:</span> <span className="text-slate-700 font-medium">{fmtDate(matchTxn.date)}</span></div>
                    <div>
                      <span className="text-slate-400">Amount:</span>{' '}
                      <span className="text-slate-700 font-medium font-mono tabular-nums">
                        {matchTxn.debit > 0 ? `Dr ${fmtCurrency(matchTxn.debit)}` : `Cr ${fmtCurrency(matchTxn.credit)}`}
                      </span>
                    </div>
                    <div className="col-span-2"><span className="text-slate-400">Description:</span> <span className="text-slate-700 font-medium">{matchTxn.description}</span></div>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Select Journal Entry</label>
                  {journalOptions.length === 0 ? (
                    <p className="text-xs text-slate-400">No matching journal entries found.</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto border border-slate-300">
                      {journalOptions.map(j => (
                        <label
                          key={j.id}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 border-b border-slate-100 last:border-b-0 ${selectedJournalId === j.id ? 'bg-blue-50' : ''}`}
                        >
                          <input
                            type="radio"
                            name="journal"
                            value={j.id}
                            checked={selectedJournalId === j.id}
                            onChange={() => setSelectedJournalId(j.id)}
                            className="accent-slate-800"
                          />
                          <div className="text-xs flex-1">
                            <div className="font-medium text-slate-700">#{j.entryNo} -- <span className="font-mono tabular-nums">{fmtCurrency(j.amount)}</span></div>
                            <div className="text-slate-400 mt-0.5">{fmtDate(j.date)} -- {j.narration}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-slate-100 border-t border-slate-300 px-5 py-3 flex justify-end gap-2">
                <button
                  onClick={() => setShowMatch(false)}
                  className="px-3 py-1 border border-slate-400 text-slate-600 text-[11px] hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMatch}
                  disabled={matching || !selectedJournalId}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-50"
                >
                  {matching ? 'Matching...' : 'Confirm Match'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
