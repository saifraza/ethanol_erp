# Inventory Module — SAP-Style Full Spec

## Overview
Comprehensive stores/inventory management for MSPIL distillery. Replaces the basic InventoryItem/InventoryTransaction system with SAP MM-level inventory control including batch tracking, multi-warehouse bins, weighted-average costing, GRN integration, cycle counts, ABC analysis, and WhatsApp low-stock alerts.

## Design Decisions

### Relationship to Existing Models
- **InventoryItem** + **InventoryTransaction**: KEPT as-is (existing data). New routes add SAP features on top.
- **Material** (procurement): Already has HSN, GST, categories. Inventory module reads Material for procurement-linked items.
- **GoodsReceipt / GRNLine**: Integration point — GRN confirmation triggers stock IN movement with batch/lot.
- **Account** (accounts module): Stock valuation changes generate journal entries (future Phase 2).

### New Prisma Models

```prisma
// ── Warehouse / Storage Location ──
model Warehouse {
  id          String   @id @default(cuid())
  code        String   @unique  // MAIN, CHEM, SPARE, YARD
  name        String
  address     String?
  isActive    Boolean  @default(true)
  bins        StorageBin[]
  stockLevels StockLevel[]
  movements   StockMovement[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// ── Bin / Rack Location within Warehouse ──
model StorageBin {
  id          String   @id @default(cuid())
  warehouseId String
  warehouse   Warehouse @relation(fields: [warehouseId], references: [id])
  code        String   // A-01-01 (Aisle-Rack-Shelf)
  name        String?
  capacity    Float?   // max capacity in base UOM
  isActive    Boolean  @default(true)
  stockLevels StockLevel[]
  createdAt   DateTime @default(now())
  @@unique([warehouseId, code])
  @@index([warehouseId])
}

// ── Batch / Lot Tracking ──
model Batch {
  id          String    @id @default(cuid())
  itemId      String
  item        InventoryItem @relation(fields: [itemId], references: [id])
  batchNo     String
  mfgDate     DateTime?
  expiryDate  DateTime?
  supplier    String?
  grnId       String?   // link to GoodsReceipt
  costRate    Float     @default(0)  // per-unit cost for this batch
  status      String    @default("AVAILABLE") // AVAILABLE, QUARANTINE, EXPIRED, CONSUMED
  remarks     String?
  createdAt   DateTime  @default(now())
  stockLevels StockLevel[]
  movements   StockMovement[]
  @@unique([itemId, batchNo])
  @@index([itemId])
  @@index([expiryDate])
  @@index([status])
}

// ── Stock Level (item × warehouse × bin × batch) ──
model StockLevel {
  id          String     @id @default(cuid())
  itemId      String
  item        InventoryItem @relation(fields: [itemId], references: [id])
  warehouseId String
  warehouse   Warehouse  @relation(fields: [warehouseId], references: [id])
  binId       String?
  bin         StorageBin? @relation(fields: [binId], references: [id])
  batchId     String?
  batch       Batch?     @relation(fields: [batchId], references: [id])
  quantity    Float      @default(0)
  reservedQty Float      @default(0)  // reserved for production/dispatch
  updatedAt   DateTime   @updatedAt
  @@unique([itemId, warehouseId, binId, batchId])
  @@index([itemId])
  @@index([warehouseId])
  @@index([batchId])
}

// ── Stock Movement (every IN/OUT/TRANSFER/ADJUST) ──
model StockMovement {
  id            String   @id @default(cuid())
  movementNo    Int      @default(autoincrement()) @unique
  itemId        String
  item          InventoryItem @relation(fields: [itemId], references: [id])
  movementType  String   // GRN_RECEIPT, PRODUCTION_ISSUE, PRODUCTION_RECEIPT, SALES_ISSUE, TRANSFER, ADJUSTMENT, RETURN, SCRAP
  direction     String   // IN, OUT
  quantity      Float
  unit          String
  costRate      Float    @default(0)
  totalValue    Float    @default(0)
  // Source/destination
  warehouseId   String
  warehouse     Warehouse @relation(fields: [warehouseId], references: [id])
  binId         String?
  batchId       String?
  batch         Batch?   @relation(fields: [batchId], references: [id])
  // Transfer fields
  toWarehouseId String?
  toBinId       String?
  // Reference
  refType       String?  // GRN, PO, SALES_ORDER, PRODUCTION_ORDER, MANUAL
  refId         String?
  refNo         String?  // human-readable ref number
  // Audit
  narration     String?
  userId        String
  date          DateTime @default(now())
  createdAt     DateTime @default(now())
  @@index([itemId, date])
  @@index([warehouseId])
  @@index([movementType])
  @@index([refType, refId])
  @@index([date])
}

// ── Stock Count / Physical Inventory ──
model StockCount {
  id          String   @id @default(cuid())
  countNo     Int      @default(autoincrement()) @unique
  warehouseId String
  countDate   DateTime
  status      String   @default("DRAFT") // DRAFT, IN_PROGRESS, COMPLETED, APPROVED
  countType   String   @default("FULL")  // FULL, CYCLE, SPOT
  remarks     String?
  lines       StockCountLine[]
  userId      String
  approvedBy  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([warehouseId])
  @@index([status])
}

model StockCountLine {
  id           String     @id @default(cuid())
  countId      String
  count        StockCount @relation(fields: [countId], references: [id], onDelete: Cascade)
  itemId       String
  batchId      String?
  binId        String?
  systemQty    Float      // what system says
  physicalQty  Float?     // what counter found (null = not yet counted)
  variance     Float?     // physical - system
  variancePct  Float?
  adjustmentDone Boolean  @default(false)
  remarks      String?
  @@index([countId])
  @@index([itemId])
}

// ── Reorder Rule ──
model ReorderRule {
  id           String   @id @default(cuid())
  itemId       String   @unique
  item         InventoryItem @relation(fields: [itemId], references: [id])
  reorderPoint Float    // trigger qty
  reorderQty   Float    // how much to order
  maxStock     Float?
  safetyStock  Float    @default(0)
  leadTimeDays Int      @default(7)
  autoCreate   Boolean  @default(false) // auto-create purchase requisition
  isActive     Boolean  @default(true)
  lastTriggered DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([itemId])
}
```

