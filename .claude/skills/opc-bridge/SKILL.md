---
name: opc-bridge
description: READ FIRST before any OPC/DCS bridge work on the MSPIL ethanol ERP. Covers the lab-PC Python bridge that scans the ABB 800xA DCS over OPC-UA and syncs process tags to the cloud ERP. Use when the user mentions opc, dcs, process-tag, honeywell, distillation tag, fermenter level/temp, "OPC Live" page, tag scanning, the lab PC bridge, or OPC heartbeat/zombie/offline alerts.
when_to_use: Any task touching OPC-UA tag scanning, the lab-PC bridge (opc_scanner.py / cloud_sync.py / run.py / api_server.py), the cloud OPC routes/watchdog (opcBridge.ts / opcHealthWatchdog.ts), the separate OPC Postgres DB, the OPCTagManager frontend, or diagnosing OPC ONLINE/OFFLINE/stale-data alerts. Example requests: "OPC shows offline", "scanner zombified", "add a distillation tag", "OPC data is stale on the dashboard".
---

# OPC Bridge — overview

The OPC bridge is a Python service on the **lab PC** (ethanollab, Tailscale `100.74.209.72`) that scans process tags from the **ABB 800xA DCS** (`172.16.4.11:44683`, OPC-UA) and syncs them to the cloud ERP (`app.mspil.in/api/opc`). It surfaces in the ERP as the **OPC Live** page at `/process/opc`.

**READ THIS BEFORE ANY OPC WORK.** Then go to the right file:

- **[lessons.md](lessons.md)** — the three real outages and the permanent rules they produced. Read before changing any sync/watchdog/heartbeat logic.
- **[reference.md](reference.md)** — full architecture, lab-PC + DCS connection details, key files, cloud backend (routes, OPC DB, watchdog, alarms), frontend, deploy/ops, env vars, robustness comparison, troubleshooting table, monitored tags, API contracts.

## Hard rules (NEVER / ALWAYS)

- **NEVER rapidly retry SSH to the lab PC** — 5 wrong passwords = 30 min account lockout.
- **NEVER `kill` all `python.exe`** — use the PID file (`data/opc_bridge.pid`) or `restart.bat`.
- **NEVER modify ABB DCS settings or the `certs/` directory** — they are pre-configured by plant instrumentation.
- **NEVER set the scan interval below 60s** — can overload the DCS (default 120s).
- The bridge runs on the **lab PC, NOT the factory server** — different PC, different credentials.
- **Heartbeat alone is not liveness** — always require a business progress marker (`last_scan_completed_at`). See lessons.
- **Bridge "healthy" ≠ cloud data fresh** — after any sync change, verify cloud `MAX(scannedAt)` actually moves forward.
- Lab PC credentials and SSH/SCP creds: see reference.md (and the out-of-git fleet doc `~/Desktop/infra/fleet.md`). Do not restate secrets in skill files.

## Data flow (one line)

ABB 800xA DCS → lab-PC Python (scan → SQLite → push) → cloud ERP over **factory internet (NOT Tailscale)** → ERP dashboard + Telegram alerts. Tailscale is for SSH/SCP management only.

## 4-layer watchdog (the safety net)

| Layer | Mechanism | Who | Recovery |
|-------|-----------|-----|----------|
| 1 | Cloud heartbeat age check (3 min) | `opcHealthWatchdog.ts` | Telegram alert, re-alert every 30 min |
| 2 | Scan staleness check (10 min) | `opcHealthWatchdog.ts` | Alert "Scanner Zombified" |
| 3 | Scanner liveness (10 min) | `run.py` watchdog | **Force-exit process** (`os._exit(2)`) |
| 4 | Windows watchdog (5 min) | `start_service.bat` via Task Scheduler | Respawn bridge |

This 4-layer design exists because all three software layers failed simultaneously in the 2026-04-08 zombie outage — see [lessons.md](lessons.md).
