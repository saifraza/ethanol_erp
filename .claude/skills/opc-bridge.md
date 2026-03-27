# OPC Bridge Module — ABB 800xA to ERP

## Overview
Real-time plant data bridge: ABB 800xA DCS (OPC UA) -> Windows PC at factory -> Cloud ERP.
Users select which tags to monitor from the ERP UI. Scanner reads only those tags.

## Architecture
```
ABB 800xA (172.16.4.11:44683, OPC UA, SignAndEncrypt)
  -> Windows PC (C:\Users\abc\Desktop\OPC\, Python, SQLite)
    -> Cloud ERP (app.mspil.in/api/opc/push, Postgres-OPC DB)
      -> ERP Frontend (/process/opc)
```

## Windows Service (Factory PC)
- **Location**: `C:\Users\abc\Desktop\OPC\`
- **Source mirror**: `/Users/saifraza/Desktop/opc/WindowsOPC/`
- **SSH**: `sshpass -p '123' ssh abc@100.74.209.72`
- **Deploy**: `sshpass -p '123' scp file abc@100.74.209.72:"C:\\Users\\abc\\Desktop\\OPC\\"`

### Key Files
| File | Purpose |
|------|---------|
| `config.py` | OPC endpoint, certs, scan interval (120s), cloud URL, API port (8099) |
| `opc_scanner.py` | Scans ONLY monitored tags -> SQLite. `init_db()` creates tables. |
| `api_server.py` | HTTP API :8099 — browse/read/monitor/live/history. `start_api()` entry. |
| `cloud_sync.py` | POSTs readings to `/api/opc/push`, hourly to `/api/opc/push-hourly` |
| `run.py` | Entry point. Threads: scanner + sync + API. Flags: `--api-only`, `--scan-once` |
| `restart.bat` | One-click restart for plant staff |

### OPC Tree Path
`Root > PLC Generic Control Network > Controllers > OPC Server`
Areas: Liquefication, Fermantation (sic), Distillation, Evaporation, MSDH, DRYER, DECANTOR

### Adding Tags to Monitor
```python
# In add_tags.py or via API:
POST http://localhost:8099/monitor
{"tag":"LT130401", "area":"Fermantation", "folder":"ANALOG", "tagType":"analog", "label":"Beer Well Level"}
```

### SQLite Tables (data/opc.db)
- `monitored_tags` — user-selected tags (PK: tag)
- `tag_readings` — all scan values (auto-purge 7 days)
- `tag_latest` — latest per tag+property (fast lookup)
- `sync_queue` — pending cloud syncs (retry on failure)

## ERP Backend

### Separate Database
- **Prisma schema**: `backend/prisma/opc/schema.prisma`
- **Output**: `@prisma/opc-client` (NOT the main client)
- **Env var**: `DATABASE_URL_OPC` = `${{Postgres-OPC.DATABASE_URL}}`
- **Build**: `npx prisma generate --schema=prisma/opc/schema.prisma`
- **Deploy**: Procfile includes `npx prisma db push --skip-generate --schema=prisma/opc/schema.prisma`

### Prisma Models
```prisma
OpcMonitoredTag  — tag (unique), area, folder, tagType, label, active
OpcReading       — tag, property (PV/SP/OP/IO_VALUE), value, scannedAt
OpcHourlyReading — tag, property, hour, avg, min, max, count (@@unique tag+property+hour)
OpcSyncLog       — syncType, batchId, tagCount, readingCount, syncedAt
```

### Routes (backend/src/routes/opcBridge.ts)
Registered: `app.use('/api/opc', opcBridgeRoutes)` in app.ts

**Push endpoints** (Windows -> cloud, X-OPC-Key auth):
| Method | Path | Body |
|--------|------|------|
| POST | /push | `{readings: [{tag, property, value, scannedAt}], tags?: [{tag, area, folder, tagType, label}]}` |
| POST | /push-hourly | `{hourly: [{tag, property, hour, avg, min, max, count}]}` |

**Read endpoints** (ERP frontend, JWT auth):
| Method | Path | Returns |
|--------|------|---------|
| GET | /health | `{status, online, monitoredTags, lastScan, lastSync}` |
| GET | /monitor | `{tags: [...], count}` |
| GET | /live | Latest values for all monitored tags |
| GET | /live/:tag | Latest for one tag |
| GET | /history/:tag?hours=24&property=PV | Hourly history |
| GET | /stats | DB counts |

### OPC Prisma Client Usage Pattern
```typescript
// Lazy-load separate client (not main prisma)
const { PrismaClient } = require('@prisma/opc-client');
const opcPrisma = new PrismaClient();

