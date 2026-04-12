import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import crypto from 'crypto';
import { broadcastToGroup } from '../services/messagingGateway';
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
if (!process.env.OPC_PUSH_KEY) {
  console.warn('[OPC] WARNING: OPC_PUSH_KEY env var not set — using hardcoded default. Set it in Railway for production.');
}

function checkPushKey(req: AuthRequest, res: Response): boolean {
  const key = req.headers['x-opc-key'] as string;
  if (!key || key.length !== OPC_PUSH_KEY.length) {
    res.status(401).json({ error: 'Invalid OPC push key' });
    return false;
  }
  // Timing-safe comparison to prevent key leakage via timing attacks
  const keyBuf = Buffer.from(key, 'utf8');
  const expectedBuf = Buffer.from(OPC_PUSH_KEY, 'utf8');
  if (!crypto.timingSafeEqual(keyBuf, expectedBuf)) {
    res.status(401).json({ error: 'Invalid OPC push key' });
    return false;
  }
  return true;
}

// ==========================================================================
// ALARM TOGGLE — persisted to Settings table (survives deploys)
// ==========================================================================
let alarmsEnabled = true;
let _alarmsLoaded = false;

async function loadAlarmState(): Promise<void> {
  if (_alarmsLoaded) return;
  try {
    const prismaMain = (await import('../config/prisma')).default;
    const settings = await prismaMain.settings.findFirst();
    // Use telegramEnabled field as alarm toggle (true = alarms on)
    if (settings && (settings as any).opcAlarmsEnabled !== undefined) {
      alarmsEnabled = (settings as any).opcAlarmsEnabled;
    }
    _alarmsLoaded = true;
  } catch { /* first run, use default */ }
}

async function saveAlarmState(): Promise<void> {
  try {
    const prismaMain = (await import('../config/prisma')).default;
    const settings = await prismaMain.settings.findFirst();
    if (settings) {
      await prismaMain.settings.update({
        where: { id: settings.id },
        data: { opcAlarmsEnabled: alarmsEnabled } as any,
      });
    }
  } catch { /* ignore */ }
}

// Load on first use
loadAlarmState().catch(() => {});

// ==========================================================================
// ALARM CHECKING — compare readings against HH/LL limits, WhatsApp alert
// ==========================================================================

// Track last alarm time per tag to avoid spamming (max once per 15 min)
const _lastAlarmSent: Record<string, number> = {};
const ALARM_COOLDOWN_MS = 15 * 60 * 1000;

async function checkAlarms(opc: any, readings: { tag: string; property: string; value: number }[], source: string = 'ETHANOL') {
  // Get tags with alarm limits set — FILTERED BY SOURCE to prevent cross-plant alarm triggers
  let tagsWithAlarms: any[];
  try {
    tagsWithAlarms = await opc.opcMonitoredTag.findMany({
      where: { active: true, source, OR: [{ hhAlarm: { not: null } }, { llAlarm: { not: null } }] },
      select: { tag: true, label: true, description: true, hhAlarm: true, llAlarm: true, tagType: true, source: true },
    });
  } catch {
    return; // New columns not migrated yet
  }
  if (!tagsWithAlarms.length) return;

  const alarmMap = new Map(tagsWithAlarms.map((t: any) => [t.tag, t]));
  const alerts: string[] = [];
  const now = Date.now();

  // Only check alarm-relevant properties per tag type:
  // - PID tags: check PV (process variable)
  // - Analog tags: check IO_VALUE
  // - Totalizer tags: SKIP (PRV_HR/CURRENT are cumulative, not alarm-comparable)
  const ALARM_PROPERTIES: Record<string, string[]> = {
    pid: ['PV'],
    analog: ['IO_VALUE'],
    totalizer: [], // never alarm on totalizer values
  };

  for (const r of readings) {
    const tagAlarm = alarmMap.get(r.tag) as any;
    if (!tagAlarm) continue;

    // Filter by property — only check alarm-relevant properties for this tag type
    const tagType = (tagAlarm.tagType || 'analog') as string;
    const allowedProps = ALARM_PROPERTIES[tagType] || ['PV', 'IO_VALUE'];
    if (allowedProps.length > 0 && !allowedProps.includes(r.property)) continue;

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
      await broadcastToGroup(groupChatId, msg, 'opc-alarm');
      console.log(`[OPC] Sent ${alerts.length} alarm(s) to Telegram group`);
    }
  }
}

