import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError, ValidationError } from '../shared/errors';
import { onContractorBillConfirmed, onContractorPaymentMade } from '../services/autoJournal';
import { z } from 'zod';
import { COMPANY } from '../shared/config/company';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
// RAG indexing removed — only compliance docs go to RAG
import { generateVaultNote } from '../services/vaultWriter';

const router = Router();
router.use(authenticate as any);

// File upload config for contractor bills
const uploadDir = path.join(__dirname, '../../uploads/contractor-bills');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit: z.string().default('NOS'),
  rate: z.number().min(0),
});

const createBillSchema = z.object({
  contractorId: z.string().uuid(),
  purchaseOrderId: z.string().optional().nullable(),
  billDate: z.string().optional(),
  billPath: z.enum(['CREATED', 'UPLOADED']),
  description: z.string().min(1),
  lines: z.array(lineSchema).optional(),
  vendorBillNo: z.string().optional().nullable(),
  subtotal: z.number().optional(),
  cgstPercent: z.number().min(0).default(0),
  sgstPercent: z.number().min(0).default(0),
  igstPercent: z.number().min(0).default(0),
});

const paySchema = z.object({
  amount: z.number().positive(),
  tdsDeducted: z.number().min(0).default(0),
  paymentMode: z.enum(['CASH', 'NEFT', 'RTGS', 'UPI', 'CHEQUE', 'BANK_TRANSFER']),
  paymentRef: z.string().optional().nullable(),
  paymentDate: z.string().optional(),
  remarks: z.string().optional().nullable(),
});

// GET / — list bills with filters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (req.query.contractorId) where.contractorId = req.query.contractorId;
  if (req.query.status) where.status = req.query.status;

  if (req.query.from || req.query.to) {
    const dateFilter: Record<string, unknown> = {};
    if (req.query.from) dateFilter.gte = new Date(req.query.from as string);
    if (req.query.to) dateFilter.lte = new Date(req.query.to as string);
    where.billDate = dateFilter;
  }

  const bills = await prisma.contractorBill.findMany({
    where,
    include: {
      contractor: { select: { id: true, name: true, contractorCode: true, panType: true, contractorType: true } },
      purchaseOrder: { select: { id: true, poNo: true, status: true, dealType: true } },
      lines: true,
      _count: { select: { payments: true } },
    },
    orderBy: { billDate: 'desc' },
    take: 200,
  });

  // Stats
  const allBills = await prisma.contractorBill.findMany({
    where: { status: { not: 'CANCELLED' }, ...getCompanyFilter(req) },
    select: { status: true, netPayable: true, paidAmount: true, balanceAmount: true },
  
    take: 500,
  });

  const stats = {
    total: allBills.length,
    draft: allBills.filter(b => b.status === 'DRAFT').length,
    confirmed: allBills.filter(b => b.status === 'CONFIRMED').length,
    outstanding: allBills.filter(b => ['CONFIRMED', 'PARTIAL_PAID'].includes(b.status)).reduce((s, b) => s + b.balanceAmount, 0),
    paid: allBills.filter(b => b.status === 'PAID').reduce((s, b) => s + b.netPayable, 0),
  };

  res.json({ bills, stats });
}));

// GET /:id — single bill with full detail
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const bill = await prisma.contractorBill.findUnique({
    where: { id: req.params.id },
    include: {
      contractor: true,
      lines: true,
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  });
  if (!bill) throw new NotFoundError('ContractorBill', req.params.id);
  res.json(bill);
}));

