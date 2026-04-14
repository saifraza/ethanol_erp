# Weighment Correction Skill

> **Owner**: Saif only — CLI skill, no UI access for team.
> **Trigger**: User says "correct weighment", "fix ticket X", "edit weighment", or `/correct-weighment`
> **Risk level**: HIGH — wrong edit breaks accounting, inventory, invoicing, Tally, e-invoice.

## MANDATORY — Update ALL Systems + Audit Trail

**NEVER do a raw DB update on one table.** Every correction MUST update ALL of these:

1. **Source table** (GrainTruck / DDGSDispatchTruck / DispatchTruck / GoodsReceipt)
2. **Cloud Weighment mirror** (`Weighment` table — `vehicleNo`, `supplierName`, etc.)
3. **Factory Weighment** (SSH to 100.126.101.7, Prisma `weighment` model, match by `ticketNo`)
4. **WeighmentCorrection audit row** (one per changed field — oldValue, newValue, reason, timestamp)

If any system is unreachable, proceed with cloud + audit but log `factorySynced: false`.
**Inconsistent data across systems is worse than the original error.**

## How To Use

Saif tells you what to fix. Examples:
- "Ticket 89 vehicle should be MP09HH5377"
- "Fix ticket 142 supplier to SHARMA TRADERS"
- "Cancel ticket 200, duplicate entry"

You:
1. Look up the ticket in the cloud Weighment mirror
2. Identify the source table (GrainTruck / GoodsReceipt / DispatchTruck / DDGSDispatchTruck)
3. Run the appropriate guard check
4. Show Saif what will change (before → after) and any warnings
5. On confirmation, apply the edit via Prisma, write audit rows, update mirror, push to factory
6. Fire admin notification
7. Report back

## Source Table Routing

The cloud `Weighment` mirror is the single lookup table. Every weighment has a `localId` (factory Weighment UUID) and `ticketNo`.

| Mirror Field | Source Table | How to Find Source Record |
|---|---|---|
| `direction=INBOUND, materialCategory=RAW_MATERIAL` | GrainTruck | `factoryLocalId = mirror.localId` OR `ticketNo = mirror.ticketNo` |
| `direction=INBOUND, materialCategory=FUEL` | GoodsReceipt | `remarks CONTAINS 'Ticket #N'` where N = mirror.ticketNo |
| `direction=OUTBOUND, materialCategory=ETHANOL` | DispatchTruck | `sourceWbId = mirror.localId` |
| `direction=OUTBOUND, materialCategory=DDGS` | DDGSDispatchTruck | `sourceWbId = mirror.localId` |

## Safe Fields Per Source

### GrainTruck (grain inbound)
| Field | Safe? | Notes |
|---|---|---|
| `materialType` / `materialId` | SAFE | Guard blocks if GRN confirmed. If materialId changes, validate InventoryItem exists + isActive |
| `supplier` | SAFE | Guard blocks if payment made. Syncs to Weighment.supplierName |
| `poId` | SAFE | Guard blocks if invoice linked. Syncs supplier from PO.vendor.name |
| `vehicleNo` | SAFE | Metadata |
| `driverName` / `driverMobile` | SAFE | Metadata |
| `transporterName` | SAFE | Metadata |
| `remarks` | SAFE | Informational |
| `bags` | SAFE | Metadata |
| weights, timestamps, ticketNo, factoryLocalId, grnId, labSampleId, uidRst | **NEVER** | Immutable from scale/lab/system |

### GoodsReceipt (fuel inbound)
| Field | Safe? | Notes |
|---|---|---|
| `vehicleNo` | SAFE | Metadata |
| `driverName` / `driverMobile` | SAFE | Metadata |
| `transporterName` | SAFE | Metadata |
| `remarks` | SAFE | Informational |
| `vendorId` / `poId` / `invoiceNo` / `status` / weights | **NEVER** | Tied to PO, inventory, payments. Use PO/GRN screens instead |

### DispatchTruck (ethanol outbound)
| Field | Safe? | Notes |
|---|---|---|
| `vehicleNo` | SAFE | Metadata |
| `driverName` / `driverPhone` / `driverLicense` | SAFE | Metadata |
| `transporterName` | SAFE | Metadata |
| `destination` | SAFE if no invoice | Guard blocks if invoice linked (EWB immutable) |
| `remarks` | SAFE | Informational |
| `partyName` | SAFE if no invoice | Guard blocks if invoice linked |
| weights, timestamps, status, contractId, liftingId, sourceWbId, quantityBL | **NEVER** | Scale/workflow/contract immutable |

