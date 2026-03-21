# Distillery ERP - MSPIL Ethanol Plant

## Architecture
- **Backend**: Express + TypeScript + Prisma ORM + PostgreSQL (`backend/`)
- **Frontend**: React + Vite + Tailwind CSS + Recharts (`frontend/`)
- **Monorepo**: Root `package.json` orchestrates builds for Railway

## Deployment — Railway
- **URL**: https://web-production-d305.up.railway.app/
- **DB**: `postgresql://postgres:DrENyRNbBLtcdBMKzgIbIhHSMDiiXvBu@shuttle.proxy.rlwy.net:15470/railway`
- **Auto-deploys** from GitHub `main` branch
- **GitHub**: https://github.com/saifraza/ethanol_erp.git
- **Admin userId on Railway**: `cmmipu76p0000hvsh1h2a21y0` (name: "Admin")
- **Login**: `admin@distillery.com` / `admin123`

## CRITICAL: Build & Deploy Notes
1. **Railway uses ROOT `package.json`** for build, NOT `backend/package.json`
2. Root build: `cd backend && npm install && prisma generate && tsc --outDir dist && cp -r src/data dist/ && cd ../frontend && npm install && vite build`
3. **Any new static data files** (like `calibrations.json`) must be copied in the ROOT build script
4. Procfile: `web: cd backend && npx prisma db push --skip-generate && node dist/server.js`
5. Frontend vite outputs to `../backend/public` (not `frontend/dist/`)
6. **Cannot push from VM** — user must run `git push origin main` from their Mac terminal

## Databases
- **Production (Railway)**: `postgresql://postgres:DrENyRNbBLtcdBMKzgIbIhHSMDiiXvBu@shuttle.proxy.rlwy.net:15470/railway`
  - Query from VM using `pg` (Node.js) or `psycopg2` (Python)
  - Seeding: `const { Client } = require('pg'); const c = new Client({ connectionString: '<DB_URL>' });`
- **Local**: `postgresql://saifraza@localhost:5432/distillery_erp` (Mac only, not reachable from VM)

## Local Development
- Backend: `cd backend && npm run dev` (tsx, port 5000)
- Frontend: `cd frontend && npm run dev` (vite, port 3000, proxies /api → 5000)
- Schema changes: `npx prisma db push`

## Module Map

### Process (Plant Operations)
| Route | Page | Backend Route | Key Models |
|-------|------|---------------|------------|
| process/raw-material | RawMaterial | rawMaterial.ts | RawMaterialEntry |
| process/grain-stock | GrainUnloading | grain.ts | GrainEntry |
| process/grain-unloading | GrainUnloadingTrucks | grainTruck.ts | GrainTruck |
| process/milling | Milling | milling.ts | MillingEntry |
| process/liquefaction | Liquefaction | liquefaction.ts | LiquefactionEntry |
| process/fermentation | Fermentation | fermentation.ts | FermentationEntry, FermentationBatch, PFBatch, FermDosing, FermChemical, PFDosing, PFChemical, PFLabReading, BeerWellReading |
| process/distillation | Distillation | distillation.ts | DistillationEntry |
| process/evaporation | Evaporation | evaporation.ts | EvaporationEntry |
| process/dryer | DryerMonitor | dryer.ts | DryerEntry |
| process/decanter | Decanter | decanter.ts | DecanterEntry |
| process/ethanol-product | EthanolProduct | ethanolProduct.ts | EthanolProductEntry |
| process/ethanol-dispatch | EthanolDispatch | dispatch.ts | DispatchTruck |
| process/ddgs-stock | DDGSStock | ddgsStock.ts | DDGSStockEntry, DDGSProductionEntry |
| process/ddgs-dispatch | DDGSDispatch | ddgsDispatch.ts | DDGSDispatchTruck |
| process/water-utility | WaterUtility | — | — |
| process/lab-sampling | LabSampling | labSample.ts | LabSample |
| process/dosing-recipes | DosingRecipes | dosingRecipes.ts | DosingRecipe |

### Sales
| Route | Page | Backend Route | Key Models |
|-------|------|---------------|------------|
| sales/customers | Customers | customers.ts | Customer |
| sales/pipeline | SalesDashboard | salesOrders.ts | SalesOrder, SalesOrderLine |
| sales/dispatch-requests | DispatchRequests | dispatchRequests.ts | DispatchRequest |
| sales/transporters | Transporters | transporters.ts | Transporter |
| sales/shipments | Shipments | shipments.ts | Shipment, ShipmentDocument |
| sales/invoices | Invoices | invoices.ts | Invoice |
| sales/payments | Payments | payments.ts | Payment |
| sales/freight | FreightManagement | freightInquiry.ts | FreightInquiry, FreightQuotation |

