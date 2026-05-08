/**
 * Email Diagnostic — admin-only endpoint that runs the full SMTP pipeline
 * and returns the actual error so we can see what's failing in prod
 * without needing log access. Hit GET /api/admin/email-diagnostic.
 */

import { Router, Response } from 'express';
import nodemailer from 'nodemailer';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.get('/', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const env = {
    SMTP_HOST: process.env.SMTP_HOST || '(unset)',
    SMTP_PORT: process.env.SMTP_PORT || '(unset)',
    SMTP_USER: process.env.SMTP_USER || '(unset)',
    SMTP_PASS_set: !!process.env.SMTP_PASS,
    SMTP_PASS_len: (process.env.SMTP_PASS || '').length,
    SMTP_FROM: process.env.SMTP_FROM || '(unset)',
  };

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  let verifyResult: { ok: boolean; error?: string; code?: string } = { ok: false };
  try {
    await transporter.verify();
    verifyResult = { ok: true };
  } catch (err) {
    verifyResult = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string }).code,
    };
  }

  let sendResult: { ok: boolean; messageId?: string; error?: string; code?: string; response?: string } = { ok: false };
  if (verifyResult.ok) {
    try {
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || `"MSPIL ERP" <${process.env.SMTP_USER}>`,
        to: process.env.SMTP_USER || 'sales@mspil.in',
        subject: `ERP SMTP diagnostic ${new Date().toISOString()}`,
        text: 'This is a diagnostic email from /api/admin/email-diagnostic. If you got this, SMTP works from the Railway egress.',
      });
      sendResult = { ok: true, messageId: info.messageId, response: info.response };
    } catch (err) {
      sendResult = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string }).code,
        response: (err as { response?: string }).response,
      };
    }
  }

  res.json({ env, verify: verifyResult, send: sendResult });
}));

export default router;
