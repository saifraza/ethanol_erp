---
name: correct-weighment
description: Safely edit or cancel a production weighment (vehicle, supplier, material, PO, etc.) with guard checks, multi-system sync, factory push, and a full audit trail. Use when Saif says "correct weighment", "fix ticket X", "edit weighment", or "cancel ticket X". HIGH-RISK CLI action — mutates production weighments across cloud mirror + source table + factory + audit; wrong edit breaks accounting, inventory, invoicing, Tally, and e-invoice.
when_to_use: Manual only (/correct-weighment). Triggers like "Ticket 89 vehicle should be MP09HH5377", "Fix ticket 142 supplier to SHARMA TRADERS", "Cancel ticket 200, duplicate entry".
disable-model-invocation: true
---

# Weighment Correction

> Owner: Saif only — CLI skill, no UI access for team.
> Risk: HIGH — wrong edit breaks accounting, inventory, invoicing, Tally, e-invoice.

The full field-by-field spec, source-table routing, factory field-name mapping, and known limitations live in the shared spec — **do not restate it here, read it before acting:**
**`.claude/skills/weighbridge/corrections-spec.md`**

## 🚨 Hard rules — NEVER / ALWAYS

1. **PAYMENT_MADE guard = HARD ALARM. NEVER bypass.** If a guard returns `PAYMENT_MADE`, vendor payment is already cleared against this weighment's GRN. Editing would orphan the payment journal entry. STOP and emit the escalation below verbatim. Do NOT offer workarounds. Do NOT suggest direct DB edits. The reversal must go through the proper accounting flow first.
2. **NEVER do a raw DB update on one table.** Every correction MUST update ALL systems (see below). Inconsistent data across systems is worse than the original error.
3. **NEVER bypass guards.** If any blocker is returned, tell Saif what to reverse first, then stop.
4. **NEVER edit weights** (grossWeight, tareWeight, netWeight) — they come from the physical scale.
5. **NEVER edit timestamps** (gateEntryAt, firstWeightAt, secondWeightAt) — factory clock.
6. **NEVER edit ticketNo or factoryLocalId** — dedup keys.
7. **NEVER edit grnId, labSampleId, contractId, liftingId** — system-generated FKs.
8. **NEVER edit status** — use workflow endpoints (gate entry, weighment, release).
9. **NEVER touch Oracle, WtService, or any factory Windows service.**
10. **ALWAYS write a WeighmentCorrection audit row** (one per changed field) with a reason ≥ 10 chars.
11. **ALWAYS fire the admin notification** after applying.

## PAYMENT_MADE escalation (emit verbatim, then stop)

```
PAYMENT ALREADY MADE — CANNOT EDIT

Ticket T-{N} is linked to GRN-{grnNo} which has vendor payment cleared.
Editing supplier/material/PO would orphan the payment journal entry.

To fix this weighment, you MUST first:
1. Reverse the vendor payment (Accounts → Vendor Payments → find payment → Reverse)
2. Cancel the vendor invoice if one exists (Procurement → Vendor Invoices → Cancel)
3. Then come back and re-run this correction

This is a finance-impacting reversal. Coordinate with accounts team before proceeding.
```

## Four systems — update ALL (mandatory)

Every correction updates all four. If a system is unreachable, proceed with cloud + audit but log `factorySynced: false`.

1. **Source table** — GrainTruck / GoodsReceipt / DispatchTruck / DDGSDispatchTruck
2. **Cloud Weighment mirror** (`Weighment` table — `vehicleNo`, `supplierName`, etc.)
3. **Factory Weighment** — push to the factory `/api/weighbridge/correction` endpoint, match by `ticketNo`
4. **WeighmentCorrection audit row** — one per changed field (oldValue, newValue, reason, timestamp)

## Source-table routing (cloud `Weighment` mirror is the single lookup)

Every weighment has `localId` (factory Weighment UUID) and `ticketNo`.

| Mirror condition | Source table | Find source by |
|---|---|---|
| INBOUND + RAW_MATERIAL | GrainTruck | `factoryLocalId = mirror.localId` OR `ticketNo = mirror.ticketNo` |
| INBOUND + FUEL | GoodsReceipt | `remarks CONTAINS 'Ticket #N'`, N = mirror.ticketNo |
| OUTBOUND + ETHANOL | DispatchTruck | `sourceWbId = mirror.localId` |
| OUTBOUND + DDGS | DDGSDispatchTruck | `sourceWbId = mirror.localId` |

