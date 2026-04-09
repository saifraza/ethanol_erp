/**
 * GET /api/weighment/audit
 *
 * Health check — mirror counts + legacy table counts + drift detection.
 * Auth: JWT (authenticate) + ADMIN role.
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';

const router = Router();

// All routes require auth + ADMIN
router.use(authenticate, authorize('ADMIN'));

// ──────────────────────────────────────────────────────────
// Response shape
// ──────────────────────────────────────────────────────────

interface MirrorCounts {
  total: number;
  inbound: number;
  outbound: number;
  completed: number;
  gateEntry: number;
  firstDone: number;
  cancelled: number;
  byCategory: {
    RAW_MATERIAL: number;
    FUEL: number;
    ETHANOL: number;
    DDGS: number;
    SUGAR: number;
    OTHER: number;
  };
  latestSyncedAt: string | null;
  earliestFactoryCreatedAt: string | null;
}

interface LegacyCounts {
  grainTruck: number;
  goodsReceipt: number;
  dispatchTruck: number;
  ddgsDispatchTruck: number;
  sugarDispatchTruck: number;
  directPurchase: number;
  total: number;
}

interface DriftResult {
  mirrorCount: number;
  legacyEstimate: number;
  delta: number;
  interpretation: string;
}

interface AuditResponse {
  mirror: MirrorCounts;
  legacy: LegacyCounts;
  drift: DriftResult;
}

// ──────────────────────────────────────────────────────────
// Route
// ──────────────────────────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    // Run all counts in parallel
    const [
      mirrorTotal,
      mirrorInbound,
      mirrorOutbound,
      mirrorCompleted,
      mirrorGateEntry,
      mirrorFirstDone,
      mirrorCancelled,
      mirrorCatRaw,
      mirrorCatFuel,
      mirrorCatEthanol,
      mirrorCatDdgs,
      mirrorCatSugar,
      mirrorCatOther,
      mirrorLatest,
      mirrorEarliest,
      legacyGrainTruck,
      legacyGoodsReceipt,
      legacyDispatchTruck,
      legacyDdgsDispatchTruck,
      legacySugarDispatchTruck,
      legacyDirectPurchase,
    ] = await Promise.all([
      // Mirror totals
      prisma.weighment.count(),
      prisma.weighment.count({ where: { direction: 'INBOUND' } }),
      prisma.weighment.count({ where: { direction: 'OUTBOUND' } }),
      prisma.weighment.count({ where: { status: { in: ['COMPLETE', 'RELEASED'] } } }),
      prisma.weighment.count({ where: { status: 'GATE_ENTRY' } }),
      prisma.weighment.count({ where: { firstWeightAt: { not: null } } }),
      prisma.weighment.count({ where: { cancelled: true } }),
      // Mirror by category
      prisma.weighment.count({ where: { materialCategory: 'RAW_MATERIAL' } }),
      prisma.weighment.count({ where: { materialCategory: 'FUEL' } }),
      prisma.weighment.count({ where: { materialCategory: 'ETHANOL' } }),
      prisma.weighment.count({ where: { materialCategory: 'DDGS' } }),
      prisma.weighment.count({ where: { materialCategory: 'SUGAR' } }),
      prisma.weighment.count({
        where: {
          materialCategory: {
            notIn: ['RAW_MATERIAL', 'FUEL', 'ETHANOL', 'DDGS', 'SUGAR'],
          },
        },
      }),
      // Mirror sentinel timestamps (single row queries)
      prisma.weighment.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      prisma.weighment.findFirst({
        orderBy: { factoryCreatedAt: 'asc' },
        select: { factoryCreatedAt: true },
      }),
      // Legacy table counts
      prisma.grainTruck.count(),
      prisma.goodsReceipt.count(),
      prisma.dispatchTruck.count(),
      prisma.dDGSDispatchTruck.count(),
      prisma.sugarDispatchTruck.count(),
      prisma.directPurchase.count(),
    ]);

    const legacyTotal =
      legacyGrainTruck +
      legacyGoodsReceipt +
      legacyDispatchTruck +
      legacyDdgsDispatchTruck +
      legacySugarDispatchTruck +
      legacyDirectPurchase;

    const delta = mirrorTotal - legacyTotal;
    let interpretation: string;
    if (mirrorTotal === 0) {
      interpretation = 'mirror empty — sync not yet run';
    } else if (Math.abs(delta) <= 5) {
      interpretation = 'healthy — mirror and legacy in sync';
    } else if (delta < 0) {
      interpretation = `mirror behind legacy by ${Math.abs(delta)} rows`;
    } else {
      interpretation = `mirror ahead of legacy by ${delta} rows (expected as mirror covers more sources)`;
    }

    const response: AuditResponse = {
      mirror: {
        total: mirrorTotal,
        inbound: mirrorInbound,
        outbound: mirrorOutbound,
        completed: mirrorCompleted,
        gateEntry: mirrorGateEntry,
        firstDone: mirrorFirstDone,
        cancelled: mirrorCancelled,
        byCategory: {
          RAW_MATERIAL: mirrorCatRaw,
          FUEL: mirrorCatFuel,
          ETHANOL: mirrorCatEthanol,
          DDGS: mirrorCatDdgs,
          SUGAR: mirrorCatSugar,
          OTHER: mirrorCatOther,
        },
        latestSyncedAt: mirrorLatest?.syncedAt?.toISOString() ?? null,
        earliestFactoryCreatedAt: mirrorEarliest?.factoryCreatedAt?.toISOString() ?? null,
      },
      legacy: {
        grainTruck: legacyGrainTruck,
        goodsReceipt: legacyGoodsReceipt,
        dispatchTruck: legacyDispatchTruck,
        ddgsDispatchTruck: legacyDdgsDispatchTruck,
        sugarDispatchTruck: legacySugarDispatchTruck,
        directPurchase: legacyDirectPurchase,
        total: legacyTotal,
      },
      drift: {
        mirrorCount: mirrorTotal,
        legacyEstimate: legacyTotal,
        delta,
        interpretation,
      },
    };

    res.json(response);
  }),
);

export default router;
