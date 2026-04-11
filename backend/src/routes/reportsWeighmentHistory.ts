/**
 * GET /api/reports/weighment-history
 *
 * Unified weighment history report across GrainTruck (inbound), DispatchTruck (ethanol outbound),
 * and DDGSDispatchTruck (DDGS outbound).  Supports JSON and xlsx export.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { ValidationError } from '../shared/errors';
import prisma from '../config/prisma';
import {
  UnifiedWeighmentRow,
  normalizeGrainTruck,
  normalizeDispatchTruck,
  normalizeDDGSDispatchTruck,
  normalizeMirror,
  GrainTruckRecord,
  DispatchTruckRecord,
  DDGSDispatchTruckRecord,
  WeighmentMirrorRecord,
} from '../utils/weighmentNormalize';
import { streamXlsxResponse } from '../utils/xlsxExport';

const router = Router();

// ──────────────────────────────────────────────────────────
// Query-param schema (no body — GET only)
// ──────────────────────────────────────────────────────────

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  materialType: z.enum(['ETHANOL', 'DDGS', 'RAW_MATERIAL', 'FUEL', 'OTHER', 'ALL']).optional().default('ALL'),
  direction: z.enum(['INBOUND', 'OUTBOUND', 'ALL']).optional().default('ALL'),
  status: z.enum(['PENDING', 'PARTIAL', 'COMPLETE', 'CANCELLED', 'ALL']).optional().default('ALL'),
  partyId: z.string().optional(),
  search: z.string().optional(),
  onlyCompleted: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v ?? '100', 10);
      return isNaN(n) ? 100 : Math.min(Math.max(n, 1), 1000);
    }),
  offset: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v ?? '0', 10);
      return isNaN(n) ? 0 : Math.max(n, 0);
    }),
  format: z.enum(['json', 'xlsx']).optional().default('json'),
  source: z.enum(['mirror', 'legacy', 'auto']).optional().default('auto'),
});

type QueryParams = z.output<typeof querySchema>;

// ──────────────────────────────────────────────────────────
// Date-range helpers
// ──────────────────────────────────────────────────────────

function parseDateRange(
  from: string | undefined,
  to: string | undefined,
): { fromDate: Date | undefined; toDate: Date | undefined } {
  let fromDate: Date | undefined;
  let toDate: Date | undefined;

  // Dates are in IST (UTC+5:30).  Convert to UTC for Prisma queries.
  // "from" = start of IST day → 00:00 IST = previous day 18:30 UTC
  // "to"   = end of IST day   → 23:59:59 IST = same day 18:29:59 UTC
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  if (from) {
    fromDate = new Date(new Date(from).getTime() - IST_OFFSET_MS);
    if (isNaN(fromDate.getTime())) throw new ValidationError('Invalid `from` date');
  }
  if (to) {
    const endOfDayIST = new Date(to);
    endOfDayIST.setHours(23, 59, 59, 999);
    toDate = new Date(endOfDayIST.getTime() - IST_OFFSET_MS);
    if (isNaN(toDate.getTime())) throw new ValidationError('Invalid `to` date');
  }

  return { fromDate, toDate };
}

// ──────────────────────────────────────────────────────────
// Prisma fetch helpers (run in parallel)
// ──────────────────────────────────────────────────────────

async function fetchGrainTrucks(
  fromDate: Date | undefined,
  toDate: Date | undefined,
  xlsxMode: boolean,
): Promise<GrainTruckRecord[]> {
  const dateFilter =
    fromDate || toDate
      ? {
          createdAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {};

  return prisma.grainTruck.findMany({
    take: xlsxMode ? 10000 : undefined, // cap applied at merge layer for json
    where: dateFilter,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      ticketNo: true,
      vehicleNo: true,
      supplier: true,
      materialType: true,
      weightGross: true,
      weightTare: true,
      weightNet: true,
      cancelled: true,
      createdAt: true,
    },
  });
}

async function fetchDispatchTrucks(
  fromDate: Date | undefined,
  toDate: Date | undefined,
  xlsxMode: boolean,
): Promise<DispatchTruckRecord[]> {
  const dateFilter =
    fromDate || toDate
      ? {
          gateInTime: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {};

  return prisma.dispatchTruck.findMany({
    take: xlsxMode ? 10000 : undefined,
    where: dateFilter,
    orderBy: { gateInTime: 'desc' },
    select: {
      id: true,
      vehicleNo: true,
      partyName: true,
      weightGross: true,
      weightTare: true,
      weightNet: true,
      gateInTime: true,
      tareTime: true,
      grossTime: true,
      releaseTime: true,
      status: true,
      shipToCustomerId: true,
      createdAt: true,
    },
  });
}

async function fetchDDGSTrucks(
  fromDate: Date | undefined,
  toDate: Date | undefined,
  xlsxMode: boolean,
): Promise<DDGSDispatchTruckRecord[]> {
  const dateFilter =
    fromDate || toDate
      ? {
          gateInTime: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {};

  return prisma.dDGSDispatchTruck.findMany({
    take: xlsxMode ? 10000 : undefined,
    where: dateFilter,
    orderBy: { gateInTime: 'desc' },
    select: {
      id: true,
      rstNo: true,
      vehicleNo: true,
      partyName: true,
      weightGross: true,
      weightTare: true,
      weightNet: true,
      gateInTime: true,
      tareTime: true,
      grossTime: true,
      releaseTime: true,
      status: true,
      customerId: true,
      createdAt: true,
    },
  });
}

// ──────────────────────────────────────────────────────────
// Mirror fetch helper
// ──────────────────────────────────────────────────────────

async function fetchMirrorWeighments(
  params: QueryParams,
  fromDate: Date | undefined,
  toDate: Date | undefined,
  xlsxMode: boolean,
): Promise<WeighmentMirrorRecord[]> {
  const where: Record<string, unknown> = {};

  // Date range on gateEntryAt
  if (fromDate || toDate) {
    where.gateEntryAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  // Direction
  if (params.direction !== 'ALL') {
    where.direction = params.direction;
  }

  // Material category → materialType mapping
  if (params.materialType !== 'ALL') {
    const catMap: Record<string, string[]> = {
      ETHANOL: ['ETHANOL'],
      DDGS: ['DDGS'],
      RAW_MATERIAL: ['RAW_MATERIAL'],
      FUEL: ['FUEL'],
      OTHER: ['OTHER'],
    };
    const cats = catMap[params.materialType];
    if (cats) {
      where.materialCategory = { in: cats };
    }
  }

  // Status
  if (params.status !== 'ALL') {
    if (params.status === 'COMPLETE') {
      where.status = { in: ['COMPLETE', 'RELEASED'] };
      where.cancelled = false;
    } else if (params.status === 'CANCELLED') {
      where.cancelled = true;
    } else if (params.status === 'PENDING') {
      where.status = { in: ['GATE_ENTRY', 'GATE_IN', 'PENDING'] };
      where.cancelled = false;
    } else {
      // PARTIAL — anything not complete/pending/cancelled
      where.status = { notIn: ['COMPLETE', 'RELEASED', 'GATE_ENTRY', 'GATE_IN', 'PENDING'] };
      where.cancelled = false;
    }
  }

  // Only completed filter
  if (params.onlyCompleted) {
    where.status = { in: ['COMPLETE', 'RELEASED'] };
    where.cancelled = false;
  }

  // Search: vehicleNo, supplierName, customerName, ticketNo
  if (params.search) {
    const needle = params.search;
    const ticketNum = parseInt(needle, 10);
    const orClauses: unknown[] = [
      { vehicleNo: { contains: needle, mode: 'insensitive' } },
      { supplierName: { contains: needle, mode: 'insensitive' } },
      { customerName: { contains: needle, mode: 'insensitive' } },
    ];
    if (!isNaN(ticketNum)) {
      orClauses.push({ ticketNo: ticketNum });
    }
    where.OR = orClauses;
  }

  return prisma.weighment.findMany({
    take: xlsxMode ? 10000 : undefined,
    where,
    orderBy: { gateEntryAt: 'desc' },
    select: {
      id: true,
      localId: true,
      ticketNo: true,
      vehicleNo: true,
      direction: true,
      supplierName: true,
      customerName: true,
      materialName: true,
      materialCategory: true,
      supplierId: true,
      customerId: true,
      grossWeight: true,
      tareWeight: true,
      netWeight: true,
      gateEntryAt: true,
      firstWeightAt: true,
      secondWeightAt: true,
      releaseAt: true,
      status: true,
      cancelled: true,
      rstNo: true,
    },
  }) as Promise<WeighmentMirrorRecord[]>;
}

// ──────────────────────────────────────────────────────────
// Post-normalization filter + sort
// ──────────────────────────────────────────────────────────

function applyFilters(rows: UnifiedWeighmentRow[], params: QueryParams): UnifiedWeighmentRow[] {
  let result = rows;

  if (params.materialType !== 'ALL') {
    result = result.filter((r) => r.materialType === params.materialType);
  }
  if (params.direction !== 'ALL') {
    result = result.filter((r) => r.direction === params.direction);
  }
  if (params.status !== 'ALL') {
    result = result.filter((r) => r.status === params.status);
  }
  if (params.partyId) {
    result = result.filter((r) => r.partyId === params.partyId);
  }
  if (params.onlyCompleted) {
    result = result.filter((r) => r.status === 'COMPLETE');
    // When onlyCompleted, use secondWeightAt for the date filter (already applied at DB layer,
    // but apply again here as an in-memory guard for rows that slipped through via createdAt fallback)
    if (params.from || params.to) {
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const fromMs = params.from ? new Date(params.from).getTime() - IST_OFFSET_MS : -Infinity;
      const toEndIST = params.to ? new Date(params.to) : null;
      if (toEndIST) toEndIST.setHours(23, 59, 59, 999);
      const toMs = toEndIST ? toEndIST.getTime() - IST_OFFSET_MS : Infinity;
      result = result.filter((r) => {
        const ts = r.secondWeightAt ? new Date(r.secondWeightAt).getTime() : null;
        if (!ts) return false;
        return ts >= fromMs && ts <= toMs;
      });
    }
  }
  if (params.search) {
    const needle = params.search.toLowerCase();
    result = result.filter(
      (r) =>
        r.vehicleNo.toLowerCase().includes(needle) ||
        r.partyName.toLowerCase().includes(needle),
    );
  }

  // Sort by gateEntryAt descending
  result.sort((a, b) => {
    const ta = a.gateEntryAt ? new Date(a.gateEntryAt).getTime() : 0;
    const tb = b.gateEntryAt ? new Date(b.gateEntryAt).getTime() : 0;
    return tb - ta;
  });

  return result;
}

// ──────────────────────────────────────────────────────────
// xlsx column definition
// ──────────────────────────────────────────────────────────

const XLSX_COLUMNS = [
  { header: 'Date', key: 'gateEntryAt', width: 20, type: 'string' as const },
  { header: 'Ticket', key: 'ticketNo', width: 10, type: 'number' as const },
  { header: 'Vehicle No', key: 'vehicleNo', width: 14 },
  { header: 'Party', key: 'partyName', width: 28 },
  { header: 'Direction', key: 'direction', width: 11 },
  { header: 'Material', key: 'materialType', width: 14 },
  { header: 'Item Name', key: 'materialName', width: 20 },
  { header: 'Gate In', key: 'gateEntryAt_fmt', width: 20 },
  { header: '1st Wt Time', key: 'firstWeightAt', width: 20 },
  { header: '2nd Wt Time', key: 'secondWeightAt', width: 20 },
  { header: 'Gross (kg)', key: 'grossWeight', width: 12, type: 'number' as const, numFmt: '#,##0' },
  { header: 'Tare (kg)', key: 'tareWeight', width: 12, type: 'number' as const, numFmt: '#,##0' },
  { header: 'Net (kg)', key: 'netWeight', width: 12, type: 'number' as const, numFmt: '#,##0' },
  { header: 'Gate→1st (min)', key: 'durationGateToFirstMin', width: 15, type: 'number' as const, numFmt: '#,##0' },
  { header: '1st→2nd (min)', key: 'durationFirstToSecondMin', width: 15, type: 'number' as const, numFmt: '#,##0' },
  { header: 'Turnaround (min)', key: 'turnaroundMin', width: 16, type: 'number' as const, numFmt: '#,##0' },
  { header: 'Status', key: 'status', width: 12 },
];

function toXlsxRow(r: UnifiedWeighmentRow): Record<string, unknown> {
  return {
    gateEntryAt: r.gateEntryAt ?? '',
    ticketNo: r.ticketNo ?? '',
    vehicleNo: r.vehicleNo,
    partyName: r.partyName,
    direction: r.direction,
    materialType: r.materialType,
    materialName: r.materialName ?? '',
    gateEntryAt_fmt: r.gateEntryAt ?? '',
    firstWeightAt: r.firstWeightAt ?? '',
    secondWeightAt: r.secondWeightAt ?? '',
    grossWeight: r.grossWeight ?? '',
    tareWeight: r.tareWeight ?? '',
    netWeight: r.netWeight ?? '',
    durationGateToFirstMin: r.durationGateToFirstMin ?? '',
    durationFirstToSecondMin: r.durationFirstToSecondMin ?? '',
    turnaroundMin: r.turnaroundMin ?? '',
    status: r.status,
  };
}

// ──────────────────────────────────────────────────────────
// Route
// ──────────────────────────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));
    }
    const params = parsed.data;

    const { fromDate, toDate } = parseDateRange(params.from, params.to);
    const xlsxMode = params.format === 'xlsx';

    // ── Mirror-first branch ─────────────────────────────────
    // Decide whether to use the mirror table or the legacy union.
    // 'auto'   → use mirror if it has any rows, else fall through to legacy
    // 'mirror' → always use mirror
    // 'legacy' → always use legacy union (original code path below)

    let useMirror = false;
    if (params.source === 'mirror') {
      useMirror = true;
    } else if (params.source === 'auto') {
      const mirrorCount = await prisma.weighment.count();
      useMirror = mirrorCount > 0;
    }

    if (useMirror) {
      const mirrorRaw = await fetchMirrorWeighments(params, fromDate, toDate, xlsxMode);
      // fetchMirrorWeighments already pushed all filters (direction, material,
      // status, date range, search with ticketNo, onlyCompleted) down to
      // Postgres and ordered by gateEntryAt desc. Do NOT run the legacy
      // applyFilters() post-filter here — its substring search on
      // vehicleNo/partyName would strip rows that were matched by ticketNo.
      const filtered: UnifiedWeighmentRow[] = mirrorRaw.map(normalizeMirror);

      if (xlsxMode) {
        const exportRows = filtered.slice(0, 10000).map(toXlsxRow);
        const today = new Date().toISOString().slice(0, 10);
        await streamXlsxResponse(
          res,
          `weighment-history-${today}.xlsx`,
          'Weighment History',
          XLSX_COLUMNS,
          exportRows,
        );
        return;
      }

      const total = filtered.length;
      const paginated = filtered.slice(params.offset, params.offset + params.limit);
      res.json({ total, limit: params.limit, offset: params.offset, data: paginated, source: 'mirror' });
      return;
    }

    // ── Legacy union (original code path — DO NOT MODIFY) ───

    // Determine which sources to query based on direction + materialType filters
    const wantInbound =
      params.direction === 'ALL' || params.direction === 'INBOUND';
    const wantOutbound =
      params.direction === 'ALL' || params.direction === 'OUTBOUND';
    const wantEthanol =
      params.materialType === 'ALL' || params.materialType === 'ETHANOL';
    const wantDDGS =
      params.materialType === 'ALL' || params.materialType === 'DDGS';
    const wantRaw =
      params.materialType === 'ALL' ||
      params.materialType === 'RAW_MATERIAL' ||
      params.materialType === 'FUEL' ||
      params.materialType === 'OTHER';

    const [grainRaw, dispatchRaw, ddgsRaw] = await Promise.all([
      wantInbound && wantRaw
        ? fetchGrainTrucks(fromDate, toDate, xlsxMode)
        : Promise.resolve([] as GrainTruckRecord[]),
      wantOutbound && wantEthanol
        ? fetchDispatchTrucks(fromDate, toDate, xlsxMode)
        : Promise.resolve([] as DispatchTruckRecord[]),
      wantOutbound && wantDDGS
        ? fetchDDGSTrucks(fromDate, toDate, xlsxMode)
        : Promise.resolve([] as DDGSDispatchTruckRecord[]),
    ]);

    // Normalize
    const normalized: UnifiedWeighmentRow[] = [
      ...grainRaw.map(normalizeGrainTruck),
      ...dispatchRaw.map(normalizeDispatchTruck),
      ...ddgsRaw.map(normalizeDDGSDispatchTruck),
    ];

    // Apply post-normalization filters + sort
    const filtered = applyFilters(normalized, params);

    // Excel export — no pagination, cap at 10 000
    if (xlsxMode) {
      const exportRows = filtered.slice(0, 10000).map(toXlsxRow);
      const today = new Date().toISOString().slice(0, 10);
      await streamXlsxResponse(
        res,
        `weighment-history-${today}.xlsx`,
        'Weighment History',
        XLSX_COLUMNS,
        exportRows,
      );
      return;
    }

    // JSON — paginate
    const total = filtered.length;
    const paginated = filtered.slice(params.offset, params.offset + params.limit);

    res.json({
      total,
      limit: params.limit,
      offset: params.offset,
      data: paginated,
    });
  }),
);

export default router;
