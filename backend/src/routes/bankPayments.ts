/**
 * UBI H2H Bank Payments — Maker-Checker-Releaser Workflow
 *
 * SECURITY MODEL:
 * - Maker (ACCOUNTANT): Creates payment batches from outstanding invoices
 * - Checker (ACCOUNTS_HEAD): Reviews and approves/rejects batches
 * - Releaser (MD/DIRECTOR): Final auth with Payment PIN → sends to bank
 * - Separation of duties: Maker ≠ Checker ≠ Releaser (enforced by system)
 * - Payment PIN: 6-digit bcrypt-hashed, 3 attempts then 30-min lock
 * - Full audit trail: every action logged with userId, IP, timestamp
 */

import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { encryptBuffer, isEncryptionConfigured } from '../services/bankEncryption';
import { uploadPaymentFile, isSftpConfigured, checkAckNack } from '../services/bankSftp';
import { generatePaymentFileContent, generateFileName, parseAckFile, parseNackFile } from '../services/bankFileGenerator';
import { onVendorPaymentMade } from '../services/autoJournal';
import { sendTelegramMessage } from '../services/telegramBot';

const router = Router();
router.use(authenticate as any);

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

/** Log an audit entry */
async function logAudit(params: {
  batchId?: string; itemId?: string; action: string;
  userId: string; userName: string; ipAddress?: string; userAgent?: string;
  details?: string;
}): Promise<void> {
  await prisma.bankPaymentAudit.create({ data: params }).catch(() => {});
}

/** Get user's payment role. ADMIN can act as any role. */
function getPaymentRole(user: AuthRequest['user']): string | null {
  if (!user) return null;
  if (user.role === 'ADMIN') return 'ADMIN'; // ADMIN can do everything
  return (user as Record<string, unknown>).paymentRole as string | null;
}

/** Check if user can perform maker actions */
function canMake(user: AuthRequest['user']): boolean {
  const role = getPaymentRole(user);
  return role === 'MAKER' || role === 'ADMIN';
}

/** Check if user can perform checker actions */
function canCheck(user: AuthRequest['user']): boolean {
  const role = getPaymentRole(user);
  return role === 'CHECKER' || role === 'ADMIN';
}

/** Check if user can perform releaser actions */
function canRelease(user: AuthRequest['user']): boolean {
  const role = getPaymentRole(user);
  return role === 'RELEASER' || role === 'ADMIN';
}

/** Notify users with specific payment roles via Telegram */
async function notifyRole(targetRole: string, message: string): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { paymentRole: targetRole },
          { role: 'ADMIN' },
        ],
      },
      select: { id: true, name: true },
    });
    // For now, log. Telegram chatId mapping will be added when users register their chat.
    console.log(`[BankPayments] Notify ${targetRole}: ${message} (${users.length} users)`);
  } catch {
    // Silent fail
  }
}

// ══════════════════════════════════════════════════════════════
// VALIDATION SCHEMAS
// ══════════════════════════════════════════════════════════════

const createBatchSchema = z.object({
  invoiceIds: z.array(z.string().min(1)).min(1, 'At least one invoice required').max(100),
  paymentType: z.enum(['NEFT', 'RTGS']).default('NEFT'),
});

const approveSchema = z.object({
  remarks: z.string().max(500).optional(),
});

const rejectSchema = z.object({
  remarks: z.string().min(1, 'Rejection remarks are required').max(500),
});

const releaseSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
});

const setPinSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  currentPin: z.string().regex(/^\d{6}$/).optional(),
});

// ══════════════════════════════════════════════════════════════
// BATCH MANAGEMENT (Maker)
// ══════════════════════════════════════════════════════════════

