# Adding a New Product to the Weighbridge Pipeline

How to add a new product type (scrap, sugar, animal feed, molasses, CO2, fly ash, etc.) so it flows through the full pipeline: gate entry → weighbridge → factory server → cloud ERP → GRN/dispatch → inventory → invoice → payment.

This is the playbook to follow every time. Don't improvise — these systems are interconnected and skipping a step breaks something silently.

---

## TL;DR Decision Tree

**Is the product coming IN or going OUT?**

### INBOUND (you're buying it)
- Has a PO? → falls into `handlePoInbound` automatically. **Just add the InventoryItem with the right `category`.**
- Spot purchase from farmer/local seller? → `handleSpotInbound` automatically. **Just add the InventoryItem.**
- Trader (running monthly PO)? → `handleTraderInbound` automatically. **Mark vendor `isAgent=true`.**
- None of the above? → Ends up in `handleFallbackInbound` (just creates a GrainTruck record).

### OUTBOUND (you're selling/dispatching it)
- Is it ethanol? → `handleEthanolOutbound` (already exists)
- Is it anything else? → `handleNonEthanolOutbound` — currently a generic DDGS+Shipment handler. **You usually need a new dedicated handler for distinct outbound products** (see "When you need a new handler" below).

---

## Architecture Recap

```
Weighbridge PC (192.168.0.83)
   │ (serial port + Flask UI)
   ▼
Factory Server (192.168.0.10:5000)  ← LAN-first, offline-tolerant
   │ syncWorker.ts (every 10s)
   ▼
Cloud ERP (app.mspil.in)
   │ POST /api/weighbridge/push
   ▼
Dispatcher: backend/src/routes/weighbridge/push.ts
   │ detectHandler() → routes by direction + purchaseType + materialCategory
   ▼
Type-specific handler in handlers/
   │ creates GRN / DispatchTruck / DirectPurchase / etc.
   ▼
syncToInventory() → StockMovement + StockLevel + journal entry
```

**Key files**:
- `backend/src/routes/weighbridge/push.ts` — dispatcher
- `backend/src/routes/weighbridge/handlers/*.ts` — one file per type
- `backend/src/routes/weighbridge/shared.ts` — schema, types, utilities
- `factory-server/src/routes/weighbridge.ts` — factory `/wb-push` + material category tagging
- `factory-server/src/services/syncWorker.ts` — relays to cloud

---

## The Material Category System

The factory server tags every weighment with a `materialCategory` BEFORE pushing to cloud. The cloud uses this category to route to the right handler and apply correct business rules.

### Where categories come from
`factory-server/src/routes/weighbridge.ts:281-319` (in the gate-entry route):

```typescript
// 1. Keyword inference (fastest)
const FUEL_KEYWORDS = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'firewood', 'biomass'];
const RAW_MATERIAL_KEYWORDS = ['maize', 'corn', 'broken rice', 'grain', 'sorghum', 'milo'];
const CHEMICAL_KEYWORDS = ['amylase', 'urea', 'acid', 'antifoam', 'yeast', 'chemical'];

// 2. If no keyword match → look up cloud DB InventoryItem.category
// 3. If cloud unreachable → look up local cachedMaterial.category
```

### Adding a new category
1. **Define the category constant** in `factory-server/src/routes/weighbridge.ts`:
   ```typescript
   const SCRAP_KEYWORDS = ['scrap', 'metal', 'iron', 'rusty'];
   // ... in the inference block:
   else if (SCRAP_KEYWORDS.some(kw => lower.includes(kw))) {
     materialCategory = 'SCRAP';
   }
   ```
2. **Mark the InventoryItem with `category: 'SCRAP'`** in the cloud DB. This is the source of truth — keywords are just a fast path.
3. **Decide if it needs lab testing**:
   ```typescript
   const needsLab = isInbound && (materialCategory === 'RAW_MATERIAL' || materialCategory === 'FUEL');
   ```
   Add `'SCRAP'` to this list if scrap needs quality check at gate.

---

## Scenario 1: Adding a New OUTBOUND Product (e.g., Scrap Sales)

This is the most common case: factory has accumulated scrap metal, wants to sell it, needs to weigh it out the gate, generate a delivery challan, and create a sales invoice.

### Step 1: Decide on data model

**Question**: Does scrap need its own dispatch table, or can it reuse `Shipment`?

