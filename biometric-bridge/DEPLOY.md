# Deploying biometric — factory-led architecture

End-to-end runbook. Target: every eSSL fingerprint device on the plant LAN
talks to the factory-server PC (not directly to the cloud). The factory-server
stores every punch in its own Postgres immediately, then batches them to the
cloud every minute. **Multi-hour internet outages never lose a punch.**

## How the pieces fit

```
 ┌──────────┐                    ┌──────────────┐  bulk push                ┌─────────┐
 │ eSSL     │ pyzk over LAN      │ biometric-   │ /punches/push (X-WB-Key)  │  Cloud  │
 │ device 1 │ ─────────────────▶ │ bridge       │ ─────────────────────────▶│ ERP on  │
 │ device 2 │                    │ (Python)     │                           │ Railway │
 │ device N │                    │ :5005 local  │                           │         │
 └──────────┘                    └──────┬───────┘                           └────▲────┘
                                        │                                        │
                                        │ HTTP                                   │ pull
                                        ▼                                        │ master
                                  ┌─────────────┐  60s scheduler          ┌──────┴────┐
                                  │  Factory    │─ pull punches → write ─▶│  Local    │
                                  │  Server     │  to local Postgres      │  Postgres │
                                  │  Express    │                         │  on the   │
                                  │  :5000      │◀── pull employees ─────│  factory  │
                                  └─────────────┘    via /master-data    └───────────┘
```

Each part:

- **eSSL devices** (192.168.0.x) — autonomous fingerprint readers. Storage of last
  resort, but we don't depend on it because we drain them every 60s.
- **biometric-bridge** (`biometric-bridge/bridge.py`, port 5005, same factory PC) —
  thin Python wrapper around `pyzk`. Stateless. Talks to devices over the LAN,
  exposes a JSON HTTP API.
- **factory-server** (`factory-server/`, port 5000, same factory PC) — owns the
  scheduler that pulls punches into its **local Postgres** (`AttendancePunch`
  table). Pushes batches to the cloud via `/api/biometric-factory/punches/push`.
  Pulls cached employees + labor + device list from cloud via `/master-data`.
- **Cloud ERP** (`backend/`, Railway) — source of truth for HR data. Receives
  punch batches; never reaches into the plant LAN. The cloud-side
  `biometricScheduler.ts` is now a fallback — it skips devices where
  `BiometricDevice.factoryManaged = true` AND the factory has reported within
  the last 30 min.

## Prerequisites on the factory PC

- Windows 10/11 or Server (existing factory-server box).
- **Python 3.10+** on PATH. Verify: `python --version`.
- **Postgres** on the box (already there for the existing factory-server) —
  the new biometric tables get created via `prisma db push` during the
  factory-server deploy.
- **Tailscale** running (already there — `100.126.101.7`). Used by Railway as
  a fallback path if it ever needs to call the bridge directly.
- Every eSSL device on the same subnet as the factory PC (typical
  `192.168.0.x/24`). Confirm with `Test-NetConnection -ComputerName <ip> -Port 4370`.

## Step 1 — copy biometric-bridge folder to the factory PC

```bash
sshpass -p Mspil@1212 scp -o StrictHostKeyChecking=no -r \
  biometric-bridge/ \
  Administrator@100.126.101.7:C:/mspil/
```

End state: `C:\mspil\biometric-bridge\` contains `bridge.py`, `requirements.txt`,
`scripts\`, `.env.example`.

## Step 2 — install bridge (one time, as Administrator)

```powershell
cd C:\mspil\biometric-bridge
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

What happens:
- venv created with pyzk + fastapi + uvicorn
- random `BIOMETRIC_BRIDGE_KEY` written to `.env` (and printed — copy it)
- Windows firewall rule for inbound TCP 5005 added (used by Tailscale fallback)

