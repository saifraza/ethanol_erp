import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate);

function getDateRange(dateStr: string) {
  const start = new Date(dateStr + 'T00:00:00.000Z');
  const end = new Date(dateStr + 'T23:59:59.999Z');
  return { start, end };
}

// GET /generate?date=YYYY-MM-DD
router.get('/generate', asyncHandler(async (req: AuthRequest, res: Response) => {
    const dateParam = req.query.date as string;
    if (!dateParam) {
      return res.status(400).json({ error: 'Missing date parameter (format: YYYY-MM-DD)' });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateParam)) {
      return res.status(400).json({ error: 'Invalid date format, use YYYY-MM-DD' });
    }

    const { start, end } = getDateRange(dateParam);

    // ─── FETCH DATA FOR MAIZE SECTION ───
    const grainTrucks = await prisma.grainTruck.findMany({
      where: {
        date: { gte: start, lte: end },
      },
      orderBy: { date: 'asc' },
    
    take: 500,
  });

    // Join with LabSample data for quality info.
    // N+1 fix — one IN query instead of one findUnique per truck.
    const rstNumbers = grainTrucks.map((t) => t.uidRst).filter((r): r is string => !!r);
    const labSamples = rstNumbers.length === 0
      ? []
      : await prisma.labSample.findMany({
          where: { rstNumber: { in: rstNumbers } },
          select: { rstNumber: true, moisture: true, starchPercent: true, damagedPercent: true, tfm: true },
        
    take: 500,
  });
    const labByRst = new Map(labSamples.map((l) => [l.rstNumber, l]));
    const grainTrucksWithLab = grainTrucks.map((truck) => {
      const labData = truck.uidRst ? labByRst.get(truck.uidRst) : undefined;
      return {
        ...truck,
        moisture: labData?.moisture ?? truck.moisture,
        starchPercent: labData?.starchPercent ?? truck.starchPercent,
        damagedPercent: labData?.damagedPercent ?? truck.damagedPercent,
        tfm: labData?.tfm ?? truck.foreignMatter,
      };
    });

    // ─── FETCH DATA FOR SUMMARY SECTION ───

    // Maize: currentStock (latest siloClosingStock for date or most recent before)
    const latestGrainEntry = await prisma.grainEntry.findFirst({
      where: {
        date: { lte: end },
      },
      orderBy: { date: 'desc' },
    });
    const maizeCurrentStock = latestGrainEntry?.siloClosingStock ?? 0;

    // Maize: openingStock (use hardcoded default if not found)
    const firstGrainEntry = await prisma.grainEntry.findFirst({
      orderBy: { date: 'asc' },
    });
    const maizeOpeningStock = firstGrainEntry?.siloOpeningStock ?? 403.07;

    // Maize: acceptedQty (SUM of GrainTruck.weightNet where quarantine=false)
    const acceptedQty = grainTrucks
      .filter((t) => !t.quarantine)
      .reduce((sum: number, t) => sum + t.weightNet, 0);

    // Maize: quarantined (SUM of GrainTruck.quarantineWeight)
    const quarantined = grainTrucks.reduce((sum: number, t) => sum + t.quarantineWeight, 0);

    // Ethanol: totalStock (latest EthanolProductEntry.totalStock for date)
    const latestEthanolEntry = await prisma.ethanolProductEntry.findFirst({
      where: {
        date: { lte: end },
      },
      orderBy: { date: 'desc' },
    });
    const ethanolTotalStock = latestEthanolEntry?.totalStock ?? 0;

    // Ethanol: dispatched (SUM of all DispatchTruck.quantityBL all time)
    // Use aggregate — full table scan in Postgres (fast) instead of loading all rows into Node.
    const ethanolDispatchedAgg = await prisma.dispatchTruck.aggregate({
      _sum: { quantityBL: true },
    });
    const ethanolDispatched = ethanolDispatchedAgg._sum.quantityBL ?? 0;

    // DDGS: stockOpening (latest DDGSStockEntry.openingStock for date)
    const latestDDGSStockEntry = await prisma.dDGSStockEntry.findFirst({
      where: {
        date: { lte: end },
      },
      orderBy: { date: 'desc' },
    });
    const ddgsStockOpening = latestDDGSStockEntry?.openingStock ?? 0;

    // DDGS: dispatched (SUM of all DDGSDispatchTruck.weightNet — already in MT/tonnes)
    const ddgsDispatchedAgg = await prisma.dDGSDispatchTruck.aggregate({
      _sum: { weightNet: true },
    });
    const ddgsDispatched = ddgsDispatchedAgg._sum.weightNet ?? 0;

    // Jute: bagsFromMaize (SUM of all GrainTruck.bags all time)
    const bagsFromMaizeAgg = await prisma.grainTruck.aggregate({
      _sum: { bags: true },
    });
    const bagsFromMaize = bagsFromMaizeAgg._sum.bags ?? 0;

    // Jute: bagsLifted (placeholder)
    const bagsLifted = 0;

    // ─── FETCH DATA FOR DDGS DISPATCH SECTION ───
    const ddgsDispatchTrucks = await prisma.dDGSDispatchTruck.findMany({
      orderBy: { date: 'desc' },
      take: 100,
    });

    // ─── FETCH DATA FOR ETHANOL DISPATCH SECTION ───
    const ethanolDispatchTrucks = await prisma.dispatchTruck.findMany({
      orderBy: { date: 'desc' },
      take: 100,
    });

    // ─── BUILD RESPONSE ───
    const report = {
      date: dateParam,
      sections: {
        summary: {
          maize: {
            currentStock: maizeCurrentStock,
            openingStock: maizeOpeningStock,
            acceptedQty,
            quarantined,
          },
          ethanol: {
            totalStock: ethanolTotalStock,
            dispatched: ethanolDispatched,
          },
          ddgs: {
            stockOpening: ddgsStockOpening,
            dispatched: ddgsDispatched,
          },
          jute: {
            bagsFromMaize,
            bagsLifted,
          },
        },
        maize: grainTrucksWithLab,
        ddgsDispatch: ddgsDispatchTrucks,
        ethanolDispatch: ethanolDispatchTrucks,
      },
    };

    res.json(report);
}));

export default router;
