---
name: Factory System Architecture
description: Master reference for ALL factory-floor systems — what runs where, how they connect, how to add PCs
type: skill
---

# Factory System Architecture

## The Big Picture

```
┌─────────────────────────────────────────────────────────┐
│                  CLOUD (Railway)                         │
│                                                         │
│   app.mspil.in  ←──────────  PostgreSQL DB              │
│   (ERP + API)                (shared by all)            │
│                                                         │
│   Endpoints:                                            │
│   POST /api/weighbridge/push     ← receives weighments  │
│   PUT  /api/weighbridge/weighment/:id  ← corrections    │
│   GET  /api/weighbridge/master-data   → POs, suppliers  │
│   POST /api/weighbridge/heartbeat     ← PC status       │
│   GET  /api/weighbridge/system-status → admin view      │
│   GET  /api/weighbridge/factory-users → user CRUD       │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS (X-WB-Key auth)
                      │ via Tailscale (100.x.x.x)
                      │
┌─────────────────────┴───────────────────────────────────┐
│            FACTORY SERVER (Central Hub)                   │
│            Windows Server 2019, 65GB RAM                 │
│            LAN: 192.168.0.10 | Tailscale: 100.126.101.7 │
│            Port: 5000                                    │
│                                                         │
│   Code:    factory-server/src/                           │
│   Stack:   Node.js + Express + Prisma + React            │
│   DB:      Same Railway PostgreSQL (via internet)        │
│                                                         │
│   What it does:                                          │
│   1. Receives weighments from ALL WB PCs on LAN          │
│   2. Syncs to cloud (background worker, 10s interval)    │
│   3. Monitors all PCs (heartbeats, online/offline)       │
│   4. Serves admin dashboard (React frontend)             │
│   5. Manages factory user accounts                       │
│                                                         │
│   Pages (React frontend at :5000):                       │
│   /              → Login                                 │
│   /gate-entry    → Gate operator creates vehicle entries  │
│   /weighment     → Weighment dashboard (all PCs)         │
│   /dashboard     → Admin: PC status, sync stats          │
│   /users         → Admin: create/edit factory users       │
│                                                         │
│   API Routes:                                            │
│   /api/auth      → login, user CRUD, seed                │
│   /api/weighbridge/push → receive from WB PCs            │
│   /api/sync      → manual push/pull triggers             │
│   /api/heartbeat → PC heartbeats                         │
│   /api/health    → server health + sync status            │
│                                                         │
└──────────┬──────────┬──────────┬────────────────────────┘
           │          │          │   LAN (192.168.0.x)
           ▼          ▼          ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   WB-PC-1    │ │   WB-PC-2    │ │   WB-PC-N    │
│   (Gate)     │ │   (Scale)    │ │   (Future)   │
│              │ │              │ │              │
│ 192.168.0.83 │ │ 192.168.0.?? │ │ 192.168.0.?? │
│ Tailscale:   │ │              │ │              │
│ 100.91.152.57│ │              │ │              │
│ Port: 8098   │ │              │ │              │
│              │ │              │ │              │
│ Code:        │ │              │ │              │
│ weighbridge/ │ │ (same code)  │ │ (same code)  │
│              │ │              │ │              │
│ Stack:       │ │              │ │              │
│ Python Flask │ │              │ │              │
│ SQLite local │ │              │ │              │
│              │ │              │ │              │
│ 3 threads:   │ │              │ │              │
│ 1. WeightReader (COM1 serial) │ │              │
│ 2. Flask UI  │ │              │ │              │
│ 3. CloudSync │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Three Codebases, Three Purposes

### 1. Weighbridge PC App (Python Flask)
**Repo path:** `weighbridge/`
**Runs on:** Each weighbridge PC (Windows, port 8098)
**Purpose:** Operator-facing — captures weights from the physical scale

| File | Purpose |
|------|---------|
| `run.py` | Entry point, watchdog (3 threads, auto-restart) |
| `web_ui.py` | Flask server, all API routes + HTML pages |
| `config.py` | Serial port, DB path, cloud URLs, intervals |
| `weight_reader.py` | Reads scale (serial COM1 or file mode) |
| `local_db.py` | SQLite schema + CRUD + sync queue |
| `cloud_sync.py` | Push weighments to factory server, pull master data |
| `templates/` | HTML: index, history, login, slip, gate_pass, gross_slip |

**Operator workflow on this PC:**
1. Gate Entry tab → enter vehicle, supplier, material, PO → prints QR gate pass
2. Weighing tab → scan QR → capture gross weight → truck goes to unload
3. Weighing tab → scan QR again → capture tare weight → prints final slip
4. CloudSync thread pushes COMPLETE weighments to factory server every 10s

**Key URLs (on LAN):**
- `http://192.168.0.83:8098/` → Main operator screen (3 tabs)
- `http://192.168.0.83:8098/history` → Search & reprint slips
- `http://192.168.0.83:8098/api/health` → Health check

