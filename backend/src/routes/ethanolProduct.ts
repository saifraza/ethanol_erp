import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';

const router = Router();

const TANK_KEYS = ['recA','recB','recC','bulkA','bulkB','bulkC','disp'];
const TANK_FIELDS = TANK_KEYS.flatMap(k => [`${k}Dip`,`${k}Lt`,`${k}Strength`,`${k}Volume`]);

function parseTankData(body: any) {
  const data: any = {};
  for (const f of TANK_FIELDS) {
    data[f] = body[f] != null ? parseFloat(body[f]) || 0 : null;
  }
  data.rsLevel = body.rsLevel != null ? parseFloat(body.rsLevel) : null;
  data.hfoLevel = body.hfoLevel != null ? parseFloat(body.hfoLevel) : null;
  data.lfoLevel = body.lfoLevel != null ? parseFloat(body.lfoLevel) : null;
  return data;
}

function calcSummary(tankData: any, prevEntry: any, totalDispatch: number) {
  // Total current stock = sum of all 9 tank volumes
  const totalStock = TANK_KEYS.reduce((s, k) => s + (tankData[`${k}Volume`] || 0), 0);

  // Weighted average strength
  const wSum = TANK_KEYS.reduce((s, k) => s + (tankData[`${k}Volume`] || 0) * (tankData[`${k}Strength`] || 0), 0);
  const avgStrength = totalStock > 0 ? wSum / totalStock : 0;

  // Previous total stock — use sum of tank volumes if available, otherwise fall back to totalStock field
  // (entries imported from spreadsheet may have totalStock set but null tank volumes)
  let prevStock = 0;
  if (prevEntry) {
    const tankSum = TANK_KEYS.reduce((s, k) => s + ((prevEntry as any)[`${k}Volume`] || 0), 0);
    prevStock = tankSum > 0 ? tankSum : (prevEntry.totalStock || 0);
  }

  // Production = current stock - prev stock + dispatch
  const productionBL = totalStock - prevStock + totalDispatch;
  const productionAL = productionBL * avgStrength / 100;

  // KLPD = production per day in kilolitres
  // needs hours between prev and current entry
  return { totalStock, avgStrength, totalDispatch, productionBL, productionAL };
}

function calcKLPD(productionBL: number, prevDate: Date | null, curDate: Date): number {
  if (!prevDate) return 0;
  const hours = (curDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60);
  if (hours <= 0) return 0;
  return (productionBL / hours) * 24 / 1000; // BL -> KL per day
}

// GET /api/ethanol-product/latest — returns latest entry as "previous" + defaults
// ?beforeId=xxx — get the entry before this one (for edit mode)
router.get('/latest', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const yearStart = new Date().getFullYear();
    const beforeId = req.query.beforeId as string | undefined;

    let latest: any = null;

    if (beforeId) {
      // Edit mode: find the entry being edited, then get the one before it by date
      const editing = await prisma.ethanolProductEntry.findUnique({ where: { id: beforeId } });
      if (editing) {
        latest = await prisma.ethanolProductEntry.findFirst({
          where: { yearStart: editing.yearStart, date: { lt: editing.date } },
          orderBy: { date: 'desc' },
        });
      }
    } else {
      // New entry mode: get the most recent by date
      latest = await prisma.ethanolProductEntry.findFirst({
        where: { yearStart },
        orderBy: { date: 'desc' },
      });
    }

    // Build previous tank data for display
    const previous = latest ? {
      ...Object.fromEntries(TANK_FIELDS.map(f => [f, (latest as any)[f]])),
      rsLevel: latest.rsLevel,
      hfoLevel: latest.hfoLevel,
      lfoLevel: latest.lfoLevel,
      totalStock: latest.totalStock,
      avgStrength: latest.avgStrength,
      totalDispatch: latest.totalDispatch,
      productionBL: latest.productionBL,
      productionAL: latest.productionAL,
      klpd: latest.klpd,
      date: latest.date,
      createdAt: latest.createdAt,
    } : null;

    res.json({ previous });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/total-production', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Sum all daily production values
    const totalProduction = await prisma.ethanolProductEntry.aggregate({
      _sum: {
        productionBL: true,
      },
    });
    const sumProd = totalProduction._sum.productionBL || 0;

    // Add the opening stock from the FIRST entry (base stock when ERP started)
    // The first entry's totalStock represents all ethanol in tanks when tracking began
    const firstEntry = await prisma.ethanolProductEntry.findFirst({
      orderBy: { date: 'asc' },
      select: { totalStock: true, productionBL: true },
    });
    const openingStock = firstEntry?.totalStock || 0;

    res.json({ totalProduced: sumProd + openingStock });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ethanol-product — history
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const entries = await prisma.ethanolProductEntry.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      include: { trucks: true },
    });
    res.json({ entries });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Helper: get standalone dispatch total for a date range (between prev entry and current)
