import { config } from '../config';

interface FactoryPC {
  pcId: string;
  pcName: string;
  lanIp: string;
  port: number;
  role: string;
}

// Registry of all factory PCs — add new PCs here
const FACTORY_PCS: FactoryPC[] = [
  { pcId: 'weighbridge-1', pcName: 'Weighbridge Gate 1', lanIp: '192.168.0.83', port: 8098, role: 'WEIGHBRIDGE' },
  // { pcId: 'gate-entry-1', pcName: 'Gate Entry 1', lanIp: '192.168.0.xx', port: 8098, role: 'GATE_ENTRY' },
  // { pcId: 'opc-bridge', pcName: 'Lab Computer (OPC)', lanIp: '192.168.0.xx', port: 8099, role: 'LAB' },
];

interface PCHealthData {
  pcId: string;
  pcName: string;
  role: string;
  lanIp: string;
  port: number;
  alive: boolean;
  lastChecked: Date;
  data: Record<string, unknown> | null;
}

const pcStatus = new Map<string, PCHealthData>();

// Poll a single PC via its HTTP API
async function pollPC(pc: FactoryPC): Promise<void> {
  const url = `http://${pc.lanIp}:${pc.port}/api/weight`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json() as Record<string, unknown>;

    pcStatus.set(pc.pcId, {
      pcId: pc.pcId,
      pcName: pc.pcName,
      role: pc.role,
      lanIp: pc.lanIp,
      port: pc.port,
      alive: true,
      lastChecked: new Date(),
      data,
    });
  } catch {
    const existing = pcStatus.get(pc.pcId);
    pcStatus.set(pc.pcId, {
      pcId: pc.pcId,
      pcName: pc.pcName,
      role: pc.role,
      lanIp: pc.lanIp,
      port: pc.port,
      alive: false,
      lastChecked: new Date(),
      data: existing?.data || null,
    });
  }
}

// Poll all PCs
async function pollAllPCs(): Promise<void> {
  await Promise.allSettled(FACTORY_PCS.map(pc => pollPC(pc)));
}

// Forward heartbeats to cloud ERP
async function forwardHeartbeatsToCloud(): Promise<void> {
  for (const [, status] of pcStatus) {
    if (!status.alive) continue;
    try {
      await fetch(`${config.cloudErpUrl}/weighbridge/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WB-Key': config.cloudApiKey },
        body: JSON.stringify({
          pcId: status.pcId,
          pcName: status.pcName,
          uptimeSeconds: 0,
          queueDepth: 0,
          dbSizeMb: 0,
          serialProtocol: status.data && 'connected' in status.data ? 'file' : 'unknown',
          webPort: status.port,
          tailscaleIp: status.lanIp,
          localUrl: `http://${status.lanIp}:${status.port}`,
          version: '1.0.0',
          system: { hostname: status.pcName },
        }),
      });
    } catch (err) {
      console.error(`[MONITOR] Failed to forward heartbeat for ${status.pcId}:`, err instanceof Error ? err.message : err);
    }
  }
}

// Get all PC statuses
export function getAllPCStatus(): PCHealthData[] {
  return Array.from(pcStatus.values());
}

// Start monitoring
export function startPCMonitor(): void {
  console.log(`[MONITOR] Monitoring ${FACTORY_PCS.length} factory PCs on LAN`);

  // Poll immediately, then every 30 seconds
  pollAllPCs();
  setInterval(pollAllPCs, 5000);

  // Forward heartbeats to cloud every 30 seconds (offset by 15s)
  setTimeout(() => {
    forwardHeartbeatsToCloud();
    setInterval(forwardHeartbeatsToCloud, 5000);
  }, 15000);
}

export { FACTORY_PCS };
