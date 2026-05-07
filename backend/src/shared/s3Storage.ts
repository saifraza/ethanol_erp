/**
 * S3 mirror helpers for the Railway "neat-shelf" bucket.
 *
 * Strategy: routes keep using `multer.diskStorage` (no refactor of disk I/O,
 * delete handlers, or file serving). Right after multer accepts an upload,
 * `mirrorToS3()` middleware reads the file from disk and PUTs it to the
 * bucket. Volume stays primary; bucket is a real-time mirror.
 *
 * Recovery if the volume is ever lost: rsync from the bucket back to a
 * fresh volume, then continue.
 *
 * Bucket env vars are auto-injected by Railway when neat-shelf is connected
 * to the web service:
 *   AWS_ENDPOINT_URL, AWS_S3_BUCKET_NAME, AWS_DEFAULT_REGION,
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';

let _client: S3Client | null = null;

function isConfigured(): boolean {
  return Boolean(
    process.env.AWS_ENDPOINT_URL &&
    process.env.AWS_S3_BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY,
  );
}

export function getS3Client(): S3Client {
  if (_client) return _client;
  if (!isConfigured()) {
    throw new Error('S3 misconfigured: AWS_ENDPOINT_URL/AWS_S3_BUCKET_NAME/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY required');
  }
  _client = new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL,
    region: process.env.AWS_DEFAULT_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: false,
  });
  return _client;
}

export function getS3Bucket(): string {
  if (!process.env.AWS_S3_BUCKET_NAME) throw new Error('AWS_S3_BUCKET_NAME missing');
  return process.env.AWS_S3_BUCKET_NAME;
}

export async function s3KeyExists(key: string): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: getS3Bucket(), Key: key }));
    return true;
  } catch (err: unknown) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function getFromS3(key: string): Promise<{ body: Uint8Array; contentType?: string; lastModified?: Date; etag?: string } | null> {
  if (!isConfigured()) return null;
  try {
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }));
    const body = await (out.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return {
      body,
      contentType: out.ContentType,
      lastModified: out.LastModified,
      etag: out.ETag,
    };
  } catch (err: unknown) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || status === 403) return null;
    throw err;
  }
}

export async function deleteFromS3(key: string): Promise<void> {
  if (!isConfigured()) return;
  await getS3Client().send(new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: key }));
}

export async function putToS3(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void> {
  if (!isConfigured()) return;
  await getS3Client().send(new PutObjectCommand({
    Bucket: getS3Bucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

/**
 * Express middleware: after `multer.single(...)` or `multer.array(...)` has
 * accepted the upload(s) and written them to disk under `backend/uploads/`,
 * mirror the file(s) to the S3 bucket using `<folder>/<filename>` as the key
 * (matches the pre-existing volume layout).
 *
 * Best-effort: a mirror failure logs but does NOT fail the request. The
 * nightly upload-backup job (`uploadBackupJob.ts`) acts as a backstop.
 *
 * Usage:
 *   router.post('/x', upload.single('file'), mirrorToS3('company-documents'), asyncHandler(...))
 */
export function mirrorToS3(folder: string) {
  return async function mirror(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!isConfigured()) return next();
    try {
      const files: Express.Multer.File[] = [];
      const r = req as Request & { file?: Express.Multer.File; files?: Express.Multer.File[] | { [field: string]: Express.Multer.File[] } };
      if (r.file) files.push(r.file);
      if (Array.isArray(r.files)) files.push(...r.files);
      else if (r.files && typeof r.files === 'object') {
        for (const arr of Object.values(r.files)) files.push(...arr);
      }
      // Mirror each file. Don't await sequentially — fire all in parallel,
      // but catch errors so a single failure doesn't reject the lot.
      await Promise.all(files.map(async (f) => {
        try {
          const body = await fs.readFile(f.path);
          const key = `${folder}/${f.filename}`;
          await putToS3(key, body, f.mimetype);
        } catch (err) {
          console.error(`[mirrorToS3] Failed mirror of ${f.filename} → ${folder}:`, (err as Error).message);
        }
      }));
    } catch (err) {
      console.error('[mirrorToS3] middleware error:', (err as Error).message);
    }
    next();
  };
}
