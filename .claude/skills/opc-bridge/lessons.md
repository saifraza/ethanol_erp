# OPC Bridge — incidents & permanent rules

> Every rule here is written from a real outage. Do not skip. Read before changing any sync, watchdog, or heartbeat logic.

## 1. 24-hour zombie outage — 2026-04-08

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

## 2. Internet flaps on lab PC — ongoing

**What happens**: Lab PC pushes to `https://app.mspil.in/api/opc` over the **factory's regular internet connection** (NOT Tailscale). When factory internet drops or is unstable, the cloud sync thread backs off exponentially. Scanner keeps scanning locally (SQLite has all data), but cloud shows stale data.

**Symptom**: `/health` on local API shows `pendingSyncs > 0` and recent `lastScan`, but cloud ERP page shows "OFFLINE" or stale "Last Sync".

**Note**: Tailscale is ONLY for remote management (SSH/SCP from Mac). The actual data flow goes over regular internet. `tailscale status` relay vs direct is irrelevant for data sync — it only affects your ability to SSH in.

**Permanent rule**: If cloud shows stale but local `/health` shows fresh scans + pending syncs, it's an internet issue at the factory, not a bridge bug. Data will auto-sync when internet recovers (queue retries with backoff).

## 3. Backfill cursor corruption — 2026-04-10

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
