# Weighbridge — Adding a New Weighable Product + Cross-System Contracts

READ THIS ENTIRELY before adding any new product (scrap, sugar, animal feed, molasses, CO2, fly ash, …) to the weighbridge pipeline: gate entry → weighbridge → factory server → cloud → GRN/dispatch → inventory → invoice → payment. These systems are interconnected; skipping a step breaks something silently.

## ⭐ For 95% of products you NEVER edit code

Just create the InventoryItem in the UI: **Inventory → Material Master → New Item**. Fill Name, **Category** (RAW_MATERIAL / FUEL / CHEMICAL / FINISHED_GOOD / BYPRODUCT / SCRAP / PACKAGING / SPARE_PART / CONSUMABLE), **Division** (ETHANOL / SUGAR / POWER / COMMON), HSN / GST% / Unit, **Aliases** (comma-separated names operators may type), **Handler Override** (leave **Auto** unless it needs a specific cloud handler), **Contract-based** (check if gate entry must pick a contract), **Needs lab test** (block gross until lab passes). Save. Factory server picks it up within ~5s (smart sync). No deploy.

The legacy keyword arrays in `factory-server/src/routes/weighbridge.ts` are a last-resort fallback for items not yet in the InventoryItem master.

### You DO need code (the 5% case) only for

