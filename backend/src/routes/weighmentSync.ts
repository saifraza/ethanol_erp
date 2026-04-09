/**
 * POST /api/weighment/sync
 *
 * Factory posts raw Weighment rows. Cloud upserts into the mirror table by localId.
 * Pure mirror — no GRN creation, no inventory, no business logic.
 *
 * Auth: X-WB-Key header (timing-safe) — machine-to-machine, no JWT.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';

const router = Router();

// ──────────────────────────────────────────────────────────
// Auth — mirror of checkWBKey in weighbridge/shared.ts
// ──────────────────────────────────────────────────────────

const WB_PUSH_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

function checkWBKey(req: Request, res: Response): boolean {
  const key = (req.headers['x-wb-key'] as string) || '';
  if (!key || key.length !== WB_PUSH_KEY.length) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  const keyBuf = Buffer.from(key, 'utf8');
  const expectedBuf = Buffer.from(WB_PUSH_KEY, 'utf8');
  if (!crypto.timingSafeEqual(keyBuf, expectedBuf)) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────
// Zod schema for a single row in the batch
// ──────────────────────────────────────────────────────────

const rowSchema = z.object({
  id: z.string(),
  localId: z.string().min(1),
  ticketNo: z.number().nullable().optional(),
  vehicleNo: z.string(),
  direction: z.string(),
  supplierName: z.string().optional(),
  customerName: z.string().optional(),
  shipToName: z.string().optional(),
  materialName: z.string().optional(),
  materialCategory: z.string().optional(),
  purchaseType: z.string().optional(),
  poId: z.string().optional(),
  poLineId: z.string().optional(),
  supplierId: z.string().optional(),
  customerId: z.string().optional(),
  grossWeight: z.number().nullable().optional(),
  tareWeight: z.number().nullable().optional(),
  netWeight: z.number().nullable().optional(),
  grossTime: z.string().nullable().optional(),
  tareTime: z.string().nullable().optional(),
  gateEntryAt: z.string().nullable().optional(),
  firstWeightAt: z.string().nullable().optional(),
  secondWeightAt: z.string().nullable().optional(),
  releaseAt: z.string().nullable().optional(),
  status: z.string(),
  labStatus: z.string().nullable().optional(),
  labMoisture: z.number().nullable().optional(),
  labStarch: z.number().nullable().optional(),
  labDamaged: z.number().nullable().optional(),
  labForeignMatter: z.number().nullable().optional(),
  labRemarks: z.string().nullable().optional(),
  driverName: z.string().nullable().optional(),
  driverPhone: z.string().nullable().optional(),
  driverLicense: z.string().nullable().optional(),
  transporterName: z.string().nullable().optional(),
  transporterGstin: z.string().nullable().optional(),
  vehicleType: z.string().nullable().optional(),
  bags: z.number().nullable().optional(),
  rate: z.number().nullable().optional(),
  strength: z.number().nullable().optional(),
  quantityBL: z.number().nullable().optional(),
  sealNo: z.string().nullable().optional(),
  rstNo: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  cancelled: z.boolean().nullable().optional(),
  cancelledReason: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(500),
});

type SyncRow = z.infer<typeof rowSchema>;

// ──────────────────────────────────────────────────────────
// Date coercion helper — returns null on invalid input
// ──────────────────────────────────────────────────────────

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// ──────────────────────────────────────────────────────────
// Upsert a single row into the mirror table
// ──────────────────────────────────────────────────────────

interface UpsertData {
  localId: string;
  ticketNo: number | null;
  vehicleNo: string;
  direction: string;
  supplierName: string | null;
  customerName: string | null;
  shipToName: string | null;
  materialName: string | null;
  materialCategory: string | null;
  purchaseType: string | null;
  poId: string | null;
  poLineId: string | null;
  supplierId: string | null;
  customerId: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  grossTime: Date | null;
  tareTime: Date | null;
  gateEntryAt: Date | null;
  firstWeightAt: Date | null;
  secondWeightAt: Date | null;
  releaseAt: Date | null;
  status: string;
  labStatus: string | null;
  labMoisture: number | null;
  labStarch: number | null;
  labDamaged: number | null;
  labForeignMatter: number | null;
  labRemarks: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverLicense: string | null;
  transporterName: string | null;
  transporterGstin: string | null;
  vehicleType: string | null;
  bags: number | null;
  rate: number | null;
  strength: number | null;
  quantityBL: number | null;
  sealNo: string | null;
  rstNo: string | null;
  remarks: string | null;
  cancelled: boolean;
  cancelledReason: string | null;
  cancelledAt: Date | null;
  factoryCreatedAt: Date | null;
  factoryUpdatedAt: Date | null;
  rawPayload: SyncRow;
}

function buildUpsertData(row: SyncRow, syncedFromIp: string): UpsertData {
  return {
    localId: row.localId,
    ticketNo: row.ticketNo ?? null,
    vehicleNo: row.vehicleNo,
    direction: row.direction,
    supplierName: row.supplierName ?? null,
    customerName: row.customerName ?? null,
    shipToName: row.shipToName ?? null,
    materialName: row.materialName ?? null,
    materialCategory: row.materialCategory ?? null,
    purchaseType: row.purchaseType ?? null,
    poId: row.poId ?? null,
    poLineId: row.poLineId ?? null,
    supplierId: row.supplierId ?? null,
    customerId: row.customerId ?? null,
    grossWeight: row.grossWeight ?? null,
    tareWeight: row.tareWeight ?? null,
    netWeight: row.netWeight ?? null,
    grossTime: parseDate(row.grossTime),
    tareTime: parseDate(row.tareTime),
    gateEntryAt: parseDate(row.gateEntryAt),
    firstWeightAt: parseDate(row.firstWeightAt),
    secondWeightAt: parseDate(row.secondWeightAt),
    releaseAt: parseDate(row.releaseAt),
    status: row.status,
    labStatus: row.labStatus ?? null,
    labMoisture: row.labMoisture ?? null,
    labStarch: row.labStarch ?? null,
    labDamaged: row.labDamaged ?? null,
    labForeignMatter: row.labForeignMatter ?? null,
    labRemarks: row.labRemarks ?? null,
    driverName: row.driverName ?? null,
    driverPhone: row.driverPhone ?? null,
    driverLicense: row.driverLicense ?? null,
    transporterName: row.transporterName ?? null,
    transporterGstin: row.transporterGstin ?? null,
    vehicleType: row.vehicleType ?? null,
    bags: row.bags ?? null,
    rate: row.rate ?? null,
    strength: row.strength ?? null,
    quantityBL: row.quantityBL ?? null,
    sealNo: row.sealNo ?? null,
    rstNo: row.rstNo ?? null,
    remarks: row.remarks ?? null,
    cancelled: row.cancelled ?? false,
    cancelledReason: row.cancelledReason ?? null,
    cancelledAt: parseDate(row.cancelledAt),
    factoryCreatedAt: parseDate(row.createdAt),
    factoryUpdatedAt: parseDate(row.updatedAt),
    rawPayload: row,
  };
}

// ──────────────────────────────────────────────────────────
// Route
// ──────────────────────────────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkWBKey(req, res)) return;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Validation failed',
        details: parsed.error.errors.map((e) => e.message).join('; '),
      });
      return;
    }

    const { rows } = parsed.data;
    const syncedFromIp = req.ip ?? 'unknown';

    const processedLocalIds: string[] = [];
    const failed: Array<{ localId: string; error: string }> = [];

    for (const row of rows) {
      try {
        const data = buildUpsertData(row, syncedFromIp);

        await prisma.weighment.upsert({
          where: { localId: row.localId },
          create: {
            ...data,
            syncedFromIp,
          },
          update: {
            ...data,
            syncedAt: new Date(),
            mirrorVersion: { increment: 1 },
          },
        });

        processedLocalIds.push(row.localId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        failed.push({ localId: row.localId, error: message });
      }
    }

    res.json({
      ok: true,
      count: processedLocalIds.length,
      processedLocalIds,
      failed,
    });
  }),
);

export default router;
