/**
 * Replaces `app.use('/uploads', express.static(...))`.
 *
 * Strategy: tries the local volume FIRST (fast, free), falls back to the
 * neat-shelf S3 bucket if a file isn't on disk. This handles two cases
 * cleanly:
 *
 *   1. Steady state — every upload is dual-written (multer to disk +
 *      `mirrorToS3` middleware to bucket), so volume serve is the hot path.
 *   2. Disaster recovery — if the volume is wiped or replaced, missing
 *      files fall back to bucket without breaking any URLs. Operator runs
 *      `aws s3 sync` to repopulate the volume offline; this fallback keeps
 *      the app usable in the meantime.
 *
 * Auth: same posture as the old static mount — file URLs themselves carry
 * unguessable timestamp+random suffixes.
 */

import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { getS3Client, getS3Bucket } from '../shared/s3Storage';

const router = Router();
const VOLUME_ROOT = path.resolve(__dirname, '..', '..', 'uploads');

router.get('/*', async (req: Request, res: Response): Promise<void> => {
  const key = decodeURIComponent(req.path.replace(/^\/+/, ''));
  if (!key || key.includes('..')) {
    res.status(400).json({ error: 'Bad path' });
    return;
  }

  // 1) Local volume — primary
  const diskPath = path.join(VOLUME_ROOT, key);
  if (diskPath.startsWith(VOLUME_ROOT) && fs.existsSync(diskPath)) {
    const ct = mime.lookup(diskPath) || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.sendFile(diskPath);
    return;
  }

  // 2) S3 fallback — only hit when disk is missing the file
  try {
    const out = await getS3Client().send(new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }));
    if (out.ContentType) res.setHeader('Content-Type', out.ContentType);
    if (out.ContentLength) res.setHeader('Content-Length', String(out.ContentLength));
    if (out.LastModified) res.setHeader('Last-Modified', out.LastModified.toUTCString());
    if (out.ETag) res.setHeader('ETag', out.ETag);
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (out.Body instanceof Readable) {
      out.Body.pipe(res);
      return;
    }
    const buf = Buffer.from(await (out.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
    res.send(buf);
    return;
  } catch (err: unknown) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404 && status !== 403) {
      console.error('[uploadServe] S3 fetch error for', key, '-', (err as Error).message);
    }
  }

  res.status(404).json({ error: 'Not found' });
});

export default router;
