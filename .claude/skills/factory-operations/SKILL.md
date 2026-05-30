---
name: factory-operations
description: Safety-critical runbook for the MSPIL factory server and factory-floor systems. Use BEFORE any work on factory-server/, weighbridge/, gate-entry, or anything deployed to the factory PC (Tailscale 100.126.101.7, Windows Server 2019, :5000). Covers the mandatory deploy path, the NEVER rules (Oracle/WtService are sacred), and the postmortem timeline. Triggers on: factory, factory-server, deploy to factory, gate entry, weighment, 100.126.101.7, "the server is broken".
when_to_use: Any change to factory-server/, weighbridge/, biometric-bridge/, or factory-deployed code. Diagnosing a factory outage. Deploying to the factory PC. A Prisma "Unknown argument" error on the factory server. Adding/removing a weighbridge PC. Whenever a request mentions the factory, the gate, the scale, or 100.126.101.7.
---

# Factory Operations

The factory runs 24/7. There is no staging, no maintenance window, no "I'll fix it tomorrow." A bad deploy means trucks pile up at the gate and production halts. Every rule below corresponds to a real outage — see `lessons.md`.

## Mandatory pre-flight (do this BEFORE touching anything)

1. Read `lessons.md` (the 7 incidents — every rule is written in blood) and `reference.md` (architecture + deploy runbook).
2. **Never deploy manually.** The only sanctioned deploy path is `./factory-server/scripts/deploy.sh`. It bakes in every lesson (local compile, service safety checks, mandatory `prisma generate`, health probes, log scan).
3. Check uncommitted state: `git status factory-server/`. Investigate unknown changes before editing.
4. A Prisma `Unknown argument` / `Unknown field` error is **always** fixed with `prisma generate` (BOTH schemas — see below), never a code change.
5. Before writing a new field into a Prisma model, verify it exists: `grep -n "fieldName" prisma/schema.prisma`. Never copy from a spec and assume.
6. Adding a field to a weighbridge model? It must be mirrored in the cloud `/push` handler — see `.claude/skills/weighbridge/SKILL.md`.
7. When in doubt, ask before touching the factory. Wrong move = trucks at the gate.

The factory has TWO Prisma schemas: `factory-server/prisma/schema.prisma` (local Postgres) + `factory-server/prisma/cloud/schema.prisma` (read-only cloud client). Both must be synced and regenerated on deploy.

## Hard rules — NEVER

- **NEVER stop, disable, or modify any Windows service** on the factory PC. Our processes are ONLY `node.exe` (factory-server) and `pythonw.exe` (weighbridge Flask). Everything else is sacred:
  - `OracleServiceXE` + `OracleXETNSListener` must ALWAYS be `RUNNING` (Oracle XE 11g on :1521 — Print Consol legacy gate entry depends on it).
  - `WtService` / `WTReadingNew` belongs to the legacy Oracle ERP (reads COM1, writes the weight file). Stopping it halts the old gate entry — happened 2026-03-31.
- **NEVER `taskkill` broadly.** Only `taskkill /F /IM node.exe` or by PID. Never a wildcard.
- **NEVER deploy without `prisma generate`.** Kill `node.exe` first (Windows holds the query engine DLL open → EPERM otherwise). This is the bug that killed gate entry for a full work day (2026-04-08).
- **NEVER restart with bare `node dist/server.js`.** Always `schtasks /run /tn FactoryServer` (scheduled task survives reboots; pm2 does not on Windows).
- **NEVER write `catch (err: any) { res.status(500).json({ error: err.message }) }`** or silent `try/catch {}` in factory-server routes. Use `asyncHandler` so errors hit the log file. Operators must see the real constraint violation, not "Internal server error".
- **NEVER rapidly retry SSH after a password failure.** 5 wrong attempts = 30-minute Windows account lockout. Slow down.
- **NEVER use ports 1521, 8070, 8080, 8888** — already in use by legacy services.
- **NEVER deploy without an exit plan.** Know the rollback before you start (see `reference.md`).

## Hard rules — ALWAYS

- ALWAYS log everything: `run.bat` must redirect stdout/stderr to a timestamped `logs/server-*.log`. Never deploy a version that drops this.
- ALWAYS restart the WB-PC Flask after deploying to it (templates are cached in memory).
- ALWAYS use pure black `#000` text in thermal slip templates (printers can't render gray).
- ALWAYS keep sleep disabled on all factory PCs (24/7).

## "The server is broken" — first move

Read the log before guessing:
```bash
sshpass -p '...' ssh Administrator@100.126.101.7 \
  'powershell -Command "Get-ChildItem C:\mspil\factory-server\logs\server-*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100"'
```
Full triage flow (services check, health probe, Prisma-error fix, rollback) is in `reference.md` → "The server is broken". Credentials: see the out-of-git fleet doc `~/Desktop/infra/fleet.md`.

## Pointers

- `reference.md` — architecture (cloud ↔ factory hub ↔ WB PCs ↔ biometric bridge), full deploy runbook, server specs, ports, SSH, add-a-PC, troubleshooting.
- `lessons.md` — the 7 incidents/postmortems, chronological. Read after any new incident; add to it after every outage.
- `.claude/skills/weighbridge/SKILL.md` — hardware, serial protocol, product routing, corrections.
- `docs/tech-debt-register.md` — known tech debt, severity ranked.