// POST / — create bill (Path A: CREATED with lines, Path B: UPLOADED with amounts)
router.post('/', validate(createBillSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { contractorId, purchaseOrderId, billPath, lines, vendorBillNo, cgstPercent, sgstPercent, igstPercent, description, billDate } = req.body;

  const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
  if (!contractor) throw new NotFoundError('Contractor', contractorId);

  let subtotal = 0;

  if (billPath === 'CREATED') {
    if (!lines || lines.length === 0) throw new ValidationError('Lines are required for CREATED bill path');
    subtotal = lines.reduce((s: number, l: { quantity: number; rate: number }) => s + l.quantity * l.rate, 0);
  } else {
    // UPLOADED path: subtotal from body
    subtotal = req.body.subtotal || 0;
    if (subtotal <= 0) throw new ValidationError('Subtotal must be positive for uploaded bills');
  }

  // Calculate GST
  const cgstAmount = Math.round(subtotal * (cgstPercent / 100) * 100) / 100;
  const sgstAmount = Math.round(subtotal * (sgstPercent / 100) * 100) / 100;
  const igstAmount = Math.round(subtotal * (igstPercent / 100) * 100) / 100;
  const totalAmount = Math.round((subtotal + cgstAmount + sgstAmount + igstAmount) * 100) / 100;

  // TDS on base amount (before GST) per 194C
  const tdsPercent = contractor.tdsPercent;
  const tdsAmount = Math.round(subtotal * (tdsPercent / 100) * 100) / 100;
  const netPayable = Math.round((totalAmount - tdsAmount) * 100) / 100;

  const bill = await prisma.contractorBill.create({
    data: {
      contractorId,
      purchaseOrderId: purchaseOrderId || null,
      billDate: billDate ? new Date(billDate) : new Date(),
      billPath,
      description,
      subtotal,
      cgstPercent, sgstPercent, igstPercent,
      cgstAmount, sgstAmount, igstAmount,
      totalAmount,
      tdsPercent,
      tdsAmount,
      netPayable,
      paidAmount: 0,
      balanceAmount: netPayable,
      status: 'DRAFT',
      vendorBillNo: vendorBillNo || null,
      itcEligible: !!contractor.gstin,
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
      lines: billPath === 'CREATED' && lines ? {
        create: lines.map((l: { description: string; quantity: number; unit: string; rate: number }) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit || 'NOS',
          rate: l.rate,
          amount: Math.round(l.quantity * l.rate * 100) / 100,
        })),
      } : undefined,
    },
    include: { contractor: true, lines: true },
  });

  res.status(201).json(bill);
}));

// PUT /:id — update draft bill
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const bill = await prisma.contractorBill.findUnique({ where: { id: req.params.id } });
  if (!bill) throw new NotFoundError('ContractorBill', req.params.id);
  if (bill.status !== 'DRAFT') throw new ValidationError('Only DRAFT bills can be edited');

  const { description, lines, vendorBillNo, cgstPercent, sgstPercent, igstPercent, billDate, subtotal: bodySubtotal } = req.body;

  let subtotal = bill.subtotal;

  // If lines provided (CREATED path), recalculate
  if (lines && Array.isArray(lines)) {
    subtotal = lines.reduce((s: number, l: { quantity: number; rate: number }) => s + l.quantity * l.rate, 0);
    // Delete old lines and create new
    await prisma.contractorBillLine.deleteMany({ where: { billId: bill.id } });
    await prisma.contractorBillLine.createMany({
      data: lines.map((l: { description: string; quantity: number; unit: string; rate: number }) => ({
        billId: bill.id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit || 'NOS',
        rate: l.rate,
        amount: Math.round(l.quantity * l.rate * 100) / 100,
      })),
    });
  } else if (bodySubtotal !== undefined) {
    subtotal = bodySubtotal;
  }

  const cPct = cgstPercent ?? bill.cgstPercent;
  const sPct = sgstPercent ?? bill.sgstPercent;
  const iPct = igstPercent ?? bill.igstPercent;

  const cgstAmount = Math.round(subtotal * (cPct / 100) * 100) / 100;
  const sgstAmount = Math.round(subtotal * (sPct / 100) * 100) / 100;
  const igstAmount = Math.round(subtotal * (iPct / 100) * 100) / 100;
  const totalAmount = Math.round((subtotal + cgstAmount + sgstAmount + igstAmount) * 100) / 100;
  const tdsAmount = Math.round(subtotal * (bill.tdsPercent / 100) * 100) / 100;
  const netPayable = Math.round((totalAmount - tdsAmount) * 100) / 100;

  const updated = await prisma.contractorBill.update({
    where: { id: req.params.id },
    data: {
      description: description ?? bill.description,
      billDate: billDate ? new Date(billDate) : bill.billDate,
      vendorBillNo: vendorBillNo !== undefined ? vendorBillNo : bill.vendorBillNo,
      subtotal,
      cgstPercent: cPct, sgstPercent: sPct, igstPercent: iPct,
      cgstAmount, sgstAmount, igstAmount,
      totalAmount, tdsAmount, netPayable,
      balanceAmount: netPayable,
    },
    include: { contractor: true, lines: true },
  });

  res.json(updated);
}));

