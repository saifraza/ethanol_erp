# Fuel Module and PO Pipeline Audit

Date: 2026-04-01

Scope:
- Fuel master, daily consumption, running fuel deals, and deal payments
- Purchase orders, GRNs, and inventory side effects
- End-to-end API execution against an isolated local Postgres database and scratch backend

Test environment:
- Scratch Postgres: `localhost:55432/distillery_e2e`
- Scratch backend: `localhost:55100`
- Auth: seeded admin `admin@distillery.com`
- Production data was not touched

## Executive Summary

The audit reproduced multiple high-severity failures in the live backend flow:

1. Editing a DRAFT PO crashes due to a legacy foreign-key write.
2. GRNs accept impossible quantities and can drive PO pending quantity negative.
3. DRAFT GRNs move stock before confirmation.
4. Deleting a DRAFT GRN after downstream consumption can erase the receipt and clamp stock, leaving an impossible ledger state.
5. Fuel deal balances cross-match across PO-number prefixes.
6. Fuel consumption does not update actual item stock.
7. Fuel deal dashboards undercount trucks after five GRNs.
8. Fixed fuel deals entered in trucks are stored as metric tons.

## Reproduced Findings

### P1: Editing a DRAFT PO crashes

What was tested:
- Create a DRAFT PO with one inventory-backed raw-material line
- Attempt to update the same PO through `PUT /api/purchase-orders/:id`

Observed result:
- The update returned HTTP 500
- Server error: Prisma `P2003`
- Constraint: `POLine_materialId_fkey`

Evidence:
- New PO create succeeded
- Edit failed in `backend/src/routes/purchaseOrders.ts` when rebuilding lines
- Original saved line had `materialId = null`
- Update path attempted to write `materialId = inventoryItemId`

Code reference:
- `backend/src/routes/purchaseOrders.ts:320-321`

Impact:
- Draft procurement orders are not reliably editable
- Users can lose work or get blocked mid-procurement

### P1: GRNs accept impossible quantities

What was tested:
- Create a PO line for quantity `5`
- Approve and send the PO
- Create a GRN with `receivedQty = 5` and `acceptedQty = 8`

Observed database state:
- GRN status: `DRAFT`
- GRN line: `receivedQty = 5`, `acceptedQty = 8`, `rejectedQty = 0`
- PO line: `quantity = 5`, `receivedQty = 8`, `pendingQty = -3`

Code reference:
- `backend/src/routes/goodsReceipts.ts:325-349`
- `backend/src/routes/goodsReceipts.ts:383-399`

Impact:
- Procurement status becomes mathematically invalid
- Inventory and procurement diverge immediately

### P1: DRAFT GRNs move stock before confirmation

What was tested:
- Create a fresh GRN and inspect stock side effects before confirming it

Observed database state:
- GRN status remained `DRAFT`
- `StockMovement` rows for the GRN already existed
- Item `currentStock` was incremented immediately

Observed values in the bad-GRN scenario:
- Receipt movements created while still draft: `1`
- Raw item stock after draft GRN: `8`

Code reference:
- `backend/src/routes/goodsReceipts.ts:374-440`

Impact:
- Unconfirmed receipts alter stock
- Subsequent inventory actions can happen on top of unapproved data

### P1: Deleting a DRAFT GRN after consumption leaves an impossible ledger

What was tested:
- Create a DRAFT GRN that already posted stock
- Consume stock via `/api/inventory/transaction`
- Delete the same DRAFT GRN

Observed database state after delete:
- GRN row removed
- GRN receipt stock movements removed
- Inventory transaction for downstream consumption still present: `1`
- Item stock clamped to `0`

Observed values:
- Before delete: raw item `currentStock = 8`
- After separate OUT transaction of `7`, deleting the GRN succeeded
- After delete: raw item `currentStock = 0`

Code reference:
- `backend/src/routes/goodsReceipts.ts:499-545`

Impact:
- Receipt history can be erased after dependent activity already occurred
- The ledger no longer explains how stock reached its final number

### P1: Fuel deal payments cross-match across PO-number prefixes

What was tested:
- Create 10 open fuel deals so that both `PO-1` and `PO-10` exist
- Post a direct payment of `500` against `PO-10`
- Reload `/api/fuel/deals`

Observed result:
- `PO-10` showed `totalPaid = 500`
- `PO-1` also showed `totalPaid = 500`

Code reference:
- `backend/src/routes/fuel.ts:360-378`
- `backend/src/routes/fuel.ts:599-604`