### 2. Factory Server (Node.js + React)
**Repo path:** `factory-server/`
**Runs on:** Central Windows Server (port 5000)
**Purpose:** Hub that aggregates all PCs, syncs to cloud, admin dashboard

**Backend:** `factory-server/src/`
**Frontend:** `factory-server/frontend/` (built to `factory-server/public/`)

**Key URLs (on LAN or Tailscale):**
- `http://100.126.101.7:5000/` → Admin dashboard login
- `http://100.126.101.7:5000/dashboard` → PC status, sync stats
- `http://100.126.101.7:5000/users` → Manage factory operators
- `http://100.126.101.7:5000/weighment` → All weighments from all PCs
- `http://100.126.101.7:5000/api/health` → Server health JSON

### 3. Cloud ERP (Node.js + React)
**Repo path:** `backend/` + `frontend/`
**Runs on:** Railway (app.mspil.in)
**Purpose:** Enterprise system — receives weighments, creates GRNs, manages inventory

**Key endpoints for factory:**
- `POST /api/weighbridge/push` → factory server pushes weighments here
- `GET /api/weighbridge/system-status` → shows all PCs on admin page
- `GET /api/weighbridge/factory-users` → proxies user management to factory server

---

## How Data Flows

```
OPERATOR ACTION          WB PC (Flask)         FACTORY SERVER        CLOUD ERP
───────────────          ─────────────         ──────────────        ─────────
Gate Entry →            SQLite row created
                         (status: GATE_ENTRY)
                                    ──push──→  PostgreSQL row
                                                (cloudSynced: false)
                                                         ──sync──→  GrainTruck created
                                                                    (status: GATE_ENTRY)

Gross Weight →          SQLite updated
                         (status: GROSS_DONE)
                                    ──push──→  Row updated
                                                         ──sync──→  GrainTruck updated

Lab tests truck →       (via cloud ERP lab page)                    GrainTruck updated
                                                                    (moisture, quarantine)

Tare Weight →           SQLite updated
                         (status: COMPLETE)
                                    ──push──→  Row updated
                                               cloudSynced=true      GRN auto-created
                                                         ──sync──→  PO line updated
                                                                    Inventory updated
```

---

## How to Add a New Weighbridge PC

### Step 1: Prepare the PC
- Windows 10/11 with Python 3.11+
- Serial port (USB-to-serial adapter or PCI card) connected to indicator
- Network: plug into factory LAN (192.168.0.x)
- Note its LAN IP and serial port (COM1, COM3, etc.)

### Step 2: Deploy the Flask app
```bash
# From your dev machine:
scp -r weighbridge/ user@NEW_PC_IP:C:/mspil-weighbridge/

# On the PC — edit config:
# config.py: set SERIAL_PORT, PC_ID, PC_NAME, CLOUD_SYNC_URL
```

Key config values in `config.py`:
```python
PC_ID = "WB-PC-2"              # Unique ID for this PC
PC_NAME = "Weighbridge Gate 2"  # Human name
SERIAL_PORT = "COM3"            # Serial port for this PC's indicator
SERIAL_BAUD = 2400
CLOUD_SYNC_URL = "http://192.168.0.10:5000/api"  # Factory server LAN IP
WB_PUSH_KEY = "mspil-wb-2026"   # Must match factory server's WB_API_KEY
```

### Step 3: Install & start as service
```batch
REM On the PC:
cd C:\mspil-weighbridge
pip install flask requests
python run.py
```
Or install as a Windows service using NSSM.

### Step 4: Register on factory server
The PC auto-registers when it sends its first heartbeat. No manual config needed on the factory server — it discovers PCs dynamically.

### Step 5: Verify
- PC shows up on factory server dashboard (`/dashboard`)
- Cloud ERP system-status page shows the new PC
- Create a test gate entry → weigh → verify it syncs to cloud

---

## Where Things Are Managed

| Task | Where | URL |
|------|-------|-----|
| Create factory user accounts | Factory Server | `http://100.126.101.7:5000/users` |
| Monitor all PCs (online/offline) | Factory Server | `http://100.126.101.7:5000/dashboard` |
| View all weighments across PCs | Factory Server | `http://100.126.101.7:5000/weighment` |
| Manual sync trigger | Factory Server | `http://100.126.101.7:5000/dashboard` (buttons) |
| Correct a weighment after sync | Cloud ERP | PUT /api/weighbridge/weighment/:id |
| View GRNs created from weighments | Cloud ERP | `https://app.mspil.in/goods-receipts` |
| Lab testing (moisture, quarantine) | Cloud ERP | `https://app.mspil.in/raw-material` |
| Operate the scale (gate/weigh/print) | WB PC Flask | `http://192.168.0.83:8098/` |

