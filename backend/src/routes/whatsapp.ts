import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
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

export default router;
