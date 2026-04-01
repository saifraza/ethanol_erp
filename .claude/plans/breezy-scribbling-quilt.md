# Unified Factory App — Replace Flask with React on Factory Server

## Context

Currently the factory runs TWO separate systems:
- **Flask app** (`weighbridge/`) on each WB PC — gate entry, weighing, lab, printing, sync
- **Factory server** (`factory-server/`) — admin dashboard, user management, PC monitoring

This creates maintenance headaches: deploying to N PCs, SQLite per PC, sync logic, Python+Node dual stack. The user wants **one app on the factory server** that all PCs access via browser. Only a tiny weight reader service stays on each PC for serial port access.

## New Architecture

```
WB PC (minimal)                Factory Server (192.168.0.10:5000)
┌──────────────────┐           ┌─────────────────────────────────┐
│ weight-reader.py │           │ Node.js backend (Express+Prisma)│
│ - Reads COM port │ ◄─poll──  │ React frontend (all pages)      │
│ - GET :8099/weight│          │ PostgreSQL (single DB)           │
│   → {weight, stable}        │                                 │
│                  │           │ Pages:                           │
│ QR scanner = USB │           │  /gate-entry     (Gate Entry)    │
│ (keyboard mode,  │──type──►  │  /gross          (Gross WB)      │
│  browser gets it)│           │  /tare           (Tare WB)       │
└──────────────────┘           │  /weighment      (All weighments)│
                               │  /dashboard      (Admin)         │
                               │  /users          (User mgmt)     │
                               │  /history        (Search/reprint)│
                               └─────────────────────────────────┘
```

## What Changes

### 1. Tiny Weight Reader (`weight-reader/weight_reader.py`) — NEW
- 50-line Python HTTP server on each WB PC
- Reads COM port (serial or file mode, same as existing `weight_reader.py`)
- Serves single endpoint: `GET /weight` → `{"weight": 4250, "stable": true, "connected": true}`
- No Flask, no SQLite, no sync, no templates
- Config: `SERIAL_PORT`, `SERIAL_PROTOCOL`, `HTTP_PORT=8099`
- Install: copy 1 file + `pip install pyserial` + run as service

### 2. Role Split — MODIFY
Current roles: `ADMIN, GATE_ENTRY, WEIGHBRIDGE, FUEL_YARD, LAB`

New roles: `ADMIN, GATE_ENTRY, GROSS_WB, TARE_WB, FUEL_YARD, LAB`

Files to change:
- `factory-server/frontend/src/pages/UserManagement.tsx` — update ROLES array
- `factory-server/frontend/src/App.tsx` — add routes for `/gross` and `/tare`
- `factory-server/frontend/src/components/Layout.tsx` — update sidebar nav

### 3. Backend API — ADD/MODIFY

**New routes in `factory-server/src/routes/weighbridge.ts`:**

```
POST /api/weighbridge/gate-entry        — Create gate entry (replaces Flask POST /api/gate-entry)
POST /api/weighbridge/:id/gross         — Capture gross weight
POST /api/weighbridge/:id/tare          — Capture tare weight
POST /api/weighbridge/:id/lab           — Record lab result
GET  /api/weighbridge/pending-gross     — GATE_ENTRY status (awaiting gross)
GET  /api/weighbridge/pending-tare      — FIRST_DONE status (awaiting tare)
GET  /api/weighbridge/today             — Today's completed weighments
GET  /api/weighbridge/summary           — Daily KPI stats
GET  /api/weighbridge/search            — Search with filters
GET  /api/weighbridge/slip/:id          — Slip data for printing
```

**Existing routes kept:**
- `POST /push` — still used for backward compat with Flask PCs during transition
- `GET /lookup/:identifier` — QR scan lookup
- `GET /weighments` — admin list
- `GET /stats` — admin stats

**Prisma schema changes (`factory-server/prisma/schema.prisma`):**

Add missing fields to Weighment model (matching Flask local_db.py):
```prisma
model Weighment {
  // ... existing fields ...
  // ADD:
  ticketNo        Int?        @unique   // Auto-increment ticket for QR/slips
  purchaseType    String?               // PO, SPOT, OUTBOUND (already exists)
  poId            String?               // Cloud PO UUID
  poLineId        String?               // Cloud PO line UUID
  shift           String?               // First/Second/Third shift
  operatorName    String?               // Who created gate entry
  sellerPhone     String?               // Spot purchase
  sellerVillage   String?
  sellerAadhaar   String?
  rate            Float?                // Per KG rate
  deductions      Float?
  deductionReason String?
  paymentMode     String?               // CASH, UPI, BANK_TRANSFER
  paymentRef      String?
  transporter     String?
  vehicleType     String?               // Truck 14W, Tractor, Pickup
  bags            Int?
  weightSource    String?               // SERIAL, MANUAL
  // Lab fields
  labStatus       String?   @default("PENDING")
  labMoisture     Float?
  labStarch       Float?
  labDamaged      Float?
  labForeignMatter Float?
  labRemarks      String?
  labTestedAt     DateTime?
  labTestedBy     String?
  // Weight capture PCs (multi-WB tracking)
  grossPcId       String?               // Which PC captured gross
  tarePcId        String?               // Which PC captured tare
  // Timestamps
  gateEntryAt     DateTime?
  firstWeightAt   DateTime?
  secondWeightAt  DateTime?
}
```

Add ticket counter:
```prisma
model Counter {
  id    String @id
  value Int    @default(0)
}
```

### 4. Frontend Pages — NEW

All pages follow existing SAP-style patterns from the factory server frontend.

