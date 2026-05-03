import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import { config } from './config';
import weighbridgeRoutes from './routes/weighbridge';
import gateEntryRoutes from './routes/gateEntry';
import heartbeatRoutes from './routes/heartbeat';
import masterDataRoutes from './routes/masterData';
import syncRoutes from './routes/sync';
import authRoutes from './routes/auth';
import cloudProxyRoutes from './routes/cloudProxy';
import settingsRoutes from './routes/settings';
import washTotalizerRoutes from './routes/washTotalizer';
import farmersRoutes from './routes/farmers';
import { startPCMonitor, getAllPCStatus } from './services/pcMonitor';
import { getCameraStatus } from './services/cameraCapture';
import { startSyncWorker, getSyncWorkerStatus } from './services/syncWorker';
import { initMasterDataCache, getCacheStats } from './services/masterDataCache';
import { startWeightTriggeredCapture } from './services/weightTriggeredCapture';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve React frontend from factory-server/public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve camera snapshots
app.use('/snapshots', express.static(path.join(__dirname, '..', 'data', 'snapshots')));

// Health check
app.get('/api/health', async (_req, res) => {
  const cameras = await getCameraStatus().catch(() => []);
  res.json({
    status: 'ok',
    server: 'MSPIL Factory Hub',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pcs: getAllPCStatus(),
    cameras,
    sync: getSyncWorkerStatus(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/weighbridge', weighbridgeRoutes);
app.use('/api/gate-entry', gateEntryRoutes);
app.use('/api/heartbeat', heartbeatRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/cloud', cloudProxyRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/wash-totalizer', washTotalizerRoutes);
app.use('/api/farmers', farmersRoutes);

// LAN PC status endpoint — factory server polls all PCs
app.get('/api/factory-pcs', (_req, res) => {
  res.json(getAllPCStatus());
});

// Scale weight proxy — frontend polls this instead of cross-origin to weighbridge PC
app.get('/api/scale/weight', (_req, res) => {
  const pcs = getAllPCStatus();
  const wb = pcs.find(p => p.role === 'WEIGHBRIDGE');
  if (!wb || !wb.data) return res.json({ connected: false, stable: false, weight: 0, frozen: false });
  res.json(wb.data);
});

// SPA fallback — any non-API route serves the React frontend
app.get('*', (_req, res) => {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      // Frontend not built yet — show helpful message
      res.status(200).send(`
        <h2>MSPIL Factory Hub</h2>
        <p>Frontend not built. Run: <code>cd factory-server/frontend && npm run build</code></p>
        <p><a href="/api/health">API Health Check</a></p>
      `);
    }
  });
});

// ── Error Handler ───────────────────────────────────────────────────────────
// This is the last line of defense. Three jobs:
//   1. Always log the FULL error (stack, message, all metadata) to stdout so
//      run.bat captures it in logs/server-*.log. Never swallow detail.
//   2. Surface ACTIONABLE messages to the operator. "Internal server error"
//      is useless — "PO #61 is closed" or "vehicle already inside the gate"
//      lets the operator fix the problem without calling the developer.
//   3. Classify Prisma errors specifically. These are the #1 cause of factory
//      outages (gate entry 2026-04-08, ethanol sync 2026-04-07) and every
//      minute of operator confusion costs trucks at the gate.
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const route = `${req.method} ${req.path}`;

  // ALWAYS log the full error — this is what makes incidents debuggable later.
  console.error(`[ERROR] ${route}:`, err.message);
  if (err.stack) console.error(err.stack);

  // Try to classify the error and give the operator something useful.
  const errName = err.constructor?.name || '';
  const errMsg = err.message || '';

  // ── Prisma: field/argument mismatch (schema drift) ───────────────────────
  // Signature: "Unknown argument `foo`" or "Unknown field `foo`"
  // Cause: deployed code writes a field the Prisma client doesn't know about.
  // Fix: `npx prisma generate` + restart (see factory-incidents-postmortem.md).
  // We tell the operator it's a server problem, not their fault.
  if (/Unknown argument|Unknown field/.test(errMsg)) {
    const field = errMsg.match(/`([^`]+)`/)?.[1] || 'unknown';
    res.status(500).json({
      error: 'server_schema_drift',
      message: `Server has a schema mismatch (field: ${field}). This is a deployment bug, not your input. Please call support.`,
      field,
      route,
    });
    return;
  }

  // ── Prisma: unique constraint violation ──────────────────────────────────
  // Signature: "Unique constraint failed on the fields: (`foo`)"
  // Operator cause: submitting a duplicate (vehicle already inside, ticket
  // number conflict, localId collision). Tell them what's duplicate.
  if (errName.includes('PrismaClientKnownRequestError') && /P2002|Unique constraint/.test(errMsg)) {
    const field = errMsg.match(/fields: \(`([^`]+)`\)/)?.[1] || 'value';
    res.status(409).json({
      error: 'duplicate',
      message: `This ${field} already exists. Check if the vehicle or ticket is already in the system.`,
      field,
      route,
    });
    return;
  }

  // ── Prisma: foreign key violation ────────────────────────────────────────
  // Signature: "Foreign key constraint failed" (P2003)
  // Operator cause: picking a PO / material / supplier that no longer exists
  // (deleted or not yet synced from cloud).
  if (errName.includes('PrismaClientKnownRequestError') && /P2003|Foreign key/.test(errMsg)) {
    res.status(400).json({
      error: 'invalid_reference',
      message: 'The PO, supplier, or material you picked is no longer valid. Refresh the page and try again.',
      route,
    });
    return;
  }

  // ── Prisma: record not found ─────────────────────────────────────────────
  // Signature: P2025 "Record to update not found"
  if (errName.includes('PrismaClientKnownRequestError') && /P2025/.test(errMsg)) {
    res.status(404).json({
      error: 'not_found',
      message: 'The record you tried to update no longer exists. Refresh and try again.',
      route,
    });
    return;
  }

  // ── Prisma: initialization / connection error ───────────────────────────
  // Signature: PrismaClientInitializationError — DB connection failed.
  if (errName.includes('PrismaClientInitializationError')) {
    res.status(503).json({
      error: 'db_unreachable',
      message: 'Database is unreachable. This is a server problem — please wait 30 seconds and try again, or call support if it persists.',
      route,
    });
    return;
  }

  // ── Prisma: validation error (bad input type) ────────────────────────────
  if (errName.includes('PrismaClientValidationError')) {
    res.status(400).json({
      error: 'bad_input',
      message: 'Invalid data sent to server. Check that all required fields are filled and numbers are not empty.',
      route,
      detail: errMsg.split('\n')[0], // first line only, no stack
    });
    return;
  }

  // ── HTTP errors thrown by our own code (AppError pattern) ───────────────
  // If someone threw with a .status property, honor it.
  const status = (err as Error & { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 600) {
    res.status(status).json({
      error: errName || 'error',
      message: errMsg,
      route,
    });
    return;
  }

  // ── Generic fallback ─────────────────────────────────────────────────────
  // Last resort — still better than the old "Internal server error". Include
  // the error class name so a quick glance at the browser console tells the
  // developer what kind of failure it was without needing to SSH into the PC.
  res.status(500).json({
    error: 'server_error',
    message: 'Something went wrong on the server. Please try again or call support.',
    errorClass: errName || 'Error',
    route,
  });
});