/** POST /batches — Create a new payment batch from selected vendor invoice IDs */
router.post('/batches', validate(createBatchSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!canMake(req.user)) {
    res.status(403).json({ error: 'Only users with MAKER role can create payment batches' });
    return;
  }

  const { invoiceIds, paymentType = 'NEFT' } = req.body;

  const type = paymentType === 'RTGS' ? 'RTGS' : 'NEFT';
  const debitAccount = process.env.UBI_DEBIT_ACCOUNT || '';
  const payerIfsc = process.env.UBI_PAYER_IFSC || '';

  // Fetch invoices with vendor details
  const invoices = await prisma.vendorInvoice.findMany({
    where: { id: { in: invoiceIds }, balanceAmount: { gt: 0 } },
    include: { vendor: true },
  });

  if (invoices.length === 0) {
    res.status(400).json({ error: 'No outstanding invoices found' });
    return;
  }

  // Validate vendor bank details
  const missingBank = invoices.filter(inv => !inv.vendor.bankAccount || !inv.vendor.bankIfsc);
  if (missingBank.length > 0) {
    const names = missingBank.map(inv => inv.vendor.name).join(', ');
    res.status(400).json({ error: `Missing bank details for: ${names}` });
    return;
  }

  // Create batch + items in transaction
  const batch = await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    const newBatch = await tx.bankPaymentBatch.create({
      data: {
        status: 'DRAFT',
        paymentType: type,
        debitAccount,
        payerIfsc,
        totalAmount: invoices.reduce((s: number, inv: { balanceAmount: number | null }) => s + (inv.balanceAmount || 0), 0),
        recordCount: invoices.length,
        createdBy: req.user!.id,
      },
    });

    // Create items
    for (const inv of invoices) {
      await tx.bankPaymentItem.create({
        data: {
          batchId: newBatch.id,
          vendorId: inv.vendor.id,
          vendorInvoiceId: inv.id,
          beneficiaryName: inv.vendor.name,
          beneficiaryAccount: inv.vendor.bankAccount!,
          beneficiaryIfsc: inv.vendor.bankIfsc!,
          beneficiaryBank: inv.vendor.bankName || '',
          beneficiaryEmail: inv.vendor.email || '',
          beneficiaryPhone: inv.vendor.phone || '',
          amount: inv.balanceAmount || 0,
          remarks: `INV-${inv.vendorInvNo || inv.id.substring(0, 8)}`,
          status: 'PENDING',
        },
      });
    }

    return newBatch;
  });

  await logAudit({
    batchId: batch.id, action: 'BATCH_CREATED',
    userId: req.user!.id, userName: req.user!.name,
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
    details: JSON.stringify({ invoiceCount: invoices.length, totalAmount: batch.totalAmount, paymentType: type }),
  });

  await notifyRole('CHECKER', `New payment batch #${batch.batchNo} created — ${invoices.length} payments, total ${batch.totalAmount.toLocaleString('en-IN')}`);

  const full = await prisma.bankPaymentBatch.findUnique({
    where: { id: batch.id },
    include: { items: true },
  });

  res.status(201).json(full);
}));

/** GET /batches — List batches with filters */
router.get('/batches', asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const skip = parseInt(req.query.offset as string) || 0;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const [batches, total] = await Promise.all([
    prisma.bankPaymentBatch.findMany({
      where,
      include: {
        items: {
          select: { id: true, beneficiaryName: true, amount: true, status: true, utrNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take, skip,
    }),
    prisma.bankPaymentBatch.count({ where }),
  ]);

  // Enrich with user names
  const userIds = new Set<string>();
  for (const b of batches) {
    userIds.add(b.createdBy);
    if (b.checkedBy) userIds.add(b.checkedBy);
    if (b.releasedBy) userIds.add(b.releasedBy);
  }
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map(u => [u.id, u.name]));

  const enriched = batches.map(b => ({
    ...b,
    createdByName: userMap.get(b.createdBy) || 'Unknown',
    checkedByName: b.checkedBy ? userMap.get(b.checkedBy) || 'Unknown' : null,
    releasedByName: b.releasedBy ? userMap.get(b.releasedBy) || 'Unknown' : null,
  }));

  res.json({ batches: enriched, total });
}));

