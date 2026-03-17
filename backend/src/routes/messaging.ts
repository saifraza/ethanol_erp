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
        results.whatsapp = await sendWhatsApp({ phone: transporterPhone, message });
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

// POST /test-whatsapp — Send a hello_world template message (works with test numbers)
router.post('/test-whatsapp', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) { res.status(400).json({ error: 'Phone number required' }); return; }

    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;

    if (!token || !phoneId) {
      res.status(500).json({ error: 'WhatsApp API not configured' });
      return;
    }

    // Normalize phone
    const digits = phone.replace(/\D/g, '');
    const normalized = digits.length === 10 ? '91' + digits : digits;

    const apiRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalized,
        type: 'template',
        template: { name: 'hello_world', language: { code: 'en_US' } },
      }),
    });

    const data = await apiRes.json();
    res.json({ success: apiRes.ok, status: apiRes.status, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /config — Check messaging configuration status
router.get('/config', async (_req: Request, res: Response) => {
  res.json({
    email: {
      configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'Not set',
    },
    whatsapp: {
      mode: process.env.WHATSAPP_MODE || 'web',
      apiConfigured: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
    },
  });
});

export default router;
