/**
 * reportsWeighmentHistory.ts
 * GET /api/reports/weighment-history
 *
 * Returns a paginated, filterable list of weighment records normalised to
 * UnifiedWeighmentRow. Supports JSON and Excel export.
 *
 * Query params (all optional):
 *   from          ISO date — start of gateEntryAt range (or secondWeightAt when onlyCompleted=true)
 *   to            ISO date — end of range
 *   materialType  ETHANOL|DDGS|RAW_MATERIAL|FUEL|OTHER|ALL  (default ALL)
 *   direction     INBOUND|OUTBOUND|ALL  (default ALL)
 *   status        PENDING|PARTIAL|COMPLETE|ALL  (default ALL)
 *   search        substring match on vehicleNo or supplierName/shipToName
 *   onlyCompleted boolean — only COMPLETE records, filter on secondWeightAt
 *   limit         default 100, max 1000
 *   offset        default 0
 *   format        json|xlsx  (default json)
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware';
import prisma from '../prisma';
import { normalize, RawWeighment, UnifiedMaterialType, UnifiedStatus } from '../utils/weighmentNormalize';
import { streamXlsxResponse } from '../utils/xlsxExport';

const router = Router();

// Reverse-map unified status → DB status values
const STATUS_DB_MAP: Record<string, string[]> = {
  PENDING:   ['GATE_ENTRY'],
  PARTIAL:   ['FIRST_DONE'],
  COMPLETE:  ['COMPLETE'],
  CANCELLED: ['CANCELLED'],
};

// Reverse-map unified materialType → materialCategory values
const MATERIAL_DB_MAP: Record<string, string[]> = {
  RAW_MATERIAL: ['RAW_MATERIAL'],
  FUEL:         ['FUEL'],
  ETHANOL:      ['ETHANOL'],
  DDGS:         ['DDGS'],
  OTHER:        ['CHEMICAL', 'PACKING', 'OTHER'],  // catch-all
};

const SELECT_FIELDS = {
  id: true,
  ticketNo: true,
  direction: true,
  materialCategory: true,
  materialName: true,
  vehicleNo: true,
  supplierName: true,
  shipToName: true,
  grossWeight: true,
  tareWeight: true,
  netWeight: true,
  gateEntryAt: true,
  firstWeightAt: true,
  secondWeightAt: true,
  status: true,
} as const;

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const {
    from,
    to,
    materialType,
    direction,
    status,
    search,
    onlyCompleted,
    limit: limitStr,
    offset: offsetStr,
    format,
  } = req.query as Record<string, string | undefined>;

  const take   = Math.min(parseInt(limitStr  || '100') || 100, 1000);
  const skip   = parseInt(offsetStr || '0') || 0;
  const isXlsx = format === 'xlsx';

  // Build Prisma where clause
  type WhereClause = {
    direction?: string;
    materialCategory?: { in: string[] };
    status?: { in: string[] };
    gateEntryAt?: { gte?: Date; lte?: Date };
    secondWeightAt?: { gte?: Date; lte?: Date };
    OR?: Array<{
      vehicleNo?: { contains: string; mode: 'insensitive' };
      supplierName?: { contains: string; mode: 'insensitive' };
      shipToName?: { contains: string; mode: 'insensitive' };
    }>;
  };

  const where: WhereClause = {};

  // direction filter
  if (direction && direction !== 'ALL') {
    const d = direction.toUpperCase();
    if (d === 'INBOUND' || d === 'OUTBOUND') {
      where.direction = d;
    }
  }

  // materialType filter
  if (materialType && materialType !== 'ALL') {
    const mt = materialType.toUpperCase() as UnifiedMaterialType;
    const dbCats = MATERIAL_DB_MAP[mt];
    if (dbCats) {
      where.materialCategory = { in: dbCats };
    }
  }

  // status filter (onlyCompleted overrides explicit status)
  const useOnlyCompleted = onlyCompleted === 'true' || onlyCompleted === '1';
  if (useOnlyCompleted) {
    where.status = { in: ['COMPLETE'] };
  } else if (status && status !== 'ALL') {
    const s = status.toUpperCase() as UnifiedStatus;
    const dbStatuses = STATUS_DB_MAP[s];
    if (dbStatuses) {
      where.status = { in: dbStatuses };
    }
  }

  // date range filter
  const dateField = useOnlyCompleted ? 'secondWeightAt' : 'gateEntryAt';
  if (from || to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) range.gte = d;
    }
    if (to) {
      // end of day: set to 23:59:59.999
      const d = new Date(to);
      if (!isNaN(d.getTime())) {
        d.setUTCHours(23, 59, 59, 999);
        range.lte = d;
      }
    }
    if (Object.keys(range).length > 0) {
      where[dateField] = range;
    }
  }

  // search filter
  if (search && search.trim()) {
    const term = search.trim();
    where.OR = [
      { vehicleNo:    { contains: term, mode: 'insensitive' } },
      { supplierName: { contains: term, mode: 'insensitive' } },
      { shipToName:   { contains: term, mode: 'insensitive' } },
    ];
  }

  // xlsx has higher row cap (10000), JSON uses take/skip pagination
  const xlsxCap = 10000;

  const rows = await prisma.weighment.findMany({
    where,
    take: isXlsx ? xlsxCap : take,
    skip: isXlsx ? 0 : skip,
    orderBy: { gateEntryAt: 'desc' },
    select: SELECT_FIELDS,
  });

  const normalized = (rows as unknown as RawWeighment[]).map(normalize);

  if (isXlsx) {
    const datePart = new Date().toISOString().slice(0, 10);
    const filename = `weighment-history-${datePart}.xlsx`;
    await streamXlsxResponse(res, normalized, filename);
    return;
  }

  // For JSON, also return total count for pagination
  const total = await prisma.weighment.count({ where });

  res.json({
    data: normalized,
    meta: {
      total,
      take,
      skip,
      returned: normalized.length,
    },
  });
}));

export default router;
