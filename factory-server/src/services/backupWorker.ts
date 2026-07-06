/**
 * Local DB backup worker — hourly pg_dump of the factory Postgres.
 *
 * Why this exists: the old scripts/backup-local-db.bat wrote 3 rolling dumps
 * to C:\mspil\backups on the SAME disk as the database, with a committed
 * superuser password and silent failure. If the disk died, every copy died
 * with it. This worker is now the PRIMARY backup mechanism (the .bat remains
 * as belt-and-braces):
 *
 *   1. Hourly plain-SQL pg_dump, gzipped, to BACKUP_DIR
 *   2. Retention: 48 newest hourly + newest-per-day for 30 days
 *   3. Plausibility checks (min size + <50% of previous dump alerts)
 *   4. OPTIONAL S3-compatible offsite upload (BACKUP_S3_* env vars)
 *
 * NO new tables — status is in-memory only, exposed via /api/health so the
 * cloud watchdog / an admin glance catches a dead backup chain.
 *
 * Env:
 *   BACKUP_ENABLED     default true ("false" disables the worker)
 *   BACKUP_DIR         default C:\mspil\backups (win32) / <cwd>/db-backups
 *   BACKUP_MIN_BYTES   plausibility floor, default 10240 (10 KB gzipped)
 *   PG_DUMP_PATH       explicit pg_dump binary; else probe Program Files
 *                      PostgreSQL 17/16/15, else bare "pg_dump" on PATH
 *   DATABASE_URL       credentials source — password goes to pg_dump via
 *                      PGPASSWORD env, NEVER argv (visible in Task Manager)
 *   BACKUP_S3_ENDPOINT / BACKUP_S3_BUCKET / BACKUP_S3_ACCESS_KEY /
 *   BACKUP_S3_SECRET_KEY   all four set = offsite upload enabled
 *   BACKUP_S3_REGION   optional, default "auto"
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

const HOUR_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000; // let the server finish starting
const HOURLY_KEEP = 48;
const DAILY_KEEP = 30;
const FILE_PREFIX = 'factory_db_';
const FILE_SUFFIX = '.sql.gz';
const LOG_KEEP = 50;

interface LayerStatus {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

const _status = {
  enabled: false,
  backupDir: '',
  pgDumpPath: '',
  s3Configured: false,
  lastRunAt: null as string | null,
  dump: {
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    lastFile: null as string | null,
    lastSizeBytes: null as number | null,
  } as LayerStatus & { lastFile: string | null; lastSizeBytes: number | null },
  s3: { lastSuccessAt: null, lastFailureAt: null, lastError: null } as LayerStatus,
  retention: { hourlyKept: 0, dailyKept: 0, deletedLastRun: 0 },
  log: [] as string[],
};

let _timer: ReturnType<typeof setTimeout> | null = null;
let _runInFlight = false;

function logLine(msg: string): void {
  console.log(`[BACKUP] ${msg}`);
  _status.log.push(`${new Date().toISOString()} ${msg}`);
  if (_status.log.length > LOG_KEEP) _status.log.splice(0, _status.log.length - LOG_KEEP);
}

function defaultBackupDir(): string {
  return process.env.BACKUP_DIR
    || (process.platform === 'win32' ? 'C:\\mspil\\backups' : path.join(process.cwd(), 'db-backups'));
}

/** Resolve the pg_dump binary: env override → Program Files probe → PATH. */
function resolvePgDump(): string {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  if (process.platform === 'win32') {
    for (const v of ['17', '16', '15']) {
      const candidate = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`;
      try { if (fs.existsSync(candidate)) return candidate; } catch { /* probe only */ }
    }
  }
  return 'pg_dump';
}

interface DbConn { host: string; port: string; user: string; password: string; database: string }

/** Parse DATABASE_URL — the password is passed to pg_dump via PGPASSWORD env only. */
function parseDatabaseUrl(): DbConn {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL not set — cannot run pg_dump');
  const u = new URL(raw);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: (u.pathname || '').replace(/^\//, '').split('?')[0] || 'postgres',
  };
}

function s3Configured(): boolean {
  return Boolean(
    process.env.BACKUP_S3_ENDPOINT
    && process.env.BACKUP_S3_BUCKET
    && process.env.BACKUP_S3_ACCESS_KEY
    && process.env.BACKUP_S3_SECRET_KEY,
  );
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

/** Timestamp for filenames: factory_db_YYYY-MM-DD_HHmmss.sql.gz (server local time). */
function fileStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const STAMP_RE = /^factory_db_(\d{4}-\d{2}-\d{2})_(\d{6})\.sql\.gz$/;

/** Parse a backup filename's timestamp. Returns sortable string or null. */
function parseStamp(name: string): { day: string; sortKey: string } | null {
  const m = STAMP_RE.exec(name);
  if (!m) return null;
  return { day: m[1], sortKey: `${m[1]}_${m[2]}` };
}

/** Run pg_dump | gzip → BACKUP_DIR/<file>. Returns { fileName, sizeBytes }. */
async function runPgDump(conn: DbConn, backupDir: string): Promise<{ fileName: string; filePath: string; sizeBytes: number }> {
  fs.mkdirSync(backupDir, { recursive: true });
  const fileName = `${FILE_PREFIX}${fileStamp(new Date())}${FILE_SUFFIX}`;
  const filePath = path.join(backupDir, fileName);
  const tmpPath = `${filePath}.tmp`;

  const child = spawn(
    _status.pgDumpPath,
    ['-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', conn.database, '--format=plain', '--no-owner', '--no-privileges'],
    {
      // Password via PGPASSWORD env — never argv (argv is world-readable in Task Manager / ps)
      env: { ...process.env, PGPASSWORD: conn.password },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stderrBuf = '';
  child.stderr.on('data', (d: Buffer) => { stderrBuf += d.toString(); });

  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject); // spawn failure (ENOENT etc.)
    child.on('close', code => resolve(code ?? -1));
  });

  try {
    await pipeline(child.stdout, zlib.createGzip({ level: 6 }), fs.createWriteStream(tmpPath));
    const code = await exited;
    if (code !== 0) {
      throw new Error(`pg_dump exited ${code}: ${stderrBuf.slice(0, 300)}`);
    }
    const sizeBytes = fs.statSync(tmpPath).size;
    fs.renameSync(tmpPath, filePath); // atomic-ish: partial dumps never keep the real name
    return { fileName, filePath, sizeBytes };
  } catch (err) {
    try { child.kill(); } catch { /* already dead */ }
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Retention: keep the 48 newest files (hourly tier) untouched — NEVER delete
 * below that. For files older than the hourly window, keep the newest file
 * per calendar day for the 30 most recent days; delete the rest.
 */
function rotateBackups(backupDir: string): void {
  const files = fs.readdirSync(backupDir)
    .map(name => ({ name, stamp: parseStamp(name) }))
    .filter((f): f is { name: string; stamp: { day: string; sortKey: string } } => f.stamp !== null)
    .sort((a, b) => b.stamp.sortKey.localeCompare(a.stamp.sortKey)); // newest first

  const hourly = files.slice(0, HOURLY_KEEP);
  const older = files.slice(HOURLY_KEEP);

  const keep = new Set<string>(hourly.map(f => f.name));
  const daysKept = new Set<string>();
  for (const f of older) { // newest first → first file seen per day is that day's newest
    if (!daysKept.has(f.stamp.day) && daysKept.size < DAILY_KEEP) {
      daysKept.add(f.stamp.day);
      keep.add(f.name);
    }
  }

  let deleted = 0;
  for (const f of older) {
    if (keep.has(f.name)) continue;
    try {
      fs.unlinkSync(path.join(backupDir, f.name));
      deleted++;
    } catch (err) {
      logLine(`rotation: failed to delete ${f.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  _status.retention = { hourlyKept: hourly.length, dailyKept: daysKept.size, deletedLastRun: deleted };
  if (deleted > 0) logLine(`rotation: deleted ${deleted} old backup(s), kept ${hourly.length} hourly + ${daysKept.size} daily`);
}

/** Streamed upload to S3-compatible storage. Key: mspil-ethanol/db/<yyyy-MM-dd>/<file>. */
async function uploadToS3(filePath: string, fileName: string): Promise<void> {
  // Dynamic import — the AWS SDK only loads when offsite backup is configured.
  const { S3Client } = await import('@aws-sdk/client-s3');
  const { Upload } = await import('@aws-sdk/lib-storage');

  const client = new S3Client({
    endpoint: process.env.BACKUP_S3_ENDPOINT,
    region: process.env.BACKUP_S3_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.BACKUP_S3_ACCESS_KEY as string,
      secretAccessKey: process.env.BACKUP_S3_SECRET_KEY as string,
    },
    forcePathStyle: true, // MinIO/R2-friendly
  });

  const day = fileName.slice(FILE_PREFIX.length, FILE_PREFIX.length + 10); // yyyy-MM-dd from the filename
  const upload = new Upload({
    client,
    params: {
      Bucket: process.env.BACKUP_S3_BUCKET as string,
      Key: `mspil-ethanol/db/${day}/${fileName}`,
      Body: fs.createReadStream(filePath),
      ContentType: 'application/gzip',
    },
  });
  await upload.done();
  client.destroy();
}

/** One full backup tick: dump → plausibility → rotate → optional S3. Never throws. */
async function backupTick(): Promise<void> {
  if (_runInFlight) return;
  _runInFlight = true;
  _status.lastRunAt = new Date().toISOString();
  try {
    const conn = parseDatabaseUrl();
    const prevSize = _status.dump.lastSizeBytes;
    const { fileName, filePath, sizeBytes } = await runPgDump(conn, _status.backupDir);

    // Plausibility: a suspiciously small dump means a broken/empty backup even
    // though pg_dump exited 0 (e.g. wrong DB, connection cut mid-stream).
    const minBytes = parseInt(process.env.BACKUP_MIN_BYTES || '10240', 10);
    let plausibilityError: string | null = null;
    if (sizeBytes < minBytes) {
      plausibilityError = `dump ${fileName} is only ${sizeBytes} bytes (< min ${minBytes}) — treat as FAILED`;
    } else if (prevSize != null && sizeBytes < prevSize * 0.5) {
      plausibilityError = `dump ${fileName} is ${sizeBytes} bytes — <50% of previous (${prevSize}) — investigate`;
    }

    if (plausibilityError) {
      // Keep the file for forensics, but surface the failure loudly.
      _status.dump.lastFailureAt = new Date().toISOString();
      _status.dump.lastError = plausibilityError;
      logLine(`PLAUSIBILITY ALERT: ${plausibilityError}`);
    } else {
      _status.dump.lastSuccessAt = new Date().toISOString();
      _status.dump.lastError = null;
      logLine(`dump OK ${fileName} (${Math.round(sizeBytes / 1024)} KB)`);
    }
    _status.dump.lastFile = fileName;
    _status.dump.lastSizeBytes = sizeBytes;

    try {
      rotateBackups(_status.backupDir);
    } catch (err) {
      logLine(`rotation failed: ${err instanceof Error ? err.message : err}`);
    }

    if (_status.s3Configured) {
      try {
        await uploadToS3(filePath, fileName);
        _status.s3.lastSuccessAt = new Date().toISOString();
        _status.s3.lastError = null;
        logLine(`offsite OK s3://${process.env.BACKUP_S3_BUCKET}/mspil-ethanol/db/.../${fileName}`);
      } catch (err) {
        _status.s3.lastFailureAt = new Date().toISOString();
        _status.s3.lastError = err instanceof Error ? err.message : String(err);
        logLine(`offsite FAILED: ${_status.s3.lastError}`);
      }
    }
  } catch (err) {
    _status.dump.lastFailureAt = new Date().toISOString();
    _status.dump.lastError = err instanceof Error ? err.message : String(err);
    logLine(`dump FAILED: ${_status.dump.lastError}`);
  } finally {
    _runInFlight = false;
  }
}

/** Start the hourly backup loop. Gated on BACKUP_ENABLED (default true). */
export function startBackupWorker(): void {
  if (process.env.BACKUP_ENABLED === 'false') {
    console.log('[BACKUP] Disabled via BACKUP_ENABLED=false');
    return;
  }
  _status.enabled = true;
  _status.backupDir = defaultBackupDir();
  _status.pgDumpPath = resolvePgDump();
  _status.s3Configured = s3Configured();
  console.log(`[BACKUP] Hourly pg_dump → ${_status.backupDir} (pg_dump: ${_status.pgDumpPath}, offsite: ${_status.s3Configured ? 'S3 configured' : 'not configured'})`);

  const loop = async (): Promise<void> => {
    await backupTick(); // fully try/caught inside — the loop never dies
    _timer = setTimeout(loop, HOUR_MS);
  };
  _timer = setTimeout(loop, FIRST_RUN_DELAY_MS);
}

/** Stop the backup loop (tests / shutdown). */
export function stopBackupWorker(): void {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

/** Status for /api/health — lastSuccessAt/lastFailureAt/reason per layer. */
export function getBackupWorkerStatus() {
  return {
    enabled: _status.enabled,
    backupDir: _status.backupDir,
    pgDumpPath: _status.pgDumpPath,
    s3Configured: _status.s3Configured,
    lastRunAt: _status.lastRunAt,
    dump: _status.dump,
    s3: _status.s3,
    retention: _status.retention,
    recentLog: _status.log.slice(-10),
  };
}
