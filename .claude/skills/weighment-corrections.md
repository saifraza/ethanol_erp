# Weighment Corrections — Admin UI Spec

## Problem

Gate-entry operators make mistakes (wrong material, wrong PO, wrong party, typo in vehicle no, frozen-digitizer captures). Today the only fix is to SSH into the factory DB or run raw Prisma updates from the dev machine. That's:

- No audit trail
- Only the developer can do it
- No check that downstream records (GRN, invoice, payment) still make sense
- No propagation back to the factory local DB (split-brain risk)
- Zero visibility for anyone else

This skill documents the **Weighment Corrections** admin feature that solves this properly, with guardrails.

## Philosophy

1. **Cloud is master for edits.** Factory never initiates corrections. The admin UI lives on the cloud ERP. The factory server is a receiver — it accepts corrections from cloud and updates its local SQLite.
2. **Never silent.** Every correction writes a `WeighmentCorrection` audit row with old value, new value, reason, admin, timestamp, and admin PIN flag.
3. **Blockers are loud.** If a correction is disallowed (GRN posted, invoice raised, etc), the admin sees a clear list of what needs to be reversed first. No silent failures, no partial writes.
4. **Phased.** Phase 1 only edits fields that don't require reversing downstream records. Phases 2 and 3 come later with stricter guards.

## Phase 1 Scope — what's editable

Only these fields, only on `GrainTruck` (inbound) records for now. Outbound `DispatchTruck` comes in Phase 2.

| Field | Editable? | Conditions |
|---|---|---|
| `materialType` / `materialId` (material name + category) | ✅ | Any time, unless blocked below |
| `supplier` (party name) | ✅ | Unless blocked |
| `poId` + `poLineId` (PO number) | ✅ | New PO must exist + have capacity ≥ net weight |
| `vehicleNo` | ✅ | Always (typos) |
| `driverName`, `driverMobile`, `transporterName` | ✅ | Always |
| `remarks`, `bags` | ✅ | Always |
| **Cancel entire weighment** | ✅ | Unless blocked — sets a `cancelled` flag, keeps record |

**NOT editable in Phase 1** (defer to Phase 2+):

- `weightGross`, `weightTare`, `weightNet`, `quarantineWeight` — weight corrections break stock balances post-GRN
- `ticketNo`, `date`, `createdAt` — timestamps/sequence numbers are immutable for audit
- `direction` (IN/OUT) — would require rebuilding the record from scratch
- `uidRst` — lab sample linking key
- `labSampleId`, `grnId` — set only by system

## Blockers — when a correction is DENIED

Run these checks in order. Return the first match as the reason.

```
BLOCKER 1: grnId is set
  → Message: "GRN has been posted for this weighment (GRN #{grnNo}). Reverse the GRN first before editing."

BLOCKER 2: PO payment has been made against the linked GRN
  → Query VendorPayment/VendorInvoice where GRN is linked. If any payment exists → block.
  → Message: "Vendor payment #{paymentRef} has been made against this GRN. Payment must be reversed first."

BLOCKER 3: Vendor invoice is linked to the GRN
  → Message: "Vendor invoice #{invoiceNo} is linked to this weighment's GRN. Invoice must be cancelled first."

BLOCKER 4: Record is already cancelled
  → Message: "Already cancelled — cannot edit a cancelled weighment."

BLOCKER 5: Record is older than 30 days AND no admin override PIN supplied
  → Message: "Record is {days} days old — admin PIN required to edit aged records."
  → NOT a hard block — admin PIN overrides this one.
```

All other checks are not blockers; they're validations on the new value:
- New material must exist in `InventoryItem`
- New PO must exist and be `APPROVED` or `PARTIALLY_RECEIVED` (not CLOSED/CANCELLED)
- New PO must have a line matching the new material (or be asked to pick a line)
- New supplier name must not be empty

## Audit Schema

New Prisma model on cloud:

```prisma
model WeighmentCorrection {
  id             String   @id @default(uuid())
  weighmentKind  String   // "GrainTruck" | "DispatchTruck" (Phase 1: only GrainTruck)
  weighmentId    String   // FK to GrainTruck.id or DispatchTruck.id
  ticketNo       Int?     // snapshot for audit readability
  vehicleNo      String?  // snapshot
  fieldName      String   // e.g. "materialType", "supplier", "poId", "cancel"
  oldValue       String?  // JSON string snapshot of old value
  newValue       String?  // JSON string snapshot of new value
  reason         String   // mandatory, min 10 chars
  correctedBy    String   // user.name or user.id
  correctedByRole String  // user.role
  adminPinUsed   Boolean  @default(false) // true if the 30-day-old override was used
  factorySynced  Boolean  @default(false) // true after factory-server ACKs the correction
  factorySyncedAt DateTime?
  factoryError   String?  // if sync to factory failed, the error message
  createdAt      DateTime @default(now())

  @@index([weighmentId])
  @@index([createdAt])
  @@index([ticketNo])
}
```

## Architecture

