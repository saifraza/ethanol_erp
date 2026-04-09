# GRN Split — Auto (Weighbridge) vs Store (Manual)

## Problem

Today there is one `GoodsReceipt` page (`GateAndReceipts.tsx`, which the old `/procurement/goods-receipts` route redirects into) that mixes two fundamentally different workflows:

1. **Weighbridge-sourced GRNs** — rice husk, grain, fuel, ethanol, DDGS. Created **automatically** by `backend/src/routes/weighbridge/handlers/poInbound.ts` (and siblings) when a truck completes weighing. Nobody should ever click a "New GRN" button for these.
2. **Store-sourced GRNs** — chemicals, spares, PPE, lab reagents, packing, consumables. Created **manually** by the store in-charge after physically counting goods delivered to the store.

Mixing both in one page has produced real bugs:

- **PO-70 (2026-04-08, MATRIX CORPORATION)** — a store user clicked Create GRN twice for the same chemicals delivery. Result: GRN-127 recorded the full PO, then GRN-128 added a second full dump on top. `POLine.receivedQty` went over the ordered quantity on every line except one; combined GRN value ₹54.76 L vs PO value ₹44.92 L (₹9.84 L of phantom chemicals). Both GRNs still in DRAFT so no payment went out, but the trap is set.
- **PO-61 vs T-131 (2026-04-09)** — auto GRN-153 landed on PO-59 (wrong vendor due to operator mis-tag at gate entry). Corrected via a manual SQL transaction (see `project_grn153_vendor_correction.md` in memory). The corrections UI didn't surface this because the old admin-corrections page only lists `GrainTruck` rows, not `GoodsReceipt`.

## Solution — physically separate the two flows

### Backend — `backend/src/routes/goodsReceipts.ts` is split by route prefix, not by table

- **Same `GoodsReceipt` table.** No schema change. No migration.
- **Source discriminator is a query rule**, not a new column (add a proper `source` enum only if/when it starts being queried constantly):

  ```ts
  const AUTO_SOURCE_WHERE = {
    OR: [
      { remarks: { contains: 'WB:' } },
      // any other marker we set from weighbridge handlers
    ],
  };
  ```

  Any GRN whose `remarks` contains `WB:<factoryLocalId>` (set by every weighbridge handler — see `backend/src/routes/weighbridge/handlers/poInbound.ts`) is **auto**. Everything else is **store**.

- **Two route groups** registered in `backend/src/app.ts`:

  ```ts
  app.use('/api/goods-receipts/auto',  autoGoodsReceiptRoutes);   // read-only list + detail
  app.use('/api/goods-receipts/store', storeGoodsReceiptRoutes);  // full CRUD
  app.use('/api/goods-receipts',       goodsReceiptRoutes);       // legacy catch-all, keep for now
  ```

  The legacy prefix stays mounted so anything still hitting it (reports, old mobile clients, Telegram bots) keeps working. New UI hits only the split prefixes.

#### Auto route (`/api/goods-receipts/auto`)
- `GET /` — paginated list, `AUTO_SOURCE_WHERE` always applied. Filters: `from`, `to`, `vendorId`, `poId`, `q` (ticketNo / vehicleNo / GRN no).
- `GET /:id` — detail, must match `AUTO_SOURCE_WHERE`, 404 otherwise.
- No POST / PUT / DELETE. Corrections flow through `/api/weighbridge/admin/correct/...` (extend that to cover `GoodsReceipt` in a follow-up).

#### Store route (`/api/goods-receipts/store`)
- `GET /` — paginated list, **must** exclude `AUTO_SOURCE_WHERE`.
- `GET /:id` — detail, must not match `AUTO_SOURCE_WHERE`.
- `POST /` — create DRAFT. **Duplicate guard** (see below).
- `PUT /:id` — edit DRAFT only.
- `POST /:id/approve` — DRAFT → CONFIRMED. Requires role `STORE_INCHARGE` or `ADMIN`.
- `DELETE /:id` — DRAFT only, hard delete (store never goes past DRAFT on a wrong entry).

