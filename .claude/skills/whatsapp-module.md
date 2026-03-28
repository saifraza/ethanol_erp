# WhatsApp Module — Full Architecture & Operations Guide

## Overview
WhatsApp is a **core feature** of the MSPIL Distillery ERP. Plant operators submit readings via WhatsApp instead of logging into the web UI. The system has two main capabilities:
1. **Auto-collect bots** — scheduled messages that ask operators for data, parse replies, save to DB
2. **Report sharing** — one-click sharing of formatted reports to WhatsApp groups from the web UI

## Two-Service Architecture

### Why Two Services?
WhatsApp Baileys connection is fragile — it crashes, reconnects, and can take down the whole ERP if run in-process. Separating it means:
- ERP stays up even if WhatsApp connection drops
- WhatsApp can be redeployed independently without ERP downtime
- Auto-collect sessions run on the same process that receives replies

### Service 1: Main ERP (`ethanol_erp` repo)
- **Does NOT run WhatsApp** when `WA_WORKER_URL` is set
- Proxies all WhatsApp calls to the worker via `whatsappClient.ts`
- Hosts the frontend UI (schedule config, test buttons, session display)
- Stores schedules in `AutoCollectSchedule` DB table

### Service 2: WhatsApp Worker (`mspil-whatsapp` repo)
- **GitHub**: https://github.com/saifraza/mspil-whatsapp.git
- **Railway URL**: https://mspil-whatsapp-production.up.railway.app/
- **Internal URL**: http://mspil-whatsapp.railway.internal:5001
- Runs Baileys WhatsApp connection (QR auth, message send/receive)
- Runs auto-collect scheduler (sends prompts on schedule)
- Handles incoming message replies (matches to active sessions)
- Has its own Prisma schema (subset of main ERP schema + same DB)

### Shared Database
Both services connect to the **same PostgreSQL** on Railway via `DATABASE_URL`.
- `AutoCollectSchedule` table — read/written by both services
- `WhatsAppMessage` table — incoming/outgoing message log
- `Settings` table — WhatsApp group JIDs, module routing config
- All process data tables (DDGSStockEntry, DecanterEntry, etc.)

## Key Files

### Main ERP (`ethanol_erp`)
| File | Purpose |
|------|---------|
| `backend/src/services/whatsappClient.ts` | Proxy layer — routes calls to worker or local Baileys |
| `backend/src/services/whatsappAutoCollect.ts` | Auto-collect engine (also exists in worker repo) |
| `backend/src/routes/whatsappAutoCollect.ts` | API routes — proxies trigger/sessions to worker |
| `backend/src/routes/whatsapp.ts` | UI routes (status, QR, send-report) |
| `backend/src/whatsapp-server.ts` | Worker entry point (NOT used when worker is separate) |
| `frontend/src/pages/process/DDGSStock.tsx` | DDGS auto-collect UI (schedule config, test button) |
| `frontend/src/pages/process/Decanter.tsx` | Decanter auto-collect UI |

### WhatsApp Worker (`mspil-whatsapp`)
| File | Purpose |
|------|---------|
| `src/whatsapp-server.ts` | Express server — send, trigger, sessions endpoints |
| `src/services/whatsappBaileys.ts` | Baileys connection — connect, send, receive, LID mapping |
| `src/services/whatsappAutoCollect.ts` | Auto-collect engine + scheduler |
| `src/services/whatsappClient.ts` | Direct Baileys wrapper (no proxy needed on worker) |
| `src/services/autoCollectModules/` | Module bots (ddgsProduction.ts, decanter.ts, _template.ts) |

## Auto-Collect Flow

### Scheduled Collection (normal operation)
1. Worker's scheduler runs every 60s (`runScheduler()`)
2. Checks each enabled schedule: is it time for this slot? Already sent?
3. Calls `startCollection(phone, module)` — creates session in worker memory
4. Sends prompt to operator via WhatsApp (e.g., "DDGS bags packed?")
5. Operator replies with a number
6. Worker's `handleIncoming()` matches reply to active session
7. Parses reply, saves to DB, sends confirmation
8. If `autoShare` enabled, sends report to WhatsApp group

