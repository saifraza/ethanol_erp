# Factory Operations — Architecture, Safety, Postmortems

> **READ THIS ENTIRELY BEFORE ANY FACTORY WORK.** Merges former `factory-incidents-postmortem.md` (critical safety rules — load-bearing) and `factory-architecture.md` (reference).

---

## Part A — Incidents & Permanent Rules (formerly factory-incidents-postmortem.md)

> Every rule here is written in blood. Do not skip.

# Factory Incidents — Postmortem & Permanent Rules

> **Read this first** before making ANY change that touches `factory-server/`, `weighbridge/`, or anything deployed to the factory PC. The plant runs on this infrastructure. Every rule below is written in blood — each one corresponds to a real outage that stopped trucks, halted production, or silently broke data.
>
> **Golden rule**: the factory is not staging. You can't "fix forward" at 11 PM when operators are trying to weigh rice husk. Every deploy must be proven correct BEFORE it lands on the PC.

---

## Incident Timeline

### 1. WtService halted weighbridge — 2026-03-31
**What happened**: Someone stopped/disabled WtService (Oracle's weighbridge reader) during a debug session. WtService reads COM1 and writes weight to a shared file that Oracle ERP reads. When it stopped, the old Oracle ERP couldn't get weights — trucks piled up at the gate for hours.

**Root cause**: We assumed WtService was ours. It's not. It belongs to the legacy Oracle ERP.

**Permanent rule**: **Never stop, disable, or modify any Windows service** on the factory PC. Our processes are ONLY `node.exe` (factory-server) and `pythonw.exe` (weighbridge Flask). Everything else — Oracle, WtService, Print Consol, whatever — is sacred. If a service is misbehaving, investigate but don't touch it without confirming ownership.

### 2. Oracle service stopped — prior to 2026-04-05
**What happened**: Oracle XE or Oracle TNS Listener was stopped. The factory ERP (the old Oracle one, not ours) went down. Plant ops were blocked.

**Permanent rule**: `OracleServiceXE` and `OracleXETNSListener` must ALWAYS be in `RUNNING` state. Deploy script verifies this before touching anything and aborts if either is down. There is NO scenario where it's OK for those services to be stopped.

### 3. factory-server node process died — 2026-04-05
**What happened**: Found the factory-server node process dead. No auto-restart, no alert. Trucks couldn't submit gate entries.

**Root cause**: Server was running as bare `node dist/server.js` under a shell. When it crashed, nothing brought it back. No logs, no watchdog.

**Permanent rule**: Factory-server runs under a Windows **scheduled task** (`FactoryServer`, via `run.bat`). Scheduled tasks survive reboots, don't depend on an interactive shell, and can be relaunched with `schtasks /run /tn FactoryServer`. We experimented with pm2 but pm2's daemon doesn't persist reliably across Windows reboots. **Use schtasks. Period.**

### 4. Weighbridge `/push` — cloud schema drift — 2026-04-06
**What happened**: Weighbridge pushed `GrainTruck` to cloud but dropped `vehicle_type`, `driver`, `transporter` fields. Silent data loss.

**Root cause**: Schema fields existed locally but were never mapped in the cloud-side `/push` handler.

**Permanent rule**: Every field added to a weighbridge model must be explicitly mirrored in the cloud `/push` handler for that product. See `.claude/skills/weighbridge-add-product.md` — read it BEFORE adding any new weighbridge product or field.

### 5. Ethanol sync 5-hour outage — 2026-04-07
**What happened**: `ethanolOutbound` handler wrote `quantityKL` to `DispatchTruck` — but `DispatchTruck` has no `quantityKL` column. Every ethanol truck sync failed for 5 hours. No alert.

**Root cause**: Developer assumed the field existed. Prisma threw `Unknown argument` on every write. Error was logged but not alerted, and plant operators had no visibility into "sync failed silently."

**Discovery path**: `PlantIssue` safety net eventually surfaced it via dashboard.

**Permanent rule (tooling)**: Before writing a new field into a Prisma model, **verify** the field exists in the schema file. `grep -n "fieldName" prisma/schema.prisma` before you trust any field name. Never copy-paste from a spec document and assume.

**Permanent rule (observability)**: Sync failures MUST surface to the operator and to Telegram, not just to `console.error`. PlantIssue dashboard shouldn't be the last line of defense — it should be the backup to a Telegram alert.

### 6. Gate entry silent 500 — 2026-04-08 ⚠ (most recent)
**What happened**: EVERY gate entry submission on the factory server returned `Internal server error`. Operators couldn't bring trucks into the plant. Production halted at the gate. Duration: unknown but at least several hours — it may have been broken since commit `1b780dc` was deployed.

**Error**: `Unknown argument 'cloudContractId'. Available options are marked with ?.` from `tx.weighment.create()` inside the POST /api/weighbridge/gate-entry handler.

**Root cause**: Commit `1b780dc feat(factory): DDGS contract picker at gate entry (mirrors ethanol)` added a `cloudContractId String?` field to the factory-server Weighment schema AND added code that writes to it. The deploy copied `dist/` and `schema.prisma` to the server but **did not run `npx prisma generate`**. The compiled Prisma client in `node_modules/.prisma/client` on the factory PC was still the OLD one — it didn't know `cloudContractId` existed. Every Prisma write that referenced the new field threw `Unknown argument` at runtime.

**Why it was invisible**: `run.bat` had no stdout/stderr redirection — the Windows scheduled task launched node, node wrote errors to stdout, and those went nowhere. We had no log file for hours of failures. Operators just saw "Internal server error" in the browser.

**Windows gotcha**: `npx prisma generate` errors with `EPERM: operation not permitted, rename ... query_engine-windows.dll.node.tmp -> query_engine-windows.dll.node` when node is running. Windows holds the DLL open. You MUST `taskkill /F /IM node.exe` before generating, then restart via `schtasks /run`.

**Fix applied 2026-04-08**:
1. Added stdout/stderr redirection to `run.bat` — every restart creates `logs/server-YYYYMMDD_HHMMSS.log`. Errors can never be invisible again.
2. Ran `prisma generate` on the factory PC. Gate entry worked immediately.
3. Wrote `factory-server/scripts/deploy.sh` — the ONLY sanctioned deploy path going forward. It bakes in `prisma generate`, service safety checks, local preflight compile, health probes, and startup log scanning.
4. Committed `run.bat` and `deploy.sh` to the repo so they're version-tracked.

### 7. "Cloud data stale" false positive — 2026-04-08 (same day)
**What happened**: Gate entry page showed orange banner `⚠ Cloud data stale (6 min) — verify before submitting` even though cloud sync was running perfectly.

**Root cause**: `masterDataCache.ts` ran `smartSync()` every 5 seconds. The sync pinged cloud for a "has anything changed" timestamp. If the timestamp was unchanged (i.e., nobody had edited a PO / supplier / vehicle in the last few minutes), the function correctly skipped the full sync — but it updated `lastCloudCheck` every tick while only updating `lastCloudSync` on actual data changes. The staleness check then used `lastCloudSync` — so during quiet periods (no cloud edits for 5+ minutes) the banner would always go stale. Worse: when cloud was UNREACHABLE, `lastCloudCheck` was also updated (before the failure check), which meant real sync failures were masked.

**Impact**: Operators would see the warning banner constantly during quiet periods. They'd learn to ignore it. Then when it fires for a REAL outage, nobody would notice. This is the "boy who cried wolf" failure mode — alerts that fire too often train users to ignore them, at which point they have negative value.

**Fix applied 2026-04-08**:
- Staleness check now uses `lastCloudCheck` (successful ping), not `lastCloudSync` (data change).
- `lastCloudCheck` is only updated AFTER the ping succeeds.
- Threshold reduced from 5 min to 2 min (~24 consecutive failed 5-sec checks = real problem).
- Added `consecutiveCheckFailures` counter with an error log at 24 consecutive failures.
- TODO: wire that counter into a Telegram alert so somebody wakes up when it trips.

---

## Permanent Rules (distilled from all incidents above)

### Deploy Rules
1. **Always use `./factory-server/scripts/deploy.sh`**. Never manual SCP + restart.
2. **Local compile must pass** before SCP begins. `tsc` + `vite build` locally. No shipping broken code.
3. **Verify OracleServiceXE + OracleXETNSListener + WtService are RUNNING** before any deploy. Abort if not.
4. **Kill node.exe** before running `prisma generate` (Windows DLL lock).
5. **Always run `prisma generate`** after SCP, even if you think the schema didn't change. Cost of running it when unneeded = 300ms. Cost of skipping it when needed = production outage.
6. **Always restart via `schtasks /run /tn FactoryServer`**, never bare `node dist/server.js`.
7. **Always hit `/api/health` + `/api/weighbridge/summary`** after restart. Deploy isn't done until both return OK.
8. **Always scan the newest `logs/server-*.log`** for `[ERROR]`, `PrismaClientKnown`, `Unknown argument` after restart. Any hit = deploy failed, investigate.

### Code Rules
9. **Before writing a field into a Prisma model**, verify the field exists in `schema.prisma`. Never copy from a spec.
10. **Every field added to a weighbridge model** must be mirrored in the cloud `/push` handler for that product.
11. **No `catch (err: any) { res.status(500).json({ error: err.message }) }`** in factory-server routes. Use `asyncHandler` and let errors bubble into the log file.
12. **No silent catches anywhere**. `try { ... } catch { /* ignore */ }` is banned unless you comment WHY ignoring is safe and what the fallback behavior is.

### Observability Rules
13. **`run.bat` must redirect stdout/stderr** to a timestamped log file in `logs/`. Committed to repo. Never deploy a version that drops this.
14. **Staleness detection must be based on successful ping**, not on data-change events. "Nothing happened" is not the same as "nothing is working."
15. **Consecutive failures must be counted** and alerted once a threshold is crossed. Single failures are noise, repeated failures are signal.
16. **Alerts that fire during healthy operation are worse than no alert**. Every false positive trains operators to ignore the next one. When in doubt, raise the threshold, don't lower it.
17. **Operators must see actionable errors**, not `Internal server error`. Surface the actual constraint violation ("PO #61 is closed", "vehicle already inside") so they can fix it without calling the developer.

### Safety Rules (repeated because they matter)
18. **Never stop/disable any Windows service** on the factory PC. Not Oracle, not WtService, not Print Consol, not anything. Our processes are `node.exe` and `pythonw.exe` only.
19. **Never rapidly retry SSH** after a password failure. 5 wrong attempts = 30-minute account lockout. Slow down.
20. **Never taskkill broadly**. Always `taskkill /F /IM node.exe` or by PID — never `taskkill /F /IM *` or similar.
21. **Never deploy without an exit plan**. Know how to roll back before you deploy: `git checkout <last-good-sha> -- factory-server/ && ./factory-server/scripts/deploy.sh`.

---

## Quick Reference — "The server is broken, what do I do?"

### Step 1: Check the log
```bash
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 \
  'powershell -Command "Get-ChildItem C:\mspil\factory-server\logs\server-*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100"'
```
This is the first thing to run. Before guessing, before Googling, before SSH-ing in further — read the log.

### Step 2: Check services
```bash
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 \
  'sc query OracleServiceXE & sc query OracleXETNSListener & sc query WtService & tasklist /fi "IMAGENAME eq node.exe"'
```
All four should be present and in `RUNNING` (or node should have a PID).

### Step 3: Check health
```bash
curl -s http://100.126.101.7:5000/api/health | python3 -m json.tool
```
Look at `sync.consecutiveFailures`, `pcs[].alive`, `cameras[].alive`.

### Step 4: If it's a Prisma `Unknown argument` error
```bash
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 \
  'taskkill /F /IM node.exe & timeout /t 3 /nobreak >nul & cd C:\mspil\factory-server && npx prisma generate & schtasks /run /tn FactoryServer'
```

### Step 5: If it's genuinely broken code
```bash
git log --oneline factory-server/ | head -5
git checkout <last-good-sha> -- factory-server/
./factory-server/scripts/deploy.sh
```

---

## What Good Looks Like

A healthy factory-server deploy session looks like this:

```
[deploy] Preflight: compiling locally (tsc + vite)...
[  ok  ] local build clean
[deploy] Verifying factory server is reachable...
[  ok  ] SSH OK
[deploy] Verifying Oracle + WtService are still healthy...
STATE              : 4  RUNNING
STATE              : 4  RUNNING
STATE              : 4  RUNNING
[  ok  ] Oracle + WtService running
[deploy] Copying dist/ to server...
[deploy] Copying public/ (frontend build) to server...
[deploy] Copying prisma/ schema...
[deploy] Copying package.json + package-lock.json...
[  ok  ] files copied
[deploy] Stopping factory node (NOT Oracle, NOT WtService)...
SUCCESS: The process "node.exe" has been terminated.
[  ok  ] node stopped
[deploy] Regenerating Prisma client (MANDATORY — do not skip)...
✔ Generated Prisma Client (v6.19.2) to .\node_modules\@prisma\client in 268ms
[  ok  ] Prisma client regenerated
[deploy] Relaunching FactoryServer scheduled task...
SUCCESS: Attempted to run the scheduled task "FactoryServer".
[  ok  ] schtask triggered
[deploy] Waiting 8s for node to boot...
[deploy] Checking /api/health...
[  ok  ] health OK (status=ok, uptime=8.2s)
[deploy] Checking /api/weighbridge/summary (requires DB)...
[  ok  ] DB query OK
[deploy] Tailing newest server log for startup errors...
--- tail server-20260408_130145.log ---
[CACHE] Initial cloud sync complete
[CACHE] Smart sync started (every 5s)
[server] Factory Hub listening on :5000
--- end log ---
[  ok  ] no startup errors

[  ok  ] DEPLOY COMPLETE — factory server is up. Time: 01:02 PM
```

Anything less — ANY `[ FAIL ]` line, any `[ warn ]` you don't understand, any unexpected error in the tailed log — means the deploy is NOT done. Do not walk away. Do not assume it'll work out. Investigate before you close the terminal.

---

## File Map — where the deploy safety lives

| File | Purpose |
|---|---|
| `factory-server/scripts/deploy.sh` | The one sanctioned deploy script. Refuses to deploy on unhealthy state. |
| `factory-server/run.bat` | Launcher with permanent stdout/stderr → timestamped log files. Committed to git for reference, lives at `C:\mspil\factory-server\run.bat` on the PC. |
| `factory-server/src/services/masterDataCache.ts` | Cache freshness logic. Staleness computed from `lastCloudCheck`, not `lastCloudSync`. Counts consecutive ping failures. |
| `.claude/skills/factory-architecture.md` | Deploy procedure + SSH commands + troubleshooting runbook. Points back to this file for incident history. |
| `.claude/skills/factory-incidents-postmortem.md` | **This file.** The institutional memory. |
| `.claude/skills/debt-register.md` | Known tech debt, severity ranked. |
| `.claude/skills/weighbridge-add-product.md` | Required reading before adding any new weighbridge product. Prevents incident #4-style drift. |

---

## Never again

Every single incident above shares one pattern: **a silent failure that the system kept running through, while operators tried to work and couldn't figure out why nothing worked**. The specific bug differs. The class is the same.

The defense is simple and non-negotiable:

1. **Log everything.** Never run code whose stderr vanishes. `run.bat` enforces this.
2. **Fail fast.** The deploy script refuses to continue on any anomaly. No "probably fine" deploys.
3. **Alert on absence of progress.** `consecutiveCheckFailures` counter. Master-data staleness. PlantIssue dashboard.
4. **Operators see real errors**, not `Internal server error`. Surface Prisma constraint violations, foreign key errors, unique constraint conflicts in a human-readable form.
5. **Every incident becomes a rule.** This file grows with every outage. Future Claude sessions must read it before touching the factory.

The factory runs 24/7. The plant depends on gate entry, weighment, dispatch, and DDGS workflows working ALL the time. We don't get maintenance windows. We don't get "oops, I'll fix it tomorrow." We get one shot to do deploys safely, and every shortcut above came back to bite us within days.

**Read this file before every factory deploy. Read it again when you're stuck. Add to it after every incident.**

---

## Part B — Architecture & Deploy Runbook (formerly factory-architecture.md)

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

### Deploy Factory Server — USE THE SCRIPT, DO NOT DO IT MANUALLY

**One command, always:**
```bash
./factory-server/scripts/deploy.sh
```

This is the **only** sanctioned deploy path after 2026-04-08. Manual SCP deploys are forbidden because the plant has been burned twice by human error: once by missing `prisma generate` (2026-04-08, gate entry broke silently for hours) and once by a stale Prisma field in cloud sync (2026-04-07, 5-hour outage). The script encodes every lesson learned.

**What the script does (never skip, never shortcut):**

1. **Local preflight** — runs `tsc` + `vite build` locally first. If the code doesn't compile on your Mac it never reaches the factory PC. No "I'll fix it after deploy" gaps.
2. **Safety verification** — SSHs in and confirms `OracleServiceXE`, `OracleXETNSListener`, `WtService` are all `RUNNING` **before** touching anything. If any service is sick, the script aborts — you investigate the underlying problem, not layer new code on top of broken infrastructure.
3. **SCP artifacts** — `dist/`, `public/`, `prisma/schema.prisma`, `package.json`, `package-lock.json`. Sending the schema and package files lets the next step detect any drift.
4. **Kill our node only** — `taskkill /F /IM node.exe`. This is safe because the factory PC runs no other Node.js processes. **Absolutely never** `taskkill` anything else on the box.
5. **`npx prisma generate`** — **MANDATORY**. Runs after node is dead (Windows holds the query engine DLL open otherwise — generate will EPERM if node is alive). This step regenerates `node_modules/.prisma/client` against the schema you just uploaded. Skipping it means: any new field in the schema throws `Unknown argument` at runtime. This is the exact bug that killed gate entry for a full work day on 2026-04-08.
6. **`schtasks /run /tn FactoryServer`** — relaunches via scheduled task. (We don't use `pm2` — on Windows, pm2's daemon doesn't persist across reboots reliably. schtasks is the survivable path.)
7. **Health check** — hits `/api/health` and `/api/weighbridge/summary`. Fails the deploy if either is bad. Doesn't leave you guessing whether the server came back clean.
8. **Startup log scan** — tails the newest `logs/server-*.log` and searches for `[ERROR]`, `PrismaClientKnown`, `Unknown argument`. If any of those appear, the deploy is marked FAILED — you get the error in your terminal, not from an operator calling you an hour later.

**`run.bat` on the factory PC (committed at `factory-server/run.bat`):**
```bat
@echo off
cd /d C:\mspil\factory-server
if not exist logs mkdir logs
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set dt=%%a
set stamp=%dt:~0,8%_%dt:~8,6%
"C:\Program Files\nodejs\node.exe" dist\server.js >> logs\server-%stamp%.log 2>&1
```

Every restart creates a fresh timestamped log. **Nothing** vanishes into the void anymore. Before 2026-04-08, `run.bat` had no redirection and every error the node process emitted was thrown away — which is how gate entry could fail for hours without anyone knowing why.

**Rollback procedure (manual, if deploy.sh can't self-heal):**
```bash
git log --oneline factory-server/ | head -5   # pick last good sha
git checkout <sha> -- factory-server/
./factory-server/scripts/deploy.sh             # redeploy the old code
```

**When manual intervention IS ok:**
- Reading logs (`ssh ... type C:\mspil\factory-server\logs\server-*.log`)
- `prisma generate` + `schtasks /run /tn FactoryServer` as emergency fix if the script itself is broken and you need a fast patch
- Editing `.env` on the server (not tracked in git)

Everything else — go through `deploy.sh`.

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
