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
│  Flask Web UI on :8098                   │
│  SQLite DB (weighbridge.db)              │
│  Cloud sync module                       │
│  Receives live weight from all gate PCs  │
│  SSH: pending IT enablement              │
└──────────────┬───────────────────────────┘
               │ LAN (always available)
        ┌──────┼──────┬──────┐
       WB-PC1 WB-PC2 WB-PC3 WB-PC4
       Thin clients:
       - weight_agent.py (reads COM, POSTs to server)
       - Browser → http://192.168.0.10:8098
       - Thermal printer for slips
```

## Current State (Interim — runs on WB PC directly)

Until SSH is enabled on the factory server, the service runs on the weighbridge PC:

**Weighbridge PC (ethanolwb):**
- Tailscale IP: 100.91.152.57
- User: abc / Password: acer@123
- SSH: port 22 (OpenSSH enabled)
- Service at: C:\mspil\weighbridge\
- Task Scheduler: "MSPIL Weighbridge" (auto-start on boot)

## CRITICAL SAFETY RULES

- **NEVER** stop/disable WtService (WTReadingNew) — it feeds the existing Oracle gate entry system
- **NEVER** touch COM1 directly — WtService owns it
- **NEVER** modify the Oracle DB at 192.168.0.10/XE
- **NEVER** stop/modify the Print Consol (DirectPrinting.exe) system
- Our service reads `D:\WT\new weight.txt` (file mode) — WtService writes to it
- Deploy alongside existing systems — never replace until explicitly told
- WtService has a bug (8 data bits instead of 7) — fix ONLY with user approval during planned downtime
- **Incident 2026-03-31:** Disabling WtService halted the entire factory weighbridge. Re-enabled immediately.

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