#### Duplicate guard (the PO-70 lesson)
On `POST /api/goods-receipts/store`, before inserting:

```ts
const draftsForPO = await prisma.goodsReceipt.findMany({
  where: { poId: body.poId, status: 'DRAFT', NOT: AUTO_SOURCE_WHERE },
  select: { id: true, grnNo: true, createdAt: true, createdBy: true },
});
if (draftsForPO.length > 0 && !body.forceCreate) {
  return res.status(409).json({
    error: 'DRAFT_GRN_EXISTS',
    message: `GRN-${draftsForPO[0].grnNo} DRAFT already exists for this PO. Edit that instead.`,
    existing: draftsForPO,
  });
}
```

Frontend shows the 409 as a red banner with a "Edit GRN-127 instead" button. `forceCreate: true` is only accepted from ADMIN role and writes an audit remark.

#### Role gate
Store CRUD is restricted to `STORE_INCHARGE`, `PROCUREMENT_MANAGER`, or `ADMIN`. Auto routes are readable by anyone with procurement view.

### Frontend — two pages, one shared detail drawer

#### 1. `frontend/src/pages/procurement/AutoGoodsReceipts.tsx` (new)
- Read-only list at `/procurement/goods-receipts/auto`.
- Hits `GET /api/goods-receipts/auto`.
- SAP Tier-2 style from `CLAUDE.md`.
- Columns: GRN No, Date, Vehicle, Ticket #, Vendor, PO #, Material, Qty, Amount, Source (`Weighbridge`).
- No Create/Edit/Delete buttons — just a banner: *"Auto GRNs are created by the weighbridge when trucks complete weighing. To correct, use [Weighment Corrections](/admin/weighment-corrections)."*
- Row click → detail drawer (same component as store page, but in read-only mode).

#### 2. `frontend/src/pages/store/StoreReceipts.tsx` (new — new `store/` folder under pages)
- CRUD list at `/store/receipts`.
- Hits `GET /api/goods-receipts/store`.
- SAP Tier-2 style.
- Columns: GRN No, Date, Vendor, PO #, Items, Amount, Status, Created By.
- Top-right `+ NEW RECEIPT` button opens a modal:
  1. Step 1 — pick PO (searchable dropdown, only APPROVED / PARTIAL_RECEIVED, only POs whose material is NOT from the weighbridge material categories — i.e. hide raw-material / fuel POs).
  2. Step 2 — if backend returns 409 DRAFT_GRN_EXISTS, render the red banner with "Edit existing" button.
  3. Step 3 — table of PO lines with pending qty pre-filled. Store user edits received qty, adds batch no / expiry / bin / remarks. Quantity > pending requires ADMIN PIN.
  4. Save as DRAFT. Approve is a separate button on the detail page (role-gated).
- Duplicate guard is the headline safety feature.

#### 3. Nav / routes
- `frontend/src/App.tsx`:
  - Add `/procurement/goods-receipts/auto` → `AutoGoodsReceipts`.
  - Add `/store/receipts` → `StoreReceipts`.
  - **Keep** the existing `/procurement/goods-receipts` → `/logistics/gate-register?tab=grn` redirect for 2 weeks, then delete.
  - **Keep** `/logistics/gate-register` (`GateAndReceipts.tsx`) mounted — it's also the gate entry / weighbridge operator screen. Only remove the GRN creation section from that page (`showGrnSection` block) because those GRNs should now come from `/store/receipts`. Gate entry itself stays.
- `frontend/src/components/Layout.tsx`:
  - Procurement menu: replace "Goods Receipts" with "Auto GRN (Weighbridge)" → `/procurement/goods-receipts/auto`.
  - New top-level **Store** section (or under Inventory): "Receipts" → `/store/receipts`.

