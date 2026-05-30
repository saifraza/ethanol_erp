# Weighment Corrections — UI/Data Spec (SHARED SSoT)

> This is the shared source of truth for weighment corrections. The `correct-weighment` skill references this file — point here, don't restate it. See SKILL.md for the system overview.

## Problem & philosophy

Gate-entry operators make mistakes (wrong material/PO/party, vehicle-no typo, frozen-digitizer captures). The old fix was raw Prisma/SQL from the dev machine — no audit trail, only the developer could do it, no downstream-consistency check, no propagation to the factory DB (split-brain), zero visibility.

Principles: **Cloud is master for edits** (factory never initiates; admin UI on cloud; factory is a receiver). **Never silent** — every correction writes a `WeighmentCorrection` audit row. **Blockers are loud** — disallowed corrections show exactly what must be reversed first; no partial writes. **Phased** — Phase 1 only edits fields that don't require reversing downstream records.

## Phase 1 scope — editable fields (GrainTruck / inbound only)

Editable: `materialType`/`materialId`, `supplier`, `poId`+`poLineId` (new PO must have capacity ≥ net), `vehicleNo`, `driverName`/`driverMobile`/`transporterName`, `remarks`/`bags`, and **Cancel** (sets a flag, keeps record). NOT editable in Phase 1: weights (`weightGross/Tare/Net/quarantineWeight` — break stock post-GRN), `ticketNo`/`date`/`createdAt` (immutable for audit), `direction`, `uidRst`, `labSampleId`/`grnId` (system-set).

## Blockers — correction DENIED (first match wins)

1. `grnId` set → "GRN #{grnNo} posted. Reverse the GRN first."
2. Payment made against the linked GRN → "Vendor payment #{ref} made. Reverse payment first."
3. Vendor invoice linked to the GRN → "Vendor invoice #{no} linked. Cancel invoice first."
4. Already cancelled → "Cannot edit a cancelled weighment."
5. Record > 30 days old AND no admin override PIN → "Admin PIN required for aged records." (NOT hard — PIN overrides.)

Non-blocker validations: new material must exist in `InventoryItem`; new PO `APPROVED`/`PARTIALLY_RECEIVED` (not CLOSED/CANCELLED) with a line matching the material; new supplier non-empty.

## Audit schema (cloud Prisma)

`WeighmentCorrection`: `id`, `weighmentKind` ("GrainTruck"|"DispatchTruck"), `weighmentId`, `ticketNo?`, `vehicleNo?`, `fieldName`, `oldValue?`/`newValue?` (JSON snapshots), `reason` (min 10 chars), `correctedBy`, `correctedByRole`, `adminPinUsed`, `factorySynced`/`factorySyncedAt`/`factoryError?`, `createdAt`. Indexes: `weighmentId`, `createdAt`, `ticketNo`.

## Architecture (push, not pull)

```
Admin @ app.mspil.in/admin/weighment-corrections
  → PUT /api/weighbridge/admin/correct/:id { fields, reason, adminPin? }
  → Cloud: check ADMIN → check blockers → validate → $transaction(write audit + update GrainTruck + recalc POLine)
  → fire-and-forget POST factory /api/weighbridge/correction (X-WB-Key) { factoryLocalId, fields }
  → Factory: verify key → update Weighment in local DB → log → ACK 200
```
Push (not pull) because factory has intermittent connectivity; cloud is authoritative and queues + retries when factory is offline. **Idempotency**: factory records `correctionId`; a duplicate id is ignored (returns 409).

## Cloud → factory matching

Cloud `GrainTruck.id` ≠ factory `Weighment.id` (different UUIDs). Phase 1 link key: **`factoryLocalId String?`** column on GrainTruck — factory push writes its local `Weighment.localId` there; corrections join on it. Nullable so existing rows don't break. (Fallback: `ticketNo` + approx `vehicleNo` + `createdAt` within 24h.)

## API endpoints

