/**
 * Shared SAP-Tier-2 chrome for books pages: toolbar, filter toolbar, KPI tile,
 * help modal, date-preset helpers, IST date utilities. Mirrors the Ledger.tsx
 * design system so every books page (Cash, Bank, Day, JE, TB, P&L, BS, GST, COA)
 * stays visually consistent.
 */
import React, { ReactNode } from 'react';
import { DIVISIONS, Division, DIVISION_COLORS } from '../../constants/divisions';

export type DivisionFilter = 'ALL' | Division;

// ─── IST helpers ──────────────────────────────────────────────
export function istNow(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

export function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export type DatePreset = 'today' | 'week' | 'month' | 'fy' | 'lastFy';

export function computePreset(preset: DatePreset): { from: string; to: string } {
  const now = istNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  let from: Date, to: Date;
  if (preset === 'today') {
    from = new Date(Date.UTC(y, m, d));
    to = from;
  } else if (preset === 'week') {
    const dow = now.getUTCDay();
    from = new Date(Date.UTC(y, m, d - dow));
    to = new Date(Date.UTC(y, m, d));
  } else if (preset === 'month') {
    from = new Date(Date.UTC(y, m, 1));
    to = new Date(Date.UTC(y, m, d));
  } else if (preset === 'fy') {
    const fyStart = m >= 3 ? y : y - 1;
    from = new Date(Date.UTC(fyStart, 3, 1));
    to = new Date(Date.UTC(y, m, d));
  } else {
    const fyStart = m >= 3 ? y - 1 : y - 2;
    from = new Date(Date.UTC(fyStart, 3, 1));
    to = new Date(Date.UTC(fyStart + 1, 2, 31));
  }
  return { from: toISODate(from), to: toISODate(to) };
}

// ─── Formatting ───────────────────────────────────────────────
export function fmtINR(n: number): string {
  if (!n || n === 0) return '';
  return '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Page Toolbar ─────────────────────────────────────────────
export function PageToolbar({
  title,
  subtitle,
  statusBadge,
  children,
}: {
  title: string;
  subtitle?: string;
  statusBadge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold tracking-wide uppercase">{title}</h1>
        {subtitle && (
          <>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{subtitle}</span>
          </>
        )}
        {statusBadge}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

// ─── Tip banner (remembers dismissal) ────────────────────────
export function TipBanner({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [show, setShow] = React.useState(() => !localStorage.getItem(storageKey));
  if (!show) return null;
  return (
    <div className="bg-amber-50 border-x border-b border-amber-200 px-4 py-1.5 -mx-3 md:-mx-6 flex items-center justify-between">
      <div className="text-[11px] text-amber-800">{children}</div>
      <button
        onClick={() => { localStorage.setItem(storageKey, '1'); setShow(false); }}
        className="text-[10px] text-amber-700 hover:text-amber-900 uppercase tracking-widest"
      >Dismiss</button>
    </div>
  );
}

// ─── Filter toolbar container ─────────────────────────────────
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
      {children}
    </div>
  );
}

export function SecondaryFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="bg-slate-50 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
      {children}
    </div>
  );
}

export function FilterLabel({ children }: { children: ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{children}</label>;
}

// ─── Date preset buttons ──────────────────────────────────────
export function PresetButtons({ onPreset }: { onPreset: (p: DatePreset) => void }) {
  return (
    <div>
      <FilterLabel>Presets</FilterLabel>
      <div className="flex gap-1">
        <button onClick={() => onPreset('today')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50" title="Today (T)">Today</button>
        <button onClick={() => onPreset('week')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50">Week</button>
        <button onClick={() => onPreset('month')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50" title="This Month (M)">Month</button>
        <button onClick={() => onPreset('fy')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50">FY</button>
        <button onClick={() => onPreset('lastFy')} className="px-2 py-1.5 bg-white border border-slate-300 text-[10px] font-medium hover:bg-slate-50">Last FY</button>
      </div>
    </div>
  );
}

export function DateRangeInputs({
  from, to, onChange,
}: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  return (
    <>
      <div>
        <FilterLabel>From</FilterLabel>
        <input type="date" value={from} onChange={e => onChange({ from: e.target.value, to })}
          className="border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
      </div>
      <div>
        <FilterLabel>To</FilterLabel>
        <input type="date" value={to} onChange={e => onChange({ from, to: e.target.value })}
          className="border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
      </div>
    </>
  );
}

export function DivisionSegmented({
  value, onChange,
}: { value: DivisionFilter; onChange: (d: DivisionFilter) => void }) {
  return (
    <div>
      <FilterLabel>Division (0/1/2/3)</FilterLabel>
      <div className="flex">
        {(['ALL', ...DIVISIONS] as DivisionFilter[]).map(d => (
          <button key={d} onClick={() => onChange(d)}
            className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border ${value === d ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'} ${d !== 'ALL' ? '-ml-px' : ''}`}
          >{d === 'ALL' ? 'All' : d}</button>
        ))}
      </div>
    </div>
  );
}

// ─── KPI strip ────────────────────────────────────────────────
export function KpiStrip({ cols, children }: { cols: number; children: ReactNode }) {
  const colClass = cols === 3 ? 'grid-cols-3' : cols === 4 ? 'grid-cols-4' : cols === 5 ? 'grid-cols-5' : 'grid-cols-6';
  return (
    <div className={`grid ${colClass} border-x border-b border-slate-300 -mx-3 md:-mx-6`}>
      {children}
    </div>
  );
}

const borderColorMap: Record<string, string> = {
  slate: 'border-l-slate-500',
  blue: 'border-l-blue-500',
  emerald: 'border-l-emerald-500',
  rose: 'border-l-rose-500',
  amber: 'border-l-amber-500',
  indigo: 'border-l-indigo-500',
  violet: 'border-l-violet-500',
  green: 'border-l-green-500',
  red: 'border-l-red-500',
};

export function KpiTile({
  label, value, sub, color = 'slate', valueClass = 'text-slate-800', last = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color?: keyof typeof borderColorMap | string;
  valueClass?: string;
  last?: boolean;
}) {
  const border = borderColorMap[color] || 'border-l-slate-500';
  return (
    <div className={`bg-white px-4 py-3 border-l-4 ${border} ${last ? '' : 'border-r border-slate-300'}`}>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
      <div className={`text-base font-bold mt-1 font-mono tabular-nums ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Division split bar ───────────────────────────────────────
export function DivisionSplitBar({ lines }: { lines: Array<{ division: string | null; debit: number; credit: number }> }) {
  const totals: Record<string, number> = { SUGAR: 0, POWER: 0, ETHANOL: 0, COMMON: 0 };
  for (const l of lines) {
    const d = (l.division || 'COMMON') as Division;
    totals[d] = (totals[d] || 0) + l.debit + l.credit;
  }
  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  if (grand === 0) return null;
  const pct: Record<string, number> = {};
  for (const d of DIVISIONS) pct[d] = (totals[d] / grand) * 100;

  return (
    <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2 flex items-center gap-3">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Division Split</div>
      <div className="flex-1 h-4 flex border border-slate-300 overflow-hidden">
        {(DIVISIONS as readonly Division[]).map(d => (
          pct[d] > 0 && (
            <div key={d} className={DIVISION_COLORS[d]} style={{ width: `${pct[d]}%` }}
              title={`${d}: ₹${totals[d].toLocaleString('en-IN')} (${pct[d].toFixed(1)}%)`} />
          )
        ))}
      </div>
      <div className="flex items-center gap-3">
        {(DIVISIONS as readonly Division[]).map(d => (
          pct[d] > 0 && (
            <div key={d} className="flex items-center gap-1 text-[10px]">
              <div className={`w-2 h-2 ${DIVISION_COLORS[d]}`}></div>
              <span className="text-slate-500 uppercase tracking-widest font-bold">{d}</span>
              <span className="font-mono tabular-nums text-slate-700">{pct[d].toFixed(0)}%</span>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

// ─── Help modal ───────────────────────────────────────────────
export function HelpModal({
  open, onClose, entries,
}: { open: boolean; onClose: () => void; entries: Array<[string, string]> }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-widest">Keyboard Shortcuts</div>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-sm">×</button>
        </div>
        <div className="p-4 text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between border-b border-slate-100 py-1.5">
              <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 font-mono text-[10px]">{k}</kbd>
              <span className="text-slate-600">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Table building blocks ────────────────────────────────────
export function TableContainer({ children }: { children: ReactNode }) {
  return <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">{children}</div>;
}

export function Th({ children, align = 'left', last = false }: { children: ReactNode; align?: 'left' | 'right'; last?: boolean }) {
  return (
    <th className={`${align === 'right' ? 'text-right' : 'text-left'} px-3 py-2 font-semibold text-[10px] uppercase tracking-widest ${last ? '' : 'border-r border-slate-700'}`}>
      {children}
    </th>
  );
}

// ─── Ref type chip group ──────────────────────────────────────
export const REF_TYPES = ['SALE', 'PURCHASE', 'PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL'] as const;
export type RefType = typeof REF_TYPES[number];

export function RefTypeChips({ value, onToggle }: { value: Set<RefType>; onToggle: (rt: RefType) => void }) {
  return (
    <div>
      <FilterLabel>Ref Type</FilterLabel>
      <div className="flex gap-0.5">
        {REF_TYPES.map(rt => (
          <button key={rt} onClick={() => onToggle(rt)}
            className={`px-1.5 py-1 text-[9px] font-bold uppercase tracking-widest border ${value.has(rt) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >{rt}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Status badge for toolbar ─────────────────────────────────
export function StatusBadge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${ok ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
      {children}
    </span>
  );
}
