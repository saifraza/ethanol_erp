# Weighbridge — System, Hardware, Operations

> Master weighbridge skill. Merges `weighbridge-system.md` (hardware/protocol), `weighbridge-add-product.md` (cross-system contract — READ FIRST before adding any product), `weighment-corrections.md` (correction flow).

---

## Part A — System, Hardware, Serial Protocol (formerly weighbridge-system.md)

# Weighbridge System — Full Reference

## Overview
Weighbridge (truck scale) system for MSPIL factory. Handles gate entry, gross weight, tare weight, and receipt printing for all inbound (grain) and outbound (DDGS) trucks.

## Target Architecture (Central Server)

```
Cloud ERP (app.mspil.in)
      ↕ internet (when available)
┌──────────────────────────────────────────┐
│  FACTORY SERVER (192.168.0.10)           │
│  Windows Server, always on               │
│  Terminal unlock password: Mspil@1212    │
│  Oracle XE already runs here (Print      │
│  Consol system — DO NOT TOUCH)           │
│                                          │
│  OUR SERVICE (separate from Oracle):     │
│  Node.js Express on :5000                │
│  Hub: aggregates WB PCs, syncs to cloud  │
│  React admin dashboard                   │
│  SSH enabled (OpenSSH, port 22)          │
└──────────────┬───────────────────────────┘
               │ LAN (always available)
        ┌──────┼──────┬──────┐
       WB-PC1 WB-PC2 WB-PC3 WB-PC4
       Each PC runs:
       - Python Flask on :8098 (operator UI)
       - weight_reader.py (reads COM1 serial)
       - cloud_sync.py (pushes to factory server)
       - Thermal printer for slips
```

## Current State (LIVE as of 2026-04-01)