**Cloud (ADMIN only):**
- `GET /api/weighbridge/admin/correctable?limit&offset&search&from&to` — recent GrainTrucks each with `canEdit` + `blockers[]` so the UI greys the Edit button with a tooltip.
- `PUT /api/weighbridge/admin/correct/:id` — body `{fields:{...}, reason, adminPin?}`; returns updated GrainTruck + audit rows; 403 non-admin, 422 + blocker list if blocked, 400 validation.
- `POST /api/weighbridge/admin/cancel/:id` — `{reason, adminPin?}`; sets `cancelled=true`, decrements `POLine.receivedQty` if PO linked; writes audit `fieldName="cancel"`.
- `GET /api/weighbridge/admin/corrections/:weighmentId` — full audit trail.

**Factory (X-WB-Key):**
- `POST /api/weighbridge/correction` — body `{correctionId, factoryLocalId, fields:{materialName,materialCategory,supplierName,vehicleNo,remarks}, cancel}`. Looks up `Weighment` by `localId`, applies fields, inserts `WeighmentCorrectionLog` (dedup by correctionId), `cancel=true → status='CANCELLED'`. 200 with before/after; 404 not found (cloud retries); 409 already applied (idempotent success).

## Field mapping (cloud GrainTruck ↔ factory Weighment)

`materialType→materialName` · `materialId→`(not on factory; derives `materialCategory` from `InventoryItem.category`) · `supplier→supplierName` · `poId→poId` (factory stores the cloud poId) · `vehicleNo→vehicleNo` · `driverName→driverName` · `driverMobile→driverPhone` · `transporterName→transporter` · `remarks→remarks` · `bags→bags` · `cancelled=true→status='CANCELLED'`.

## Frontend UI

Route `/admin/weighment-corrections`. Header (title, date-range, search by vehicle/ticket); KPI strip (Total / Editable / Blocked / Cancelled Today); table (ticket | date | vehicle | supplier | material | net | status | action); action column Edit (disabled w/ tooltip if blocked) / Cancel / History. Edit modal: current values left, editable right; material autocomplete (InventoryItem), supplier autocomplete (Vendor), PO dropdown (APPROVED/PARTIALLY_RECEIVED only), text inputs, **Reason** textarea (min 10 chars, required), Admin PIN field (only if >30d), Save disabled until reason + required PIN. History modal: timeline.

## Gotchas

1. PO line capacity: new PO line `pendingQty ≥ weightNet` or block save.
2. PO change decrements old PO's `receivedQty` and increments new — hence the transaction.
3. Factory unreachable: cloud commits anyway, `factorySynced=false` + `factoryError`; 60s retry sweep; show a "Factory not yet synced" badge.
4. Material RM↔FUEL change must also update `materialCategory` (factory routing differs: lab required for RM, not FUEL).
5. GRN exists + cancel → must reverse GRN; Phase 1 blocks, Phase 3 handles.
6. Concurrent edits: last write wins; audit shows both; Phase 2 adds `updatedAt` version check.
7. Enforce real reasons (reject "fix"/"typo").

## Deploy plan

Cloud (auto on push to main): add `WeighmentCorrection` model + `factoryLocalId` — **register in SchemaDriftGuard, NOT `prisma db push --accept-data-loss`** (see repo CLAUDE.md); route `weighbridgeAdmin.ts` + register in `app.ts`; page `WeighmentCorrections.tsx` + lazy route. Factory (via `./factory-server/scripts/deploy.sh`): add the correction endpoint + local `WeighmentCorrectionLog` table + `prisma generate`. Both sides are additive → rollback = revert commits.

## Testing checklist

Admin opens page / non-admin 403 · list shows blocker badges · edit saves with reason · audit row appears · factory reflects within 5s · slip reprints · GRN record shows blocker + disabled Edit · cancel sets flag + audit · >30d prompts PIN · PO change reassigns `receivedQty` on both lines · factory offline → cloud succeeds, `factorySynced=false`, retry picks up · concurrent edit → both audit rows, last wins.