### Manual "Test Now" (from web UI)
1. Frontend calls `POST /api/auto-collect/trigger` on main ERP
2. Main ERP proxies to `POST /wa/auto-collect/trigger` on worker
3. Worker creates session and sends prompt
4. Reply handling same as above

### Critical: Sessions Must Live on Worker
- `activeSessions` is an in-memory Map on the worker process
- Incoming WhatsApp messages arrive at the worker's Baileys handler
- If sessions are created on the main ERP, replies won't match
- The trigger endpoint MUST proxy to the worker

## Schedule Storage

### `AutoCollectSchedule` Prisma Model
```prisma
model AutoCollectSchedule {
  id              String   @id @default(uuid())
  module          String   @unique  // 'ddgs', 'decanter', etc.
  phone           String   @default("")
  intervalMinutes Int      @default(60)
  enabled         Boolean  @default(false)
  autoShare       Boolean  @default(true)
  language        String   @default("hi")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Save Flow (per-module, no race conditions)
- Frontend: `PUT /api/auto-collect/schedules/ddgs` with `{ phone, intervalMinutes, enabled, ... }`
- Backend: `prisma.autoCollectSchedule.upsert({ where: { module: 'ddgs' }, ... })`
- Then reloads schedules into memory

### Load Flow (startup)
1. Try `AutoCollectSchedule` table first
2. If empty, fall back to legacy `Settings.autoCollectConfig` JSON blob
3. Auto-migrate legacy data into the new table

## WhatsApp Connection (Baileys)

### Auth
- QR code scanned once from Settings page
- Auth state stored in `WhatsAppAuth` DB table (persists across restarts)
- Multi-device: replies may come from LID JIDs, mapped via `lidToPhone` Map

### LID Resolution
- When sending, Baileys returns a LID for the recipient
- Map stored: `lidToPhone.set(lid, phoneDigits)`
- When receiving, LID is resolved back to phone number
- If LID is unknown, auto-collect tries to match against active sessions

### Connection Issues
- "stream errored out" → auto-reconnect (normal Baileys behavior)
- Pre-key warnings → WhatsApp rate limiting (usually stabilizes)
- If stuck in connect loop, may need to clear auth and re-scan QR

## Environment Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `WA_WORKER_URL` | Main ERP | Worker internal URL (enables proxy mode) |
| `WA_WORKER_API_KEY` | Both | Shared secret for ERP↔worker auth (default: `mspil-wa-internal`) |
| `DATABASE_URL` | Both | Same PostgreSQL connection string |

## Common Issues & Fixes

### Bot sends message but doesn't process reply
- **Cause**: Session created on main ERP, reply arrives at worker
- **Fix**: Ensure trigger proxies to worker (`WA_WORKER_URL` must be set)

### Operator number disappears after deploy
- **Cause**: Schedule stored in wrong place (JSON blob vs table) or table empty after migration
- **Fix**: Use `AutoCollectSchedule` table, ensure `loadSchedules` has legacy fallback

### Bot doesn't send on schedule
- **Cause**: Worker not running, or schedules not loaded, or WhatsApp disconnected
- **Fix**: Check worker health, reload schedules, verify WhatsApp status

### Changes not taking effect
- **Cause**: Code only pushed to one repo
- **Fix**: Push to BOTH `ethanol_erp` AND `mspil-whatsapp` repos

## Adding a New Auto-Collect Module

1. Copy `_template.ts` → `yourModule.ts` in `autoCollectModules/`
2. Define `STEPS` array with field groups
3. Implement: `buildPrompt`, `parseReply`, `buildConfirmation`, `buildSummary`, `buildErrorHint`, `saveData`
4. Register in `autoCollectModules/index.ts`
5. Add schedule via Settings UI or seed data
6. Set `privateOnly: false` if reports should go to WhatsApp group
7. **Push to BOTH repos** and redeploy both services
