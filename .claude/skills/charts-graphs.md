# Charts & Graphs — Standard Design System

## Golden Rule
**All charts in the ERP MUST follow the OPC Live pattern.** The OPC Live page (`OPCTagManager.tsx`) is the reference implementation. Every new or refactored chart should use the same library, component structure, color palette, axis config, tooltip style, and container styling.

## Library: Recharts (v3.8+)
```tsx
import {
  ComposedChart, LineChart, BarChart, AreaChart, PieChart,
  Line, Bar, Area, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Brush,
} from 'recharts';
```
**Never use** Chart.js, D3 directly, or any other charting library. Recharts only.

---

## Chart Container (Standard Wrapper)

### For Tier 1 pages (Plant/Process):
```tsx
<div className="bg-white border border-slate-300 p-3">
  <div className="flex items-center justify-between mb-2">
    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</h3>
    {/* Optional controls (zoom, time range) */}
  </div>
  <ResponsiveContainer width="100%" height={250}>
    {/* Chart here */}
  </ResponsiveContainer>
</div>
```

### For Tier 2 pages (SAP Enterprise):
```tsx
<div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
  <div className="bg-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-300">
    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</span>
    {/* Optional controls */}
  </div>
  <div className="bg-white px-3 py-3">
    <ResponsiveContainer width="100%" height={250}>
      {/* Chart here */}
    </ResponsiveContainer>
  </div>
</div>
```

**NO rounded corners** on chart containers in Tier 2. **NO shadow-sm.** Use `border border-slate-300`.

---

## Standard Heights
| Context | Height |
|---------|--------|
| Main chart (primary data viz) | `250px` |
| Secondary/supporting chart | `200px` |
| Compact inline chart | `150px` |
| Full-page analytics chart | `300px` |
| Sparkline / mini chart | `80px` |

---

## Axis & Grid Configuration (ALWAYS use these)

```tsx
<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
<XAxis
  dataKey="time"
  tick={{ fontSize: 9, fill: '#64748b' }}
  tickLine={false}
  axisLine={{ stroke: '#cbd5e1' }}
/>
<YAxis
  tick={{ fontSize: 9, fill: '#64748b' }}
  tickLine={false}
  axisLine={{ stroke: '#cbd5e1' }}
  width={45}
/>
```

### Dual Y-Axis (when needed):
```tsx
<YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
<YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
```

---

## Tooltip (Standard — ALWAYS use this exact style)

```tsx
<Tooltip
  contentStyle={{
    fontSize: 12,
    border: '1px solid #94a3b8',
    background: '#fff',
    padding: '8px 12px',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
  }}
  labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }}
  itemStyle={{ padding: '1px 0' }}
  formatter={(value: number, name: string) => [
    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{typeof value === 'number' ? value.toFixed(2) : value}</span>,
    name,
  ]}
/>
```

---

## Color Palette (Standard — use these and ONLY these)

### Primary Data Colors (in order of preference):
| Token | Hex | Tailwind | Use for |
|-------|-----|----------|---------|
| `primary` | `#1e40af` | blue-800 | Main/average value, primary metric |
| `secondary` | `#6366f1` | indigo-500 | Secondary metric, mean reference |
| `success` | `#10b981` | emerald-500 | Positive values, alcohol%, dispatch |
| `danger` | `#dc2626` | red-600 | Alarms, max values, temperature |
| `warning` | `#f59e0b` | amber-500 | pH, caution values |
| `info` | `#0891b2` | cyan-600 | Min values, stock levels |
| `accent` | `#8b5cf6` | violet-500 | Level%, tertiary metrics |
| `neutral` | `#64748b` | slate-500 | Disabled, inactive |

### Area Fill Colors (semi-transparent backgrounds):
| Token | Hex | Opacity | Use for |
|-------|-----|---------|---------|
| `fillMax` | `#fed7aa` | 0.5 | Upper bound / max range area |
| `fillMin` | `#bfdbfe` | 0.5 | Lower bound / min range area |
| `fillPrimary` | `#93c5fd` | 0.3 | Primary metric area fill |
| `fillSuccess` | `#6ee7b7` | 0.3 | Positive area fill |
| `fillWarning` | `#fcd34d` | 0.3 | Warning area fill |
| `fillDanger` | `#fca5a5` | 0.2 | Danger area fill |

### Bar Colors:
```tsx
// Use solid colors, always with radius on top
<Bar dataKey="value" fill="#3b82f6" radius={[3, 3, 0, 0]} />
```
| Purpose | Hex |
|---------|-----|
| Primary bar | `#3b82f6` (blue-500) |
| Secondary bar | `#10b981` (emerald-500) |
| Accent bar | `#8b5cf6` (violet-500) |
| Warning bar | `#f97316` (orange-500) |

### Multi-Series Colors (when plotting multiple lines):
```typescript
const SERIES_COLORS = [
  '#1e40af', // blue-800
  '#dc2626', // red-600
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#0891b2', // cyan-600
  '#f97316', // orange-500
  '#64748b', // slate-500
];
```

---

## Line Styles