// POST /:id/confirm — confirm bill, triggers accrual journal
router.post('/:id/confirm', asyncHandler(async (req: AuthRequest, res: Response) => {
  const bill = await prisma.contractorBill.findUnique({
    where: { id: req.params.id },
    include: { contractor: true },
  });
  if (!bill) throw new NotFoundError('ContractorBill', req.params.id);
  if (bill.status !== 'DRAFT') throw new ValidationError('Only DRAFT bills can be confirmed');

  // For UPLOADED path, document should be uploaded (warn but don't block)
  const updated = await prisma.contractorBill.update({
    where: { id: req.params.id },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedBy: req.user!.id,
    },
    include: { contractor: true, lines: true },
  });

  // Auto-journal: accrual entry
  await onContractorBillConfirmed(prisma, {
    id: bill.id,
    billNo: bill.billNo,
    subtotal: bill.subtotal,
    cgstAmount: bill.cgstAmount,
    sgstAmount: bill.sgstAmount,
    igstAmount: bill.igstAmount,
    totalAmount: bill.totalAmount,
    tdsAmount: bill.tdsAmount,
    netPayable: bill.netPayable,
    contractorId: bill.contractorId,
    contractorName: bill.contractor.name,
    userId: req.user!.id,
    billDate: bill.billDate,
  });

  res.json(updated);
}));

// POST /:id/cancel — cancel bill (DRAFT or CONFIRMED with no payments)
router.post('/:id/cancel', asyncHandler(async (req: AuthRequest, res: Response) => {
  const bill = await prisma.contractorBill.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { payments: true } } },
  });
  if (!bill) throw new NotFoundError('ContractorBill', req.params.id);
  if (bill.paidAmount > 0 || bill._count.payments > 0) throw new ValidationError('Cannot cancel bill with payments');
  if (!['DRAFT', 'CONFIRMED'].includes(bill.status)) throw new ValidationError('Only DRAFT or CONFIRMED bills can be cancelled');

  const updated = await prisma.contractorBill.update({
    where: { id: req.params.id },
    data: { status: 'CANCELLED' },
  });

  res.json(updated);
}));

// GET /:id/print — printable bill data
router.get('/:id/print', asyncHandler(async (req: AuthRequest, res: Response) => {
  const bill = await prisma.contractorBill.findUnique({
    where: { id: req.params.id },
    include: { contractor: true, lines: true },
  });
  if (!bill) throw new NotFoundError('ContractorBill', req.params.id);

  // Return structured data for frontend to render print view
  res.json({
    bill,
    company: {
      name: COMPANY.name.toUpperCase(),
      address: `${COMPANY.address.line1}, ${COMPANY.address.line2}, ${COMPANY.address.state} ${COMPANY.address.pincode}`,
      gstin: COMPANY.gstin,
    },
  });
}));

