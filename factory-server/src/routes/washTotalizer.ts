import { Router, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requireWbKeyOrAuth, AuthRequest } from '../middleware';

const router = Router();

// GET /api/wash-totalizer — Current accumulated total + recent readings
router.get('/', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const latest = await prisma.washTotalizer.findFirst({
      orderBy: { hour: 'desc' },
    });
    const count = await prisma.washTotalizer.count();
    const last24h = await prisma.washTotalizer.findMany({
      where: { hour: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      orderBy: { hour: 'asc' },
      select: { hour: true, prvHrValue: true, accumulatedKL: true },
    });
    const wash24h = last24h.reduce((s, r) => s + r.prvHrValue, 0);

    res.json({
      accumulatedKL: latest?.accumulatedKL ?? 0,
      lastReading: latest?.hour ?? null,
      totalReadings: count,
      last24hKL: Math.round(wash24h * 100) / 100,
      last24hReadings: last24h,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wash-totalizer/record — Record a new PRV_HR reading
// Called by the OPC bridge push handler or manually
router.post('/record', requireWbKeyOrAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { prvHrValue, hour, source } = req.body;
    if (prvHrValue == null || prvHrValue < 0) {
      return res.status(400).json({ error: 'prvHrValue required (>= 0)' });
    }

    // Truncate to hour
    const hourDate = hour ? new Date(hour) : new Date();
    hourDate.setMinutes(0, 0, 0);

    // Get previous accumulated total
    const prev = await prisma.washTotalizer.findFirst({
      orderBy: { hour: 'desc' },
      select: { accumulatedKL: true },
    });
    const accumulatedKL = Math.round(((prev?.accumulatedKL ?? 0) + prvHrValue) * 100) / 100;

    const entry = await prisma.washTotalizer.upsert({
      where: { hour: hourDate },
      create: {
        hour: hourDate,
        prvHrValue,
        accumulatedKL,
        source: source || 'OPC_BRIDGE',
      },
      update: {
        prvHrValue,
        accumulatedKL,
        source: source || 'OPC_BRIDGE',
      },
    });

    res.json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wash-totalizer/between — Wash KL between two timestamps
router.get('/between', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query params required (ISO timestamps)' });
    }

    const readings = await prisma.washTotalizer.findMany({
      where: { hour: { gte: new Date(from), lt: new Date(to) } },
      orderBy: { hour: 'asc' },
      select: { prvHrValue: true },
    });
    const washKL = Math.round(readings.reduce((s, r) => s + r.prvHrValue, 0) * 100) / 100;

    res.json({ from, to, washKL, hours: readings.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