**Weighbridge PC (ethanolwb):**
- LAN IP: 192.168.0.83 | Tailscale: 100.91.152.57 (may be off)
- User: abc / Password: acer@123
- SSH: port 22 (OpenSSH enabled)
- Service at: `C:\mspil\weighbridge\`
- Task Scheduler: "MSPIL Weighbridge" (auto-start on boot)

**Weight reading mode**: FILE mode (`WB_PROTOCOL=file` system env var on PC)
- WtService (WTReadingNew) is **RE-ENABLED** (auto-start) — Oracle Print Consol needs it
- WtService has 8-bit bug (uses 8 data bits instead of 7), weight file stays empty
- Net result: weight reads as 0, operators use **manual weight entry** as fallback
- Serial mode tested (2026-04-01) and works, but conflicts with WtService on COM1

## CRITICAL SAFETY RULES

- **NEVER stop/disable WtService** (WTReadingNew) — halted old gate entry on 2026-03-31
- **NEVER modify the Oracle DB** at 192.168.0.10/XE
- **NEVER stop/modify Print Consol** (DirectPrinting.exe) on factory server
- **NEVER rapidly retry SSH** to any PC — causes Windows account lockout (30 min or reboot)
- **NEVER deploy config.py without checking SERIAL_PROTOCOL** — if default reverts to `file`, weight reading behavior changes. PC has `WB_PROTOCOL=serial` as system env var override.
- Serial mode: only enable when WtService is fully decommissioned (requires factory coordination)

**Incidents:**
- 2026-03-31: Disabling WtService halted old gate entry system
- 2026-04-01: Multiple SSH retries locked `abc` account (fixed by hard reboot)
- 2026-04-01: Serial mode tested successfully, reverted to file mode for Oracle compatibility

## Serial Protocol (Indicator → PC)

**Format:** `\x02 NNNNNN\x03\r\n` (STX + space + 6-digit weight in KG + ETX + CRLF)
**Example:** `\x02 005260\x03\r\n` = 5260 KG

**Settings (confirmed live 2026-03-31):**
- Port: COM1 (owned by WtService)
- Baud: 2400
- Data bits: 7 (WtService wrongly uses 8)
- Parity: None
- Stop bits: 1

## 3-Step Workflow with QR Code

### Step 1: Gate Entry
- Operator fills: vehicle no, supplier, material, PO, transporter, vehicle type, driver mobile
- System auto-detects shift (First/Second/Third)
- Prints **gate pass** on thermal printer with QR code encoding ticket number
- Status: `GATE_ENTRY`

### Step 2: Gross Weight
- Truck drives onto scale
- Operator scans QR code (USB barcode scanner types ticket # into input)
- System loads entry, shows vehicle info
- Weight auto-reads from scale (or manual entry fallback)
- Click "Capture Gross" → saves, prints **gross weight slip** with QR
- Status: `GROSS_DONE`

### Step 3: Tare Weight
- After unloading, truck returns to scale
- Operator scans same QR code
- Weight auto-reads → calculates product weight = gross - tare
- Prints **final weight slip** with all weights
- Status: `COMPLETE` → enqueued for cloud sync

## Existing Factory Systems (DO NOT TOUCH)

| System | Location | Purpose |
|--------|----------|---------|
| WtService.exe | D:\WT\ on WB PC | .NET service reading COM1, writes to new weight.txt |
| Print Consol | C:\Users\abc\Desktop\Print Consol\ | DirectPrinting.exe connects to Oracle, prints gate passes |
| Oracle XE | 192.168.0.10:1521 | Factory database for existing gate entry system |
| CCTV | Challenge.exe on WB PC | Smart Professional Surveillance System |
| TVS-E RP 3230 | USB on WB PC | Thermal receipt printer (80mm) |
| EPSON FX-2175II | USB on WB PC | Dot matrix printer for weighbridge slips |

The existing system prints gate passes like:
- Entry No, Shift, Entry Type (Inward/Outward), P.O. No
- Item, Supplier, Transporter, Mobile, Vehicle Type, Vehicle No
- Operator, Date Time, QR code

## Hardware on Weighbridge PC

| Component | Details |
|-----------|---------|
| PC | Acer desktop, Windows 10 Pro (10.0.19045) |
| Serial Card | WCH PCI Express DUAL SERIAL + PARALLEL |
| COM1 | Connected to weighbridge indicator (owned by WtService) |
| COM3 | Second serial port (unused) |
| USB-to-Serial | 5x Prolific PL2303 adapters (COM4-8, not currently connected) |
| Thermal Printer | TVS-E RP 3230 (receipt, 80mm) |
| Dot Matrix | EPSON FX-2175II (A4 weighbridge slips) |

## Service Architecture

| Thread | Module | Role |
|--------|--------|------|
| **WeightReader** | weight_reader.py → FileReader | Reads D:\WT\new weight.txt |
| **WebUI** | web_ui.py | Flask on 0.0.0.0:8098 |
| **CloudSync** | cloud_sync.py | Push weighments, pull master data |

ThreadWatchdog monitors all threads (max 10 restarts/hour).

## Local API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/weight | Live weight from scale |
| POST | /api/gate-entry | Step 1: Create gate entry |
| POST | /api/weighments/:id/gross | Step 2: Capture gross weight |
| POST | /api/weighments/:id/tare | Step 3: Capture tare weight |
| GET | /api/weighments/lookup/:id | Lookup by ticket# or UUID (QR scan) |
| GET | /api/weighments/gate-entries | Gate entries awaiting gross |
| GET | /api/weighments/gross-done | Awaiting tare |
| GET | /api/weighments/today | Today's all weighments |
| GET | /api/weighments/pending | All pending (gate + gross) |
| GET | /api/weighments/summary | Daily KPI summary |
| GET | /api/weighments/search | Search with filters |
| GET | /api/sync-stats | Cloud sync queue stats |
| GET | /api/suppliers | Supplier dropdown |
| GET | /api/materials | Material dropdown |
| DELETE | /api/weighments/:id | Delete weighment |
| GET | /gate-pass/:id | Print gate pass with QR |
| GET | /gross-slip/:id | Print gross weight slip |
| GET | /slip/:id | Print final weight slip |
| GET | /history | History/search page |

## SQLite Schema

**weighments** — core table (3-step workflow)
- id (UUID), ticket_no (auto-increment), direction (IN/OUT)
- vehicle_no, supplier_name, material
- po_number, transporter, driver_mobile, vehicle_type, shift, operator_name
- weight_first, weight_second, weight_gross, weight_tare, weight_net
- weight_source (SERIAL/MANUAL)
- status: GATE_ENTRY → GROSS_DONE → COMPLETE
- gate_entry_at, first_weight_at, second_weight_at, created_at
- synced (0/1), synced_at, cloud_id

**sync_queue** — reliable delivery to cloud
**suppliers, materials** — master data cache (pulled from cloud)
**counters** — ticket number sequence

## Templates

| File | Purpose | Printer |
|------|---------|---------|
| index.html | Main UI (3 tabs: Gate Entry / Weighbridge / Today) | Screen |
| history.html | Search & reprint past weighments | Screen |
| gate_pass.html | Gate entry receipt with QR code | Thermal 80mm |
| gross_slip.html | Gross weight receipt with QR code | Thermal 80mm |
| slip.html | Final weight slip (gross + tare + product) | Thermal 80mm |

## Files in Repo

```
distillery-erp/
├── weighbridge/              ← Weighbridge system
│   ├── run.py                ← Entry point (PID, watchdog, 3 threads)
│   ├── config.py             ← All settings (ports, intervals, cloud URL)
│   ├── weight_reader.py      ← Serial/File/Simulated weight readers
│   ├── web_ui.py             ← Flask web UI + API endpoints
│   ├── local_db.py           ← SQLite schema, CRUD, sync queue
│   ├── cloud_sync.py         ← Cloud push/pull/heartbeat
│   ├── deploy.sh             ← Remote deploy script (Mac → PC)
│   ├── templates/
│   │   ├── index.html        ← Main 3-tab weighbridge screen
│   │   ├── history.html      ← Search/history page
│   │   ├── gate_pass.html    ← Gate entry slip with QR
│   │   ├── gross_slip.html   ← Gross weight slip with QR
│   │   └── slip.html         ← Final weight slip
│   ├── data/                 ← gitignored (SQLite DB, PID, heartbeat)
│   └── logs/                 ← gitignored (rotating logs)
├── backend/src/routes/
│   └── weighbridge.ts        ← Cloud ERP API (push/pull/heartbeat)
```

## Management (from Mac via Tailscale)

```bash
# SSH into weighbridge PC
ssh abc@100.91.152.57    # password: acer@123

# SSH into factory server (via PC as jump host) — PENDING SSH enablement
ssh -J abc@100.91.152.57 user@192.168.0.10

