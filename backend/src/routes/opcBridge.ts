import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';

const router = Router();

// Lazy-load OPC Prisma client (only when DATABASE_URL_OPC is set)
let _opcPrisma: any = null;
function getOpcPrisma() {
  if (!_opcPrisma) {
    if (!process.env.DATABASE_URL_OPC) {
      throw new Error('DATABASE_URL_OPC not configured — OPC module disabled');
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/opc-client');
    _opcPrisma = new PrismaClient();
  }
  return _opcPrisma;
}

// Shared API key for Windows service to push data
const OPC_PUSH_KEY = process.env.OPC_PUSH_KEY || 'mspil-opc-2026';

function checkPushKey(req: AuthRequest, res: Response): boolean {
  const key = req.headers['x-opc-key'] as string;
  if (key !== OPC_PUSH_KEY) {
    res.status(401).json({ error: 'Invalid OPC push key' });
    return false;
  }
  return true;
}

// ==========================================================================
// PUSH endpoints — called by Windows service (no JWT auth, uses API key)
// ==========================================================================

const pushReadingsSchema = z.object({
  readings: z.array(z.object({
    tag: z.string(),
    property: z.string(),
    value: z.number(),
    scannedAt: z.string(),
  })),
  tags: z.array(z.object({
    tag: z.string(),
    area: z.string(),
    folder: z.string(),
    tagType: z.string(),
    label: z.string().optional(),
  })).optional(),
});

// POST /api/opc/push — Windows pushes scan readings + tag list
router.post('/push', validate(pushReadingsSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!checkPushKey(req, res)) return;
  const opc = getOpcPrisma();
  const { readings, tags } = req.body;

  // Upsert monitored tags if provided
  if (tags && tags.length > 0) {
    for (const t of tags) {
      await opc.opcMonitoredTag.upsert({
        where: { tag: t.tag },
        create: { tag: t.tag, area: t.area, folder: t.folder, tagType: t.tagType, label: t.label || t.tag },
        update: { area: t.area, folder: t.folder, tagType: t.tagType, label: t.label || t.tag, active: true },
      });
    }
  }

  // Insert readings
  if (readings.length > 0) {
    await opc.opcReading.createMany({
      data: readings.map((r: { tag: string; property: string; value: number; scannedAt: string }) => ({
        tag: r.tag,
        property: r.property,
        value: r.value,
        scannedAt: new Date(r.scannedAt),
      })),
    });
  }

  // Log sync
  await opc.opcSyncLog.create({
    data: { syncType: 'readings', tagCount: tags?.length || 0, readingCount: readings.length },
  });

  res.json({ ok: true, received: readings.length });
}));

const pushHourlySchema = z.object({
  hourly: z.array(z.object({
    tag: z.string(),
    property: z.string(),
    hour: z.string(),
    avg: z.number(),
    min: z.number(),
    max: z.number(),
    count: z.number(),
  })),
});

// POST /api/opc/push-hourly — Windows pushes hourly aggregates
router.post('/push-hourly', validate(pushHourlySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!checkPushKey(req, res)) return;
  const opc = getOpcPrisma();
  const { hourly } = req.body;

  for (const h of hourly) {
    await opc.opcHourlyReading.upsert({
      where: { tag_property_hour: { tag: h.tag, property: h.property, hour: new Date(h.hour) } },
      create: { tag: h.tag, property: h.property, hour: new Date(h.hour), avg: h.avg, min: h.min, max: h.max, count: h.count },
      update: { avg: h.avg, min: h.min, max: h.max, count: h.count },
    });
  }

  await opc.opcSyncLog.create({
    data: { syncType: 'hourly', readingCount: hourly.length },
  });

  res.json({ ok: true, received: hourly.length });
}));

// ==========================================================================
// TAG PULL endpoint — called by Windows service to get master tag list
// Uses X-OPC-Key auth (same as push)
// ==========================================================================

// GET /api/opc/monitor/pull — Factory pulls tag list from cloud (cloud-as-master)
router.get('/monitor/pull', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!checkPushKey(req, res)) return;
  const opc = getOpcPrisma();
  const tags = await opc.opcMonitoredTag.findMany({
    where: { active: true },
    orderBy: { area: 'asc' },
    take: 500,
    select: { tag: true, area: true, folder: true, tagType: true, label: true },
  });
  res.json({ tags, count: tags.length });
}));

// ==========================================================================
// READ endpoints — called by ERP frontend (requires JWT auth)
// ==========================================================================