### Changes to Existing InventoryItem Model
Add these fields to InventoryItem:
```prisma
  hsnCode       String?
  gstPercent    Float    @default(18)
  valuationMethod String @default("WEIGHTED_AVG") // WEIGHTED_AVG, FIFO, STANDARD
  avgCost       Float    @default(0)  // weighted average cost
  totalValue    Float    @default(0)  // currentStock × avgCost
  // Relations to new models
  batches       Batch[]
  stockLevels   StockLevel[]
  stockMovements StockMovement[]
  reorderRule   ReorderRule?
```

## Backend Routes

### 1. `/api/inventory/warehouses` — Warehouse CRUD
- GET `/` — list warehouses with bin counts and stock summary
- GET `/:id` — warehouse detail with bins and top items
- POST `/` — create warehouse
- PUT `/:id` — update
- POST `/:id/bins` — add bin to warehouse
- PUT `/bins/:binId` — update bin

### 2. `/api/inventory/stock` — Stock Queries
- GET `/levels` — stock levels grouped by item (with warehouse/bin/batch breakdown)
- GET `/levels/:itemId` — single item stock across warehouses
- GET `/valuation` — stock valuation report (item-wise value at WA cost)
- GET `/aging` — batch aging report (days to expiry)
- GET `/abc-analysis` — ABC classification by annual consumption value

### 3. `/api/inventory/movements` — Stock Movements
- GET `/` — paginated movement history with filters (item, warehouse, type, date)
- GET `/ledger/:itemId` — stock ledger for an item (running qty + value)
- POST `/receipt` — goods receipt (from GRN or manual)
- POST `/issue` — goods issue (to production, sales, maintenance)
- POST `/transfer` — stock transfer between warehouses/bins
- POST `/adjust` — stock adjustment with reason
- POST `/return` — return to supplier or from production

### 4. `/api/inventory/counts` — Physical Inventory / Cycle Count
- GET `/` — list stock counts
- GET `/:id` — count detail with lines
- POST `/` — create stock count (auto-populates system qty)
- PUT `/:id/lines` — update physical qty for lines
- POST `/:id/approve` — approve and post adjustments
- GET `/schedule` — cycle count schedule (ABC-based frequency)

### 5. `/api/inventory/reorder` — Reorder Management
- GET `/rules` — all reorder rules with current status
- GET `/alerts` — items below reorder point
- POST `/rules` — create/update reorder rule
- POST `/trigger/:itemId` — manually trigger reorder (creates purchase requisition)

