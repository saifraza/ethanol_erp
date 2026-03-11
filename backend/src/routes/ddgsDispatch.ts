import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate as any);

// GET /summary?date=YYYY-MM-DD — summary for a date
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    if (!dateStr) { res.json({ totalNet: 0, truckCount: 0, totalBags: 0 }); return; }

    const dayStart = new Date(dateStr + 'T00:00:00.000Z');
    const dayEnd = new Date(dateStr + 'T23:59:59.999Z');

    const trucks = await prisma.dDGSDispatchTruck.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: 'desc' },
    });

    const totalNet = trucks.reduce((s, t) => s + t.weightNet, 0);
    const totalBags = trucks.reduce((s, t) => s + t.bags, 0);

    res.json({ totalNet, truckCount: trucks.length, totalBags });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET ?date=YYYY-MM-DD — list trucks for date
router.get('/', async (req: Request, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    let where: any = {};

    if (dateStr) {
      const dayStart = new Date(dateStr + 'T00:00:00.000Z');
      const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
      where = { date: { gte: dayStart, lte: dayEnd } };
    }

    const trucks = await prisma.dDGSDispatchTruck.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200
    });
    res.json({ trucks });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — add dispatch truck
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const bags = parseInt(b.bags) || 0;
    const weightPerBag = parseFloat(b.weightPerBag) || 50;
    const weightGross = parseFloat(b.weightGross) || 0;
    const weightTare = parseFloat(b.weightTare) || 0;
    const weightNet = weightGross > 0 ? weightGross - weightTare : (bags * weightPerBag) / 1000; // fallback: bags * weight in tonnes

    const truck = await prisma.dDGSDispatchTruck.create({
      data: {
        date: new Date(b.date || new Date()),
        vehicleNo: b.vehicleNo || '',
        partyName: b.partyName || '',
        destination: b.destination || '',
        bags,
        weightPerBag,
        weightGross,
        weightTare,
        weightNet,
        remarks: b.remarks || null,
        userId: (req as any).user.id,
      }
    });
    res.status(201).json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.dDGSDispatchTruck.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
