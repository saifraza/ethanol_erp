import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../config/prisma';
import { config } from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';

const router = Router();

// ── PIN Login (no auth required) ──
const pinLoginSchema = z.object({
  phone: z.string().min(10).max(10),
  pin: z.string().min(4).max(6),
});

router.post('/auth/pin', validate(pinLoginSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { phone, pin } = req.body;

  const user = await prisma.user.findFirst({
    where: { phone, isActive: true },
    select: {
      id: true, name: true, phone: true, role: true,
      allowedModules: true, mobilePin: true,
    },
  });

  if (!user || !user.mobilePin) {
    res.status(401).json({ error: 'Invalid phone or PIN' });
    return;
  }

  const valid = await bcrypt.compare(pin, user.mobilePin);
  if (!valid) {
    res.status(401).json({ error: 'Invalid phone or PIN' });
    return;
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, email: '', role: user.role, allowedModules: user.allowedModules, source: 'mobile' },
    config.jwtSecret,
    { expiresIn: '30d' }
  );

  const modules = user.allowedModules
    ? user.allowedModules.split(',').map(m => m.trim())
    : [];

  res.json({
    token,
    operator: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      modules,
    },
  });
}));

// ── Get available modules ──
router.get('/modules', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
  // Return the module list — frontend defines the forms, backend just validates
  const modules = [
    { id: 'ddgs', name: 'DDGS Production', icon: '📦' },
    { id: 'decanter', name: 'Decanter & Dryer', icon: '🔄' },
  ];
  res.json(modules);
}));

// ── Submit a reading from mobile app ──
const submitSchema = z.object({
  module: z.string().min(1),
  data: z.record(z.union([z.string(), z.number()])),
  operatorId: z.string().min(1),
  capturedAt: z.string().min(1),
  localId: z.string().min(1),
});

router.post('/submit', authenticate, validate(submitSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { module, data, operatorId, capturedAt, localId } = req.body;

  // Check for duplicate submission (idempotent)
  const existing = await prisma.mobileSubmission.findUnique({
    where: { localId },
    select: { id: true },
  });
  if (existing) {
    res.json({ success: true, id: existing.id, duplicate: true });
    return;
  }

  // Store the raw submission
  const submission = await prisma.mobileSubmission.create({
    data: {
      localId,
      module,
      data: JSON.stringify(data),
      operatorId,
      capturedAt: new Date(capturedAt),
      processedAt: null,
    },
  });

  // Route to module-specific save logic (async, non-blocking)
  processSubmission(submission.id, module, data, capturedAt).catch(err => {
    console.error(`[Mobile] Failed to process submission ${submission.id}:`, err);
  });

  res.status(201).json({ success: true, id: submission.id });
}));

// ── Register push token ──
const pushTokenSchema = z.object({
  token: z.string().min(1),
});

router.post('/push-token', authenticate, validate(pushTokenSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { pushToken: req.body.token },
  });
  res.json({ success: true });
}));

// ── Set PIN for a user (admin only) ──
const setPinSchema = z.object({
  userId: z.string().min(1),
  phone: z.string().min(10).max(10),
  pin: z.string().min(4).max(6),
});

router.post('/set-pin', authenticate, validate(setPinSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  const { userId, phone, pin } = req.body;
  const hash = await bcrypt.hash(pin, 10);

  await prisma.user.update({
    where: { id: userId },
    data: { phone, mobilePin: hash },
  });

  res.json({ success: true });
}));

// ── Module-specific processing ──
async function processSubmission(
  submissionId: string,
  module: string,
  data: Record<string, unknown>,
  capturedAt: string
): Promise<void> {
  const ist = new Date(new Date(capturedAt).getTime() + 5.5 * 60 * 60 * 1000);
  const hh = ist.getUTCHours();
  const mm = ist.getUTCMinutes();
  const ampm = hh >= 12 ? 'pm' : 'am';
  const entryTime = `${String(hh % 12 || 12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}`;

  if (module === 'ddgs') {
    const bags = Number(data.bags) || 0;
    const weightPerBag = Number(data.weightPerBag) || 35;
    const totalProduction = (bags * weightPerBag) / 1000;

    // Shift date: 9am-9am window
    const shiftDate = hh < 9
      ? new Date(ist.getTime() - 86400000).toISOString().split('T')[0]
      : ist.toISOString().split('T')[0];

    const fromHour = (hh - 1 + 24) % 24;
    const timeFrom = `${String(fromHour).padStart(2, '0')}:00`;
    const timeTo = `${String(hh).padStart(2, '0')}:00`;

    await prisma.dDGSProductionEntry.create({
      data: {
        date: ist,
        shiftDate,
        entryTime,
        timeFrom,
        timeTo,
        bags,
        weightPerBag,
        totalProduction,
        remark: `Mobile app: ${String(data.remark || '')}`.trim(),
        userId: 'mobile',
      },
    });
  }

  // Mark as processed
  await prisma.mobileSubmission.update({
    where: { id: submissionId },
    data: { processedAt: new Date() },
  });
}

export default router;
