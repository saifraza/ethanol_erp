---
name: weighbridge
description: MSPIL truck-scale (weighbridge / kata) system — gate entry, gross/tare weight capture, weight slip printing, and the factory→cloud weighment sync. Use when working on weighment capture, the 3-step QR workflow, scale/COM-port/serial weight reading, gate-entry UI, factory→cloud push contract, adding a new weighable product, or correcting a captured weighment. Triggers on weighbridge, weighment, tare, gross, scale, COM port, kata, gate entry, weight slip.
when_to_use: Editing factory-server/src/routes/weighbridge.ts or gateEntry.ts; the weighbridge/ Python Flask reader; backend/src/routes/weighbridge/ cloud handlers; debugging "truck stuck at gate" / "weighment not syncing"; adding scrap/sugar/feed as a weighable product; fixing a wrong material/PO/vehicle on a captured weighment.
---

# Weighbridge — System Overview

MSPIL truck-scale system: gate entry → gross weight → tare weight → slip print → factory-server → cloud ERP. Offline-tolerant (trucks can't wait for internet). The factory PC is local-first; cloud holds all business logic (GRN, GST, invoicing).

## Hard rules (NEVER / ALWAYS)

- **NEVER stop/disable WtService** (WTReadingNew) — it feeds both our reader AND Oracle gate entry. Disabling it halted the old gate system on 2026-03-31.
- **NEVER set `SERIAL_PROTOCOL=serial` on the factory PC** — conflicts with WtService on COM1. Production mode is `file`. The PC has `WB_PROTOCOL=serial`/`file` as a system env override; check it before deploying `config.py`.
- **NEVER modify the Oracle DB** at `192.168.0.10/XE` or stop Print Consol (`DirectPrinting.exe`).
- **NEVER rapidly retry SSH** to any factory PC — locks the Windows account (30 min or reboot). Locked `abc` on 2026-04-01.
- **ALWAYS, for any new outbound product, give every weighment-keyed table `sourceWbId String? @unique` and use `prisma.upsert`** — never `findFirst→create` (race → duplicate billing).
- **ALWAYS push to `out.ids[]` at the end of every handler path** (including skips/bail-outs). A handler that returns without acking makes syncWorker retry forever → "truck stuck at gate" (incident 2026-04-07).
- **ALWAYS read `.claude/skills/factory-operations/SKILL.md` before ANY factory-server / weighbridge deploy.** No maintenance window — treat every change as 50 trucks at the gate.
- This is a PROTECTED critical path (see repo CLAUDE.md). Run `./scripts/smoke-test.sh` after edits.

## 3-step QR workflow

1. **Gate Entry** — operator fills vehicle/supplier/material/PO/transporter/vehicle-type/driver-mobile; shift auto-detected; prints gate pass (thermal 80mm) with QR encoding the ticket number. Status `GATE_ENTRY`.
2. **Gross Weight** — truck on scale; operator scans QR (USB scanner types ticket# into input); weight auto-reads (or manual fallback); "Capture Gross" saves + prints gross slip. Status `GROSS_DONE`.
3. **Tare Weight** — after unloading, scan same QR; weight auto-reads; net = gross − tare; prints final slip. Status `COMPLETE` → enqueued for cloud sync.

For OUTBOUND (empty truck weighs first) tare is the FIRST weighment and gross the second — timestamps are direction-aware in syncWorker. See add-product.md.

## Data flow

```
Weighbridge PC (192.168.0.83, Flask :8098, SQLite)
   → Factory Server (192.168.0.10 / Tailscale 100.126.101.7 :5000, local Postgres)
   → Cloud ERP (app.mspil.in)  POST /api/weighbridge/push  (X-WB-Key auth)
   → dispatcher push.ts → detectHandler() → handler → GRN/DispatchTruck → inventory + journal
```

## Reference files (point, don't fork)

- **hardware.md** — serial protocol, COM settings, WtService file-mode setup, printers, PC inventory, SSH/deploy commands, local Flask API/schema.
- **add-product.md** — adding a new weighable product end-to-end + the cross-system push/master-data/heartbeat contracts, handler rules, contract-picker pattern, full-vertical checklist.
- **corrections-spec.md** — the weighment-correction UI/data spec (SHARED SSoT, also used by the `correct-weighment` skill).

## Related skills / docs

- `.claude/skills/factory-operations/SKILL.md` — deploy + incident playbook (READ FIRST for factory work).
- `.claude/skills/wb-vision/reference.md` — truck-identity verification.
- `.claude/skills/ticket-lookup/SKILL.md` — CLI ticket lookup.
- Cloud handlers: `backend/src/routes/weighbridge/**`. Factory gate/weighment: `factory-server/src/routes/weighbridge.ts`, `gateEntry.ts`. Sync: `factory-server/src/services/syncWorker.ts`, `masterDataCache.ts`.

## Accepted risks

1. No auth on local Flask endpoints (LAN-only).
2. Inventory syncs on DRAFT GRN (by design; rejection reverses).
3. Cloud heartbeat map is in-memory — wiped on Railway deploy, recovers <60s.
4. SQLite thread-local connections (single-writer WAL).
5. Clock drift on factory PC — NTP recommended; local timestamps may drift.
