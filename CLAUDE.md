# MSPIL Distillery ERP — Claude Code Guide

## Project Overview
- **Company**: Mahakaushal Sugar & Power Industries Ltd (MSPIL)
- **System**: Distillery ERP for ethanol plant at Village Bachai, Dist. Narsinghpur, MP
- **Stack**: Express + TypeScript + Prisma ORM (backend), React + Vite + Tailwind CSS (frontend), PostgreSQL on Railway
- **Production URL**: https://web-production-d305.up.railway.app/
- **Login**: admin@distillery.com / admin123

## Deployment — Railway
- **Auto-deploys** from GitHub `main` branch of `ethanol_erp` repo
- **DB**: Set via `DATABASE_URL` env var on Railway (never hardcode)
- Root build: `cd backend && npm ci && prisma generate && tsc --outDir dist && cp -r src/data dist/ && cd ../frontend && npm ci && vite build`
- Procfile: `web: cd backend && npx prisma db push --skip-generate && node dist/server.js`
- Frontend vite outputs to `../backend/public` (not `frontend/dist/`)
- Any new static data files (like `calibrations.json`) must be copied in the ROOT build script

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

### New Frontend Page (template)
```typescript
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface MyItem {
  id: string;
  name: string;
  // ... type all fields
}

export default function MyPage() {
  const [data, setData] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<MyItem[]>('/api/my-endpoint');
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Page Title</h1>
      {/* Content */}
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

## Module Skills

For detailed guidance on specific modules, see `.claude/skills/`:
- `process-production.md` — Full grain-to-ethanol-to-DDGS pipeline (grain, milling, liquefaction, fermentation, distillation, evaporation, decanter, dryer, DDGS, daily entries)
- `process-grain.md` — Grain intake detail: mass balance, truck weighing, silo tracking
- `process-fermentation.md` — Fermentation detail: batch phases, lab readings, dosing
- `process-distillation.md` — Distillation detail: ethanol product, tank calibration, dispatch
- `sales-module.md` — Order-to-cash, e-invoice, e-way bill, dispatch workflow
- `procurement-module.md` — Procure-to-pay, PO lifecycle, GRN
- `accounts-module.md` — Payment desk, receivables, collections, payment flow, future costing
- `dashboard-analytics.md` — Dashboard performance, KPI calculations
- `admin-settings.md` — Auth, users, settings, audit trail

---

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