### Data — no migration, just a soft flag

For existing PO-70 GRN-127 and GRN-128 (the bugged chemicals entries):
- Both have no `remarks` starting with `WB:` → they land in the Store page after the split.
- The duplicate guard retroactively catches them: the Store page will show GRN-127 and GRN-128 both as DRAFT with a red banner *"Two DRAFT GRNs exist for PO-70 — review and delete duplicates"*.
- User then deletes GRN-128 (or shrinks it) via the new Store page. No raw SQL required.

## Roll-out order

1. **Skill file** (this file) — written first so agents can read the contract.
2. **Backend PR** — new `autoGoodsReceipts.ts` + `storeGoodsReceipts.ts`, register in `app.ts`, duplicate guard, role gate. Keep `goodsReceipts.ts` mounted as legacy catch-all. `tsc` clean.
3. **Frontend PR — Auto page** — `AutoGoodsReceipts.tsx`, route, nav entry. `vite build` clean.
4. **Frontend PR — Store page** — `StoreReceipts.tsx`, route, nav entry, duplicate banner, receipt create modal. `vite build` clean.
5. **Cleanup PR** — remove the GRN creation section from `GateAndReceipts.tsx` (keep gate entry). Remove the old `GoodsReceipts.tsx` from procurement after 2 weeks.
6. **Use the new Store page to fix PO-70** — delete GRN-128, approve GRN-127 (or shrink).

## Files — quick reference

### Backend
- `backend/src/routes/goodsReceipts.ts` — 1017-line legacy god-route. Do **not** delete. Keep mounted as `/api/goods-receipts` until all clients migrate.
- `backend/src/routes/autoGoodsReceipts.ts` **(new)** — read-only, ~200 lines.
- `backend/src/routes/storeGoodsReceipts.ts` **(new)** — CRUD + duplicate guard + role gate, ~400 lines.
- `backend/src/app.ts` — register both new routes above the legacy one.
- `backend/src/routes/weighbridge/handlers/poInbound.ts:302-310` — the existing auto-GRN creation site. No change needed, but confirm it always writes a `WB:<localId>` prefix in remarks so the `AUTO_SOURCE_WHERE` filter catches it.

### Frontend
- `frontend/src/pages/procurement/AutoGoodsReceipts.tsx` **(new)** — read-only list.
- `frontend/src/pages/store/StoreReceipts.tsx` **(new)** — CRUD list + new-receipt modal + detail drawer.
- `frontend/src/pages/store/StoreReceiptDetail.tsx` **(new)** — detail drawer shared with Auto page (read-only mode prop).
- `frontend/src/App.tsx` — register both routes, lazy-load.
- `frontend/src/components/Layout.tsx` — update nav.
- `frontend/src/pages/logistics/GateAndReceipts.tsx` — remove GRN creation section (the `showGrnSection` block around line 714). Keep gate entry.
- `frontend/src/pages/procurement/GoodsReceipts.tsx` — leave alone. Delete in cleanup PR.

## Non-goals for this PR set

- Renaming `GoodsReceipt` table or adding a `source` column. Pure query-filter for now.
- Extending the weighment corrections UI to edit `GoodsReceipt`. Separate skill, separate PR.
- Changing the auto-GRN creation logic inside weighbridge handlers. Only the UI split.
- Factory-server side — no change. This is all cloud UI + routes.

## Agent brief (paste into agent when delegating)

> Read `.claude/skills/grn-split-auto-vs-store.md` before touching any code. Do not change the `GoodsReceipt` table schema. Do not rename or delete `backend/src/routes/goodsReceipts.ts` or `frontend/src/pages/procurement/GoodsReceipts.tsx`. Follow the SAP Tier-2 design tokens from `CLAUDE.md`. Verify with `cd backend && npx tsc --noEmit` and `cd frontend && npx vite build` before reporting done. Do not commit or push.