## Frontend Pages

### 1. `pages/inventory/StockDashboard.tsx` — Overview (replaces old Inventory.tsx)
- KPI cards: Total Items, Total Value, Low Stock Alerts, Pending Counts
- Category-wise value breakdown (pie chart)
- Top 10 items by value
- Recent movements ticker
- Low stock alerts with one-click reorder

### 2. `pages/inventory/MaterialMaster.tsx` — Item Master
- Full CRUD with HSN, GST, UOM, category, valuation method
- Stock summary per item (across warehouses)
- Batch list per item
- Movement history per item
- Reorder rule inline edit

### 3. `pages/inventory/Warehouses.tsx` — Warehouse & Bin Management
- Warehouse list with bin count, total items, total value
- Bin management (add/edit bins per warehouse)
- Bin-level stock view

### 4. `pages/inventory/StockMovements.tsx` — Movement Register
- Tabbed: All | Receipt | Issue | Transfer | Adjustment
- Date range, item, warehouse filters
- New movement form (type-dependent fields)
- Movement detail expansion

### 5. `pages/inventory/StockLedger.tsx` — Item-wise Stock Ledger
- Item selector with search
- Running balance (qty + value) like account ledger
- Warehouse filter
- Batch filter

### 6. `pages/inventory/StockCount.tsx` — Physical Inventory
- Create count (select warehouse, count type)
- Count entry form (system qty shown, enter physical qty)
- Variance highlighting (>5% in red)
- Approve → auto-posts adjustment movements

### 7. `pages/inventory/StockValuation.tsx` — Valuation Report
- Item-wise stock value at weighted average cost
- Category grouping
- Total inventory value
- Export-ready format

### 8. `pages/inventory/ABCAnalysis.tsx` — ABC Classification
- Items ranked by annual consumption value
- A (top 80%), B (next 15%), C (bottom 5%)
- Visual breakdown chart
- Cycle count frequency recommendations

## Navigation (modules.ts)
New group: `'inventory'` (separate from admin)
Items:
- Stock Dashboard → /inventory/dashboard
- Item Master → /inventory/items
- Warehouses → /inventory/warehouses
- Goods Movement → /inventory/movements
- Stock Ledger → /inventory/ledger
- Stock Count → /inventory/counts
- Valuation → /inventory/valuation
- ABC Analysis → /inventory/abc

## Integration Points

### With Procurement (GRN → Stock Receipt)
When GoodsReceipt is confirmed:
- Auto-create StockMovement (GRN_RECEIPT, IN)
- Create/update Batch with GRN batchNo, supplier, expiryDate
- Update StockLevel for item × warehouse
- Update InventoryItem.currentStock and avgCost (weighted average recalc)

### With Sales (Dispatch → Stock Issue)
When shipment is dispatched:
- Auto-create StockMovement (SALES_ISSUE, OUT)
- Reduce StockLevel
- FIFO batch consumption for batch-tracked items

### With Production (Grain → Ethanol/DDGS)
When production entries are logged:
- Raw material consumption → StockMovement (PRODUCTION_ISSUE, OUT)
- Finished goods → StockMovement (PRODUCTION_RECEIPT, IN)

### With Accounts (Stock Value → Journal)
Phase 2: Stock movements generate journal entries
- Receipt: Dr Inventory, Cr AP/GRN Clearing
- Issue: Dr COGS/WIP, Cr Inventory
- Adjustment: Dr/Cr Inventory, Cr/Dr Inventory Adjustment

### WhatsApp Integration
- Daily low-stock alert to procurement group
- Weekly stock valuation summary to management
- Batch expiry warnings (7 days before)

## Weighted Average Cost Calculation
On every receipt:
```
newAvgCost = (existingQty × existingAvgCost + receivedQty × receiptRate) / (existingQty + receivedQty)
```
On issue: cost = avgCost at time of issue (no recalc needed)

## Build Order
1. Prisma schema changes (add fields to InventoryItem, add new models)
2. Backend routes: warehouses → stock movements → stock queries → counts → reorder
3. Frontend pages: StockDashboard → MaterialMaster → Warehouses → StockMovements → StockLedger → StockCount → StockValuation → ABCAnalysis
4. Navigation updates (modules.ts, App.tsx)
5. Integration hooks (GRN → stock receipt) — Phase 2
