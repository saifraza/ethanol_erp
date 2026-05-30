# Factory Incidents — Postmortem & Permanent Rules

> Every rule here is written in blood. Each entry corresponds to a real outage that stopped trucks, halted production, or silently broke data. Read before touching the factory; add to it after every incident.

**Golden rule:** the factory is not staging. You can't "fix forward" at 11 PM while operators are trying to weigh rice husk. Every deploy must be proven correct BEFORE it lands on the PC.

The common pattern across ALL of these: **a silent failure the system kept running through, while operators tried to work and couldn't figure out why nothing worked.** The bug differs each time; the class is the same. The defense — log everything, fail fast, alert on absence of progress, surface real errors to operators — is in `SKILL.md`.

---

## 1. WtService halted weighbridge — 2026-03-31
**What:** Someone stopped/disabled WtService (Oracle's weighbridge reader) during a debug session. WtService reads COM1 and writes weight to a shared file the old Oracle ERP reads. When it stopped, the legacy ERP couldn't get weights — trucks piled up at the gate for hours.
**Root cause:** We assumed WtService was ours. It belongs to the legacy Oracle ERP.
**Rule:** Never stop, disable, or modify any Windows service on the factory PC. Our processes are ONLY `node.exe` and `pythonw.exe`. Oracle, WtService, Print Consol — all sacred. Investigate misbehaving services, but don't touch without confirming ownership.

## 2. Oracle service stopped — prior to 2026-04-05
**What:** Oracle XE or the Oracle TNS Listener was stopped. The legacy factory ERP went down. Plant ops blocked.
**Rule:** `OracleServiceXE` and `OracleXETNSListener` must ALWAYS be `RUNNING`. The deploy script verifies this and aborts if either is down. There is NO scenario where stopping them is OK.

## 3. factory-server node process died — 2026-04-05
**What:** factory-server node process found dead. No auto-restart, no alert. Trucks couldn't submit gate entries.
**Root cause:** Server ran as bare `node dist/server.js` under a shell. On crash, nothing brought it back. No logs, no watchdog.
**Rule:** factory-server runs under a Windows scheduled task (`FactoryServer`, via `run.bat`). Scheduled tasks survive reboots, don't need an interactive shell, relaunch via `schtasks /run /tn FactoryServer`. We tried pm2 — its daemon doesn't persist across Windows reboots. Use schtasks. Period.

## 4. Weighbridge `/push` — cloud schema drift — 2026-04-06
**What:** Weighbridge pushed `GrainTruck` to cloud but dropped `vehicle_type`, `driver`, `transporter`. Silent data loss.
**Root cause:** Fields existed locally but were never mapped in the cloud-side `/push` handler.
**Rule:** Every field added to a weighbridge model must be explicitly mirrored in the cloud `/push` handler for that product. Read `.claude/skills/weighbridge/SKILL.md` BEFORE adding any new weighbridge product or field.

## 5. Ethanol sync 5-hour outage — 2026-04-07
**What:** `ethanolOutbound` handler wrote `quantityKL` to `DispatchTruck` — which has no `quantityKL` column. Every ethanol truck sync failed for 5 hours. No alert.
**Root cause:** Developer assumed the field existed. Prisma threw `Unknown argument` on every write; the error was logged but not alerted, and operators had no visibility into "sync failed silently." Eventually surfaced via the `PlantIssue` dashboard.
**Rule (tooling):** Before writing a new field into a Prisma model, verify it exists — `grep -n "fieldName" prisma/schema.prisma`. Never copy-paste from a spec and assume.
**Rule (observability):** Sync failures MUST surface to the operator and to Telegram, not just `console.error`. PlantIssue dashboard is the backup, not the first line of defense.

## 6. Gate entry silent 500 — 2026-04-08 (the big one)
**What:** EVERY gate entry submission returned `Internal server error`. Operators couldn't bring trucks into the plant. Production halted at the gate for at least several hours — possibly since commit `1b780dc` was deployed.
**Error:** `Unknown argument 'cloudContractId'. Available options are marked with ?.` from `tx.weighment.create()` in `POST /api/weighbridge/gate-entry`.
**Root cause:** Commit `1b780dc` ("feat(factory): DDGS contract picker at gate entry") added a `cloudContractId String?` field to the factory Weighment schema AND wrote to it. The deploy copied `dist/` and `schema.prisma` to the server but **did not run `npx prisma generate`**. The compiled Prisma client on the PC was still the OLD one — it didn't know `cloudContractId` existed. Every write referencing the new field threw `Unknown argument` at runtime.
**Why invisible:** `run.bat` had no stdout/stderr redirection — node wrote errors to stdout which went nowhere. No log file for hours of failures. Operators just saw "Internal server error."
**Windows gotcha:** `npx prisma generate` errors with `EPERM ... rename query_engine-windows.dll.node.tmp -> query_engine-windows.dll.node` when node is running (Windows holds the DLL open). You MUST `taskkill /F /IM node.exe` before generating, then restart via `schtasks /run`.
**Fix:** (1) Added stdout/stderr redirection to `run.bat` → every restart creates `logs/server-YYYYMMDD_HHMMSS.log`; errors can never be invisible again. (2) Ran `prisma generate` on the PC — gate entry worked immediately. (3) Wrote `factory-server/scripts/deploy.sh` as the ONLY sanctioned deploy path (bakes in prisma generate, service safety checks, local preflight compile, health probes, startup log scan). (4) Committed `run.bat` + `deploy.sh` to the repo.

## 7. "Cloud data stale" false positive — 2026-04-08 (same day)
**What:** Gate entry page showed orange banner `⚠ Cloud data stale (6 min)` even though cloud sync was running perfectly.
**Root cause:** `masterDataCache.ts` ran `smartSync()` every 5s. It pinged cloud for a "has anything changed" timestamp; if unchanged, it correctly skipped the full sync — but it updated `lastCloudCheck` every tick while only updating `lastCloudSync` on actual data changes. The staleness check used `lastCloudSync`, so during quiet periods (no edits for 5+ min) the banner always went stale. Worse: when cloud was UNREACHABLE, `lastCloudCheck` was also updated (before the failure check), masking real sync failures.
**Impact:** The "boy who cried wolf" failure mode — constant false warnings during quiet periods train operators to ignore the banner, so a REAL outage goes unnoticed. Over-firing alerts have negative value.
**Fix:** Staleness now uses `lastCloudCheck` (successful ping), not `lastCloudSync` (data change). `lastCloudCheck` is only updated AFTER the ping succeeds. Threshold reduced 5min→2min (~24 consecutive failed 5-sec checks = real problem). Added `consecutiveCheckFailures` counter with an error log at 24 failures. TODO: wire that counter into a Telegram alert.

---

## File map — where the deploy safety lives

| File | Purpose |
|---|---|
| `factory-server/scripts/deploy.sh` | The one sanctioned deploy script. Refuses to deploy on unhealthy state. |
| `factory-server/run.bat` | Launcher with permanent stdout/stderr → timestamped log files. Committed to git; lives at `C:\mspil\factory-server\run.bat` on the PC. |
| `factory-server/src/services/masterDataCache.ts` | Cache freshness logic. Staleness from `lastCloudCheck`, not `lastCloudSync`. Counts consecutive ping failures. |
| `.claude/skills/factory-operations/SKILL.md` | Pre-flight + hard rules + pointers. |
| `.claude/skills/factory-operations/reference.md` | Architecture + deploy runbook + troubleshooting. |
| `.claude/skills/weighbridge/SKILL.md` | Hardware, serial protocol, product routing, corrections. |
| `docs/tech-debt-register.md` | Known tech debt, severity ranked. |