### Primary line (the main metric):
```tsx
<Line type="monotone" dataKey="avg" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} activeDot={{ r: 5 }} />
```

### Secondary line (supporting metric):
```tsx
<Line type="monotone" dataKey="max" stroke="#dc2626" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
```

### Tertiary line (reference/faint):
```tsx
<Line type="monotone" dataKey="min" stroke="#0891b2" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
```

**Rules:**
- Primary lines: solid, strokeWidth 2, dots with r:3
- Secondary lines: dashed `"4 3"`, strokeWidth 1.5, no dots
- Max 5 lines per chart. More than 5 = split into multiple charts
- Always use `type="monotone"` for smooth curves
- Use `connectNulls={true}` when data may have gaps

---

## Reference Lines (Alarms, Thresholds, Averages)

```tsx
{/* Alarm threshold (danger) */}
<ReferenceLine y={hhAlarm} stroke="#dc2626" strokeDasharray="6 3"
  label={{ value: `HH ${hhAlarm}`, fontSize: 9, fill: '#dc2626', position: 'right' }} />

{/* Statistical mean */}
<ReferenceLine y={mean} stroke="#6366f1" strokeDasharray="2 2"
  label={{ value: `Mean ${mean}`, fontSize: 9, fill: '#6366f1', position: 'left' }} />

{/* Target / goal */}
<ReferenceLine y={target} stroke="#10b981" strokeDasharray="4 4"
  label={{ value: `Target ${target}`, fontSize: 9, fill: '#10b981', position: 'right' }} />
```

---

## Brush (Timeline Navigation — use for any chart with >24 data points)

```tsx
<Brush
  dataKey="time"
  height={20}
  stroke="#94a3b8"
  fill="#f8fafc"
  travellerWidth={8}
/>
```

**When to add Brush:**
- Historical data charts with >24 data points
- Time series spanning multiple days
- Any chart where zooming/panning adds value
- NOT for summary/aggregate charts (e.g., bar charts with <12 bars)

---

## Area Fills (Range Bands)

For showing min/max or confidence intervals:
```tsx
<Area type="monotone" dataKey="max" stroke="none" fill="#fed7aa" fillOpacity={0.5} name="maxArea" legendType="none" />
<Area type="monotone" dataKey="min" stroke="none" fill="#bfdbfe" fillOpacity={0.5} name="minArea" legendType="none" />
```

**Always** hide range areas from legend with `legendType="none"`.

---

## Legend (when needed)

```tsx
<Legend
  verticalAlign="top"
  height={30}
  iconType="plainline"
  wrapperStyle={{ fontSize: 10, color: '#64748b' }}
/>
```

**When to show Legend:**
- Charts with 2+ visible series
- NOT for single-metric charts
- NOT for range areas (hide with `legendType="none"`)

---

## Y-Axis Zoom Controls (for monitoring charts)

```tsx
const [yZoom, setYZoom] = useState(0);

// In JSX, above chart:
<div className="flex items-center justify-end gap-1 mb-1">
  <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
  <button onClick={() => setYZoom(z => Math.min(z + 1, 5))}
    className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200">+</button>
  <button onClick={() => setYZoom(z => Math.max(z - 1, 0))}
    className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200">-</button>
  {yZoom > 0 && <button onClick={() => setYZoom(0)}
    className="px-1.5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-500 text-[9px] hover:bg-slate-200">Reset</button>}
</div>

// In YAxis domain:
domain={(() => {
  if (!data.length) return [0, 'auto'] as const;
  const allMax = Math.max(...data.map(d => d.max));
  if (yZoom === 0) return [0, Math.ceil(allMax * 1.1)] as const;
  const allMin = Math.min(...data.map(d => d.min));
  const mid = (allMin + allMax) / 2;
  const range = allMax - allMin || 1;
  const factor = Math.pow(0.6, yZoom);
  return [mid - range * factor, mid + range * factor];
})()}
```

**When to add Y-Zoom:** Monitoring/live data charts. NOT for summary dashboards.

---

## Time Range Selector (for historical data charts)

```tsx
const TIME_RANGES = [
  { label: '6h', hours: 6 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
  { label: '7d', hours: 168 },
];

// In JSX:
<div className="flex items-center gap-1">
  {TIME_RANGES.map(r => (
    <button key={r.hours}
      onClick={() => setTimeRange(r.hours)}
      className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${
        timeRange === r.hours
          ? 'bg-slate-800 text-white border-slate-800'
          : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
      }`}>
      {r.label}
    </button>
  ))}
</div>
```

---

## Statistics Panel (above chart, for detailed data views)

```tsx
const stats = [
  { label: 'Mean', value: mean.toFixed(2), color: 'indigo' },
  { label: 'Min', value: min.toFixed(2), color: 'cyan' },
  { label: 'Max', value: max.toFixed(2), color: 'red' },
  { label: 'Range', value: range.toFixed(2), color: 'amber' },
  { label: 'Std Dev', value: stdDev.toFixed(2), color: 'purple' },
  { label: 'Samples', value: count.toString(), color: 'slate' },
];