| If scrap is... | Use this approach |
|---------------|-------------------|
| Just a one-off product, low volume, no special workflow | **Reuse `Shipment`** (extend `handleNonEthanolOutbound`) |
| Has its own pricing rules, special documents (PESO, RST, etc.), or weekly volume | **Create a dedicated `ScrapDispatch` model + handler** |

For scrap, recommendation: **reuse Shipment** initially. Promote to dedicated handler if it grows.

### Step 2: Add InventoryItem(s)
```sql
INSERT INTO inventory_items (name, category, unit, gst_percent, hsn_code, is_active)
VALUES ('Iron Scrap', 'SCRAP', 'KG', 18, '7204', true);
```
Or via the Inventory UI (`/inventory/items`).

### Step 3: Add a SCRAP keyword in factory server
See "Adding a new category" above.

### Step 4: Detection in dispatcher (`backend/src/routes/weighbridge/push.ts`)
Currently `handleNonEthanolOutbound` is the catch-all for all non-ethanol outbound. If scrap reuses Shipment, **no dispatcher change needed**.

If scrap needs its own handler, add detection BEFORE the catch-all:
```typescript
function detectHandler(w, ctx) {
  if (w.direction === 'OUT') {
    if (isEthanol) return handleEthanolOutbound;
    if (ctx.materialCategory === 'SCRAP') return handleScrapOutbound;  // ← NEW
    return handleNonEthanolOutbound;
  }
  // ... inbound
}
```

### Step 5: Create the handler (only if dedicated)
Copy `handlers/nonEthanolOutbound.ts` as a starting template:
```typescript
// backend/src/routes/weighbridge/handlers/scrapOutbound.ts
import { prisma, WeighmentInput, PushContext, PushOutcome, emptyOutcome } from '../shared';

export async function handleScrapOutbound(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();
  // ... your logic
  return out;
}
```

Import and use in `push.ts`:
```typescript
import { handleScrapOutbound } from './handlers/scrapOutbound';
```

