import { Router, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { runUploadBackupAndRecord, getLastRun } from '../services/uploadBackupJob';
import { getS3Client, getS3Bucket } from '../shared/s3Storage';

const router = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

async function* walkFiles(dir: string, base: string = dir): AsyncGenerator<{ key: string; size: number }> {
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
      const stat = await fs.stat(abs);
      yield { key: path.relative(base, abs).split(path.sep).join('/'), size: stat.size };
    }
  }
}

async function listAllBucketObjects(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const client = getS3Client();
  const bucket = getS3Bucket();
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const obj of res.Contents || []) {
      if (obj.Key) map.set(obj.Key, obj.Size ?? 0);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return map;
}

/**
 * POST /api/admin/backup-uploads/run-now
 *
 * Manually triggers a one-shot backup of /app/backend/uploads/ → bucket.
 * Used to seed the bucket immediately and to spot-check the mirror.
 */
router.post('/run-now', authenticate, authorize('SUPER_ADMIN'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const summary = await runUploadBackupAndRecord('manual');
  res.json({ ok: true, summary });
}));

/**
 * GET /api/admin/backup-uploads/health
 *
 * Storage health snapshot for the admin dashboard:
 *   - on-disk file count + total bytes (ground truth)
 *   - on-bucket file count + total bytes (mirror)
 *   - missing on bucket (volume → bucket drift; should be 0)
 *   - extra on bucket (bucket → volume drift; usually deleted-on-disk leftovers)
 *   - lastRun: { at, summary, source } from the most recent backup pass
 */
router.get('/health', authenticate, authorize('SUPER_ADMIN'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const onDisk: { count: number; bytes: number } = { count: 0, bytes: 0 };
  const diskKeys = new Set<string>();
  for await (const { key, size } of walkFiles(UPLOADS_DIR)) {
    onDisk.count++;
    onDisk.bytes += size;
    diskKeys.add(key);
  }

  let onBucket: { count: number; bytes: number } | null = null;
  let missingOnBucket = 0;
  let extraOnBucket = 0;
  let bucketError: string | null = null;
  try {
    const bucketMap = await listAllBucketObjects();
    onBucket = { count: bucketMap.size, bytes: 0 };
    for (const size of bucketMap.values()) onBucket.bytes += size;
    for (const k of diskKeys) if (!bucketMap.has(k)) missingOnBucket++;
    for (const k of bucketMap.keys()) if (!diskKeys.has(k)) extraOnBucket++;
  } catch (err) {
    bucketError = (err as Error).message;
  }

  const lastRun = getLastRun();

  res.json({
    onDisk,
    onBucket,
    missingOnBucket,
    extraOnBucket,
    inSync: bucketError ? null : missingOnBucket === 0,
    bucketError,
    lastRun,
    bucketEndpoint: process.env.AWS_ENDPOINT_URL || null,
    bucketName: process.env.AWS_S3_BUCKET_NAME || null,
  });
}));

export default router;
