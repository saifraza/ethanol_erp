/**
 * Messaging Service — Email (SMTP) + WhatsApp (Multi-provider)
 *
 * WHATSAPP PROVIDERS (set WHATSAPP_PROVIDER env var):
 *   "interakt" — Interakt WhatsApp API (interakt.shop)
 *   "twilio"  — Twilio WhatsApp API (sandbox or production)
 *   "meta"    — Meta Cloud API (direct)
 *   "wapi"    — WAPI.in WhatsApp API
 *   "gupshup" — Gupshup WhatsApp API
 *   "web"     — Fallback: returns wa.me link for manual send
 *
 * ENV VARS:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 *   WHATSAPP_PROVIDER=interakt|twilio|meta|wapi|gupshup|web  (default: web)
 *
 *   # Interakt
 *   INTERAKT_API_KEY                     (from Interakt Dashboard → Developer Settings)
 *   INTERAKT_TEMPLATE_NAME (optional)    (approved template name, or sends plain text via callback)
 *
 *   # Twilio
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886)
 *
 *   # Meta Cloud API
 *   META_WHATSAPP_TOKEN, META_WHATSAPP_PHONE_ID
 *
 *   # WAPI
 *   WAPI_API_KEY, WAPI_SENDER (your registered WhatsApp number)
 *
 *   # Gupshup
 *   GUPSHUP_API_KEY, GUPSHUP_APP_NAME, GUPSHUP_SENDER
 */

import nodemailer from 'nodemailer';

// ── SMTP Email ──

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; path?: string; content?: Buffer; contentType?: string }[];
}

