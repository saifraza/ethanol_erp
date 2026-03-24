import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    let settings = await prisma.settings.findFirst();
    if (!settings) {
      settings = await prisma.settings.create({ data: {} });
    }
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    // Strip read-only fields that frontend may send back
    const { id, createdAt, updatedAt, ...data } = req.body;
    console.log('[Settings] PATCH fields:', Object.keys(data).join(', '));

    let settings = await prisma.settings.findFirst();
    if (!settings) {
      settings = await prisma.settings.create({ data });
    } else {
      settings = await prisma.settings.update({
        where: { id: settings.id },
        data,
      });
    }
    res.json(settings);
  } catch (err: any) {
    console.error('[Settings] PATCH error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
