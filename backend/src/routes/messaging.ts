import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';
import {
  sendEmail, sendWhatsApp,
  buildRateRequestMessage, buildRateRequestHTML,
  RateRequestData,
} from '../services/messaging';

const router = Router();
router.use(authenticate as any);

// POST /send-rate-request — Send freight inquiry to a transporter via email + WhatsApp
router.post('/send-rate-request', async (req: Request, res: Response) => {
  try {
    const { inquiryId, transporterId, channels } = req.body;
    // channels: ['email', 'whatsapp'] or ['email'] or ['whatsapp']

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

    const results: any = { email: null, whatsapp: null };
    const channelList = channels || ['whatsapp'];

    // Send email
    if (channelList.includes('email')) {
      if (!transporterEmail) {
        results.email = { success: false, error: 'No email address for this transporter' };
      } else {
        results.email = await sendEmail({
          to: transporterEmail,
          subject: `MSPIL Freight Rate Request — FI-${inquiry.inquiryNo} | ${inquiry.productName} ${inquiry.quantity} ${inquiry.unit} to ${inquiry.destination}`,
          text: buildRateRequestMessage(data),
          html: buildRateRequestHTML(data),
        });
      }
    }

    // Send WhatsApp
    if (channelList.includes('whatsapp')) {
      if (!transporterPhone) {
        results.whatsapp = { success: false, error: 'No phone number for this transporter' };
      } else {
        const message = buildRateRequestMessage(data);
        results.whatsapp = await sendWhatsApp({ phone: transporterPhone, message, mediaUrl: pdfUrl });
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

// POST /send-custom — Send a custom message (email or WhatsApp)
router.post('/send-custom', async (req: Request, res: Response) => {
  try {
    const { channel, to, subject, message, html } = req.body;

    if (channel === 'email') {
      if (!to) { res.status(400).json({ error: 'Email address required' }); return; }
      const result = await sendEmail({ to, subject: subject || 'MSPIL ERP Notification', text: message, html });
      res.json(result);
    } else if (channel === 'whatsapp') {
      if (!to) { res.status(400).json({ error: 'Phone number required' }); return; }
      const result = await sendWhatsApp({ phone: to, message });
      res.json(result);
    } else {
      res.status(400).json({ error: 'Invalid channel. Use "email" or "whatsapp".' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /send-document — Send a document (PDF, image) via WhatsApp
router.post('/send-document', async (req: Request, res: Response) => {
  try {
    const { phone, message, documentUrl, documentType } = req.body;
    if (!phone) { res.status(400).json({ error: 'Phone number required' }); return; }
    if (!documentUrl) { res.status(400).json({ error: 'Document URL required' }); return; }

    const result = await sendWhatsApp({
      phone,
      message: message || `MSPIL ERP — ${documentType || 'Document'}`,
      mediaUrl: documentUrl,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /config — Check messaging configuration status
router.get('/config', async (_req: Request, res: Response) => {
  const provider = process.env.WHATSAPP_PROVIDER || 'web';
  const providerConfig: any = { provider };

  switch (provider) {
    case 'twilio':
      providerConfig.configured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
      providerConfig.from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
      break;
    case 'meta':
      providerConfig.configured = !!(process.env.META_WHATSAPP_TOKEN || process.env.WHATSAPP_TOKEN);
      break;
    case 'wapi':
      providerConfig.configured = !!(process.env.WAPI_API_KEY);
      break;
    case 'gupshup':
      providerConfig.configured = !!(process.env.GUPSHUP_API_KEY);
      break;
    default:
      providerConfig.configured = true; // web mode always works
  }

  res.json({
    email: {
      configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'Not set',
    },
    whatsapp: providerConfig,
  });
});

export default router;
