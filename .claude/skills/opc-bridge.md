# OPC Bridge — System, Architecture, Incidents, Operations

> Master OPC bridge skill. Covers hardware/DCS connection, architecture, incidents, deploy, cloud sync, troubleshooting.
> **READ THIS ENTIRELY BEFORE ANY OPC BRIDGE WORK.**

---

## Part A — Incidents & Permanent Rules

> Every rule here is written from a real outage. Do not skip.

### 1. 24-hour zombie outage — 2026-04-08

**What happened**: OPC bridge python process on lab PC (ethanollab / 100.74.209.72) zombified at ~08:00 IST. For ~24 hours: no tag scans, no heartbeats reaching cloud, no Telegram alerts. User noticed only by checking the OPC Live page manually.

**Root causes (three layers failed simultaneously)**:

1. **`start_service.bat` watchdog** — The fallback branch matched `python.exe` by name (WMIC) but never checked if scans were actually happening. Zombie process kept passing the name check.
2. **Cloud `opcHealthWatchdog.ts`** — Alert only fired on online→offline transition (single-fire). After Railway restart, if bridge was already offline, one alert fired then nothing. `wasOnline` was in-memory, lost on restart.
3. **Heartbeat ≠ scanning** — `run.py` reported `opcConnected = scanner_thread.is_alive()`. A python thread blocked in `opcua node.get_children()` is `is_alive() == True` but produces nothing. The `python-opcua` library has no default timeout on TCP reads.

**Fixes deployed**:
- `start_service.bat` — fallback branch now checks heartbeat file freshness (<300s), kills+restarts if stale
- `run.py` — force-exits with `os._exit(2)` if `last_scan_completed_at` >10 min old. Windows watchdog respawns.
- Cloud watchdog — state persisted to `Settings.opcWatchdogState` (survives Railway restarts). Re-alerts every 30 min while offline. Separate scanner-stuck state machine.
- `opc_scanner.py` — tracks `self.last_scan_completed_at = time.time()` after every successful scan

**Permanent rules**:
- **Heartbeat alone is not liveness.** Always require a business-level progress marker (scan completion timestamp). Same pattern for any daemon.
- **Alert state machines must re-alert.** Single-fire transitions on in-memory state = silent-killer failure mode #1 on Railway.
- **Watchdog fallback must prove liveness, not just presence.** Name-matching a process is not enough — check freshness.

### 2. Internet flaps on lab PC — ongoing

**What happens**: Lab PC pushes to `https://app.mspil.in/api/opc` over the **factory's regular internet connection** (NOT Tailscale). When factory internet drops or is unstable, the cloud sync thread backs off exponentially. Scanner keeps scanning locally (SQLite has all data), but cloud shows stale data.

**Symptom**: `/health` on local API shows `pendingSyncs > 0` and recent `lastScan`, but cloud ERP page shows "OFFLINE" or stale "Last Sync".

**Note**: Tailscale is ONLY for remote management (SSH/SCP from Mac). The actual data flow goes over regular internet. `tailscale status` relay vs direct is irrelevant for data sync — it only affects your ability to SSH in.

**Permanent rule**: If cloud shows stale but local `/health` shows fresh scans + pending syncs, it's an internet issue at the factory, not a bridge bug. Data will auto-sync when internet recovers (queue retries with backoff).

### 3. Backfill cursor corruption — 2026-04-10

**What happened**: OPC Live page showed "ONLINE (2h ago)" — bridge appeared connected, `pendingSyncs: 0`, push returning 200, but cloud `MAX(scannedAt)` was stuck 2+ hours in the past.

**Root cause**: `cloud_sync.py` `push_readings()` had a single forward cursor (`last_push_batch`) used for BOTH new readings and backfill. After restart recovery pushed the latest 500 readings, the backfill phase would:
1. Fetch old readings (`WHERE scan_batch < _backfill_before ORDER BY scanned_at DESC`)
2. Push them successfully (old `scannedAt` timestamps)
3. **Set `last_push_batch = last_batch`** — pointing to an OLD batch ID
4. Next cycle: `WHERE scan_batch > last_push_batch` fetched mid-range data, not latest
5. Cloud's `MAX(scannedAt)` stayed frozen at the restart-recovery timestamp