## Future phases

Phase 2 weight corrections (behind GRN/invoice/payment checks). Phase 3 GRN reversal + re-post. Phase 4 outbound DispatchTruck corrections with e-invoice/e-way-bill cancellation. Phase 5 bulk corrections.

---

## CLI corrections for outbound / non-grain (Saif-only, field-ops)

Until Phase 4 ships, the admin UI does NOT support corrections on DDGS / Ethanol / Sugar / DispatchTruck / non-ethanol outbound (it silently filters them out). For a direct CLI correction (e.g. "fix vehicle number on ticket T-XXXX"), use `backend/scripts/correct-t0397-vehicle.ts` as the reference template.

**Cloud audit FK constraint:** `WeighmentCorrection.weighmentId` has a Postgres FK to `GrainTruck.id` ONLY (despite the polymorphic `weighmentKind`). `prisma.weighmentCorrection.create({weighmentId:<DDGSDispatchTruck.id>})` throws **P2003 `WeighmentCorrection_grainTruck_fkey`**. Workaround for outbound: skip `WeighmentCorrection.create()`; append an audit stamp (timestamp, admin, old→new, reason, correctionId UUID) to the source row's `remarks`; rely on factory `WeighmentCorrectionLog` for the factory-side audit. (Lift in Phase 4.)

**Verified end-to-end flow (T-0397, 2026-04-14):**
1. Lookup: Weighment mirror by `ticketNo` (id, localId, rawPayload); DDGSDispatchTruck by `sourceWbId = mirror.localId`; Invoice by `invoiceNo`.
2. **Hard-stop guards**: payment made / IRN generated (`invoice.irn`) / EWB generated (`invoice.ewayBill`/`ewbNo`/`shipment.ewayBill`) / shipment DELIVERED|RECEIVED.
3. Build the audit-stamp string.
4. Cloud `$transaction`: Weighment mirror update `vehicleNo` + `rawPayload.vehicleNo` + `mirrorVersion++`; DDGSDispatchTruck update `vehicleNo` + append `remarks`.
5. POST factory `/api/weighbridge/correction` (header `x-wb-key`): `{correctionIds:[uuid], factoryLocalId: mirror.localId (NOT mirror.id), ticketNo, vehicleNo:NEW, fields:{vehicleNo:NEW}}` → factory updates local Weighment + writes `WeighmentCorrectionLog`.
6. Verify by re-reading cloud mirror + DDGS + Invoice.

**Reprint**: factory reprint endpoints (`/api/weighbridge/print/gate-pass|gross-slip|final-slip/:id`) read `w.vehicleNo` directly — operators hit Reprint, no restart.

**Invoice vehicle field**: cloud `Invoice` has no `vehicleNo` column; EWB inherits it from `DDGSDispatchTruck.vehicleNo` at EWB-creation time. EWB not yet generated → correcting DDGSDispatchTruck is enough; already generated → cancel + regenerate EWB (hard stop, escalate).

**Also update** if the DDGS truck is `BILLED`+: `DDGSContractDispatch.vehicleNo` (snapshot set in `ddgsInvoiceService.ts`).

**Audit-trail locations (DDGS outbound):** `DDGSDispatchTruck.remarks` (full stamp, grep/LIKE) · factory `WeighmentCorrectionLog` (correctionId, ticketNo, vehicleNo, fieldName, newValueJson) · `Weighment.mirrorVersion` (bumped) · `Weighment.rawPayload.vehicleNo`. No cloud `WeighmentCorrection` row (FK blocker).

**Don't need to regenerate:** Invoice PDF (on-demand from `truck.vehicleNo`) · gate-pass/challan PDF (on-demand) · WB-PC local SQLite (no correction push; WB PC purges synced records — verify `SELECT * FROM weighments WHERE ticket_no=X` first) · IRN/EWB if already generated with old vehicle are immutable (cancel + regenerate, hard stop).
