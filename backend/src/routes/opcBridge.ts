import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import { tgSendGroup } from '../services/telegramClient';
import { shouldAlarmForTag, TEMP_TAG_TO_FERMENTER } from '../services/fermenterPhaseDetector';

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
// ALARM TOGGLE — in-memory flag to enable/disable WhatsApp alarm notifications
// ==========================================================================
let alarmsEnabled = true;

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

    const exceeded = (hh != null && r.value >= hh) ? 'HH' : (ll != null && r.value <= ll) ? 'LL' : null;
    if (!exceeded) continue;

    // Phase-aware suppression for fermenter temp tags
    if (TEMP_TAG_TO_FERMENTER[r.tag]) {
      const phaseCheck = await shouldAlarmForTag(r.tag);
      if (!phaseCheck.alarm) {
        console.log(`[OPC] Alarm suppressed: ${name} ${r.value} but phase=${phaseCheck.phase} (${phaseCheck.confidence}, level=${phaseCheck.level}%)`);
        continue;
      }
      // Include phase info in alarm message
      const limit = exceeded === 'HH' ? hh : ll;
      alerts.push(`*${exceeded} ALARM* ${name}: ${r.value} (limit: ${limit})\nPhase: ${phaseCheck.phase} (${phaseCheck.confidence}) | Level: ${phaseCheck.level}%`);
      _lastAlarmSent[r.tag] = now;
    } else {
      const limit = exceeded === 'HH' ? hh : ll;
      alerts.push(`*${exceeded} ALARM* ${name}: ${r.value} (limit: ${limit})`);
      _lastAlarmSent[r.tag] = now;
    }
  }

  if (alerts.length > 0) {
    const prismaMain = (await import('../config/prisma')).default;
    const settings = await prismaMain.settings.findFirst();
    const groupChatId = (settings as any)?.telegramGroupChatId;
    if (groupChatId) {
      const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      const hh = ist.getUTCHours();
      const mm = String(ist.getUTCMinutes()).padStart(2, '0');
      const time = `${hh % 12 || 12}:${mm} ${hh >= 12 ? 'PM' : 'AM'}`;
      const msg = `⚠️ *OPC ALARM* (${time} IST)\n\n${alerts.join('\n')}`;
      await tgSendGroup(groupChatId, msg, 'opc-alarm');
      console.log(`[OPC] Sent ${alerts.length} alarm(s) to Telegram group`);
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

  // Upsert monitored tags if provided (non-blocking — don't fail the push if tag sync fails)
  if (tags && tags.length > 0) {
    try {
      for (const t of tags) {
        await opc.opcMonitoredTag.upsert({
          where: { tag: t.tag },
          create: { tag: t.tag, area: t.area, folder: t.folder, tagType: t.tagType, label: t.label || t.tag },
          update: { area: t.area, folder: t.folder, tagType: t.tagType, label: t.label || t.tag, active: true },
        });
      }
    } catch (tagErr) {
      console.error('[OPC] Tag upsert failed (schema columns may not be migrated):', (tagErr as Error).message);
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

  // Check alarms — compare readings against HH/LL limits (skip if disabled)
  if (alarmsEnabled) {
    checkAlarms(opc, readings).catch(err => console.error('[OPC] Alarm check failed:', err));
  }

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
// Includes alarm limits + pushToCloud flag so bridge knows what to monitor locally
router.get('/monitor/pull', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!checkPushKey(req, res)) return;
  const opc = getOpcPrisma();
  let tags: Array<Record<string, unknown>>;
  try {
    tags = await opc.opcMonitoredTag.findMany({
      where: { active: true },
      orderBy: { area: 'asc' },
      take: 500,
      select: { tag: true, area: true, folder: true, tagType: true, label: true, hhAlarm: true, llAlarm: true, pushToCloud: true },
    });
  } catch {
    // Fallback if pushToCloud column doesn't exist yet
    tags = await opc.opcMonitoredTag.findMany({
      where: { active: true },
      orderBy: { area: 'asc' },
      take: 500,
      select: { tag: true, area: true, folder: true, tagType: true, label: true },
    });
  }
  res.json({ tags, count: tags.length });
}));

// POST /api/opc/alarm-notify — Bridge sends alarm notification when threshold breached locally
const alarmNotifySchema = z.object({
  tag: z.string().min(1),
  label: z.string().default(''),
  value: z.number(),
  limit: z.number(),
  alarmType: z.enum(['HH', 'LL']),
  scannedAt: z.string().optional(),
});

router.post('/alarm-notify', validate(alarmNotifySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!checkPushKey(req, res)) return;
  const opc = getOpcPrisma();
  const { tag, label, value, limit, alarmType } = req.body;

  // Log alarm to OpcAlarmLog
  try {
    await opc.opcAlarmLog.create({
      data: { tag, label, value, limit, alarmType },
    });
  } catch {
    // Table may not exist in Prisma client yet — use raw SQL
    await opc.$executeRawUnsafe(
      `INSERT INTO "OpcAlarmLog" (id, tag, label, value, "limit", "alarmType", "sentAt") VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())`,
      tag, label, value, limit, alarmType
    );
  }

  // NOTE: Factory bridge only logs alarms here. All Telegram alerts are sent
  // from checkAlarms() in the /push handler with phase-aware suppression.
  // No duplicate alert sent from this endpoint.

  console.log(`[OPC] Alarm: ${alarmType} on ${tag} (${label}): ${value} vs limit ${limit}`);
  res.json({ ok: true, logged: true });
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

// GET /api/opc/bridge-health — Proxy to factory bridge's /health endpoint via Tailscale
router.get('/bridge-health', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const BRIDGE_URL = process.env.OPC_BRIDGE_URL || 'http://100.74.209.72:8099';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(`${BRIDGE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      res.json({ reachable: false, error: `Bridge returned ${resp.status}` });
      return;
    }
    const data = await resp.json() as Record<string, unknown>;
    res.json({ reachable: true, ...data });
  } catch (err) {
    res.json({ reachable: false, error: (err as Error).message });
  }
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

  try {
    const result = await opc.opcMonitoredTag.upsert({
      where: { tag },
      create: { tag, area, folder, tagType, label: label || tag, active: true },
      update: { area, folder, tagType, label: label || tag, active: true },
    });
    res.status(201).json({ ok: true, tag: result });
  } catch {
    // Fallback: new columns (description, hhAlarm, llAlarm) may not exist yet — use raw SQL
    await opc.$executeRawUnsafe(
      `INSERT INTO "OpcMonitoredTag" (id, tag, area, folder, "tagType", label, active, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, NOW(), NOW())
       ON CONFLICT (tag) DO UPDATE SET area = $2, folder = $3, "tagType" = $4, label = $5, active = true, "updatedAt" = NOW()`,
      tag, area, folder, tagType, label || tag
    );
    res.status(201).json({ ok: true, tag: { tag, area, folder, tagType, label: label || tag } });
  }
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
    } else if (prismaErr.code === 'P2022') {
      // Column doesn't exist yet — try update without new columns
      const safeData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (!['description', 'hhAlarm', 'llAlarm'].includes(k)) safeData[k] = v;
      }
      if (Object.keys(safeData).length > 0) {
        const result = await opc.opcMonitoredTag.update({ where: { tag }, data: safeData });
        res.json({ ok: true, tag: result, warning: 'Some columns not yet migrated — run prisma db push on OPC DB' });
      } else {
        res.status(503).json({ error: 'OPC database columns not yet migrated. HH/LL alarms and descriptions require a schema migration on the OPC database.' });
      }
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
// For <=6h: returns raw readings (~every 2 min) for sharp graphs
// For >6h: returns hourly aggregates (avg/min/max)
router.get('/history/:tag', asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const tag = req.params.tag;
  const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);
  const property = (req.query.property as string) || 'PV';
  const cutoff = new Date(Date.now() - hours * 3600 * 1000);

  if (hours <= 6) {
    // Raw readings for short ranges — much sharper graphs
    const raw = await opc.opcReading.findMany({
      where: { tag, property, scannedAt: { gte: cutoff } },
      orderBy: { scannedAt: 'asc' },
      take: 500,
      select: { scannedAt: true, value: true },
    });
    // Format to match hourly structure so frontend works with both
    const readings = raw.map((r: { scannedAt: Date; value: number }) => ({
      hour: r.scannedAt,
      avg: r.value,
      min: r.value,
      max: r.value,
      count: 1,
    }));
    res.json({ tag, property, hours, readings, count: readings.length, resolution: 'raw' });
  } else {
    // Hourly aggregates for longer ranges
    const readings = await opc.opcHourlyReading.findMany({
      where: { tag, property, hour: { gte: cutoff } },
      orderBy: { hour: 'asc' },
      take: 500,
      select: { hour: true, avg: true, min: true, max: true, count: true },
    });
    res.json({ tag, property, hours, readings, count: readings.length, resolution: 'hourly' });
  }
}));

// GET /api/opc/fermenter-phases — auto-detected fermenter phases from OPC data
router.get('/fermenter-phases', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const { getAllFermenterPhases } = await import('../services/fermenterPhaseDetector');
  const phases = await getAllFermenterPhases();
  res.json({ phases });
}));

// GET /api/opc/wash-summary — wash volume prepared per 9AM-9AM shift day
// Calculates from OPC hourly level readings: sum of all level increases × capacity
router.get('/wash-summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const FERM_CAPACITY_KL = 2300;
  const FERM_LEVEL_TAGS = ['LT130201', 'LT130202', 'LT130301', 'LT130302'];
  const PROPERTY = 'IO_VALUE';

  // 9 AM IST shift boundaries
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const istHour = ist.getUTCHours();

  // Most recent 9 AM IST boundary
  const currentShiftStart = new Date(ist);
  if (istHour < 9) {
    currentShiftStart.setUTCDate(currentShiftStart.getUTCDate() - 1);
  }
  currentShiftStart.setUTCHours(9, 0, 0, 0);
  const currentShiftStartUTC = new Date(currentShiftStart.getTime() - 5.5 * 3600 * 1000);

  // Previous completed shift: 9 AM day before → 9 AM today
  const prevShiftStartUTC = new Date(currentShiftStartUTC.getTime() - 24 * 3600 * 1000);

  // "today" = current running shift (9 AM → now)
  // "yesterday" = last completed shift (prev 9 AM → current 9 AM)
  const todayStartUTC = currentShiftStartUTC;
  const yesterdayStartUTC = prevShiftStartUTC;
  const yesterdayEndUTC = currentShiftStartUTC;

  async function calcWashForPeriod(startUTC: Date, endUTC: Date): Promise<{ totalWashKL: number; perFermenter: Record<string, number> }> {
    const perFermenter: Record<string, number> = {};
    let totalWashKL = 0;

    for (const tag of FERM_LEVEL_TAGS) {
      const readings = await opc.opcHourlyReading.findMany({
        where: { tag, property: PROPERTY, hour: { gte: startUTC, lt: endUTC } },
        orderBy: { hour: 'asc' },
        select: { hour: true, avg: true },
      });

      let washPct = 0;
      for (let i = 1; i < readings.length; i++) {
        const diff = readings[i].avg - readings[i - 1].avg;
        if (diff > 0.5) { // Only count increases >0.5% (filling, not noise)
          washPct += diff;
        }
      }

      const washKL = (washPct / 100) * FERM_CAPACITY_KL;
      perFermenter[tag] = Math.round(washKL);
      totalWashKL += washKL;
    }

    return { totalWashKL: Math.round(totalWashKL), perFermenter };
  }

  // Calculate wash fed to distillation from BW Flow (FE130701)
  // Flow is in M³/hr — each hourly reading avg × 1 hour = M³ fed that hour
  const BW_FLOW_TAG = 'FCV_140101'; // Distillation feed wash flow
  async function calcFeedWash(startUTC: Date, endUTC: Date): Promise<{ totalFeedKL: number; avgFlowRate: number; hours: number }> {
    // FCV tags are PID type — use PV property
    const readings = await opc.opcHourlyReading.findMany({
      where: { tag: BW_FLOW_TAG, property: 'PV', hour: { gte: startUTC, lt: endUTC } },
      orderBy: { hour: 'asc' },
      select: { avg: true },
    });
    if (readings.length === 0) return { totalFeedKL: 0, avgFlowRate: 0, hours: 0 };
    // Each hourly avg = flow rate in M³/hr for that hour → volume = avg × 1 hr
    const totalM3 = readings.reduce((sum: number, r: { avg: number }) => sum + r.avg, 0);
    const avgFlow = totalM3 / readings.length;
    return { totalFeedKL: Math.round(totalM3), avgFlowRate: Math.round(avgFlow * 10) / 10, hours: readings.length };
  }

  const endNowUTC = now;
  const [today, yesterday, todayFeed, yesterdayFeed] = await Promise.all([
    calcWashForPeriod(todayStartUTC, endNowUTC),
    calcWashForPeriod(yesterdayStartUTC, yesterdayEndUTC),
    calcFeedWash(todayStartUTC, endNowUTC),
    calcFeedWash(yesterdayStartUTC, yesterdayEndUTC),
  ]);

  const hoursIntoShift = Math.round((now.getTime() - todayStartUTC.getTime()) / 3600000 * 10) / 10;

  // Format 9 AM boundaries in IST for display
  const fmtIST = (d: Date) => {
    const i = new Date(d.getTime() + 5.5 * 3600 * 1000);
    return `${i.getUTCDate()}/${i.getUTCMonth() + 1} ${i.getUTCHours() % 12 || 12}:${String(i.getUTCMinutes()).padStart(2, '0')} ${i.getUTCHours() >= 12 ? 'PM' : 'AM'}`;
  };

  res.json({
    today: { ...today, feed: todayFeed, shiftStart: fmtIST(todayStartUTC), hoursIntoShift },
    yesterday: { ...yesterday, feed: yesterdayFeed, shiftStart: fmtIST(yesterdayStartUTC), shiftEnd: fmtIST(yesterdayEndUTC) },
  });
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

// ==========================================================================
// ALARM TOGGLE ENDPOINTS
// ==========================================================================

router.get('/alarms/status', asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ enabled: alarmsEnabled });
}));

router.post('/alarms/toggle', asyncHandler(async (_req: AuthRequest, res: Response) => {
  alarmsEnabled = !alarmsEnabled;
  console.log(`[OPC] Alarms ${alarmsEnabled ? 'ENABLED' : 'DISABLED'} via UI`);
  res.json({ enabled: alarmsEnabled });
}));

export default router;