```
┌──────────────────────┐
│  Admin on app.mspil  │
│  .in/admin/weighment │
│  -corrections        │
└──────────┬───────────┘
           │ PUT /api/weighbridge/admin/correct/:id
           │ { fields: {...}, reason, adminPin? }
           ▼
┌──────────────────────┐
│  Cloud Backend       │
│  1. Check user ADMIN │
│  2. Check blockers   │
│  3. Validate inputs  │
│  4. Transaction:     │
│     - Write audit    │
│     - Update GrainTr │
│     - (if PO change) │
│       recalc POLine  │
│  5. Fire-and-forget  │
│     push to factory  │
└──────────┬───────────┘
           │ POST /api/weighbridge/correction
           │ X-WB-Key: ***
           │ { factoryLocalId, fields: {...} }
           ▼
┌──────────────────────┐
│  Factory Server      │
│  1. Verify key       │
│  2. Update Weighment │
│     in local SQLite  │
│  3. Log correction   │
│  4. ACK (200 OK)     │
└──────────────────────┘
```

**Why push instead of pull?** Factory server has intermittent connectivity. Push-with-retry means the cloud is authoritative, and if the factory is offline, the correction queues on cloud and retries on next cloud-to-factory sync cycle.

**Idempotency:** The cloud stores the `WeighmentCorrection.id` and the factory records it in its own correction log table. A duplicate correction with the same id is ignored on the factory side.

## Cloud → Factory matching

The tricky part: cloud `GrainTruck.id` ≠ factory `Weighment.id`. They're different UUIDs. The linking key is:

- `GrainTruck.ticketNo` + approximate match on `vehicleNo` + `createdAt` (within 24h)
- OR `GrainTruck.id` stored in a new column `factoryLocalId` on push

**Decision for Phase 1:** add `factoryLocalId String?` column to GrainTruck. Factory push writes its local Weighment.localId into this field. Correction lookup uses it as the authoritative join key. New column is nullable so existing records don't break.

## API Endpoints

### Cloud

**GET `/api/weighbridge/admin/correctable`**
- Auth: ADMIN role only
- Query: `?limit=50&offset=0&search=&from=&to=`
- Returns: list of recent GrainTrucks with each one's blocker reasons (if any) so the UI can render Edit button greyed out with tooltip

```json
[
  {
    "id": "uuid",
    "ticketNo": 137,
    "vehicleNo": "HR55T2963",
    "supplier": "SIDRA TRADING",
    "materialType": "MUSTARD STALK",
    "weightNet": 21980,
    "date": "2026-04-08T09:19:55Z",
    "grnId": null,
    "cancelled": false,
    "canEdit": true,
    "blockers": []
  },
  {
    "id": "uuid",
    "ticketNo": 130,
    "canEdit": false,
    "blockers": [{ "code": "GRN_POSTED", "message": "GRN GRN-2026-0042 has been posted" }]
  }
]
```

**PUT `/api/weighbridge/admin/correct/:id`**
- Auth: ADMIN role only
- Body:
```json
{
  "fields": {
    "materialType": "RICE HUSK",
    "materialId": "uuid-of-inventory-item",
    "supplier": "ABC Trading",
    "poId": "uuid-of-po",
    "vehicleNo": "HR55T2963",
    "remarks": "Corrected material from operator typo"
  },
  "reason": "Operator selected wrong material at gate entry",
  "adminPin": "1234"   // only required if record > 30 days old
}
```
- Returns: updated GrainTruck + list of created WeighmentCorrection audit rows
- Errors: 403 if user is not ADMIN, 422 with blocker list if blocked, 400 if validation fails

**POST `/api/weighbridge/admin/cancel/:id`**
- Auth: ADMIN role only
- Body: `{ reason, adminPin? }`
- Action: sets `GrainTruck.cancelled = true`, decrements POLine.receivedQty if PO is linked
- Writes `WeighmentCorrection` audit row with fieldName="cancel"

**GET `/api/weighbridge/admin/corrections/:weighmentId`**
- Returns full audit trail for a weighment

### Factory

**POST `/api/weighbridge/correction`**
- Auth: X-WB-Key header
- Body:
```json
{
  "correctionId": "uuid-from-cloud",
  "factoryLocalId": "uuid-from-factory-Weighment.localId",
  "fields": {
    "materialName": "RICE HUSK",
    "materialCategory": "FUEL",
    "supplierName": "ABC Trading",
    "vehicleNo": "HR55T2963",
    "remarks": "..."
  },
  "cancel": false
}
```
- Action:
  1. Look up `Weighment` by `localId`
  2. If found: apply fields, insert into local `WeighmentCorrectionLog` table (dedup by correctionId)
  3. If cancel=true: set `status='CANCELLED'`
  4. Return 200 OK with before/after snapshot
- Returns 404 if not found (cloud retries later; maybe the record never existed because push was never successful)
- Returns 409 if this correctionId was already applied (idempotent success)

## Field mapping — cloud to factory

Cloud `GrainTruck` ↔ Factory `Weighment`:

