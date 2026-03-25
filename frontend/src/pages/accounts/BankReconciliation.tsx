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
  if (n === 0) return '—';
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
        api.get<ReconSummary>(`/api/bank-reconciliation/summary/${selectedAccountId}`),
        api.get<BankTxn[]>('/bank-reconciliation', { params: { accountId: selectedAccountId, isReconciled: 'false' } }),
        api.get<BankTxn[]>('/bank-reconciliation', { params: { accountId: selectedAccountId, isReconciled: 'true' } }),
      ]);
      setSummary(summaryRes.data);
      setUnreconciled(unreconRes.data);
      setReconciled(reconRes.data);
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
      await api.post(`/api/bank-reconciliation/${matchTxn.id}/match`, { journalEntryId: selectedJournalId });
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Bank Reconciliation</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            disabled={!selectedAccountId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            Import Statement
          </button>
          <button
            onClick={handleAutoMatch}
            disabled={!selectedAccountId || autoMatching}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
          >
            {autoMatching ? 'Matching...' : 'Auto Match'}
          </button>
        </div>
      </div>

      {/* Account Selector */}
      <div className="bg-white rounded-lg shadow p-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account</label>
        <select
          value={selectedAccountId}
          onChange={e => setSelectedAccountId(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Select a bank account</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
          ))}
        </select>
      </div>

      {/* Auto Match Result */}
      {autoMatchResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
          Auto-match complete: <strong>{autoMatchResult.matched}</strong> matched, <strong>{autoMatchResult.unmatched}</strong> unmatched.
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Book Balance</div>
            <div className="text-xl font-bold text-gray-800 mt-1">{fmtCurrency(summary.bookBalance)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Bank Balance</div>
            <div className="text-xl font-bold text-gray-800 mt-1">{fmtCurrency(summary.bankBalance)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Difference</div>
            <div className={`text-xl font-bold mt-1 ${summary.difference === 0 ? 'text-green-600' : 'text-red-600'}`}>
              {fmtCurrency(summary.difference)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Unreconciled</div>
            <div className="text-xl font-bold text-orange-600 mt-1">{summary.unreconciledCount}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('unreconciled')}
            className={`px-6 py-3 text-sm font-medium border-b-2 ${activeTab === 'unreconciled' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Unreconciled ({unreconciled.length})
          </button>
          <button
            onClick={() => setActiveTab('reconciled')}
            className={`px-6 py-3 text-sm font-medium border-b-2 ${activeTab === 'reconciled' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Reconciled ({reconciled.length})
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-gray-500 text-center">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Description</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Ref No</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Debit</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Credit</th>
                  {activeTab === 'reconciled' && (
                    <th className="px-4 py-3 font-medium text-gray-600">Matched Journal</th>
                  )}
                  {activeTab === 'unreconciled' && (
                    <th className="px-4 py-3 font-medium text-gray-600 text-center">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(activeTab === 'unreconciled' ? unreconciled : reconciled).map(txn => (
                  <tr key={txn.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{fmtDate(txn.date)}</td>
                    <td className="px-4 py-3 text-gray-700">{txn.description}</td>
                    <td className="px-4 py-3 text-gray-500">{txn.refNo || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{txn.debit > 0 ? fmtCurrency(txn.debit) : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{txn.credit > 0 ? fmtCurrency(txn.credit) : '—'}</td>
                    {activeTab === 'reconciled' && (
                      <td className="px-4 py-3 text-gray-500">
                        {txn.journalEntry ? `#${txn.journalEntry.entryNo} — ${txn.journalEntry.narration}` : '—'}
                      </td>
                    )}
                    {activeTab === 'unreconciled' && (
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => openMatchModal(txn)}
                          className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium hover:bg-blue-200"
                        >
                          Match
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {(activeTab === 'unreconciled' ? unreconciled : reconciled).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      No {activeTab} transactions
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Import Bank Statement</h2>
            <p className="text-sm text-gray-500">
              Paste a JSON array of transactions. Each object should have: date, description, refNo (optional), debit, credit, balance.
            </p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              rows={10}
              placeholder={`[{"date":"2024-01-15","description":"NEFT-CR","refNo":"UTR123","debit":0,"credit":50000,"balance":150000}]`}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importing || !importText.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match Modal */}
      {showMatch && matchTxn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Match Transaction</h2>
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div><span className="text-gray-500">Date:</span> {fmtDate(matchTxn.date)}</div>
              <div><span className="text-gray-500">Description:</span> {matchTxn.description}</div>
              <div>
                <span className="text-gray-500">Amount:</span>{' '}
                {matchTxn.debit > 0 ? `Debit ${fmtCurrency(matchTxn.debit)}` : `Credit ${fmtCurrency(matchTxn.credit)}`}
              </div>
            </div>
            <label className="block text-sm font-medium text-gray-700">Select Journal Entry</label>
            {journalOptions.length === 0 ? (
              <p className="text-sm text-gray-400">No matching journal entries found.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                {journalOptions.map(j => (
                  <label
                    key={j.id}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 ${selectedJournalId === j.id ? 'bg-blue-50' : ''}`}
                  >
                    <input
                      type="radio"
                      name="journal"
                      value={j.id}
                      checked={selectedJournalId === j.id}
                      onChange={() => setSelectedJournalId(j.id)}
                      className="text-blue-600"
                    />
                    <div className="text-sm">
                      <div className="font-medium text-gray-700">#{j.entryNo} — {fmtCurrency(j.amount)}</div>
                      <div className="text-gray-500">{fmtDate(j.date)} — {j.narration}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowMatch(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
              <button
                onClick={handleMatch}
                disabled={matching || !selectedJournalId}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {matching ? 'Matching...' : 'Confirm Match'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
