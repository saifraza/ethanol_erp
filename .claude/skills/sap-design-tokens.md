# SAP Tier 2 Design Tokens

All enterprise/back-office pages MUST use these exact tokens. Plant/process pages (Tier 1) keep their rounded/colorful style.

## When to use Tier 2
- Accounts, Inventory, Sales, Procurement, Trade, Admin, Reports, Compliance
- Any NEW module unless it's plant-floor data entry

## Design Tokens (copy-paste exactly)

| Element | Tailwind Classes |
|---------|-----------------|
| **Page wrapper** | `<div className="min-h-screen bg-slate-50"><div className="p-3 md:p-6 space-y-0">` |
| **Page toolbar** | `bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6` with title: `text-sm font-bold tracking-wide uppercase` |
| **Toolbar subtitle** | `<span className="text-[10px] text-slate-400">\|</span><span className="text-[10px] text-slate-400">description</span>` |
| **Filter toolbar** | `bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6` |
| **KPI strip** | `grid gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6` each card: `bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-{color}-500` |
| **KPI label** | `text-[10px] font-bold text-slate-400 uppercase tracking-widest` |
| **KPI value** | `text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums` |
| **Table container** | `-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden` |
| **Table header row** | `bg-slate-800 text-white` |
| **Table header cell** | `px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700` |
| **Table body row** | `border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60` |
| **Table body cell** | `px-3 py-1.5 text-xs border-r border-slate-100` |
| **Table footer row** | `bg-slate-800 text-white font-semibold` |
| **Currency** | `font-mono tabular-nums` |
| **Status badge** | `text-[9px] font-bold uppercase px-1.5 py-0.5 border` (NO rounded) |
| **Button primary** | `px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700` (NO rounded) |
| **Button secondary** | `px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50` |
| **Form label** | `text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5` |
| **Form input** | `border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400` (NO rounded) |
| **Modal header** | `bg-slate-800 text-white px-4 py-2.5` with `text-xs font-bold uppercase tracking-widest` |
| **Modal body** | `bg-white shadow-2xl` (NO rounded) |
| **Tab active** | `text-[11px] font-bold uppercase tracking-widest border-b-2 border-blue-600` |
| **Empty/loading** | `text-xs text-slate-400 uppercase tracking-widest` |

## Hard Rules
- **NO rounded corners** — `rounded`, `rounded-lg`, `rounded-xl` are BANNED
- **NO emojis** in enterprise pages
- **NO shadow-sm** — use `shadow-2xl` only for modals
- **Edge-to-edge** tables and KPI strips with `-mx-3 md:-mx-6`
- **Vertical gridlines** in tables: `border-r border-slate-100` on cells, `border-r border-slate-700` on headers
- **Row striping**: `even:bg-slate-50/70`
- **Group headers** in tables: `bg-slate-200 border-b border-slate-300` with `text-[10px] font-bold uppercase tracking-widest`