// Uses gt (exclusive) for start and lte (inclusive) for end — no +24h padding
async function getStandaloneDispatch(afterDate: Date | null, upToDate: Date): Promise<number> {
  const start = afterDate || new Date('2000-01-01');
  const dispatches = await prisma.dispatchTruck.findMany({
    where: {
      entryId: null, // standalone only
      date: { gt: start, lte: upToDate },
    },
  });
  return dispatches.reduce((s, d) => s + (d.quantityBL || 0), 0);
}

// POST /api/ethanol-product
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { date, trucks, remarks, plantNotRunning } = req.body;
    // Frontend sends full ISO datetime (already timezone-correct)
    const entryDate = new Date(date);
    const yearStart = entryDate.getFullYear();

    const tankData = parseTankData(req.body);

    // Get previous entry for production calculation (by date, not createdAt)
    const prevEntry = await prisma.ethanolProductEntry.findFirst({
      where: { yearStart },
      orderBy: { date: 'desc' },
    });

    // Sum dispatch from trucks array + standalone dispatches since prev entry
    const truckList: any[] = trucks || [];
    const linkedDispatch = truckList.reduce((s: number, t: any) => s + (parseFloat(t.quantityBL) || 0), 0);
    const standaloneDispatch = await getStandaloneDispatch(
      prevEntry?.date || null, entryDate
    );
    const totalDispatch = linkedDispatch + standaloneDispatch;

    const summary = calcSummary(tankData, prevEntry, totalDispatch);
    const klpd = calcKLPD(summary.productionBL, prevEntry?.date || null, entryDate);

    // Override production to 0 when plant not running
    if (plantNotRunning) {
      summary.productionBL = 0;
      summary.productionAL = 0;
    }
    const finalKlpd = plantNotRunning ? 0 : klpd;

    const entry = await prisma.ethanolProductEntry.create({
      data: {
        date: entryDate,
        yearStart,
        ...tankData,
        ...summary,
        klpd: finalKlpd,
        remarks: remarks || null,
        userId: req.user!.id,
        trucks: {
          create: truckList.map(t => ({
            vehicleNo: t.vehicleNo || '',
            partyName: t.partyName || '',
            destination: t.destination || '',
            quantityBL: parseFloat(t.quantityBL) || 0,
            strength: t.strength != null ? parseFloat(t.strength) : null,
            remarks: t.remarks || null,
          })),
        },
      },
      include: { trucks: true },
    });

    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/ethanol-product/:id
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.ethanolProductEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const { trucks, remarks, date: newDate, plantNotRunning: pnr } = req.body;
    const tankData = parseTankData(req.body);

    // Frontend sends full ISO datetime (already timezone-correct)
    const entryDate = newDate ? new Date(newDate) : existing.date;

    // Get previous entry (before this one by date, not createdAt)
    const prevEntry = await prisma.ethanolProductEntry.findFirst({
      where: { yearStart: existing.yearStart, date: { lt: existing.date } },
      orderBy: { date: 'desc' },
    });

    const truckList: any[] = trucks || [];
    const linkedDispatch = truckList.reduce((s: number, t: any) => s + (parseFloat(t.quantityBL) || 0), 0);
    const standaloneDispatch = await getStandaloneDispatch(
      prevEntry?.date || null, entryDate
    );
    const totalDispatch = linkedDispatch + standaloneDispatch;
    const summary = calcSummary(tankData, prevEntry, totalDispatch);
    const klpd = calcKLPD(summary.productionBL, prevEntry?.date || null, entryDate);

    // Override production to 0 when plant not running
    if (pnr) {
      summary.productionBL = 0;
      summary.productionAL = 0;
    }
    const finalKlpd = pnr ? 0 : klpd;

    // Delete old trucks, recreate
    await prisma.dispatchTruck.deleteMany({ where: { entryId: req.params.id } });

    const entry = await prisma.ethanolProductEntry.update({
      where: { id: req.params.id },
      data: {
        date: entryDate,
        ...tankData,
        ...summary,
        klpd: finalKlpd,
        remarks: remarks || null,
        trucks: {
          create: truckList.map(t => ({
            vehicleNo: t.vehicleNo || '',
            partyName: t.partyName || '',
            destination: t.destination || '',
            quantityBL: parseFloat(t.quantityBL) || 0,
            strength: t.strength != null ? parseFloat(t.strength) : null,
            remarks: t.remarks || null,
          })),
        },
      },
      include: { trucks: true },
    });

    res.json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/ethanol-product/:id — ADMIN only
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.ethanolProductEntry.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
