# MSPIL Distillery ERP — Claude Code Guide

## Project Overview
- **Company**: Mahakaushal Sugar & Power Industries Ltd (MSPIL)
- **System**: Distillery ERP for ethanol plant at Village Bachai, Dist. Narsinghpur, MP
- **Stack**: Express + TypeScript + Prisma ORM (backend), React + Vite + Tailwind CSS (frontend), PostgreSQL on Railway
- **Production URL**: https://app.mspil.in/
- **Login**: admin@distillery.com / admin123

## Deployment — Railway
- **Auto-deploys** from GitHub `main` branch of `ethanol_erp` repo
- **DB**: Set via `DATABASE_URL` env var on Railway (never hardcode)
- **OPC DB**: Separate PostgreSQL for OPC data, set via `DATABASE_URL_OPC` env var
  - Prisma schema: `backend/prisma/opc/schema.prisma`
  - Tables: OpcMonitoredTag, OpcReading, OpcHourlyReading, OpcSyncLog
  - Procfile runs `prisma db push --schema=prisma/opc/schema.prisma` on deploy
  - If `DATABASE_URL_OPC` is not set, OPC endpoints use fallback raw SQL
- Root build: `cd backend && npm ci && prisma generate && tsc --outDir dist && cp -r src/data dist/ && cd ../frontend && npm ci && vite build`
- Procfile: `web: cd backend && npx prisma db push --skip-generate && node dist/server.js`
- Frontend vite outputs to `../backend/public` (not `frontend/dist/`)
- Any new static data files (like `calibrations.json`) must be copied in the ROOT build script

## Core Design Principles

### WhatsApp-First Data Collection
WhatsApp is a **key feature** of this ERP. Plant operators submit hourly readings via WhatsApp instead of logging into the web UI. This is critical because:
- Operators on the plant floor use phones, not desktops
- Auto-collect bots ask questions on schedule, parse replies, save to DB, and share summary reports to groups
- Every new module should consider WhatsApp integration from day one

