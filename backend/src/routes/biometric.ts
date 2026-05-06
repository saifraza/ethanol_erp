import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { bridge, bridgeHealth, DeviceRef } from '../services/biometricBridge';

const router = Router();
router.use(authenticate);

// ════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════

function toBridgeDevice(d: { ip: string; port: number; password: number }): DeviceRef {
  return { ip: d.ip, port: d.port, password: d.password, timeout: 10 };
}

/** ERP card number string → device-side 32-bit unsigned int. 0 = no card. */
function parseCardNumber(s: string | null | undefined): number {
  if (!s) return 0;
  const digits = s.replace(/\D/g, '');
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 && n <= 4_294_967_295 ? n : 0;
}

/**
 * Normalize a name for fuzzy matching:
 *  - lowercase
 *  - drop non-alpha (digits, dots, parens, etc.)
 *  - sort tokens alphabetically (so "Saif Raza" matches "Raza Saif")
 *  - drop tokens of length 1 (initials like "A.K.")
 */
function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
    .sort()
    .join(' ')
    .trim();
}

// ════════════════════════════════════════════════════════════════
// bridge health (so admin UI can show "is the bridge reachable?")
// ════════════════════════════════════════════════════════════════

router.get('/bridge-health', asyncHandler(async (_req: AuthRequest, res: Response) => {
  try {
    const h = await bridgeHealth();
    res.json({ reachable: true, ...h });
  } catch (err: unknown) {
    res.json({ reachable: false, error: err instanceof Error ? err.message : String(err) });
  }
}));

// ════════════════════════════════════════════════════════════════
// device CRUD
// ════════════════════════════════════════════════════════════════

const deviceSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Z0-9_]+$/, 'A-Z 0-9 _ only'),
  name: z.string().min(1).max(80),
  location: z.string().optional(),
  ip: z.string().min(7).max(45),
  port: z.number().int().min(1).max(65535).default(4370),
  password: z.number().int().min(0).max(99_999_999).default(0),
  active: z.boolean().default(true),
  notes: z.string().optional(),
});

router.get('/devices', asyncHandler(async (req: AuthRequest, res: Response) => {
  const devices = await prisma.biometricDevice.findMany({
    where: { ...getCompanyFilter(req) },
    orderBy: [{ active: 'desc' }, { code: 'asc' }],
    take: 100,
  });
  res.json(devices);
}));

router.post('/devices', authorize('ADMIN'), validate(deviceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const created = await prisma.biometricDevice.create({
    data: { ...req.body, companyId: getActiveCompanyId(req) },
  });
  res.status(201).json(created);
}));

router.put('/devices/:id', authorize('ADMIN'), validate(deviceSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await prisma.biometricDevice.update({ where: { id: req.params.id }, data: req.body });
  res.json(d);
}));

router.delete('/devices/:id', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  // Soft delete — preserve sync history references
  await prisma.biometricDevice.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════
// connection test (POST /devices/:id/test)
// ════════════════════════════════════════════════════════════════

router.post('/devices/:id/test', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!d) throw new NotFoundError('BiometricDevice', req.params.id);

  try {
    const info = await bridge.deviceInfo(toBridgeDevice(d));
    // Capture serial/firmware/platform on first successful test
    await prisma.biometricDevice.update({
      where: { id: d.id },
      data: {
        serialNumber: info.serial ?? d.serialNumber,
        firmware: info.firmware ?? d.firmware,
        platform: info.platform ?? d.platform,
      },
    });
    res.json({ ok: true, info });
  } catch (err: unknown) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}));

// ════════════════════════════════════════════════════════════════
// time sync
// ════════════════════════════════════════════════════════════════

router.post('/devices/:id/sync-time', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!d) throw new NotFoundError('BiometricDevice', req.params.id);
  const result = await bridge.syncTime(toBridgeDevice(d));
  res.json(result);
}));

// ════════════════════════════════════════════════════════════════
// user list + mapping (the killer feature)
//
// GET /devices/:id/users-mapping
//   Pulls all users on the device, pairs each with a suggested ERP Employee
//   match by normalized-name. Returns three buckets:
//     - matched: device user already has Employee.deviceUserId set OR we found
//       a single high-confidence name match
//     - ambiguous: name matches more than one Employee
//     - unmatched: no candidate found
// ════════════════════════════════════════════════════════════════

