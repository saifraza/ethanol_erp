# Factory Incidents — Postmortem & Permanent Rules

> **Read this first** before making ANY change that touches `factory-server/`, `weighbridge/`, or anything deployed to the factory PC. The plant runs on this infrastructure. Every rule below is written in blood — each one corresponds to a real outage that stopped trucks, halted production, or silently broke data.
>
> **Golden rule**: the factory is not staging. You can't "fix forward" at 11 PM when operators are trying to weigh rice husk. Every deploy must be proven correct BEFORE it lands on the PC.

---

## Incident Timeline

### 1. WtService halted weighbridge — 2026-03-31
**What happened**: Someone stopped/disabled WtService (Oracle's weighbridge reader) during a debug session. WtService reads COM1 and writes weight to a shared file that Oracle ERP reads. When it stopped, the old Oracle ERP couldn't get weights — trucks piled up at the gate for hours.

**Root cause**: We assumed WtService was ours. It's not. It belongs to the legacy Oracle ERP.

**Permanent rule**: **Never stop, disable, or modify any Windows service** on the factory PC. Our processes are ONLY `node.exe` (factory-server) and `pythonw.exe` (weighbridge Flask). Everything else — Oracle, WtService, Print Consol, whatever — is sacred. If a service is misbehaving, investigate but don't touch it without confirming ownership.

### 2. Oracle service stopped — prior to 2026-04-05
**What happened**: Oracle XE or Oracle TNS Listener was stopped. The factory ERP (the old Oracle one, not ours) went down. Plant ops were blocked.

**Permanent rule**: `OracleServiceXE` and `OracleXETNSListener` must ALWAYS be in `RUNNING` state. Deploy script verifies this before touching anything and aborts if either is down. There is NO scenario where it's OK for those services to be stopped.

### 3. factory-server node process died — 2026-04-05
**What happened**: Found the factory-server node process dead. No auto-restart, no alert. Trucks couldn't submit gate entries.

**Root cause**: Server was running as bare `node dist/server.js` under a shell. When it crashed, nothing brought it back. No logs, no watchdog.

**Permanent rule**: Factory-server runs under a Windows **scheduled task** (`FactoryServer`, via `run.bat`). Scheduled tasks survive reboots, don't depend on an interactive shell, and can be relaunched with `schtasks /run /tn FactoryServer`. We experimented with pm2 but pm2's daemon doesn't persist reliably across Windows reboots. **Use schtasks. Period.**

### 4. Weighbridge `/push` — cloud schema drift — 2026-04-06
**What happened**: Weighbridge pushed `GrainTruck` to cloud but dropped `vehicle_type`, `driver`, `transporter` fields. Silent data loss.

**Root cause**: Schema fields existed locally but were never mapped in the cloud-side `/push` handler.

**Permanent rule**: Every field added to a weighbridge model must be explicitly mirrored in the cloud `/push` handler for that product. See `.claude/skills/weighbridge-add-product.md` — read it BEFORE adding any new weighbridge product or field.

### 5. Ethanol sync 5-hour outage — 2026-04-07
**What happened**: `ethanolOutbound` handler wrote `quantityKL` to `DispatchTruck` — but `DispatchTruck` has no `quantityKL` column. Every ethanol truck sync failed for 5 hours. No alert.

**Root cause**: Developer assumed the field existed. Prisma threw `Unknown argument` on every write. Error was logged but not alerted, and plant operators had no visibility into "sync failed silently."

**Discovery path**: `PlantIssue` safety net eventually surfaced it via dashboard.

**Permanent rule (tooling)**: Before writing a new field into a Prisma model, **verify** the field exists in the schema file. `grep -n "fieldName" prisma/schema.prisma` before you trust any field name. Never copy-paste from a spec document and assume.

**Permanent rule (observability)**: Sync failures MUST surface to the operator and to Telegram, not just to `console.error`. PlantIssue dashboard shouldn't be the last line of defense — it should be the backup to a Telegram alert.

### 6. Gate entry silent 500 — 2026-04-08 ⚠ (most recent)
**What happened**: EVERY gate entry submission on the factory server returned `Internal server error`. Operators couldn't bring trucks into the plant. Production halted at the gate. Duration: unknown but at least several hours — it may have been broken since commit `1b780dc` was deployed.

**Error**: `Unknown argument 'cloudContractId'. Available options are marked with ?.` from `tx.weighment.create()` inside the POST /api/weighbridge/gate-entry handler.

**Root cause**: Commit `1b780dc feat(factory): DDGS contract picker at gate entry (mirrors ethanol)` added a `cloudContractId String?` field to the factory-server Weighment schema AND added code that writes to it. The deploy copied `dist/` and `schema.prisma` to the server but **did not run `npx prisma generate`**. The compiled Prisma client in `node_modules/.prisma/client` on the factory PC was still the OLD one — it didn't know `cloudContractId` existed. Every Prisma write that referenced the new field threw `Unknown argument` at runtime.

**Why it was invisible**: `run.bat` had no stdout/stderr redirection — the Windows scheduled task launched node, node wrote errors to stdout, and those went nowhere. We had no log file for hours of failures. Operators just saw "Internal server error" in the browser.

**Windows gotcha**: `npx prisma generate` errors with `EPERM: operation not permitted, rename ... query_engine-windows.dll.node.tmp -> query_engine-windows.dll.node` when node is running. Windows holds the DLL open. You MUST `taskkill /F /IM node.exe` before generating, then restart via `schtasks /run`.

**Fix applied 2026-04-08**:
1. Added stdout/stderr redirection to `run.bat` — every restart creates `logs/server-YYYYMMDD_HHMMSS.log`. Errors can never be invisible again.
2. Ran `prisma generate` on the factory PC. Gate entry worked immediately.
3. Wrote `factory-server/scripts/deploy.sh` — the ONLY sanctioned deploy path going forward. It bakes in `prisma generate`, service safety checks, local preflight compile, health probes, and startup log scanning.
4. Committed `run.bat` and `deploy.sh` to the repo so they're version-tracked.

### 7. "Cloud data stale" false positive — 2026-04-08 (same day)
**What happened**: Gate entry page showed orange banner `⚠ Cloud data stale (6 min) — verify before submitting` even though cloud sync was running perfectly.

**Root cause**: `masterDataCache.ts` ran `smartSync()` every 5 seconds. The sync pinged cloud for a "has anything changed" timestamp. If the timestamp was unchanged (i.e., nobody had edited a PO / supplier / vehicle in the last few minutes), the function correctly skipped the full sync — but it updated `lastCloudCheck` every tick while only updating `lastCloudSync` on actual data changes. The staleness check then used `lastCloudSync` — so during quiet periods (no cloud edits for 5+ minutes) the banner would always go stale. Worse: when cloud was UNREACHABLE, `lastCloudCheck` was also updated (before the failure check), which meant real sync failures were masked.

**Impact**: Operators would see the warning banner constantly during quiet periods. They'd learn to ignore it. Then when it fires for a REAL outage, nobody would notice. This is the "boy who cried wolf" failure mode — alerts that fire too often train users to ignore them, at which point they have negative value.

**Fix applied 2026-04-08**:
- Staleness check now uses `lastCloudCheck` (successful ping), not `lastCloudSync` (data change).
- `lastCloudCheck` is only updated AFTER the ping succeeds.
- Threshold reduced from 5 min to 2 min (~24 consecutive failed 5-sec checks = real problem).
- Added `consecutiveCheckFailures` counter with an error log at 24 consecutive failures.
- TODO: wire that counter into a Telegram alert so somebody wakes up when it trips.

---

## Permanent Rules (distilled from all incidents above)

### Deploy Rules
1. **Always use `./factory-server/scripts/deploy.sh`**. Never manual SCP + restart.
2. **Local compile must pass** before SCP begins. `tsc` + `vite build` locally. No shipping broken code.
3. **Verify OracleServiceXE + OracleXETNSListener + WtService are RUNNING** before any deploy. Abort if not.
4. **Kill node.exe** before running `prisma generate` (Windows DLL lock).
5. **Always run `prisma generate`** after SCP, even if you think the schema didn't change. Cost of running it when unneeded = 300ms. Cost of skipping it when needed = production outage.
6. **Always restart via `schtasks /run /tn FactoryServer`**, never bare `node dist/server.js`.
7. **Always hit `/api/health` + `/api/weighbridge/summary`** after restart. Deploy isn't done until both return OK.
8. **Always scan the newest `logs/server-*.log`** for `[ERROR]`, `PrismaClientKnown`, `Unknown argument` after restart. Any hit = deploy failed, investigate.

### Code Rules
9. **Before writing a field into a Prisma model**, verify the field exists in `schema.prisma`. Never copy from a spec.
10. **Every field added to a weighbridge model** must be mirrored in the cloud `/push` handler for that product.
11. **No `catch (err: any) { res.status(500).json({ error: err.message }) }`** in factory-server routes. Use `asyncHandler` and let errors bubble into the log file.
12. **No silent catches anywhere**. `try { ... } catch { /* ignore */ }` is banned unless you comment WHY ignoring is safe and what the fallback behavior is.

### Observability Rules
13. **`run.bat` must redirect stdout/stderr** to a timestamped log file in `logs/`. Committed to repo. Never deploy a version that drops this.
14. **Staleness detection must be based on successful ping**, not on data-change events. "Nothing happened" is not the same as "nothing is working."
15. **Consecutive failures must be counted** and alerted once a threshold is crossed. Single failures are noise, repeated failures are signal.
16. **Alerts that fire during healthy operation are worse than no alert**. Every false positive trains operators to ignore the next one. When in doubt, raise the threshold, don't lower it.
17. **Operators must see actionable errors**, not `Internal server error`. Surface the actual constraint violation ("PO #61 is closed", "vehicle already inside") so they can fix it without calling the developer.

### Safety Rules (repeated because they matter)
18. **Never stop/disable any Windows service** on the factory PC. Not Oracle, not WtService, not Print Consol, not anything. Our processes are `node.exe` and `pythonw.exe` only.
19. **Never rapidly retry SSH** after a password failure. 5 wrong attempts = 30-minute account lockout. Slow down.
20. **Never taskkill broadly**. Always `taskkill /F /IM node.exe` or by PID — never `taskkill /F /IM *` or similar.
21. **Never deploy without an exit plan**. Know how to roll back before you deploy: `git checkout <last-good-sha> -- factory-server/ && ./factory-server/scripts/deploy.sh`.

---

## Quick Reference — "The server is broken, what do I do?"

### Step 1: Check the log
```bash
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 \
  'powershell -Command "Get-ChildItem C:\mspil\factory-server\logs\server-*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100"'
```
This is the first thing to run. Before guessing, before Googling, before SSH-ing in further — read the log.

### Step 2: Check services
```bash
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 \
  'sc query OracleServiceXE & sc query OracleXETNSListener & sc query WtService & tasklist /fi "IMAGENAME eq node.exe"'
```
All four should be present and in `RUNNING` (or node should have a PID).

### Step 3: Check health
```bash
curl -s http://100.126.101.7:5000/api/health | python3 -m json.tool
```
Look at `sync.consecutiveFailures`, `pcs[].alive`, `cameras[].alive`.

### Step 4: If it's a Prisma `Unknown argument` error
```bash
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 \
  'taskkill /F /IM node.exe & timeout /t 3 /nobreak >nul & cd C:\mspil\factory-server && npx prisma generate & schtasks /run /tn FactoryServer'
```

### Step 5: If it's genuinely broken code
```bash
git log --oneline factory-server/ | head -5
git checkout <last-good-sha> -- factory-server/
./factory-server/scripts/deploy.sh
```

---

## What Good Looks Like

A healthy factory-server deploy session looks like this:

```
[deploy] Preflight: compiling locally (tsc + vite)...
[  ok  ] local build clean
[deploy] Verifying factory server is reachable...
[  ok  ] SSH OK
[deploy] Verifying Oracle + WtService are still healthy...
STATE              : 4  RUNNING
STATE              : 4  RUNNING
STATE              : 4  RUNNING
[  ok  ] Oracle + WtService running
[deploy] Copying dist/ to server...
[deploy] Copying public/ (frontend build) to server...
[deploy] Copying prisma/ schema...
[deploy] Copying package.json + package-lock.json...
[  ok  ] files copied
[deploy] Stopping factory node (NOT Oracle, NOT WtService)...
SUCCESS: The process "node.exe" has been terminated.
[  ok  ] node stopped
[deploy] Regenerating Prisma client (MANDATORY — do not skip)...
✔ Generated Prisma Client (v6.19.2) to .\node_modules\@prisma\client in 268ms
[  ok  ] Prisma client regenerated
[deploy] Relaunching FactoryServer scheduled task...
SUCCESS: Attempted to run the scheduled task "FactoryServer".
[  ok  ] schtask triggered
[deploy] Waiting 8s for node to boot...
[deploy] Checking /api/health...
[  ok  ] health OK (status=ok, uptime=8.2s)
[deploy] Checking /api/weighbridge/summary (requires DB)...
[  ok  ] DB query OK
[deploy] Tailing newest server log for startup errors...
--- tail server-20260408_130145.log ---
[CACHE] Initial cloud sync complete
[CACHE] Smart sync started (every 5s)
[server] Factory Hub listening on :5000
--- end log ---
[  ok  ] no startup errors

[  ok  ] DEPLOY COMPLETE — factory server is up. Time: 01:02 PM
```

Anything less — ANY `[ FAIL ]` line, any `[ warn ]` you don't understand, any unexpected error in the tailed log — means the deploy is NOT done. Do not walk away. Do not assume it'll work out. Investigate before you close the terminal.

---

## File Map — where the deploy safety lives

| File | Purpose |
|---|---|
| `factory-server/scripts/deploy.sh` | The one sanctioned deploy script. Refuses to deploy on unhealthy state. |
| `factory-server/run.bat` | Launcher with permanent stdout/stderr → timestamped log files. Committed to git for reference, lives at `C:\mspil\factory-server\run.bat` on the PC. |
| `factory-server/src/services/masterDataCache.ts` | Cache freshness logic. Staleness computed from `lastCloudCheck`, not `lastCloudSync`. Counts consecutive ping failures. |
| `.claude/skills/factory-architecture.md` | Deploy procedure + SSH commands + troubleshooting runbook. Points back to this file for incident history. |
| `.claude/skills/factory-incidents-postmortem.md` | **This file.** The institutional memory. |
| `.claude/skills/debt-register.md` | Known tech debt, severity ranked. |
| `.claude/skills/weighbridge-add-product.md` | Required reading before adding any new weighbridge product. Prevents incident #4-style drift. |

---

## Never again

Every single incident above shares one pattern: **a silent failure that the system kept running through, while operators tried to work and couldn't figure out why nothing worked**. The specific bug differs. The class is the same.

The defense is simple and non-negotiable:

1. **Log everything.** Never run code whose stderr vanishes. `run.bat` enforces this.
2. **Fail fast.** The deploy script refuses to continue on any anomaly. No "probably fine" deploys.
3. **Alert on absence of progress.** `consecutiveCheckFailures` counter. Master-data staleness. PlantIssue dashboard.
4. **Operators see real errors**, not `Internal server error`. Surface Prisma constraint violations, foreign key errors, unique constraint conflicts in a human-readable form.
5. **Every incident becomes a rule.** This file grows with every outage. Future Claude sessions must read it before touching the factory.

The factory runs 24/7. The plant depends on gate entry, weighment, dispatch, and DDGS workflows working ALL the time. We don't get maintenance windows. We don't get "oops, I'll fix it tomorrow." We get one shot to do deploys safely, and every shortcut above came back to bite us within days.

**Read this file before every factory deploy. Read it again when you're stuck. Add to it after every incident.**
