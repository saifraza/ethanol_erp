import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import AccountCombobox, { ComboAccount } from './AccountCombobox';
import QuickCreateAccountModal, { CreatedAccount } from './QuickCreateAccountModal';
import { DIVISIONS, Division, DEFAULT_DIVISION, DIVISION_COLORS } from '../../constants/divisions';
import { suggestAccountHead } from '../../utils/suggestAccountHead';

interface Line {
  accountId: string;
  debit: number;
  credit: number;
  narration: string;
  division: Division;
}

interface Props {
  open: boolean;
  accounts: ComboAccount[];
  preselectedAccountId?: string;
  initialDivision?: Division;
  onClose: () => void;
  onCreated: () => void;                  // parent refetches
  onAccountCreated: (acc: CreatedAccount) => void;   // so parent can refresh accounts list
}

function todayISO(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}

const REF_TYPES = ['JOURNAL', 'SALE', 'PURCHASE', 'PAYMENT', 'RECEIPT', 'CONTRA'] as const;

export default function NewJournalEntryModal({ open, accounts, preselectedAccountId, initialDivision, onClose, onCreated, onAccountCreated }: Props) {
  const [date, setDate] = useState(todayISO());
  const [narration, setNarration] = useState('');
  const [refType, setRefType] = useState<string>('JOURNAL');
  const [division, setDivision] = useState<Division>(initialDivision || DEFAULT_DIVISION);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick-create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitial, setCreateInitial] = useState('');
  const [createForLineIdx, setCreateForLineIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setNarration('');
    setRefType('JOURNAL');
    setDivision(initialDivision || DEFAULT_DIVISION);
    setError(null);
    setLines([
      { accountId: preselectedAccountId || '', debit: 0, credit: 0, narration: '', division: initialDivision || DEFAULT_DIVISION },
      { accountId: '', debit: 0, credit: 0, narration: '', division: initialDivision || DEFAULT_DIVISION },
    ]);
  }, [open, preselectedAccountId, initialDivision]);

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100;

  // Narration-based suggestion — shown on the first empty-account line
  const suggestion = useMemo(() => {
    if (!narration.trim()) return null;
    const firstEmptyIdx = lines.findIndex(l => !l.accountId);
    if (firstEmptyIdx === -1) return null;
    const line = lines[firstEmptyIdx];
    const side = line.debit > 0 ? 'DEBIT' : line.credit > 0 ? 'CREDIT' : 'UNKNOWN';
    const s = suggestAccountHead({ narration, contextSide: side });
    if (!s.parentCode) return null;
    const match = accounts.find(a => a.code === s.parentCode);
    if (!match) return null;
    return { lineIdx: firstEmptyIdx, account: match, reason: s.reason };
  }, [narration, lines, accounts]);

  const applySuggestion = useCallback(() => {
    if (!suggestion) return;
    setLines(ls => ls.map((l, i) => i === suggestion.lineIdx ? { ...l, accountId: suggestion.account.id } : l));
  }, [suggestion]);

  const updateLine = useCallback((idx: number, patch: Partial<Line>) => {
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }, []);

  const addLine = () => setLines(ls => [...ls, { accountId: '', debit: 0, credit: 0, narration: '', division }]);
  const removeLine = (idx: number) => setLines(ls => ls.length <= 2 ? ls : ls.filter((_, i) => i !== idx));

  const handleRequestCreate = (lineIdx: number, searchText: string) => {
    setCreateInitial(searchText);
    setCreateForLineIdx(lineIdx);
    setCreateOpen(true);
  };

  const handleAccountCreated = (acc: CreatedAccount) => {
    onAccountCreated(acc);
    if (createForLineIdx !== null) {
      updateLine(createForLineIdx, { accountId: acc.id });
    }
    setCreateOpen(false);
    setCreateForLineIdx(null);
  };

  const handleSave = useCallback(async () => {
    setError(null);
    if (!narration.trim()) { setError('Narration is required'); return; }
    if (lines.length < 2) { setError('At least 2 lines required'); return; }
    for (const l of lines) {
      if (!l.accountId) { setError('Every line must have an account'); return; }
      if (l.debit > 0 && l.credit > 0) { setError('A line cannot have both debit and credit'); return; }
      if (l.debit === 0 && l.credit === 0) { setError('Every line must have a non-zero amount'); return; }
    }
    if (Math.abs(diff) > 0.01) { setError(`Debits (₹${totalDebit.toFixed(2)}) must equal Credits (₹${totalCredit.toFixed(2)}). Diff: ₹${diff.toFixed(2)}`); return; }

    try {
      setSaving(true);
      await api.post('/journal-entries', {
        date,
        narration: narration.trim(),
        refType,
        lines: lines.map(l => ({
          accountId: l.accountId,
          debit: l.debit || 0,
          credit: l.credit || 0,
          narration: l.narration || null,
          division: l.division,
        })),
      });
      onCreated();
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Failed to post entry');
    } finally {
      setSaving(false);
    }
  }, [date, narration, refType, lines, diff, totalDebit, totalCredit, onCreated, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !createOpen) onClose();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-white shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col"
          onClick={e => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          {/* Header */}
          <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-widest">New Journal Entry</div>
            <div className="flex items-center gap-1">
              {DIVISIONS.map(d => (
                <button
                  key={d}
                  onClick={() => { setDivision(d); setLines(ls => ls.map(l => ({ ...l, division: d }))); }}
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${division === d ? `${DIVISION_COLORS[d]} text-white border-transparent` : 'border-slate-600 text-slate-300 hover:bg-slate-700'}`}
                >
                  {d}
                </button>
              ))}
              <button onClick={onClose} className="ml-2 text-slate-300 hover:text-white text-sm px-1">×</button>
            </div>
          </div>

          {/* Top form */}
          <div className="p-4 grid grid-cols-3 gap-3 border-b border-slate-200">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Ref Type</label>
              <select
                value={refType}
                onChange={e => setRefType(e.target.value)}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {REF_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Narration</label>
              <input
                type="text"
                value={narration}
                onChange={e => setNarration(e.target.value)}
                placeholder="e.g. Grain purchase from ABC Traders"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
          </div>

          {/* Suggestion hint */}
          {suggestion && (
            <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-1.5 text-[10px] text-emerald-800 flex items-center gap-2">
              <span className="font-bold uppercase tracking-widest">Suggested head:</span>
              <span className="font-mono">{suggestion.account.code}</span>
              <span>{suggestion.account.name}</span>
              <span className="text-emerald-600">({suggestion.reason})</span>
              <button onClick={applySuggestion} className="ml-auto px-2 py-0.5 bg-emerald-600 text-white font-bold uppercase tracking-widest hover:bg-emerald-700">
                Apply
              </button>
            </div>
          )}

          {/* Lines table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white sticky top-0">
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8">#</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Account</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Narration</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Division</th>
                  <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Debit</th>
                  <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Credit</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="border-b border-slate-100">
                    <td className="px-2 py-1 text-slate-400 text-[10px] text-center border-r border-slate-100">{idx + 1}</td>
                    <td className="px-1 py-1 border-r border-slate-100">
                      <AccountCombobox
                        accounts={accounts}
                        value={line.accountId}
                        size="sm"
                        onChange={id => updateLine(idx, { accountId: id })}
                        onRequestCreate={txt => handleRequestCreate(idx, txt)}
                      />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-100">
                      <input
                        type="text"
                        value={line.narration}
                        onChange={e => updateLine(idx, { narration: e.target.value })}
                        className="w-full border border-slate-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-100">
                      <select
                        value={line.division}
                        onChange={e => updateLine(idx, { division: e.target.value as Division })}
                        className="w-full border border-slate-300 px-1 py-1 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                      >
                        {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1 border-r border-slate-100">
                      <input
                        type="number"
                        step="0.01"
                        value={line.debit || ''}
                        onChange={e => updateLine(idx, { debit: parseFloat(e.target.value) || 0, credit: 0 })}
                        className="w-full text-right border border-slate-300 px-2 py-1 text-[11px] font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-100">
                      <input
                        type="number"
                        step="0.01"
                        value={line.credit || ''}
                        onChange={e => updateLine(idx, { credit: parseFloat(e.target.value) || 0, debit: 0 })}
                        className="w-full text-right border border-slate-300 px-2 py-1 text-[11px] font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {lines.length > 2 && (
                        <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700 text-sm" title="Remove line">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300">
                  <td colSpan={4} className="px-2 py-1.5 text-right text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                    <button onClick={addLine} className="px-2 py-0.5 bg-white border border-slate-300 text-[10px] hover:bg-slate-50">+ Add Line</button>
                    <span className="ml-3">Total</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums font-bold text-slate-800">₹{totalDebit.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums font-bold text-slate-800">₹{totalCredit.toFixed(2)}</td>
                  <td></td>
                </tr>
                <tr className={`${Math.abs(diff) < 0.01 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <td colSpan={4} className="px-2 py-1 text-right text-[10px] font-bold uppercase tracking-widest">
                    {Math.abs(diff) < 0.01 ? <span className="text-emerald-700">Balanced</span> : <span className="text-red-700">Difference</span>}
                  </td>
                  <td colSpan={2} className={`px-2 py-1 text-right font-mono tabular-nums font-bold ${Math.abs(diff) < 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {Math.abs(diff) < 0.01 ? '₹0.00' : `₹${Math.abs(diff).toFixed(2)}`}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {error && <div className="px-4 py-1.5 text-[11px] text-red-700 bg-red-50 border-t border-red-200">{error}</div>}

          {/* Footer */}
          <div className="border-t border-slate-200 px-4 py-2.5 flex items-center justify-between bg-slate-50">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest">Ctrl+S to save · Esc to cancel</div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || Math.abs(diff) > 0.01}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Posting…' : 'Post Entry'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <QuickCreateAccountModal
        open={createOpen}
        initialName={createInitial}
        narration={narration}
        contextSide={
          createForLineIdx !== null
            ? (lines[createForLineIdx].debit > 0 ? 'DEBIT' : lines[createForLineIdx].credit > 0 ? 'CREDIT' : 'UNKNOWN')
            : 'UNKNOWN'
        }
        onClose={() => { setCreateOpen(false); setCreateForLineIdx(null); }}
        onCreated={handleAccountCreated}
      />
    </>
  );
}