Full safe-field tables per source, the cloud→factory field-name map, and the GoodsReceipt FK limitation: see **`.claude/skills/weighbridge/corrections-spec.md`**. Quick reminders: `purchaseType` is CONDITIONAL (only flip the mirror when the PO's `dealType` already matches — see T-502, 2026-04-16); `destination`/`partyName` on dispatch are SAFE only if no invoice is linked (EWB immutable).

## Guard functions

In `backend/src/shared/weighment/correctionGuards.ts`:

- `checkGrainTruckCorrectable(id)` — NOT_FOUND, ALREADY_CANCELLED, PAYMENT_MADE, INVOICE_LINKED, GRN_CONFIRMED, AGED_RECORD
- `checkGoodsReceiptCorrectable(id)` — NOT_FOUND, ALREADY_CANCELLED, PAYMENT_MADE, INVOICE_LINKED, GRN_CONFIRMED, AGED_RECORD
- `checkDispatchTruckCorrectable(id)` — NOT_FOUND, ALREADY_CANCELLED, INVOICE_LINKED, SHIPMENT_RELEASED, AGED_RECORD
- `checkDDGSDispatchTruckCorrectable(id)` — NOT_FOUND, INVOICE_LINKED, BILLED, AGED_RECORD

Any blocker → STOP, tell Saif what must be reversed first. (PAYMENT_MADE → escalation above.)

## Execution steps

1. **Lookup** the mirror row by `ticketNo`, then find the source record via the routing table.
   ```typescript
   const mirror = await prisma.weighment.findFirst({
     where: { ticketNo: TICKET_NUMBER },
     select: { id: true, localId: true, ticketNo: true, vehicleNo: true, direction: true,
               materialCategory: true, materialName: true, supplierName: true, customerName: true,
               grossWeight: true, tareWeight: true, netWeight: true, status: true, cancelled: true }
   });
   ```
2. **Guard check** — call the matching guard. Any blocker → report + stop.
3. **Confirm with Saif** — show ticket #, vehicle, supplier/customer, material, net weight; source type; field → old → new; warnings; guard result. Wait for confirmation.
4. **Apply edit** in one `prisma.$transaction`:
   - Update source table.
   - Write one `WeighmentCorrection` audit row per changed field (`weighmentKind`, `weighmentId`, `ticketNo`, `vehicleNo`, `fieldName`, `oldValue`/`newValue` JSON-stringified, `reason` ≥10 chars, `correctedBy: 'Saif Raza'`, `correctedByRole: 'ADMIN'`, `adminPinUsed: false`).
   - Update the `Weighment` mirror — only the changed fields.
5. **Push to factory** via the `pushCorrectionToFactory` pattern in `weighbridgeAdmin.ts`:
   ```typescript
   await fetch(`${FACTORY_SERVER_URL}/api/weighbridge/correction`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', 'X-WB-Key': WB_PUSH_KEY },
     body: JSON.stringify({ correctionIds, factoryLocalId: mirror.localId, ticketNo: mirror.ticketNo,
       vehicleNo: mirror.vehicleNo, fields: { /* mapped to factory names */ }, cancel: false }),
     signal: AbortSignal.timeout(10_000),
   });
   ```
   Mark audit rows `factorySynced: true` on success, else `factorySynced: false` + `factoryError`. (Field-name map + GoodsReceipt FK caveat in the spec.)
6. **Admin notification** — `notify()` from `backend/src/services/notify.ts`: category `WEIGHMENT`, severity `WARNING`, role `ADMIN`, link `/admin/weighment-corrections`.
7. **Report** — field old→new, source record updated, mirror updated, factory push status, notification sent.

## Cancel flow

Same steps, but:
- Guard first (cancelled records can't be re-cancelled).
- Source: set `cancelled=true, cancelledReason, cancelledAt, cancelledBy` (GrainTruck/DispatchTruck) or `status='CANCELLED'` (GoodsReceipt). DDGSDispatchTruck has NO `cancelled` field → set `status='CANCELLED'` (verify the value is valid for the model first).
- Audit row: `fieldName='cancel'`, `oldValue='false'`, `newValue='true'`.
- Factory push: `cancel: true, cancelReason: reason`.
- Notification: severity `CRITICAL`, title `Weighment T-{N} CANCELLED`.

## Environment

- Cloud DB: Prisma (`backend/prisma/schema.prisma`)
- Factory API: factory server on Tailscale (`FACTORY_SERVER_URL`), authed with `X-WB-Key` header (`WB_PUSH_KEY` env var). Host/IP + key value: see the out-of-git fleet doc `~/Desktop/infra/fleet.md`. Never hardcode them in this skill.
- Admin PIN: `process.env.CLOUD_ADMIN_OVERRIDE_PIN` (fallback value out of git; do not write it here).
- Notification: `notify()` from `backend/src/services/notify.ts`
- Guards: `backend/src/shared/weighment/correctionGuards.ts`
- Audit model: `WeighmentCorrection`; Mirror model: `Weighment`

## Running a correction (ad-hoc)

The skill is the knowledge; execution is a one-off script you delete after.
1. `cd backend`
2. Write a one-off script that imports Prisma from `./config/prisma`, looks up the mirror by ticketNo, identifies the source, runs the matching guard, and (if clear) updates source + writes audit + updates mirror + pushes to factory + fires notification.
3. `npx ts-node scripts/correct-weighment.ts`
4. Delete the script (not committed). Or inline via `node -e`.