/** GET /batches/:id — Get batch with items + audit trail */
router.get('/batches/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const batch = await prisma.bankPaymentBatch.findUnique({
    where: { id: req.params.id },
    include: {
      items: true,
      audit: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }

  // Get user names
  const userIds = new Set<string>([batch.createdBy]);
  if (batch.checkedBy) userIds.add(batch.checkedBy);
  if (batch.releasedBy) userIds.add(batch.releasedBy);
  for (const a of batch.audit) userIds.add(a.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map(u => [u.id, u.name]));

  res.json({
    ...batch,
    createdByName: userMap.get(batch.createdBy) || 'Unknown',
    checkedByName: batch.checkedBy ? userMap.get(batch.checkedBy) || 'Unknown' : null,
    releasedByName: batch.releasedBy ? userMap.get(batch.releasedBy) || 'Unknown' : null,
    audit: batch.audit.map(a => ({ ...a, userName: a.userName || userMap.get(a.userId) || 'Unknown' })),
  });
}));

/** DELETE /batches/:id/items/:itemId — Remove an item from DRAFT batch (Maker only) */
router.delete('/batches/:id/items/:itemId', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!canMake(req.user)) {
    res.status(403).json({ error: 'Only MAKER can modify batch items' }); return;
  }

  const batch = await prisma.bankPaymentBatch.findUnique({ where: { id: req.params.id } });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  if (batch.status !== 'DRAFT') {
    res.status(400).json({ error: 'Can only modify DRAFT batches' }); return;
  }
  if (batch.createdBy !== req.user!.id && getPaymentRole(req.user) !== 'ADMIN') {
    res.status(403).json({ error: 'Only the batch creator can remove items' }); return;
  }

  const item = await prisma.bankPaymentItem.findFirst({
    where: { id: req.params.itemId, batchId: req.params.id },
  });
  if (!item) { res.status(404).json({ error: 'Item not found in this batch' }); return; }

  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    await tx.bankPaymentItem.delete({ where: { id: item.id } });
    // Recalculate totals
    const remaining = await tx.bankPaymentItem.findMany({ where: { batchId: batch.id } });
    await tx.bankPaymentBatch.update({
      where: { id: batch.id },
      data: {
        totalAmount: remaining.reduce((s: number, i: { amount: number }) => s + i.amount, 0),
        recordCount: remaining.length,
      },
    });
  });

  await logAudit({
    batchId: batch.id, itemId: item.id, action: 'ITEM_REMOVED',
    userId: req.user!.id, userName: req.user!.name,
    ipAddress: req.ip, details: JSON.stringify({ vendorName: item.beneficiaryName, amount: item.amount }),
  });

  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════
// APPROVAL (Checker)
// ══════════════════════════════════════════════════════════════

/** POST /batches/:id/approve — Approve a batch (Checker) */
router.post('/batches/:id/approve', validate(approveSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!canCheck(req.user)) {
    res.status(403).json({ error: 'Only users with CHECKER role can approve batches' }); return;
  }

  const batch = await prisma.bankPaymentBatch.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  if (batch.status !== 'DRAFT') {
    res.status(400).json({ error: `Batch is ${batch.status}, not DRAFT` }); return;
  }

  // SECURITY: Checker must be different person than Maker
  if (batch.createdBy === req.user!.id) {
    res.status(403).json({ error: 'SECURITY: You cannot approve a batch you created. A different person must approve.' });
    return;
  }

  const remarks = req.body.remarks || null;

  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    await tx.bankPaymentBatch.update({
      where: { id: batch.id },
      data: {
        status: 'APPROVED',
        checkedBy: req.user!.id,
        checkedAt: new Date(),
        checkerRemarks: remarks,
      },
    });
    // Mark all pending items as approved
    await tx.bankPaymentItem.updateMany({
      where: { batchId: batch.id, status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
  });

  await logAudit({
    batchId: batch.id, action: 'APPROVED',
    userId: req.user!.id, userName: req.user!.name,
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
    details: JSON.stringify({ remarks, totalAmount: batch.totalAmount, recordCount: batch.recordCount }),
  });

  await notifyRole('RELEASER', `Payment batch #${batch.batchNo} APPROVED — ${batch.recordCount} payments, total Rs ${batch.totalAmount.toLocaleString('en-IN')}. Pending your release.`);

  res.json({ ok: true, status: 'APPROVED' });
}));

