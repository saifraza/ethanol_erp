import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

// OPC Bridge Windows API (Tailscale IP)
const OPC_BASE = process.env.OPC_BRIDGE_URL || 'http://100.74.209.72:8099';

/**
 * Proxy requests to the on-premise OPC Bridge service.
 * The ERP cloud server talks to the factory Windows machine via Tailscale VPN.
 */
async function opcFetch(path: string, options?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${OPC_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      throw new Error((data.error as string) || `OPC API returned ${res.status}`);
    }
    return data;
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        throw new Error('OPC Bridge timeout — factory service may be offline');
      }
      // Network errors (ECONNREFUSED, EHOSTUNREACH, etc.)
      const msg = err.message || '';
      if (msg.includes('ECONNREFUSED') || msg.includes('EHOSTUNREACH') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
        throw new Error('Cannot reach factory OPC Bridge — check VPN/network connection');
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// GET /api/opc/health — Check if OPC bridge is reachable
router.get('/health', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await opcFetch('/health');
  res.json(data);
}));

// GET /api/opc/browse — List all OPC areas
router.get('/browse', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await opcFetch('/browse');
  // Deduplicate folder names (OPC returns duplicates)
  if (data.areas) {
    data.areas = data.areas.map((a: any) => ({
      ...a,
      folders: [...new Set(a.folders as string[])],
    }));
  }
  res.json(data);
}));

// GET /api/opc/browse/:area — List folders in an area
router.get('/browse/:area', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await opcFetch(`/browse/${encodeURIComponent(req.params.area)}`);
  res.json(data);
}));

// GET /api/opc/browse/:area/:folder — List tags in a folder
router.get('/browse/:area/:folder', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { area, folder } = req.params;
  const data = await opcFetch(`/browse/${encodeURIComponent(area)}/${encodeURIComponent(folder)}`);
  // Deduplicate tags
  if (data.tags) {
    const seen = new Set<string>();
    data.tags = data.tags.filter((t: any) => {
      if (seen.has(t.tag)) return false;
      seen.add(t.tag);
      return true;
    });
    data.count = data.tags.length;
  }
  res.json(data);
}));

// GET /api/opc/read/:tag — Read a single tag live
router.get('/read/:tag', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { tag } = req.params;
  const area = req.query.area as string || '';
  const folder = req.query.folder as string || '';
  const data = await opcFetch(`/read/${encodeURIComponent(tag)}?area=${encodeURIComponent(area)}&folder=${encodeURIComponent(folder)}`);
  res.json(data);
}));

// GET /api/opc/monitor — List monitored tags
router.get('/monitor', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await opcFetch('/monitor');
  res.json(data);
}));

// POST /api/opc/monitor — Add tag to watch list
router.post('/monitor', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await opcFetch('/monitor', {
    method: 'POST',
    body: JSON.stringify(req.body),
  });
  res.status(201).json(data);
}));

// DELETE /api/opc/monitor/:tag — Remove tag from watch list
router.delete('/monitor/:tag', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await opcFetch(`/monitor/${encodeURIComponent(req.params.tag)}`, {
    method: 'DELETE',
  });
  res.json(data);
}));

// GET /api/opc/live — Latest values for all monitored tags
router.get('/live', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await opcFetch('/live');
  res.json(data);
}));

// GET /api/opc/live/:tag — Latest value for one tag
router.get('/live/:tag', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await opcFetch(`/live/${encodeURIComponent(req.params.tag)}`);
  res.json(data);
}));

// GET /api/opc/stats — DB statistics
router.get('/stats', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await opcFetch('/stats');
  res.json(data);
}));

export default router;
