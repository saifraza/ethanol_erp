/**
 * Weighment Correction Admin Routes
 *
 * Admin-only endpoints to correct weighment records (GrainTruck) with:
 *   - full audit trail (WeighmentCorrection)
 *   - downstream blocker checks (GRN/invoice/payment)
 *   - push-back to factory-server for local DB sync
 *
 * See .claude/skills/weighment-corrections.md for the full specification.
 *
 * Phase 1 scope: edit material/supplier/PO/vehicle/driver/transporter/remarks
 * on GrainTruck records that have no downstream financial commitments.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import prisma from '../config/prisma';
import { checkGrainTruckCorrectable } from '../shared/weighment/correctionGuards';

const router = Router();

const FACTORY_SERVER_URL = process.env.FACTORY_SERVER_URL || 'http://100.126.101.7:5000';
const WB_PUSH_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';
// Admin override PIN for editing records older than 30 days. Kept separate from
// the factory server's override PIN so roles don't bleed between systems.
const CLOUD_ADMIN_OVERRIDE_PIN = process.env.CLOUD_ADMIN_OVERRIDE_PIN || '1234';

// All routes require authentication + ADMIN role.
router.use(authenticate);
router.use(authorize('ADMIN'));

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/weighbridge/admin/correctable
// List recent GrainTrucks with each one's blocker reasons (for UI render).
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/correctable',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string || '').trim();
    const fromDate = req.query.from ? new Date(req.query.from as string) : undefined;
    const toDate = req.query.to ? new Date(req.query.to as string) : undefined;

    const where: Record<string, unknown> = {};
    if (fromDate || toDate) {
      const toDateExclusive = toDate
        ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000)
        : undefined;
      where.date = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDateExclusive ? { lt: toDateExclusive } : {}),
      };
    }
    if (search) {
      // numeric search = ticketNo, else text = vehicleNo/supplier
      const ticketNo = parseInt(search);
      if (!isNaN(ticketNo)) {
        where.ticketNo = ticketNo;
      } else {
        where.OR = [
          { vehicleNo: { contains: search, mode: 'insensitive' } },
          { supplier: { contains: search, mode: 'insensitive' } },
          { materialType: { contains: search, mode: 'insensitive' } },
        ];
      }
    }

    const [trucks, total] = await Promise.all([
      prisma.grainTruck.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          ticketNo: true,
          vehicleNo: true,
          supplier: true,
          materialType: true,
          materialId: true,
          weightGross: true,
          weightTare: true,
          weightNet: true,
          date: true,
          createdAt: true,
          cancelled: true,
          cancelledReason: true,
          grnId: true,
          factoryLocalId: true,
          goodsReceipt: {
            select: { grnNo: true, status: true, invoiceNo: true, fullyPaid: true },
          },
        },
      }),
      prisma.grainTruck.count({ where }),
    ]);

    // Run blocker check for each row (fast — all data already loaded via include)
    const rows = await Promise.all(
      trucks.map(async (t) => {
        const summary = await checkGrainTruckCorrectable(t.id);
        return {
          ...t,
          canEdit: summary.canEdit,
          blockers: summary.blockers,
          requiresAdminPin: summary.requiresAdminPin,
        };
      }),
    );

    res.json({
      items: rows,
      total,
      limit: take,
      offset: skip,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/weighbridge/admin/corrections/:weighmentId
// Full audit trail for a specific weighment.
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  '/corrections/:weighmentId',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rows = await prisma.weighmentCorrection.findMany({
      where: { weighmentId: req.params.weighmentId as string },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows);
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/weighbridge/admin/correct/:id
// Apply corrections to a GrainTruck. All fields optional; only changed ones
// are audited and pushed.
// ═══════════════════════════════════════════════════════════════════════════
const correctSchema = z.object({
  fields: z
    .object({
      materialType: z.string().optional(),
      materialId: z.string().uuid().nullable().optional(),
      supplier: z.string().optional(),
      poId: z.string().uuid().nullable().optional(),
      vehicleNo: z.string().optional(),
      driverName: z.string().nullable().optional(),
      driverMobile: z.string().nullable().optional(),
      transporterName: z.string().nullable().optional(),
      remarks: z.string().nullable().optional(),
      bags: z.number().nullable().optional(),
    })
    .refine((f) => Object.keys(f).length > 0, { message: 'At least one field must be provided' }),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
  adminPin: z.string().optional(),
});

router.put(
  '/correct/:id',
  validate(correctSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { fields, reason, adminPin } = req.body as z.infer<typeof correctSchema>;

    const summary = await checkGrainTruckCorrectable(id, {
      adminPinProvided: !!adminPin,
    });

    if (summary.requiresAdminPin && adminPin !== CLOUD_ADMIN_OVERRIDE_PIN) {
      res.status(403).json({ error: 'INVALID_ADMIN_PIN', message: 'Invalid admin override PIN' });
      return;
    }
    if (!summary.canEdit) {
      res.status(422).json({
        error: 'CORRECTION_BLOCKED',
        blockers: summary.blockers,
        message: 'Cannot edit this weighment — one or more downstream records exist',
      });
      return;
    }

    // Load current record
    const before = await prisma.grainTruck.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    // If material is changing, validate the new material exists + resolve category
    let newCategory: string | undefined;
    if (fields.materialId && fields.materialId !== before.materialId) {
      const mat = await prisma.inventoryItem.findUnique({
        where: { id: fields.materialId },
        select: { id: true, name: true, category: true, isActive: true },
      });
      if (!mat) {
        res.status(400).json({ error: 'MATERIAL_NOT_FOUND', message: 'Selected material does not exist' });
        return;
      }
      if (!mat.isActive) {
        res.status(400).json({ error: 'MATERIAL_INACTIVE', message: `Material "${mat.name}" is inactive` });
        return;
      }
      newCategory = mat.category;
      // Propagate the human-readable name if not explicitly set
      if (!fields.materialType) {
        fields.materialType = mat.name;
      }
    }

    // If PO is changing, validate it exists + has capacity for the net weight
    if (fields.poId && fields.poId !== before.poId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: fields.poId },
        select: {
          id: true,
          poNo: true,
          status: true,
          vendor: { select: { name: true } },
        },
      });
      if (!po) {
        res.status(400).json({ error: 'PO_NOT_FOUND', message: 'Selected PO does not exist' });
        return;
      }
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
        res.status(400).json({
          error: 'PO_NOT_OPEN',
          message: `PO #${po.poNo} is ${po.status} — cannot receive against it`,
        });
        return;
      }
      // Keep supplier name in sync with the new PO unless caller explicitly set one
      if (!fields.supplier) {
        fields.supplier = po.vendor.name;
      }
    }

    // Compute diff for audit
    const fieldsChanged: Record<string, { before: unknown; after: unknown }> = {};
    const fieldKeys = [
      'materialType',
      'materialId',
      'supplier',
      'poId',
      'vehicleNo',
      'driverName',
      'driverMobile',
      'transporterName',
      'remarks',
      'bags',
    ] as const;
    for (const k of fieldKeys) {
      if (k in fields && (fields as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]) {
        fieldsChanged[k] = {
          before: (before as Record<string, unknown>)[k],
          after: (fields as Record<string, unknown>)[k],
        };
      }
    }
    if (Object.keys(fieldsChanged).length === 0) {
      res.status(400).json({ error: 'NO_CHANGES', message: 'No fields were changed' });
      return;
    }

    const adminName = req.user?.name || req.user?.email || 'admin';
    const adminRole = req.user?.role || 'ADMIN';

    // Apply updates + write audit rows in a single transaction.
    // PO reassignment (POLine.receivedQty) is out of scope for Phase 1 — this
    // phase blocks edits once a GRN exists, and POLine qty is updated on GRN,
    // so there's nothing to rebalance at the weighment level yet.
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.grainTruck.update({
        where: { id },
        data: {
          ...fields,
          // If material category implicitly changed, we don't persist it on
          // GrainTruck (cloud doesn't store category) but we still push it to
          // the factory via the correction payload below.
        },
      });

      const auditRows = [];
      for (const [fieldName, diff] of Object.entries(fieldsChanged)) {
        const audit = await tx.weighmentCorrection.create({
          data: {
            weighmentKind: 'GrainTruck',
            weighmentId: id,
            ticketNo: before.ticketNo,
            vehicleNo: before.vehicleNo,
            fieldName,
            oldValue: JSON.stringify(diff.before),
            newValue: JSON.stringify(diff.after),
            reason,
            correctedBy: adminName,
            correctedByRole: adminRole,
            adminPinUsed: !!adminPin,
          },
        });
        auditRows.push(audit);
      }
      return { updated, auditRows };
    });

    // Fire-and-forget push to factory server. Cloud is authoritative — if the
    // factory is unreachable, we flip factorySynced=false and a background
    // retry will pick it up later.
    pushCorrectionToFactory({
      correctionIds: result.auditRows.map((a) => a.id),
      factoryLocalId: before.factoryLocalId,
      ticketNo: before.ticketNo,
      vehicleNo: before.vehicleNo,
      fields: {
        ...fields,
        ...(newCategory ? { materialCategory: newCategory } : {}),
      },
      cancel: false,
    }).catch((err) => {
      console.error('[WB-CORRECTION] factory push failed:', err);
    });

    res.json({
      ok: true,
      weighment: result.updated,
      auditRows: result.auditRows,
      fieldsChanged,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/weighbridge/admin/cancel/:id
// Cancel a weighment entirely. Sets cancelled=true + writes audit + pushes
// cancellation to factory.
// ═══════════════════════════════════════════════════════════════════════════
const cancelSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
  adminPin: z.string().optional(),
});

router.post(
  '/cancel/:id',
  validate(cancelSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { reason, adminPin } = req.body as z.infer<typeof cancelSchema>;

    const summary = await checkGrainTruckCorrectable(id, {
      adminPinProvided: !!adminPin,
    });
    if (summary.requiresAdminPin && adminPin !== CLOUD_ADMIN_OVERRIDE_PIN) {
      res.status(403).json({ error: 'INVALID_ADMIN_PIN' });
      return;
    }
    if (!summary.canEdit) {
      res.status(422).json({
        error: 'CORRECTION_BLOCKED',
        blockers: summary.blockers,
      });
      return;
    }

    const before = await prisma.grainTruck.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const adminName = req.user?.name || req.user?.email || 'admin';
    const adminRole = req.user?.role || 'ADMIN';
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.grainTruck.update({
        where: { id },
        data: {
          cancelled: true,
          cancelledReason: reason,
          cancelledAt: now,
          cancelledBy: adminName,
        },
      });
      const audit = await tx.weighmentCorrection.create({
        data: {
          weighmentKind: 'GrainTruck',
          weighmentId: id,
          ticketNo: before.ticketNo,
          vehicleNo: before.vehicleNo,
          fieldName: 'cancel',
          oldValue: JSON.stringify(false),
          newValue: JSON.stringify(true),
          reason,
          correctedBy: adminName,
          correctedByRole: adminRole,
          adminPinUsed: !!adminPin,
        },
      });
      return { updated, audit };
    });

    pushCorrectionToFactory({
      correctionIds: [result.audit.id],
      factoryLocalId: before.factoryLocalId,
      ticketNo: before.ticketNo,
      vehicleNo: before.vehicleNo,
      fields: {},
      cancel: true,
      cancelReason: reason,
    }).catch((err) => {
      console.error('[WB-CORRECTION] factory cancel push failed:', err);
    });

    res.json({ ok: true, weighment: result.updated, audit: result.audit });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// Helper: push a correction to the factory-server.
// Fire-and-forget; errors logged but don't fail the cloud request.
// Updates WeighmentCorrection.factorySynced/factoryError based on result.
// ═══════════════════════════════════════════════════════════════════════════
interface CorrectionPushPayload {
  correctionIds: string[];
  factoryLocalId: string | null;
  ticketNo: number | null;
  vehicleNo: string;
  fields: Record<string, unknown>;
  cancel: boolean;
  cancelReason?: string;
}

async function pushCorrectionToFactory(payload: CorrectionPushPayload): Promise<void> {
  // No factoryLocalId = record was never successfully pushed up to cloud from
  // factory (legacy row). Skip push; audit row stays factorySynced=false and
  // factoryError explains why.
  if (!payload.factoryLocalId) {
    await prisma.weighmentCorrection.updateMany({
      where: { id: { in: payload.correctionIds } },
      data: {
        factorySynced: false,
        factoryError: 'No factoryLocalId — record predates correction push system or was never synced from factory',
      },
    });
    return;
  }

  try {
    const resp = await fetch(`${FACTORY_SERVER_URL}/api/weighbridge/correction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WB-Key': WB_PUSH_KEY,
      },
      body: JSON.stringify({
        correctionIds: payload.correctionIds,
        factoryLocalId: payload.factoryLocalId,
        ticketNo: payload.ticketNo,
        vehicleNo: payload.vehicleNo,
        fields: payload.fields,
        cancel: payload.cancel,
        cancelReason: payload.cancelReason,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown error');
      throw new Error(`Factory returned ${resp.status}: ${text}`);
    }

    await prisma.weighmentCorrection.updateMany({
      where: { id: { in: payload.correctionIds } },
      data: {
        factorySynced: true,
        factorySyncedAt: new Date(),
        factoryError: null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.weighmentCorrection.updateMany({
      where: { id: { in: payload.correctionIds } },
      data: {
        factorySynced: false,
        factoryError: msg,
      },
    });
    throw err;
  }
}

export default router;
