import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// GET / — list active transporters
router.get('/', async (req: Request, res: Response) => {
  try {
    const transporters = await prisma.transporter.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ transporters });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create transporter
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const vehicleCount = parseInt(b.vehicleCount) || 0;

    const transporter = await prisma.transporter.create({
      data: {
        name: b.name || '',
        contactPerson: b.contactPerson || '',
        phone: b.phone || '',
        vehicleCount,
        isActive: true,
      }
    });
    res.status(201).json(transporter);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update transporter
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const vehicleCount = parseInt(b.vehicleCount) || 0;

    const transporter = await prisma.transporter.update({
      where: { id: req.params.id },
      data: {
        name: b.name,
        contactPerson: b.contactPerson,
        phone: b.phone,
        vehicleCount,
      }
    });
    res.json(transporter);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — soft delete (set isActive: false)
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.transporter.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
