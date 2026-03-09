import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';

const router = Router();

const TANK_KEYS = ['recA','recB','recC','issA','issB','issC','bulkA','bulkB','bulkC'];
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

  // Previous total stock
  const prevStock = prevEntry
    ? TANK_KEYS.reduce((s, k) => s + ((prevEntry as any)[`${k}Volume`] || 0), 0)
    : 0;

  // Production = current stock - prev stock + dispatch
  const productionBL = totalStock - prevStock + totalDispatch;
  const productionAL = productionBL * avgStrength / 100;

  return { totalStock, avgStrength, totalDispatch, productionBL, productionAL };
}

// GET /api/ethanol-product/latest — returns latest entry as "previous" + defaults
router.get('/latest', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const yearStart = new Date().getFullYear();
    const latest = await prisma.ethanolProductEntry.findFirst({
      where: { yearStart },
      orderBy: { createdAt: 'desc' },
      include: { trucks: true },
    });

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
      date: latest.date,
      createdAt: latest.createdAt,
    } : null;

    res.json({ previous });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/ethanol-product — history
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const entries = await prisma.ethanolProductEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { trucks: true },
    });
    res.json({ entries });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/ethanol-product
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { date, trucks, remarks } = req.body;
    const entryDate = new Date(date);
    entryDate.setHours(0, 0, 0, 0);
    const yearStart = entryDate.getFullYear();

    const tankData = parseTankData(req.body);

    // Get previous entry for production calculation
    const prevEntry = await prisma.ethanolProductEntry.findFirst({
      where: { yearStart },
      orderBy: { createdAt: 'desc' },
    });

    // Sum dispatch from trucks array
    const truckList: any[] = trucks || [];
    const totalDispatch = truckList.reduce((s: number, t: any) => s + (parseFloat(t.quantityBL) || 0), 0);

    const summary = calcSummary(tankData, prevEntry, totalDispatch);

    const entry = await prisma.ethanolProductEntry.create({
      data: {
        date: entryDate,
        yearStart,
        ...tankData,
        ...summary,
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

    const { trucks, remarks } = req.body;
    const tankData = parseTankData(req.body);

    // Get previous entry (before this one)
    const prevEntry = await prisma.ethanolProductEntry.findFirst({
      where: { yearStart: existing.yearStart, createdAt: { lt: existing.createdAt } },
      orderBy: { createdAt: 'desc' },
    });

    const truckList: any[] = trucks || [];
    const totalDispatch = truckList.reduce((s: number, t: any) => s + (parseFloat(t.quantityBL) || 0), 0);
    const summary = calcSummary(tankData, prevEntry, totalDispatch);

    // Delete old trucks, recreate
    await prisma.dispatchTruck.deleteMany({ where: { entryId: req.params.id } });

    const entry = await prisma.ethanolProductEntry.update({
      where: { id: req.params.id },
      data: {
        ...tankData,
        ...summary,
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
