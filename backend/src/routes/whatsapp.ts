/**
 * WhatsApp routes — status, QR, test send, message history
 *
 * Proxies to mspil-whatsapp Baileys worker on Railway.
 * Outbound push only — no incoming message handling.
 */

import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import prisma from '../config/prisma';
import { z } from 'zod';
import { waStatus, waQr, waSend, waSendGroup, resetWaConfig } from '../services/whatsappClient';
import { resetGatewayCache } from '../services/messagingGateway';

const router = Router();
router.use(authenticate);

// ── Status ──

router.get('/status', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const status = await waStatus();
  res.json(status);
}));

// ── QR Code ──

router.get('/qr', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await waQr();
  res.json(data);
}));

// ── Test Send ──

const testSchema = z.object({
  phone: z.string().min(1),
  message: z.string().optional(),
});

router.post('/test', validate(testSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { phone, message } = req.body;
  const result = await waSend(phone, message || 'Test message from MSPIL ERP', 'test');
  res.json(result);
}));

// ── Test Group ──

router.post('/test-group', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const settings = await prisma.settings.findFirst();
  const jid = settings?.whatsappGroupJid;
  if (!jid) {
    res.status(400).json({ success: false, error: 'No WhatsApp group configured' });
    return;
  }
  const result = await waSendGroup(jid, 'Test message from MSPIL ERP', 'test');
  res.json(result);
}));

// ── Reset Config (call after settings update) ──

router.post('/reset', asyncHandler(async (_req: AuthRequest, res: Response) => {
  resetWaConfig();
  resetGatewayCache();
  res.json({ success: true });
}));

// ── Message History ──

router.get('/messages', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
  try {
    const messages = await prisma.whatsAppMessage.findMany({
      take,
      orderBy: { timestamp: 'desc' },
      select: { id: true, direction: true, recipient: true, message: true, module: true, status: true, timestamp: true },
    });
    res.json(messages);
  } catch {
    res.json([]);
  }
}));

export default router;
