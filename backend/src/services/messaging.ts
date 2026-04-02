/**
 * Messaging Service — Email (SMTP) + Telegram
 *
 * ENV VARS:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   TELEGRAM_BOT_TOKEN (set via Settings or env var)
 */

import nodemailer from 'nodemailer';
import { sendTelegramMessage } from './telegramBot';

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

// ── Telegram ──

export interface TelegramOptions {
  chatId: string;
  message: string;
}

export interface TelegramResult {
  success: boolean;
  error?: string;
}

/** Send a Telegram message via the bot */
export async function sendTelegram(opts: TelegramOptions): Promise<TelegramResult> {
  try {
    await sendTelegramMessage(opts.chatId, opts.message);
    return { success: true };
  } catch (err: any) {
    console.error('[Telegram] Failed:', err.message);
    return { success: false, error: err.message };
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
