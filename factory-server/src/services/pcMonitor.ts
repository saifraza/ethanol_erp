import { config } from '../config';
import prisma from '../prisma';

interface FactoryPC {
  pcId: string;
  pcName: string;
  lanIp: string;
  port: number;
  role: string;
}

// Seed PCs — always present (even if they don't heartbeat)
const SEED_PCS: FactoryPC[] = [
  { pcId: 'weighbridge-1', pcName: 'Weighbridge Gate 1', lanIp: '192.168.0.83', port: 8098, role: 'WEIGHBRIDGE' },
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

// Dynamic PC registry — seed + auto-discovered PCs
const pcRegistry = new Map<string, FactoryPC>();

/** Register a PC (from heartbeat, wb-push, or seed list). Auto-discovers new PCs. */
export function registerPC(pc: { pcId: string; pcName?: string; lanIp?: string; port?: number; role?: string }): void {
  // Skip virtual sources (browser web UI, system processes)
  if (pc.pcId === 'web' || pc.pcId === 'system' || pc.pcId === 'system-weighbridge') return;
  const existing = pcRegistry.get(pc.pcId);
  pcRegistry.set(pc.pcId, {
    pcId: pc.pcId,
    pcName: pc.pcName || existing?.pcName || pc.pcId,
    lanIp: pc.lanIp || existing?.lanIp || 'unknown',
    port: pc.port || existing?.port || 8098,
    role: pc.role || existing?.role || 'UNKNOWN',
  });
}

// Poll a single PC via its HTTP API
async function pollPC(pc: FactoryPC): Promise<void> {
  if (pc.lanIp === 'unknown') {
    // Can't poll unknown IP — just mark status from last heartbeat
    const existing = pcStatus.get(pc.pcId);
    if (existing) {
      // Mark stale if no heartbeat in 60s
      const age = Date.now() - existing.lastChecked.getTime();
      if (age > 60_000) existing.alive = false;
    }
    return;
  }

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

/** Called when a PC sends a heartbeat — auto-registers and marks alive */
export function handleHeartbeat(pcId: string, pcName?: string, lanIp?: string, port?: number, role?: string, data?: Record<string, unknown>): void {
  registerPC({ pcId, pcName, lanIp, port, role });
  const pc = pcRegistry.get(pcId)!;
  pcStatus.set(pcId, {
    pcId: pc.pcId,
    pcName: pc.pcName,
    role: pc.role,
    lanIp: pc.lanIp,
    port: pc.port,
    alive: true,
    lastChecked: new Date(),
    data: data || pcStatus.get(pcId)?.data || null,
  });
}

// Poll all registered PCs
async function pollAllPCs(): Promise<void> {
  const allPCs = Array.from(pcRegistry.values());
  await Promise.allSettled(allPCs.map(pc => pollPC(pc)));
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

/**
 * Fetch the LIVE weight from a specific WB PC right now (not the 5s cached value).
 * Used by the rule engine at capture time for the SCALE_ZERO check — we need
 * sub-second freshness because the operator just pressed "Capture".
 *
 * Returns null if:
 *   - pcId not registered or IP unknown
 *   - HTTP request times out (1.5s)
 *   - response is not parseable
 *   - scale reports stale=true (no signal from indicator)
 *
 * The rule engine treats null as "scale unreachable, fail open". Better to
 * allow a capture than to block trucks because the network blipped.
 */
export async function fetchLiveWeight(pcId: string): Promise<number | null> {
  // 'web' = factory-server's own UI proxy. Use the cached map (which is
  // populated by pollAllPCs from any registered WB PC).
  if (pcId === 'web' || pcId === 'system' || pcId === 'system-weighbridge') {
    const wb = Array.from(pcStatus.values()).find(p => p.role === 'WEIGHBRIDGE' && p.alive);
    if (!wb || !wb.data) return null;
    const stale = !!(wb.data as Record<string, unknown>).stale;
    if (stale) return null;
    const w = parseFloat(String((wb.data as Record<string, unknown>).weight ?? ''));
    return Number.isFinite(w) ? w : null;
  }

  const pc = pcRegistry.get(pcId);
  if (!pc || pc.lanIp === 'unknown') return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://${pc.lanIp}:${pc.port}/api/weight`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    if (data.stale) return null;
    const w = parseFloat(String(data.weight ?? ''));
    return Number.isFinite(w) ? w : null;
  } catch {
    return null;
  }
}

// Get all PC statuses
export function getAllPCStatus(): PCHealthData[] {
  // Merge registry + status — ensure all registered PCs appear even if never polled
  const result: PCHealthData[] = [];
  for (const pc of pcRegistry.values()) {
    const status = pcStatus.get(pc.pcId);
    result.push(status || {
      pcId: pc.pcId,
      pcName: pc.pcName,
      role: pc.role,
      lanIp: pc.lanIp,
      port: pc.port,
      alive: false,
      lastChecked: new Date(0),
      data: null,
    });
  }
  return result;
}

// Start monitoring
export function startPCMonitor(): void {
  // Seed known PCs
  for (const pc of SEED_PCS) registerPC(pc);

  // Load any previously registered PCs from DB (weighments have pcId/pcName)
  prisma.weighment.groupBy({
    by: ['pcId', 'pcName'],
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: 20,
  }).then(groups => {
    for (const g of groups) {
      if (g.pcId && !pcRegistry.has(g.pcId)) {
        registerPC({ pcId: g.pcId, pcName: g.pcName || g.pcId });
      }
    }
  }).catch(() => {}); // best effort

  console.log(`[MONITOR] Monitoring ${pcRegistry.size} factory PCs (auto-discovers new PCs via heartbeat/push)`);

  // Poll immediately, then every 5 seconds
  pollAllPCs();
  setInterval(pollAllPCs, 5000);

  // Forward heartbeats to cloud every 30 seconds (offset by 15s)
  setTimeout(() => {
    forwardHeartbeatsToCloud();
    setInterval(forwardHeartbeatsToCloud, 5000);
  }, 15000);
}

// Export for backward compat
export const FACTORY_PCS = SEED_PCS;
