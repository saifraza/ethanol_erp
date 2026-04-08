import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../../services/api';
import { ComboAccount } from '../../components/accounts/AccountCombobox';
import NewJournalEntryModal from '../../components/accounts/NewJournalEntryModal';
import { useHotkeys } from '../../hooks/useHotkeys';
import { DIVISIONS, Division, DIVISION_COLORS } from '../../constants/divisions';

interface LedgerLine {
  id: string;
  debit: number;
  credit: number;
  narration: string | null;
  costCenter: string | null;
  division: string | null;
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
  account: ComboAccount & { openingBalance: number };
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  lines: LedgerLine[];
}

interface BankAccountOption {
  id: string;
  code: string;
  name: string;
  openingBalance: number;
}

const REF_TYPES = ['SALE', 'PURCHASE', 'PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL'] as const;
type RefType = typeof REF_TYPES[number];
type DivisionFilter = 'ALL' | Division;

function istNow(): Date { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function toISODate(d: Date): string { return d.toISOString().split('T')[0]; }

export default function BankBook() {
  const [accounts, setAccounts] = useState<ComboAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [divisionFilter, setDivisionFilter] = useState<DivisionFilter>('ALL');

  const [narrationSearch, setNarrationSearch] = useState('');
  const [refTypeFilter, setRefTypeFilter] = useState<Set<RefType>>(new Set());
  const [amtFrom, setAmtFrom] = useState<string>('');
  const [amtTo, setAmtTo] = useState<string>('');
  const [drCrMode, setDrCrMode] = useState<'BOTH' | 'DR' | 'CR'>('BOTH');

  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showTip, setShowTip] = useState(() => !localStorage.getItem('bankbook_tip_dismissed'));

  const narrationRef = useRef<HTMLInputElement>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const [coa, banks] = await Promise.all([
        api.get<ComboAccount[]>('/chart-of-accounts'),
        api.get<BankAccountOption[]>('/accounts-reports/bank-accounts'),
      ]);
      setAccounts(coa.data);
      setBankAccounts(banks.data);
      if (banks.data.length > 0 && !selectedBankId) setSelectedBankId(banks.data[0].id);
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  }, [selectedBankId]);

  useEffect(() => { fetchAccounts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLedger = useCallback(async () => {
    if (!selectedBankId) return;
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      if (divisionFilter !== 'ALL') params.division = divisionFilter;
      const res = await api.get<LedgerData>(`/journal-entries/ledger/${selectedBankId}`, { params });
      setLedger(res.data);
    } catch (err) {
      console.error('Failed to fetch bank book:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBankId, dateRange, divisionFilter]);

  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  const fmtCurrency = (n: number): string => {
    if (n === 0) return '';
    return '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtDate = (d: string): string => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const applyPreset = useCallback((preset: 'today' | 'week' | 'month' | 'fy' | 'lastFy') => {
    const now = istNow();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    let from: Date, to: Date;
    if (preset === 'today') { from = new Date(Date.UTC(y, m, d)); to = from; }
    else if (preset === 'week') { const dow = now.getUTCDay(); from = new Date(Date.UTC(y, m, d - dow)); to = new Date(Date.UTC(y, m, d)); }
    else if (preset === 'month') { from = new Date(Date.UTC(y, m, 1)); to = new Date(Date.UTC(y, m, d)); }
    else if (preset === 'fy') { const fyStart = m >= 3 ? y : y - 1; from = new Date(Date.UTC(fyStart, 3, 1)); to = new Date(Date.UTC(y, m, d)); }
    else { const fyStart = m >= 3 ? y - 1 : y - 2; from = new Date(Date.UTC(fyStart, 3, 1)); to = new Date(Date.UTC(fyStart + 1, 2, 31)); }
    setDateRange({ from: toISODate(from), to: toISODate(to) });
  }, []);

  const filtered = useMemo(() => {
    if (!ledger) return { lines: [], totalDebit: 0, totalCredit: 0 };
    const nq = narrationSearch.trim().toLowerCase();
    const af = amtFrom ? parseFloat(amtFrom) : null;
    const at = amtTo ? parseFloat(amtTo) : null;
    const out = ledger.lines.filter(l => {
      if (nq) {
        const hay = `${l.journal.narration} ${l.narration || ''}`.toLowerCase();
        if (!hay.includes(nq)) return false;
      }
      if (refTypeFilter.size > 0 && (!l.journal.refType || !refTypeFilter.has(l.journal.refType as RefType))) return false;
      if (drCrMode === 'DR' && l.debit === 0) return false;
      if (drCrMode === 'CR' && l.credit === 0) return false;
      if (af !== null || at !== null) {
        const amt = l.debit || l.credit;
        if (af !== null && amt < af) return false;
        if (at !== null && amt > at) return false;
      }
      return true;
    });
    const totalDebit = out.reduce((s, l) => s + l.debit, 0);
    const totalCredit = out.reduce((s, l) => s + l.credit, 0);
    return { lines: out, totalDebit, totalCredit };
  }, [ledger, narrationSearch, refTypeFilter, amtFrom, amtTo, drCrMode]);

  const divisionSplit = useMemo(() => {
    const totals: Record<string, number> = { SUGAR: 0, POWER: 0, ETHANOL: 0, COMMON: 0 };
    for (const l of filtered.lines) {
      const d = (l.division || 'COMMON') as Division;
      totals[d] = (totals[d] || 0) + l.debit + l.credit;
    }
    const grand = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
    return {
      totals,
      pct: {
        SUGAR: (totals.SUGAR / grand) * 100,
        POWER: (totals.POWER / grand) * 100,
        ETHANOL: (totals.ETHANOL / grand) * 100,
        COMMON: (totals.COMMON / grand) * 100,
      },
      grand,
    };
  }, [filtered.lines]);

  // Bank accounts are usually assets, but cash-credit / overdraft accounts are
  // LIABILITY-typed. Respect ledger.account.type instead of hard-coding asset math.
  const isDebitNormal = ledger ? (ledger.account.type === 'ASSET' || ledger.account.type === 'EXPENSE') : true;
  const netMovement = isDebitNormal
    ? filtered.totalDebit - filtered.totalCredit
    : filtered.totalCredit - filtered.totalDebit;
  const filteredClosing = ledger
    ? ledger.openingBalance + (isDebitNormal
        ? filtered.totalDebit - filtered.totalCredit
        : filtered.totalCredit - filtered.totalDebit)
    : 0;

  const focusNarration = useCallback(() => narrationRef.current?.focus(), []);
  const clearAllFilters = useCallback(() => {
    setNarrationSearch(''); setRefTypeFilter(new Set()); setAmtFrom(''); setAmtTo(''); setDrCrMode('BOTH');
  }, []);

  useHotkeys([
    { key: 'f', ctrl: true, handler: e => { e.preventDefault(); focusNarration(); } },
    { key: 'n', handler: e => { if (selectedBankId) { e.preventDefault(); setNewEntryOpen(true); } } },
    { key: 't', handler: e => { e.preventDefault(); applyPreset('today'); } },
    { key: 'm', handler: e => { e.preventDefault(); applyPreset('month'); } },
    { key: '0', handler: e => { e.preventDefault(); setDivisionFilter('ALL'); } },
    { key: '1', handler: e => { e.preventDefault(); setDivisionFilter('SUGAR'); } },
    { key: '2', handler: e => { e.preventDefault(); setDivisionFilter('POWER'); } },
    { key: '3', handler: e => { e.preventDefault(); setDivisionFilter('ETHANOL'); } },
    { key: '?', shift: true, handler: e => { e.preventDefault(); setShowHelp(h => !h); } },
    { key: 'Escape', allowInInputs: true, handler: () => {
      if (showHelp) { setShowHelp(false); return; }
      if (newEntryOpen) return;
      clearAllFilters();
    } },
  ]);

  const dismissTip = () => { localStorage.setItem('bankbook_tip_dismissed', '1'); setShowTip(false); };
  const toggleRefType = (rt: RefType) => setRefTypeFilter(s => {
    const n = new Set(s); if (n.has(rt)) n.delete(rt); else n.add(rt); return n;
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Bank Book</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Bank account register · keyboard-first · inline entry</span>
            {ledger && (
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${filteredClosing >= 0 ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
                {filteredClosing >= 0 ? 'Dr Balance' : 'Cr Balance'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => selectedBankId && setNewEntryOpen(true)}
              disabled={!selectedBankId}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-40"
              title="Post a new bank entry (N)"
            >+ New Entry (N)</button>
            <button onClick={() => setShowHelp(true)} className="w-6 h-6 border border-slate-600 text-slate-300 text-xs font-bold hover:bg-slate-700" title="Keyboard shortcuts (?)">?</button>
          </div>
        </div>

        {/* First-time tip */}
        {showTip && (
          <div className="bg-amber-50 border-x border-b border-amber-200 px-4 py-1.5 -mx-3 md:-mx-6 flex items-center justify-between">
            <div className="text-[11px] text-amber-800">
              Tip: press <kbd className="px-1 bg-white border border-amber-300 font-mono">Ctrl+F</kbd> to search narration,
              <kbd className="ml-1 px-1 bg-white border border-amber-300 font-mono">N</kbd> for new entry,
              <kbd className="ml-1 px-1 bg-white border border-amber-300 font-mono">?</kbd> for all shortcuts.
            </div>
            <button onClick={dismissTip} className="text-[10px] text-amber-700 hover:text-amber-900 uppercase tracking-widest">Dismiss</button>
          </div>
        )}

        {/* Filter Toolbar: bank + presets + dates + division */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
          <div className="min-w-[220px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Bank Account</label>
            <select
              value={selectedBankId}
              onChange={e => setSelectedBankId(e.target.value)}
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
            >
              {bankAccounts.length === 0 && <option value="">No bank accounts</option>}
              {bankAccounts.map(b => (
                <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Presets</label>
            <div className="flex gap-1">
              <button onClick={() => applyPreset('today')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50" title="Today (T)">Today</button>
              <button onClick={() => applyPreset('week')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50">Week</button>
              <button onClick={() => applyPreset('month')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50" title="This Month (M)">Month</button>
              <button onClick={() => applyPreset('fy')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50">FY</button>
              <button onClick={() => applyPreset('lastFy')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50">Last FY</button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">From</label>
            <input type="date" value={dateRange.from} onChange={e => setDateRange(f => ({ ...f, from: e.target.value }))} className="border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To</label>
            <input type="date" value={dateRange.to} onChange={e => setDateRange(f => ({ ...f, to: e.target.value }))} className="border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Division (0/1/2/3)</label>
            <div className="flex">
              {(['ALL', ...DIVISIONS] as DivisionFilter[]).map(d => (
                <button key={d} onClick={() => setDivisionFilter(d)}
                  className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border ${divisionFilter === d ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'} ${d !== 'ALL' ? '-ml-px' : ''}`}
                >{d === 'ALL' ? 'All' : d}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Secondary filters */}
        {ledger && (
          <div className="bg-slate-50 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Narration (Ctrl+F)</label>
              <input ref={narrationRef} type="text" value={narrationSearch} onChange={e => setNarrationSearch(e.target.value)}
                placeholder="Search narration…"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Ref Type</label>
              <div className="flex gap-0.5">
                {REF_TYPES.map(rt => (
                  <button key={rt} onClick={() => toggleRefType(rt)}
                    className={`px-1.5 py-1 text-[9px] font-bold uppercase tracking-widest border ${refTypeFilter.has(rt) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                  >{rt}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Amt From</label>
              <input type="number" value={amtFrom} onChange={e => setAmtFrom(e.target.value)} className="w-24 border border-slate-300 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Amt To</label>
              <input type="number" value={amtTo} onChange={e => setAmtTo(e.target.value)} className="w-24 border border-slate-300 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Side</label>
              <div className="flex">
                {(['BOTH', 'DR', 'CR'] as const).map((m, i) => (
                  <button key={m} onClick={() => setDrCrMode(m)}
                    className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border ${drCrMode === m ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'} ${i > 0 ? '-ml-px' : ''}`}
                  >{m === 'DR' ? 'Dep' : m === 'CR' ? 'Wdl' : 'Both'}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {loading && <div className="text-xs text-slate-400 uppercase tracking-widest py-4 px-4">Loading bank book...</div>}

        {ledger && !loading && (
          <>
            {/* KPI Strip — 6 tiles (incl. Account) */}
            <div className="grid grid-cols-6 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account</div>
                <div className="text-xs font-semibold text-slate-800 mt-1 truncate">{ledger.account.name}</div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">{ledger.account.code}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{filtered.lines.length} entries</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Opening</div>
                <div className="text-base font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(ledger.openingBalance) || '\u20B90.00'}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-emerald-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deposits (Dr)</div>
                <div className="text-base font-bold text-emerald-700 mt-1 font-mono tabular-nums">{fmtCurrency(filtered.totalDebit) || '\u20B90.00'}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-rose-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Withdrawals (Cr)</div>
                <div className="text-base font-bold text-rose-700 mt-1 font-mono tabular-nums">{fmtCurrency(filtered.totalCredit) || '\u20B90.00'}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net Movement</div>
                <div className={`text-base font-bold mt-1 font-mono tabular-nums ${netMovement >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {netMovement < 0 ? '-' : ''}{fmtCurrency(netMovement) || '\u20B90.00'}
                </div>
              </div>
              <div className="bg-white px-4 py-3 border-l-4 border-l-indigo-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Closing</div>
                <div className={`text-base font-bold mt-1 font-mono tabular-nums ${filteredClosing >= 0 ? 'text-slate-800' : 'text-red-700'}`}>
                  {filteredClosing < 0 ? '-' : ''}{fmtCurrency(filteredClosing) || '\u20B90.00'}
                </div>
              </div>
            </div>

            {/* Division split bar */}
            {divisionSplit.grand > 0 && (
              <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2 flex items-center gap-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Division Split</div>
                <div className="flex-1 h-4 flex border border-slate-300 overflow-hidden">
                  {(DIVISIONS as readonly Division[]).map(d => (
                    divisionSplit.pct[d] > 0 && (
                      <div key={d} className={DIVISION_COLORS[d]} style={{ width: `${divisionSplit.pct[d]}%` }}
                        title={`${d}: ₹${divisionSplit.totals[d].toLocaleString('en-IN')} (${divisionSplit.pct[d].toFixed(1)}%)`} />
                    )
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  {(DIVISIONS as readonly Division[]).map(d => (
                    divisionSplit.pct[d] > 0 && (
                      <div key={d} className="flex items-center gap-1 text-[10px]">
                        <div className={`w-2 h-2 ${DIVISION_COLORS[d]}`}></div>
                        <span className="text-slate-500 uppercase tracking-widest font-bold">{d}</span>
                        <span className="font-mono tabular-nums text-slate-700">{divisionSplit.pct[d].toFixed(0)}%</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            {/* Bank Book Table */}
            <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Entry #</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Narration</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ref</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Div</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Deposit</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Withdrawal</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-slate-200 border-b border-slate-300">
                    <td colSpan={5} className="px-3 py-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Opening Balance</td>
                    <td className="px-3 py-1.5 border-r border-slate-100"></td>
                    <td className="px-3 py-1.5 border-r border-slate-100"></td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-700">
                      {fmtCurrency(ledger.openingBalance) || '\u20B90.00'}
                    </td>
                  </tr>
                  {filtered.lines.map((line, i) => (
                    <tr key={line.id} className={`hover:bg-blue-50 border-b border-slate-100 ${i % 2 ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{fmtDate(line.journal.date)}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400 border-r border-slate-100">#{line.journal.entryNo}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">
                        {line.journal.narration}
                        {line.narration && line.narration !== line.journal.narration && (
                          <span className="text-[10px] text-slate-400 ml-1">({line.narration})</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-[10px] text-slate-500 border-r border-slate-100">{line.journal.refType || '--'}</td>
                      <td className="px-3 py-1.5 text-[10px] border-r border-slate-100">
                        {line.division && (
                          <span className={`inline-block w-2 h-2 mr-1 align-middle ${DIVISION_COLORS[line.division as Division] || 'bg-slate-300'}`}></span>
                        )}
                        <span className="text-slate-500">{line.division || '--'}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-700 border-r border-slate-100">{fmtCurrency(line.debit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-rose-700 border-r border-slate-100">{fmtCurrency(line.credit)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-medium ${line.balance < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                        {line.balance < 0 ? '-' : ''}{fmtCurrency(line.balance)}
                      </td>
                    </tr>
                  ))}
                  {filtered.lines.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No bank transactions match filters</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td colSpan={5} className="px-3 py-2 text-right text-[10px] uppercase tracking-widest border-r border-slate-700">Closing Balance</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(filtered.totalDebit)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(filtered.totalCredit)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-bold">
                      {filteredClosing < 0 ? '-' : ''}{fmtCurrency(filteredClosing) || '\u20B90.00'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        {!selectedBankId && !loading && (
          <div className="min-h-[200px] flex items-center justify-center">
            <div className="text-xs text-slate-400 uppercase tracking-widest">Select a bank account</div>
          </div>
        )}
      </div>

      {/* Keyboard shortcuts */}
      {showHelp && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
          <div className="bg-white shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-widest">Keyboard Shortcuts</div>
              <button onClick={() => setShowHelp(false)} className="text-slate-300 hover:text-white text-sm">×</button>
            </div>
            <div className="p-4 text-xs">
              {[
                ['Ctrl+F', 'Focus narration filter'],
                ['N', 'New bank entry'],
                ['T', 'Today preset'],
                ['M', 'This month preset'],
                ['0', 'Division: All'],
                ['1 / 2 / 3', 'Division: Sugar / Power / Ethanol'],
                ['Esc', 'Close modal / clear filters'],
                ['Ctrl+S', 'Save entry (in modal)'],
                ['?', 'Show this help'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b border-slate-100 py-1.5">
                  <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 font-mono text-[10px]">{k}</kbd>
                  <span className="text-slate-600">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* New Entry modal — pre-selected to current bank account */}
      <NewJournalEntryModal
        open={newEntryOpen}
        accounts={accounts}
        preselectedAccountId={selectedBankId}
        initialDivision={divisionFilter !== 'ALL' ? divisionFilter : undefined}
        onClose={() => setNewEntryOpen(false)}
        onCreated={() => fetchLedger()}
        onAccountCreated={() => fetchAccounts()}
      />
    </div>
  );
}