---

## Repo Structure

```
distillery-erp/
├── weighbridge/                    ← Python Flask (runs on EACH WB PC)
│   ├── run.py                      # Entry point + watchdog
│   ├── web_ui.py                   # Flask routes + HTML serving
│   ├── config.py                   # Serial port, URLs, intervals
│   ├── weight_reader.py            # Scale reader (serial/file)
│   ├── local_db.py                 # SQLite schema + CRUD
│   ├── cloud_sync.py               # Push/pull to factory server
│   ├── templates/                  # HTML: index, login, slips
│   ├── deploy.sh                   # SCP deploy script
│   └── FACTORY_PC_README.txt       # Operator instructions
│
├── factory-server/                 ← Node.js hub (runs on FACTORY SERVER)
│   ├── src/
│   │   ├── server.ts               # Express app + startup
│   │   ├── config.ts               # Env vars, secrets
│   │   ├── prisma.ts               # DB client
│   │   ├── middleware.ts            # Auth, WB key check
│   │   ├── routes/
│   │   │   ├── auth.ts             # Login, user CRUD, seed
│   │   │   ├── weighbridge.ts      # Receive from PCs, state machine
│   │   │   ├── gateEntry.ts        # Gate entry routes
│   │   │   ├── sync.ts             # Manual push/pull triggers
│   │   │   ├── heartbeat.ts        # PC heartbeats
│   │   │   └── masterData.ts       # Cached master data queries
│   │   └── services/
│   │       ├── syncWorker.ts       # Background sync (auto, backoff)
│   │       └── pcMonitor.ts        # LAN PC polling
│   ├── frontend/                   # React admin dashboard
│   │   └── src/pages/
│   │       ├── Login.tsx
│   │       ├── GateEntry.tsx       # Gate operator view
│   │       ├── Weighment.tsx       # Weighment dashboard
│   │       ├── AdminDashboard.tsx  # PC status + sync
│   │       └── UserManagement.tsx  # Create/edit users
│   ├── prisma/schema.prisma        # DB schema (shared Railway PG)
│   └── public/                     # Built frontend (vite build output)
│
├── backend/src/routes/
│   └── weighbridge.ts              # Cloud-side: receive, GRN, inventory
│
└── .claude/skills/
    ├── factory-architecture.md     # THIS FILE — master reference
    ├── weighbridge-system.md       # Hardware, serial protocol, safety
    ├── factory-server.md           # Factory server setup details
    └── factory-linkage.md          # SSH, deploy, troubleshooting
```

---

## Current Known Issues

1. **Weight = 0 in file mode** — WtService uses 8-bit instead of 7-bit, weight file stays empty. Operators use manual weight entry. Fix: change `ComDataBits` from 8 to 7 in `D:\WT\WtService.exe.config` (needs factory coordination).
2. **WtService is RE-ENABLED** — disabling it halted old gate entry (2026-03-31 incident). Python runs in FILE mode alongside it. Serial mode works but conflicts with WtService on COM1.
3. **Only 1 WB PC active** — PC at 192.168.0.83. Architecture supports N PCs, just deploy.
4. **Factory app migration in progress** — GrossWeighment.tsx, TareWeighment.tsx not yet built. See `.claude/plans/breezy-scribbling-quilt.md`.

---

## Server Specs

| Item | Value |
|------|-------|
| **Hostname** | WIN-PBMJ9RMTO6L |
| **OS** | Windows Server 2019 Standard (Build 17763) |
| **RAM** | 65 GB |
| **Disk C:** | 307 GB total, 194 GB free |
| **Disk E:** | 586 GB total, 313 GB free |
| **LAN IP 1** | 192.168.0.10 (Embedded NIC 2) |
| **LAN IP 2** | 192.168.0.92 (Embedded NIC 1) |
| **Tailscale IP** | 100.126.101.7 |
| **User** | Administrator / Mspil@1212 |
| **SSH** | Port 22 (OpenSSH, auto-start) |
| **Node.js** | v18.20.5 |
| **Sleep** | Disabled (24/7) |

### Existing Services (DO NOT TOUCH)

| Service | Port | Status |
|---------|------|--------|
| Oracle XE 11g | 1521 | Running — Print Consol depends on it |
| Unknown | 8070, 8080, 8888 | Listening — investigate before using |

### Port Allocation

