# Dashboard & Analytics Module

## Files
- **Backend**: `routes/dashboard.ts`, `routes/reports.ts`
- **Frontend**: `pages/Dashboard.tsx`, `pages/sales/SalesDashboard.tsx`, `pages/Reports.tsx`
- **Charts**: Uses recharts library (lazy-loaded via React.lazy, vendor-chunked in Vite)

## Architecture
- `GET /analytics`: 12 parallel queries for KPI data across all modules
- `GET /fermentation-deep`: 10 queries for fermentation analytics (gravity curves, predictions, heatmaps)
- `GET /` (legacy): 2 simple queries for basic stats
- Frontend renders 8+ chart types: AreaChart, BarChart, LineChart, PieChart, etc.

## CRITICAL Performance Rules

This module has the worst performance in the entire ERP. Follow these rules strictly:

1. **NEVER use findMany without select** — dashboard queries fetch 30-50 columns when only 5-6 are needed
2. **NEVER use findMany without take** — queries can return 50,000+ rows for 365-day ranges
3. **USE Prisma aggregate()** for KPIs instead of loading raw data and computing in JS:
   ```typescript
   // BAD: loads all rows into memory
   const entries = await prisma.grainEntry.findMany({ where: { date: { gte: from } } });
   const total = entries.reduce((s, e) => s + e.grainUnloaded, 0);

   // GOOD: computed in PostgreSQL
   const { _sum } = await prisma.grainEntry.aggregate({
     where: { date: { gte: from } },
     _sum: { grainUnloaded: true },
   });
   ```
4. **USE groupBy** for trend data instead of loading all rows:
   ```typescript
   const daily = await prisma.grainEntry.groupBy({
     by: ['date'],
     where: { date: { gte: from } },
     _sum: { grainUnloaded: true, grainConsumed: true },
     orderBy: { date: 'asc' },
     take: 30,  // Last 30 days only
   });
   ```
5. **ADD caching** for expensive computations (5-minute TTL for KPIs)
6. **Memoize** frontend components: KPI cards, FermCard, HealthBar, SectionHeader should use `React.memo()`

## KPI Calculations
- **Grain**: Total unloaded, consumed, silo closing stock, total grain at plant
- **Ethanol**: Production (BL), total stock, average strength (% v/v)
- **DDGS**: Daily production, total dispatched, closing stock
- **Fermentation**: Active batches, avg retention time, avg yield, phase distribution
- **Sales**: Revenue, pending orders, dispatch status
- **Procurement**: Outstanding POs, pending GRNs, payment due

## Dashboard "Death Spiral" (current bug)
The `/analytics` endpoint with `days=365`:
1. Fires 12 unbounded queries → loads ~50K rows into memory
2. Runs 6+ nested reduce/loop operations in JS
3. Serializes 500KB-2MB JSON response
4. Sends uncompressed (now fixed with compression middleware)
5. Takes 8-20 seconds

**Fix approach**: Replace raw findMany with aggregate/groupBy, add select clauses, cap at 30-day trends, cache KPI results for 5 minutes.

## Inline Components (Dashboard.tsx)
These are defined INSIDE Dashboard.tsx and re-render on every parent update:
- `KPI()` — metric card
- `FermCard()` — fermenter status
- `HealthBar()` — progress indicator
- `SectionHeader()` — section divider

All should be wrapped in `React.memo()` or extracted to separate files.