The bridge looked healthy: no errors, no queue buildup, heartbeats flowing. But every push was sending stale data while new readings accumulated locally unsent.

**Fix**: Separated forward and backward cursors with an `is_backfill` flag:
```python
is_backfill = False
# ... backfill sets is_backfill = True, moves _backfill_before backward

if self._post("/push", payload):
    if not is_backfill:
        self.last_push_batch = last_batch  # Only advance for NEW data
```
Backfill moves `_backfill_before` backward independently. `last_push_batch` only advances when pushing genuinely new readings. The two cursors never interfere.

**Fix deployed**: SCP'd to lab PC, killed old process (PID file), restarted. New process immediately pushed 500 latest readings with fresh timestamps. Cloud showed live data within 60s.

**Permanent rules**:
- **Separate cursors for forward sync vs backfill.** A single cursor that serves both directions WILL corrupt one or the other eventually.
- **After any sync fix, verify cloud `MAX(scannedAt)` moves forward** — `pendingSyncs: 0` and HTTP 200 don't prove freshness.
- **Bridge "healthy" ≠ cloud data fresh.** Health checks must include a freshness assertion (scan age + last pushed timestamp), not just connectivity.

---

## Part B — Architecture

### System Overview

```
ABB 800xA DCS (172.16.4.11:44683, OPC-UA, SignAndEncrypt)
    ↓ (Basic256Sha256, cert auth, factory LAN)
Lab PC — Windows (C:\Users\abc\Desktop\OPC\, Python 3.x)
    ├── opc_scanner.py   [Thread 1: Scans monitored tags every 120s]
    ├── cloud_sync.py    [Thread 2: Pushes to cloud every ~150s]
    ├── api_server.py    [Thread 3: Local HTTP API on :8099]
    └── run.py           [Main: Watchdog + heartbeat every 60s]
    ↓ (HTTPS over factory internet — NOT Tailscale)
Cloud ERP (app.mspil.in/api/opc)
    ↓
ERP Dashboard + Telegram Alerts

Management access (SSH/SCP from Mac):
    Mac → Tailscale (100.74.209.72) → Lab PC
    (Tailscale is ONLY for remote management, NOT for data flow)
```

### Lab PC (ethanollab)

| Field | Value |
|-------|-------|
| Tailscale IP | 100.74.209.72 |
| LAN IP | (on factory LAN) |
| User / Password | abc / 123 |
| SSH | `sshpass -p '123' ssh abc@100.74.209.72` |
| SCP | `sshpass -p '123' scp file abc@100.74.209.72:"C:\\Users\\abc\\Desktop\\OPC\\"` |
| Service path | `C:\Users\abc\Desktop\OPC\` |
| Source mirror (Mac) | `/Users/saifraza/Desktop/opc/WindowsOPC/` |
| Task Scheduler | "MSPIL OPC Bridge" (auto-start on boot) |
| Watchdog Task | "MSPIL OPC Watchdog" (every 5 min) |
| Local API | `http://100.74.209.72:8099` |
| Logs | `C:\Users\abc\Desktop\OPC\logs\opc_bridge.log` (rotating, 5MB x 3) |
| PID file | `data/opc_bridge.pid` |
| Heartbeat file | `data/heartbeat.json` |

### ABB 800xA DCS

| Field | Value |
|-------|-------|
| IP | 172.16.4.11 |
| Port | 44683 |
| Protocol | OPC-UA |
| Security | Basic256Sha256, SignAndEncrypt |
| Certs | `certs/` directory on lab PC |
| OPC Tree | Root > PLC Generic Control Network > Controllers > OPC Server |
| Areas | Liquefication, Fermantation (sic), Distillation, Evaporation, MSDH, DRYER, DECANTOR |

### Key Files (Windows PC)

