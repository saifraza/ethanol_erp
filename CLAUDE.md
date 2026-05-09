# MSPIL Distillery ERP — Claude Code Guide

## 🚨 STOP — Before ANY bulk SQL, schema change, or `prisma db push` on prod
Read **[.claude/skills/incident-2026-04-16-db-damage.md](.claude/skills/incident-2026-04-16-db-damage.md)** first. Non-negotiable rules (learned the hard way):
1. **`pg_dump` locally BEFORE any destructive op** → `<repo>/db-backups/` (gitignored)
2. **Never run `prisma db push` on prod from your laptop.** It also doesn't run on Railway — see "Schema changes" below.
3. **Never use `--accept-data-loss` on prod**
4. **Never run `pg_restore --clean` without a local pg_dump first** — if interrupted, constraints get dropped
5. **Factory runs 24/7, no "safe window"** — treat every statement as if 50 trucks are at the gate
6. Run bulk updates inside `BEGIN; ... COMMIT;` so you can `ROLLBACK` if counts look wrong
7. **Ask user before any `UPDATE` touching > 100 rows**
8. The GitHub backup workflow `.github/workflows/backup-db.yml` is sacred. Don't touch. Test restore quarterly.

## Schema changes — SchemaDriftGuard, NOT prisma db push
**Every** schema change (new column, new table, new index) requires TWO edits in the same PR:
1. `backend/prisma/schema.prisma` — the source of truth (so Prisma Client types are right)
2. `backend/src/services/schemaDriftGuard.ts` — register the column/table in `EXPECTED_COLUMNS` / `EXPECTED_TABLES` so Railway actually applies the change at server startup

**Why both?** `prisma db push --skip-generate` silently skips changes in Railway's environment — happened on 2026-04-21 (Employee), 2026-05-02 (Farmer), 2026-05-04 (cost template). The team uses SchemaDriftGuard as the sole migration mechanism. Procfile no longer runs `prisma db push`. If you skip step 2, prod hits P2022/P2021 on the first request that touches the new field.

