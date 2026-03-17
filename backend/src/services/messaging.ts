/**
 * Messaging Service — Email (SMTP) + WhatsApp (Business API + Web fallback)
 *
 * ENV VARS:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   WHATSAPP_MODE=web|api  (default: web)
 *   WHATSAPP_TOKEN         (Meta Cloud API token — for api mode)
 *   WHATSAPP_PHONE_ID      (Meta phone number ID — for api mode)
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

// ── WhatsApp Business Cloud API ──

export interface WhatsAppOptions {
  phone: string;   // Indian mobile: 10 digits or with +91
  message: string;
}

/** Normalize Indian phone to 91XXXXXXXXXX */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.startsWith('91') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 11) return '91' + digits.slice(1);
  return digits;
}

export async function sendWhatsApp(opts: WhatsAppOptions): Promise<{ success: boolean; error?: string; mode: string }> {
  const mode = process.env.WHATSAPP_MODE || 'web';

  if (mode === 'api') {
    return sendWhatsAppAPI(opts);
  }

  // Web mode — return the WhatsApp Web URL for frontend to open
  const phone = normalizePhone(opts.phone);
  const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(opts.message)}`;
  return { success: true, mode: 'web', error: url }; // error field carries the URL in web mode
}

async function sendWhatsAppAPI(opts: WhatsAppOptions): Promise<{ success: boolean; error?: string; mode: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    return { success: false, error: 'WhatsApp API not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID.', mode: 'api' };
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
    if (res.ok) {
      console.log(`[WhatsApp API] Sent to ${phone}`);
      return { success: true, mode: 'api' };
    } else {
      console.error('[WhatsApp API] Error:', data);
      return { success: false, error: data.error?.message || 'WhatsApp API error', mode: 'api' };
    }
  } catch (err: any) {
    console.error('[WhatsApp API] Failed:', err.message);
    return { success: false, error: err.message, mode: 'api' };
  }
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

export function buildRateRequestMessage(data: RateRequestData): string {
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
    `1. Vehicle with valid fitness certificate`,
    `2. Driver with valid license & documents`,
    `3. GR (Bilty) at time of loading`,
    `4. 50% advance after bill; balance after delivery`,
    `5. Insurance by purchaser (not transporter)`,
    ``,
    `Please share your rate (₹/MT) and availability.`,
    data.pdfUrl ? `\nView full inquiry: ${data.pdfUrl}` : '',
    ``,
    `— Mahakaushal Sugar & Power Industries Ltd.`,
    `Village Bachai, Narsinghpur, MP - 487001`,
  ];

  return lines.filter(Boolean).join('\n');
}

export function buildRateRequestHTML(data: RateRequestData): string {
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
          <li>Vehicle must be in good condition with valid fitness certificate.</li>
          <li>Driver must carry valid license and vehicle documents.</li>
          <li>Transporter to provide GR (Bilty) at the time of loading.</li>
          <li>50% advance payment after bill generation; balance after delivery confirmation.</li>
          <li>Transporter is not responsible for insurance unless specifically agreed.</li>
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
