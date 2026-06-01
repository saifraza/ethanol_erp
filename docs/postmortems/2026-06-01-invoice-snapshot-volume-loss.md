# Incident — 2026-06-01: 145 invoice snapshots orphaned by the Railway migration

> **Migration checklist:** any time the `web` service moves Railway projects, the
> **invoice-snapshot volume must move with it.** Snapshots are legal, tamper-evident
> copies of e-invoiced documents — losing the files (while the DB still references them)
> silently breaks invoice immutability.

## What happened

The daily *Invoice Snapshot Audit* GitHub Action (`.github/workflows/snapshot-audit.yml`)
was failing — but on a **config error**, not the real problem: the repo had no
`BACKFILL_KEY` secret, so the job exited on line 1 before ever calling the audit endpoint.
That masked an actual integrity issue.

Once the secret was set and the audit ran, it reported **290 findings = 145 invoices ×
(`json_missing` + `pdf_missing`)**. Of 227 invoices the DB believed were frozen
(`snapshotAt IS NOT NULL`), only 82 still had their files on disk; **145 had snapshot
metadata + SHAs recorded in Postgres but the physical files were gone** (`ENOENT`).

| | Before | After |
|---|---|---|
| Snapshots checked | 227 | 227 |
| OK (file present, SHA matches) | 82 | **227** |
| Missing files | **145** (#1–25, #171–305) | 0 |
| Workflow result | ❌ exit 1 | ✅ exit 0 |

The missing set was the early block (#1–25) and the most-recent block (#171–305); the
contiguous middle (#26–170) survived — consistent with batches frozen at different times,
only some of which landed on the volume that was carried forward.

## Root cause

Invoice snapshots are written to `RAILWAY_VOLUME_MOUNT_PATH/invoice-snapshots`
(= `/app/backend/uploads/invoice-snapshots`, the `web-volume`). There is an *ephemeral*
fallback to `public/snapshots` (`invoiceSnapshot.ts`, `SNAPSHOT_DIR` resolution) that does
**not** survive redeploys.

The [2026-05-07 Railway migration](2026-04-16-db-damage.md) (fresh project, DB restored,
domain moved) **did not carry the snapshot files** onto the new `web-volume`. The DB rows
— including `snapshotPdfPath` / `snapshotPdfSha` / `snapshotAt` — restored fine and kept
pointing at files that no longer existed. The read path degrades gracefully (snapshot
missing → live re-render), so nothing broke visibly for users; the only signal was the
audit, which was itself silenced by the missing `BACKFILL_KEY` secret.

## Resolution (2026-06-01)

1. **Set the audit secret.** `BACKFILL_KEY` repo secret = the password segment of the prod
   `DATABASE_URL` (that's what the endpoint checks — `invoices.ts` `snapshot-audit-key` /
   `backfill-snapshots-key`). Pulled from `railway variables`, verified against the live
   endpoint (HTTP 200), set via `gh secret set`.
2. **Re-froze the 145.** `POST /api/invoices/admin/backfill-snapshots-key?force=true&invoiceNos=…`
   in batches of 40 (sequential Puppeteer renders → keep each request under the gateway
   timeout). `force=true` is required because these rows already had `snapshotAt` set.
   Result: 145 matched, 145 re-frozen, 0 failed. Re-rendering is safe — the legal invoice
   (IRN / ackNo / signed QR / amounts) is immutable in the DB and on the NIC portal; the
   snapshot is only a rendering of it, and the originals were already gone.
3. **Verified.** Re-ran the audit: `Total: 227 | OK: 227 | Issues: 0` ✅. Because the
   `web-volume` is persistent, the re-frozen files will survive future redeploys.

## Prevention / action items

- [ ] **Migration runbook:** add "rsync/copy `/app/backend/uploads/invoice-snapshots` to the
      new volume and confirm `auditAllSnapshots` is clean" as a required step before cutting
      DNS over. Same applies to anything else under the `uploads` volume.
- [x] `BACKFILL_KEY` secret set so the daily 08:00 IST audit actually runs and can page us.
- [ ] Consider mirroring snapshots to the S3 bucket (already attached for upload backups) so
      a lost volume is recoverable from object storage, not only by re-rendering from DB.
- [ ] Minor: `actions/upload-artifact@v4` runs on Node 20 — GitHub force-migrates to Node 24
      on 2026-06-16. Bump on the next workflow touch-up.

## Lesson

A safety net that's been silently failing on a *config* error is worse than no safety net —
it reads as "all clear." When an alert has been red for a while, fix the alert first, then
believe what it tells you. Here the missing secret hid a real 145-document integrity gap for
≈3 weeks.