// ==========================================================================
// PUSH endpoints — called by Windows service (no JWT auth, uses API key)
// ==========================================================================

const pushReadingsSchema = z.object({
  source: z.enum(['ETHANOL', 'SUGAR']).optional().default('ETHANOL'),
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
  const { readings, tags, source } = req.body;
  const src = source || 'ETHANOL';

  // Upsert monitored tags if provided (non-blocking — don't fail the push if tag sync fails)
  if (tags && tags.length > 0) {
    try {
      for (const t of tags) {
        // Don't reactivate tags that were manually removed (active=false)
        const existing = await opc.opcMonitoredTag.findUnique({ where: { tag: t.tag }, select: { active: true } });
        if (existing && !existing.active) continue; // Skip — user removed this tag

        await opc.opcMonitoredTag.upsert({
          where: { tag: t.tag },
          create: { tag: t.tag, area: t.area, folder: t.folder, tagType: t.tagType, label: t.label || t.tag, source: src },
          update: { area: t.area, folder: t.folder, tagType: t.tagType, label: t.label || t.tag, source: src },
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
        source: src,
        scannedAt: new Date(r.scannedAt),
      })),
    });
  }

  // Log sync
  await opc.opcSyncLog.create({
    data: { syncType: 'readings', tagCount: tags?.length || 0, readingCount: readings.length, batchId: src },
  });

  // Check alarms — compare readings against HH/LL limits (skip if disabled)
  // Pass source so sugar readings don't trigger ethanol alarm rules
  await loadAlarmState();
  if (alarmsEnabled) {
    checkAlarms(opc, readings, src).catch(err => console.error('[OPC] Alarm check failed:', err));
  }

  res.json({ ok: true, received: readings.length });
}));

const pushHourlySchema = z.object({
  source: z.enum(['ETHANOL', 'SUGAR']).optional().default('ETHANOL'),
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
  const { hourly, source } = req.body;
  const src = source || 'ETHANOL';

  for (const h of hourly) {
    await opc.opcHourlyReading.upsert({
      where: { tag_property_hour_source: { tag: h.tag, property: h.property, hour: new Date(h.hour), source: src } },
      create: { tag: h.tag, property: h.property, hour: new Date(h.hour), source: src, avg: h.avg, min: h.min, max: h.max, count: h.count },
      update: { avg: h.avg, min: h.min, max: h.max, count: h.count },
    });
  }

  await opc.opcSyncLog.create({
    data: { syncType: 'hourly', readingCount: hourly.length, batchId: src },
  });

  res.json({ ok: true, received: hourly.length });
}));

// ==========================================================================
// TAG PULL endpoint — called by Windows service to get master tag list
// Uses X-OPC-Key auth (same as push)
// ==========================================================================

// GET /api/opc/monitor/pull — Factory pulls tag list from cloud (cloud-as-master)
// Includes alarm limits + pushToCloud flag so bridge knows what to monitor locally
// ?source=ETHANOL|SUGAR filters to that plant (default: ETHANOL for backwards compat)
router.get('/monitor/pull', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!checkPushKey(req, res)) return;
  const opc = getOpcPrisma();
  const source = (req.query.source as string) || 'ETHANOL';

  // One-time fix: Evap_ANALOG → ANALOG (wrong folder name from UI catalog)
  try {
    await opc.opcMonitoredTag.updateMany({
      where: { area: 'Evaporation', folder: 'Evap_ANALOG' },
      data: { folder: 'ANALOG' },
    });
  } catch { /* ignore if already fixed */ }

  let tags: Array<Record<string, unknown>>;
  try {
    tags = await opc.opcMonitoredTag.findMany({
      where: { active: true, source },
      orderBy: { area: 'asc' },
      take: 500,
      select: { tag: true, area: true, folder: true, tagType: true, label: true, hhAlarm: true, llAlarm: true, pushToCloud: true, source: true },
    });
  } catch {
    // Fallback if source/pushToCloud columns don't exist yet
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
  source: z.enum(['ETHANOL', 'SUGAR']).optional().default('ETHANOL'),
  scannedAt: z.string().optional(),
});