### DDGSDispatchTruck (DDGS outbound)
| Field | Safe? | Notes |
|---|---|---|
| `vehicleNo` | SAFE | Metadata |
| `driverName` / `driverMobile` | SAFE | Metadata |
| `transporterName` | SAFE | Metadata |
| `destination` | SAFE if no invoice | Guard blocks if invoiceNo set |
| `remarks` | SAFE | Informational |
| `partyName` | SAFE if no invoice | Guard blocks if invoiceNo set |
| weights, timestamps, status, contractId, sourceWbId, bags, rate | **NEVER** | Scale/workflow/contract immutable |

## Guard Functions

Located in `backend/src/shared/weighment/correctionGuards.ts`:

- `checkGrainTruckCorrectable(id)` — NOT_FOUND, ALREADY_CANCELLED, PAYMENT_MADE, INVOICE_LINKED, GRN_CONFIRMED, AGED_RECORD
- `checkGoodsReceiptCorrectable(id)` — NOT_FOUND, ALREADY_CANCELLED, PAYMENT_MADE, INVOICE_LINKED, GRN_CONFIRMED, AGED_RECORD
- `checkDispatchTruckCorrectable(id)` — NOT_FOUND, ALREADY_CANCELLED, INVOICE_LINKED, SHIPMENT_RELEASED, AGED_RECORD
- `checkDDGSDispatchTruckCorrectable(id)` — NOT_FOUND, INVOICE_LINKED, BILLED, AGED_RECORD

If guard returns blockers → **STOP. Tell Saif what's blocking and what must be reversed first.** Do NOT bypass guards.

**CRITICAL ESCALATION — PAYMENT_MADE blocker:**
If the guard returns `PAYMENT_MADE`, this means vendor payment has already been cleared against this weighment's GRN. This is the most dangerous state — editing the weighment would orphan the payment in the GL. Response must be:

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

Do NOT offer workarounds. Do NOT suggest direct DB edits. The payment reversal must go through the proper accounting flow.

## Execution Steps

### Step 1: Lookup

```typescript
// Find mirror row
const mirror = await prisma.weighment.findFirst({
  where: { ticketNo: TICKET_NUMBER },
  select: { id: true, localId: true, ticketNo: true, vehicleNo: true, direction: true,
            materialCategory: true, materialName: true, supplierName: true, customerName: true,
            grossWeight: true, tareWeight: true, netWeight: true, status: true, cancelled: true }
});
```

Then find the source record based on routing table above.

### Step 2: Guard Check

Call the appropriate guard function. If ANY blocker is returned, report it to Saif and stop.

### Step 3: Confirm With Saif

Show:
- Ticket #, vehicle, supplier/customer, material, net weight
- Source type (GRAIN_TRUCK / GOODS_RECEIPT / ETHANOL_DISPATCH / DDGS_DISPATCH)
- What will change: field → old value → new value
- Any warnings (e.g., "GRN exists but not yet confirmed — edit is safe")
- Guard result: all clear / PIN required

Wait for Saif to confirm.

### Step 4: Apply Edit

In a single `prisma.$transaction`:

1. **Update source table** (GrainTruck / GoodsReceipt / DispatchTruck / DDGSDispatchTruck)
2. **Write WeighmentCorrection audit rows** — one per changed field:
   ```typescript
   await tx.weighmentCorrection.create({
     data: {
       weighmentKind: 'GrainTruck', // or 'GoodsReceipt', 'DispatchTruck', 'DDGSDispatchTruck'
       weighmentId: sourceRecord.id,
       ticketNo: mirror.ticketNo,
       vehicleNo: mirror.vehicleNo,
       fieldName: 'supplier',
       oldValue: JSON.stringify(before.supplier),
       newValue: JSON.stringify(newSupplier),
       reason: reasonFromSaif, // min 10 chars
       correctedBy: 'Saif Raza',
       correctedByRole: 'ADMIN',
       adminPinUsed: false,
     },
   });
   ```
3. **Update Weighment mirror** — sync the changed fields to the mirror row:
   ```typescript
   await tx.weighment.update({
     where: { id: mirror.id },
     data: {
       vehicleNo: newVehicleNo, // only fields that changed
       supplierName: newSupplier,
       // etc.
     },
   });
   ```

### Step 5: Push to Factory

Use the existing `pushCorrectionToFactory` pattern from `weighbridgeAdmin.ts`:

```typescript
const FACTORY_SERVER_URL = 'http://100.126.101.7:5000';
const WB_PUSH_KEY = 'mspil-wb-2026';

const resp = await fetch(`${FACTORY_SERVER_URL}/api/weighbridge/correction`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-WB-Key': WB_PUSH_KEY },
  body: JSON.stringify({
    correctionIds: auditRowIds,
    factoryLocalId: mirror.localId,
    ticketNo: mirror.ticketNo,
    vehicleNo: mirror.vehicleNo,
    fields: { /* cloud field names mapped to factory names */ },
    cancel: false,
  }),
  signal: AbortSignal.timeout(10_000),
});
```