// POST /:id/upload — upload document for bill
router.post('/:id/upload', upload.single('document'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const bill = await prisma.contractorBill.findUnique({ where: { id: req.params.id } });
  if (!bill) throw new NotFoundError('ContractorBill', req.params.id);
  if (!req.file) throw new ValidationError('No file uploaded');

  const documentUrl = `/uploads/contractor-bills/${req.file.filename}`;
  const updated = await prisma.contractorBill.update({
    where: { id: req.params.id },
    data: { documentUrl },
  });

  res.json(updated);


  // Fire-and-forget: generate vault note
  setImmediate(() => {
    generateVaultNote({
      sourceType: 'ContractorBill',
      sourceId: req.params.id,
      filePath: `contractor-bills/${req.file!.filename}`,
      title: req.file!.originalname,
      category: 'CONTRACT',
      mimeType: req.file!.mimetype,
    }).catch(err => console.error('[ContractorBill] Vault note failed:', err));
  });
}));

// POST /:id/pay — record payment against bill
router.post('/:id/pay', validate(paySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const bill = await prisma.contractorBill.findUnique({
    where: { id: req.params.id },
    include: { contractor: true },
  });
  if (!bill) throw new NotFoundError('ContractorBill', req.params.id);
  if (!['CONFIRMED', 'PARTIAL_PAID'].includes(bill.status)) {
    throw new ValidationError('Bill must be CONFIRMED or PARTIAL_PAID to accept payment');
  }

  const { amount, tdsDeducted, paymentMode, paymentRef, paymentDate, remarks } = req.body;

  if (amount + tdsDeducted > bill.balanceAmount + 0.01) {
    throw new ValidationError(`Payment (${amount} + TDS ${tdsDeducted}) exceeds balance (${bill.balanceAmount})`);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Re-read bill inside transaction for concurrency safety
    const freshBill = await tx.contractorBill.findUnique({ where: { id: bill.id } });
    if (!freshBill || !['CONFIRMED', 'PARTIAL_PAID'].includes(freshBill.status)) {
      throw new ValidationError('Bill is no longer payable');
    }
    if (amount + tdsDeducted > freshBill.balanceAmount + 0.01) {
      throw new ValidationError(`Payment (${amount} + TDS ${tdsDeducted}) exceeds current balance (${freshBill.balanceAmount})`);
    }

    // Create payment record
    const payment = await tx.contractorPayment.create({
      data: {
        contractorId: bill.contractorId,
        billId: bill.id,
        amount,
        tdsDeducted,
        paymentMode,
        paymentRef: paymentRef || null,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        paymentStatus: 'CONFIRMED',
        remarks: remarks || null,
        userId: req.user!.id,
      },
    });

    // Update bill balance
    const totalSettled = amount + tdsDeducted;
    const newPaid = Math.round((freshBill.paidAmount + totalSettled) * 100) / 100;
    const newBalance = Math.round((freshBill.netPayable - newPaid) * 100) / 100;
    const newStatus = newBalance <= 0.01 ? 'PAID' : 'PARTIAL_PAID';

    await tx.contractorBill.update({
      where: { id: bill.id },
      data: {
        paidAmount: newPaid,
        balanceAmount: Math.max(0, newBalance),
        status: newStatus,
      },
    });

    return payment;
  });

  // Auto-journal for payment
  await onContractorPaymentMade(prisma, {
    id: result.id,
    amount,
    mode: paymentMode,
    reference: paymentRef,
    tdsDeducted,
    contractorId: bill.contractorId,
    contractorName: bill.contractor.name,
    userId: req.user!.id,
    paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
  });

  res.status(201).json(result);
}));

// GET /payments/all — all contractor payments (for Payments tab)
router.get('/payments/all', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = {};
  if (req.query.contractorId) where.contractorId = req.query.contractorId;

  if (req.query.from || req.query.to) {
    const dateFilter: Record<string, unknown> = {};
    if (req.query.from) dateFilter.gte = new Date(req.query.from as string);
    if (req.query.to) dateFilter.lte = new Date(req.query.to as string);
    where.paymentDate = dateFilter;
  }

  const payments = await prisma.contractorPayment.findMany({
    where,
    include: {
      contractor: { select: { id: true, name: true, contractorCode: true } },
      bill: { select: { id: true, billNo: true, description: true } },
    },
    orderBy: { paymentDate: 'desc' },
    take: 200,
  });

  res.json({ payments });
}));

export default router;