<div className="grid grid-cols-3 md:grid-cols-6 gap-0 border border-slate-300 mb-3">
  {stats.map(s => (
    <div key={s.label} className="px-3 py-2 border-r border-slate-200 last:border-r-0">
      <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
      <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 text-${s.color}-600`}>
        {s.value}
      </div>
    </div>
  ))}
</div>
```

---

## Chart Type Selection Guide

| Data Shape | Chart Type | Example |
|------------|-----------|---------|
| Single metric over time | `ComposedChart` (Line + optional Area fill) | Ethanol production trend |
| Multiple metrics over time | `ComposedChart` (multiple Lines) | Temp + pH + SG |
| Value with min/max range | `ComposedChart` (Area bands + Line) | OPC tag with alarm bands |
| Comparison across categories | `BarChart` | Daily production by product |
| Part-to-whole | `PieChart` with `<Cell>` colors | Product mix, stock composition |
| Cumulative / running total | `AreaChart` | Cumulative dispatch |
| Distribution | `BarChart` (histogram-style) | Sieve analysis |

**Prefer `ComposedChart`** over plain `LineChart`/`AreaChart` — it's more flexible and allows mixing types.

---

## Data Formatting Standards

### Time axis labels:
```typescript
// For hourly data (< 48h range):
const timeLabel = new Date(d.hour).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

// For daily data (> 48h range):
const dateLabel = new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

// For combined (multi-day hourly):
const combined = `${dateLabel} ${timeLabel}`;
```

### Value formatting in tooltips:
```typescript
// Numeric values: always 2 decimal places, monospace
value.toFixed(2)

// Currency: rupee format
'₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2 })

// Percentage:
value.toFixed(1) + '%'

// Large numbers:
value.toLocaleString('en-IN')
```

---

## Complete Example: Standard Time Series Chart

```tsx
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Brush, Legend } from 'recharts';

function MyChart({ data, title }: { data: DataPoint[]; title: string }) {
  return (
    <div className="bg-white border border-slate-300 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</span>
      </div>
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px' }}
            labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }}
            itemStyle={{ padding: '1px 0' }}
          />
          <Line type="monotone" dataKey="value" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} name="Value" />
          {data.length > 24 && <Brush dataKey="time" height={20} stroke="#94a3b8" fill="#f8fafc" travellerWidth={8} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

---

## Current Modules — Chart Audit & Status

| Module | File | Current Charts | Compliant? | Notes |
|--------|------|---------------|------------|-------|
| **OPC Live** | `OPCTagManager.tsx` | ComposedChart (Line+Area+Brush+RefLine) | REFERENCE | This IS the standard |
| **Dashboard** | `Dashboard.tsx` | BarChart, LineChart, AreaChart, ComposedChart | NEEDS UPDATE | Uses `rounded-xl shadow-sm`, missing Brush, old tooltip style, inconsistent container styling |
| **Fermentation** | `Fermentation.tsx` | LineChart (dual Y-axis) | NEEDS UPDATE | No Brush, basic tooltip, `rounded-lg shadow-sm` container, missing tickLine:false |
| **Pre-Fermentation** | `PreFermentation.tsx` | LineChart (dual Y-axis) | NEEDS UPDATE | Same issues as Fermentation |
| **Milling** | `Milling.tsx` | LineChart x5, BarChart x1 | NEEDS UPDATE | No Brush, `rounded-xl` containers, activeDot inconsistent, missing axis styling |
| **Liquefaction** | `Liquefaction.tsx` | AreaChart, BarChart | NEEDS UPDATE | Uses SVG gradient defs (acceptable but non-standard), `rounded` containers |
| **Distillation** | `Distillation.tsx` | LineChart | NEEDS UPDATE | Basic chart, no Brush, rounded containers, minimal styling |
| **Reports** | `Reports.tsx` | (check if has charts) | TBD | |
| **Sales Dashboard** | `SalesDashboard.tsx` | No recharts | N/A | Could benefit from charts |
| **Inventory** | Various | No charts | N/A | ABC Analysis has no chart yet |

---

## NEVER DO with Charts
- **Never use** `rounded-xl`, `rounded-lg`, or `shadow-sm` on chart containers
- **Never use** Chart.js, D3, or any library other than Recharts
- **Never use** random/ad-hoc colors — stick to the palette above
- **Never create** charts without `ResponsiveContainer`
- **Never use** font sizes > 12px in chart elements (axes, labels, tooltip)
- **Never omit** `tickLine={false}` on axes
- **Never omit** `strokeDasharray="3 3" stroke="#e2e8f0"` on CartesianGrid
- **Never use** more than 5 visible lines in a single chart
- **Never skip** the standard tooltip style

## ALWAYS DO with Charts
- **Always use** `ComposedChart` as default (unless pure Bar or Pie)
- **Always use** `ResponsiveContainer width="100%" height={N}`
- **Always use** the standard tooltip with border, bg, padding
- **Always add** `Brush` when data points > 24
- **Always use** `type="monotone"` on Lines
- **Always use** `font-mono tabular-nums` for numeric displays near charts
- **Always add** `ReferenceLine` for known thresholds (alarms, targets, means)
- **Always match** the color palette defined above
- **Always use** `connectNulls={true}` when data may have gaps
