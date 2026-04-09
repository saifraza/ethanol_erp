import { Router, Response } from 'express';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import { ValidationError } from '../../shared/errors';
import { z } from 'zod';
import { writeAuditMany } from '../../services/complianceAudit';

const router = Router();
router.use(authenticate as any);

const updateSchema = z.object({
  legalName: z.string().min(1).optional(),
  pan: z.string().length(10).optional(),
  tan: z.string().length(10).optional(),
  gstin: z.string().length(15).optional(),
  cin: z.string().nullable().optional(),
  udyamNo: z.string().nullable().optional(),
  registeredState: z.string().length(2).optional(),
  registeredStateName: z.string().nullable().optional(),
  taxRegime: z.enum(['115BAB', '115BAA', 'NORMAL']).optional(),
  fyStartMonth: z.number().int().min(1).max(12).optional(),
  eInvoiceEnabled: z.boolean().optional(),
  eInvoiceThresholdCr: z.number().nonnegative().optional(),
  eWayBillMinAmount: z.number().nonnegative().optional(),
  lutNumber: z.string().nullable().optional(),
  lutValidFrom: z.string().nullable().optional(),
  lutValidTill: z.string().nullable().optional(),
  reason: z.string().optional(),
});

const AUDITED_FIELDS = [
  'legalName', 'pan', 'tan', 'gstin', 'cin', 'udyamNo',
  'registeredState', 'registeredStateName', 'taxRegime', 'fyStartMonth',
  'eInvoiceEnabled', 'eInvoiceThresholdCr', 'eWayBillMinAmount',
  'lutNumber', 'lutValidFrom', 'lutValidTill',
];

async function ensureConfig() {
  let cfg = await prisma.complianceConfig.findFirst();
  if (!cfg) {
    cfg = await prisma.complianceConfig.create({
      data: {
        legalName: 'Mahakaushal Sugar and Power Industries Ltd',
        pan: 'PENDING000',
        tan: 'PENDING000',
        gstin: 'PENDING00000000',
        registeredState: '23',
        registeredStateName: 'Madhya Pradesh',
        taxRegime: 'NORMAL',
        fyStartMonth: 4,
        eInvoiceEnabled: true,
        eInvoiceThresholdCr: 5,
        eWayBillMinAmount: 50000,
      },
    });
  }
  return cfg;
}

router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const cfg = await ensureConfig();
  res.json(cfg);
}));

router.put('/', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const { reason, ...raw } = parsed.data;

  const data: Record<string, unknown> = { ...raw };
  if (raw.lutValidFrom !== undefined) data.lutValidFrom = raw.lutValidFrom ? new Date(raw.lutValidFrom) : null;
  if (raw.lutValidTill !== undefined) data.lutValidTill = raw.lutValidTill ? new Date(raw.lutValidTill) : null;

  const current = await ensureConfig();
  data.updatedBy = req.user?.id || 'system';

  const updated = await prisma.complianceConfig.update({
    where: { id: current.id },
    data,
  });

  await writeAuditMany(
    'ComplianceConfig',
    current.id,
    current as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
    AUDITED_FIELDS,
    req.user?.id || 'system',
    reason,
  );

  res.json(updated);
}));

export default router;