// Send factory server's own heartbeat to cloud ERP
async function sendHeartbeatToCloud() {
  try {
    await fetch(`${config.cloudErpUrl}/weighbridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WB-Key': config.cloudApiKey },
      body: JSON.stringify({
        pcId: 'factory-server',
        pcName: 'Factory Server (Central Hub)',
        uptimeSeconds: Math.round(process.uptime()),
        queueDepth: 0,
        dbSizeMb: 0,
        serialProtocol: 'PostgreSQL',
        webPort: config.port,
        tailscaleIp: '100.126.101.7',
        version: '1.0.0',
        system: {
          cpuPercent: Math.round(os.loadavg()[0] * 100) / 100,
          memoryMb: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
          diskFreeGb: 0, // TODO: add disk check
          hostname: 'WIN-PBMJ9RMTO6L',
          os: `Windows Server 2019 (${os.totalmem() > 0 ? Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB RAM' : ''})`,
        },
      }),
    });
  } catch (err) {
    console.error('[HEARTBEAT] Cloud send failed:', err instanceof Error ? err.message : err);
  }
}

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Factory Hub running on http://0.0.0.0:${config.port}`);
  console.log(`Cloud ERP: ${config.cloudErpUrl}`);

  // Start LAN PC monitoring (polls all PCs, forwards heartbeats to cloud)
  startPCMonitor();

  // Start background sync worker (push weighments to cloud + pull master data)
  startSyncWorker();

  // Initialize in-memory master data cache (load from disk, then 5s cloud sync)
  initMasterDataCache().catch(err => console.error('[CACHE] Init failed:', err));

  // Weight-triggered video/photo capture for ML training corpus.
  // PAUSED 2026-05-03 — corpus is sufficient (38.6 GB / 51k clips on factory disk).
  // Operational gross/tare snapshots in routes/weighbridge.ts are unaffected.
  // Re-enable by uncommenting; existing data on factory disk is intact.
  // startWeightTriggeredCapture();
  void startWeightTriggeredCapture; // keep import live to avoid TS unused-import error

  // Send factory server's own heartbeat to cloud
  sendHeartbeatToCloud();
  setInterval(sendHeartbeatToCloud, 15000);
});