| File | Purpose |
|------|---------|
| `config.py` | OPC endpoint, certs, scan interval (120s), cloud URL, API port (8099), backoff settings |
| `opc_scanner.py` | Connects to ABB DCS, scans ONLY monitored tags → SQLite. Tracks `last_scan_completed_at`. |
| `cloud_sync.py` | POSTs readings to `/api/opc/push`, hourly to `/api/opc/push-hourly`. Pulls tag list from cloud. |
| `api_server.py` | HTTP API :8099 — browse/read/monitor/live/history endpoints |
| `run.py` | Entry point. 3 threads + watchdog + heartbeat. Flags: `--api-only`, `--scan-once` |
| `alarm_checker.py` | Checks readings against HH/LL limits, sends Telegram alerts |
| `start_service.bat` | Called by Task Scheduler. Checks if already running, verifies heartbeat freshness. |
| `restart.bat` | One-click restart for plant staff (uses PID file) |
| `stop.bat` | Clean shutdown (uses PID file) |
| `status.bat` | Shows running state, auto-start status, pending syncs, DB size |

### SQLite Tables (data/opc.db)

| Table | Purpose |
|-------|---------|
| `monitored_tags` | User-selected tags (PK: tag). Cloud-as-master — pulled from ERP every sync cycle. |
| `tag_readings` | All scan values (auto-purge 7 days) |
| `tag_latest` | Latest per tag+property (fast lookup for /live endpoint) |
| `sync_queue` | Pending cloud syncs. Retry up to 10 times, then dead-letter. |

### Scan → Sync Flow

1. **Scanner thread** (every 120 sec):
   - Connects to ABB DCS via OPC-UA (cert auth)
   - Reads only **actively monitored tags** from `monitored_tags` table
   - Per tag type: PID → reads PV, SP, OP. Analog → reads IO_VALUE. Totalizer → reads PRV_HR, CURRENT, INPUT.
   - Stores readings in `tag_readings` + updates `tag_latest`
   - Updates `last_scan_completed_at` (liveness proof)

2. **Cloud sync thread** (every 150 sec):
   - **Strategy**: Latest readings first (live data never stale), then backfill old
   - POSTs readings to `POST /api/opc/push` (X-OPC-Key auth)
   - Pulls monitored tag list from cloud (`GET /api/opc/monitor/pull`) — cloud is master
   - Failed pushes queued to SQLite `sync_queue`, retry with exponential backoff
   - Hourly aggregates pushed separately (`POST /api/opc/push-hourly`)

3. **Main watchdog loop** (every 60 sec):
   - Sends heartbeat to cloud (`POST /api/opc/heartbeat`)
   - Includes: thread health, queue depth, CPU/mem, lastScanCompletedAt, lastScanAgeSeconds
   - Restarts dead threads (max 10 restarts/hour per thread)
   - **Force-exits** if `last_scan_completed_at` >10 min stale (OS watchdog respawns)

### 4-Layer Recovery

| Layer | Mechanism | Who | Recovery |
|-------|-----------|-----|----------|
| 1 | Cloud heartbeat age check (3 min) | `opcHealthWatchdog.ts` | Telegram alert, re-alert every 30 min |
| 2 | Scan staleness check (10 min) | `opcHealthWatchdog.ts` | Alert "Scanner Zombified" |
| 3 | Scanner liveness (10 min) | `run.py` watchdog | **Force-exit process** |
| 4 | Windows watchdog (5 min) | `start_service.bat` via Task Scheduler | Respawn bridge |

---

## Part C — Cloud Backend

### Separate Database

| Field | Value |
|-------|-------|
| Prisma schema | `backend/prisma/opc/schema.prisma` |
| Output | `@prisma/opc-client` (NOT the main client) |
| Env var | `DATABASE_URL_OPC` = `${{Postgres-OPC.DATABASE_URL}}` |
| Host | `gondola.proxy.rlwy.net:12413` |
| Build | `npx prisma generate --schema=prisma/opc/schema.prisma` |
| Deploy | Procfile includes `npx prisma db push --skip-generate --schema=prisma/opc/schema.prisma` |

### Prisma Models (OPC DB)