/** POST /batches/:id/reject — Reject a batch (Checker) */
router.post('/batches/:id/reject', validate(rejectSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!canCheck(req.user)) {
    res.status(403).json({ error: 'Only CHECKER can reject batches' }); return;
  }

  const batch = await prisma.bankPaymentBatch.findUnique({ where: { id: req.params.id } });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  if (batch.status !== 'DRAFT') {
    res.status(400).json({ error: `Batch is ${batch.status}, not DRAFT` }); return;
  }

  const remarks = req.body.remarks || 'Rejected by checker';

  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    await tx.bankPaymentBatch.update({
      where: { id: batch.id },
      data: {
        status: 'REJECTED',
        checkedBy: req.user!.id,
        checkedAt: new Date(),
        checkerRemarks: remarks,
      },
    });
    await tx.bankPaymentItem.updateMany({
      where: { batchId: batch.id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectionReason: remarks },
    });
  });

  await logAudit({
    batchId: batch.id, action: 'REJECTED',
    userId: req.user!.id, userName: req.user!.name,
    ipAddress: req.ip, details: JSON.stringify({ remarks }),
  });

  await notifyRole('MAKER', `Payment batch #${batch.batchNo} REJECTED by checker. Reason: ${remarks}`);

  res.json({ ok: true, status: 'REJECTED' });
}));

// ══════════════════════════════════════════════════════════════
// RELEASE TO BANK (Releaser — requires PIN)
// ══════════════════════════════════════════════════════════════

