# Uploads + S3 Mirror — dual-write pattern, recovery, Storage Health

> Read first before adding a new multer upload route, touching `mirrorToS3`, or changing the `uploadServe` static-file path. Built 2026-05-08 (PRs #73, #74, #75) so the next Railway volume failure doesn't lose customer files.

## Goal

The Railway volume mounted at `/app/backend/uploads` is the **primary** store. The `neat-shelf` S3 bucket (Tigris/T3) is a **real-time mirror** for disaster recovery. Every file that lands on disk also lands in the bucket, with at most a few seconds of lag.

If the volume is ever lost: the bucket has every file, recovery is `aws s3 sync s3://neat-shelf-…/ /app/backend/uploads/`.

## The three pieces

| Piece | File | Role |
|---|---|---|
| Real-time mirror | `backend/src/shared/s3Storage.ts` — `mirrorToS3(folder)` middleware | Runs after multer accepts an upload. Reads `f.path` from disk and PUTs to `<folder>/<filename>` in the bucket. Best-effort — errors are logged, not thrown. |
| Nightly reconciliation | `backend/src/services/uploadBackupJob.ts` | At 2 AM IST, ListObjectsV2 the bucket, walk the volume, PUT only files missing in the bucket. Idempotent. |
| Disk → S3 fallback serve | `backend/src/routes/uploadServe.ts` | Replaces `express.static('/uploads')`. Tries volume first; on miss, streams from S3. Lets us serve files even if the volume hasn't been re-populated yet. |
| Admin dashboard | `frontend/src/pages/admin/StorageHealth.tsx` + `backend/src/routes/uploadBackupAdmin.ts` | Surface count + drift between disk and bucket. Manual "Re-check sync" runs the backup job on demand. |

## How to add a new upload route

```ts
import multer from 'multer';
import { mirrorToS3 } from '../shared/s3Storage';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, '/app/backend/uploads/<folder>'),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/upload', upload.single('file'), mirrorToS3('<folder>'), asyncHandler(async (req, res) => {
  // req.file is on disk. mirrorToS3 has already pushed it to s3://neat-shelf/<folder>/<filename>.
  // Save the relative path (not the absolute one) on the DB row.
}));
```

The `<folder>` arg becomes the S3 key prefix. Existing folders:

- `company-documents/`, `contractor-bills/`, `grn-documents/`, `grain-truck/`, `store-grn/`, `project-quotations/`, `vendor-invoices/`, `bank-receipts/`, `iodine/`, `shipment-docs/`, `spent-loss/`, `document-classifier/`

Pick the closest existing folder before inventing a new one.

## Env (Railway auto-injects when neat-shelf is connected)

```
AWS_ENDPOINT_URL          # https://t3.storageapi.dev
AWS_S3_BUCKET_NAME        # neat-shelf-…
AWS_DEFAULT_REGION        # auto
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

`bucketEnvReady()` in `uploadBackupJob.ts` is the single place that gates whether mirroring runs. If env is incomplete the backup job logs and skips — doesn't crash the server.

## Recovery — if the volume is wiped

```bash
# 1. SSH into the new Railway service shell.
# 2. Configure aws cli with the same creds.
aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID"
aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY"
aws configure set default.region "$AWS_DEFAULT_REGION"

# 3. Pull every file back to the volume.
aws s3 sync --endpoint-url "$AWS_ENDPOINT_URL" s3://"$AWS_S3_BUCKET_NAME"/ /app/backend/uploads/
```

After sync the disk is whole. The serve route was already returning files via S3 fallback while you waited.

## Storage Health admin page

Route: `/admin/storage-health` (SUPER_ADMIN). Shows:

- On-disk count + bytes
- On-bucket count + bytes
- Drift (`missingOnBucket`, `extraOnBucket`)
- Last backup pass timestamp + summary (`uploaded / skipped / failed / bytesUploaded`)
- "Re-check sync" button — calls `POST /api/admin/backup-uploads/run-now` to push any stragglers immediately

Drift should always be ~0 in steady state. If it grows, suspect `mirrorToS3` failures — check Railway logs for `[s3-mirror]` lines.

## Don't

- Don't write files outside `/app/backend/uploads` — the mirror only watches that path.
- Don't `unlinkSync` an uploaded file before the response returns — `mirrorToS3` reads from disk after multer.
- Don't call `mirrorToS3` for endpoints that *delete* files. Keep the bucket as a one-way archive; nothing in our flow deletes from it. Extra files in the bucket are harmless.
- Don't change the relative path stored in the DB after a file is mirrored — the disk path and the bucket key share that path verbatim.

## When changing things

- Adding a new folder? Update the recovery doc above and verify `mirrorToS3('<folder>')` middleware is added on the route.
- Changing the bucket provider? `s3Storage.ts` uses AWS SDK v3 with `forcePathStyle: false`. Tigris/T3 wants virtual-hosted-style URLs. If you switch to a provider that needs path-style, flip the flag.
- Reading files? Always go through the `uploadServe` route or `getFromS3` helper — don't `fs.readFile` directly from route code, you'll skip the S3 fallback and serve a 404 if the volume is fresh.
