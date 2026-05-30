# Factory Operations — Architecture & Deploy Runbook

Reference for the MSPIL factory-floor systems: what runs where, how they connect, the sanctioned deploy path, and troubleshooting. Safety rules and incidents live in `SKILL.md` + `lessons.md` — read those first.

> All credentials (SSH passwords for factory server / WB PC / lab PC, the Administrator password) live in the out-of-git fleet doc `~/Desktop/infra/fleet.md`. Never write a password into this repo.

---

## The big picture

```
CLOUD (Railway) — app.mspil.in (ERP + API) + PostgreSQL (shared)
   POST /api/weighbridge/push          ← receives weighments
   PUT  /api/weighbridge/weighment/:id ← corrections
   GET  /api/weighbridge/master-data   → POs, suppliers
   POST /api/weighbridge/heartbeat     ← PC status
   GET  /api/weighbridge/system-status → admin view
   GET  /api/weighbridge/factory-users → user CRUD
   POST /api/biometric-factory/punches/push ← attendance batches (2026-05-07)
   GET  /api/biometric-factory/master-data  → cached employees + labor + devices
        │  HTTPS (X-WB-Key auth) via Tailscale (100.x.x.x)
        ▼
FACTORY SERVER (central hub) — Windows Server 2019, 65GB RAM
   LAN 192.168.0.10  |  Tailscale 100.126.101.7  |  port 5000
   Node.js + Express + Prisma + React
   DB: LOCAL Postgres on the box (DATABASE_URL) + read-only cloud client (CLOUD_DATABASE_URL)
   - receives weighments from ALL WB PCs on LAN
   - syncs to cloud (background worker, ~10s)
   - monitors PCs (heartbeats), serves admin dashboard, manages factory users
   - pulls fingerprint punches from biometric-bridge every 60s → local AttendancePunch → batches to cloud
        │  LAN (192.168.0.x)
        ▼
WB-PC-1 (gate) 192.168.0.83 / Tailscale 100.91.152.57 / port 8098
   Python Flask + local SQLite; 3 threads: WeightReader (COM1 serial), Flask UI, CloudSync
   Architecture supports N PCs; auto-register on first heartbeat.
```

### Local-first, cloud-sync (the core design decision, 2026-04-01)

The factory server is the CENTRAL HUB. It owns its **own** Postgres on the factory PC (not Oracle integration) and its own Node backend (same stack as cloud ERP). Local-first means factory operations are **never blocked by an internet outage** — weighments queue locally and sync when the link returns. It replaces the legacy Print Consol over time. No business logic on the factory server — that all lives in the cloud backend.

---

## Four codebases

| Codebase | Path | Runs on | Stack | Purpose |
|---|---|---|---|---|
| Weighbridge PC | `weighbridge/` | each WB PC :8098 | Python Flask + SQLite | Operator-facing scale capture |
| Factory Server | `factory-server/` | factory PC :5000 | Node + Express + Prisma + React | Hub: aggregate PCs, sync, admin dashboard |
| Cloud ERP | `backend/` + `frontend/` | Railway (app.mspil.in) | Node + Express + Prisma + React | Business logic, GRNs, inventory, accounting |
| Biometric Bridge | `biometric-bridge/` | same factory PC :5005 | Python FastAPI + pyzk | Stateless HTTP↔pyzk for eSSL/ZKTeco devices |

### Weighbridge PC (`weighbridge/`)
Files: `run.py` (entry + watchdog, 3 threads, auto-restart), `web_ui.py` (Flask routes + HTML), `config.py` (serial port, DB path, cloud URLs, intervals), `weight_reader.py` (scale read, serial COM1 or file mode), `local_db.py` (SQLite schema + CRUD + sync queue), `cloud_sync.py` (push/pull), `templates/`.
Operator workflow: Gate Entry (vehicle/supplier/material/PO → QR gate pass) → scan QR → gross weight → unload → scan QR → tare weight → final slip. CloudSync pushes COMPLETE weighments to the factory server ~every 10s.
LAN URLs: `http://192.168.0.83:8098/` (operator, 3 tabs), `/history` (search/reprint), `/api/health`.