ALTERs in SchemaDriftGuard must be **idempotent and additive only** — `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Never `DROP`, `RENAME`, or change column types via the guard — those need a real migration with backup + downtime plan.

## Project Overview
- **Company**: Mahakaushal Sugar & Power Industries Ltd (MSPIL)
- **System**: Distillery ERP for ethanol plant at Village Bachai, Dist. Narsinghpur, MP
- **Stack**: Express + TypeScript + Prisma ORM (backend), React + Vite + Tailwind CSS (frontend), PostgreSQL on Railway
- **Production URL**: https://app.mspil.in/
- **Login**: admin@distillery.com / admin123

## Deployment — Railway
- **Auto-deploys** from GitHub `main` branch — a bad push goes straight to production
- **DB**: `DATABASE_URL` env var on Railway (never hardcode)
- **OPC DB**: `DATABASE_URL_OPC` env var, schema at `backend/prisma/opc/schema.prisma`
- Root build: `cd backend && npm ci && prisma generate && tsc --outDir dist && cp -r src/data dist/ && cd ../frontend && npm ci && vite build`
- Procfile: `web: cd backend && npx prisma db push --skip-generate && node dist/server.js`
- Frontend vite outputs to `../backend/public` (not `frontend/dist/`)
- New static data files must be copied in the ROOT build script

---

## PROTECTED FILES — Critical Path

**These files power the weighbridge → PO → GRN → inventory chain. This is the #1 business-critical flow.**
**Do NOT modify unless the task specifically requires it. If you must edit, run `./scripts/smoke-test.sh` after.**

```
# Cloud weighbridge handlers (auto-create GRN, update PO, sync inventory)
backend/src/routes/weighbridge/**

# PO + GRN (weighbridge handlers write to these models)
backend/src/routes/purchaseOrders.ts
backend/src/routes/goodsReceipts.ts

# Accounting automation (called by weighbridge handlers)
backend/src/services/autoJournal.ts

# Factory gate entry + weighment (operator-facing, no downtime allowed)
factory-server/src/routes/weighbridge.ts
factory-server/src/routes/gateEntry.ts

# Factory sync + cache (cloud connectivity, master data)
factory-server/src/services/syncWorker.ts
factory-server/src/services/masterDataCache.ts
factory-server/src/services/ruleEngine.ts

# Shared infrastructure (breaking these breaks EVERYTHING)
backend/src/middleware/auth.ts
backend/src/config/prisma.ts
backend/prisma/schema.prisma
factory-server/prisma/schema.prisma
factory-server/prisma/cloud/schema.prisma
```

**Dependency chain**: Weighment → pre-phase (creates stub) → handler (poInbound/traderInbound/ethanolOutbound/etc.) → GRN + PO status update → inventory transaction → GL journal entry.
Handlers are loosely coupled via Prisma — no direct imports between weighbridge and PO/GRN routes, but they share the same models.

---

## Multi-System Architecture

| System | Location | Stack | Database | Runs On |
|--------|----------|-------|----------|---------|
| **Cloud ERP** | `backend/` + `frontend/` | Express + Prisma + React | Railway PostgreSQL | Railway (app.mspil.in) |
| **Factory Server** | `factory-server/` | Express + Prisma + React | **Local Postgres** (DATABASE_URL on the factory PC) + read-only cloud client (CLOUD_DATABASE_URL) | Windows 192.168.0.10 / Tailscale 100.126.101.7 :5000 |
| **Weighbridge PC** | `weighbridge/` | Python Flask + SQLite | Local SQLite per PC | Each WB PC :8098 |
| **Biometric Bridge** | `biometric-bridge/` | Python FastAPI + pyzk | Stateless (no DB) | Same factory PC :5005 |

**Data flow**: Weighbridge PC → Factory Server → Cloud ERP (weighments up, master data down).
Same shape now drives biometric: eSSL devices → Biometric Bridge → Factory Server local Postgres → Cloud ERP.

### Boundary Rules
- **Factory server** = operator-facing UI + **local-first data** + sync to cloud. NO business logic. Owns its own Postgres on the factory PC; survives multi-hour internet outages without losing data.
- **Cloud backend** = all business logic, accounting, GST, e-invoicing. Receives weighments via POST /api/weighbridge/push, attendance punches via POST /api/biometric-factory/punches/push.
- **Weighbridge PC** = hardware-facing for the truck scale. Reads COM port, Flask UI, local SQLite.
- **Biometric Bridge** = hardware-facing for fingerprint devices. Stateless Python service that translates HTTP ↔ pyzk. Factory-server is the only client.
- **Cross-system auth**: `X-WB-Key` header (timing-safe, key in `WB_PUSH_KEY` env var). Same key authenticates both weighbridge sync and biometric-factory sync.

### AI Routing Table

| When user mentions... | Look in... |
|---|---|
| Gate entry / weighment UI | `factory-server/frontend/src/pages/` + `factory-server/src/routes/` |
| Weighment → GRN/inventory | `backend/src/routes/weighbridge/` (handlers/) |
| Cloud sync / master data cache | `factory-server/src/services/syncWorker.ts`, `masterDataCache.ts` |
| Live weight from scale | `weighbridge/weight_reader.py` |
| Factory deploy / safety / incidents | `.claude/skills/factory-operations.md` — **READ FIRST** |
| Weighbridge hardware / corrections | `.claude/skills/weighbridge.md` |
| OPC/DCS bridge | `.claude/skills/opc-bridge.md` |
| Sales / dispatch / invoice | `backend/src/routes/salesOrders.ts`, `shipments.ts`, `invoices.ts` |
| Procurement PO → GRN → payment | `backend/src/routes/purchaseOrders.ts`, `goodsReceipts.ts`, `vendorPayments.ts` |
| Accounts / journal / bank | `backend/src/routes/chartOfAccounts.ts`, `journalEntries.ts`, `bankPayments.ts` |
| Inventory | `backend/src/routes/inventory*.ts` |
| Fuel | `backend/src/routes/fuel.ts` |
| Telegram auto-collect | `backend/src/services/telegramAutoCollect.ts`, `autoCollectModules/` |
| Biometric devices / attendance / fingerprint | Cloud admin UI: `frontend/src/pages/hr/BiometricDevices.tsx`. Cloud routes: `backend/src/routes/biometric.ts` (admin) + `biometricFactory.ts` (machine-to-machine). Bridge: `biometric-bridge/bridge.py`. Factory-led pull/sync: `factory-server/src/services/biometricScheduler.ts` + `biometricSync.ts`. Architecture: `biometric-bridge/DEPLOY.md` |
| E-invoice / e-way bill | `backend/src/services/eInvoice.ts`, `ewayBill.ts` |
| UBI bank payments | `.claude/skills/ubi-h2h-banking.md` |
| Module list / maturity | `.claude/skills/module-index.md` |
| Code templates | `.claude/skills/code-templates.md` |
| SAP design tokens | `.claude/skills/sap-design-tokens.md` |
| Tech debt | `.claude/skills/debt-register.md` |
| All skills index | `.claude/skills/SKILLS.md` |
| Any NEW module | `backend/` + `frontend/` (cloud ERP) |

---

## Factory Work — Mandatory Pre-Flight

**Before ANY change to `factory-server/`, `weighbridge/`, or factory-deployed code:**

1. **Read `.claude/skills/factory-operations.md`** — 7 incidents, every rule is written in blood
2. **Never deploy manually** — always use `./factory-server/scripts/deploy.sh`
3. **Check uncommitted state**: `git status factory-server/` — investigate unknown changes before editing
4. **Prisma `Unknown argument`/`Unknown field`** = always fix with `prisma generate` (both schemas!), never a code change
5. **Adding a Prisma field** → grep all systems for cross-system references (see `weighbridge.md` Part B)
6. **When in doubt, ask before touching factory** — no maintenance windows, wrong move = trucks at gate

Factory has TWO Prisma schemas: `prisma/schema.prisma` (local) + `prisma/cloud/schema.prisma` (cloud). Both must be synced and regenerated on deploy.

Connection details: see `.claude/skills/factory-operations.md` Part B or global CLAUDE.md.

---

## Core Design Principles

### Telegram-First Data Collection
Plant operators submit readings via Telegram, not web UI. Bot runs in-process (long-polling). Services: `telegramBot.ts`, `telegramAutoCollect.ts`, `autoCollectModules/`. Adding a new module: copy `_template.ts`, implement STEPS/buildPrompt/parseReply/saveData, register in index.

### IST Timezone
Server runs UTC. Use `nowIST()` pattern from `.claude/skills/code-templates.md`. **NEVER** use `toLocaleTimeString()` on server.

### Document Vault (Gemini summaries, no RAG)
LightRAG was removed on 2026-05-08 (PR #77). Compliance / company doc summarisation now goes through `generateVaultNote()` only — Gemini extracts a summary + entities and writes a `VaultNote` row for Obsidian sync. No external RAG service. The `Settings.whatsapp*`, `CompanyDocument.ragTrackId / ragIndexed`, and `VaultNote.ragIndexed` columns are unused but kept (no destructive migration).

### UI Design System — Two Tiers
- **Tier 1 (Plant/Process)**: Rounded, colorful, emoji-friendly — for operators on phones
- **Tier 2 (Enterprise/SAP)**: Dense, square, professional — for ALL new modules. Tokens in `.claude/skills/sap-design-tokens.md`

### Module Build Approach
1. Create skill file in `.claude/skills/` with full spec
2. Build sequentially (modules interlink)
3. Consider Telegram integration
4. Follow code templates from `.claude/skills/code-templates.md`
5. Use SAP-style UI for non-plant modules

---

## Critical Rules

### NEVER DO
- Never hardcode DB URLs, passwords, API keys
- Never use `(req as any).user` — use `AuthRequest` from `../middleware/auth`
- Never write `catch (err: any) { res.status(500).json({ error: err.message }) }` — use `asyncHandler`
- Never add route files without registering in `app.ts`
- Never add pages without lazy-loaded Route in `App.tsx`
- Never commit `console.log`
- Never use `: any` type
- Never write `findMany()` without `take` limit (default 50, max 500)
- Never write `findMany()` for lists without `select`
- Never use any charting library except Recharts (see `.claude/skills/charts-graphs.md`)
- Never create PDFs outside the HBS template + renderDocumentPdf pipeline

### ALWAYS DO
- Always use `asyncHandler()` from `../shared/middleware`
- Always validate POST/PUT/PATCH with Zod via `validate()` middleware
- Always add `@@index` for new date, FK, status fields in Prisma
- Always use `COMPANY` from `shared/config/company.ts` for GSTIN, address, bank
- Always use `$transaction` for multi-step atomic writes
- Always run `./scripts/smoke-test.sh` before pushing (or `--quick` for fast check)

---

## Pre-Push Safety

```bash
./scripts/smoke-test.sh          # Full check: tsc + vite + prisma + banned patterns + endpoints
./scripts/smoke-test.sh --quick  # Skip vite build (faster)
```

The smoke test checks: TypeScript compilation, frontend build, all 3 Prisma schemas, banned patterns in changed files, critical path modifications (warns), and endpoint health if dev server running.

---

## Local-only directories — DO NOT push to origin

**`vision/`** — truck re-ID / camera ML project. Local research code, ML weights (.pt files), Python `.venv`, training data. **Gitignored as of 2026-05-02.** A teammate accidentally pushed the source files in commit `5666406` which then caused repeated pull conflicts on every dev machine ("untracked files would be overwritten by checkout") because each machine had its own local copy. Removed from origin tracking via `git rm -r --cached vision/`; now in `.gitignore`. Never re-add it. If you need to share vision code between machines, use SCP / a separate repo / shared drive — not this one.

**Symptoms when you forget**: `git pull` fails with "untracked files would be overwritten" listing files under `vision/`. **Fix**: confirm `vision/` is in `.gitignore`; `git rm -r --cached vision/` if it crept back in; pull again.

Same rule applies to: `db-backups/` (pg_dump output), `weighbridge/data/` and `weighbridge/logs/` (factory PC runtime state), `**/.venv/`, `**/node_modules/`. None of these belong on origin.

---

## Codex Integration (GPT-5.4 Second Opinion)

`/codex:rescue` — delegates investigation, diagnosis, or code review to Codex. Use for deep audits, second opinions on complex logic, root-cause diagnosis, and test coverage gaps. Not for simple one-file edits.

## Agent Parallelization

**New Module**: Agent 1 (schema + backend + app.ts) || Agent 2 (frontend page) → then align types
**Bug Investigation**: Agent 1 (backend) || Agent 2 (frontend) || Agent 3 (git history)
**Multi-File Refactor**: Agent per independent file group
**Don't parallelize**: dependent work, schema changes (need prisma generate first), single-file fixes
