import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import { waSendGroup } from '../services/whatsappClient';

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
// ALARM CHECKING — compare readings against HH/LL limits, WhatsApp alert
// ==========================================================================

// Track last alarm time per tag to avoid spamming (max once per 15 min)
const _lastAlarmSent: Record<string, number> = {};
const ALARM_COOLDOWN_MS = 15 * 60 * 1000;

async function checkAlarms(opc: any, readings: { tag: string; property: string; value: number }[]) {
  // Get tags with alarm limits set (skip if columns don't exist yet)
  let tagsWithAlarms: any[];
  try {
    tagsWithAlarms = await opc.opcMonitoredTag.findMany({
      where: { active: true, OR: [{ hhAlarm: { not: null } }, { llAlarm: { not: null } }] },
      select: { tag: true, label: true, description: true, hhAlarm: true, llAlarm: true },
    });
  } catch {
    return; // New columns not migrated yet
  }
  if (!tagsWithAlarms.length) return;

  const alarmMap = new Map(tagsWithAlarms.map((t: any) => [t.tag, t]));
  const alerts: string[] = [];
  const now = Date.now();

  for (const r of readings) {
    const tagAlarm = alarmMap.get(r.tag) as any;
    if (!tagAlarm) continue;

    // Cooldown check
    const lastSent = _lastAlarmSent[r.tag] || 0;
    if (now - lastSent < ALARM_COOLDOWN_MS) continue;

    const name = (tagAlarm.description || tagAlarm.label || r.tag) as string;
    const hh = tagAlarm.hhAlarm as number | null;
    const ll = tagAlarm.llAlarm as number | null;

    if (hh != null && r.value >= hh) {
      alerts.push(`*HH ALARM* ${name}: ${r.value} (limit: ${hh})`);
      _lastAlarmSent[r.tag] = now;
    } else if (ll != null && r.value <= ll) {
      alerts.push(`*LL ALARM* ${name}: ${r.value} (limit: ${ll})`);
      _lastAlarmSent[r.tag] = now;
    }
  }

  if (alerts.length > 0) {
    const prismaMain = (await import('../config/prisma')).default;
    const settings = await prismaMain.settings.findFirst();
    const groupJid = (settings as any)?.whatsappGroupJid;
    if (groupJid) {
      const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      const time = ist.toISOString().slice(11, 19);
      const msg = `⚠️ *OPC ALARM* (${time} IST)\n\n${alerts.join('\n')}`;
      await waSendGroup(groupJid, msg, 'opc-alarm');
      console.log(`[OPC] Sent ${alerts.length} alarm(s) to WhatsApp group`);
    }
  }
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

  // Check alarms — compare readings against HH/LL limits
  checkAlarms(opc, readings).catch(err => console.error('[OPC] Alarm check failed:', err));

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
  // Use lastSync (server receive time) for online check — lastScan is factory clock time which may drift
  const syncRef = lastSync || lastScan;
  const online = syncRef ? (Date.now() - new Date(syncRef).getTime()) < 5 * 60 * 1000 : false;

  res.json({ status: 'ok', online, monitoredTags: monitoredCount, lastScan, lastSync });
}));

// GET /api/opc/monitor — List monitored tags
router.get('/monitor', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  let tags: any[];
  try {
    tags = await opc.opcMonitoredTag.findMany({
      where: { active: true }, orderBy: { area: 'asc' }, take: 500,
      select: { id: true, tag: true, area: true, folder: true, tagType: true, label: true, description: true, hhAlarm: true, llAlarm: true, active: true },
    });
  } catch {
    tags = await opc.opcMonitoredTag.findMany({
      where: { active: true }, orderBy: { area: 'asc' }, take: 500,
      select: { id: true, tag: true, area: true, folder: true, tagType: true, label: true, active: true },
    });
  }
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

// PATCH /api/opc/monitor/:tag — Update tag properties
const updateMonitorSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  area: z.string().min(1).optional(),
  folder: z.string().min(1).optional(),
  tagType: z.string().optional(),
  hhAlarm: z.number().nullable().optional(),
  llAlarm: z.number().nullable().optional(),
});

router.patch('/monitor/:tag', validate(updateMonitorSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const tag = req.params.tag;
  const data: Record<string, unknown> = {};
  if (req.body.label !== undefined) data.label = req.body.label;
  if (req.body.description !== undefined) data.description = req.body.description;
  if (req.body.area) data.area = req.body.area;
  if (req.body.folder) data.folder = req.body.folder;
  if (req.body.tagType) data.tagType = req.body.tagType;
  if (req.body.hhAlarm !== undefined) data.hhAlarm = req.body.hhAlarm;
  if (req.body.llAlarm !== undefined) data.llAlarm = req.body.llAlarm;

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  try {
    const result = await opc.opcMonitoredTag.update({ where: { tag }, data });
    res.json({ ok: true, tag: result });
  } catch (err: unknown) {
    const prismaErr = err as { code?: string };
    if (prismaErr.code === 'P2025') {
      res.status(404).json({ error: `Tag '${tag}' not found` });
    } else {
      throw err;
    }
  }
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
  let tags: any[];
  try {
    tags = await opc.opcMonitoredTag.findMany({
      where: { active: true },
      take: 500,
      select: { tag: true, area: true, folder: true, tagType: true, label: true, description: true, hhAlarm: true, llAlarm: true },
    });
  } catch {
    // Fallback if new columns don't exist yet (pre-migration)
    tags = await opc.opcMonitoredTag.findMany({
      where: { active: true },
      take: 500,
      select: { tag: true, area: true, folder: true, tagType: true, label: true },
    });
  }

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
      description: t.description || '',
      hhAlarm: t.hhAlarm,
      llAlarm: t.llAlarm,
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
