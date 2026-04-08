import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';

export interface ComboAccount {
  id: string;
  code: string;
  name: string;
  type: string;
}

export interface AccountComboboxHandle {
  focus: () => void;
  clear: () => void;
}

interface Props {
  accounts: ComboAccount[];
  value: string;                       // selected account id
  onChange: (id: string, acc: ComboAccount | null) => void;
  onRequestCreate?: (searchText: string) => void;  // opens QuickCreateAccountModal
  placeholder?: string;
  autoFocus?: boolean;
  allowCreate?: boolean;               // show "+ Create" row, default true
  size?: 'sm' | 'md';                  // md=ledger toolbar, sm=JE line row
  className?: string;
}

/** Type-ahead account picker with keyboard navigation and "+ create new head" row. */
const AccountCombobox = forwardRef<AccountComboboxHandle, Props>(function AccountCombobox(
  { accounts, value, onChange, onRequestCreate, placeholder = 'Search account…', autoFocus = false, allowCreate = true, size = 'md', className = '' },
  ref
) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync query text from selected value when not focused
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    if (!value) {
      setQuery('');
      return;
    }
    const sel = accounts.find(a => a.id === value);
    if (sel) setQuery(`${sel.code} — ${sel.name}`);
  }, [value, accounts]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    },
    clear: () => {
      setQuery('');
      onChange('', null);
      setOpen(false);
    },
  }), [onChange]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts.slice(0, 50);
    return accounts
      .filter(a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [query, accounts]);

  const hasExactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return accounts.some(a => a.code.toLowerCase() === q || a.name.toLowerCase() === q);
  }, [query, accounts]);

  const showCreateRow = allowCreate && !!onRequestCreate && query.trim().length >= 2 && !hasExactMatch;
  const totalItems = filtered.length + (showCreateRow ? 1 : 0);

  useEffect(() => {
    if (highlight >= totalItems) setHighlight(Math.max(0, totalItems - 1));
  }, [totalItems, highlight]);

  const selectItem = useCallback((idx: number) => {
    if (idx < filtered.length) {
      const acc = filtered[idx];
      onChange(acc.id, acc);
      setQuery(`${acc.code} — ${acc.name}`);
      setOpen(false);
      inputRef.current?.blur();
    } else if (showCreateRow && onRequestCreate) {
      onRequestCreate(query.trim());
      setOpen(false);
    }
  }, [filtered, onChange, showCreateRow, onRequestCreate, query]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.min(totalItems - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && totalItems > 0) selectItem(highlight);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    }
  }, [open, totalItems, highlight, selectItem]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlight}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const padY = size === 'sm' ? 'py-1' : 'py-1.5';
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { setOpen(true); inputRef.current?.select(); }}
        onBlur={() => { setTimeout(() => setOpen(false), 150); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`w-full border border-slate-300 px-2.5 ${padY} ${textSize} text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400`}
        title="Type to search. ↑↓ to navigate, Enter to select, Esc to close."
      />
      {open && (
        <div
          ref={listRef}
          className="absolute z-50 left-0 right-0 top-full mt-0.5 max-h-72 overflow-auto bg-white border border-slate-300 shadow-2xl"
        >
          {filtered.length === 0 && !showCreateRow && (
            <div className="px-3 py-2 text-[10px] text-slate-400 uppercase tracking-widest">No matches</div>
          )}
          {filtered.map((a, idx) => (
            <div
              key={a.id}
              data-idx={idx}
              onMouseDown={e => { e.preventDefault(); selectItem(idx); }}
              onMouseEnter={() => setHighlight(idx)}
              className={`px-3 py-1.5 text-xs cursor-pointer border-b border-slate-100 flex items-center gap-2 ${highlight === idx ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
            >
              <span className="font-mono text-[10px] text-slate-500 w-14">{a.code}</span>
              <span className="text-slate-800 flex-1 truncate">{a.name}</span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{a.type}</span>
            </div>
          ))}
          {showCreateRow && (
            <div
              data-idx={filtered.length}
              onMouseDown={e => { e.preventDefault(); selectItem(filtered.length); }}
              onMouseEnter={() => setHighlight(filtered.length)}
              className={`px-3 py-2 text-xs cursor-pointer border-t border-slate-300 flex items-center gap-2 ${highlight === filtered.length ? 'bg-emerald-100' : 'bg-emerald-50 hover:bg-emerald-100'}`}
              title="Create a new ledger head"
            >
              <span className="text-emerald-700 font-bold">+</span>
              <span className="text-emerald-800">Create <span className="font-semibold">"{query.trim()}"</span> as new account</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default AccountCombobox;