| Cloud Field | Factory Field |
|---|---|
| `materialType` | `materialName` |
| `materialId` | *(not on factory — factory uses materialName + materialCategory)* |
| *(derived from InventoryItem.category)* | `materialCategory` |
| `supplier` | `supplierName` |
| `poId` | `poId` (different UUIDs per system — factory stores the cloud poId) |
| `vehicleNo` | `vehicleNo` |
| `driverName` | `driverName` |
| `driverMobile` | `driverPhone` |
| `transporterName` | `transporter` |
| `remarks` | `remarks` |
| `bags` | `bags` |
| `cancelled=true` | `status='CANCELLED'` |

## Frontend UI

Route: `/admin/weighment-corrections` on cloud ERP.

Page structure:
- **Header bar** — title, date range filter, search box (vehicle no / ticket no)
- **KPI strip** — Total Weighments, Editable, Blocked, Cancelled Today
- **Table** — ticket | date | vehicle | supplier | material | net weight | status | action
- **Action column** — "Edit" button (disabled if blockers, tooltip shows reason), "Cancel" button, "History" button
- **Edit modal**:
  - Shows current values on the left, editable fields on the right
  - Material dropdown (autocomplete from InventoryItem)
  - Supplier dropdown (autocomplete from Vendor)
  - PO dropdown (filters to APPROVED/PARTIALLY_RECEIVED only)
  - Vehicle, driver, transporter, remarks as text inputs
  - **Reason** textarea (min 10 chars, required)
  - **Admin PIN** field (only shown if record > 30 days)
  - Save button disabled until reason + any required PIN filled
- **History modal** — timeline of all corrections for this weighment

## Gotchas

1. **PO line capacity**: if admin changes the PO, the NEW PO's line must have enough `pendingQty` ≥ `weightNet`. If not, show error and don't allow save.
2. **Decrement old PO on change**: if the weighment was previously counted against PO-A and is moved to PO-B, PO-A's `POLine.receivedQty` must be decremented and PO-B's incremented. This is the reason the backend correction endpoint runs inside a transaction.
3. **Factory sync failures**: if the factory server is unreachable during the correction, the cloud change still commits (cloud is master), but `WeighmentCorrection.factorySynced=false` and `factoryError` is populated. A background retry job sweeps these every 60s. **Admin should see a badge** on the correction row indicating "Factory not yet synced" so they know the factory UI still shows the old data.
4. **Material change → category change**: when material changes from RAW_MATERIAL to FUEL (or vice versa), the routing logic at the factory differs (lab required for RM, not for FUEL). Factory correction receiver must update `materialCategory` as well.
5. **Cascade**: if GRN exists and admin tries to cancel — the cancel must also reverse the GRN. Phase 1 blocks this case. Phase 3 will handle it.
6. **Concurrent edits**: if two admins open the same record, last write wins. Phase 1 doesn't implement optimistic locking — rare and the audit log shows both attempts. Phase 2 will add `updatedAt` version check.
7. **Reason quality**: enforce min 10 chars. Don't let "fix" or "typo" get logged. Auditors need real reasons.

## Deploy plan

**Cloud side** (auto-deploys on push to main):
1. Add `WeighmentCorrection` model + `factoryLocalId` column migration (`prisma db push` runs automatically on Railway deploy — but watch the Railway logs, **never use `--accept-data-loss`**)
2. New route file `backend/src/routes/weighbridgeAdmin.ts`
3. Register in `backend/src/app.ts`
4. New page `frontend/src/pages/admin/WeighmentCorrections.tsx`
5. Register lazy route in `frontend/src/App.tsx`
6. Commit + push — Railway auto-deploys

**Factory side** (deploy via `./factory-server/scripts/deploy.sh`):
1. Add `/api/weighbridge/correction` POST endpoint
2. Add local `WeighmentCorrectionLog` table to factory Prisma schema (SQLite)
3. Run `prisma generate` on local + via deploy script's mandatory regen step
4. Deploy

**Rollback**: both sides are additive. No existing field or route is modified. Revert commits if anything goes wrong.

## Testing checklist

- [ ] Admin user can open the page, non-admin gets 403
- [ ] List shows recent weighments with blocker badges
- [ ] Edit modal opens, loads current values, saves with reason
- [ ] Correction appears in audit trail
- [ ] Factory DB reflects the correction within 5s
- [ ] Correction slip prints (or is viewable) from the audit trail
- [ ] Editing a record with GRN shows blocker, Edit button disabled
- [ ] Cancel action sets cancelled flag + audit row
- [ ] Record older than 30d prompts for admin PIN
- [ ] Changing PO reassigns receivedQty correctly on both old and new PO lines
- [ ] Factory offline: cloud save succeeds, factorySynced=false, retry job picks it up
- [ ] Concurrent edit from two admins — both audit rows written, last one wins on data

## Future phases (not in scope for Phase 1)

- **Phase 2**: Weight corrections (behind GRN-posted + invoice + payment checks)
- **Phase 3**: GRN reversal + re-post so post-GRN weighments become editable
- **Phase 4**: Outbound DispatchTruck corrections with e-invoice/e-way bill cancellation flow
- **Phase 5**: Bulk correction (e.g., "all weighments from vendor X in date range Y need supplier renamed")