**WhatsApp Two-Service Architecture (CRITICAL):**
- WhatsApp runs as a **SEPARATE Railway service** (`mspil-whatsapp` repo, https://github.com/saifraza/mspil-whatsapp.git)
- The main ERP does NOT run WhatsApp — it proxies to the worker via `WA_WORKER_URL` env var
- **Reason**: WhatsApp Baileys connection is fragile; if it crashes, it shouldn't take down the ERP
- Both services share the same PostgreSQL database on Railway
- The worker auto-deploys from `mspil-whatsapp` repo — **changes to WhatsApp code must be pushed to BOTH repos**

**Worker service** (`mspil-whatsapp` repo):
- `src/whatsapp-server.ts` — Express server with send/trigger/sessions endpoints
- `src/services/whatsappBaileys.ts` — WhatsApp connection via Baileys (QR auth)
- `src/services/whatsappAutoCollect.ts` — Auto-collect conversation engine + scheduler
- `src/services/autoCollectModules/` — Module-specific bots (one file per module)
- Incoming message replies are handled HERE (not on main ERP)
- Auto-collect sessions (`activeSessions` map) live in worker memory
- **URL**: `http://mspil-whatsapp.railway.internal:5001` (Railway internal)

**Main ERP proxies** (`backend/src/services/whatsappClient.ts`):
- `waSend()` → `POST /wa/send` on worker
- `waSendGroup()` → `POST /wa/send-group` on worker
- `/api/auto-collect/trigger` → `POST /wa/auto-collect/trigger` on worker
- `/api/auto-collect/sessions` → `GET /wa/auto-collect/sessions` on worker

**Schedules** are stored in `AutoCollectSchedule` DB table (shared by both services):
- Each module has one row: `module` (unique key), `phone`, `intervalMinutes`, `enabled`, etc.
- Frontend saves via `PUT /api/auto-collect/schedules/:module` on main ERP
- Worker loads via `prisma.autoCollectSchedule.findMany()` on startup + after saves
- Legacy fallback: also checks `Settings.autoCollectConfig` JSON blob and auto-migrates

**NEVER DO with WhatsApp:**
- Never create auto-collect sessions on the main ERP server — they must be on the worker
- Never store schedules as JSON blobs — use the `AutoCollectSchedule` model
- Never import from `whatsappBaileys` directly on the main ERP — use `whatsappClient`

**Adding a new WhatsApp auto-collect module:**
1. Copy `_template.ts` → `yourModule.ts` in `autoCollectModules/` (BOTH repos)
2. Define `STEPS` (field groups), implement `buildPrompt`, `parseReply`, `saveData`
3. Register in `autoCollectModules/index.ts` (BOTH repos)
4. Add schedule via Settings UI or seed data
5. Set `privateOnly: false` if reports should go to WhatsApp group
6. **Push changes to BOTH `ethanol_erp` AND `mspil-whatsapp` repos**

### WhatsApp Report Sharing
Beyond auto-collect, the ERP also supports one-click WhatsApp sharing from the web UI:
- Fermentation vessel readings → formatted report shared to group
- Dispatch/shipment details → shared to relevant stakeholders
- Any module can build a WhatsApp-formatted report string and share via `sendToGroup()` or `sendWhatsAppMessage()`

### IST Timezone (Critical)
Server runs UTC on Railway. Pattern for IST:
```typescript
function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}
const ist = nowIST();
const hours = ist.getUTCHours();    // IST hours
const minutes = ist.getUTCMinutes(); // IST minutes
```
**NEVER** use `toLocaleTimeString()` or `toLocaleDateString()` on server — output depends on server locale/location.

### Module Build Approach
When building new modules:
1. **First create a skill file** in `.claude/skills/` with full spec (models, routes, pages, integration points)
2. **Build sequentially** — modules are interlinked (accounts hooks into sales/procurement, inventory links to production)
3. **Always consider WhatsApp integration** — what readings/reports should be auto-collected or shared?
4. **Follow existing patterns** — use the code templates below
5. **Use SAP-style UI** for all non-plant modules (see UI Design System below)

### UI Design System — Two Tiers

The ERP has two distinct UI styles:

**Tier 1 — Plant/Process Pages** (existing style, keep as-is):
- Modules: Grain, Milling, Liquefaction, Fermentation, Distillation, Evaporation, Decanter, Dryer, DDGS, Lab, Dashboard
- Style: Rounded corners, cards with shadow, colorful badges, emoji icons, relaxed spacing
- Reason: These are used by plant operators on phones/tablets — friendlier UI is better

**Tier 2 — Enterprise/Back-Office Pages** (SAP-style, use for ALL new modules):
- Modules: Accounts, Inventory, Sales, Procurement, Trade, Admin, Reports
- Style: Dense, professional, SAP/Oracle-like — square edges, dark headers, gridlines, compact typography
- **All new modules MUST use Tier 2 style unless they are plant-floor data entry**

#### Tier 2 SAP Design Tokens (copy-paste these exactly):

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

#### SAP Design Rules:
- **NO rounded corners** — everything is square (`rounded`, `rounded-lg`, `rounded-xl` are banned)
- **NO emojis** in enterprise pages
- **NO shadow-sm** — use `shadow-2xl` only for modals
- **Edge-to-edge** tables and KPI strips with `-mx-3 md:-mx-6`
- **Vertical gridlines** in tables: `border-r border-slate-100` on cells, `border-r border-slate-700` on headers
- **Row striping**: `even:bg-slate-50/70`
- **Group headers** in tables: `bg-slate-200 border-b border-slate-300` with `text-[10px] font-bold uppercase tracking-widest`

---

## Architecture

### Backend (backend/src/)
```
backend/src/
├── app.ts                    # Express app: middleware + route registration
├── server.ts                 # HTTP server start
├── config/
│   ├── index.ts              # Environment config (JWT secret, port, etc.)
│   └── prisma.ts             # Prisma client instance
├── middleware/
│   ├── auth.ts               # JWT auth + AuthRequest interface
│   └── authorize.ts          # Module-level authorization
├── routes/                   # 52 route files
├── services/
│   ├── whatsappBaileys.ts    # WhatsApp connection (Baileys QR auth, send/receive)
│   ├── whatsappAutoCollect.ts # Auto-collect engine (scheduler, sessions, prompts)
│   ├── autoCollectModules/   # Module-specific bots (ddgsProduction, decanter, _template)
│   ├── eInvoice.ts           # IRN generation via Saral GSP
│   ├── ewayBill.ts           # E-way bill generation
│   └── messaging.ts          # WhatsApp/SMS notifications
├── utils/
│   ├── letterhead.ts         # PDF letterhead helper
│   └── pdfGenerator.ts       # PDF generation (POs, challans, invoices)
├── shared/                   # Enterprise infrastructure
│   ├── errors/               # AppError, NotFoundError, ValidationError, etc.
│   ├── middleware/            # asyncHandler, errorHandler, validate (Zod)
│   └── config/               # company.ts (GSTIN, address), constants.ts (plant params)
└── data/
    └── calibrations.json     # Tank calibration data (84K entries, cached 24h)
```

### Frontend (frontend/src/)
```
frontend/src/
├── App.tsx                   # Routes (all React.lazy loaded with Suspense)
├── components/               # Layout, ErrorBoundary, Toast
├── config/                   # Module config, constants
├── context/                  # AuthContext (JWT in localStorage)
├── pages/
│   ├── process/              # Plant operations (grain → ethanol → DDGS)
│   ├── sales/                # Sales pipeline (orders → dispatch → shipments → invoices)
│   ├── procurement/          # Vendor management (POs → GRNs → invoices)
│   └── trade/                # Direct purchases/sales
├── services/                 # Axios API client with retry
└── types/                    # TypeScript interfaces
```

### Prisma Schema
- **61 models** in backend/prisma/schema.prisma
- Key domains: Grain, Fermentation, Distillation, DDGS, Sales, Procurement, Inventory
- All date/FK/status fields have @@index directives for query performance

---

## Critical Rules

### NEVER DO
- **Never hardcode** database URLs, passwords, or API keys — use env vars
- **Never use** `(req as any).user` — import `AuthRequest` from `../middleware/auth`
- **Never write** `catch (err: any) { res.status(500).json({ error: err.message }) }` — use `asyncHandler` from `../shared/middleware`
- **Never use** `parseFloat(req.body.field) || 0` without validation — use Zod `validate()` middleware
- **Never add** a route file without registering it in `app.ts`
- **Never add** a page without a lazy-loaded Route in `App.tsx`
- **Never commit** `console.log` — use structured logging
- **Never expose** raw error messages to clients (leaks DB schema)
- **Never use** `: any` type — define proper interfaces
- **Never write** `findMany()` without `take` limit (default 50, max 500)
- **Never write** `findMany()` for lists without `select` (don't fetch all columns)
- **Never use** any charting library except Recharts — no Chart.js, no D3, no custom SVG charts
- **Never create** charts without following `.claude/skills/charts-graphs.md` (OPC Live pattern)

### ALWAYS DO
- **Always use** `AuthRequest` type for authenticated route handlers
- **Always wrap** async handlers with `asyncHandler()` from `../shared/middleware`
- **Always validate** POST/PUT/PATCH input with Zod schemas via `validate()` middleware
- **Always add** `@@index` for new date, FK, or status fields in Prisma schema
- **Always use** `COMPANY` from `shared/config/company.ts` for GSTIN, address, bank
- **Always use** `PLANT` and `GST` from `shared/config/constants.ts` for magic numbers
- **Always type** function parameters and return types explicitly
- **Always add** `take` and `select` on `findMany` calls returning lists
- **Always use** `$transaction` for multi-step writes that must be atomic
- **Always follow** the chart design system in `.claude/skills/charts-graphs.md` for any graph/chart work — use OPC Live as reference

---

## Code Patterns

### New Backend Route (template)
```typescript
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
});

// GET list — always paginated, always select
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const items = await prisma.myModel.findMany({
    take, skip,
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, status: true, createdAt: true },
  });
  res.json(items);
}));

// POST — always validated
router.post('/', validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.myModel.create({ data: req.body });
  res.status(201).json(item);
}));

// GET by ID
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.myModel.findUnique({ where: { id: req.params.id } });
  if (!item) throw new NotFoundError('Item', req.params.id);
  res.json(item);
}));

export default router;
```

### New Frontend Page (template — SAP Tier 2 style)
```typescript
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface MyItem {
  id: string;
  name: string;
  status: string;
  amount: number;
  // ... type all fields
}

export default function MyPage() {
  const [data, setData] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<MyItem[]>('/my-endpoint');
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmtCurrency = (n: number) => n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Page Title</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Brief description</span>
          </div>
          <button className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New Item
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-3 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{data.length}</div>
          </div>
          {/* more KPI cards */}
        </div>

        {/* Data Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item, i) => (
                <tr key={item.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{item.name}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{item.status}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700">{fmtCurrency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

---

## Module Quick Reference

| Module | Backend Routes | Frontend Pages | Key Models |
|--------|---------------|----------------|------------|
| **Grain** | grain.ts, grainTruck.ts | GrainUnloading.tsx, GrainUnloadingTrucks.tsx, RawMaterial.tsx | GrainEntry, GrainTruck |
| **Fermentation** | fermentation.ts, preFermentation.ts, dosingRecipes.ts | Fermentation.tsx, PreFermentation.tsx, DosingRecipes.tsx | FermentationBatch, FermentationEntry, PFBatch, BeerWellReading |
| **Distillation** | distillation.ts | Distillation.tsx | DistillationEntry |
| **Ethanol Product** | ethanolProduct.ts, dispatch.ts, calibration.ts | EthanolProduct.tsx, EthanolDispatch.tsx | EthanolProductEntry, DispatchTruck |
| **DDGS** | ddgsStock.ts, ddgsDispatch.ts, ddgs.ts | DDGSStock.tsx, DDGSDispatch.tsx | DDGSStockEntry, DDGSDispatchTruck |
| **Milling/Liquefaction** | milling.ts, liquefaction.ts | Milling.tsx, Liquefaction.tsx | MillingEntry, LiquefactionEntry |
| **Evaporation/Dryer/Decanter** | evaporation.ts, dryer.ts, decanter.ts | Evaporation.tsx, DryerMonitor.tsx, Decanter.tsx | EvaporationEntry, DryerEntry, DecanterEntry |
| **Lab** | labSample.ts | LabSampling.tsx | LabSample |
| **Sales** | salesOrders.ts, customers.ts, invoices.ts, payments.ts, shipments.ts, dispatchRequests.ts, ethanolContracts.ts, freightInquiry.ts, transporters.ts, transporterPayments.ts, shipmentDocuments.ts | SalesOrders.tsx, Customers.tsx, Invoices.tsx, Payments.tsx, Shipments.tsx, DispatchRequests.tsx, EthanolContracts.tsx, FreightManagement.tsx, Transporters.tsx, SalesDashboard.tsx | SalesOrder, Customer, Invoice, Shipment, DispatchRequest, EthanolContract |
| **Procurement** | vendors.ts, materials.ts, purchaseOrders.ts, goodsReceipts.ts, vendorInvoices.ts, vendorPayments.ts, purchaseRequisition.ts | Vendors.tsx, Materials.tsx, PurchaseOrders.tsx, GoodsReceipts.tsx, VendorInvoices.tsx, VendorPayments.tsx, PurchaseRequisition.tsx | Vendor, Material, PurchaseOrder, GoodsReceipt, VendorInvoice |
| **Trade** | directPurchases.ts, directSales.ts | DirectPurchases.tsx, DirectSales.tsx | DirectPurchase, DirectSale |
| **Admin** | auth.ts, users.ts, settings.ts, documentTemplates.ts | Login.tsx, UsersPage.tsx, SettingsPage.tsx, DocumentTemplates.tsx | User, Settings, DocumentTemplate |
| **Analytics** | dashboard.ts, reports.ts | Dashboard.tsx, SalesDashboard.tsx, Reports.tsx | (aggregates from other models) |
| **Inventory** | inventory.ts | Inventory.tsx | InventoryItem, InventoryTransaction |
| **Plant Issues** | issues.ts | PlantIssues.tsx | PlantIssue, IssueComment |
| **Accounts** | accounts.ts | PaymentDashboard.tsx | Shipment (payment fields) |

## WhatsApp Integration by Module

| Module | Auto-Collect Bot | Report Sharing | Group? |
|--------|-----------------|----------------|--------|
| **Fermentation** | ✅ (planned) | ✅ Vessel readings shared from UI | Yes |
| **DDGS Production** | ✅ `ddgsProduction.ts` — hourly production data | ✅ Auto report after collection | Yes |
| **Decanter** | ✅ `decanter.ts` — dryer/decanter readings | ✅ Auto report after collection | Yes |
| **Distillation** | Planned | Manual share from UI | — |
| **Sales/Dispatch** | ❌ | ✅ Dispatch details shared | Private |
| **Accounts** | Planned (daily outstanding alerts) | ✅ Payment confirmations | Private |
| **Inventory** | Planned (low stock alerts) | ❌ | Private |

To add WhatsApp to a new module, see `autoCollectModules/_template.ts`.

## Module Skills

For detailed guidance on specific modules, see `.claude/skills/`:
- `process-production.md` — Full grain-to-ethanol-to-DDGS pipeline (grain, milling, liquefaction, fermentation, distillation, evaporation, decanter, dryer, DDGS, daily entries)
- `process-grain.md` — Grain intake detail: mass balance, truck weighing, silo tracking
- `process-fermentation.md` — Fermentation detail: batch phases, lab readings, dosing
- `process-distillation.md` — Distillation detail: ethanol product, tank calibration, dispatch
- `sales-module.md` — Order-to-cash, e-invoice, e-way bill, dispatch workflow
- `procurement-module.md` — Procure-to-pay, PO lifecycle, GRN
- `accounts-module.md` — Payment desk, receivables, collections, payment flow, future costing
- `accounts-full-module.md` — Full double-entry bookkeeping spec (Chart of Accounts, Journals, Ledger, P&L, Balance Sheet, Bank Recon, GST)
- `session-state.md` — Current session state, uncommitted changes, known issues, next steps
- `dashboard-analytics.md` — Dashboard performance, KPI calculations
- `admin-settings.md` — Auth, users, settings, audit trail
- `charts-graphs.md` — Standard chart design system (OPC Live pattern) — colors, axes, tooltips, containers, Brush, reference lines. ALL charts must follow this.
- `ubi-h2h-banking.md` — **CRITICAL** — UBI H2H-STP direct bank payment integration. Full spec: SFTP, AES-256-GCM encryption, Maker-Checker-Releaser security, data models, routes, file format. Bank side LIVE, ERP side pending SFTP credentials.

---

## Codex Integration (GPT-5.4 Second Opinion)

Codex CLI (OpenAI, GPT-5.4) is installed and authenticated in this workspace. Use it as a **second-opinion reviewer and deep auditor** for complex work:

- **`/codex:rescue`** — Primary skill. Delegates investigation, diagnosis, fix requests, or code review to Codex. Use for:
  - **Deep code audit**: Edge cases, race conditions, security holes, off-by-one errors
  - **Second opinion**: When stuck or want independent validation of complex logic
  - **Root-cause diagnosis**: Hard-to-reproduce bugs, multi-file interaction issues
  - **Test coverage gaps**: Have Codex identify what tests are missing
- **When to use**: Complex features, multi-file refactors, tricky business logic, payment/financial code, or anything where a second set of eyes adds value
- **Not for**: Simple one-file edits, typo fixes, or routine CRUD

## Pre-Push Checklist
1. `cd backend && npx tsc --noEmit` — Backend compiles
2. `cd frontend && npx vite build` — Frontend builds
3. `cd backend && npx prisma validate` — Schema valid
4. No `any` types in new/changed code
5. No `console.log` in new/changed code
6. All new routes use `asyncHandler` + `validate`
7. All new `findMany` have `take` + `select`
8. All new Prisma fields have `@@index` where appropriate
9. Test the feature manually in browser