A dedicated cloud handler (custom dispatch table, contract auto-link, special invoice), a new partial-state stub (rule #12), or a new contract model + picker UI.

## Material category & routing

The factory tags every weighment with a `materialCategory` BEFORE pushing. Source of truth = `InventoryItem.category`; keyword inference is just a fast path (`factory-server/src/routes/weighbridge.ts:281-319`): FUEL (coal, husk, bagasse, mustard, furnace, diesel, hsd, lfo, hfo, firewood, biomass), RAW_MATERIAL (maize, corn, broken rice, grain, sorghum, milo), CHEMICAL (amylase, urea, acid, antifoam, yeast). Add a new category by defining keywords, marking `InventoryItem.category`, and deciding `needsLab` (`isInbound && category IN (RAW_MATERIAL, FUEL)` today).

### Auto-routing (when `handlerKey` is null)

| Dir | Match | Handler |
|---|---|---|
| OUT | handler_key=ETHANOL_OUTBOUND OR cloud_gate_pass_id is uuid OR material~'ethanol' | handleEthanolOutbound |
| OUT | category=SUGAR OR material ~ /sugar/i (checked BEFORE DDGS) | handleSugarOutbound |
| OUT | category=DDGS OR material ~ ddgs/wdgs/distillers/dried/wet grain | handleDDGSOutbound |
| OUT | anything else (scrap, pressmud, byproducts, LFO/HFO/ash) | handleNonEthanolOutbound (Shipment only) |
| IN | po_id + PO/JOB_WORK | handlePoInbound |
| IN | SPOT | handleSpotInbound |
| IN | TRADER + supplier_id (vendor `isAgent=true`) | handleTraderInbound |
| IN | nothing matches | handleFallbackInbound (GrainTruck only) |

`detectHandler` priority: explicit `handlerKey` > direction-based auto-detect > catch-all. **DDGSDispatchTruck is the generic non-ethanol outbound table** (despite the name); the linked Shipment's `productName` distinguishes the real product. Fuel is NOT a separate handler — fuel behavior lives inside `handlePoInbound` gated on `ctx.isFuel`.

### Weight units & columns

- Inbound (grain/fuel): KG → **MT** at push time (GrainTruck, GoodsReceipt store MT).
- Outbound (ethanol/DDGS/sugar/scrap), spot farmer (DirectPurchase): stored in **KG**.
- Factory `Weighment` always stores raw KG.
- Two column conventions coexist: `weightGross/weightTare/weightNet` (GrainTruck, DispatchTruck, DDGS/Sugar) and `grossWeight/tareWeight/netWeight` (GoodsReceipt, DirectPurchase, factory Weighment). New code uses the camelCase `weight*` form.

## Key files

`backend/src/routes/weighbridge/push.ts` (dispatcher) · `handlers/*.ts` (one per type) · `shared.ts` (schema/types/utils, `checkWbDuplicate`) · `pre-phase.ts` (partial-state stubs) · `factory-server/src/routes/weighbridge.ts` (category tagging) · `factory-server/src/services/syncWorker.ts` (relay).

## Handler contract (the rules)

Signature `async handleXxx(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome>`. Every handler MUST:

1. **Return a PushOutcome** with `ids[]` + `results[]` (`{id,type,refNo,sourceWbId}`); `sourceWbId === w.id`.
2. **Use `$transaction`** for multi-table writes.
3. **Use `WB:${w.id}` in remarks** (`ctx.wbRef`) for dedup.
4. **Idempotency via `prisma.upsert({where:{sourceWbId:w.id}})` + `sourceWbId @unique`** — NEVER `findFirst→create` (Prisma tx is READ COMMITTED, not SERIALIZABLE; two pushes both miss and both insert → duplicate trucks/invoices. Seen in DDGS audit 2026-04).
5. **Atomic `{increment}`** for counters, and increment **once per weighment**, gated on a status transition (e.g. `GROSS_WEIGHED → BILLED`), not on `invoiceId` presence.
6. **Status guard** — never overwrite terminal `BILLED`/`RELEASED`; retries/late pushes are no-ops. BUT **"skip writing" ≠ "skip acking"**.
6a. **NEVER let a handler return without pushing to `out.ids[]`** — that makes syncWorker fail it `"Not in cloud response"` and retry forever (silent: operator sees nothing, cloud frozen at gate-in). **Incident 2026-04-07**: ethanolOutbound's `OR:[{sourceWbId:null},{sourceWbId:w.id}]` compare-and-set matched 0 rows on stale sourceWbId → 4 ethanol trucks stuck at gate, 25–61 retries. Fixes: always ack; status alone is the guard (take over `sourceWbId`, factory is source of truth); if `updateMany.count===0`, re-read + log + ack; never silent-skip.
7. **Post-commit best-effort side effects** (GrainTruck traceability, `syncToInventory()`, approvals) outside the main tx.
8. **BUT revenue (invoice/journal/GST) must be retriable** — create the invoice inside the dispatch `$transaction`, OR persist a `needsInvoicing` flag + reconciler. NEVER `setImmediate` + fire-and-forget with stderr-only logging.
9. **Contract/PO matching STRICT, not fuzzy** — exact `buyerName` (case-insensitive) OR exact GSTIN; contract ACTIVE & in date window; remaining qty; exactly ONE match (else `contractId=null`, let operator link). Silent wrong-match is worse than no match.
10. **Rate validation** — if rate is 0/null, do NOT auto-invoice and do NOT return false success; flag `needsInvoicing` or a `PENDING_RATE` marker. Weighment can still be synced (physical event is real).
11. Invoice-number generation race is FIXED (`invoiceCounter.ts` atomic `INSERT … ON CONFLICT … RETURNING`).
12. **Partial-state sync (the "first weight" rule)** — show in-progress trucks on cloud as soon as they gate in. FIVE parts, all required or billing/sync breaks: (1) syncWorker pushes FIRST_DONE filtered to products with a cloud stub handler; (2) direction-aware timestamps (`first_weight_at`/`second_weight_at` agnostic, OUT inverts tare/gross); (3) `pre-phase.ts` upserts a stub keyed on `sourceWbId`, runs the same strict contract match, returns `shortCircuit:true`; (4) `checkWbDuplicate` MUST exclude stubs via `status NOT IN ('GATE_IN','TARE_WEIGHED')` (the trap that broke DDGS billing 2026-04-07); (5) COMPLETE handler promotes stub status to `GROSS_WEIGHED`. Reference: `createOrUpdateGrainTruckStub` (inbound), `createOrUpdateDdgsTruckStub` (outbound, added 2026-04-07). Ethanol uses a different gate-pass API mechanism. Sugar/scrap have NO stub yet (COMPLETE-only).

## The 8 existing handlers

`handlePoInbound` (GRN + PO + inventory) · `handleSpotInbound` (DirectPurchase) · `handleTraderInbound` (running monthly PO + GRN) · `handleFallbackInbound` (GrainTruck only) · `handleEthanolOutbound` (DispatchTruck via cloud gate-pass) · `handleDDGSOutbound` (DDGSDispatchTruck + Shipment + DDGSContract auto-match + inline auto-Invoice) · `handleSugarOutbound` (SugarDispatchTruck + Shipment + SugarContract; checked before DDGS) · `handleNonEthanolOutbound` (Shipment only, catch-all). Pre-phase stubs: grain (inbound), DDGS (outbound).

## Contract-picker pattern (outbound sold against a contract)

Operator must PICK the contract at factory gate entry (not type a buyer name) so the cloud's strict match works. Copy the **DDGS pattern** (2026-04-07), THREE pieces all mandatory:
1. **Cache contracts on factory** (`masterDataCache.ts`): add interface + array to `MasterCache`/`EMPTY_CACHE`/`loadFromDisk`; add table to `getCloudTimestamp()` for 5s smart-sync; separate try/catch in `fullSyncFromCloud()` filtering `status='ACTIVE' AND endDate>=NOW() AND startDate<=NOW() ORDER BY contractNo LIMIT 50`; cast Decimals with `Number()`.
2. **Expose via factory API** (`masterData.ts`): one line in `/api/master-data`.
3. **Gate-entry UI** (`GateEntry.tsx`): conditional dropdown + info card; **auto-fill `customerName` with `c.buyerName`** (this is what makes the cloud exact-match link the contract); show rate by dealType (`JOB_WORK → processingChargePerMT`, else `rate`). Tier-2 SAP styling.

**Contract-data traps** before debugging "truck won't bill": `dealType` mismatch (FIXED_RATE priced like job work — handler reads `.rate` for FIXED_RATE, `.processingChargePerMT` for JOB_WORK); rate stored in wrong unit (always ₹/MT, not ₹/kg); `gstPercent` wrong (DDGS sale 5%, job-work HSN 998817 is 18%).

## Cross-system API contracts (exact payload shapes)

### 1. POST /api/weighbridge/push (Factory → Cloud, `X-WB-Key`)
Caller `factory-server/src/services/syncWorker.ts`; receiver `backend/src/routes/weighbridge.ts`.
```json
{"weighments":[{"id":"local-uuid","ticket_no":0,"vehicle_no":"MP20KA1234","direction":"IN",
"purchase_type":"PO","po_id":"actual-PO-uuid","supplier_name":"Vendor","material":"Broken Rice",
"weight_gross":45000,"weight_tare":15000,"weight_net":30000,"weight_source":"factory-server",
"first_weight_at":"ISO-8601","second_weight_at":"ISO-8601","status":"COMPLETE","remarks":"","created_at":"ISO-8601"}]}
```
Response `{"ok":true,"ids":["cloud-uuid"]}`. `ticket_no` always 0; `po_id` maps to the actual PO UUID.

### 2. POST /api/weighbridge/heartbeat (Factory → Cloud)
`pcMonitor.ts` → in-memory `pcHeartbeats` Map. Fields: `pcId,pcName,timestamp,uptimeSeconds,queueDepth,dbSizeMb,serialConnected,serialProtocol,webPort,weightsToday,lastTicket,version,system{cpuPercent,memoryMb,diskFreeGb,hostname,os}`.

### 3. GET /api/weighbridge/master-data (Cloud → Factory)
Returns `suppliers[]`, `materials[]{id,name,category}`, `pos[]{id,po_no,vendor_id,vendor_name,deal_type,status,lines[]{id,inventory_item_id,description,quantity,received_qty,pending_qty,rate,unit}}`, `customers[]`. PO validation: only `APPROVED`/`SENT`/`PARTIAL_RECEIVED` can create GRNs; exhausted lines fall to generic inbound; GRN dates use the local weighment timestamp; unit conversion handles KG/MT/QUINTAL/QTL.

### 4. POST /api/weighbridge/lab-results (Cloud → Weighbridge)
Request `{"weighment_ids":["uuid"]}` → `{"results":[{"weighment_id","lab_status","moisture","starch","damaged","foreign_matter"}]}`.

## Full vertical checklist (don't half-build)

A handler is ~10% of the work. Every sellable product needs the full vertical — use Ethanol/DDGS as the gold-standard template:
- **Backend**: Prisma model (if dedicated table) + SchemaDriftGuard registration (see repo CLAUDE.md) + route CRUD + register in `app.ts` + handler + `detectHandler` + factory keyword + InventoryItem.
- **Frontend**: Process page (operator stock, base on `EthanolProduct.tsx`, Tier 1) + Process dispatch (base on `DDGSDispatch.tsx`) + Sales contracts page (base on `DDGSContracts.tsx`, Tier 2 SAP) + lazy import & routes in `App.tsx` + `modules.ts` entries + `Layout.tsx` group + permission.
- **Sales**: reuse Customer / Sales Order / Invoice / Payment / e-invoice / e-way bill — do NOT build a parallel pipeline.
- **Documents**: reuse `invoice.hbs` (driven by `productName`/`hsnCode`/`unit`; has the Tally round-off line — do NOT fork; legacy `ddgs-invoice.hbs` to be migrated). Reuse the weighbridge slip. Custom challan only if needed, via `renderDocumentPdf()`.
- **Reporting**: Sales Dashboard, Stock Dashboard, Reports; Recharts only (`.claude/skills/design-system-kit/reference/charts-recharts.md`).
- `syncToInventory()` handles StockMovement + StockLevel + journal atomically — never call Prisma directly to adjust stock.

## Testing checklist (run every time)

`cd backend && npx tsc --noEmit` · `cd frontend && npx vite build` · every weighment-keyed table has `sourceWbId @unique` · handler uses upsert, has terminal-status guard, STRICT contract match, ambiguous → `contractId=null`, rate=0 doesn't fake success, invoice is in-tx or has a reconciler, increment gated on status transition · master data added · **idempotency: push the same weighment twice CONCURRENTLY** (1 record/invoice/increment) · PO race (2 trucks, same PO line) · fuzzy-match trap (2 similar customer names) · inventory + journal posted · factory dashboard shows SYNCED not ERROR · **run `/codex:rescue` on the new handler before pushing** (race conditions, idempotency holes, missing tx boundaries, hardcoded rates, missing `syncToInventory`, dedup gaps, PushOutcome shape).

## Common mistakes

Don't create a new endpoint (use the `/push` dispatcher) · don't bypass `syncToInventory()` · don't hardcode rates · don't forget `category` on InventoryItem · don't skip dedup · don't forget to add the handler to `detectHandler` · don't deploy without testing all 8 existing types · don't `findFirst→create` for dedup · don't fuzzy-match contracts · don't put revenue creation behind `setImmediate` · don't overwrite BILLED/RELEASED on retry · don't return success when billing was silently skipped · **don't return `skipped:true` without acking** (the single worst pattern — incident 2026-04-07).

## Known deferred fixes (skim before adding a sellable product)

🟡 DDGS contract picker not authoritative — factory sends `customerName` not `contractId`; cloud re-resolves by name (relink/null risk if contract edited between gate-entry and sync). 🟡 `/api/invoices/:id/pdf` recomputes `supplyType` + hardcoded HSN map — editing a customer state retroactively flips old PDFs; sugar/scrap render wrong HSN (fix: persist `supplyType` + snapshot `hsnCode` on Invoice). 🟡 Factory cache staleness has no upper bound (no ">5 min stale" banner). 🟡 Non-DDGS outbound has no partial-state stub (truck invisible until both weighments). 🟡 `handleNonEthanolOutbound` still `findFirst→create` (add `sourceWbId @unique` + upsert). 🟢 FIXED: invoice counter race; DDGS contract oversubscription race.