export async function sendEmail(opts: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { success: false, error: 'Email not configured. Set SMTP_USER and SMTP_PASS environment variables.' };
  }

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `"MSPIL ERP" <${process.env.SMTP_USER}>`,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    console.log(`[Email] Sent to ${opts.to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error('[Email] Failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ── WhatsApp Multi-Provider ──

export interface WhatsAppOptions {
  phone: string;   // Indian mobile: 10 digits or with +91
  message: string;
  mediaUrl?: string;  // URL to a PDF/image to attach (must be publicly accessible)
}

export interface WhatsAppResult {
  success: boolean;
  error?: string;
  provider: string;
  messageId?: string;
  webUrl?: string; // for web mode
}

/** Normalize Indian phone to 91XXXXXXXXXX */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.startsWith('91') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 11) return '91' + digits.slice(1);
  return digits;
}

/** Main WhatsApp send function — routes to correct provider */
export async function sendWhatsApp(opts: WhatsAppOptions): Promise<WhatsAppResult> {
  const provider = (process.env.WHATSAPP_PROVIDER || 'web').toLowerCase();

  switch (provider) {
    case 'interakt':
      return sendViaInterakt(opts);
    case 'twilio':
      return sendViaTwilio(opts);
    case 'meta':
      return sendViaMeta(opts);
    case 'wapi':
      return sendViaWapi(opts);
    case 'gupshup':
      return sendViaGupshup(opts);
    case 'web':
    default:
      return sendViaWeb(opts);
  }
}

// ── Provider: Interakt ──

async function sendViaInterakt(opts: WhatsAppOptions): Promise<WhatsAppResult> {
  const apiKey = process.env.INTERAKT_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Interakt not configured. Set INTERAKT_API_KEY.', provider: 'interakt' };
  }

  try {
    const phone = normalizePhone(opts.phone);
    // Interakt wants phone without country code prefix
    const phoneWithout91 = phone.startsWith('91') ? phone.slice(2) : phone;
    const templateName = process.env.INTERAKT_TEMPLATE_NAME;

    let body: any;

    if (templateName) {
      // Send via approved template
      body = {
        countryCode: '+91',
        phoneNumber: phoneWithout91,
        type: 'Template',
        template: {
          name: templateName,
          languageCode: 'en',
          bodyValues: [opts.message],
        },
      };
    } else {
      // Send as plain text (requires Interakt "text message" capability)
      body = {
        countryCode: '+91',
        phoneNumber: phoneWithout91,
        type: 'Text',
        data: {
          message: opts.message,
        },
      };
    }

    const res = await fetch('https://api.interakt.ai/v1/public/message/', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data: any = await res.json();
    if (res.ok && data.result) {
      console.log(`[Interakt] Sent to ${phoneWithout91}: ${data.id}`);
      return { success: true, provider: 'interakt', messageId: data.id };
    } else {
      console.error('[Interakt] Error:', JSON.stringify(data));
      return { success: false, error: data.message || 'Interakt error', provider: 'interakt' };
    }
  } catch (err: any) {
    console.error('[Interakt] Failed:', err.message);
    return { success: false, error: err.message, provider: 'interakt' };
  }
}

// ── Provider: Twilio ──

async function sendViaTwilio(opts: WhatsAppOptions): Promise<WhatsAppResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886'; // sandbox default

  if (!accountSid || !authToken) {
    return { success: false, error: 'Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.', provider: 'twilio' };
  }

  try {
    const phone = normalizePhone(opts.phone);
    const toNumber = `whatsapp:+${phone}`;

    const body = new URLSearchParams({
      From: fromNumber,
      To: toNumber,
      Body: opts.message,
    });

    // Attach media (PDF, image) if provided
    if (opts.mediaUrl) {
      body.append('MediaUrl', opts.mediaUrl);
    }

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data: any = await res.json();
    if (res.ok && data.sid) {
      console.log(`[Twilio] Sent to ${phone}: ${data.sid}`);
      return { success: true, provider: 'twilio', messageId: data.sid };
    } else {
      console.error('[Twilio] Error:', JSON.stringify(data));
      return { success: false, error: data.message || 'Twilio error', provider: 'twilio' };
    }
  } catch (err: any) {
    console.error('[Twilio] Failed:', err.message);
    return { success: false, error: err.message, provider: 'twilio' };
  }
}

// ── Provider: Meta Cloud API ──

async function sendViaMeta(opts: WhatsAppOptions): Promise<WhatsAppResult> {
  const token = process.env.META_WHATSAPP_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_ID || process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    return { success: false, error: 'Meta WhatsApp not configured. Set META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_ID.', provider: 'meta' };
  }

  try {
    const phone = normalizePhone(opts.phone);
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: opts.message },
      }),
    });

    const data: any = await res.json();
    if (res.ok && data.messages?.[0]?.id) {
      console.log(`[Meta] Sent to ${phone}: ${data.messages[0].id}`);
      return { success: true, provider: 'meta', messageId: data.messages[0].id };
    } else {
      console.error('[Meta] Error:', JSON.stringify(data));
      return { success: false, error: data.error?.message || 'Meta API error', provider: 'meta' };
    }
  } catch (err: any) {
    console.error('[Meta] Failed:', err.message);
    return { success: false, error: err.message, provider: 'meta' };
  }
}

// ── Provider: WAPI ──

async function sendViaWapi(opts: WhatsAppOptions): Promise<WhatsAppResult> {
  const apiKey = process.env.WAPI_API_KEY;
  const sender = process.env.WAPI_SENDER;

  if (!apiKey) {
    return { success: false, error: 'WAPI not configured. Set WAPI_API_KEY.', provider: 'wapi' };
  }

  try {
    const phone = normalizePhone(opts.phone);

    // WAPI.in API — send text message
    const res = await fetch('https://api.wapi.in/v1/messages/text', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        from: sender || undefined,
        text: opts.message,
      }),
    });

    const data: any = await res.json();
    if (res.ok && (data.success || data.messageId || data.id)) {
      console.log(`[WAPI] Sent to ${phone}`);
      return { success: true, provider: 'wapi', messageId: data.messageId || data.id };
    } else {
      console.error('[WAPI] Error:', JSON.stringify(data));
      return { success: false, error: data.message || data.error || 'WAPI error', provider: 'wapi' };
    }
  } catch (err: any) {
    console.error('[WAPI] Failed:', err.message);
    return { success: false, error: err.message, provider: 'wapi' };
  }
}

// ── Provider: Gupshup ──

async function sendViaGupshup(opts: WhatsAppOptions): Promise<WhatsAppResult> {
  const apiKey = process.env.GUPSHUP_API_KEY;
  const appName = process.env.GUPSHUP_APP_NAME;
  const sender = process.env.GUPSHUP_SENDER;

  if (!apiKey) {
    return { success: false, error: 'Gupshup not configured. Set GUPSHUP_API_KEY, GUPSHUP_APP_NAME, GUPSHUP_SENDER.', provider: 'gupshup' };
  }

  try {
    const phone = normalizePhone(opts.phone);

    // Gupshup API — send text message
    const body = new URLSearchParams({
      channel: 'whatsapp',
      source: sender || '',
      destination: phone,
      'message.type': 'text',
      'message.text': opts.message,
      'src.name': appName || '',
    });

    const res = await fetch('https://api.gupshup.io/wa/api/v1/msg', {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data: any = await res.json();
    if (res.ok && data.status === 'submitted') {
      console.log(`[Gupshup] Sent to ${phone}: ${data.messageId}`);
      return { success: true, provider: 'gupshup', messageId: data.messageId };
    } else {
      console.error('[Gupshup] Error:', JSON.stringify(data));
      return { success: false, error: data.message || 'Gupshup error', provider: 'gupshup' };
    }
  } catch (err: any) {
    console.error('[Gupshup] Failed:', err.message);
    return { success: false, error: err.message, provider: 'gupshup' };
  }
}

// ── Provider: Web (fallback — opens wa.me link) ──

async function sendViaWeb(opts: WhatsAppOptions): Promise<WhatsAppResult> {
  const phone = normalizePhone(opts.phone);
  const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(opts.message)}`;
  return { success: true, provider: 'web', webUrl: url };
}

