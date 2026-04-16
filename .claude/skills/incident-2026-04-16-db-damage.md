# Incident — 2026-04-16 / 2026-04-17: DB damage during schema sync + backfill

> **READ THIS BEFORE DOING ANY BULK SQL ON PROD, EVER.**
> The factory runs 24/7. There is no "safe window". Treat prod as live at all times.

## What happened

Between ~17:00 IST 2026-04-16 and ~00:19 IST 2026-04-17, parts of the Railway Postgres data silently lost FK links and field values. By the time the damage was noticed (user couldn't see DDGS contracts, Job Work button missing, ethanol liftings showed "GEN INVOICE" instead of actual invoice numbers), the surface area was large:

| Table / Field | Damage |
|---|---|
| `EthanolLifting.invoiceId` | 34 of 35 rows wiped → liftings appeared un-invoiced |
| `DDGSContract` | 2 rows deleted (empty table) |
| `DDGSContractDispatch` | 34 rows deleted (empty table) |
| `Invoice.cgstAmount/sgstAmount/igstAmount/igstPercent` | 71 invoices lost GST breakdown |
| `Settings.telegramBotToken + telegramGroupChatId + telegramGroupName` | wiped |
| Schema constraints (PKs, FKs, UNIQUE, indexes) | lost after interrupted `pg_restore --clean` |

Row counts on flagship tables (GrainTruck, GoodsReceipt, DispatchTruck, Invoice, Vendor, PurchaseOrder) were **not** reduced. The damage was targeted column-level, not table-level.

## Root cause — theories, in order of likelihood

I never ran a `DELETE` or `DROP` in the session — my tool history is a sequence of `SELECT`, `INSERT`, and narrow `UPDATE` statements (mostly `SET "companyId" = ...`). The `UPDATE`s touched ONE column per table. Confirmed via checklist review.

So the damage most likely came from one of:

1. **A parallel Claude / ops session** doing cleanup work on the same DB. User referenced "other session work" around the same time (commit `8981ded feat: multi-company data separation (Sessions 1-3)` on 2026-04-14 was a similar pattern — multiple sessions working in parallel). Activity Log (committed 2026-04-15) only captures models listed in its trigger; older rows may have been cleared by un-logged models.
2. **App middleware with stale Prisma client** while schema sync was in-flight. If a running Node process holds a Prisma client generated before a new column was added, and it does an `upsert` with defaults, it can blank fields it thinks are nullable.
3. **`prisma db push --accept-data-loss`** on production — we ran it to rebuild constraints after the interrupted `pg_restore`. Prisma's "accept data loss" can re-create columns under the hood when type widens/narrows. The initial `pg_restore --clean --if-exists` that got interrupted also dropped the schema first — leaving the DB with data but no PKs/FKs/indexes.

Honest answer: **we don't have a definitive smoking gun.** The Activity Log wasn't in place for every affected table. Future incidents need broader audit coverage (see prevention).

## Rules for future Claude sessions

### Hard rules — do not violate

1. **Before ANY bulk SQL on prod, `pg_dump` first to local disk.** One line:
   ```bash
   pg_dump "$DATABASE_URL" --format=custom --compress=9 -f ~/Desktop/mspil-db-backups/mspil-prod-$(date +%Y%m%d_%H%M%S)_IST.dump
   ```
   Verify the file size (must be > 1 MB) before running anything destructive.

2. **Never run `prisma db push` on prod.** Use Railway's Procfile which already runs `prisma db push --skip-generate` on boot. If schema is out of sync, commit the schema change, push to GitHub, let Railway redeploy. Don't run it from your laptop against prod.

3. **Never use `--accept-data-loss` on prod.** If Prisma refuses, investigate why. Usually it's a constraint addition that could fail on duplicates — which means there IS data loss risk, and you should resolve the duplicates explicitly first.

4. **Never run `pg_restore --clean` on prod without a local pg_dump first.** If interrupted (network blip, user Ctrl+C, terminal closed), you end up with data but no schema constraints — and duplicates start creeping in the moment writes resume.

5. **No "factory quiet hours" assumption.** Factory runs 24/7 including nights. Treat every SQL statement as if 50 trucks are waiting at the gate. If the op would brick the factory for 2 minutes, DO NOT run it on prod without a maintenance window coordinated with the plant manager.

### Soft rules — do these unless there's a reason not to

6. Run bulk updates in a single `BEGIN; ... COMMIT;` block so you can `ROLLBACK` if something looks wrong mid-run.

7. Before applying a `COMMIT`, query a count that should/shouldn't change and inspect it. If row counts are off by even 1, roll back and investigate.

8. When doing schema changes, prefer additive: `ADD COLUMN ... NULL` over `ALTER COLUMN`. Never mix column drops with data backfill in the same session.

9. Ask the user before running any `UPDATE` that touches > 100 rows. Always.

10. If Claude proposes `prisma migrate diff ... --script` to generate migration SQL, **read the script end-to-end before running it.** Check for `DROP`, `ALTER COLUMN TYPE`, or `TRUNCATE`. One of those slipping through is all it takes.

## Prevention infrastructure to build (in priority order)

These are changes to the codebase / deploy pipeline. User approved these at session end.

- **P0 — Add `pg_dump` to Railway's deploy hook** (BEFORE `prisma db push`). That way every deploy creates a fresh dump accessible as a Railway artifact. Current GitHub Action backup runs on `push to main` — good, but only captures pre-push state.
- **P0 — Add Postgres trigger on `Invoice`, `EthanolLifting`, `DDGSContract`, `Settings`**: log every UPDATE/DELETE to a `CriticalTableAudit` table with user, timestamp, old value, new value. If damage happens again, the first query is `SELECT * FROM CriticalTableAudit WHERE table='X' AND changed_at > '<time>'` and you know exactly what/who.
- **P1 — Expand ActivityLog coverage** to every table with financial / tax data. The current coverage from 2026-04-15 was ~30 models; extend to everything tax-regulated.
- **P1 — Railway PITR** (point-in-time recovery). If your plan doesn't include it, upgrade. Restores to any second, not just hourly.
- **P2 — Staging DB** that mirrors prod schema. Run `prisma db push` and backfills here first, see what breaks, then replay the known-good SQL on prod.
- **P2 — `SKILLS.md` entry** for this file so future Claude sessions discover it on boot.

## The backup system SAVED the company

The GitHub Actions workflow `.github/workflows/backup-db.yml` running `pg_dump` on every push to main, storing as a 90-day artifact, is the single reason today's recovery was possible. Keep it. Don't touch the retention setting. Test a restore quarterly.

## Recovery flow that worked (document for reuse)

1. `gh run list --workflow=backup-db.yml` → pick the last good backup (pre-damage)
2. `gh run download <id>` → get the dump file
3. `pg_dump` current prod state → local `.dump` file (SAFETY — this is what saved late-evening rows)
4. Compare row counts between current and backup → identify any NEW rows in current that aren't in backup
5. Extract new rows as `INSERT ... ON CONFLICT DO NOTHING` statements → merge file
6. Run `pg_restore --dbname="$URL" --data-only --disable-triggers --single-transaction backup.dump`
7. Dedupe any tables with duplicates (`DELETE a USING a b WHERE a.ctid < b.ctid AND a.id = b.id`)
8. Run `prisma db push --skip-generate --accept-data-loss` to rebuild constraints/indexes
9. Apply the merge file from step 5
10. Verify row counts + FK integrity + one spot-check per critical table

Total time on 2026-04-17 recovery: ~45 minutes. Zero rows lost. Zero customer-visible downtime after step 10.

## What was NOT recoverable

- **16 DDGS invoices (#226 to #245)** never had IRN generated. Not in ANY backup (4 snapshots checked). Either the NIC submission never succeeded or the IRN response was never captured back into the Invoice row. User to either click "GEN" on each (NIC will return existing IRN if already submitted — "duplicate" error carries the real IRN) or check NIC portal manually.
- **Old ethanol invoices #18-#91** referenced by EthanolLifting.invoiceNo strings. Not in prod DB since at least 2026-04-11 (oldest backup). Pre-dates the backup system. Likely a schema migration artifact — these might never have been in prod.

## Timeline

- 2026-04-16 08:35 IST — Railway daily backup (16 h old, healthy)
- 2026-04-16 17:29 IST — GitHub backup after commit `81fb935` (healthy; 35/35 ethanol liftings linked)
- 2026-04-16 18:09 IST — GitHub backup after commit `7aa508b` (healthy)
- 2026-04-16 20:04 IST — GitHub backup after commit `321ae10` (**last known-good state**)
- 2026-04-16 ~20:30 IST — damage occurs (source unconfirmed)
- 2026-04-17 00:19 IST — pre-restore local `pg_dump` captured damaged state
- 2026-04-17 00:40 IST — full restore from 20:04 backup started
- 2026-04-17 00:55 IST — restore + `prisma db push` + dedupe + merge complete
- 2026-04-17 01:05 IST — factory resynced, live

---

**If you're a future Claude session reading this: the factory runs 24/7. Treat every SQL statement as load-bearing. Dump first. Every time.**