### Factory Server (`factory-server/`)
Backend `factory-server/src/`, frontend `factory-server/frontend/` (built to `factory-server/public/`).
Pages at :5000 — `/` login, `/gate-entry`, `/weighment`, `/dashboard` (PC status + sync), `/users`.
API routes — `/api/auth`, `/api/weighbridge/push`, `/api/sync`, `/api/heartbeat`, `/api/health`.
Key src: `server.ts`, `config.ts`, `prisma.ts`, `middleware.ts` (auth + WB key), `routes/{auth,weighbridge,gateEntry,sync,heartbeat,masterData}.ts`, `services/{syncWorker.ts (auto sync, backoff), pcMonitor.ts (LAN PC polling), masterDataCache.ts, biometricScheduler.ts, biometricSync.ts}`.

### Biometric Bridge (`biometric-bridge/`)
Factory-led since 2026-05-07. eSSL devices on the plant LAN talk ONLY to the bridge. factory-server `biometricScheduler.ts` pulls punches from each device every 60s → factory Postgres `AttendancePunch` → `syncWorker.ts` batches to cloud (10-60s). Cloud-side scheduler skips devices where `factoryManaged=true`. Bridge URLs (factory PC only, never public): `http://127.0.0.1:5005/health`, `POST /devices/info`. Files: `bridge.py`, `requirements.txt`, `scripts/{install-windows.ps1,start-bridge.ps1,watchdog.ps1 (5-min self-heal if :5005 dies),register-task.ps1}`, `DEPLOY.md`.

---

## Data flow

```
Gate Entry → SQLite (GATE_ENTRY) ──push→ PG (cloudSynced:false) ──sync→ GrainTruck (GATE_ENTRY)
Gross      → SQLite (GROSS_DONE)  ──push→ row updated          ──sync→ GrainTruck updated
Lab tests  → (cloud ERP lab page)                              ──────→ GrainTruck (moisture, quarantine)
Tare       → SQLite (COMPLETE)    ──push→ cloudSynced=true      ──sync→ GRN auto-created, PO line + inventory updated
Biometric  → eSSL buffers → bridge polls 60s → factory PG AttendancePunch → /punches/push → HR pages
```

---

## Deploy — USE THE SCRIPT, never manual

**One command, always:**
```bash
./factory-server/scripts/deploy.sh
```
The only sanctioned path after 2026-04-08. Manual SCP is forbidden — the plant was burned twice by human error (missing `prisma generate` 2026-04-08; stale Prisma field in cloud sync 2026-04-07, 5h outage).

What the script does (never skip, never shortcut):
1. **Local preflight** — `tsc` + `vite build` locally. Broken code never reaches the PC.
2. **Safety verification** — SSHs in, confirms `OracleServiceXE`, `OracleXETNSListener`, `WtService` are all `RUNNING`. Aborts if any is sick.
3. **SCP artifacts** — `dist/`, `public/`, `prisma/schema.prisma`, `package.json`, `package-lock.json`.
4. **Kill our node only** — `taskkill /F /IM node.exe`. Safe (no other Node on the box). NEVER kill anything else.
5. **`npx prisma generate`** — MANDATORY, runs after node is dead (Windows holds the query-engine DLL open → EPERM if node is alive). Regenerates `node_modules/.prisma/client` against the uploaded schema. Skipping = `Unknown argument` at runtime (the 2026-04-08 full-day gate-entry outage).
6. **`schtasks /run /tn FactoryServer`** — relaunch via scheduled task (pm2's daemon doesn't survive Windows reboots; schtasks does).
7. **Health check** — hits `/api/health` + `/api/weighbridge/summary`; fails the deploy if either is bad.
8. **Startup log scan** — tails newest `logs/server-*.log` for `[ERROR]`, `PrismaClientKnown`, `Unknown argument`. Any hit → deploy FAILED, investigate.