router.post('/alarm-notify', validate(alarmNotifySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!checkPushKey(req, res)) return;
  const opc = getOpcPrisma();
  const { tag, label, value, limit, alarmType, source } = req.body;
  const src = source || 'ETHANOL';

  // Log alarm to OpcAlarmLog
  try {
    await opc.opcAlarmLog.create({
      data: { tag, label, value, limit, alarmType, source: src },
    });
  } catch {
    // Table may not exist in Prisma client yet — use raw SQL
    await opc.$executeRawUnsafe(
      `INSERT INTO "OpcAlarmLog" (id, tag, label, value, "limit", "alarmType", source, "sentAt") VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW())`,
      tag, label, value, limit, alarmType, src
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
router.get('/health', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const source = req.query.source as string | undefined;
  const tagWhere: any = { active: true };
  const readingWhere: any = {};
  if (source) { tagWhere.source = source; readingWhere.source = source; }
  const [monitoredCount, latestReading, latestSync] = await Promise.all([
    opc.opcMonitoredTag.count({ where: tagWhere }),
    opc.opcReading.findFirst({ where: readingWhere, orderBy: { scannedAt: 'desc' }, select: { scannedAt: true } }),
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
router.get('/bridge-health', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
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
router.get('/monitor', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const source = req.query.source as string | undefined;
  const where: any = { active: true };
  if (source) where.source = source;
  let tags: any[];
  try {
    tags = await opc.opcMonitoredTag.findMany({
      where, orderBy: { area: 'asc' }, take: 500,
      select: { id: true, tag: true, area: true, folder: true, tagType: true, label: true, description: true, hhAlarm: true, llAlarm: true, active: true, source: true },
    });
  } catch {
    tags = await opc.opcMonitoredTag.findMany({
      where, orderBy: { area: 'asc' }, take: 500,
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
  source: z.enum(['ETHANOL', 'SUGAR']).optional().default('ETHANOL'),
});

router.post('/monitor', authenticate, validate(addMonitorSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const { tag, area, folder, tagType, label, source } = req.body;
  const src = source || 'ETHANOL';

  try {
    const result = await opc.opcMonitoredTag.upsert({
      where: { tag },
      create: { tag, area, folder, tagType, label: label || tag, source: src, active: true },
      update: { area, folder, tagType, label: label || tag, source: src, active: true },
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

router.patch('/monitor/:tag', authenticate, validate(updateMonitorSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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
router.delete('/monitor/:tag', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
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
// Optimized: batch-fetch latest readings instead of N+1 per-tag queries
router.get('/live', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const source = req.query.source as string | undefined;
  const tagWhere: any = { active: true };
  if (source) tagWhere.source = source;
  let tags: any[];
  try {
    tags = await opc.opcMonitoredTag.findMany({
      where: tagWhere,
      take: 500,
      select: { tag: true, area: true, folder: true, tagType: true, label: true, description: true, hhAlarm: true, llAlarm: true },
    });
  } catch {
    tags = await opc.opcMonitoredTag.findMany({
      where: tagWhere,
      take: 500,
      select: { tag: true, area: true, folder: true, tagType: true, label: true },
    });
  }

  // Batch-fetch latest readings for ALL tags in one query (avoids N+1)
  const tagNames = tags.map((t: { tag: string }) => t.tag);
  const recentReadings = tagNames.length > 0 ? await opc.opcReading.findMany({
    where: { tag: { in: tagNames } },
    orderBy: { scannedAt: 'desc' },
    take: tagNames.length * 5, // ~5 properties per tag is plenty
    select: { tag: true, property: true, value: true, scannedAt: true },
  }) : [];

  // Group readings by tag, keeping only the latest per property
  const readingsByTag = new Map<string, { values: Record<string, number>; updatedAt: Date | null }>();
  for (const r of recentReadings) {
    if (!readingsByTag.has(r.tag)) {
      readingsByTag.set(r.tag, { values: {}, updatedAt: null });
    }
    const entry = readingsByTag.get(r.tag)!;
    if (!(r.property in entry.values)) {
      entry.values[r.property] = r.value;
      if (!entry.updatedAt) entry.updatedAt = r.scannedAt;
    }
  }

  const result = tags.map((t: any) => {
    const data = readingsByTag.get(t.tag);
    return {
      tag: t.tag,
      area: t.area,
      type: t.tagType,
      label: t.label,
      description: t.description || '',
      hhAlarm: t.hhAlarm,
      llAlarm: t.llAlarm,
      updatedAt: data?.updatedAt?.toISOString() || null,
      values: data?.values || {},
    };
  });

  res.json({ tags: result, count: result.length });
}));

// GET /api/opc/live/:tag — Latest readings for one tag
router.get('/live/:tag', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
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
router.get('/history/:tag', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const tag = req.params.tag;
  const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);
  const property = (req.query.property as string) || 'PV';
  const source = req.query.source as string | undefined;
  const cutoff = new Date(Date.now() - hours * 3600 * 1000);

  if (hours <= 6) {
    // Raw readings for short ranges — much sharper graphs
    const rawWhere: any = { tag, property, scannedAt: { gte: cutoff } };
    if (source) rawWhere.source = source;
    const raw = await opc.opcReading.findMany({
      where: rawWhere,
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
    const hourlyWhere: any = { tag, property, hour: { gte: cutoff } };
    if (source) hourlyWhere.source = source;
    const readings = await opc.opcHourlyReading.findMany({
      where: hourlyWhere,
      orderBy: { hour: 'asc' },
      take: 500,
      select: { hour: true, avg: true, min: true, max: true, count: true },
    });
    res.json({ tag, property, hours, readings, count: readings.length, resolution: 'hourly' });
  }
}));

// GET /api/opc/fermenter-phases — auto-detected fermenter phases from OPC data
router.get('/fermenter-phases', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const { getAllFermenterPhases } = await import('../services/fermenterPhaseDetector');
  const phases = await getAllFermenterPhases();
  res.json({ phases });
}));

// GET /api/opc/wash-summary — wash volume prepared per 9AM-9AM shift day
// Calculates from OPC hourly level readings: sum of all level increases × capacity
router.get('/wash-summary', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
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

  // Calculate wash fed to distillation from MG_140101 (DCS flow totalizer)
  // PRV_HR property = previous hour total in M³ (DCS-computed, high accuracy)
  // Falls back to FCV_140101 PV hourly averages if totalizer not available
  const WASH_FEED_TAG = 'MG_140101';
  async function calcFeedWash(startUTC: Date, endUTC: Date): Promise<{ totalFeedKL: number; avgFlowRate: number; hours: number }> {
    // Try MG_140101 PRV_HR first (DCS totalizer — most accurate)
    let readings = await opc.opcHourlyReading.findMany({
      where: { tag: WASH_FEED_TAG, property: 'PRV_HR', hour: { gte: startUTC, lt: endUTC } },
      orderBy: { hour: 'asc' },
      select: { avg: true },
    });

    if (readings.length === 0) {
      // Fallback: try FCV_140101 PV (control valve flow rate × 1 hr)
      readings = await opc.opcHourlyReading.findMany({
        where: { tag: 'FCV_140101', property: 'PV', hour: { gte: startUTC, lt: endUTC } },
        orderBy: { hour: 'asc' },
        select: { avg: true },
      });
    }

    if (readings.length === 0) return { totalFeedKL: 0, avgFlowRate: 0, hours: 0 };
    // For PRV_HR: each reading IS the hourly total (not a rate)
    // For FCV PV fallback: each reading is avg rate × 1 hr
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
router.get('/stats', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const source = req.query.source as string | undefined;
  const tagWhere: any = { active: true };
  const readingWhere: any = {};
  const hourlyWhere: any = {};
  if (source) { tagWhere.source = source; readingWhere.source = source; hourlyWhere.source = source; }
  const [tags, readings, hourly, syncs] = await Promise.all([
    opc.opcMonitoredTag.count({ where: tagWhere }),
    opc.opcReading.count({ where: readingWhere }),
    opc.opcHourlyReading.count({ where: hourlyWhere }),
    opc.opcSyncLog.count(),
  ]);
  res.json({ monitoredTags: tags, rawReadings: readings, hourlyReadings: hourly, totalSyncs: syncs });
}));

// ==========================================================================
// GAP DETECTION — find missing data hours in last N hours
// ==========================================================================

router.get('/gaps', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const opc = getOpcPrisma();
  const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);
  const source = req.query.source as string | undefined;
  const tagWhere: any = { active: true };
  const readingWhere: any = {};
  if (source) { tagWhere.source = source; readingWhere.source = source; }

  const now = new Date();
  const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);

  // Build set of expected hours (rounded to hour)
  const expectedHours: Date[] = [];
  const cursor = new Date(startTime);
  cursor.setMinutes(0, 0, 0);
  while (cursor < now) {
    expectedHours.push(new Date(cursor));
    cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
  }

  // Get active tag count for coverage threshold
  const activeTagCount = await opc.opcMonitoredTag.count({ where: tagWhere });

  // Get hours that have data — count distinct tags per hour to detect partial uploads
  const hourlyGapWhere: any = { hour: { gte: startTime, lte: now } };
  if (source) hourlyGapWhere.source = source;
  const hourlyReadings = await opc.opcHourlyReading.findMany({
    where: hourlyGapWhere,
    select: { hour: true, tag: true },
  });

  // Build map: hour → set of tags that have data
  const hourTagMap = new Map<string, Set<string>>();
  for (const r of hourlyReadings) {
    const key = r.hour.toISOString();
    if (!hourTagMap.has(key)) hourTagMap.set(key, new Set());
    hourTagMap.get(key)!.add(r.tag);
  }

  // Find gaps — hours with no data OR partial coverage (< 50% of active tags)
  const coverageThreshold = Math.max(1, Math.floor(activeTagCount * 0.5));
  const gapHours = expectedHours.filter(h => {
    const tags = hourTagMap.get(h.toISOString());
    return !tags || tags.size < coverageThreshold;
  });

  // Group consecutive gaps into ranges
  interface GapRange { from: Date; to: Date; durationMinutes: number }
  const gaps: GapRange[] = [];
  for (const gh of gapHours) {
    const last = gaps[gaps.length - 1];
    if (last && gh.getTime() - last.to.getTime() <= 60 * 60 * 1000) {
      last.to = new Date(gh.getTime() + 60 * 60 * 1000);
      last.durationMinutes = Math.round((last.to.getTime() - last.from.getTime()) / 60000);
    } else {
      gaps.push({ from: gh, to: new Date(gh.getTime() + 60 * 60 * 1000), durationMinutes: 60 });
    }
  }

  // Check if currently gapped (no raw reading in last 15 min)
  const recentCutoff = new Date(now.getTime() - 15 * 60 * 1000);
  const recentWhere: any = { scannedAt: { gte: recentCutoff } };
  if (source) recentWhere.source = source;
  const recentReading = await opc.opcReading.findFirst({
    where: recentWhere,
    select: { scannedAt: true },
    orderBy: { scannedAt: 'desc' },
  });
  const lastWhere: any = {};
  if (source) lastWhere.source = source;
  const lastReading = await opc.opcReading.findFirst({
    where: lastWhere,
    select: { scannedAt: true },
    orderBy: { scannedAt: 'desc' },
  });

  res.json({
    gaps,
    totalGapMinutes: gaps.reduce((s, g) => s + g.durationMinutes, 0),
    currentlyGapped: !recentReading,
    lastReading: lastReading?.scannedAt || null,
    activeTagCount,
    coverageThreshold,
  });
}));

// ==========================================================================
// BRIDGE HEARTBEAT — Factory PC phones home every 60s (no Tailscale needed)
// ==========================================================================

// In-memory store for latest heartbeat PER SOURCE (fast access, no DB needed)
// Keyed by source (ETHANOL, SUGAR) to prevent cross-bridge overwrite
interface BridgeHeartbeat {
  timestamp: string;
  receivedAt: Date;
  source: string;
  uptimeSeconds: number;
  opcConnected: boolean;
  queueDepth: number;
  dbSizeMb: number;
  health: { scannerAlive: boolean; syncAlive: boolean; apiAlive: boolean; threadRestarts: Record<string, number> };
  system: { cpuPercent: number; memoryMb: number; diskFreeGb: number; sleepDisabled: boolean };
  version: string;
  lastScanCompletedAt?: string | null;
  lastScanAgeSeconds?: number | null;
}
const _heartbeats: Map<string, BridgeHeartbeat> = new Map();
// Backwards compat: single heartbeat reference (points to most recent)
let _latestHeartbeat: BridgeHeartbeat | null = null;

const heartbeatSchema = z.object({
  timestamp: z.string(),
  source: z.enum(['ETHANOL', 'SUGAR']).optional().default('ETHANOL'),
  uptimeSeconds: z.number(),
  opcConnected: z.boolean(),
  queueDepth: z.number().default(0),
  dbSizeMb: z.number().default(0),
  health: z.object({
    scannerAlive: z.boolean(),
    syncAlive: z.boolean(),
    apiAlive: z.boolean(),
    threadRestarts: z.record(z.number()).default({}),
  }),
  system: z.object({
    cpuPercent: z.number(),
    memoryMb: z.number(),
    diskFreeGb: z.number(),
    sleepDisabled: z.boolean(),
  }),
  version: z.string().default('unknown'),
  lastScanCompletedAt: z.string().nullable().optional(),
  lastScanAgeSeconds: z.number().nullable().optional(),
});

// Track alert state to avoid spamming
let _sleepAlertSent = false;
let _queueAlertSent = false;

router.post('/heartbeat', validate(heartbeatSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!checkPushKey(req, res)) return;
  const data = req.body;
  const src = data.source || 'ETHANOL';

  const hb: BridgeHeartbeat = { ...data, source: src, receivedAt: new Date() };
  _heartbeats.set(src, hb);
  _latestHeartbeat = hb; // backwards compat

  // Alert if sleep got re-enabled
  if (!data.system.sleepDisabled && !_sleepAlertSent) {
    _sleepAlertSent = true;
    try {
      const prismaMain = (await import('../config/prisma')).default;
      const settings = await prismaMain.settings.findFirst();
      const groupChatId = (settings as any)?.telegramGroupChatId;
      if (groupChatId) {
        await broadcastToGroup(groupChatId, '⚠️ *FACTORY PC SLEEP ENABLED*\n\nSomeone re-enabled sleep on the factory PC. OPC data will be lost at night.\n\nRun: `powercfg /change standby-timeout-ac 0`', 'opc-health').catch(() => {});
      }
    } catch { /* ignore */ }
  } else if (data.system.sleepDisabled) {
    _sleepAlertSent = false;
  }

  // Alert if queue building up
  if (data.queueDepth > 50 && !_queueAlertSent) {
    _queueAlertSent = true;
    try {
      const prismaMain = (await import('../config/prisma')).default;
      const settings = await prismaMain.settings.findFirst();
      const groupChatId = (settings as any)?.telegramGroupChatId;
      if (groupChatId) {
        await broadcastToGroup(groupChatId, `⚠️ *OPC SYNC QUEUE BUILDING UP*\n\n${data.queueDepth} readings queued. Cloud sync may be failing.`, 'opc-health').catch(() => {});
      }
    } catch { /* ignore */ }
  } else if (data.queueDepth <= 10) {
    _queueAlertSent = false;
  }

  res.json({ ok: true });
}));

// GET /api/opc/bridge-status — Frontend reads latest heartbeat
// ?source=ETHANOL|SUGAR (default: ETHANOL for backwards compat)
router.get('/bridge-status', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const source = (req.query.source as string) || 'ETHANOL';
  const hb = _heartbeats.get(source);

  if (!hb) {
    res.json({ online: false, heartbeat: null, source, message: `No heartbeat received from ${source} bridge` });
    return;
  }

  const ageMs = Date.now() - hb.receivedAt.getTime();
  const online = ageMs < 3 * 60 * 1000;

  res.json({
    online,
    ageSeconds: Math.round(ageMs / 1000),
    source,
    heartbeat: hb,
  });
}));

// Export heartbeat for watchdog to use — returns per-source or latest
export function getLatestHeartbeat(source?: string) {
  if (source) return _heartbeats.get(source) || null;
  return _latestHeartbeat;
}
export function getAllHeartbeats() { return _heartbeats; }

// ==========================================================================
// ALARM TOGGLE ENDPOINTS
// ==========================================================================

router.get('/alarms/status', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
  await loadAlarmState();
  res.json({ enabled: alarmsEnabled });
}));

router.post('/alarms/toggle', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
  alarmsEnabled = !alarmsEnabled;
  await saveAlarmState();
  console.log(`[OPC] Alarms ${alarmsEnabled ? 'ENABLED' : 'DISABLED'} via UI (persisted)`);
  res.json({ enabled: alarmsEnabled });
}));

export default router;
