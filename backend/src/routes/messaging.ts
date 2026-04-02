import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';
import {
  sendEmail, sendTelegram,
  buildRateRequestMessage, buildRateRequestHTML,
  RateRequestData,
} from '../services/messaging';

const router = Router();
router.use(authenticate as any);

// POST /send-rate-request — Send freight inquiry to a transporter via email + Telegram
router.post('/send-rate-request', async (req: Request, res: Response) => {
  try {
    const { inquiryId, transporterId, channels } = req.body;

    if (!inquiryId) {
      res.status(400).json({ error: 'inquiryId is required' });
      return;
    }

    const inquiry = await prisma.freightInquiry.findUnique({ where: { id: inquiryId } });
    if (!inquiry) { res.status(404).json({ error: 'Freight inquiry not found' }); return; }

    // Get transporter contact
    let transporterEmail = '';
    let transporterPhone = '';
    let transporterName = '';

    if (transporterId) {
      const transporter = await prisma.transporter.findUnique({ where: { id: transporterId } });
      if (transporter) {
        transporterEmail = transporter.email || '';
        transporterPhone = transporter.phone || '';
        transporterName = transporter.name;
      }
    }

    // Override with body values if provided
    if (req.body.email) transporterEmail = req.body.email;
    if (req.body.phone) transporterPhone = req.body.phone;
    if (req.body.name) transporterName = req.body.name;

    // Build the base URL for PDF link
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const token = req.headers.authorization?.split(' ')[1] || (req.query.token as string);
    const pdfUrl = `${baseUrl}/api/freight-inquiries/${inquiry.id}/pdf?token=${token}`;

    const data: RateRequestData = {
      inquiryNo: inquiry.inquiryNo,
      productName: inquiry.productName,
      quantity: inquiry.quantity,
      unit: inquiry.unit,
      origin: inquiry.origin,
      destination: inquiry.destination,
      distanceKm: inquiry.distanceKm,
      vehicleCount: inquiry.vehicleCount,
      loadingDate: inquiry.loadingDate ? new Date(inquiry.loadingDate).toLocaleDateString('en-IN') : undefined,
      pdfUrl,
    };

    const results: any = { email: null, telegram: null };
    const channelList = channels || ['telegram'];

    // Send email
    if (channelList.includes('email')) {
      if (!transporterEmail) {
        results.email = { success: false, error: 'No email address for this transporter' };
      } else {
        results.email = await sendEmail({
          to: transporterEmail,
          subject: `MSPIL Freight Rate Request — FI-${inquiry.inquiryNo} | ${inquiry.productName} ${inquiry.quantity} ${inquiry.unit} to ${inquiry.destination}`,
          text: await buildRateRequestMessage(data),
          html: await buildRateRequestHTML(data),
        });
      }
    }

    // Send Telegram
    if (channelList.includes('telegram')) {
      // Get Telegram private chat IDs from settings
      const settings = await prisma.settings.findFirst();
      const chatIds = settings?.telegramPrivateChatIds?.split(',').map(s => s.trim()).filter(Boolean) || [];
      if (chatIds.length === 0) {
        results.telegram = { success: false, error: 'No Telegram chat IDs configured' };
      } else {
        const message = await buildRateRequestMessage(data);
        // Send to first configured chat ID
        results.telegram = await sendTelegram({ chatId: chatIds[0], message });
      }
    }

    res.json({
      sent: true,
      transporter: transporterName,
      results,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /send-custom — Send a custom message (email or Telegram)
router.post('/send-custom', async (req: Request, res: Response) => {
  try {
    const { channel, to, subject, message, html } = req.body;

    if (channel === 'email') {
      if (!to) { res.status(400).json({ error: 'Email address required' }); return; }
      const result = await sendEmail({ to, subject: subject || 'MSPIL ERP Notification', text: message, html });
      res.json(result);
    } else if (channel === 'telegram') {
      if (!to) { res.status(400).json({ error: 'Chat ID required' }); return; }
      const result = await sendTelegram({ chatId: to, message });
      res.json(result);
    } else {
      res.status(400).json({ error: 'Invalid channel. Use "email" or "telegram".' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /send-document — Send a document via Telegram
router.post('/send-document', async (req: Request, res: Response) => {
  try {
    const { chatId, message, documentUrl, documentType } = req.body;
    if (!chatId) { res.status(400).json({ error: 'Chat ID required' }); return; }
    if (!documentUrl) { res.status(400).json({ error: 'Document URL required' }); return; }

    const result = await sendTelegram({
      chatId,
      message: `${message || `MSPIL ERP — ${documentType || 'Document'}`}\n${documentUrl}`,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /config — Check messaging configuration status
router.get('/config', async (_req: Request, res: Response) => {
  const settings = await prisma.settings.findFirst();
  res.json({
    email: {
      configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'Not set',
    },
    telegram: {
      configured: !!(settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN),
      enabled: settings?.telegramEnabled ?? false,
    },
  });
});

export default router;