**a) Gate Entry Page (`/gate-entry`)** — Role: GATE_ENTRY
Replicate Flask Tab 1:
- Direction toggle (Inbound/Outbound)
- Purchase type toggle (PO/Spot) for inbound
- Vehicle no with autocomplete
- Supplier/Customer dropdown
- PO selector with pending qty display
- Spot purchase fields (seller, rate, payment)
- Outbound product selector
- Common: transporter, vehicle type, driver mobile, bags, remarks
- "Create & Print Pass" button → opens print view in new tab
- Gate pass print layout (80mm thermal, QR code with ticket #)

**b) Gross Weighment Page (`/gross`)** — Role: GROSS_WB
Replicate Flask Tab 2 (gross part):
- Live weight display (polls PC's weight reader at `http://{PC_IP}:8099/weight`)
- QR scan input (text field, USB scanner types into it)
- Scanned entry card (vehicle, supplier, material, PO, lab status)
- Lab entry section (moisture, starch, damaged, foreign matter, pass/fail) — for inbound
- "Capture Gross Weight" button (green, only when stable)
- Manual weight entry modal (fallback)
- Pending table: all GATE_ENTRY weighments awaiting gross
- After capture: prints gross slip, moves to FIRST_DONE

**c) Tare Weighment Page (`/tare`)** — Role: TARE_WB
Replicate Flask Tab 2 (tare part):
- Live weight display (polls PC's weight reader)
- QR scan input
- Scanned entry card (shows gross weight already captured)
- "Capture Tare Weight" button (amber, only when stable)
- Manual weight entry modal
- Pending table: all FIRST_DONE weighments awaiting tare
- After capture: calculates net, prints final slip, moves to COMPLETE

**d) History/Search Page (`/history`)** — Role: ALL
- Date range filter, vehicle search
- Results table with reprint links (gate pass, gross slip, final slip)

**e) Print Views (new tab, not React routes):**
- `/api/weighbridge/print/gate-pass/:id` — returns HTML for 80mm thermal
- `/api/weighbridge/print/gross-slip/:id` — returns HTML
- `/api/weighbridge/print/final-slip/:id` — returns HTML
- All use `window.print()` auto-trigger
- Server-rendered HTML (not React) — simpler for thermal printers

### 5. Weight Reader IP Configuration

The React app needs to know which PC's weight reader to poll. Options:
- **Auto-detect**: Browser knows its own IP? No — browsers can't do this reliably
- **Config per user**: Admin sets "Gross WB PC IP" in settings → stored in factory server
- **URL parameter**: Operator opens `http://server:5000/gross?scale=192.168.0.83:8099`
- **localStorage**: Operator configures once on their browser, saved locally

**Recommended**: URL parameter + localStorage cache. First visit prompts for scale IP, saves to localStorage. Admin can also set defaults per role in the factory server config.

### 6. QR Code Generation

Gate pass needs QR code. Options:
- Server-side: Use `qrcode` npm package, return as base64 in print HTML
- Client-side: Use `qrcode.react` package in React

**Recommended**: Server-side in print HTML endpoint (simpler, no JS needed for thermal printer).

## Build Order

1. **Prisma schema** — add missing fields to Weighment, add Counter model
2. **Weight reader Python script** — tiny HTTP service
3. **Backend routes** — gate-entry, gross, tare, lab, pending, print endpoints
4. **Role split** — update App.tsx, Layout.tsx, UserManagement.tsx
5. **Gate Entry page** — full form with PO selector, supplier dropdown
6. **Gross Weighment page** — live weight, QR scan, lab entry, capture
7. **Tare Weighment page** — live weight, QR scan, capture, net calc
8. **Print endpoints** — gate pass, gross slip, final slip (HTML templates)
9. **History page** — search, reprint
10. **Deploy + test** parallel with Flask still running
11. **Codex audit** before final switchover

## Files to Create/Modify

### Create:
- `weight-reader/weight_reader.py` — tiny scale reader service
- `weight-reader/config.py` — serial port config
- `weight-reader/install.bat` — Windows service installer
- `factory-server/frontend/src/pages/GrossWeighment.tsx`
- `factory-server/frontend/src/pages/TareWeighment.tsx`
- `factory-server/frontend/src/pages/History.tsx`
- `factory-server/frontend/src/components/LiveWeight.tsx` — shared weight display component
- `factory-server/frontend/src/components/WeighmentCard.tsx` — shared scanned entry card
- `factory-server/frontend/src/components/PrintButton.tsx` — opens print view

### Modify:
- `factory-server/prisma/schema.prisma` — add fields
- `factory-server/src/routes/weighbridge.ts` — add new endpoints
- `factory-server/frontend/src/App.tsx` — new routes + roles
- `factory-server/frontend/src/components/Layout.tsx` — sidebar nav
- `factory-server/frontend/src/pages/UserManagement.tsx` — role list
- `factory-server/frontend/src/pages/GateEntry.tsx` — full rewrite (currently basic)

### Keep unchanged:
- `weighbridge/` — Flask stays running during transition
- `factory-server/src/services/syncWorker.ts` — cloud sync unchanged
- `factory-server/src/routes/auth.ts` — auth unchanged

## Verification

1. Build frontend: `cd factory-server/frontend && npm run build`
2. Compile backend: `cd factory-server && npx tsc --noEmit`
3. Deploy to factory server via SCP
4. Test gate entry → gross → tare → print flow
5. Verify cloud sync (weighment appears in cloud ERP)
6. Test QR scan across pages (gate entry QR scanned on gross page)
7. Test offline weight reader (weight_reader.py on WB PC)
8. Run Codex audit on all new code before switchover
