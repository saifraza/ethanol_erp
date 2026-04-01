---
name: Tech Debt Register
description: Known technical debt items with severity, location, and fix direction — check when working near weighbridge, gate entry, inventory sync, or factory boundaries
type: skill
---

# Tech Debt Register

Last verified: 2026-04-01

## DEBT-001: weighbridge.ts god-route (P0)
**File**: `backend/src/routes/weighbridge.ts` (1332 lines)
**System**: Cloud ERP
**Problem**: Single route file contains: GRN creation, PO line matching, inventory sync (weighted-average-cost), DirectPurchase creation, DDGSDispatch creation, weighment corrections with GRN updates, lab results pull, master data serving, heartbeat tracking, system status dashboard, factory user proxy.
**Risk**: Any change to procurement/inventory/DDGS logic requires touching this file. High merge conflict risk. Business logic buried in HTTP handler.
**Fix direction**: Extract to services:
- `backend/src/services/weighbridgeIngest.ts` — /push business logic (GRN, inventory, PO matching, DirectPurchase, DDGSDispatch)
- `backend/src/services/weighbridgeCorrections.ts` — PUT correction logic with GRN/inventory adjustment
- Keep `weighbridge.ts` as thin HTTP handler calling these services
**When to fix**: Next time someone needs to modify weighment→GRN flow or inventory sync

## DEBT-002: Gate entry duplication (P1)
**Files**: `factory-server/src/routes/gateEntry.ts` (88 lines) AND `backend/src/routes/gateEntry.ts` (122 lines)
**Systems**: Factory Server + Cloud ERP
**Problem**: Two independent gate entry systems, not synchronized. Factory creates entries locally, cloud has its own CRUD.
**Fix direction**: Factory server is source of truth for gate entry (operators use it). Cloud should receive gate entries via syncWorker push, not have independent creation. Remove cloud-side POST once factory app is the sole entry point.
**When to fix**: After factory app migration is complete and stable

## DEBT-003: Inventory sync logic duplicated (P1)
**File**: `backend/src/routes/weighbridge.ts` lines 62-160 (`syncToInventory` function)
**System**: Cloud ERP
**Problem**: Weighted-average-cost calculation and StockLevel/StockMovement creation is copy-pasted from `goodsReceipts.ts`. Two copies of the same math.
**Fix direction**: Extract to `backend/src/services/inventorySync.ts`, import from both `weighbridge.ts` and `goodsReceipts.ts`
**When to fix**: When touching either weighbridge.ts or goodsReceipts.ts inventory logic

## DEBT-004: syncWorker field mapping drift (P1)
**File**: `factory-server/src/services/syncWorker.ts` lines 37-55
**System**: Factory Server → Cloud
**Problem**: Cloud push payload maps `po_id` from `supplierId` (wrong — should be cloud PO UUID), sends `ticket_no: 0` (factory doesn't track tickets yet). Cloud-side `weighmentSchema` expects these fields to be meaningful.
**Fix direction**: Add `cloudPoId` field to factory Weighment model. Map correctly when operator selects PO from cached master data. Track ticket numbers in factory server.
**When to fix**: When building the GrossWeighment/TareWeighment pages (factory app migration)

## DEBT-005: Separate Prisma schemas (P2)
**Files**: `factory-server/prisma/schema.prisma` (18 models) vs `backend/prisma/schema.prisma` (76+ models)
**Systems**: Factory Server + Cloud ERP
**Problem**: Both connect to same Railway PostgreSQL but schemas are maintained separately. Risk of table naming collision or migration conflict.
**Status**: Acceptable for now — factory server only touches its own tables (prefixed with Factory/Cached/Weighment). Monitor for conflicts.
**When to fix**: If table naming collision or migration conflict occurs

## DEBT-006: Cross-system API contracts undocumented (P2)
**Systems**: All three
**Problem**: 6+ cross-system API boundaries exist with payload shapes defined only in code:
1. Factory→Cloud weighment push (`POST /api/weighbridge/push`)
2. Factory→Cloud heartbeat (`POST /api/weighbridge/heartbeat`)
3. Cloud→Factory master data (`GET /api/weighbridge/master-data`)
4. Cloud→Weighbridge lab results (`POST /api/weighbridge/lab-results`)
5. Cloud↔Factory user proxy (`/api/weighbridge/factory-users`)
6. Cloud↔WhatsApp worker (proxy via `whatsappClient.ts`)
7. Cloud↔OPC bridge (`opcBridge.ts`)
**Mitigation**: Key contracts (1-4) documented in `.claude/skills/weighbridge-system.md` "Cross-System API Contracts" section. Others documented in respective skill files.
**When to fix**: Incrementally — document each contract when modifying that boundary

## DEBT-007: WtService/serial mode contradiction in docs (P2)
**Files**: All 4 factory skill files had conflicting statements about WtService status
**Problem**: `factory-linkage.md` said "disabled, serial mode", `weighbridge-system.md` said "re-enabled, file mode", `factory-server.md` said "never re-enable"
**Truth (as of 2026-04-01)**: WtService IS re-enabled (disabling it halted the plant on 2026-03-31). Python runs in FILE mode (`WB_PROTOCOL=file` env var). Serial mode works but conflicts with WtService on COM1.
**Status**: Fixed in skill file consolidation. `factory-architecture.md` and `weighbridge-system.md` now tell the same story.
