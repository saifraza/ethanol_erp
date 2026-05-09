import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { fireSyncLaborToDevices } from '../services/laborWorkerDeviceSync';

const router = Router();
router.use(authenticate);

// ════════════════════════════════════════════════════════════════
// LIST
// ════════════════════════════════════════════════════════════════

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { contractorId, workOrderId, isActive, search } = req.query as Record<string, string | undefined>;
  const where: any = { ...getCompanyFilter(req) };
  if (contractorId) where.contractorId = contractorId;
  if (workOrderId) where.workOrderId = workOrderId;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  else where.isActive = true;
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { workerCode: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }
  const workers = await prisma.laborWorker.findMany({
    where,
    orderBy: { workerNo: 'asc' },
    take: 5000,
    include: {
      contractor: { select: { id: true, name: true, contractorCode: true } },
      workOrder: { select: { id: true, woNo: true, title: true, contractType: true } },
    },
  });
  res.json({ workers });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const w = await prisma.laborWorker.findUnique({
    where: { id: req.params.id },
    include: {
      contractor: { select: { id: true, name: true, contractorCode: true } },
      workOrder: { select: { id: true, woNo: true, title: true, contractType: true } },
    },
  });
  if (!w) throw new NotFoundError('LaborWorker', req.params.id);
  res.json(w);
}));

// ════════════════════════════════════════════════════════════════
// CREATE
// ════════════════════════════════════════════════════════════════

const createSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().nullable().optional(),
  fatherName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  aadhaar: z.string().nullable().optional(),
  contractorId: z.string().min(1),
  workOrderId: z.string().nullable().optional(),
  skillCategory: z.string().nullable().optional(),
  dailyRate: z.number().min(0).nullable().optional(),
  cardNumber: z.string().nullable().optional(),
  joinedAt: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
});

router.post('/', authorize('ADMIN'), validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as z.infer<typeof createSchema>;

  // Auto-generate workerCode from next workerNo
  const last = await prisma.laborWorker.findFirst({ orderBy: { workerNo: 'desc' }, select: { workerNo: true } });
  const nextNo = last ? last.workerNo + 1 : 1;
  const workerCode = `LW-${String(nextNo).padStart(3, '0')}`;

  const w = await prisma.laborWorker.create({
    data: {
      workerCode,
      firstName: b.firstName.trim(),
      lastName: b.lastName ?? null,
      fatherName: b.fatherName ?? null,
      phone: b.phone ?? null,
      aadhaar: b.aadhaar ?? null,
      contractorId: b.contractorId,
      workOrderId: b.workOrderId ?? null,
      skillCategory: b.skillCategory ?? null,
      dailyRate: b.dailyRate ?? null,
      cardNumber: b.cardNumber ?? null,
      joinedAt: b.joinedAt ? new Date(b.joinedAt) : new Date(),
      remarks: b.remarks ?? null,
      companyId: getActiveCompanyId(req),
    },
  });

  // Push to all active biometric devices
  fireSyncLaborToDevices(w.id, 'UPSERT');

  res.status(201).json({ worker: w });
}));

// ════════════════════════════════════════════════════════════════
// BULK CREATE — Excel-style quick add (just name + aadhaar per row,
// shared contractor / workOrder / skill at the top). Allocates
// workerCodes sequentially in one transaction so two parallel
// callers can't race to the same workerNo.
// ════════════════════════════════════════════════════════════════

const bulkCreateSchema = z.object({
  contractorId: z.string().min(1),
  workOrderId: z.string().nullable().optional(),
  skillCategory: z.string().nullable().optional(),
  workers: z.array(z.object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().nullable().optional(),
    aadhaar: z.string().nullable().optional(),
  })).min(1).max(200),
});

router.post('/bulk', authorize('ADMIN'), validate(bulkCreateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as z.infer<typeof bulkCreateSchema>;
  const companyId = getActiveCompanyId(req);

  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.laborWorker.findFirst({ orderBy: { workerNo: 'desc' }, select: { workerNo: true } });
    let nextNo = (last?.workerNo ?? 0) + 1;
    const out: Array<{ id: string; workerCode: string; firstName: string; lastName: string | null }> = [];
    for (const row of b.workers) {
      const workerCode = `LW-${String(nextNo).padStart(3, '0')}`;
      const w = await tx.laborWorker.create({
        data: {
          workerCode,
          firstName: row.firstName.trim(),
          lastName: row.lastName?.trim() || null,
          aadhaar: row.aadhaar?.trim() || null,
          contractorId: b.contractorId,
          workOrderId: b.workOrderId ?? null,
          skillCategory: b.skillCategory ?? null,
          joinedAt: new Date(),
          companyId,
        },
        select: { id: true, workerCode: true, firstName: true, lastName: true },
      });
      out.push(w);
      nextNo++;
    }
    return out;
  });

  // Push every new worker to devices outside the transaction —
  // fire-and-forget so the HTTP response isn't blocked on bridge calls.
  for (const w of created) fireSyncLaborToDevices(w.id, 'UPSERT');

  res.status(201).json({ created, count: created.length });
}));

// ════════════════════════════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════════════════════════════

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
  deviceUserId: z.string().nullable().optional(),
});

router.put('/:id', authorize('ADMIN'), validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as z.infer<typeof updateSchema>;
  const data: any = {};
  for (const k of Object.keys(b) as (keyof typeof b)[]) {
    if (b[k] === undefined) continue;
    if (k === 'joinedAt' && b[k]) data[k] = new Date(b[k] as string);
    else data[k] = b[k];
  }
  const w = await prisma.laborWorker.update({ where: { id: req.params.id }, data });
  fireSyncLaborToDevices(w.id, 'UPSERT');
  res.json({ worker: w });
}));

router.delete('/:id', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.laborWorker.update({ where: { id: req.params.id }, data: { isActive: false } });
  fireSyncLaborToDevices(req.params.id, 'DELETE');
  res.json({ ok: true });
}));

export default router;