router.post('/devices/:id/pull-users', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!d) throw new NotFoundError('BiometricDevice', req.params.id);

  const { users: deviceUsers } = await bridge.listUsers(toBridgeDevice(d));

  // Pull all active employees once for matching
  const employees = await prisma.employee.findMany({
    where: { isActive: true, ...getCompanyFilter(req) },
    select: { id: true, empCode: true, empNo: true, firstName: true, lastName: true, deviceUserId: true },
    take: 5000,
  });

  // Build lookup: existing deviceUserId → employee
  const byDeviceUserId = new Map<string, typeof employees[number]>();
  for (const e of employees) {
    if (e.deviceUserId) byDeviceUserId.set(e.deviceUserId, e);
  }

  // Build lookup: normalized name → [employees]
  const byNormName = new Map<string, typeof employees>();
  for (const e of employees) {
    const k = normName(`${e.firstName} ${e.lastName}`);
    if (!k) continue;
    const list = byNormName.get(k) ?? [];
    list.push(e);
    byNormName.set(k, list);
  }

  const matched: any[] = [];
  const ambiguous: any[] = [];
  const unmatched: any[] = [];

  for (const u of deviceUsers) {
    // 1. Already mapped via Employee.deviceUserId
    const direct = byDeviceUserId.get(String(u.user_id));
    if (direct) {
      matched.push({
        deviceUser: u,
        employee: direct,
        matchKind: 'EXISTING',
      });
      continue;
    }

    // 2. Try fuzzy name match
    const k = normName(u.name);
    const candidates = k ? (byNormName.get(k) ?? []) : [];
    // Filter out employees already mapped to a different device user_id
    const free = candidates.filter(e => !e.deviceUserId);

    if (free.length === 1) {
      matched.push({ deviceUser: u, employee: free[0], matchKind: 'NAME' });
    } else if (free.length > 1) {
      ambiguous.push({ deviceUser: u, candidates: free });
    } else {
      unmatched.push({ deviceUser: u });
    }
  }

  // Save lastSyncAt
  await prisma.biometricDevice.update({
    where: { id: d.id },
    data: { lastSyncAt: new Date(), lastSyncStatus: 'OK', lastSyncError: null },
  }).catch(() => {});

  res.json({
    deviceCount: deviceUsers.length,
    matched, ambiguous, unmatched,
    summary: { matched: matched.length, ambiguous: ambiguous.length, unmatched: unmatched.length },
  });
}));

// ════════════════════════════════════════════════════════════════
// confirm a single mapping: PUT /mapping/:employeeId  body: { deviceUserId }
// ════════════════════════════════════════════════════════════════

const mappingSchema = z.object({ deviceUserId: z.string().min(1).max(40).nullable() });

router.put('/mapping/:employeeId', authorize('ADMIN'), validate(mappingSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { deviceUserId } = req.body as z.infer<typeof mappingSchema>;
  // Uniqueness guard: another employee already has this deviceUserId
  if (deviceUserId) {
    const collision = await prisma.employee.findFirst({
      where: { deviceUserId, NOT: { id: req.params.employeeId } },
      select: { id: true, empCode: true, firstName: true, lastName: true },
    });
    if (collision) {
      return res.status(409).json({
        error: `deviceUserId ${deviceUserId} already mapped to ${collision.firstName} ${collision.lastName} (${collision.empCode})`,
      });
    }
  }
  const updated = await prisma.employee.update({
    where: { id: req.params.employeeId },
    data: { deviceUserId },
    select: { id: true, empCode: true, firstName: true, lastName: true, deviceUserId: true },
  });
  res.json(updated);
}));

// ════════════════════════════════════════════════════════════════
// bulk-apply suggested matches: POST /devices/:id/apply-matches
// body: { matches: [{employeeId, deviceUserId}] }
// ════════════════════════════════════════════════════════════════

const bulkSchema = z.object({
  matches: z.array(z.object({ employeeId: z.string().min(1), deviceUserId: z.string().min(1).max(40) })).min(1).max(500),
});