Root cause:
- Payment lookup uses `remarks contains PO-${poNo}`

Impact:
- Deal balances become wrong once PO numbers share prefixes
- Payment history is unreliable for traders with multiple deals

### P1: Fuel consumption sheet does not update item stock

What was tested:
- Save daily fuel consumption with `consumed = 2`
- Compare `FuelConsumption` row vs fuel master item stock

Observed result:
- `FuelConsumption.closingStock = 4`
- `InventoryItem.currentStock = 6`

Observed row:
- Fuel item: `E2E Boiler Fuel`
- `consumed = 2`
- `received = 0`
- `closingStock = 4`
- `currentStock = 6`

Code reference:
- `backend/src/routes/fuel.ts:236-258`
- `backend/src/routes/fuel.ts:278-301`

Impact:
- Daily operations and master stock report different truths
- Low-stock signals can be stale or false

### P2: Fuel deal dashboard undercounts trucks after five GRNs

What was tested:
- Create 6 GRNs against open fuel deal `PO-1`
- Reload `/api/fuel/deals`

Observed result:
- `totalReceived = 6`
- `truckCount = 5`

Code reference:
- `backend/src/routes/fuel.ts:346-350`
- `backend/src/routes/fuel.ts:380-387`

Impact:
- Running deals underreport logistics activity
- Any invoice/payment aggregation scoped to those GRNs will also be incomplete

### P2: Fixed fuel deals entered in trucks are stored as MT

What was tested:
- Create a fixed fuel deal with:
  - `quantityType = FIXED`
  - `quantityUnit = TRUCKS`
  - `quantity = 3`

Observed database state:
- Saved PO line `quantity = 3`
- Saved PO line `pendingQty = 3`
- Saved unit: `MT`

Code reference:
- `backend/src/routes/fuel.ts:440-475`

Impact:
- Truck-count commercial deals are persisted as tonnage
- Receipts and closures can become semantically wrong

## Static Risks Still Worth Fixing

These were identified in review but were not the focus of the executed scenarios:

1. GRN delete reverses `StockLevel` by `itemId` only and can hit the wrong warehouse.
   - `backend/src/routes/goodsReceipts.ts:535-538`

2. Fuel deal edit UI exposes fields that the backend does not really persist.
   - Frontend: `frontend/src/pages/process/FuelManagement.tsx:733-823`
   - Backend: `backend/src/routes/fuel.ts:499-516`

3. Fuel UI can show a `Pay` action even though direct payment API only accepts `OPEN` deals.
   - Frontend: `frontend/src/pages/process/FuelManagement.tsx:541`
   - Backend: `backend/src/routes/fuel.ts:567-573`

4. PO vendor auto-fill is shape-mismatched, and place-of-supply values mix `'23'` with `'23-MP'`.
   - Frontend: `frontend/src/pages/procurement/PurchaseOrders.tsx:188-205`
   - Frontend options: `frontend/src/pages/procurement/PurchaseOrders.tsx:75-90`
   - Backend vendor payload: `backend/src/routes/vendors.ts:73-95`

## Recommended Fix Order

1. Fix the DRAFT PO edit path by keeping `materialId` null for inventory-backed lines.
2. Enforce GRN invariants server-side:
   - `acceptedQty <= receivedQty`
   - `acceptedQty <= pendingQty`
   - `receivedQty >= 0`
   - reject any line that would push `pendingQty < 0`
3. Move stock posting from GRN create to GRN confirm, or block delete once dependent activity exists.
4. Replace fuel deal payment matching with an explicit foreign key or dedicated reference field.
5. Decide a single source of truth for fuel stock:
   - either post actual inventory movements from the daily sheet
   - or derive master stock from fuel movements/receipts consistently
6. Stop truncating deal GRNs when computing truck count and payment totals.
7. Model truck-based fuel deals explicitly instead of storing them in MT fields.

## Stored Evidence Snapshot

Fuel checks reproduced:
- `PO-1`: `truckCount = 5`, `totalReceived = 6`, `totalPaid = 500`
- `PO-10`: `totalPaid = 500`
- Fuel master current stock after consuming 2 units: `6`
- Fixed truck deal saved as: `quantity = 3`, `unit = MT`

Invalid GRN reproduced:
- PO line quantity: `5`
- GRN accepted quantity: `8`
- Resulting pending quantity: `-3`
- GRN was still `DRAFT` while inventory effects already existed

Draft-delete-after-consumption reproduced:
- Downstream inventory transaction remained
- GRN and receipt movements were removed
- Item stock was clamped to `0`