/** POST /batches/:id/release — Release batch to bank (Releaser, requires PIN) */
router.post('/batches/:id/release', validate(releaseSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!canRelease(req.user)) {
    res.status(403).json({ error: 'Only users with RELEASER role can release payments to bank' }); return;
  }

  const { pin } = req.body;

  // Verify PIN
  const pinRecord = await prisma.paymentPin.findUnique({ where: { userId: req.user!.id } });
  if (!pinRecord) {
    res.status(400).json({ error: 'Payment PIN not set. Please set your PIN in Settings first.' }); return;
  }

  // Check lockout
  if (pinRecord.lockedUntil && pinRecord.lockedUntil > new Date()) {
    const minsLeft = Math.ceil((pinRecord.lockedUntil.getTime() - Date.now()) / 60000);
    res.status(423).json({ error: `PIN locked due to failed attempts. Try again in ${minsLeft} minutes.` });

    await logAudit({
      action: 'PIN_LOCKED', userId: req.user!.id, userName: req.user!.name,
      ipAddress: req.ip, details: JSON.stringify({ lockedUntil: pinRecord.lockedUntil }),
    });
    return;
  }

  const pinValid = await bcrypt.compare(pin, pinRecord.pinHash);
  if (!pinValid) {
    const attempts = pinRecord.failedAttempts + 1;
    const lockUntil = attempts >= 3 ? new Date(Date.now() + 30 * 60 * 1000) : null; // 30 min lock after 3 fails

    await prisma.paymentPin.update({
      where: { userId: req.user!.id },
      data: { failedAttempts: attempts, lockedUntil: lockUntil },
    });

    await logAudit({
      action: 'PIN_FAILED', userId: req.user!.id, userName: req.user!.name,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      details: JSON.stringify({ attempt: attempts, locked: !!lockUntil }),
    });

    if (lockUntil) {
      res.status(423).json({ error: 'PIN incorrect. Account locked for 30 minutes after 3 failed attempts.' });
    } else {
      res.status(401).json({ error: `Incorrect PIN. ${3 - attempts} attempt(s) remaining before lockout.` });
    }
    return;
  }

  // PIN correct — reset failed attempts
  await prisma.paymentPin.update({
    where: { userId: req.user!.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });

  // Fetch batch
  const batch = await prisma.bankPaymentBatch.findUnique({
    where: { id: req.params.id },
    include: { items: { where: { status: 'APPROVED' } } },
  });
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
  if (batch.status !== 'APPROVED') {
    res.status(400).json({ error: `Batch is ${batch.status}, not APPROVED` }); return;
  }
  if (batch.items.length === 0) {
    res.status(400).json({ error: 'No approved items in this batch' }); return;
  }

  // SECURITY: Releaser must be different from Maker AND Checker
  if (batch.createdBy === req.user!.id) {
    res.status(403).json({ error: 'SECURITY: You cannot release a batch you created.' }); return;
  }
  if (batch.checkedBy === req.user!.id) {
    res.status(403).json({ error: 'SECURITY: You cannot release a batch you approved. A third person must release.' }); return;
  }

  // Generate payment file
  const fileContent = generatePaymentFileContent(
    {
      batchNo: batch.batchNo,
      paymentType: batch.paymentType,
      debitAccount: batch.debitAccount || process.env.UBI_DEBIT_ACCOUNT || '',
      payerIfsc: batch.payerIfsc || process.env.UBI_PAYER_IFSC || '',
    },
    batch.items.map(item => ({
      beneficiaryName: item.beneficiaryName,
      beneficiaryAccount: item.beneficiaryAccount,
      beneficiaryIfsc: item.beneficiaryIfsc,
      amount: item.amount,
      remarks: item.remarks || '',
      email: item.beneficiaryEmail || '',
      mobile: item.beneficiaryPhone || '',
    }))
  );

  const fileName = generateFileName(batch.batchNo, batch.paymentType);
  const fileBuffer = Buffer.from(fileContent, 'utf-8');

  // Encrypt
  const encryptedBuffer = encryptBuffer(fileBuffer);

  // Upload to SFTP (or mock)
  const uploadResult = await uploadPaymentFile(fileName, encryptedBuffer);
  if (!uploadResult.success) {
    console.error(`[BankPayments] SFTP upload failed for batch ${batch.batchNo}: ${uploadResult.error}`);
    res.status(500).json({ error: 'Failed to send file to bank. Contact admin.' }); return;
  }

  // Update batch + items
  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    await tx.bankPaymentBatch.update({
      where: { id: batch.id },
      data: {
        status: 'SENT_TO_BANK',
        releasedBy: req.user!.id,
        releasedAt: new Date(),
        fileName,
        sentAt: new Date(),
      },
    });
    await tx.bankPaymentItem.updateMany({
      where: { batchId: batch.id, status: 'APPROVED' },
      data: { status: 'SENT' },
    });
  });

  await logAudit({
    batchId: batch.id, action: 'RELEASED',
    userId: req.user!.id, userName: req.user!.name,
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
    details: JSON.stringify({
      fileName, totalAmount: batch.totalAmount, recordCount: batch.items.length,
      encrypted: isEncryptionConfigured(), sftpMode: isSftpConfigured() ? 'PRODUCTION' : 'MOCK',
    }),
  });

  await notifyRole('MAKER', `Payment batch #${batch.batchNo} RELEASED to bank — Rs ${batch.totalAmount.toLocaleString('en-IN')} (${batch.items.length} payments). File: ${fileName}`);
  await notifyRole('CHECKER', `Payment batch #${batch.batchNo} RELEASED to bank — Rs ${batch.totalAmount.toLocaleString('en-IN')}`);

  res.json({
    ok: true,
    status: 'SENT_TO_BANK',
    batchId: batch.id,
    batchNo: batch.batchNo,
    fileName,
    totalAmount: batch.totalAmount,
    recordCount: batch.items.length,
    encrypted: isEncryptionConfigured(),
    mode: isSftpConfigured() ? 'PRODUCTION' : 'MOCK',
  });
}));

// ══════════════════════════════════════════════════════════════
// PIN MANAGEMENT
// ══════════════════════════════════════════════════════════════