// GET /api/opc/health
router.get('/health', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const [monitoredCount, latestReading, latestSync] = await Promise.all([
    opc.opcMonitoredTag.count({ where: { active: true } }),
    opc.opcReading.findFirst({ orderBy: { scannedAt: 'desc' }, select: { scannedAt: true } }),
    opc.opcSyncLog.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true, readingCount: true } }),
  ]);

  const lastScan = latestReading?.scannedAt || null;
  const lastSync = latestSync?.syncedAt || null;
  const online = lastScan ? (Date.now() - new Date(lastScan).getTime()) < 5 * 60 * 1000 : false;

  res.json({ status: 'ok', online, monitoredTags: monitoredCount, lastScan, lastSync });
}));

// GET /api/opc/monitor — List monitored tags
router.get('/monitor', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const tags = await opc.opcMonitoredTag.findMany({
    where: { active: true },
    orderBy: { area: 'asc' },
    take: 500,
  });
  res.json({ tags, count: tags.length });
}));

// POST /api/opc/monitor — Add tag to monitor (from ERP UI)
const addMonitorSchema = z.object({
  tag: z.string().min(1),
  area: z.string().min(1),
  folder: z.string().min(1),
  tagType: z.string().default('analog'),
  label: z.string().optional(),
});

router.post('/monitor', validate(addMonitorSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const { tag, area, folder, tagType, label } = req.body;

  const result = await opc.opcMonitoredTag.upsert({
    where: { tag },
    create: { tag, area, folder, tagType, label: label || tag, active: true },
    update: { area, folder, tagType, label: label || tag, active: true },
  });

  res.status(201).json({ ok: true, tag: result });
}));

// DELETE /api/opc/monitor/:tag — Remove tag from monitoring (soft-delete: set active=false)
router.delete('/monitor/:tag', asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const tag = req.params.tag;

  try {
    await opc.opcMonitoredTag.update({
      where: { tag },
      data: { active: false },
    });
    res.json({ ok: true, message: `Stopped monitoring ${tag}` });
  } catch (err: unknown) {
    const prismaErr = err as { code?: string };
    if (prismaErr.code === 'P2025') {
      res.status(404).json({ error: `Tag '${tag}' not found` });
    } else {
      throw err;
    }
  }
}));

// GET /api/opc/live — Latest readings for all monitored tags
router.get('/live', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const tags = await opc.opcMonitoredTag.findMany({ where: { active: true }, take: 500 });

  const result = [];
  for (const t of tags) {
    const readings = await opc.opcReading.findMany({
      where: { tag: t.tag },
      orderBy: { scannedAt: 'desc' },
      take: 10,
      select: { property: true, value: true, scannedAt: true },
    });

    const values: Record<string, number> = {};
    const seen = new Set<string>();
    let updatedAt: Date | null = null;
    for (const r of readings) {
      if (!seen.has(r.property)) {
        seen.add(r.property);
        values[r.property] = r.value;
        if (!updatedAt) updatedAt = r.scannedAt;
      }
    }

    result.push({
      tag: t.tag,
      area: t.area,
      type: t.tagType,
      label: t.label,
      updatedAt: updatedAt?.toISOString() || null,
      values,
    });
  }

  res.json({ tags: result, count: result.length });
}));

// GET /api/opc/live/:tag — Latest readings for one tag
router.get('/live/:tag', asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const tag = req.params.tag;

  const readings = await opc.opcReading.findMany({
    where: { tag },
    orderBy: { scannedAt: 'desc' },
    take: 20,
    select: { property: true, value: true, scannedAt: true },
  });

  if (readings.length === 0) {
    res.status(404).json({ error: `No data for tag '${tag}'` });
    return;
  }

  const values: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of readings) {
    if (!seen.has(r.property)) {
      seen.add(r.property);
      values[r.property] = r.value;
    }
  }

  res.json({ tag, updatedAt: readings[0].scannedAt, values });
}));

// GET /api/opc/history/:tag?hours=24&property=PV
router.get('/history/:tag', asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const tag = req.params.tag;
  const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);
  const property = (req.query.property as string) || 'PV';
  const cutoff = new Date(Date.now() - hours * 3600 * 1000);

  const readings = await opc.opcHourlyReading.findMany({
    where: { tag, property, hour: { gte: cutoff } },
    orderBy: { hour: 'asc' },
    take: 500,
    select: { hour: true, avg: true, min: true, max: true, count: true },
  });

  res.json({ tag, property, hours, readings, count: readings.length });
}));

// GET /api/opc/stats
router.get('/stats', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const [tags, readings, hourly, syncs] = await Promise.all([
    opc.opcMonitoredTag.count({ where: { active: true } }),
    opc.opcReading.count(),
    opc.opcHourlyReading.count(),
    opc.opcSyncLog.count(),
  ]);
  res.json({ monitoredTags: tags, rawReadings: readings, hourlyReadings: hourly, totalSyncs: syncs });
}));

export default router;