// ── Build Rate Request Message ──

export interface RateRequestData {
  inquiryNo: number;
  productName: string;
  quantity: number;
  unit: string;
  origin: string;
  destination: string;
  distanceKm?: number | null;
  vehicleCount: number;
  loadingDate?: string;
  pdfUrl?: string;
}

export async function buildRateRequestMessage(data: RateRequestData): Promise<string> {
  // Load terms from DB template
  let terms: string[];
  try {
    const { getTemplate } = await import('../utils/templateHelper');
    const tmpl = await getTemplate('RATE_REQUEST');
    terms = tmpl.terms;
  } catch {
    terms = [
      'Vehicle with valid fitness certificate',
      'Driver with valid license & documents',
      'GR (Bilty) at time of loading',
      '50% advance after bill; balance after delivery',
      'Insurance by purchaser (not transporter)',
    ];
  }

  const lines = [
    `*MSPIL — Freight Rate Request*`,
    `Inquiry No: FI-${data.inquiryNo}`,
    ``,
    `*Route:* ${data.origin} → ${data.destination}`,
    data.distanceKm ? `*Distance:* ${data.distanceKm} km` : '',
    `*Product:* ${data.productName}`,
    `*Quantity:* ${data.quantity} ${data.unit}`,
    `*Vehicles Required:* ${data.vehicleCount}`,
    data.loadingDate ? `*Loading Date:* ${data.loadingDate}` : '',
    ``,
    `*Terms:*`,
    ...terms.map((t, i) => `${i + 1}. ${t}`),
    ``,
    `Please share your rate (₹/MT) and availability.`,
    data.pdfUrl ? `\nView full inquiry: ${data.pdfUrl}` : '',
    ``,
    `— Mahakaushal Sugar & Power Industries Ltd.`,
    `Village Bachai, Narsinghpur, MP - 487001`,
  ];

  return lines.filter(Boolean).join('\n');
}

export async function buildRateRequestHTML(data: RateRequestData): Promise<string> {
  // Load terms from DB template
  let terms: string[];
  let footer: string;
  try {
    const { getTemplate } = await import('../utils/templateHelper');
    const tmpl = await getTemplate('RATE_REQUEST');
    terms = tmpl.terms;
    footer = tmpl.footer || 'MSPIL, Narsinghpur';
  } catch {
    terms = [
      'Vehicle in good condition with valid fitness certificate.',
      'Driver must carry valid license and vehicle documents.',
      'GR (Bilty) to be provided at loading point.',
      '50% advance after bill submission, balance after delivery confirmation.',
      'Insurance of goods by purchaser.',
    ];
    footer = 'MSPIL, Narsinghpur';
  }

  const termsHtml = terms.map(t => `<li>${t}</li>`).join('\n          ');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #4a7c3f; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">MSPIL — Freight Rate Request</h2>
        <p style="margin: 4px 0 0; opacity: 0.9;">Inquiry No: FI-${data.inquiryNo}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
        <h3 style="color: #333; margin-top: 0;">Shipment Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #666; width: 140px;">Route:</td><td style="padding: 6px 0; font-weight: bold;">${data.origin} → ${data.destination}</td></tr>
          ${data.distanceKm ? `<tr><td style="padding: 6px 0; color: #666;">Distance:</td><td style="padding: 6px 0;">${data.distanceKm} km</td></tr>` : ''}
          <tr><td style="padding: 6px 0; color: #666;">Product:</td><td style="padding: 6px 0;">${data.productName}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Quantity:</td><td style="padding: 6px 0;">${data.quantity} ${data.unit}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Vehicles Required:</td><td style="padding: 6px 0;">${data.vehicleCount}</td></tr>
          ${data.loadingDate ? `<tr><td style="padding: 6px 0; color: #666;">Loading Date:</td><td style="padding: 6px 0;">${data.loadingDate}</td></tr>` : ''}
        </table>

        <h3 style="color: #333;">Terms & Conditions</h3>
        <ol style="color: #555; padding-left: 20px;">
          ${termsHtml}
        </ol>

        <div style="background: #f3f4f6; padding: 12px; border-radius: 6px; margin-top: 16px;">
          <p style="margin: 0; color: #333; font-weight: bold;">Please reply with your quotation:</p>
          <p style="margin: 8px 0 0; color: #666;">Rate (₹/MT), vehicle availability, and estimated transit days.</p>
        </div>

        ${data.pdfUrl ? `<p style="margin-top: 16px;"><a href="${data.pdfUrl}" style="color: #4a7c3f; font-weight: bold;">View Full Inquiry PDF →</a></p>` : ''}

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #888; font-size: 12px; margin: 0;">
          Mahakaushal Sugar and Power Industries Ltd.<br/>
          Village Bachai, Dist. Narsinghpur, MP - 487001<br/>
          GSTIN: 23AAECM3666P1Z1
        </p>
      </div>
    </div>
  `;
}