/** POST /pin/set — Set or change payment PIN */
router.post('/pin/set', validate(setPinSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!canRelease(req.user) && req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Only RELEASER or ADMIN can set a payment PIN' }); return;
  }

  const { pin, currentPin } = req.body;

  // If PIN already exists, require current PIN
  const existing = await prisma.paymentPin.findUnique({ where: { userId: req.user!.id } });
  if (existing) {
    if (!currentPin) {
      res.status(400).json({ error: 'Current PIN is required to change PIN' }); return;
    }
    const valid = await bcrypt.compare(currentPin, existing.pinHash);
    if (!valid) {
      res.status(401).json({ error: 'Current PIN is incorrect' }); return;
    }
  }

  const pinHash = await bcrypt.hash(pin, 10);
  await prisma.paymentPin.upsert({
    where: { userId: req.user!.id },
    create: { userId: req.user!.id, pinHash },
    update: { pinHash, failedAttempts: 0, lockedUntil: null },
  });

  await logAudit({
    action: existing ? 'PIN_CHANGED' : 'PIN_SET',
    userId: req.user!.id, userName: req.user!.name,
    ipAddress: req.ip,
  });

  res.json({ ok: true, message: existing ? 'Payment PIN changed' : 'Payment PIN set' });
}));

/** GET /pin/status — Check if current user has PIN set */
router.get('/pin/status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const pin = await prisma.paymentPin.findUnique({
    where: { userId: req.user!.id },
    select: { failedAttempts: true, lockedUntil: true, createdAt: true, updatedAt: true },
  });
  res.json({
    hasPin: !!pin,
    failedAttempts: pin?.failedAttempts || 0,
    isLocked: !!(pin?.lockedUntil && pin.lockedUntil > new Date()),
    lockedUntil: pin?.lockedUntil || null,
  });
}));

// ══════════════════════════════════════════════════════════════
// ACK/NACK PROCESSING
// ══════════════════════════════════════════════════════════════