router.post('/devices/:id/apply-matches', authorize('ADMIN'), validate(bulkSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { matches } = req.body as z.infer<typeof bulkSchema>;
  let applied = 0;
  const errors: string[] = [];
  for (const m of matches) {
    try {
      // Skip if another employee already has this deviceUserId
      const collision = await prisma.employee.findFirst({
        where: { deviceUserId: m.deviceUserId, NOT: { id: m.employeeId } },
        select: { id: true },
      });
      if (collision) {
        errors.push(`${m.deviceUserId}: collision with ${collision.id}`);
        continue;
      }
      await prisma.employee.update({ where: { id: m.employeeId }, data: { deviceUserId: m.deviceUserId } });
      applied++;
    } catch (err: unknown) {
      errors.push(`${m.deviceUserId}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
  res.json({ applied, errors });
}));

// ════════════════════════════════════════════════════════════════
// pull punches → write AttendancePunch rows + recompute days
// POST /devices/:id/pull-punches  body: { since?: ISO, clearAfter?: bool }
// ════════════════════════════════════════════════════════════════

router.post('/devices/:id/pull-punches', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!d) throw new NotFoundError('BiometricDevice', req.params.id);

  // Default: since lastPunchSyncAt minus 30s overlap (to catch races); on first pull, ALL punches.
  let since: string | undefined = req.body?.since;
  if (!since && d.lastPunchSyncAt) {
    since = new Date(d.lastPunchSyncAt.getTime() - 30_000).toISOString();
  }
  const clearAfter = !!req.body?.clearAfter;

  let pulled;
  try {
    pulled = await bridge.pullPunches(toBridgeDevice(d), since, clearAfter);
  } catch (err: unknown) {
    await prisma.biometricDevice.update({
      where: { id: d.id },
      data: { lastSyncStatus: 'ERROR', lastSyncError: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});
    throw err;
  }

  // Resolve device.user_id → Employee.id via Employee.deviceUserId
  const userIds = [...new Set(pulled.punches.map(p => p.user_id))];
  const employees = await prisma.employee.findMany({
    where: { deviceUserId: { in: userIds } },
    select: { id: true, deviceUserId: true, empCode: true, companyId: true },
  });
  const byDevId = new Map(employees.map(e => [e.deviceUserId!, e]));

  let inserted = 0;
  let unmapped: string[] = [];
  const affectedDays = new Set<string>(); // empId|YYYY-MM-DD IST

  for (const p of pulled.punches) {
    const emp = byDevId.get(p.user_id);
    if (!emp) {
      if (!unmapped.includes(p.user_id)) unmapped.push(p.user_id);
      continue;
    }
    // Idempotency: avoid duplicating a punch we already have. We dedupe on
    // (employeeId, punchAt, deviceId) — same device + same instant = same punch.
    const existing = await prisma.attendancePunch.findFirst({
      where: { employeeId: emp.id, punchAt: new Date(p.punch_at), deviceId: d.code },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.attendancePunch.create({
      data: {
        employeeId: emp.id,
        punchAt: new Date(p.punch_at),
        direction: p.punch === 0 ? 'IN' : p.punch === 1 ? 'OUT' : 'AUTO',
        source: 'DEVICE',
        deviceId: d.code,
        rawEmpCode: p.user_id,
        companyId: emp.companyId ?? d.companyId,
      },
    });
    inserted++;

    // Track day for recompute
    const ist = new Date(new Date(p.punch_at).getTime() + 5.5 * 60 * 60 * 1000);
    const dateStr = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
    affectedDays.add(`${emp.id}|${dateStr}`);
  }

  // Update device sync state
  await prisma.biometricDevice.update({
    where: { id: d.id },
    data: { lastPunchSyncAt: new Date(), lastSyncStatus: 'OK', lastSyncError: null },
  });

  res.json({
    pulled: pulled.count,
    inserted,
    unmappedDeviceUserIds: unmapped,
    affectedDays: affectedDays.size,
    note: affectedDays.size > 0 ? 'Run /api/attendance/recompute for affected dates to update day status.' : undefined,
  });
}));

// ════════════════════════════════════════════════════════════════
// push ERP employees → device  (POST /devices/:id/sync-employees)
// Sends every active employee that has a non-null deviceUserId to the device,
// upserting their name + privilege. Does NOT push fingerprints (those are
// physically enrolled). New employees without a deviceUserId yet get one
// auto-assigned (= empNo string).
// ════════════════════════════════════════════════════════════════

router.post('/devices/:id/sync-employees', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!d) throw new NotFoundError('BiometricDevice', req.params.id);

  const employees = await prisma.employee.findMany({
    where: { isActive: true, ...getCompanyFilter(req) },
    select: { id: true, empCode: true, empNo: true, firstName: true, lastName: true, deviceUserId: true, cardNumber: true },
    take: 5000,
  });

  // For employees without deviceUserId, auto-assign = empNo (numeric string)
  const toAutoAssign = employees.filter(e => !e.deviceUserId);
  for (const e of toAutoAssign) {
    const candidate = String(e.empNo);
    // Skip if collision
    const taken = await prisma.employee.findFirst({ where: { deviceUserId: candidate, NOT: { id: e.id } }, select: { id: true } });
    if (!taken) {
      await prisma.employee.update({ where: { id: e.id }, data: { deviceUserId: candidate } });
      e.deviceUserId = candidate;
    }
  }

  let pushed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const e of employees) {
    if (!e.deviceUserId) continue;
    try {
      await bridge.upsertUser(toBridgeDevice(d), {
        user_id: e.deviceUserId,
        name: `${e.firstName} ${e.lastName}`.trim(),
        privilege: 0,
        card: parseCardNumber(e.cardNumber),
      });
      pushed++;
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      if (errors.length < 10) errors.push(`${e.empCode}: ${msg.slice(0, 200)}`);
    }
  }

  await prisma.biometricDevice.update({
    where: { id: d.id },
    data: { lastSyncAt: new Date(), lastSyncStatus: failed === 0 ? 'OK' : 'ERROR' },
  });

  res.json({ pushed, failed, errors });
}));

// ════════════════════════════════════════════════════════════════
// trigger enrollment on device for one employee
// POST /devices/:id/enroll  body: { employeeId, fingerId? }
// ════════════════════════════════════════════════════════════════

const enrollSchema = z.object({
  employeeId: z.string().min(1),
  fingerId: z.number().int().min(0).max(9).default(1),
});

router.post('/devices/:id/enroll', authorize('ADMIN'), validate(enrollSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!d) throw new NotFoundError('BiometricDevice', req.params.id);
  const { employeeId, fingerId } = req.body as z.infer<typeof enrollSchema>;

  const e = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!e) throw new NotFoundError('Employee', employeeId);
  if (!e.deviceUserId) {
    return res.status(400).json({ error: 'Employee has no deviceUserId — run sync-employees or set the mapping first.' });
  }

  // Make sure the user is on the device first; if not, upsert.
  await bridge.upsertUser(toBridgeDevice(d), {
    user_id: e.deviceUserId,
    name: `${e.firstName} ${e.lastName}`.trim(),
    privilege: 0,
  });

  await bridge.enrollUser(toBridgeDevice(d), e.deviceUserId, fingerId);
  res.json({ ok: true, message: `Device ${d.code} now in enrollment mode for ${e.firstName} ${e.lastName}. Have them scan finger ${fingerId} on the device.` });
}));

// ════════════════════════════════════════════════════════════════
// replicate fingerprint template across devices
// POST /templates/replicate body: { srcDeviceId, dstDeviceIds[], employeeId, fingerIds? }
// ════════════════════════════════════════════════════════════════

const replicateSchema = z.object({
  srcDeviceId: z.string().min(1),
  dstDeviceIds: z.array(z.string().min(1)).min(1),
  employeeId: z.string().min(1),
  fingerIds: z.array(z.number().int().min(0).max(9)).optional(),
});

router.post('/templates/replicate', authorize('ADMIN'), validate(replicateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { srcDeviceId, dstDeviceIds, employeeId, fingerIds } = req.body as z.infer<typeof replicateSchema>;
  const [src, employee, ...dsts] = await Promise.all([
    prisma.biometricDevice.findUnique({ where: { id: srcDeviceId } }),
    prisma.employee.findUnique({ where: { id: employeeId } }),
    ...dstDeviceIds.map(id => prisma.biometricDevice.findUnique({ where: { id } })),
  ]);
  if (!src) return res.status(404).json({ error: 'src device not found' });
  if (!employee) return res.status(404).json({ error: 'employee not found' });
  if (!employee.deviceUserId) return res.status(400).json({ error: 'employee has no deviceUserId' });

  const results: any[] = [];
  for (const dst of dsts) {
    if (!dst) continue;
    // Make sure the user exists on dst first
    await bridge.upsertUser(toBridgeDevice(dst), {
      user_id: employee.deviceUserId,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      privilege: 0,
    });
    const r = await bridge.copyTemplate(toBridgeDevice(src), toBridgeDevice(dst), employee.deviceUserId, fingerIds);
    results.push({ dstDeviceCode: dst.code, ...r });
  }

  res.json({ ok: true, results });
}));

export default router;