| Port | Service | Status |
|------|---------|--------|
| 5000 | Factory Backend API + React Frontend | **LIVE** |
| 5432 | PostgreSQL 16 | **LIVE** |
| 8098 | Weighbridge PC Flask (not on this server) | Reserved |
| 8099 | OPC Bridge (not on this server) | Reserved |

---

## SSH & Deploy

### SSH from Mac (via Tailscale)
```bash
# Factory Server
sshpass -p 'Mspil@1212' ssh -o StrictHostKeyChecking=no Administrator@100.126.101.7

# Weighbridge PC (Tailscale must be on)
sshpass -p 'acer@123' ssh -o StrictHostKeyChecking=no abc@100.91.152.57

# Lab PC
sshpass -p '123' ssh -o StrictHostKeyChecking=no abc@100.74.209.72
```

### Deploy Factory Server
```bash
cd ~/Desktop/distillery-erp/factory-server
npx tsc --outDir dist
cd frontend && npx vite build && cd ..
# SCP files:
sshpass -p 'Mspil@1212' scp -r -o StrictHostKeyChecking=no dist/* Administrator@100.126.101.7:C:/mspil/factory-server/dist/
sshpass -p 'Mspil@1212' scp -r -o StrictHostKeyChecking=no public/* Administrator@100.126.101.7:C:/mspil/factory-server/public/
sshpass -p 'Mspil@1212' scp -o StrictHostKeyChecking=no prisma/schema.prisma Administrator@100.126.101.7:C:/mspil/factory-server/prisma/
# If schema changed:
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 "cd C:\mspil\factory-server && npx prisma db push"
# Restart via pm2 (NEVER use bare node — process must auto-restart on crash/reboot):
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 "pm2 restart factory-server && pm2 save"
# Verify:
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 "pm2 list"
```

### Deploy Weighbridge PC
```bash
cd ~/Desktop/distillery-erp/weighbridge
sshpass -p 'acer@123' scp -o StrictHostKeyChecking=no *.py abc@100.91.152.57:C:/mspil/weighbridge/
sshpass -p 'acer@123' scp -o StrictHostKeyChecking=no templates/*.html abc@100.91.152.57:C:/mspil/weighbridge/templates/
# CRITICAL: restart Flask after deploy (templates cached in memory!)
sshpass -p 'acer@123' ssh abc@100.91.152.57 "taskkill /F /IM pythonw.exe 2>&1"
sleep 2
sshpass -p 'acer@123' ssh abc@100.91.152.57 "schtasks /run /tn \"MSPIL Weighbridge\""
```

---

## Troubleshooting

### Weighbridge shows weight=0 but connected=true
- No truck on scale (normal for empty scale), OR
- WtService 8-bit bug — weight file stays empty. Manual entry works as fallback.

### Weighbridge shows connected=false
- COM1 conflict — check WtService: `sc query WTReadingNew`
- Service crashed — restart: `schtasks /run /tn "MSPIL Weighbridge"`
- Delete PID file first: `Remove-Item C:\mspil\weighbridge\data\weighbridge.pid -Force`

### "table weighments has no column named X"
- SQLite schema outdated — delete DB and restart:
```bash
sshpass -p 'acer@123' ssh abc@100.91.152.57 "taskkill /F /IM pythonw.exe 2>&1"
sshpass -p 'acer@123' ssh abc@100.91.152.57 "powershell -Command \"Remove-Item 'C:\mspil\weighbridge\data\weighbridge.db*' -Force\""
sshpass -p 'acer@123' ssh abc@100.91.152.57 "schtasks /run /tn \"MSPIL Weighbridge\""
```

### Account locked out ("referenced account is currently locked out")
- Too many failed SSH attempts. Hard reboot the PC, or wait 30 min.

### Factory server won't start
- Check schtask: `schtasks /query /tn "MSPIL Factory Server"`
- Port 5000 in use: `netstat -an | findstr 5000`

---

## Safety Rules

1. **NEVER stop/disable WtService** (WTReadingNew) — halted old gate entry on 2026-03-31
2. **NEVER stop/modify Oracle XE** or Print Consol — legacy system still in use
3. **NEVER use ports** 1521, 8070, 8080, 8888 — already in use
4. **NEVER rapidly retry SSH** — causes Windows account lockout (30 min or reboot)
5. **NEVER delete** `C:\mspil\weighbridge\certs\` on OPC PC
6. **ALWAYS restart service after deploying** — Flask caches templates in memory
7. **ALWAYS use schtasks** for auto-start (survives SSH disconnect)
8. **ALWAYS delete weighbridge.db** when SQLite schema changes
9. **ALWAYS use pure black (#000) text** in slip templates — thermal printers can't print gray
10. **ALWAYS keep sleep disabled** on all factory PCs
