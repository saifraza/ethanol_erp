# Sugar OPC Bridge — Fuji DCS

Local Python bridge that runs on the **xOS3000-6 PC** (`100.115.247.107`) at the sugar plant. Reads tags from Fuji DCS via OPC-UA, stores in local SQLite, syncs to cloud, and fires Telegram alarms locally.

## Deploy location
`C:\mspil\sugar-opc\` on Windows (Tailscale: `100.115.247.107`, LAN: `192.168.0.85`).

## Architecture

```
Fuji DCS ──opc.tcp:4841──> OPCScanner ──> SQLite ──> CloudSync ──> Railway DB
                              │              │
                              ▼              ▼
                        AlarmChecker     FuelStarvation
                              │              │
                              └──> telegram_local ──> api.telegram.org
                                       │
                                       └──> boiler group (-4992192716)
```

Cloud sets the HH/LL limits via the ERP UI; bridge pulls them every ~3 min via `/api/opc/monitor/pull`. **Telegram dispatch happens on the bridge** — cloud is not on the alarm path. So alarms still fire if cloud / Railway is down.

## Files

| File | Purpose |
|---|---|
| `run.py` | Entry point — starts scanner / sync / API threads + watchdog |
| `opc_scanner.py` | Async OPC-UA reader + local SQLite writer |
| `cloud_sync.py` | Pushes readings + hourly aggregates + tag list to cloud |
| `api_server.py` | Local HTTP API on `:8099` (live values for Flask UI) |
| `alarm_checker.py` | HH/LL detector + direct Telegram + cloud audit notify |
| `fuel_starvation.py` | "CHECK SILO" composite alarm (steam flow + furnace + pressure + feeders) |
| `telegram_local.py` | Direct sender to `api.telegram.org` (uses permissive SSL for factory cert chain) |
| `config.py` | Connection + retention + scan-interval config |

## Env vars (set via `setx /M`)

```
TELEGRAM_BOT_TOKEN     = <bot token from @BotFather>
TELEGRAM_BOILER_CHAT_ID = -4992192716   (default fallback in code)
OPC_CLOUD_KEY           = <push key for cloud /api/opc/push>
```

## Active alarms

| # | Alarm | Trigger | File |
|---|---|---|---|
| 1 | **CHECK SILO** | feeders ≥ 3 + steam flow ≥ 20 TPH + furnace < 550°C + pressure < 55 kg/cm² | `fuel_starvation.py` |
| 2 | Furnace HIGH | ≥ 850°C | `alarm_checker.py` (HH on `R1C2I2`) |
| 3 | Pressure LOW | ≤ 50 kg/cm² | LL on `R1C1I4` |
| 4 | Pressure HIGH | ≥ 70 kg/cm² | HH on `R1C1I4` |
| 5 | Drum Level out of band | < 20% or > 80% | LL/HH on `R1C1I1` |
| 6 | Turbine/SH Steam Temp LOW | ≤ 320°C | LL on `R1C2I1` |

## Restart procedure

```bat
taskkill /F /IM python.exe
schtasks /run /tn SugarOPC
```

## Local data retention
- `tag_readings` — 7 days raw scans (`LOCAL_RETENTION_DAYS` in `config.py`)
- `sync_queue` — 48 hours of unsent batches (auto-purged)

## Cloud paths still active
- `POST /api/opc/push` — readings + tag list (cloud DB stores 24h raw + permanent hourly)
- `POST /api/opc/push-hourly` — hourly aggregates
- `POST /api/opc/heartbeat` — bridge liveness
- `POST /api/opc/alarm-notify` — audit log only (Telegram is fired locally first)
- `GET  /api/opc/monitor/pull` — bridge pulls tag list + HH/LL limits set in ERP

## Schema gotchas
- Fuji DCS exposes NO English descriptions — match tags by **value range**
- ST101 browse name is `"ST101 (Controller-1)"` — use `startswith("ST101")`
- Module tags are `#/RxCxIx_M.PV`; user tags are `#/RxCxXn_D.VAL`
- Bridge SQLite table is `tag_readings` (not `readings`)