// Query OPC data
const tags = await opcPrisma.opcMonitoredTag.findMany({ where: { active: true } });
const readings = await opcPrisma.opcReading.findMany({ where: { tag: 'LT130401' } });
```

## ERP Frontend

### Page: OPCTagManager.tsx
- **Route**: `/process/opc` (lazy loaded in App.tsx)
- **Import**: `const OPCTagManager = React.lazy(() => import('./pages/process/OPCTagManager'))`
- **Style**: Tier 2 SAP (dark headers, no rounded corners)
- **Tabs**: Live Data | Monitored Tags | Statistics
- **API calls**: `GET /api/opc/live`, `GET /api/opc/monitor`, `GET /api/opc/stats`

## Environment Variables (Railway)
| Var | Value | Purpose |
|-----|-------|---------|
| `DATABASE_URL_OPC` | `${{Postgres-OPC.DATABASE_URL}}` | Separate OPC PostgreSQL |
| `OPC_PUSH_KEY` | `mspil-opc-2026` | Auth key for Windows push |

## Currently Monitored Tags
| Tag | Area | Label |
|-----|------|-------|
| LT130401 | Fermantation | Beer Well Level |
| LT130101 | Fermantation | Fermenter 1A Level |
| LT130102 | Fermantation | Fermenter 1B Level |
| LT130201 | Fermantation | Fermenter 2A Level |
| LT130202 | Fermantation | Fermenter 2B Level |
| LT130301 | Fermantation | Fermenter 3A Level |
| LT130302 | Fermantation | Fermenter 3B Level |
| TE130101 | Fermantation | Fermenter 1A Temp |
| TE130201 | Fermantation | Fermenter 2A Temp |
| TE130301 | Fermantation | Fermenter 3A Temp |
| FE130701 | Fermantation | Beer Well Flow |

## Mapping OPC Tags to ERP Fields (Phase 4)
Future: allow ERP modules to bind to OPC tags for auto-population.
Example: Fermentation page beer well reading auto-fills from LT130401.
Implementation: add `opcTag` field to relevant models, frontend fetches /api/opc/live/:tag.

## Troubleshooting
| Issue | Fix |
|-------|-----|
| No data on ERP | Check Windows service: `status.bat`. Check logs. |
| INTERNAL_ERROR on /api/opc/* | Run `prisma db push --schema=prisma/opc/schema.prisma` manually |
| Windows service won't start | Run `restart.bat`. Check `logs\opc_bridge.log`. |
| OPC connection failed | Ping 172.16.4.11. Check certs in `certs/`. |
| SQLite thread error | Ensure `check_same_thread=False` in sqlite3.connect() |
| Push failing | Check internet on Windows. Data queues locally, retries auto. |

## Development Phases
1. **OPC Connection** - DONE - cert auth, browse, read
2. **Cloud Integration** - DONE - push API, separate DB, ERP page
3. **Operations** - DONE - bat files, docs, memory
4. **ERP Integration** - NEXT - browse from ERP, tag-to-field mapping, dashboard widgets
5. **Advanced** - PLANNED - WhatsApp alerts, PID tuning, Windows Service auto-start