```prisma
OpcMonitoredTag  — tag (unique), area, folder, tagType, label, active, hhAlarm, llAlarm
OpcReading       — tag, property (PV/SP/OP/IO_VALUE/...), value, scannedAt
OpcHourlyReading — tag, property, hour, avg, min, max, count (@@unique tag+property+hour)
OpcSyncLog       — syncType, batchId, tagCount, readingCount, syncedAt
```

### Routes (backend/src/routes/opcBridge.ts)

Registered: `app.use('/api/opc', opcBridgeRoutes)` in `app.ts`

**Push endpoints** (Windows → cloud, X-OPC-Key auth):

| Method | Path | Body |
|--------|------|------|
| POST | /push | `{readings: [{tag, property, value, scannedAt}], tags?: [{tag, area, folder, tagType, label}]}` |
| POST | /push-hourly | `{hourly: [{tag, property, hour, avg, min, max, count}]}` |
| POST | /heartbeat | `{timestamp, uptimeSeconds, opcConnected, queueDepth, health: {scannerAlive, syncAlive}, system: {cpuPercent, memoryMb, diskFreeGb, sleepDisabled}, lastScanCompletedAt, lastScanAgeSeconds}` |

**Read endpoints** (ERP frontend, JWT auth):

| Method | Path | Returns |
|--------|------|---------|
| GET | /health | `{status, online, monitoredTags, lastScan, lastSync}` — online if lastSync < 5 min |
| GET | /bridge-status | `{online, ageSeconds, heartbeat}` — online if heartbeat < 3 min |
| GET | /monitor | `{tags: [...], count}` |
| GET | /monitor/pull | Tag list for factory pull (X-OPC-Key auth) |
| GET | /live | Latest values for all monitored tags |
| GET | /live/:tag | Latest for one tag |
| GET | /history/:tag | `?hours=24&property=PV` — time series |
| GET | /stats | DB counts |
| GET | /gaps | `?hours=24` — data gap analysis |
| GET | /alarms/status | Alarm system enabled/disabled |

### OPC Prisma Client Usage

```typescript
// Lazy-load separate client (not main prisma)
const { PrismaClient } = require('@prisma/opc-client');
const opcPrisma = new PrismaClient();
const tags = await opcPrisma.opcMonitoredTag.findMany({ where: { active: true } });
```

### Cloud Health Watchdog (opcHealthWatchdog.ts)

- Runs every 3 min via `startOpcWatchdog()` (called from server.ts)
- Compares heartbeat age + scan staleness
- State persisted to `Settings.opcWatchdogState` (survives Railway restarts)
- Alert states: OFFLINE, SCANNER_ZOMBIFIED, PC_SLEEP_ENABLED, QUEUE_BACKUP
- Re-alerts every 30 min while in alert state
- Daily gap summary at 6:00 AM IST
- Alerts go to group + group2 + all private chats + `OPC_ALERT_CHAT_ID` fallback

### Alarm System (opcBridge.ts)

- Compares readings against `opcMonitoredTag.hhAlarm` / `llAlarm`
- PID tags → check PV. Analog tags → check IO_VALUE. Totalizer → skip.
- Cooldown: max once per 15 min per tag
- Phase-aware suppression: fermenter temp tags check fermentation phase before alarming
- Alerts to configured Telegram group

---

## Part D — Frontend

### Page: OPCTagManager.tsx
- **Route**: `/process/opc` (lazy loaded in `App.tsx`)
- **Style**: Tier 2 SAP (dark headers, no rounded corners)
- **Tabs**: Live Data | Add Tags | Statistics
- **Auto-refresh**: Live data every 30 seconds
- **KPI strip**: Monitored count, Status (ONLINE/OFFLINE), Last Scan, Last Sync
- **Bridge info bar**: Uptime, CPU, RAM, Disk, Queue depth, OPC connection status

---

## Part E — Deploy & Operations

### Deploy to Lab PC

**No deploy script exists yet** (unlike factory-server). Manual process:

```bash
# 1. Edit files in /Users/saifraza/Desktop/opc/WindowsOPC/
# 2. SCP to PC
sshpass -p '123' scp -o StrictHostKeyChecking=no \
  /Users/saifraza/Desktop/opc/WindowsOPC/{run.py,opc_scanner.py,cloud_sync.py,config.py,api_server.py,alarm_checker.py} \
  abc@100.74.209.72:"C:\\Users\\abc\\Desktop\\OPC\\"

# 3. Restart bridge
sshpass -p '123' ssh abc@100.74.209.72 \
  'cd C:\Users\abc\Desktop\OPC && restart.bat'
```