# Deploy code to weighbridge PC
cd ~/Desktop/distillery-erp
scp weighbridge/*.py abc@100.91.152.57:C:/mspil/weighbridge/
scp weighbridge/templates/* abc@100.91.152.57:C:/mspil/weighbridge/templates/

# Check service
sshpass -p 'acer@123' ssh abc@100.91.152.57 "schtasks /query /tn \"MSPIL Weighbridge\""

# View logs
sshpass -p 'acer@123' ssh abc@100.91.152.57 "type C:\mspil\weighbridge\logs\weighbridge.log"

# Check live weight
curl http://100.91.152.57:8098/api/weight

# NEVER DO:
# sc stop WTReadingNew  ← halts factory
# sc config WTReadingNew start= disabled  ← halts factory
```

## Cloud Sync Robustness (Updated 2026-04-01)

### Sync Queue Behavior
- Items retried up to 10 times before being dead-lettered
- Dead-lettered items logged with ALERT severity every sync cycle
- Consecutive push failures (3+) cause early break to avoid blocking loop
- Stale PO cache auto-pruned when cloud sends updated active PO list

### Cloud Backend (weighbridge.ts) Safety
- Duplicate detection covers GrainTruck, DirectPurchase, AND DDGSDispatchTruck
- PO validation: only `APPROVED`, `SENT`, `PARTIAL_RECEIVED` POs can create GRNs
- Exhausted PO lines (pendingQty <= 0) fall through to generic inbound path
- GRN dates use local weighment timestamp, not server receive time
- Unit conversion handles KG, MT, QUINTAL/QTL
- PO lines ordered by createdAt; prefers lines with pending qty
- po_line_id sent from UI for multi-line PO support
- API key checked with timing-safe comparison

### UI Safety
- Unstable scale warning: confirm dialog before capturing weight when scale is unstable
- Cloud status shows actual reachability (not just queue depth)
- Dead-lettered items shown as "stuck (need attention)" in status bar

## Cross-System API Contracts

These are the exact payload shapes used between systems. Update this section when modifying any cross-system endpoint.

### 1. POST /api/weighbridge/push (Factory Server → Cloud)
**Caller**: `factory-server/src/services/syncWorker.ts` line 58
**Receiver**: `backend/src/routes/weighbridge.ts` line 214
**Auth**: `X-WB-Key` header (timing-safe comparison)

```json
{
  "weighments": [{
    "id": "local-uuid",
    "ticket_no": 0,
    "vehicle_no": "MP20KA1234",
    "direction": "IN",
    "purchase_type": "PO",
    "po_id": "supplier-id-not-po-id",
    "supplier_name": "Vendor Name",
    "material": "Broken Rice",
    "weight_gross": 45000,
    "weight_tare": 15000,
    "weight_net": 30000,
    "weight_source": "factory-server",
    "first_weight_at": "ISO-8601",
    "second_weight_at": "ISO-8601",
    "status": "COMPLETE",
    "remarks": "",
    "created_at": "ISO-8601"
  }]
}
```
**Response**: `{ "ok": true, "ids": ["cloud-uuid-1"] }`
**Note**: `po_id` now correctly maps to actual PO UUID (DEBT-004 resolved). `ticket_no` always 0.

### 2. POST /api/weighbridge/heartbeat (Factory Server → Cloud)
**Caller**: `factory-server/src/services/pcMonitor.ts`
**Receiver**: `backend/src/routes/weighbridge.ts` (stored in `pcHeartbeats` Map, in-memory)

```json
{
  "pcId": "weighbridge-1",
  "pcName": "Weighbridge Gate 1",
  "timestamp": "ISO-8601",
  "uptimeSeconds": 3600,
  "queueDepth": 0,
  "dbSizeMb": 1.2,
  "serialConnected": true,
  "serialProtocol": "file",
  "webPort": 8098,
  "weightsToday": 15,
  "lastTicket": 42,
  "version": "1.0.0",
  "system": { "cpuPercent": 5, "memoryMb": 2048, "diskFreeGb": 180, "hostname": "ethanolwb", "os": "Windows 10" }
}
```

### 3. GET /api/weighbridge/master-data (Cloud → Factory Server)
**Caller**: `factory-server/src/services/syncWorker.ts` line 108
**Receiver**: `backend/src/routes/weighbridge.ts` line 976

```json
{
  "suppliers": [{ "id": "uuid", "name": "Vendor Name" }],
  "materials": [{ "id": "uuid", "name": "Broken Rice", "category": "RAW_MATERIAL" }],
  "pos": [{
    "id": "uuid", "po_no": 101, "vendor_id": "uuid", "vendor_name": "Vendor",
    "deal_type": "RM_PURCHASE", "status": "APPROVED",
    "lines": [{
      "id": "uuid", "inventory_item_id": "uuid",
      "description": "Broken Rice", "quantity": 5000,
      "received_qty": 2000, "pending_qty": 3000,
      "rate": 22.5, "unit": "KG"
    }]
  }],
  "customers": [{ "id": "uuid", "name": "Customer Name" }]
}
```

### 4. POST /api/weighbridge/lab-results (Cloud → Weighbridge)
**Caller**: `weighbridge/cloud_sync.py` `pull_lab_results()`
**Receiver**: `backend/src/routes/weighbridge.ts` line 941

Request: `{ "weighment_ids": ["uuid-1", "uuid-2"] }`
Response: `{ "results": [{ "weighment_id": "uuid", "lab_status": "PASS", "moisture": 12.5, "starch": 65, "damaged": 2, "foreign_matter": 1.5 }] }`

---

## Known Limitations (Accepted Risks)

1. **No auth on local Flask endpoints** — acceptable for LAN-only access
2. **Inventory syncs on DRAFT GRN** — by design; stock adjusts on receipt, rejection reverses
3. **In-memory heartbeat map on cloud** — wiped on Railway deploy, recovers in <60s
4. **SQLite thread-local connections** — safe for single-writer WAL mode; would need rework for PostgreSQL
5. **Clock drift** — local timestamps may drift; NTP recommended on factory PC

---

## Part A.5 — Product Routing & Table Conventions (added 2026-04-12)

### Weight Column Naming Convention
Two naming patterns coexist (historical). New code should use `weightGross/weightTare/weightNet`:
- `weightGross` / `weightTare` / `weightNet` — GrainTruck, DispatchTruck, DDGSDispatchTruck, SugarDispatchTruck
- `grossWeight` / `tareWeight` / `netWeight` — GoodsReceipt, DirectPurchase, factory Weighment

### Weight Units
- **Inbound (grain/fuel)**: Converted KG → **MT** at push time (GrainTruck, GoodsReceipt store MT)
- **Outbound (ethanol/DDGS/sugar/scrap)**: Stored in **KG** (DispatchTruck, DDGSDispatchTruck, Shipment)
- **Spot farmer**: Stored in **KG** (DirectPurchase)
- Factory Weighment always stores raw KG from scale

### Product → Table Routing

| Product | Direction | Handler | Destination Table | Weight Unit |
|---------|-----------|---------|-------------------|-------------|
| Grain | IN | poInbound | GrainTruck + GoodsReceipt | MT |
| Fuel | IN | poInbound | GrainTruck + GoodsReceipt | MT |
| Spot (farmer) | IN | spotInbound | DirectPurchase | KG |
| Trader | IN | traderInbound | GrainTruck + GoodsReceipt | MT |
| Ethanol | OUT | ethanolOutbound | DispatchTruck | KG |
| DDGS | OUT | ddgsOutbound | DDGSDispatchTruck + Shipment | KG |
| Sugar | OUT | sugarOutbound | SugarDispatchTruck + Shipment | KG |
| Scrap/LFO/HFO/Ash/PressMud | OUT | nonEthanolOutbound | DDGSDispatchTruck + Shipment | KG |

### Handler Detection Priority (push.ts detectHandler)
1. `handlerKey` from InventoryItem (explicit override, wins over auto-detect)
2. Direction-based auto-detect with string matching on material name/category
3. Fallback to nonEthanolOutbound (outbound) or fallbackInbound (inbound)

### DDGSDispatchTruck Is a Generic Outbound Table
Despite its name, DDGSDispatchTruck is used for ALL non-ethanol outbound products. The `productName` field in the linked Shipment distinguishes the actual product.

### Outbound Products List
Configured in factory master data cache (`masterDataCache.ts`). Derived from InventoryItems with `handlerKey` ending in `_OUTBOUND`, with fallback to DEFAULT_OUTBOUND_PRODUCTS constant. Gate entry frontend reads from `/api/master-data` response.

---

## Part B — Adding a New Product (formerly weighbridge-add-product.md)

> **READ THIS ENTIRELY before adding any new product (scrap, sugar, animal feed, etc.) to the weighbridge pipeline.**

# Adding a New Product to the Weighbridge Pipeline

How to add a new product type (scrap, sugar, animal feed, molasses, CO2, fly ash, etc.) so it flows through the full pipeline: gate entry → weighbridge → factory server → cloud ERP → GRN/dispatch → inventory → invoice → payment.

This is the playbook to follow every time. Don't improvise — these systems are interconnected and skipping a step breaks something silently.

---

## ⭐ Stage 2 (2026-04-08): UI-Driven Product Master

**For 95% of new products you NEVER edit code.** Just create the InventoryItem in the UI:

1. Go to **Inventory → Material Master → New Item**
2. Fill in:
   - **Name** (e.g., "Iron Scrap", "Pressmud", "Brown Sugar")
   - **Category** — pick from RAW_MATERIAL / FUEL / CHEMICAL / FINISHED_GOOD / BYPRODUCT / SCRAP / PACKAGING / SPARE_PART / CONSUMABLE
   - **Division** — ETHANOL / SUGAR / POWER / COMMON (scrap/spares are usually COMMON)
   - **HSN Code, GST %, Unit** — standard
   - **Aliases** — comma-separated alternate names operators may type at gate entry (e.g., "DI, ductile iron, MS scrap")
   - **Handler Override** — leave on **Auto** unless this product needs special weighbridge handling. Auto routes by category + division. Override only when you need a specific cloud handler (e.g., contract auto-link).
   - **Contract-based** — check if gate entry must pick a contract (like DDGS / Sugar / Ethanol)
   - **Needs lab test** — check if factory should block gross weighment until lab passes
3. Save.

The factory server picks up the new item within ~5s (smart sync) and the operator sees it in the gate entry dropdown immediately. **No code change. No deploy. No skill update needed.**

### When you DO need code (the 5% case)
Only if the product needs:
- A dedicated cloud handler (custom dispatch table, contract auto-link logic, special invoice generation) → see "When You Need a NEW Handler" section below
- A new partial-state stub for the cloud pipeline page (see rule #12 below)
- New Stage 4 contract model with its own picker UI

For everything else (scrap variants, byproducts, packaging, new fuels, new chemicals, new finished goods) → just add the InventoryItem.

### Routing rules (auto, when handlerKey is null)
| material direction | category / hint | handler |
|---|---|---|
| OUT | (handler_key = ETHANOL_OUTBOUND OR cloud_gate_pass_id is uuid OR material includes 'ethanol') | handleEthanolOutbound |
| OUT | category=SUGAR OR material matches /sugar/i | handleSugarOutbound |
| OUT | category=DDGS OR material matches DDGS family | handleDDGSOutbound |
| OUT | anything else (scrap, pressmud, byproducts) | handleNonEthanolOutbound (Shipment only) |
| IN | po_id + (PO/JOB_WORK) | handlePoInbound |
| IN | SPOT | handleSpotInbound |
| IN | TRADER + supplier_id | handleTraderInbound |
| IN | nothing matches | handleFallbackInbound |

The legacy hardcoded keyword arrays in `factory-server/src/routes/weighbridge.ts` are now a **last-resort fallback** for items not yet in the InventoryItem master. They will be removed once master data is complete.

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

12. **Partial-state sync — show in-progress trucks on cloud (the "first weight" rule).** Operators expect a truck to appear on the cloud pipeline page **as soon as it gates in** at the factory, not after BOTH weighments are done. Without this, an outbound truck sitting at `FIRST_DONE` (tare-only) is invisible on cloud and the operator panics. The pattern has **FIVE** moving parts that must all be in place — adding any one without the others breaks billing or clogs sync. (Source: 2026-04-07/08 DDGS partial-sync rollout — got it wrong twice before getting it right.)

    **Part 1 — factory `syncWorker.ts`** pushes partial-state weighments. **Filter to the products that have a cloud stub handler** — pushing FIRST_DONE outbound for a product whose cloud pre-phase doesn't handle it will clog the sync queue with `Not in cloud response` failures forever.
    ```ts
    // factory-server/src/services/syncWorker.ts
    OR: [
      { status: { in: ['GATE_ENTRY', 'COMPLETE'] } },
      { status: 'FIRST_DONE', direction: 'INBOUND', labStatus: { not: 'PENDING' } },
      {
        status: 'FIRST_DONE',
        direction: 'OUTBOUND',
        // ⚠ Must match the products that have a cloud pre-phase stub. DDGS only today.
        // Add sugar/scrap material keywords here ONLY after their cloud handler grows
        // a createOrUpdate*TruckStub function.
        OR: [
          { materialCategory: 'DDGS' },
          { materialName: { contains: 'ddgs', mode: 'insensitive' } },
          { materialName: { contains: 'wdgs', mode: 'insensitive' } },
          { materialName: { contains: 'distillers', mode: 'insensitive' } },
        ],
      },
    ],
    ```

    **Part 2 — factory `syncWorker.ts` direction-aware timestamps.** The original mapping `first_weight_at: w.grossTime, second_weight_at: w.tareTime` is correct for INBOUND (gross is the first weighment of a loaded truck) but **inverted for OUTBOUND** (tare is the first weighment of an empty truck). The cloud DDGS handler trusts `first_weight_at` as the tare time and uses `second_weight_at` as the invoice date. Use the direction-agnostic columns:
    ```ts
    first_weight_at: (w.firstWeightAt
      ?? (w.direction === 'OUTBOUND' ? w.tareTime : w.grossTime))?.toISOString(),
    second_weight_at: (w.secondWeightAt
      ?? (w.direction === 'OUTBOUND' ? w.grossTime : w.tareTime))?.toISOString(),
    ```

    **Part 3 — cloud `pre-phase.ts`** must upsert a stub row when the dispatcher's `COMPLETE`-only check would otherwise drop it:
    ```ts
    // backend/src/routes/weighbridge/pre-phase.ts
    if (isGateOrPending && !isInbound && isDdgsOutbound(w, ctx)) {
      return await createOrUpdateDdgsTruckStub(w, ctx);
    }
    ```
    The stub:
    - keys off `sourceWbId` (unique) so the COMPLETE handler later updates the same row, no duplicates
    - sets `status = 'GATE_IN'` if no weights, `'TARE_WEIGHED'` if first weight only
    - runs the SAME strict contract match as the COMPLETE handler so the truck is contract-linked from first sight (the cloud pipeline page filters `contractId IS NOT NULL`)
    - returns `shortCircuit: true` so push.ts doesn't fall through to the COMPLETE-only handler

    **Part 4 — `checkWbDuplicate` (`shared.ts`) MUST exclude stubs.** This is the trap that broke DDGS billing on 2026-04-07. The stub writes `WB:{id}` into `remarks`, and the generic duplicate check at the top of every COMPLETE handler matches it and short-circuits before the dispatcher ever calls `handleDDGSOutbound`. Result: stub stays at `TARE_WEIGHED` forever, never bills. **Filter the dedup query by status** so partial-state stubs are not treated as already-processed:
    ```ts
    const dupDDGS = await prisma.dDGSDispatchTruck.findFirst({
      where: {
        remarks: { contains: wbMarker },
        status: { notIn: ['GATE_IN', 'TARE_WEIGHED'] }, // ← critical
      },
      select: { id: true },
    });
    ```
    Same filter for sugar / any new outbound product table that uses both pre-phase stubs and the generic dedup gate.

    **Part 5 — COMPLETE handler must promote the stub status:**
    ```ts
    update: {
      ...,
      ...(existing && (existing.status === 'GATE_IN' || existing.status === 'TARE_WEIGHED')
        ? { status: 'GROSS_WEIGHED' as const }
        : {}),
    }
    ```
    Without this, the stub stays at `TARE_WEIGHED` forever even after the gross weighment lands, and the `BILLED` transition `updateMany({status: { notIn: ['BILLED','RELEASED']}})` keeps re-firing (technically harmless, but the row never reaches `BILLED` state on the pipeline page).

    **Existing reference patterns** (copy these, don't reinvent):
    - **Inbound grain stub**: `pre-phase.ts → createOrUpdateGrainTruckStub` — runs at GATE_ENTRY/FIRST_DONE inbound, builds the GrainTruck with whatever lab/weights exist, dedup'd via `remarks contains "WB:{id}"`. Stub fall-through to PO/SPOT/TRADER handler at COMPLETE.
    - **Outbound DDGS stub**: `pre-phase.ts → createOrUpdateDdgsTruckStub` (added 2026-04-07) — same pattern but for `DDGSDispatchTruck`, dedup'd via `sourceWbId @unique`. Status filter on `checkWbDuplicate` is mandatory.
    - **Outbound ethanol** uses a different mechanism — a separate cloud "gate pass" API call from the operator UI creates the `DispatchTruck` row at gate-in time, BEFORE any weighbridge sync, and the COMPLETE handler matches by `cloud_gate_pass_id`. This works for ethanol because there's a dedicated gate-pass UI; for DDGS/sugar/scrap there isn't, so use the pre-phase stub pattern instead.

    **When to use this pattern for a new outbound product**: any time the operator wants to see the truck on the cloud dashboard before the gross weighment is captured. For sugar, scrap, animal feed, etc., implement ALL FIVE parts. Skipping any one breaks the flow silently.

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
| `handleDDGSOutbound` | OUTBOUND + (material_category='DDGS' OR material has 'ddgs'/'wdgs'/'distillers'/'dried grain'/'wet grain') | DDGSDispatchTruck + Shipment + auto-match DDGSContract + auto Invoice (inline in handler tx, NOT `ddgsInvoiceService`) + DDGSContractDispatch link |
| `handleSugarOutbound` | OUTBOUND + (material_category='SUGAR' OR material matches /sugar/i) — checked BEFORE DDGS in dispatcher | SugarDispatchTruck + Shipment + auto-match SugarContract |
| `handleNonEthanolOutbound` | OUTBOUND, not ethanol, not sugar, not DDGS (final catch-all: scrap, press mud, ash, etc.) | Shipment only (no dedicated table, no contract link) |
| Pre-phase: `createOrUpdateGrainTruckStub` | GATE_ENTRY/FIRST_DONE inbound, OR COMPLETE inbound with existing GrainTruck stub | GrainTruck stub for lab page |
| Pre-phase: `createOrUpdateDdgsTruckStub` | GATE_ENTRY/FIRST_DONE outbound + DDGS material | DDGSDispatchTruck stub at GATE_IN/TARE_WEIGHED, contract auto-linked. Sugar/scrap have NO partial-state stub yet — they only sync at COMPLETE. |

Fuel is NOT a separate handler — fuel-specific behavior (skip GrainTruck, fuel lab fail rejection) is inside `handlePoInbound` and pre-phase, gated on `ctx.isFuel`.

---

## Factory Gate Entry — Contract Picker Pattern (For OUTBOUND Products)

When an outbound product is sold against a **contract** (ethanol → OMC contract, DDGS → DDGSContract, sugar → SugarContract, scrap → ScrapContract...), the operator must **pick the contract at gate entry on the factory weighbridge UI**, NOT type a buyer name freehand. Without this, the cloud handler's strict buyer-name match will fail randomly on typos and trucks land with `contractId = null`.

The end-to-end flow has THREE pieces — copy the **DDGS pattern** (added 2026-04-07) for any new contract-based product:

### Piece 1: Cache contracts on factory server (in-memory + disk + smart sync)

`factory-server/src/services/masterDataCache.ts`

- Add an interface: `interface DdgsContract { id, contractNo, dealType, buyerName, buyerGstin, rate, processingChargePerMT, gstPercent, contractQtyMT, totalSuppliedMT, startDate, endDate, ... }`
- Add `ddgsContracts: DdgsContract[]` to `MasterCache` and `EMPTY_CACHE`
- Add it to `loadFromDisk()` schema-evolution fallback: `data.ddgsContracts = data.ddgsContracts || []`
- Add the table to `getCloudTimestamp()` so the 5-second smart sync detects edits:
  ```sql
  GREATEST(..., (SELECT MAX("updatedAt") FROM "DDGSContract"))
  ```
- Add a separate `try { ... } catch` block in `fullSyncFromCloud()` querying via `cloud.$queryRawUnsafe`. **Use a separate try/catch** so a contract sync failure doesn't break vendor/material/PO sync. Filter to active + within date window:
  ```sql
  WHERE status = 'ACTIVE' AND "endDate" >= NOW() AND "startDate" <= NOW()
  ORDER BY "contractNo" LIMIT 50
  ```
- Cast Prisma Decimal/Float fields explicitly with `Number(r.rate)` etc.

### Piece 2: Expose via factory API

`factory-server/src/routes/masterData.ts` — one line in the `/api/master-data` response:
```ts
ddgsContracts: data.ddgsContracts,
```

### Piece 3: Gate entry UI selector + info card

`factory-server/frontend/src/pages/GateEntry.tsx`

- Add `interface DdgsContract { ... }` matching the cached shape
- `const [ddgsContracts, setDdgsContracts] = useState<DdgsContract[]>([])` and `[ddgsContractId, setDdgsContractId]`
- In `loadMasterData`: `setDdgsContracts(data.ddgsContracts || [])`
- Computed flag: `const isDdgsOut = direction === 'OUTBOUND' && materialName === 'DDGS'`
- Conditional dropdown block (mirrors the ethanol block):
  ```tsx
  {isDdgsOut && (
    <select onChange={e => {
      setDdgsContractId(e.target.value);
      const c = ddgsContracts.find(x => x.id === e.target.value);
      if (c) setCustomerName(c.buyerName); // ← AUTO-FILL is critical
    }}>
      ...
    </select>
  )}
  ```
- **Auto-fill `customerName` with `c.buyerName`** when a contract is picked. This is what makes the cloud handler's exact-match auto-link the truck to the contract on sync — without it, the operator might type a slightly different name and the match fails.
- Render an **info card** under the dropdown showing buyer / GSTIN / dealType / rate (₹/MT) / GST% / supplied / total / remaining / principal / validity. Operator confirms before they submit. Tier 2 SAP styling, NOT rounded.
- Display rate from the right field by dealType:
  ```tsx
  const r = c.dealType === 'JOB_WORK' ? c.processingChargePerMT : c.rate;
  ```

### Why all three pieces are mandatory

- Without **caching on factory** → operator can't pick offline; the gate UI breaks the moment cloud is unreachable.
- Without **API exposure** → frontend can't see the contracts.
- Without **auto-fill of buyerName** → cloud handler's strict match fails on whitespace/case mismatches and `contractId` ends up null. The truck appears on `/process/ddgs-dispatch` but is invisible on `/sales/ddgs-contracts` (which filters by `contractId IS NOT NULL`).

---

## Contract Data Validation — Common Trap

**Before debugging "the truck isn't billing right", check the contract row itself.** A contract that LOOKS active in the UI can be silently misconfigured in three ways that all break auto-billing:

1. **`dealType` mismatch.** A contract created as `FIXED_RATE` but priced like job work (rate=4.54 ₹/kg = ₹4540/MT) computes wrong because the cloud handler reads `contract.rate` for `FIXED_RATE` and `contract.processingChargePerMT` for `JOB_WORK`. Fix: `dealType=JOB_WORK`, `rate=0`, `processingChargePerMT=4540`.
2. **Rate stored in wrong unit.** If you see `rate=4.54` and the contract is in MT, the math gives ₹4.54 × 10 MT = ₹45.40 per truck instead of ₹45,400. Always store in **₹/MT** (not ₹/kg).
3. **`gstPercent` wrong.** DDGS sale is 5% by default; job-work charges (HSN 998817) are 18%. The handler uses `contract.gstPercent` (with 5% fallback). If a job-work contract has 5% saved, the invoice GST will be way too low — small enough to miss in a quick glance.

To check or fix a contract via API (admin token required):
```bash
TOKEN="<jwt>"
curl -s "https://app.mspil.in/api/ddgs-contracts/<id>" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
curl -s -X PUT "https://app.mspil.in/api/ddgs-contracts/<id>" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"dealType":"JOB_WORK","processingChargePerMT":4540,"rate":0,"principalName":"...","gstPercent":18}'
```

**Cloud login gotcha** — the auth route reads `username` from the body, NOT `email`, even though it resolves either the email or the name field:
```bash
curl -X POST https://app.mspil.in/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@distillery.com","password":"admin123"}'
```

---

## Invoice Rendering — Round-Off Line (Tally Style)

The standard `invoice.hbs` template renders a **"Less : BALANCE ROUND OFF A/C"** line when stored `totalAmount` has fractional paise. The endpoint `GET /api/invoices/:id/pdf` computes:

```ts
roundedTotalAmount: Math.round(invoice.totalAmount || 0),
roundOff: Math.round((Math.round(invoice.totalAmount || 0) - (invoice.totalAmount || 0)) * 100) / 100,
```

The template uses these helpers:
- `{{formatNum (default roundedTotalAmount totalAmount)}}` for the grand total cell
- `{{numberToWords (default roundedTotalAmount totalAmount)}}` for amount-in-words
- `{{abs roundOff}}` (helper added in `templateEngine.ts`) for the displayed delta
- `{{#if roundOff}}` so the row is hidden when total is already a whole rupee

**Stored `totalAmount` is unchanged** — full precision is preserved in the DB; rounding is purely display. Don't write a rounded value back to the row.

For any new product invoice rendering, **reuse `invoice.hbs`** — don't fork it. The template handles ethanol, DDGS, sugar, and future products because all fields are driven by `productName`/`hsnCode`/`unit` injected from the route. The DDGS-specific `ddgs-invoice.hbs` is legacy (only used by `/api/ddgs-dispatch/:id/invoice-pdf`), does NOT have the round-off line, and should be migrated to the unified template eventually.

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

---

## Known Issues / Deferred Fixes (as of 2026-04-08)

These were flagged by a Codex audit of the DDGS partial-sync rollout. Some are fixed in code, some are documented here as traps to watch for. Skim this list before adding any new sellable product.

### FIXED (already in main)
- ✅ **Stub blocked by `checkWbDuplicate`** — `shared.ts` now filters by `status NOT IN ('GATE_IN','TARE_WEIGHED')` for DDGS and Sugar tables. Without this filter the dispatcher dedup'd partial-state stubs and never billed them. (Rule #12 Part 4.)
- ✅ **`FIRST_DONE` outbound clogging non-DDGS sync queue** — `factory-server/src/services/syncWorker.ts` now restricts the FIRST_DONE outbound branch to DDGS material category only. Sugar/scrap operators don't see the sync queue blocked.
- ✅ **Outbound tare/gross timestamps inverted** — `syncWorker.ts` now uses `firstWeightAt` / `secondWeightAt` (direction-agnostic) with a per-direction fallback for legacy rows. Cloud invoice date matches the actual gross-weighment time.
- ✅ **DDGS contract oversubscription race** — `handlers/ddgsOutbound.ts` re-fetches the contract inside the tx and runs `updateMany` with a `WHERE` on `totalSuppliedMT` so two concurrent trucks cannot blow past `contractQtyMT`. Throws on overflow → safety net rolls back invoice + writes a PlantIssue.

### KNOWN — fix next session
- 🟡 **DDGS contract picker is not authoritative** (`GateEntry.tsx`). The factory only persists `customerName` (from the picker auto-fill); `contractId` is NOT sent to cloud. The cloud handler re-resolves the contract by exact buyer name at sync time. If the contract is edited or deleted between gate entry and sync, the truck silently relinks or lands with `contractId = null`. **Fix direction**: add `contractId String?` to `factory-server/prisma/schema.prisma → Weighment`, plumb through `gate-entry` POST → `syncWorker` payload → cloud `weighmentSchema`, then have `ddgsOutbound.ts` and `pre-phase.ts` prefer the explicit ID over name matching. Requires a factory `prisma db push`.

- 🟡 **`/api/invoices/:id/pdf` recomputes `supplyType` and uses a hardcoded HSN map** (`backend/src/routes/invoices.ts:334-374`). It detects intra-state from the CURRENT customer state and only knows JOBWORK/ETHANOL/DDGS HSN codes. Two consequences: (1) editing a customer's state retroactively flips the GST split on every old invoice PDF; (2) adding sugar/scrap will render with the wrong HSN even though the stored amounts are right. **Fix direction**: render from persisted `invoice.supplyType` and store `hsnCode` as a snapshot column on `Invoice`, populated at write time by the handler.

- 🟡 **Factory cache staleness has no upper bound** (`factory-server/src/services/masterDataCache.ts:293-306`). On first failed cloud poll, `smartSync` returns early and the cache stays as-is forever. No "served stale for >X minutes" warning bubbles up to the gate-entry UI. **Fix direction**: track `lastSuccessfulSync`, surface staleness >5 min on `/api/master-data/status`, and show a banner in `GateEntry.tsx` when stale.

- 🟡 **Non-DDGS outbound has no partial-state stub.** `handleSugarOutbound` and `handleNonEthanolOutbound` only run at COMPLETE, and the factory `syncWorker` deliberately filters them out of the FIRST_DONE outbound push. So sugar/scrap operators are back to "truck invisible until both weighments done." When you add a new sellable product, decide up-front whether it needs partial-state visibility — if yes, follow Rule #12 (all 5 parts) for that product before turning on FIRST_DONE outbound sync.

- 🟡 **`handleNonEthanolOutbound` still does `findFirst → create`** instead of `prisma.upsert({where: {sourceWbId}})`. Two concurrent retries can race and create duplicate truck rows. Rule #4 in this skill says "schema-level uniqueness is mandatory" — non-ethanol catch-all violates it. Add `sourceWbId @unique` to whatever table that handler writes to and switch to `upsert`.

- 🟢 **Invoice counter race is FIXED** (`backend/src/utils/invoiceCounter.ts:21-30`) — atomic `INSERT ... ON CONFLICT ... RETURNING`. Earlier rule warning is no longer accurate; left here so future readers know the historical concern.

- 🟢 **DDGS `$transaction({timeout: 15000})`** — under high concurrency on slow Railway DB, the full bill path (truck upsert + shipment upsert + contract re-check + invoice create + DDGSContractDispatch upsert + status flip + contract increment) could approach 15s. Not seen in production but watch for `P2028` errors. Mitigation: batch invoice IRN/EWB calls outside the tx (already done).

### Always Run Codex Before Pushing

Every time you touch a weighbridge handler, the dispatcher, pre-phase, syncWorker, or any contract-billing path, run `/codex:rescue` with the diff before committing. The 2026-04-07/08 DDGS rollout shipped THREE bugs in two days because the audit only happened after deploy. Audit-then-deploy is cheaper than deploy-then-postmortem.

---

## Part C — Weighment Corrections (formerly weighment-corrections.md)

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