**Cloud → Factory field name mapping:**
| Cloud | Factory |
|---|---|
| `materialType` | `materialName` |
| `materialName` | `materialName` (direct passthrough) |
| `materialCategory` | `materialCategory` |
| `supplier` | `supplierName` |
| `poId` | `poId` |
| `poLineId` | `poLineId` |
| `vehicleNo` | `vehicleNo` |
| `driverName` | `driverName` |
| `driverMobile` | `driverPhone` |
| `transporterName` | `transporter` |
| `remarks` | `remarks` |
| `bags` | `bags` |

Mark audit rows as `factorySynced: true` on success, `factorySynced: false` + `factoryError` on failure.

**KNOWN LIMITATION — GoodsReceipt (fuel) audit rows:**
The `WeighmentCorrection` model has a FK (`weighmentId` → `GrainTruck.id`) that prevents inserting audit rows for fuel corrections (GoodsReceipt source). For fuel corrections:
- Skip cloud audit row creation (FK prevents it)
- The GoodsReceipt.remarks field already contains correction notes (added by the correction flow that updated the GRN)
- Factory push still works normally via `/api/weighbridge/correction`
- TODO: Schema fix — make `weighmentId` FK optional or polymorphic to support all source types

### Step 6: Admin Notification

```typescript
import { notify } from '../services/notify';

await notify({
  category: 'WEIGHMENT',
  severity: 'WARNING',
  title: `Weighment T-${ticketNo} corrected`,
  message: `${Object.keys(fieldsChanged).join(', ')} changed by Saif Raza. Reason: ${reason}`,
  role: 'ADMIN',
  link: '/admin/weighment-corrections',
  entityType: 'Weighment',
  entityId: mirror.id,
  metadata: { ticketNo, source: sourceType, fieldsChanged, factorySynced: true },
});
```

### Step 7: Report

Tell Saif:
- What was changed (field: old → new)
- Source record updated (GrainTruck/GoodsReceipt/DispatchTruck/DDGSDispatchTruck ID)
- Weighment mirror updated
- Factory push status (synced / failed — will retry)
- Notification sent

## Cancel Flow

Same steps but:
- Guard check first (same guards — cancelled records can't be re-cancelled)
- Source table: set `cancelled=true, cancelledReason, cancelledAt, cancelledBy` (GrainTruck/DispatchTruck) or `status='CANCELLED'` (GoodsReceipt)
- DDGSDispatchTruck has NO `cancelled` field — set `status='CANCELLED'` instead (non-standard, but needed — check if this status value is valid for the model first)
- Audit row: `fieldName='cancel'`, `oldValue='false'`, `newValue='true'`
- Factory push: `cancel: true, cancelReason: reason`
- Notification: severity `CRITICAL`, title `Weighment T-{N} CANCELLED`

## What This Skill NEVER Does

1. **Never edit weights** (grossWeight, tareWeight, netWeight) — these come from the physical scale
2. **Never edit timestamps** (gateEntryAt, firstWeightAt, secondWeightAt) — from factory clock
3. **Never edit ticketNo or factoryLocalId** — dedup keys
4. **Never edit grnId, labSampleId, contractId, liftingId** — system-generated FKs
5. **Never bypass guards** — if a blocker exists, tell Saif what to reverse first
6. **Never edit status** — use workflow endpoints (gate entry, weighment, release)
7. **Never touch Oracle, WtService, or any factory Windows service**

## Environment

- Cloud DB: via Prisma (`backend/prisma/schema.prisma`)
- Factory API: `http://100.126.101.7:5000` (Tailscale) with `X-WB-Key: mspil-wb-2026`
- Admin PIN: `process.env.CLOUD_ADMIN_OVERRIDE_PIN || '1234'`
- Notification: `notify()` from `backend/src/services/notify.ts`
- Guard functions: `backend/src/shared/weighment/correctionGuards.ts`
- Audit model: `WeighmentCorrection` in Prisma schema
- Mirror model: `Weighment` in Prisma schema

## Quick Reference: Running a Correction

When Saif says "fix ticket 89 vehicle to XY12AB3456":

1. `cd backend`
2. Write a one-off script that:
   - Imports Prisma client from `./config/prisma`
   - Looks up Weighment mirror by ticketNo=89
   - Identifies source (FUEL → GoodsReceipt)
   - Calls `checkGoodsReceiptCorrectable(grnId)`
   - If clear: updates GoodsReceipt.vehicleNo, writes WeighmentCorrection, updates Weighment mirror, pushes to factory, fires notification
3. Run: `npx ts-node scripts/correct-weighment.ts`
4. Delete the script (one-off, not committed)

Or do it inline via `node -e` with the Prisma client. The skill is the knowledge — execution is ad-hoc.