**TODO**: Build a `deploy.sh` like factory-server that does:
1. Local syntax check (python -m py_compile)
2. Verify SSH reachable
3. SCP files
4. Restart via restart.bat
5. Hit local `/health` endpoint and verify scan age < 5 min
6. Tail logs for errors

### Health Checks

```bash
# Local API health (from Mac via Tailscale)
curl -s http://100.74.209.72:8099/health | python3 -m json.tool

# Check live weight values
curl -s http://100.74.209.72:8099/live | python3 -m json.tool

# Check monitored tags
curl -s http://100.74.209.72:8099/monitor | python3 -m json.tool

# View logs (via SSH)
sshpass -p '123' ssh abc@100.74.209.72 \
  'powershell -Command "Get-Content C:\Users\abc\Desktop\OPC\logs\opc_bridge.log -Tail 50"'

# Check Tailscale connection type
tailscale status | grep ethanollab
# "relay" = less stable. "direct" = good.
```

### SAFETY RULES

- **NEVER rapidly retry SSH** — 5 wrong passwords = 30 min account lockout
- **NEVER kill all python.exe** — use PID file (`data/opc_bridge.pid`) or `restart.bat`
- **NEVER modify ABB DCS settings** — certs in `certs/` are pre-configured
- **NEVER change scan interval below 60s** — can overload DCS
- Bridge runs on lab PC, NOT factory server. Different PC, different credentials.

---

## Part F — Environment Variables

### Lab PC (system env vars)

| Var | Value | Purpose |
|-----|-------|---------|
| (none currently) | | All config in `config.py` |

### Railway (cloud)

| Var | Value | Purpose |
|-----|-------|---------|
| `DATABASE_URL_OPC` | `${{Postgres-OPC.DATABASE_URL}}` | Separate OPC PostgreSQL |
| `OPC_PUSH_KEY` | `mspil-opc-2026` | Auth key for Windows → cloud push |
| `OPC_ALERT_CHAT_ID` | (Telegram chat ID) | Fallback alert destination |

---

## Part G — Robustness Features

### Comparison with Weighbridge/Factory Server

| Feature | OPC Bridge | Factory Server | Weighbridge |
|---------|-----------|---------------|-------------|
| **Queue mechanism** | SQLite `sync_queue`, 10-retry limit | DB `cloudSynced` flag, unlimited retry | SQLite `sync_queue`, 10-retry limit |
| **Backoff** | Exponential: 10s → 20s → ... → 600s max | Exponential: 10s → ... → 5min max | Fixed intervals |
| **Per-item error tracking** | Batch-level only | `cloudError` field per weighment | Dead-letter log |
| **Heartbeat** | Every 60s, includes scan liveness proof | Every 30s via `pcMonitor.ts` | Every 30s |
| **Watchdog** | 4-layer (cloud + scan + local + OS) | 2-layer (cloud + local) | Thread watchdog |
| **Network** | Factory internet (direct HTTPS) | Factory internet (direct HTTPS) | Factory internet + LAN fallback |
| **Auto-restart** | Task Scheduler + watchdog task | Task Scheduler (`FactoryServer`) | Task Scheduler |
| **Log rotation** | 5MB x 3 files | Timestamped per-restart log files | 5MB x 3 files |
| **Deploy script** | None (manual SCP) | `deploy.sh` (full safety checks) | `deploy.sh` |

### How Data is Preserved Without Internet (Weighbridge Pattern)

The weighbridge never loses data because of a 3-layer approach:

1. **Local-first save** — Data written to SQLite `weighments` table IMMEDIATELY on capture. WAL mode (`PRAGMA journal_mode=WAL`) ensures crash safety. This is the permanent record.
2. **Sync queue** — After local save, a snapshot of the weighment is enqueued into `sync_queue` table. The sync loop retries from this queue, not from the weighments table.
3. **Dual-path push** — Tries factory server (LAN, always reachable) first, falls back to cloud (internet). If both fail, item stays in queue. After 10 failed attempts, item is dead-lettered but the weighment itself is NEVER deleted.

