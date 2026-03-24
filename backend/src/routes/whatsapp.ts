import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getQRCode,
  getConnectionStatus,
  getConnectedNumber,
  sendWhatsAppMessage,
} from '../services/whatsappBaileys';

const router = Router();

// GET /api/whatsapp/status — connection status + QR code + connected number
router.get(
  '/status',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json({
      status: getConnectionStatus(),
      qr: getQRCode(),
      connectedNumber: getConnectedNumber(),
    });
  })
);

// POST /api/whatsapp/connect — initiate WhatsApp connection (generates QR)
router.post(
  '/connect',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await connectWhatsApp();
    // Give it a moment to generate QR
    await new Promise((r) => setTimeout(r, 2000));
    res.json({
      status: getConnectionStatus(),
      qr: getQRCode(),
    });
  })
);

// POST /api/whatsapp/disconnect — logout and clear session
router.post(
  '/disconnect',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await disconnectWhatsApp();
    res.json({ status: 'disconnected' });
  })
);

// POST /api/whatsapp/test — send a test message
router.post(
  '/test',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
      res.status(400).json({ error: 'phone and message required' });
      return;
    }
    const result = await sendWhatsAppMessage(phone, message);
    res.json(result);
  })
);

// POST /api/whatsapp/send-report — send a report to configured numbers (or specific numbers)
router.post(
  '/send-report',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { message, module, phones } = req.body as {
      message: string;
      module?: string;
      phones?: string[];
    };
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Use provided phones or fall back to settings
    let targetPhones: string[] = phones || [];
    if (targetPhones.length === 0) {
      const settings = await prisma.settings.findFirst();
      if (settings?.whatsappNumbers) {
        targetPhones = settings.whatsappNumbers
          .split(',')
          .map((p: string) => p.trim())
          .filter(Boolean);
      }
    }

    if (targetPhones.length === 0) {
      res.status(400).json({ error: 'No phone numbers configured. Add numbers in Settings.' });
      return;
    }

    const results = await Promise.all(
      targetPhones.map((phone) => sendWhatsAppMessage(phone, message, module))
    );

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    res.json({ sent, failed, total: targetPhones.length, results });
  })
);

// GET /api/whatsapp/messages — message history
router.get(
  '/messages',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const direction = req.query.direction as string | undefined;
    const messages = await prisma.whatsAppMessage.findMany({
      take,
      orderBy: { timestamp: 'desc' },
      where: direction ? { direction } : undefined,
      select: {
        id: true,
        direction: true,
        phone: true,
        name: true,
        message: true,
        module: true,
        timestamp: true,
      },
    });
    res.json(messages);
  })
);

export default router;