Any `[FAIL]` line, any unexplained `[warn]`, any unexpected log error = the deploy is NOT done. Do not walk away.

**`run.bat`** (committed at `factory-server/run.bat`, lives at `C:\mspil\factory-server\run.bat`) redirects stdout/stderr to a fresh timestamped log every restart:
```bat
@echo off
cd /d C:\mspil\factory-server
if not exist logs mkdir logs
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set dt=%%a
set stamp=%dt:~0,8%_%dt:~8,6%
"C:\Program Files\nodejs\node.exe" dist\server.js >> logs\server-%stamp%.log 2>&1
```

**Rollback (manual, if deploy.sh can't self-heal):**
```bash
git log --oneline factory-server/ | head -5   # pick last good sha
git checkout <sha> -- factory-server/
./factory-server/scripts/deploy.sh
```

**When manual intervention IS ok:** reading logs; `prisma generate` + `schtasks /run /tn FactoryServer` as an emergency fix if deploy.sh itself is broken; editing `.env` on the server (not tracked in git). Everything else → go through `deploy.sh`.

### Deploy Weighbridge PC
```bash
cd ~/Desktop/ethanol_erp/weighbridge
scp *.py abc@100.91.152.57:C:/mspil/weighbridge/                       # creds: ~/Desktop/infra/fleet.md
scp templates/*.html abc@100.91.152.57:C:/mspil/weighbridge/templates/
# CRITICAL: restart Flask after deploy (templates cached in memory)
ssh abc@100.91.152.57 "taskkill /F /IM pythonw.exe 2>&1"
ssh abc@100.91.152.57 "schtasks /run /tn \"MSPIL Weighbridge\""
```

---

## "The server is broken, what do I do?"

1. **Check the log** (first thing, before guessing):
   ```bash
   ssh Administrator@100.126.101.7 'powershell -Command "Get-ChildItem C:\mspil\factory-server\logs\server-*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100"'
   ```
2. **Check services** — all four present and `RUNNING` (or node has a PID):
   ```bash
   ssh Administrator@100.126.101.7 'sc query OracleServiceXE & sc query OracleXETNSListener & sc query WtService & tasklist /fi "IMAGENAME eq node.exe"'
   ```
3. **Check health** — `curl -s http://100.126.101.7:5000/api/health | python3 -m json.tool`. Look at `sync.consecutiveFailures`, `pcs[].alive`, `cameras[].alive`.
4. **Prisma `Unknown argument`** → regenerate (kill node first):
   ```bash
   ssh Administrator@100.126.101.7 'taskkill /F /IM node.exe & timeout /t 3 /nobreak >nul & cd C:\mspil\factory-server && npx prisma generate & schtasks /run /tn FactoryServer'
   ```
5. **Genuinely broken code** → rollback (see above).

Credentials for all SSH (`Administrator@100.126.101.7`, `abc@100.91.152.57` WB PC, lab PC `100.74.209.72`): `~/Desktop/infra/fleet.md`.

---

## How to add a new weighbridge PC

1. **Prepare** — Windows 10/11 + Python 3.11+, serial port to indicator, plug into factory LAN (192.168.0.x). Note LAN IP + COM port.
2. **Deploy Flask** — `scp -r weighbridge/ user@NEW_PC_IP:C:/mspil-weighbridge/`, then edit `config.py`:
   ```python
   PC_ID = "WB-PC-2"
   PC_NAME = "Weighbridge Gate 2"
   SERIAL_PORT = "COM3"
   SERIAL_BAUD = 2400
   CLOUD_SYNC_URL = "http://192.168.0.10:5000/api"   # factory server LAN IP
   WB_PUSH_KEY = "..."   # must match factory server's WB_API_KEY — value in fleet.md
   ```
3. **Install & start** — `pip install flask requests` then `python run.py` (or install as a service via NSSM).
4. **Register** — auto-registers on first heartbeat; no manual config on the factory server.
5. **Verify** — PC appears on `/dashboard` and the cloud system-status page; run a test gate entry → weigh → confirm cloud sync.

---

## Where things are managed

| Task | Where | URL |
|---|---|---|
| Create factory users | Factory Server | `http://100.126.101.7:5000/users` |
| Monitor PCs (online/offline) | Factory Server | `http://100.126.101.7:5000/dashboard` |
| View all weighments | Factory Server | `http://100.126.101.7:5000/weighment` |
| Manual sync trigger | Factory Server | `/dashboard` buttons |
| Correct a weighment after sync | Cloud ERP | `PUT /api/weighbridge/weighment/:id` |
| GRNs from weighments | Cloud ERP | `https://app.mspil.in/goods-receipts` |
| Lab testing (moisture/quarantine) | Cloud ERP | `https://app.mspil.in/raw-material` |
| Operate the scale | WB PC Flask | `http://192.168.0.83:8098/` |

---

## Server specs (factory PC)

| Item | Value |
|---|---|
| Hostname | WIN-PBMJ9RMTO6L |
| OS | Windows Server 2019 Standard (Build 17763) |
| RAM | 65 GB |
| Disk C: | 307 GB total, 194 GB free |
| Disk E: | 586 GB total, 313 GB free |
| LAN IP 1 | 192.168.0.10 (Embedded NIC 2) |
| LAN IP 2 | 192.168.0.92 (Embedded NIC 1) |
| Tailscale IP | 100.126.101.7 |
| User / password | Administrator / see `~/Desktop/infra/fleet.md` |
| SSH | Port 22 (OpenSSH, auto-start; firewall rule added) |
| Node.js | v18.20.5 |
| Sleep / hibernate | Disabled (24/7) |
| Remote access live since | 2026-04-01 |

### Existing services — DO NOT TOUCH
| Service | Port | Note |
|---|---|---|
| Oracle XE 11g (`OracleServiceXE` + `OracleXETNSListener`) | 1521 | Print Consol legacy gate entry depends on it; daily Oracle backups ~9AM (~1.3GB each) |
| WtService / WTReadingNew | — | Legacy Oracle weighbridge reader (COM1 → weight file) |
| Unknown | 8070, 8080, 8888 | Listening — investigate before using |

### Our port allocation
| Port | Service | Status |
|---|---|---|
| 3000 | frontend (planned) | reserved |
| 5000 | Factory backend API + React frontend | LIVE |
| 5432 | PostgreSQL 16 (local on factory PC) | LIVE |
| 5005 | Biometric Bridge | LIVE |
| 8098 | Weighbridge PC Flask (not on this server) | reserved |
| 8099 | OPC Bridge (not on this server) | reserved |

---

## Troubleshooting

- **WB shows weight=0 but connected=true** — no truck on scale (normal), OR the WtService 8-bit bug (weight file stays empty; manual entry works as fallback). Fix needs `ComDataBits` 8→7 in `D:\WT\WtService.exe.config` (factory coordination required).
- **WB shows connected=false** — COM1 conflict (`sc query WTReadingNew`); or service crashed → delete PID file (`Remove-Item C:\mspil\weighbridge\data\weighbridge.pid -Force`) then `schtasks /run /tn "MSPIL Weighbridge"`.
- **"table weighments has no column named X"** — SQLite schema outdated. Kill `pythonw.exe`, `Remove-Item 'C:\mspil\weighbridge\data\weighbridge.db*' -Force`, restart the task.
- **"referenced account is currently locked out"** — too many failed SSH attempts. Wait 30 min or hard-reboot the PC. Do NOT keep retrying.
- **Factory server won't start** — `schtasks /query /tn FactoryServer`; port 5000 in use → `netstat -an | findstr 5000`.