**Key insight**: The weighment data is saved BEFORE any network call. Even if the PC loses power mid-sync, the data is safe in SQLite WAL.

### How OPC Bridge Currently Handles It

The OPC bridge follows a similar local-first pattern:

1. **Local-first save** — Scanner writes readings to `tag_readings` table in SQLite immediately after each scan. Data is persisted locally regardless of cloud connectivity.
2. **Cursor-based sync** — `push_readings()` tracks `last_push_batch` and pushes new readings since the last successful push. On restart, it pushes the most recent readings first (live data never stale), then backfills older data.
3. **Failed batch queuing** — If a push fails, the whole batch goes to `sync_queue` for retry.
4. **7-day local retention** — Readings stay in `tag_readings` for 7 days regardless of sync status.

**What works well**: Data is NEVER lost on the lab PC. Even during a 3-hour internet outage, all readings are in `tag_readings`. When internet recovers, `push_readings()` cursor catches up automatically.

**What's weaker than weighbridge**:
1. **No factory LAN path** — OPC only pushes to cloud (internet). Weighbridge tries factory server LAN first. Adding a factory LAN fallback would make OPC sync nearly immune to internet drops.
2. **Retry limit too low** — `SYNC_RETRY_MAX=5` for queued batches vs weighbridge's 10. Dead-lettered batches need manual intervention.
3. **Batch-level tracking** — OPC queues entire batches. Weighbridge queues individual items. If one reading in a batch is bad, the whole batch fails.
4. **No per-item error field** — Factory server's `cloudError` per weighment tells you WHY sync failed. OPC has batch-level logging only.
5. **No status endpoint for sync health** — `/health` doesn't expose consecutive failures, queue depth details, or last error message.

---

## Part H — Troubleshooting

| Symptom | Likely Cause | Diagnosis | Fix |
|---------|-------------|-----------|-----|
| "ONLINE" but no new data | Scanner blocked in OPC TCP read | Check `/health` → `lastScan` age. If >10 min, scanner is stuck. | Should auto-recover (force-exit + respawn). If not: `restart.bat` |
| "OFFLINE" on ERP page | Heartbeat not reaching cloud | `curl http://100.74.209.72:8099/health` — if responds, bridge is alive but cloud push failing. Check `tailscale status`. | Fix Tailscale, or `restart.bat` |
| Data gaps in history | Cloud sync thread backed off | Check `pendingSyncs` in `/health`. If >0, queue is building. | Wait for auto-recovery, or `restart.bat` |
| "OPC connection failed" in logs | DCS unreachable or certs wrong | `ping 172.16.4.11` from lab PC. Check `certs/` directory. | Contact plant instrumentation team |
| No Telegram alerts | Alert state stuck or chat not configured | Check `Settings.opcWatchdogState` in DB. Check Telegram module routing in Settings. | Reset watchdog state, configure chat IDs |
| High CPU on lab PC | OPC browse cache unbounded | Check `cachedValues` in `/health`. Should be < 200. | Restart bridge (LRU cache resets) |
| "FACTORY PC SLEEP ENABLED" alert | Someone enabled Windows sleep | `sleepDisabled: false` in heartbeat | `powercfg /change standby-timeout-ac 0` on lab PC |
| Bridge shows 0 monitored tags | Cloud-as-master sync cleared tags | Check cloud: `GET /api/opc/monitor` → if 0 tags active, re-add via UI | Add tags via OPC Live page "Add Tags" tab |
| SQLite locked | Multiple processes or thread issue | Check for duplicate python processes | Kill all, restart once via `restart.bat` |

---

## Part I — Currently Monitored Tags (29 tags)