### Step 6: Sales side — Customer + Sales Order + Invoice
Scrap sales need:
- A `Customer` record for the buyer (scrap dealer)
- A `SalesOrder` (or skip if it's spot sale — use direct invoice)
- An `Invoice` with the right HSN, GST, e-invoice, e-way bill
- Payment tracking via `Payments` module

**Reuse the existing sales pipeline** — don't build a parallel one. See `.claude/skills/sales-module.md`.

### Step 7: Inventory deduction
The handler must call `syncToInventory()` with `direction: 'OUT'` to decrement stock:
```typescript
await syncToInventory(
  'SHIPMENT', shipment.id, `SHIP-${shipment.id.slice(0,8)}`,
  inventoryItemId, qty, rate,
  'OUT', 'SALES_DISPATCH',
  `Scrap dispatch: ${w.vehicle_no}`,
  'system-weighbridge',
);
```

This auto-creates the journal entry too (debit COGS, credit Inventory).

### Step 8: Test the full flow
```
1. Create Customer (Scrap Dealer Pvt Ltd)
2. Create InventoryItem (Iron Scrap, category=SCRAP)
3. Create SalesOrder (or skip for spot)
4. Operator: Gate entry on factory server → vehicle in
5. Operator: Tare weighment (empty truck)
6. Loader: Loads scrap
7. Operator: Gross weighment (loaded truck)
8. Factory server pushes to cloud → handleScrapOutbound runs
9. Verify: Shipment created, inventory decremented, journal entry posted
10. Sales: Generate invoice, e-way bill, send to customer
11. Payment: Receive payment, mark invoice paid
```

---

## Scenario 2: Adding a New INBOUND Product (e.g., New RM type)

This is much simpler — just add the master data and let the existing handlers route it.

### Step 1: Add InventoryItem
```
name: Sorghum
category: RAW_MATERIAL  (or appropriate category)
unit: MT
hsn_code: 1007
gst_percent: 0
```

### Step 2: Add keyword to factory server (optional but faster)
```typescript
const RAW_MATERIAL_KEYWORDS = [..., 'sorghum', 'jowar'];
```

### Step 3: Create vendor / supplier
Procurement → Vendors → New Vendor

### Step 4: Create PO (or mark vendor as TRADER for running PO)
Procurement → Purchase Orders → New PO

### Step 5: Test
Truck arrives → gate entry picks the new material → weighment → cloud creates GRN automatically. **No code change needed if all 4 steps above are done correctly.**

---

## When You Need a NEW Handler (vs reusing existing)

Create a new handler if your product needs ANY of these:

| Trigger | Why |
|---------|-----|
| Custom document generation (PESO, RST, special challan) | New fields on dispatch table |
| Different inventory tracking (batch, serial, quality grade) | Different StockMovement rules |
| Different GST/tax treatment | Custom rate calculation |
| Different approval workflow | Different status state machine |
| Large volume (>100 trucks/day) | Performance isolation |
| Different invoice generation | Different e-invoice/e-way bill flow |

**If none of these apply**, reuse `handleNonEthanolOutbound` (outbound) or one of the inbound handlers. Don't create handlers just for organization — that's just file noise.

---

## Handler Contract (the Rules)

Every handler MUST follow this signature:
```typescript
async function handleXxx(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome>
```

And MUST:

1. **Return a `PushOutcome`** with `ids[]` and `results[]` populated
   - `ids`: entity IDs created (used by syncWorker for ack)
   - `results`: `{ id, type, refNo, sourceWbId }` per entity
   - `sourceWbId` MUST equal `w.id` (used for per-item sync ack)

2. **Use transactions** for multi-table writes
   ```typescript
   await prisma.$transaction(async (tx) => { /* ... */ })
   ```

3. **Use `WB:${w.id}` in remarks** for dedup
   ```typescript
   remarks: `${ctx.wbRef} | ...`  // wbRef already contains "WB:{id} | Ticket #{n} | {source}"
   ```

4. **Handle idempotency** — same weighment may be pushed twice (network retry, concurrent workers)
   - Inbound: dedup is handled by `checkWbDuplicate()` in dispatcher
   - Outbound: **schema-level uniqueness is MANDATORY.** Every table keyed off a weighment must have `sourceWbId String? @unique` in `schema.prisma`. Without it, `findFirst→create` is a race: two concurrent pushes both miss the find and both insert. Seen in the wild: DDGS audit 2026-04 — missing unique constraint would have created duplicate trucks, duplicate invoices, and double-counted contract totals in production.
   - **Use `prisma.upsert({ where: { sourceWbId: w.id } })` instead of `findFirst→create`.** Upsert is atomic at the DB level; find-then-create is not, even inside a `$transaction`.
   - **Never trust `findFirst` inside a tx for dedup** — Prisma transactions are `READ COMMITTED` by default, not `SERIALIZABLE`. Two tx can both see "no existing row" and both insert.

5. **Use atomic increment/decrement** for counters
   ```typescript
   // GOOD
   data: { receivedQty: { increment: qty } }
   // BAD (race condition)
   data: { receivedQty: oldQty + qty }
   ```
   **And only increment ONCE per weighment.** If the handler can be re-entered (upsert path), gate the increment behind a "was this the first time we billed this truck?" check — use the truck's status transition (`GROSS_WEIGHED → BILLED`) as the guard, not the presence of `invoiceId` alone.

6. **Status guard — never overwrite terminal states.** Once a dispatch is `BILLED` or `RELEASED`, the handler must NOT rewrite weights, times, or amounts. Retries and late-arriving pushes must be no-ops. Pattern from `ethanolOutbound.ts`:
   ```typescript
   if (existing.status === 'RELEASED' || existing.status === 'BILLED') {
     return { skipped: false, id: existing.id }; // ACK, don't rewrite
   }
   ```
   Without this, a retry can desync the physical record from already-posted billing. **CRITICAL — see rule 6a: "skipped" means "don't write", NOT "don't ack".** Even when bailing on a terminal state, the handler MUST still push to `out.ids[]` so syncWorker stops retrying.

6a. **NEVER let a handler refuse to ack a weighment.** A handler that returns without pushing to `out.ids[]` causes the syncWorker to mark the weighment as failed with `"Not in cloud response (X/Y processed)"` and retry it forever. This is a silent failure mode — the operator sees nothing wrong on factory side, but the cloud record is frozen at gate-in. **Incident 2026-04-07**: ethanolOutbound used a compare-and-set guard `OR: [{ sourceWbId: null }, { sourceWbId: w.id }]` that failed when cloud DispatchTruck had a stale `sourceWbId` from a deleted+recreated factory weighment. `updateMany.count` returned 0, handler returned `skipped: true`, weighment never ack'd, retry counter hit 60+ on 4 ethanol trucks while cloud showed them all "still at gate". **Rules to prevent recurrence:**
   - **Always push to `out.ids[]`** at the end of every handler path, including bail-outs and skips. The only acceptable reason to NOT ack is a transient infrastructure error (DB connection lost) — and that should throw, not return.
   - **Don't add a `sourceWbId` equality guard to compare-and-set updates.** Status alone is the right guard. If the truck is still `GATE_IN`/`TARE_WEIGHED`, take over the `sourceWbId` — factory is the source of truth for this physical event.
   - **If `updateMany.count === 0`, re-read the row, log the actual current state, and ack anyway.** Never silent-skip.
   - **When matching "GROSS_WEIGHED but different sourceWbId"** — log a warning, keep the cloud record as-is (don't overwrite), and ack. The factory weighment is a duplicate physical event for an already-processed truck; retrying won't fix it.

7. **Post-commit best-effort side effects** outside the main transaction
   - GrainTruck traceability records
   - `syncToInventory()` calls
   - `prisma.approval.create()` for approvals
   - These can fail without rolling back the main GRN/Shipment

8. **BUT: anything that creates revenue (invoice, journal, GST) must be retriable.** If you put invoice creation behind `setImmediate` + fire-and-forget, a crash between the main tx commit and the billing callback will silently lose the invoice, and `checkWbDuplicate` will block re-entry. Options:
   - **Preferred**: create the invoice inside the same `$transaction` as the dispatch, accepting the longer lock.
   - **Alternative**: persist a `needsInvoicing: true` flag on the truck, and run a reconciliation worker that retries pending rows. This also fixes the `rate=0/null` case where billing is skipped at push time.
   - **Not acceptable**: silent `catch` that only logs to stderr with no persistent retry path.

9. **Contract / PO matching must be STRICT, not fuzzy.** Auto-matching a dispatch to a contract by fuzzy buyer-name `contains` is an accounting error waiting to happen — two customers with similar names ("XYZ Feeds" vs "XYZ Feeds Pvt Ltd") bill to the wrong party at the wrong rate. Required matching criteria for auto-link:
   - **Exact** `buyerName` match (case-insensitive) OR exact GSTIN match
   - Contract is `ACTIVE` AND `startDate ≤ today ≤ endDate`
   - Contract has remaining quantity (`totalSuppliedMT < contractQtyMT`)
   - Only ONE contract matches (if >1, bail out and leave `contractId = null`)

   If any of these fail, create the dispatch with `contractId = null` and let the operator link from UI. Silent wrong-match is worse than no match.

10. **Rate validation before billing.** If the resolved rate is `0` or `null`:
    - Do NOT auto-invoice
    - Do NOT return success as if billing happened
    - Either: set a `needsInvoicing` flag for later reconciliation, OR return the handler result with a clear "PENDING_RATE" marker so the operator sees it in the UI
    - The weighment can still be marked synced (physical event is real), but the billing must not be silently skipped with no trace.

11. **Invoice number generation is not concurrency-safe by default.** `nextInvoiceNo()` uses `findUnique → upsert` which races under parallel auto-invoicing. If your handler can fire multiple invoice creates in parallel, wrap the counter in a `SELECT ... FOR UPDATE` or use a DB sequence. (Known pre-existing issue as of 2026-04 — fix pending.)

---

## Testing Checklist (Run Every Time)

Before pushing a new handler:

```
□ Backend compiles: cd backend && npx tsc --noEmit
□ Frontend builds: cd frontend && npx vite build
□ Schema: every new table keyed off weighment has sourceWbId @unique
□ Handler uses prisma.upsert (not findFirst→create) for dispatch + shipment
□ Handler has status guard — does NOT overwrite BILLED/RELEASED records
□ Contract/PO match is STRICT (exact name or GSTIN, active dates, has remaining qty, single match)
□ Ambiguous match (>1 contract) → contractId=null, not silently wrong
□ Rate=0/null path does NOT silently return success — either flag for retry or surface to operator
□ Invoice creation is either in-transaction OR has a persistent retry path (needsInvoicing flag + reconciler)
□ Contract totals increment gated behind status transition (not just invoiceId presence)
□ Master data added (InventoryItem with right category, vendor/customer)
□ Test happy path: full gate→tare→gross→cloud flow
□ Test idempotency: push same weighment twice CONCURRENTLY (not just sequentially) — only 1 record, 1 invoice, 1 increment
□ Test PO race: 2 simultaneous trucks against same PO line
□ Test fuzzy-match trap: create 2 customers with similar names, push a weighment — verify no silent wrong-match
□ Test invoice link: GRN/Shipment creates correct invoice trail
□ Test inventory: stock level updated, journal entry posted
□ Verify factory dashboard: weighment shows as SYNCED (not ERROR)
□ Verify Recharts dashboard: new product shows in totals
□ Run /codex:rescue audit on the new handler (see Deploy Steps)
```

---

## Common Mistakes (Don't Do These)

1. **Don't create a new endpoint** — use the existing `/push` dispatcher. Adding `/scrap-push` fragments the pipeline.

2. **Don't bypass `syncToInventory()`** — it handles StockMovement + StockLevel + journal entry atomically. Calling Prisma directly will leave inventory out of sync.

3. **Don't hardcode rates in handlers** — pull from PO line, contract, or InventoryItem master. Rates change.

4. **Don't forget `category` on InventoryItem** — without it, the factory keyword inference is the only fallback, and operators can mistype.

5. **Don't skip the dedup check** — if you create entities outside `checkWbDuplicate()`, add your own `WB:${w.id}` lookup before creating.

6. **Don't forget to update the `detectHandler()` function in `push.ts`** — it's the routing table. If the handler exists but isn't in the dispatcher, it's dead code.

7. **Don't deploy without testing all 8 existing types still work** — the dispatcher is shared, and a bad detection condition can break everything.

8. **Don't use `findFirst → create` for dedup.** This is a race, not an idempotency pattern. Two concurrent pushes both miss the `findFirst` and both `create`. Use `prisma.upsert({ where: { sourceWbId } })` + `@unique` on the column. Discovered in DDGS audit 2026-04 — would have caused duplicate billing in production.

9. **Don't auto-match contracts/POs by fuzzy `contains`.** "XYZ Feeds" matches "XYZ Feeds Pvt Ltd" matches "XYZ Feeds & Chemicals" — and now you're billing the wrong customer at the wrong rate. Require exact name OR exact GSTIN match, plus active-date and remaining-qty filters, plus single-match guard. Ambiguous → `contractId = null`, not silent wrong-match.

10. **Don't put revenue creation behind `setImmediate` with only stderr logging.** If the process crashes between tx commit and billing callback, the invoice is silently lost AND `checkWbDuplicate` blocks re-entry. Either bill inside the main tx, or persist a `needsInvoicing` flag + reconciliation worker. Fire-and-forget is fine for journal/IRN/EWB (those can be retried from the invoice record), NOT for invoice creation itself.

11. **Don't overwrite `BILLED`/`RELEASED` records on retry.** A late-arriving weighment push must be a no-op, not a silent weight rewrite. Check status at the top of the upsert and bail if terminal. See `ethanolOutbound.ts` compare-and-set pattern.

12. **Don't return success when billing was silently skipped.** If `rate=0` or contract match failed, the push can still be marked synced (the physical event is real), but the handler result MUST indicate pending billing — either a different `type` in `PushOutcome.results[]` (like `DDGSDispatch_PENDING_RATE`) or a persisted flag. Otherwise the operator has no way to know billing never happened.

13. **Don't return `skipped: true` without acking.** The single worst pattern in the whole pipeline. Returning `skipped: true` means "I didn't write anything" but the syncWorker reads it as "this weighment failed, retry forever." **Incident 2026-04-07** — 4 ethanol trucks (KA01AM2614, KA01AM3386, KA01AM2956, KA01AN0767) stuck at gate on cloud for 6+ hours, sync attempts 25–61, because `ethanolOutbound.ts` had a compare-and-set guard with `OR: [sourceWbId null, sourceWbId = w.id]` that failed against stale `sourceWbId` values from deleted factory weighments. Fix: removed the sourceWbId guard, always ack at the end of the handler, branch on actual cloud state when updateMany matches 0 rows. **Rule of thumb: if your handler can return without pushing to `out.ids[]`, it's a bug.**

---

## Example: Full Diff for Adding Scrap Outbound (Dedicated Handler)

### Files to create
- `backend/src/routes/weighbridge/handlers/scrapOutbound.ts` — new handler

### Files to modify
- `backend/src/routes/weighbridge/push.ts` — add import + detection
- `factory-server/src/routes/weighbridge.ts` — add SCRAP keywords

### Files NOT to touch
- `shared.ts` (unless adding a new utility)
- Other handlers (each is isolated — that's the whole point of the refactor)
- `endpoints.ts` (only if adding a new admin endpoint)
- `app.ts` (router import is already pointing to the directory)
- `factory-server/src/services/syncWorker.ts` (already sends `material_category`)

### Database migration
- New migration: `prisma migrate dev --name add_scrap_dispatch` (only if dedicated table)
- Or just data: insert InventoryItem rows (no migration)

### Deploy steps
1. `cd backend && npx tsc --noEmit` — must pass
2. `cd frontend && npx vite build` — must pass
3. Test handler in isolation locally if possible
4. **Run Codex audit** — `/codex:rescue` on the new handler file. Ask Codex to look for: race conditions, idempotency holes, missing `$transaction` boundaries, hardcoded rates, missing `syncToInventory()` calls, dedup gaps, and incorrect `PushOutcome` shapes. Fix anything Codex flags before pushing — this is the cheapest insurance against a silent production break.
5. `git add backend/src/routes/weighbridge/ factory-server/src/routes/weighbridge.ts`
6. `git commit -m "feat: scrap outbound handler"`
7. `git push origin main` — Railway auto-deploys cloud
8. Build + deploy factory server (see CLAUDE.md "Factory Server Deploy")
9. Test with a real truck end-to-end
10. Monitor factory admin dashboard for sync errors

---

## Reference: The 8 Existing Handlers

| Handler | Triggers When | Creates |
|---------|--------------|---------|
| `handlePoInbound` | INBOUND + PO/JOB_WORK + po_id | GRN, updates PO, syncs inventory |
| `handleSpotInbound` | INBOUND + SPOT | DirectPurchase |
| `handleTraderInbound` | INBOUND + TRADER + supplier_id | Running monthly PO + GRN |
| `handleFallbackInbound` | INBOUND, no PO/SPOT/TRADER | GrainTruck only (last resort) |
| `handleEthanolOutbound` | OUTBOUND + (material has 'ethanol' OR cloud_gate_pass_id is UUID) | DispatchTruck update |
| `handleDDGSOutbound` | OUTBOUND + (material_category='DDGS' OR material has 'ddgs'/'distillers'/'dried grain') | DDGSDispatchTruck + Shipment + auto-match DDGSContract + auto Invoice via `ddgsInvoiceService` |
| `handleNonEthanolOutbound` | OUTBOUND, not ethanol, not DDGS (catch-all: scrap, sugar, etc.) | DDGSDispatchTruck + Shipment (no contract link) |
| Pre-phase: `runPrePhase` | GATE_ENTRY/FIRST_DONE inbound, OR COMPLETE inbound with existing GrainTruck stub | GrainTruck stub for lab page |

Fuel is NOT a separate handler — fuel-specific behavior (skip GrainTruck, fuel lab fail rejection) is inside `handlePoInbound` and pre-phase, gated on `ctx.isFuel`.

---

## ⭐ FRONTEND — The Other Half (Don't Skip This)

A backend handler alone is dead code. Every product type needs a full frontend vertical so operators, sales, and management can actually use it. Use **Ethanol** and **DDGS** as your reference templates — they're the gold standard.

### The Ethanol Frontend Vertical (reference pattern)

| Layer | Files | Purpose |
|-------|-------|---------|
| **Backend route** | `backend/src/routes/ethanolProduct.ts`, `ethanolContracts.ts`, `dispatch.ts` | CRUD APIs |
| **Process page (operator)** | `frontend/src/pages/process/EthanolProduct.tsx` | Daily ethanol production stock |
| **Dispatch page (operator)** | `frontend/src/pages/process/EthanolDispatch.tsx` | Truck dispatch tracking |
| **Sales page (commercial)** | `frontend/src/pages/sales/EthanolContracts.tsx` | OMC contracts, allocations, supply tracking |
| **Module config** | `frontend/src/config/modules.ts` | Sidebar entries: `ethanol-dispatch`, `ethanol-contracts` |
| **Routing** | `frontend/src/App.tsx` | Lazy import + `<Route>` |
| **Layout group** | `frontend/src/components/Layout.tsx` | Sidebar grouping (which collapsible section) |
| **Backend router registration** | `backend/src/app.ts` | `app.use('/api/ethanol-product', ...)` |

### The DDGS Frontend Vertical (mirror pattern)

DDGS has the exact same structure as ethanol — use it as a second reference:

| Layer | File |
|-------|------|
| Process | `frontend/src/pages/process/DDGSStock.tsx`, `DDGSDispatch.tsx` |
| Sales | `frontend/src/pages/sales/DDGSContracts.tsx` |
| Backend | `backend/src/routes/ddgsStock.ts`, `ddgsDispatch.ts`, `ddgsContracts.ts` |

**Pattern**: every sellable product gets at minimum a Process page (operator stock view), a Sales page (contracts/orders), and a Dispatch page (truck tracking). Existing modules (Sales Orders, Customers, Invoices, Payments) handle the rest of the order-to-cash workflow.

---

## Full Vertical Checklist for a New Product (e.g., Scrap)

When adding a new product, you need ALL of these. Skipping any one leaves a half-built system.

### Backend (cloud ERP)

```
□ Prisma model (if dedicated table needed)        backend/prisma/schema.prisma
□ Migration                                        npx prisma migrate dev --name add_scrap
□ Route file (CRUD APIs)                           backend/src/routes/scrap.ts  (or scrapDispatch.ts)
□ Register in app.ts                               import scrapRoutes from './routes/scrap';
                                                   app.use('/api/scrap', scrapRoutes);
□ Weighbridge handler (if dedicated)               backend/src/routes/weighbridge/handlers/scrapOutbound.ts
□ Add to push.ts dispatcher                       detectHandler() routing
□ Material category in factory server              factory-server/src/routes/weighbridge.ts (SCRAP_KEYWORDS)
□ InventoryItem in cloud DB                        category='SCRAP', unit, HSN, GST
```

### Frontend (operator + sales views)

```
□ Process page (operator stock view)               frontend/src/pages/process/ScrapStock.tsx
□ Process dispatch page (operator)                 frontend/src/pages/process/ScrapDispatch.tsx
□ Sales page (commercial contracts)                frontend/src/pages/sales/ScrapContracts.tsx
□ Lazy import in App.tsx                           const ScrapStock = React.lazy(() => import(...))
□ Routes in App.tsx                                <Route path="process/scrap-stock" ... />
□ Module entries in modules.ts                     { key: 'scrap-stock', label: 'Scrap Stock', to: '/process/scrap-stock', group: 'process' }
□ Sidebar group mapping in Layout.tsx              'scrap-stock': 'scrap'  (or existing group)
□ Permission check (if role-gated)                 modules.ts permission field
```

### Sales workflow (reuse existing modules)

```
□ Customer master                                  /procurement/customers (no new code, just data)
□ Sales Order template                             /sales/sales-orders (existing UI handles all products)
□ Invoice generation                               /sales/invoices (existing handles HSN/GST per item)
□ Payment receipt                                  /sales/payments (existing)
□ E-invoice/e-way bill                             Auto via sales-module, requires HSN on InventoryItem
□ Telegram notification (optional)                 backend/src/services/messaging.ts (add scrap dispatch hook)
```

### Documents (PDF/Print)

```
□ Delivery challan template                        backend/templates/scrap-challan.hbs (if custom)
□ Invoice template                                 reuses existing invoice.hbs (driven by InventoryItem.hsnCode)
□ Weighment slip                                   reuses existing weighbridge slip
□ Print endpoint in route file                     scrap.ts → renderDocumentPdf() (see CLAUDE.md PDF rule)
```

### Reporting / Analytics

```
□ Add to Sales Dashboard                           frontend/src/pages/sales/SalesDashboard.tsx (KPI tile)
□ Add to Stock Dashboard                           frontend/src/pages/inventory/StockDashboard.tsx
□ Add to Reports module                            frontend/src/pages/Reports.tsx
□ Recharts compliance                              follow .claude/skills/charts-graphs.md
```

---

## Frontend File Templates (Copy from Existing)

### ScrapStock.tsx — base on `EthanolProduct.tsx`
Read first: `frontend/src/pages/process/EthanolProduct.tsx`
Replace:
- `ethanol` → `scrap`
- `Ethanol` → `Scrap`
- API endpoint `/api/ethanol-product` → `/api/scrap-stock`
- Tank/storage fields → bin/heap fields (whatever scrap uses)
- Keep the same Tier 1 plant UI style (rounded, friendly)

### ScrapDispatch.tsx — base on `DDGSDispatch.tsx`
Read first: `frontend/src/pages/process/DDGSDispatch.tsx`
Replace:
- `ddgs` → `scrap`
- API endpoint `/api/ddgs-dispatch` → `/api/scrap-dispatch`
- Adjust units (KG/MT)

### ScrapContracts.tsx — base on `DDGSContracts.tsx` (NOT EthanolContracts — too OMC-specific)
Read first: `frontend/src/pages/sales/DDGSContracts.tsx`
This is **Tier 2 SAP-style** (square edges, dense, professional). Follow the SAP design tokens in CLAUDE.md.
Replace:
- `ddgs` → `scrap`
- `DDGS` → `Scrap`
- API endpoint `/api/ddgs-contracts` → `/api/scrap-contracts`
- Buyer fields might be different (scrap dealer vs. food customer)

---

## Sidebar Integration Walkthrough

`frontend/src/config/modules.ts` — add the new entries:
```typescript
// Process group
{ key: 'scrap-stock', label: 'Scrap Stock', to: '/process/scrap-stock', icon: Package, group: 'process' },
{ key: 'scrap-dispatch', label: 'Scrap Dispatch', to: '/process/scrap-dispatch', icon: Truck, group: 'process' },

// Sales group
{ key: 'scrap-contracts', label: 'Scrap Sales', to: '/sales/scrap-contracts', icon: Handshake, group: 'sales' },
```

`frontend/src/components/Layout.tsx` — add group mapping if you want it under a new collapsible section:
```typescript
const moduleToGroup = {
  // ... existing
  'scrap-stock': 'scrap',
  'scrap-dispatch': 'scrap',
};
```

`frontend/src/App.tsx` — lazy import + routes:
```typescript
const ScrapStock = React.lazy(() => import('./pages/process/ScrapStock'));
const ScrapDispatch = React.lazy(() => import('./pages/process/ScrapDispatch'));
const ScrapContracts = React.lazy(() => import('./pages/sales/ScrapContracts'));

// In <Routes>:
<Route path="process/scrap-stock" element={<ScrapStock />} />
<Route path="process/scrap-dispatch" element={<ScrapDispatch />} />
<Route path="sales/scrap-contracts" element={<ScrapContracts />} />
```

---

## End-to-End Test Plan (the only test that matters)

After all backend + frontend work is done, run through this on production:

```
1. Master data:
   □ InventoryItem 'Iron Scrap' created with category=SCRAP, unit=KG, HSN=7204, GST=18%
   □ Customer 'Scrap Dealer Pvt Ltd' created with GSTIN
   □ Vendor (if buying scrap from someone) created
2. Frontend smoke test:
   □ Sidebar shows: Scrap Stock, Scrap Dispatch, Scrap Sales
   □ All 3 pages load without errors
   □ Browser console: 0 errors
3. Sales side:
   □ Create a Scrap Sales contract / Sales Order via UI
   □ Verify it appears in Sales Orders list
4. Operator (factory):
   □ Gate entry on factory server: select 'Iron Scrap' material, vehicle in
   □ Tare weighment captured
   □ Loader fills truck
   □ Gross weighment captured
   □ Factory server pushes to cloud
5. Cloud verification:
   □ Check factory admin dashboard: weighment shows SYNCED (not ERROR)
   □ Cloud Shipment / ScrapDispatch created with correct weights
   □ Inventory decremented (check StockMovement and StockLevel)
   □ Journal entry posted (debit COGS-Scrap, credit Inventory-Scrap)
6. Sales completion:
   □ Generate invoice from sales/invoices
   □ E-way bill auto-generated (if eligible)
   □ Send invoice to customer
   □ Mark payment received
7. Reports:
   □ Sales Dashboard shows scrap revenue
   □ Stock Dashboard shows scrap stock movement
   □ P&L includes scrap revenue/COGS
```

---

## Why This Matters

The weighbridge handler is only ~10% of the work. If you only build the handler, the operator has nowhere to enter gate data, sales has nowhere to track contracts, accounts has no invoice trail, and the data sits in a database table no one looks at.

**Always build the full vertical**: backend handler + process page + sales page + dispatch page + reports integration. Use ethanol/DDGS as your template — they show every layer working together.

---

## When in Doubt

1. Read this skill again
2. Open ALL the ethanol files side by side: route, process page, sales page, dispatch page — see how they connect
3. Look at the existing handlers in `backend/src/routes/weighbridge/handlers/` — they're all small enough to read in 5 minutes
4. Check the plan: `.claude/plans/optimized-whistling-hopcroft.md`
5. Run the Codex audit on your new handler before deploying — it catches race conditions
6. **Test the whole vertical end-to-end on production with one real truck before announcing it's done**
