/**
 * Upload Backup Job — mirrors backend/uploads/ to the Railway "neat-shelf" bucket.
 *
 * Runs once daily at 2 AM IST. Uses S3 ListObjectsV2 to fetch the bucket's
 * existing keys (one paginated listing), then walks the local volume and
 * PUTs only the files that aren't in the bucket. Idempotent: re-running on
 * the same day is a no-op once the volume has been mirrored.
 *
 * Recovery: `aws s3 sync s3://<bucket>/ /app/backend/uploads/` brings every
 * file back to a fresh volume.
 *
 * Bucket env vars are auto-injected by Railway when neat-shelf is connected
 * to the web service:
 *   AWS_ENDPOINT_URL, AWS_S3_BUCKET_NAME, AWS_DEFAULT_REGION,
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 */

import fs from 'fs/promises';
import path from 'path';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const CHECK_INTERVAL_MS = 60 * 1000;       // poll every 60s for the IST hour trigger
const INITIAL_DELAY_MS = 5 * 60 * 1000;    // wait 5 min after boot before first check
const TARGET_HOUR_IST = 2;                  // run at 2 AM IST

let jobInterval: NodeJS.Timeout | null = null;
let lastRunDate = '';                       // YYYY-MM-DD IST — prevents duplicate runs same day

function nowIST(): Date {
  const utc = Date.now();
  return new Date(utc + 5.5 * 60 * 60 * 1000);
}

function istDateStr(d?: Date): string {
  const ist = d || nowIST();
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

function bucketEnvReady(): boolean {
  return Boolean(
    process.env.AWS_ENDPOINT_URL &&
    process.env.AWS_S3_BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY,
  );
}

function makeClient(): S3Client {
  return new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL,
    region: process.env.AWS_DEFAULT_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: false, // Tigris/T3 wants virtual-hosted-style URLs
  });
}

async function listExistingKeys(client: S3Client, bucket: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    for (const obj of res.Contents || []) {
      if (obj.Key) keys.add(obj.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function* walkFiles(dir: string, base: string = dir): AsyncGenerator<{ absPath: string; key: string }> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(abs, base);
    } else if (entry.isFile()) {
      yield { absPath: abs, key: path.relative(base, abs).split(path.sep).join('/') };
    }
  }
}

export interface BackupRunSummary {
  uploaded: number;
  skipped: number;
  failed: number;
  bytesUploaded: number;
}

export async function runUploadBackup(): Promise<BackupRunSummary> {
  if (!bucketEnvReady()) {
    throw new Error('Bucket env vars missing (AWS_ENDPOINT_URL / AWS_S3_BUCKET_NAME / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');
  }

  const client = makeClient();
  const bucket = process.env.AWS_S3_BUCKET_NAME!;
  const summary: BackupRunSummary = { uploaded: 0, skipped: 0, failed: 0, bytesUploaded: 0 };

  const existing = await listExistingKeys(client, bucket);
  console.log(`[UploadBackup] Bucket has ${existing.size} existing object(s); walking ${UPLOADS_DIR}…`);

  for await (const { absPath, key } of walkFiles(UPLOADS_DIR)) {
    if (existing.has(key)) {
      summary.skipped++;
      continue;
    }
    try {
      const body = await fs.readFile(absPath);
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
      }));
      summary.uploaded++;
      summary.bytesUploaded += body.length;
    } catch (err: unknown) {
      summary.failed++;
      console.error(`[UploadBackup] Failed ${key}:`, (err as Error).message);
    }
  }

  console.log(
    `[UploadBackup] Done — uploaded=${summary.uploaded}, skipped=${summary.skipped}, failed=${summary.failed}, ` +
    `bytes=${(summary.bytesUploaded / 1024 / 1024).toFixed(2)} MB`,
  );
  return summary;
}

async function checkAndRun(): Promise<void> {
  try {
    const ist = nowIST();
    const istHour = ist.getUTCHours();
    const todayStr = istDateStr(ist);

    if (istHour !== TARGET_HOUR_IST || lastRunDate === todayStr) return;

    console.log(`[UploadBackup] ${TARGET_HOUR_IST}AM IST trigger — starting daily backup…`);
    await runUploadBackup();
    lastRunDate = todayStr; // set after success so failure allows retry next minute
  } catch (err) {
    console.error('[UploadBackup] Run failed:', (err as Error).message);
  }
}

export function startUploadBackupJob(): void {
  if (jobInterval) return;
  if (!bucketEnvReady()) {
    console.log('[UploadBackup] Bucket env vars not configured — backup job disabled');
    return;
  }
  setTimeout(() => {
    checkAndRun().catch(() => {});
    jobInterval = setInterval(() => {
      checkAndRun().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log(`[UploadBackup] Started (checks every 60s for ${TARGET_HOUR_IST}AM IST trigger, first check in 5 min)`);
}
