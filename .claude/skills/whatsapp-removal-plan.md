# WhatsApp Removal Plan — DO NEXT WEEK

**Created:** 2026-04-18 (day of DB damage incident)
**Deferred to:** Week of 2026-04-21

## Why this exists
Every WhatsApp code change damaged prod DB. Today (2026-04-18) it wiped companyId, weights on 161 DispatchTrucks, + stale GRN weights. Root cause: Railway Custom Start Command was running `prisma db push --accept-data-loss` on every deploy. With each WhatsApp schema churn, `--accept-data-loss` dropped unrelated drifted columns as collateral damage.

Custom Start Command is now cleared. But WhatsApp code + schema still in main ERP. Any future WhatsApp work through the current codebase will require Prisma schema change → risk.

## Root cause mechanism
```
schema.prisma = shopping list
prod DB       = fridge
prisma db push --accept-data-loss = "throw out anything in the fridge not on the list"

Each whatsapp tweak changes the list → prisma drops columns → if ANY drift exists anywhere
in the schema (not just whatsapp), those columns get silently dropped too.
```

## 3-Phase Plan

### Phase 1 — Remove WhatsApp code from main ERP (10 min, safe)
Delete / gut:
- `backend/src/routes/whatsapp.ts` — entire file
- `backend/src/services/whatsappClient.ts` — entire file
- `backend/src/app.ts` — remove `/api/whatsapp` registration + import
- `backend/src/services/messagingGateway.ts` — strip WhatsApp paths, keep Telegram only
- `backend/src/routes/opcBridge.ts` — remove WhatsApp calls
- `backend/src/routes/telegram.ts` — remove WhatsApp calls
- `backend/src/routes/ddgsProduction.ts` — remove WhatsApp calls
- `backend/src/services/telegramBot.ts`, `telegramClient.ts`, `telegramAutoCollect.ts`, `lightragClient.ts` — remove any WA refs
- `backend/src/services/autoCollectModules/_template.ts`, `types.ts` — remove WA in types
- `frontend/src/pages/SettingsPage.tsx` — remove WhatsApp UI block

Leave the 9 Settings columns in DB alone for now (just unused).

### Phase 2 — Drop the 9 Settings columns (next step, with backup)
Manual SQL (NOT `prisma db push`). Backup first.
```sql
ALTER TABLE "Settings" DROP COLUMN "whatsappEnabled";
ALTER TABLE "Settings" DROP COLUMN "whatsappWorkerUrl";
ALTER TABLE "Settings" DROP COLUMN "whatsappWorkerApiKey";
ALTER TABLE "Settings" DROP COLUMN "whatsappGroupJid";
ALTER TABLE "Settings" DROP COLUMN "whatsappGroupName";
ALTER TABLE "Settings" DROP COLUMN "whatsappGroup2Jid";
ALTER TABLE "Settings" DROP COLUMN "whatsappGroup2Name";
ALTER TABLE "Settings" DROP COLUMN "whatsappPrivatePhones";
ALTER TABLE "Settings" DROP COLUMN "whatsappModuleRouting";
```
Drop the `WhatsAppMessage` table if unused:
```sql
DROP TABLE IF EXISTS "WhatsAppMessage";
```
Then remove the fields from `backend/prisma/schema.prisma` to keep in sync.

### Phase 3 — Build new WhatsApp service (when ready)
- New Railway project: `mspil-whatsapp-v2`
- Own DB (SQLite file fine)
- HTTP API: `POST /send-message`, `GET /status`, `GET /groups`
- Main ERP calls it via `fetch()` — treats it like any external API
- Zero fields in main ERP Settings or any main ERP table
- WhatsApp schema changes never touch main ERP again

## Rules for future WhatsApp work
1. **Never** put WhatsApp fields in main ERP Prisma schema
2. **Never** use `prisma db push --accept-data-loss` for anything WhatsApp-related
3. Use `prisma migrate` (not push) for any main ERP schema change — reviewable files in git
4. Keep WhatsApp session state, config, group JIDs, phone numbers in the separate service only
5. Main ERP's ONLY awareness of WhatsApp: an HTTP fetch call to the worker service

## Trigger phrase
Say **"whatsapp cleanup"** to resume this. On hearing it, Claude should:
1. Re-read this file
2. Start Phase 1 (code removal only, no DB change)
3. Ask before Phase 2