| Area | Tags |
|------|------|
| Fermantation | LT130101, LT130102, LT130201, LT130202, LT130301, LT130302 (fermenter levels) |
| Fermantation | TE130101, TE130201, TE130301 (fermenter temps) |
| Fermantation | LT130401 (beer well level), FE130701 (beer well flow) |
| Distillation | FCV_140101, MG_140101 + others |
| Evaporation | Various level/flow tags |
| Dryer/Decanter | Various level/flow tags |

Full list: `curl http://100.74.209.72:8099/monitor`

---

## Part J — Development Phases

1. **OPC Connection** — DONE — cert auth, browse, read
2. **Cloud Integration** — DONE — push API, separate DB, ERP page
3. **Operations** — DONE — bat files, docs, memory
3.5. **Production Robustness** — DONE — log rotation, auto-start, backoff, memory limits, tag sync, 4-layer watchdog
4. **ERP Integration** — NEXT — tag-to-field mapping, dashboard widgets, trend charts
5. **Advanced** — PLANNED — Telegram scheduled reports, PID tuning recommendations

---

## File Map

**Windows Service** (`C:\Users\abc\Desktop\OPC\` / Mac mirror: `/Users/saifraza/Desktop/opc/WindowsOPC/`):

| File | Lines | Purpose |
|------|-------|---------|
| `config.py` | ~100 | All settings: OPC endpoint, intervals, backoff, log rotation |
| `run.py` | ~450 | Main entry: 3 threads, watchdog, heartbeat, PID file, graceful shutdown |
| `opc_scanner.py` | ~420 | OPC connection, tag scanning, LRU cache, backoff, liveness tracking |
| `cloud_sync.py` | ~450 | Push/pull/retry, cloud-as-master tag sync, hourly aggregates |
| `api_server.py` | ~540 | Local HTTP :8099, rate limiting, browse client with reconnect |
| `alarm_checker.py` | ~90 | HH/LL limit checks, Telegram alerts |
| `start_service.bat` | ~70 | Watchdog: checks PID + heartbeat freshness, kills zombie + respawns |
| `restart.bat` | ~50 | Clean restart using PID file |
| `stop.bat` | ~20 | Clean shutdown |
| `status.bat` | ~50 | Shows running state, auto-start, queue depth, DB size |

**Cloud Backend**:

| File | Purpose |
|------|---------|
| `backend/src/routes/opcBridge.ts` (~960 lines) | All OPC API: push, heartbeat, health, monitor, live, history, alarms |
| `backend/src/services/opcHealthWatchdog.ts` | Cloud-side watchdog: heartbeat staleness, scan zombification, re-alerts |
| `backend/prisma/opc/schema.prisma` | OPC-specific Prisma models (separate DB) |

**Frontend**:

| File | Purpose |
|------|---------|
| `frontend/src/pages/process/OPCTagManager.tsx` (~910 lines) | OPC Live page: live data, add tags, statistics |

**Cross-System API Contracts**:

### 1. POST /api/opc/push (Windows → Cloud)
**Auth**: `X-OPC-Key` header
```json
{
  "readings": [{"tag": "LT130401", "property": "IO_VALUE", "value": 55.3, "scannedAt": "ISO-8601"}],
  "tags": [{"tag": "LT130401", "area": "Fermantation", "folder": "ANALOG", "tagType": "analog", "label": "Beer Well Level"}]
}
```
**Response**: `{ "ok": true, "received": 29 }`

### 2. POST /api/opc/heartbeat (Windows → Cloud)
**Auth**: `X-OPC-Key` header
```json
{
  "timestamp": "ISO-8601", "uptimeSeconds": 3600, "opcConnected": true,
  "queueDepth": 0, "dbSizeMb": 12.4,
  "health": {"scannerAlive": true, "syncAlive": true, "apiAlive": true, "threadRestarts": {}},
  "system": {"cpuPercent": 25, "memoryMb": 250, "diskFreeGb": 100, "sleepDisabled": true},
  "version": "1.1.0",
  "lastScanCompletedAt": "ISO-8601", "lastScanAgeSeconds": 120
}
```

### 3. GET /api/opc/monitor/pull (Cloud → Windows)
**Auth**: `X-OPC-Key` header
**Response**: `{ "tags": [{"tag": "LT130401", "area": "...", "active": true, "label": "..."}] }`