## Step 3 — register bridge as a scheduled task

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
```

Creates two tasks:
- `BiometricBridge` — runs the bridge at boot (`start-bridge.ps1`).
- `BiometricBridgeWatchdog` — every 5 min, kicks the bridge if port 5005 is
  dead. Mirrors `factory-server\scripts\watchdog.ps1` — born from the
  2026-04-29 Oracle-killed-node.exe incident.

## Step 4 — deploy the new factory-server build

The biometric scheduler lives inside the factory-server Express app. Deploy the
fresh build the standard way:

```bash
./factory-server/scripts/deploy.sh
```

The script:
- preflight-compiles locally,
- SCPs `dist/` + `prisma/`,
- kills `node.exe`,
- runs `prisma generate` (creates `CachedBiometricDevice`, `CachedEmployee`,
  `CachedLaborWorker`, `AttendancePunch`),
- relaunches the `FactoryServer` schtask,
- probes `/api/health`.

After this completes, `/api/health` returns `biometric: { started: true, ... }`
once the 30s warmup elapses.

## Step 5 — set env vars on the factory-server box

```powershell
# C:\mspil\factory-server\.env  (or however you set Windows env vars)
BIOMETRIC_BRIDGE_URL=http://127.0.0.1:5005
BIOMETRIC_BRIDGE_KEY=<the value printed by install-windows.ps1>
```

These two are NEW since 2026-05-07. Without `BIOMETRIC_BRIDGE_KEY`, the
factory-server's biometric scheduler self-disables and prints a one-line
notice in the log — safe default.

Restart the factory schtask after editing env vars:
```powershell
taskkill /F /IM node.exe
schtasks /run /tn FactoryServer
```

## Step 6 — register the devices (cloud admin UI)

1. <https://app.mspil.in> → HR → Biometric Devices → Add Device.
2. Fill IP / port (4370) / password (0 default) / location.
3. **Tick `Factory Managed = true`** (new toggle, controlled by `factoryManaged`
   column). This tells the cloud scheduler to hand the device off to the factory.
4. Set `Auto Pull (min) = 5` and `Auto Push (min) = 5`.
5. Save.

Within 30s, the factory-server's `pullBiometricMasterData` cycle picks up the
new device, the scheduler tick fires, and punches start streaming.

## Step 7 — verify

On the factory PC PowerShell:
```powershell
# Bridge alive?
curl.exe http://127.0.0.1:5005/health

# Factory-server picked it up?
curl.exe http://127.0.0.1:5000/api/health | ConvertFrom-Json | Select biometric

# Local punch count growing?
sqlcmd -S localhost -d factory -Q 'SELECT COUNT(*) FROM "AttendancePunch"'

# Pending push to cloud (should approach 0 every minute)?
sqlcmd -S localhost -d factory -Q 'SELECT COUNT(*) FROM "AttendancePunch" WHERE "cloudSynced" = false'
```

From any browser on `app.mspil.in`:
- HR → Biometric Devices: device row's "Last Sync" should tick within 60s.
- HR → Attendance: punches show up exactly as before.

## Failure modes & recovery

| Symptom | Cause | Fix |
|---|---|---|
| `[biometric] BIOMETRIC_BRIDGE_KEY not set — scheduler disabled` | env var missing | set `BIOMETRIC_BRIDGE_KEY` and restart factory schtask |
| `bridge timeout` in factory log | bridge not running | `schtasks /run /tn BiometricBridge` (or wait 5 min for the watchdog) |
| `cloud 401: Invalid factory push key` | `WB_PUSH_KEY` mismatch between factory and Railway | verify both env vars hold the same string |
| Cloud says "Cloud data stale" but punches keep arriving in local DB | internet outage | nothing to do — `cloudSynced=false` rows replay automatically when net returns. Watch `SELECT COUNT(*) FROM "AttendancePunch" WHERE cloudSynced=false` shrink. |
| New employee added in cloud but device doesn't have them | master-data cache lag (max 30s) | wait, or `curl http://127.0.0.1:5000/api/health` to confirm the cycle is running. |
| Want to roll back to cloud-led mode | (e.g. factory-server box went down) | flip `factoryManaged = false` on every device row in the cloud HR UI. Cloud's biometric scheduler resumes pulling. |

## What changes vs the older Mac+cloudflared setup

The Mac-as-bridge setup ran the bridge on a developer laptop with cloudflared.
That worked for testing, but:
- Mac sleeping killed the bridge.
- Cloudflared URLs were throwaway.
- Punches captured during outages were limited by device flash storage.

The new architecture moves all of that onto the factory PC and adds local
durability via Postgres. Cloud-led mode (the cloud's `biometricScheduler.ts`)
is still in the codebase as a fallback — if you flip `factoryManaged=false`,
the cloud takes over and the system keeps working from a single Mac during
testing.
