import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  let settings = await prisma.settings.findFirst();
  if (!settings) {
    settings = await prisma.settings.create({ data: {} });
  }
  res.json(settings);
}));

router.patch('/', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  // Strip read-only fields that frontend may send back
  const { id, createdAt, updatedAt, ...data } = req.body;

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
}));

export default router;
