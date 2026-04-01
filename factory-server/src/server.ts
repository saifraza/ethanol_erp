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
import { startPCMonitor, getAllPCStatus } from './services/pcMonitor';
import { startSyncWorker, getSyncWorkerStatus } from './services/syncWorker';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// No frontend — factory server is API-only
// All management done via cloud ERP (app.mspil.in)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'MSPIL Factory Hub',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pcs: getAllPCStatus(),
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

// LAN PC status endpoint — factory server polls all PCs
app.get('/api/factory-pcs', (_req, res) => {
  res.json(getAllPCStatus());
});

// Redirect any browser visit to weighbridge UI (the operator interface)
app.get('/', (_req, res) => {
  res.redirect('http://192.168.0.83:8098');
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
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

  // Send factory server's own heartbeat to cloud
  sendHeartbeatToCloud();
  setInterval(sendHeartbeatToCloud, 15000);
});