### Procurement
| Route | Page | Backend Route | Key Models |
|-------|------|---------------|------------|
| procurement/vendors | Vendors | vendors.ts | Vendor |
| procurement/materials | Materials | materials.ts | Material |
| procurement/purchase-orders | PurchaseOrders | purchaseOrders.ts | PurchaseOrder, POLine |
| procurement/goods-receipts | GoodsReceipts | goodsReceipts.ts | GoodsReceipt, GRNLine |
| procurement/vendor-invoices | VendorInvoices | vendorInvoices.ts | VendorInvoice |
| procurement/vendor-payments | VendorPayments | vendorPayments.ts | VendorPayment |

### Trade
| Route | Page | Backend Route | Key Models |
|-------|------|---------------|------------|
| trade/purchases | DirectPurchases | directPurchases.ts | DirectPurchase |
| trade/sales | DirectSales | directSales.ts | DirectSale |

### Other
| Route | Page | Backend Route | Key Models |
|-------|------|---------------|------------|
| dashboard | Dashboard | dashboard.ts | — |
| inventory | Inventory | inventory.ts | InventoryItem, InventoryTransaction |
| plant-issues | PlantIssues | issues.ts | PlantIssue, IssueComment |
| reports | Reports | reports.ts | — |
| settings | SettingsPage | settings.ts | Settings |
| document-templates | DocumentTemplates | documentTemplates.ts | DocumentTemplate |
| users | UsersPage | users.ts | User |

## Prisma Models (61 total)
AuditLog, BeerWellReading, Customer, DDGSDispatchTruck, DDGSProductionEntry, DDGSStockEntry, DailyEntry, DecanterEntry, DirectPurchase, DirectSale, DispatchRequest, DispatchTruck, DistillationEntry, DocumentTemplate, DosingRecipe, DryerEntry, EthanolProductEntry, EvaporationEntry, FermChemical, FermDosing, FermentationBatch, FermentationEntry, FreightInquiry, FreightQuotation, GRNLine, GoodsReceipt, GrainEntry, GrainTruck, InventoryItem, InventoryTransaction, Invoice, IssueComment, LabSample, LiquefactionEntry, Material, MillingEntry, PFBatch, PFChemical, PFDosing, PFLabReading, POLine, Payment, PlantIssue, PreFermentationEntry, Product, PurchaseOrder, PurchaseRequisition, RawMaterialEntry, SalesOrder, SalesOrderLine, Settings, Shipment, ShipmentDocument, TankDip, Transporter, TransporterPayment, User, Vendor, VendorInvoice, VendorPayment

## Key Business Logic

### Ethanol Stock & Production
- **EthanolProductEntry**: daily tank readings, stock, dispatch, production
- **Production/day**: `productionBL = currentTotalStock - prevTotalStock + totalDispatch`
- **Total Production**: SUM(productionBL) + opening stock (1,357,471 BL from 25-Feb-2026)
- **KLPD**: `(productionBL / hoursBetween) * 24 / 1000`
- Tank calibration: DIP (cm) → Volume (litres) via `calibrations.json` (84,470 entries, 7 tanks)

### Grain Stock — Mass Balance
- `grainConsumed = max(0, grainDistilled + deltaGrainInProcess + deltaFlour)`
- `grainDistilled` = washDiff × fermPct
- `deltaGrainInProcess` = current (fermVol×fermPct + pfVol×pfPct + iltFltVol×fermPct) − prev
- `deltaFlour` = current flour silo tonnage − prev flour silo tonnage
- Flour silos: 140 T each, level entered as %, stored as tonnage
- 9AM-9AM shift cycle (before 9AM → shift date = yesterday)

### Other Key Features
- JWT auth with `allowedModules` for module-level permissions
- Decanter grouped by dryer: D1-D3→Dryer1, D4-D5→Dryer2, D6-D8→Dryer3
- WhatsApp share for grain mass-balance breakdown
- Document templates for Invoice, Challan, PO PDFs
- Sales pipeline with document trail tracking

## File Structure Quick Reference
```
backend/
  prisma/schema.prisma    — 1634 lines, 61 models
  src/routes/             — 51 route files
  src/controllers/        — business logic
  src/data/calibrations.json — tank calibration data
frontend/
  src/pages/              — page components
  src/pages/process/      — 23 plant operation pages
  src/pages/procurement/  — 6 procurement pages
  src/pages/sales/        — 9 sales pages
  src/pages/trade/        — 2 trade pages
  src/components/         — shared components
  src/services/           — API client functions
```