/** POST /check-status — Poll SFTP for ACK/NACK files and update batch statuses */
router.post('/check-status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const files = await checkAckNack();
  if (files.length === 0) {
    res.json({ message: 'No new ACK/NACK files found', processed: 0 }); return;
  }

  let processed = 0;

  for (const file of files) {
    const content = file.content.toString('utf-8');

    // Find the batch this ACK/NACK belongs to (match by file name pattern)
    // File name: MSP8760_NEFT_Multiple_BATCH<no>_<ts>_ACK.csv
    const batchMatch = file.fileName.match(/BATCH(\d+)/);
    if (!batchMatch) continue;

    const batchNo = parseInt(batchMatch[1]);
    const batch = await prisma.bankPaymentBatch.findFirst({
      where: { batchNo, status: 'SENT_TO_BANK' },
      include: { items: { where: { status: 'SENT' } } },
    });
    if (!batch) continue;

    if (file.type === 'ACK') {
      const ackRecords = parseAckFile(content);

      // Update items with UTR numbers
      for (const item of batch.items) {
        const ackMatch = ackRecords.find(a =>
          a.beneficiaryAccount === item.beneficiaryAccount &&
          Math.abs(a.amount - item.amount) < 1
        );

        if (ackMatch) {
          await prisma.bankPaymentItem.update({
            where: { id: item.id },
            data: { status: 'SUCCESS', utrNumber: ackMatch.utrNumber },
          });

          // Create VendorPayment record
          if (item.vendorId && item.vendorInvoiceId) {
            const vendorPayment = await prisma.vendorPayment.create({
              data: {
                vendorId: item.vendorId,
                invoiceId: item.vendorInvoiceId,
                amount: item.amount,
                mode: batch.paymentType,
                reference: ackMatch.utrNumber || `BATCH-${batch.batchNo}`,
                bankFileBatch: `BATCH-${batch.batchNo}`,
                bankFileSentAt: batch.sentAt,
                userId: batch.createdBy,
                paymentDate: new Date(),
              },
            });

            // Update invoice balance
            const invoice = await prisma.vendorInvoice.findUnique({ where: { id: item.vendorInvoiceId } });
            if (invoice) {
              const newPaid = (invoice.paidAmount || 0) + item.amount;
              const newBalance = (invoice.netPayable || 0) - newPaid;
              await prisma.vendorInvoice.update({
                where: { id: invoice.id },
                data: {
                  paidAmount: newPaid,
                  balanceAmount: Math.max(0, newBalance),
                  status: newBalance <= 0 ? 'PAID' : 'PARTIAL_PAID',
                },
              });
            }

            // Auto-journal
            onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
              id: vendorPayment.id,
              amount: item.amount,
              mode: batch.paymentType,
              reference: ackMatch.utrNumber,
              tdsDeducted: 0,
              vendorId: item.vendorId,
              userId: batch.createdBy,
              paymentDate: new Date(),
            }).catch(() => {});

            await prisma.bankPaymentItem.update({
              where: { id: item.id },
              data: { vendorPaymentId: vendorPayment.id },
            });
          }
        }
      }

      await prisma.bankPaymentBatch.update({
        where: { id: batch.id },
        data: {
          status: 'COMPLETED',
          ackFileName: file.fileName,
          ackReceivedAt: new Date(),
          ackStatus: 'ACK',
        },
      });

      await logAudit({
        batchId: batch.id, action: 'ACK_RECEIVED',
        userId: req.user!.id, userName: req.user!.name,
        details: JSON.stringify({ fileName: file.fileName, records: ackRecords.length }),
      });

    } else {
      // NACK
      const nackRecords = parseNackFile(content);

      for (const item of batch.items) {
        const nackMatch = nackRecords.find(n =>
          n.beneficiaryAccount === item.beneficiaryAccount
        );
        await prisma.bankPaymentItem.update({
          where: { id: item.id },
          data: {
            status: 'FAILED',
            failureReason: nackMatch?.failureReason || 'Payment rejected by bank',
          },
        });
      }

      await prisma.bankPaymentBatch.update({
        where: { id: batch.id },
        data: {
          status: 'FAILED',
          ackFileName: file.fileName,
          ackReceivedAt: new Date(),
          ackStatus: 'NACK',
          ackRemarks: nackRecords.map(n => n.failureReason).join('; '),
        },
      });

      await logAudit({
        batchId: batch.id, action: 'NACK_RECEIVED',
        userId: req.user!.id, userName: req.user!.name,
        details: JSON.stringify({ fileName: file.fileName, records: nackRecords.length }),
      });

      await notifyRole('MAKER', `ALERT: Payment batch #${batch.batchNo} FAILED — bank returned NACK. Check details.`);
      await notifyRole('RELEASER', `ALERT: Payment batch #${batch.batchNo} FAILED — bank returned NACK.`);
    }

    processed++;
  }

  res.json({ message: `Processed ${processed} ACK/NACK file(s)`, processed });
}));

// ══════════════════════════════════════════════════════════════
// STATUS & CONFIG
// ══════════════════════════════════════════════════════════════

/** GET /config — Get bank payment integration status */
router.get('/config', asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({
    sftpConfigured: isSftpConfigured(),
    encryptionConfigured: isEncryptionConfigured(),
    clientCode: process.env.UBI_CLIENT_CODE || 'MSP8760',
    debitAccount: process.env.UBI_DEBIT_ACCOUNT ? '****' + (process.env.UBI_DEBIT_ACCOUNT).slice(-4) : 'NOT SET',
    payerIfsc: process.env.UBI_PAYER_IFSC || 'NOT SET',
    mode: isSftpConfigured() ? 'PRODUCTION' : 'MOCK (files saved locally)',
  });
}));

/** GET /summary — Dashboard summary counts */
router.get('/summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const [draft, approved, sent, completed, failed] = await Promise.all([
    prisma.bankPaymentBatch.count({ where: { status: 'DRAFT' } }),
    prisma.bankPaymentBatch.count({ where: { status: 'APPROVED' } }),
    prisma.bankPaymentBatch.count({ where: { status: 'SENT_TO_BANK' } }),
    prisma.bankPaymentBatch.count({ where: { status: 'COMPLETED' } }),
    prisma.bankPaymentBatch.count({ where: { status: 'FAILED' } }),
  ]);
  res.json({ draft, approved, sent, completed, failed });
}));

export default router;
