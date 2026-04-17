import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import { onVendorPaymentMade } from '../services/autoJournal';
import { recomputeGrnPaidStateForPO } from '../services/grnPaidState';
import { renderDocumentPdf } from '../services/documentRenderer';
import { nextDocNo } from '../utils/docSequence';
import { getCompanyForPdf } from '../utils/pdfCompanyHelper';
import { sendEmail } from '../services/messaging';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

// ── Zod schemas ──
const createVendorPaymentSchema = z.object({
  vendorId: z.string().min(1),
  invoiceId: z.string().optional().nullable(),
  amount: z.coerce.number().positive(),
  mode: z.string().optional().default('BANK_TRANSFER'),
  reference: z.string().optional().default(''),
  tdsDeducted: z.coerce.number().optional().default(0),
  tdsSection: z.string().optional().nullable(),
  tdsLedgerId: z.string().optional().nullable(),
  isAdvance: z.boolean().optional().default(false),
  remarks: z.string().optional().nullable(),
  paymentDate: z.string().optional(),
  // Compulsory GST declaration at Pay time (legacy payments may omit this)
  hasGst: z.boolean({ required_error: 'Select whether this payment includes GST' }),
});

const splitPaymentSchema = z.object({
  vendorId: z.string().min(1),
  invoiceId: z.string().optional().nullable(),
  splits: z.array(z.object({
    mode: z.string().min(1),
    amount: z.coerce.number().positive(),
    reference: z.string().optional(),
    remarks: z.string().optional(),
  })).min(1),
  tdsDeducted: z.coerce.number().optional().default(0),
  tdsSection: z.string().optional().nullable(),
  paymentDate: z.string().optional(),
  poNo: z.coerce.number().optional(),
  // Compulsory GST declaration at Pay time
  hasGst: z.boolean({ required_error: 'Select whether this payment includes GST' }),
});

// Vendor-level multi-allocation: one lump-sum transfer spread across N POs
// of the same vendor with optional "rest as advance". Captures compulsory GST
// and optional TDS (withheld at source; stored on the first allocation for audit).
const allocateSchema = z.object({
  vendorId: z.string().min(1),
  mode: z.string().optional().default('NEFT'),
  reference: z.string().optional().default(''),
  remarks: z.string().optional().nullable(),
  paymentDate: z.string().optional(),
  hasGst: z.boolean({ required_error: 'Select whether this payment includes GST' }),
  allocations: z.array(z.object({
    poId: z.string().min(1),
    amount: z.coerce.number().positive(),
  })).default([]),
  advanceAmount: z.coerce.number().nonnegative().default(0),
  // TDS deducted at source (payable to govt, not to vendor). Bank transfer = sum − tds.
  tdsDeducted: z.coerce.number().nonnegative().optional().default(0),
  tdsSection: z.string().optional().nullable(),
});

const router = Router();
router.use(authenticate as any);

// ── Multer for bank-receipt uploads (PDF/JPG of bank confirmation) ──
const bankReceiptDir = path.join(__dirname, '../../uploads/bank-receipts');
if (!fs.existsSync(bankReceiptDir)) fs.mkdirSync(bankReceiptDir, { recursive: true });
const bankReceiptStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, bankReceiptDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
const bankReceiptUpload = multer({ storage: bankReceiptStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// ═══════════════════════════════════════════════
// Build data payload for the Payment Advice template.
// Shared by GET /:id/pdf and POST /:id/send-email so both emit the exact same document.
// ═══════════════════════════════════════════════
async function buildPaymentAdviceData(paymentId: string) {
  const payment = await prisma.vendorPayment.findUnique({
    where: { id: paymentId },
    include: {
      vendor: true,
      invoice: {
        include: {
          po: { select: { poNo: true } },
          grn: { select: { grnNo: true, grnDate: true, vehicleNo: true, totalAmount: true, totalQty: true } },
        },
      },
    },
  });
  if (!payment) return null;

  interface PaymentSplit { mode: string; amount: number; reference: string; date: Date; type: string }
  const paymentSplits: PaymentSplit[] = [];

  if (payment.invoiceId) {
    const siblingPayments = await prisma.vendorPayment.findMany({
      where: { invoiceId: payment.invoiceId },
      orderBy: { paymentDate: 'asc' },
      select: { mode: true, amount: true, reference: true, paymentDate: true },
    });
    for (const p of siblingPayments) {
      paymentSplits.push({ mode: p.mode, amount: p.amount, reference: p.reference || '', date: p.paymentDate, type: 'Bank Transfer' });
    }
  } else {
    paymentSplits.push({ mode: payment.mode, amount: payment.amount, reference: payment.reference || '', date: payment.paymentDate, type: 'Bank Transfer' });
  }

  const poNo = payment.invoice?.po?.poNo;
  if (poNo) {
    try {
      const cashVouchers = await prisma.$queryRawUnsafe(
        `SELECT amount, "paymentRef", date, "paymentMode" FROM "CashVoucher" WHERE type = 'PAYMENT' AND status = 'SETTLED' AND "payeeName" = $1 AND purpose LIKE $2 ORDER BY date`,
        payment.vendor.name, `%PO-${poNo}%`
      ) as Array<{ amount: number; paymentRef: string; date: Date; paymentMode: string }>;
      for (const cv of cashVouchers) {
        paymentSplits.push({ mode: cv.paymentMode || 'CASH', amount: cv.amount, reference: cv.paymentRef || '', date: cv.date, type: 'Cash Voucher' });
      }
    } catch { /* CashVoucher table may not exist */ }
  }

  const grns: Array<Record<string, unknown>> = [];
  if (payment.invoice?.grn) {
    const g = payment.invoice.grn;
    grns.push({
      grnNo: g.grnNo, grnDate: g.grnDate, vehicleNo: g.vehicleNo || '',
      grossWeight: 0, tareWeight: 0, netWeight: g.totalQty || 0,
      totalAmount: g.totalAmount,
    });
  }

  const totalPaid = paymentSplits.reduce((s, p) => s + p.amount, 0);
  const totalPayable = payment.invoice?.netPayable || totalPaid;
  const tdsDeducted = payment.tdsDeducted || 0;

  // Pull the clean UTR / bank-ref out of the free-text reference (e.g. "RTGSO-JAY BAJRANG ... UBINR22026041601296969")
  const utrMatch = (payment.reference || '').match(/([A-Z]{4}[A-Z0-9]{8,})\s*$/);
  const utrDisplay = utrMatch ? utrMatch[1] : (payment.reference || '-');

  // GST Status label — comes from the compulsory choice captured at Pay time
  const gstStatusLabel = payment.hasGst === true
    ? 'INCLUSIVE OF GST'
    : payment.hasGst === false
      ? 'EXCLUSIVE OF GST (ADVANCE / WITHOUT GST)'
      : 'NOT CAPTURED';

  const data: Record<string, unknown> = {
    paymentNo: payment.paymentNo,
    paymentDate: payment.paymentDate,
    poNo,
    invoiceRef: payment.invoice?.vendorInvNo || '',
    utrDisplay,
    hasGst: payment.hasGst === true,
    gstStatusLabel,
    vendor: {
      name: payment.vendor.name,
      address: [payment.vendor.address, payment.vendor.city, payment.vendor.state].filter(Boolean).join(', '),
      gstin: payment.vendor.gstin || '',
      phone: payment.vendor.phone || '',
      bankName: payment.vendor.bankName || '',
      bankAccount: payment.vendor.bankAccount || '',
    },
    grn: grns.length > 0,
    grns,
    invoice: payment.invoice ? {
      vendorInvNo: payment.invoice.vendorInvNo,
      invoiceDate: payment.invoice.invoiceDate || payment.invoice.vendorInvDate,
      subtotal: payment.invoice.subtotal || payment.invoice.totalAmount,
      gstAmount: (payment.invoice.cgstAmount || 0) + (payment.invoice.sgstAmount || 0) + (payment.invoice.igstAmount || 0),
      netPayable: payment.invoice.netPayable,
    } : null,
    payments: paymentSplits,
    totalPayable,
    tdsDeducted,
    tdsSection: payment.tdsSection || '',
    totalPaid,
    balance: Math.max(0, totalPayable - totalPaid - tdsDeducted),
    preparedBy: 'Accounts Dept',
    authorizedSignatory: '',
    remarks: payment.remarks || '',
  };

  data.company = await getCompanyForPdf(payment.companyId);

  return { payment, data, totalPaid };
}

// ═══════════════════════════════════════════════
// GET /:id/pdf — Payment Advice PDF (single payment or full split view)
// ═══════════════════════════════════════════════
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const built = await buildPaymentAdviceData(req.params.id);
  if (!built) return res.status(404).json({ error: 'Payment not found' });
  const { payment, data } = built;

  const pdf = await renderDocumentPdf({ docType: 'PAYMENT_CONFIRMATION', data, verifyId: payment.id });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Payment-Advice-PAY-${payment.paymentNo}.pdf"`);
  res.send(pdf);
}));

// GET / — list payments with filters (vendorId, from, to)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vendorId = req.query.vendorId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where: any = { ...getCompanyFilter(req) };
    if (vendorId) where.vendorId = vendorId;
    if (from || to) {
      where.paymentDate = {};
      if (from) where.paymentDate.gte = new Date(from);
      if (to) where.paymentDate.lte = new Date(to);
    }

    const payments = await prisma.vendorPayment.findMany({
      where,
      include: {
        vendor: true,
        invoice: true,
      },
      orderBy: { paymentDate: 'desc' },
      take: 200,
    });

    res.json({ payments });
}));

// GET /ledger/:vendorId — vendor ledger (timeline with running balance)
router.get('/ledger/:vendorId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vendorId = req.params.vendorId;

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    // Get invoices, payments, POs, and cash voucher payments by name
    const [invoices, payments, pos, cashVouchers] = await Promise.all([
      prisma.vendorInvoice.findMany({ where: { ...getCompanyFilter(req), vendorId }, orderBy: { invoiceDate: 'asc' } }),
      prisma.vendorPayment.findMany({ where: { ...getCompanyFilter(req), vendorId }, orderBy: { paymentDate: 'asc' } }),
      prisma.purchaseOrder.findMany({ where: { ...getCompanyFilter(req), vendorId }, orderBy: { poDate: 'asc' } }),
      prisma.cashVoucher.findMany({
        where: { type: 'PAYMENT', status: { not: 'CANCELLED' }, payeeName: { equals: vendor.name, mode: 'insensitive' } },
        orderBy: { date: 'asc' },
      }),
    ]);

    // Combine and sort by date
    const ledgerItems: any[] = [];
    for (const po of pos) {
      ledgerItems.push({
        date: po.poDate,
        type: 'PO',
        reference: `PO-${po.poNo}`,
        debit: 0,
        credit: 0,
        info: `Order placed: ₹${(po.grandTotal || 0).toLocaleString('en-IN')}`,
      });
    }
    for (const inv of invoices) {
      ledgerItems.push({
        date: inv.invoiceDate,
        type: 'INVOICE',
        reference: inv.vendorInvNo,
        debit: inv.netPayable || 0,
        credit: 0,
        invoice: inv,
      });
    }
    for (const pmt of payments) {
      ledgerItems.push({
        date: pmt.paymentDate,
        type: 'PAYMENT',
        reference: pmt.reference,
        debit: 0,
        credit: pmt.amount,
        payment: pmt,
      });
    }
    for (const cv of cashVouchers) {
      ledgerItems.push({
        date: cv.date,
        type: 'CASH PAYMENT',
        reference: `CV-${cv.voucherNo}`,
        debit: 0,
        credit: cv.amount,
      });
    }

    ledgerItems.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calculate running balance
    let balance = 0;
    const withBalance = ledgerItems.map(item => {
      balance += item.debit - item.credit;
      return {
        ...item,
        runningBalance: balance,
      };
    });

    res.json({
      vendor,
      ledger: withBalance,
      currentBalance: balance,
    });
}));

// GET /outstanding — outstanding payables grouped by vendor
router.get('/outstanding', asyncHandler(async (req: AuthRequest, res: Response) => {
    // Find invoice IDs already in active bank payment batches (DRAFT/APPROVED/SENT_TO_BANK)
    const activeItems = await prisma.bankPaymentItem.findMany({
      where: {
        vendorInvoiceId: { not: null },
        batch: { status: { in: ['DRAFT', 'APPROVED', 'RELEASED', 'SENT_TO_BANK'] } },
      },
      select: { vendorInvoiceId: true },
    });
    const excludeIds = activeItems.map(i => i.vendorInvoiceId).filter(Boolean) as string[];

    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        ...getCompanyFilter(req),
        balanceAmount: {
          gt: 0,
        },
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      },
      include: {
        vendor: true,
      },
      take: 500,
    });

    // Group by vendor
    const grouped: Record<string, any> = {};
    for (const inv of invoices) {
      const vendorId = inv.vendorId;
      if (!grouped[vendorId]) {
        grouped[vendorId] = {
          vendor: inv.vendor,
          invoices: [],
          totalOutstanding: 0,
        };
      }
      grouped[vendorId].invoices.push(inv);
      grouped[vendorId].totalOutstanding += inv.balanceAmount || 0;
    }

    res.json({ outstanding: Object.values(grouped) });
}));

// POST / — create payment
router.post('/', validate(createVendorPaymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const amount = parseFloat(b.amount) || 0;
    const tdsDeducted = parseFloat(b.tdsDeducted) || 0;

    // Wrap in transaction to ensure atomicity
    const companyId = getActiveCompanyId(req);
    const paymentNo = await nextDocNo('VendorPayment', 'paymentNo', companyId);

    const payment = await prisma.$transaction(async (tx: any) => {
      const newPayment = await tx.vendorPayment.create({
        data: {
          paymentNo,
          vendorId: b.vendorId,
          invoiceId: b.invoiceId || null,
          amount,
          mode: b.mode || 'BANK_TRANSFER',
          reference: b.reference || '',
          tdsDeducted,
          tdsSection: b.tdsSection || null,
          isAdvance: b.isAdvance || false,
          remarks: b.remarks || null,
          paymentDate: b.paymentDate ? new Date(b.paymentDate) : new Date(),
          hasGst: b.hasGst === true,
          userId: req.user!.id,
          companyId,
        },
      });

      // Update invoice if linked
      if (b.invoiceId) {
        const invoice = await tx.vendorInvoice.findUnique({
          where: { id: b.invoiceId },
        });
        if (invoice) {
          const newPaidAmount = (invoice.paidAmount || 0) + amount;
          const newBalanceAmount = (invoice.netPayable || 0) - newPaidAmount;
          let newStatus = invoice.status;

          if (newBalanceAmount <= 0) {
            newStatus = 'PAID';
          } else if (newPaidAmount > 0) {
            newStatus = 'PARTIAL_PAID';
          }

          await tx.vendorInvoice.update({
            where: { id: b.invoiceId },
            data: {
              paidAmount: newPaidAmount,
              balanceAmount: Math.max(0, newBalanceAmount),
              status: newStatus,
            },
          });
        }
      }

      return newPayment;
    });

    // Auto-journal: Dr Payable, Cr Bank/Cash (+TDS if any)
    onVendorPaymentMade(prisma, {
      id: payment.id,
      amount,
      mode: b.mode || 'BANK_TRANSFER',
      reference: b.reference,
      tdsDeducted: tdsDeducted,
      tdsLedgerId: b.tdsLedgerId || null,
      tdsSection: b.tdsSection || null,
      vendorId: b.vendorId,
      userId: req.user!.id,
      paymentDate: b.paymentDate ? new Date(b.paymentDate) : new Date(),
      companyId: payment.companyId || undefined,
    }).catch(() => {});

    // Recompute GRN paid state on linked PO (auto-flips DRAFT → PARTIAL when fullyPaid)
    if (b.invoiceId) {
      const inv = await prisma.vendorInvoice.findUnique({ where: { id: b.invoiceId }, select: { poId: true } });
      if (inv?.poId) recomputeGrnPaidStateForPO(inv.poId).catch(() => {});
    }

    res.status(201).json(payment);
}));

// POST /split-payment — Record split payment (cash + bank in parallel)
// Creates VendorPayment for bank splits and CashVoucher for cash splits atomically
router.post('/split-payment', validate(splitPaymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const splits = b.splits as Array<{ mode: string; amount: number; reference?: string; remarks?: string }>;
    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ error: 'splits array is required' });
    }

    const totalAmount = splits.reduce((s, sp) => s + (sp.amount || 0), 0);
    if (totalAmount <= 0) return res.status(400).json({ error: 'Total split amount must be positive' });

    const tdsDeducted = parseFloat(b.tdsDeducted) || 0;
    const vendorId = b.vendorId;
    const invoiceId = b.invoiceId || null;
    const paymentDate = b.paymentDate ? new Date(b.paymentDate) : new Date();
    const userId = req.user!.id;

    // Fetch vendor + PO number for tracking
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true } });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    // Resolve PO number — needed for fuel deal payment tracking
    let poNo = b.poNo;
    if (!poNo && invoiceId) {
      const inv = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId }, select: { po: { select: { poNo: true } } } });
      poNo = inv?.po?.poNo;
    }
    const poRef = poNo ? `Fuel deal PO-${poNo}` : '';

    const results = await prisma.$transaction(async (tx: any) => {
      const created: Array<{ type: string; id: string; mode: string; amount: number }> = [];

      for (const split of splits) {
        const amt = parseFloat(String(split.amount)) || 0;
        if (amt <= 0) continue;

        if (split.mode === 'CASH') {
          // Create CashVoucher for cash portion — include PO ref in both purpose and remarks
          const cv = await tx.cashVoucher.create({
            data: {
              type: 'PAYMENT',
              date: paymentDate,
              payeeName: vendor.name,
              amount: amt,
              purpose: poRef || 'Vendor payment',
              category: 'MATERIAL',
              paymentMode: 'CASH',
              paymentRef: split.reference || '',
              authorizedBy: req.user!.name || req.user!.email,
              status: 'ACTIVE',
              remarks: [poRef, split.remarks || `Split payment to ${vendor.name}`].filter(Boolean).join(' | '),
              userId,
            },
          });
          created.push({ type: 'CashVoucher', id: cv.id, mode: 'CASH', amount: amt });
        } else {
          // Create VendorPayment for bank portion — ALWAYS include PO ref in remarks
          const remarkParts = [poRef, split.remarks || (splits.length > 1 ? `Split (${split.mode})` : '')].filter(Boolean);
          const vp = await tx.vendorPayment.create({
            data: {
              vendorId,
              invoiceId,
              amount: amt,
              mode: split.mode || 'NEFT',
              reference: split.reference || '',
              tdsDeducted: created.length === 0 ? tdsDeducted : 0,
              tdsSection: created.length === 0 ? (b.tdsSection || null) : null,
              isAdvance: !invoiceId,
              remarks: remarkParts.join(' | ') || null,
              paymentDate,
              hasGst: b.hasGst === true,
              userId,
              companyId: getActiveCompanyId(req),
            },
          });
          created.push({ type: 'VendorPayment', id: vp.id, mode: split.mode, amount: amt });
        }
      }

      // Update invoice balance if linked — only the BANK portion counts as paid
      // immediately. CASH portion is held in an ACTIVE voucher and reduces the
      // invoice balance only when the voucher is settled (cashVouchers.ts settle
      // route creates a VendorPayment then).
      if (invoiceId) {
        const bankPaidNow = splits
          .filter(s => s.mode !== 'CASH')
          .reduce((s, sp) => s + (parseFloat(String(sp.amount)) || 0), 0);

        if (bankPaidNow > 0) {
          const invoice = await tx.vendorInvoice.findUnique({ where: { id: invoiceId } });
          if (invoice) {
            const newPaidAmount = (invoice.paidAmount || 0) + bankPaidNow;
            const newBalanceAmount = (invoice.netPayable || 0) - newPaidAmount;
            let newStatus = invoice.status;
            if (newBalanceAmount <= 0) newStatus = 'PAID';
            else if (newPaidAmount > 0) newStatus = 'PARTIAL_PAID';

            await tx.vendorInvoice.update({
              where: { id: invoiceId },
              data: {
                paidAmount: newPaidAmount,
                balanceAmount: Math.max(0, newBalanceAmount),
                status: newStatus,
              },
            });
          }
        }
      }

      return created;
    });

    // Auto-journal for each bank split
    for (const r of results) {
      if (r.type === 'VendorPayment') {
        onVendorPaymentMade(prisma, {
          id: r.id,
          amount: r.amount,
          mode: r.mode,
          reference: '',
          tdsDeducted: results.indexOf(r) === 0 ? tdsDeducted : 0,
          vendorId,
          userId,
          paymentDate,
        }).catch(() => {});
      }
    }

    res.status(201).json({ ok: true, splits: results, totalAmount, invoiceId });
}));

// GET /tds-report — TDS report
router.get('/tds-report', asyncHandler(async (req: AuthRequest, res: Response) => {
    const payments = await prisma.vendorPayment.findMany({
      where: {
        ...getCompanyFilter(req),
        tdsDeducted: {
          gt: 0,
        },
      },
      include: {
        vendor: true,
      },
      orderBy: { paymentDate: 'desc' },
    });

    // Group by section
    const grouped: Record<string, any> = {};
    for (const pmt of payments) {
      const section = pmt.tdsSection || 'OTHER';
      if (!grouped[section]) {
        grouped[section] = {
          section,
          payments: [],
          totalTds: 0,
        };
      }
      grouped[section].payments.push(pmt);
      grouped[section].totalTds += pmt.tdsDeducted || 0;
    }

    res.json({ report: Object.values(grouped) });
}));

// POST /generate-bank-file — Generate UBI APPA format CSV for selected vendor invoices
router.post('/generate-bank-file', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { invoiceIds, paymentType = 'NEFT', debitAccount, payerIfsc, corporateId } = req.body;

    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      res.status(400).json({ error: 'invoiceIds array is required' });
      return;
    }
    if (!debitAccount || !payerIfsc) {
      res.status(400).json({ error: 'debitAccount and payerIfsc are required' });
      return;
    }
    const type = paymentType === 'RTGS' ? 'RTGS' : 'NEFT';
    const corpId = corporateId || 'MKSPIL';

    // Fetch invoices with vendor bank details
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        ...getCompanyFilter(req),
        id: { in: invoiceIds },
        balanceAmount: { gt: 0 },
      },
      include: {
        vendor: true,
      },
    });

    if (invoices.length === 0) {
      res.status(400).json({ error: 'No outstanding invoices found for the given IDs' });
      return;
    }

    // Validate all vendors have bank details
    const missing = invoices.filter(inv => !inv.vendor.bankAccount || !inv.vendor.bankIfsc);
    if (missing.length > 0) {
      const names = missing.map(inv => inv.vendor.name).join(', ');
      res.status(400).json({ error: `Missing bank details for: ${names}. Update vendor bank IFSC and account number first.` });
      return;
    }

    // Generate batch ID
    const now = new Date();
    const batchId = `UBI-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const seqNo = String(now.getTime()).slice(-6);

    // Build CSV rows
    const rows: string[] = [];

    // Row 1: File header
    rows.push(`FILEHDR,${corpId},${seqNo},N,${type} Payment Batch ${batchId}`);

    // Row 2+: Payment records
    let totalAmount = 0;
    const paymentRecords: Array<{ invoiceId: string; vendorId: string; vendorName: string; amount: number }> = [];

    for (const inv of invoices) {
      const amount = inv.balanceAmount || 0;
      if (amount <= 0) continue;

      const benefName = (inv.vendor.name || '').substring(0, 40).replace(/,/g, ' ');
      const email = (inv.vendor.email || 'accounts@mspil.in').substring(0, 80);
      const mobile = (inv.vendor.phone || '').replace(/[^0-9]/g, '').substring(0, 20) || '0000000000';
      const remark = `INV-${inv.vendorInvNo || inv.id.substring(0, 8)} ${benefName}`.substring(0, 140).replace(/,/g, ' ');

      rows.push([
        type,
        payerIfsc,
        debitAccount,
        inv.vendor.bankIfsc,
        inv.vendor.bankAccount,
        'INR',
        amount.toFixed(2),
        remark,
        benefName,
        email,
        mobile,
      ].join(','));

      totalAmount += amount;
      paymentRecords.push({
        invoiceId: inv.id,
        vendorId: inv.vendor.id,
        vendorName: inv.vendor.name,
        amount,
      });
    }

    // Mark invoices as included in bank file batch (don't create payments yet — that happens after bank confirms)
    // We track this via a separate update to avoid double-payment risk
    const csv = rows.join('\r\n') + '\r\n';

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${batchId}.csv"`);
    res.json({
      batchId,
      csv,
      fileName: `${batchId}.csv`,
      paymentType: type,
      totalAmount,
      recordCount: paymentRecords.length,
      records: paymentRecords,
    });
}));

// POST /:id/send-email — Email Payment Advice (HBS template) to the vendor.
// Requires payment to be in CONFIRMED state (UTR has been entered).
router.post('/:id/send-email', asyncHandler(async (req: AuthRequest, res: Response) => {
  const built = await buildPaymentAdviceData(req.params.id);
  if (!built) { res.status(404).json({ error: 'Payment not found' }); return; }
  const { payment, data } = built;

  if (payment.paymentStatus !== 'CONFIRMED') {
    res.status(400).json({ error: 'Payment Advice can only be sent after UTR confirmation.' });
    return;
  }

  const toEmail: string | undefined = (req.body?.to as string | undefined) || (payment.vendor as { email?: string | null }).email || undefined;
  if (!toEmail) {
    res.status(400).json({ error: 'No email on vendor. Add vendor email or pass "to" in request body.' });
    return;
  }

  const pdfBuffer = await renderDocumentPdf({ docType: 'PAYMENT_CONFIRMATION', data, verifyId: payment.id });

  const paymentNoStr = String(payment.paymentNo).padStart(4, '0');
  const fileName = `Payment-Advice-PAY-${paymentNoStr}.pdf`;
  const subject: string = (req.body?.subject as string | undefined) || `Payment Advice — PAY-${paymentNoStr} — MSPIL`;
  const amountStr = (payment.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const dateStr = payment.paymentDate ? new Date(payment.paymentDate).toLocaleDateString('en-IN') : '-';
  const body: string = (req.body?.body as string | undefined) || [
    `Dear ${payment.vendor.name},`,
    '',
    `This is to advise you that the following payment has been released to your account:`,
    '',
    `  Amount       : Rs. ${amountStr}`,
    `  Payment Date : ${dateStr}`,
    `  Mode         : ${payment.mode}`,
    `  UTR / Ref    : ${payment.reference || '-'}`,
    payment.invoice?.vendorInvNo ? `  Invoice Ref  : ${payment.invoice.vendorInvNo}` : '',
    '',
    `Please find the formal payment advice attached as PDF. Kindly acknowledge receipt and reconcile against the referenced invoice.`,
    '',
    `Regards,`,
    `Accounts — Mahakaushal Sugar & Power Industries Ltd`,
  ].filter(Boolean).join('\n');

  // Attach the bank's own confirmation receipt too (if scanned) — gives the vendor a 2-way proof
  const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [
    { filename: fileName, content: pdfBuffer, contentType: 'application/pdf' },
  ];
  if (payment.bankReceiptPath) {
    try {
      const receiptAbs = path.join(__dirname, '../../uploads', payment.bankReceiptPath);
      if (fs.existsSync(receiptAbs)) {
        const receiptBuf = fs.readFileSync(receiptAbs);
        const receiptExt = path.extname(payment.bankReceiptPath).toLowerCase();
        const receiptMime = receiptExt === '.pdf' ? 'application/pdf' : (receiptExt === '.png' ? 'image/png' : 'image/jpeg');
        attachments.push({
          filename: `Bank-Receipt-PAY-${paymentNoStr}${receiptExt}`,
          content: receiptBuf,
          contentType: receiptMime,
        });
      }
    } catch { /* best-effort — receipt missing on disk shouldn't block advice */ }
  }

  const result = await sendEmail({
    to: toEmail, subject, text: body,
    attachments,
  });

  if (result.success) {
    const sentAt = new Date();
    await prisma.vendorPayment.update({
      where: { id: payment.id },
      data: { adviceSentAt: sentAt, adviceSentTo: toEmail },
    });
    res.json({ ok: true, messageId: result.messageId, sentTo: toEmail, sentAt });
  } else {
    res.status(500).json({ error: result.error || 'Email send failed' });
  }
}));

// ═══════════════════════════════════════════════
// POST /:id/scan-bank-receipt — Upload the bank's payment confirmation PDF/JPG,
// run Gemini 2.5 Flash to extract { UTR, amount, beneficiary, bank, timestamp }.
// Auto-fills / cross-checks the payment and persists the extraction for audit.
// ═══════════════════════════════════════════════
router.post('/:id/scan-bank-receipt', bankReceiptUpload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const payment = await prisma.vendorPayment.findUnique({
    where: { id: req.params.id },
    include: { vendor: { select: { name: true, bankName: true, bankAccount: true, bankIfsc: true } } },
  });
  if (!payment) { res.status(404).json({ error: 'Payment not found' }); return; }

  const relPath = `bank-receipts/${req.file.filename}`;
  const mimeType = req.file.mimetype;
  const fileBuffer = fs.readFileSync(req.file.path);
  const base64 = fileBuffer.toString('base64');

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    // Still save the file so team has the receipt, just no extraction
    await prisma.vendorPayment.update({
      where: { id: payment.id },
      data: { bankReceiptPath: relPath, bankReceiptScannedAt: new Date() },
    });
    res.json({ filePath: relPath, extracted: null, warnings: ['AI extraction not configured (GEMINI_API_KEY missing) — receipt saved, extraction skipped'] });
    return;
  }

  const prompt = `You are reading a bank transfer confirmation / receipt. Extract EXACTLY these fields as JSON. If a field is missing, use null.
{
  "utr": "string - UTR / IB Reference No / Transaction Reference (the longest bank-assigned alphanumeric code)",
  "amount": number - transaction amount in rupees,
  "amount_in_words": "string - amount in words if present",
  "transaction_date": "string - ISO date YYYY-MM-DD",
  "transaction_time": "string - HH:MM:SS if present",
  "transaction_type": "string - NEFT / RTGS / IMPS / UPI / CHEQUE",
  "from_account_no": "string - payer's account number",
  "from_account_name": "string - payer's name (should be MSPIL / Mahakaushal)",
  "beneficiary_name": "string - receiver name",
  "beneficiary_account_no": "string - receiver account number",
  "beneficiary_ifsc": "string - receiver IFSC code if present",
  "bank_name": "string - the BANK that issued this receipt (e.g. Bank of Maharashtra, Union Bank of India, HDFC, SBI)",
  "remarks": "string - narration / remarks if present",
  "status": "string - transaction status (Success / Failed / etc.)"
}
Return ONLY the JSON object, no markdown, no prose.`;

  let extracted: Record<string, unknown> | null = null;
  let rawReply = '';
  try {
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType.startsWith('image/') ? mimeType : 'application/pdf', data: base64 } },
          ],
        }],
      },
      { timeout: 45000 }
    );
    rawReply = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonStr = rawReply.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try { extracted = JSON.parse(jsonStr); } catch { extracted = { raw: rawReply }; }
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message || 'Gemini extraction failed';
    await prisma.vendorPayment.update({
      where: { id: payment.id },
      data: { bankReceiptPath: relPath, bankReceiptScannedAt: new Date() },
    });
    res.json({ filePath: relPath, extracted: null, warnings: [`Extraction failed: ${msg} — receipt file saved anyway`] });
    return;
  }

  // Cross-check extracted data against the payment on file
  const warnings: string[] = [];
  const extractedAmount = typeof extracted?.amount === 'number' ? extracted.amount : parseFloat(String(extracted?.amount || '0')) || 0;
  if (extractedAmount > 0 && Math.abs(extractedAmount - payment.amount) > 1) {
    warnings.push(`Amount mismatch: receipt says ₹${extractedAmount.toLocaleString('en-IN')}, payment on file is ₹${payment.amount.toLocaleString('en-IN')}`);
  }
  const extractedBeneficiary = String(extracted?.beneficiary_name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  const vendorNameUpper = String(payment.vendor.name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  if (extractedBeneficiary && vendorNameUpper) {
    // Fuzzy: every word in the shorter name must appear in the longer
    const short = extractedBeneficiary.length < vendorNameUpper.length ? extractedBeneficiary : vendorNameUpper;
    const long = extractedBeneficiary.length < vendorNameUpper.length ? vendorNameUpper : extractedBeneficiary;
    const tokens = short.split(/\s+/).filter(t => t.length >= 3);
    const matched = tokens.filter(t => long.includes(t)).length;
    if (tokens.length > 0 && matched / tokens.length < 0.5) {
      warnings.push(`Beneficiary name mismatch: receipt says "${extracted?.beneficiary_name}", vendor on file is "${payment.vendor.name}"`);
    }
  }
  const extractedAccount = String(extracted?.beneficiary_account_no || '').replace(/\D/g, '');
  const vendorAccount = String(payment.vendor.bankAccount || '').replace(/\D/g, '');
  if (extractedAccount && vendorAccount && extractedAccount !== vendorAccount) {
    warnings.push(`Account number mismatch: receipt says ${extracted?.beneficiary_account_no}, vendor on file is ${payment.vendor.bankAccount}`);
  }

  // Decide what to auto-update on the payment
  const updates: Record<string, unknown> = {
    bankReceiptPath: relPath,
    bankReceiptExtracted: extracted as unknown as object,
    bankReceiptScannedAt: new Date(),
  };
  // Clean UTR — only overwrite the messy ref when cross-checks PASS. If warnings exist
  // the user likely uploaded the wrong receipt; preserve the original reference so we
  // don't destroy correct data. The extracted UTR is still kept in bankReceiptExtracted.
  const extractedUtr = typeof extracted?.utr === 'string' ? extracted.utr.trim() : '';
  const utrIsClean = !!extractedUtr && /^[A-Z]{4}[A-Z0-9]{8,}$/.test(extractedUtr);
  if (utrIsClean && warnings.length === 0) {
    updates.reference = extractedUtr;
  }
  // If payment was in INITIATED state and the cross-check is clean, auto-confirm it
  if (payment.paymentStatus === 'INITIATED' && warnings.length === 0 && utrIsClean) {
    updates.paymentStatus = 'CONFIRMED';
    updates.confirmedAt = new Date();
  }

  const updated = await prisma.vendorPayment.update({
    where: { id: payment.id },
    data: updates,
  });

  res.json({ filePath: relPath, extracted, warnings, payment: updated });
}));

// ═══════════════════════════════════════════════
// POST /allocate — Vendor-level payment allocation.
// Single bank transfer spread across N open POs of the same vendor, with the
// remainder optionally held as a vendor ADVANCE. Creates one VendorPayment
// row per allocation + one more for the advance. All in a single transaction.
// Auto-closes each PO when its receivable is fully covered.
// ═══════════════════════════════════════════════
router.post('/allocate', validate(allocateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as {
    vendorId: string;
    mode: string;
    reference: string;
    remarks?: string | null;
    paymentDate?: string;
    hasGst: boolean;
    allocations: Array<{ poId: string; amount: number }>;
    advanceAmount: number;
    tdsDeducted?: number;
    tdsSection?: string | null;
  };
  if ((b.allocations?.length || 0) === 0 && (b.advanceAmount || 0) === 0) {
    res.status(400).json({ error: 'Provide at least one PO allocation or an advance amount.' });
    return;
  }
  const totalAmount = (b.allocations || []).reduce((s, a) => s + a.amount, 0) + (b.advanceAmount || 0);
  if (totalAmount <= 0) { res.status(400).json({ error: 'Total amount must be positive.' }); return; }

  const vendor = await prisma.vendor.findUnique({ where: { id: b.vendorId }, select: { id: true, name: true } });
  if (!vendor) { res.status(404).json({ error: 'Vendor not found' }); return; }

  const paymentDate = b.paymentDate ? new Date(b.paymentDate) : new Date();
  const companyId = getActiveCompanyId(req);
  const userId = req.user!.id;
  const baseRemarks = (b.remarks || '').trim();

  // Per-allocation PO must belong to the vendor; we fetch them up-front
  const poIds = (b.allocations || []).map(a => a.poId);
  const pos = poIds.length > 0 ? await prisma.purchaseOrder.findMany({
    where: { id: { in: poIds } },
    select: { id: true, poNo: true, vendorId: true, status: true, lines: { select: { receivedQty: true, rate: true, gstPercent: true } } },
  }) : [];
  const poById = new Map(pos.map(p => [p.id, p]));
  for (const a of b.allocations) {
    const po = poById.get(a.poId);
    if (!po) { res.status(400).json({ error: `PO ${a.poId} not found` }); return; }
    if (po.vendorId !== b.vendorId) { res.status(400).json({ error: `PO-${po.poNo} does not belong to the selected vendor` }); return; }
  }

  const created: Array<{ id: string; poNo?: number; amount: number; type: 'PO_PAYMENT' | 'ADVANCE'; paymentStatus: string }> = [];
  const closedPOs: number[] = [];

  await prisma.$transaction(async (tx: any) => {
    // One VendorPayment per PO allocation
    let tdsRemaining = b.tdsDeducted || 0;
    for (const alloc of b.allocations) {
      const po = poById.get(alloc.poId)!;
      // Attach TDS to the first allocation(s) — matches splitPaymentSchema convention
      // (single TDS audit trail per transfer, not split per PO).
      const tdsForThisRow = Math.min(tdsRemaining, alloc.amount);
      tdsRemaining -= tdsForThisRow;
      const payment = await tx.vendorPayment.create({
        data: {
          vendorId: b.vendorId,
          paymentDate,
          amount: alloc.amount,
          mode: b.mode || 'NEFT',
          reference: b.reference || '',
          paymentStatus: b.reference ? 'CONFIRMED' : 'INITIATED',
          confirmedAt: b.reference ? paymentDate : null,
          isAdvance: false,
          hasGst: b.hasGst,
          tdsDeducted: tdsForThisRow,
          tdsSection: tdsForThisRow > 0 ? (b.tdsSection || null) : null,
          remarks: `Payment against PO-${po.poNo}${baseRemarks ? ' | ' + baseRemarks : ''}`,
          userId,
          companyId,
        },
      });
      created.push({ id: payment.id, poNo: po.poNo, amount: alloc.amount, type: 'PO_PAYMENT', paymentStatus: payment.paymentStatus });

      // Auto-close PO when all received material is now covered (only confirmed payments count)
      if (payment.paymentStatus === 'CONFIRMED' && po.status !== 'CLOSED') {
        const receivable = Math.round(po.lines.reduce((s, l) => {
          const base = (l.receivedQty || 0) * l.rate;
          return s + base + base * (l.gstPercent || 0) / 100;
        }, 0) * 100) / 100;
        const allPaid = await tx.vendorPayment.aggregate({
          where: {
            vendorId: b.vendorId,
            paymentStatus: 'CONFIRMED',
            invoiceId: null,
            OR: [
              { remarks: { contains: `PO-${po.poNo} ` } },
              { remarks: { endsWith: `PO-${po.poNo}` } },
            ],
          },
          _sum: { amount: true },
        });
        const totalPaidForPo = allPaid._sum.amount || 0;
        if (totalPaidForPo >= receivable - 0.01) {
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CLOSED' } });
          closedPOs.push(po.poNo);
        }
      }
    }

    // Optional advance — one more VendorPayment, isAdvance=true, no PO ref in remarks.
    // Absorb any residual TDS here if allocations couldn't.
    if (b.advanceAmount > 0) {
      const tdsForAdvance = Math.min(tdsRemaining, b.advanceAmount);
      tdsRemaining -= tdsForAdvance;
      const advPayment = await tx.vendorPayment.create({
        data: {
          vendorId: b.vendorId,
          paymentDate,
          amount: b.advanceAmount,
          mode: b.mode || 'NEFT',
          reference: b.reference || '',
          paymentStatus: b.reference ? 'CONFIRMED' : 'INITIATED',
          confirmedAt: b.reference ? paymentDate : null,
          isAdvance: true,
          hasGst: b.hasGst,
          tdsDeducted: tdsForAdvance,
          tdsSection: tdsForAdvance > 0 ? (b.tdsSection || null) : null,
          remarks: `Vendor advance${baseRemarks ? ' | ' + baseRemarks : ''}`,
          userId,
          companyId,
        },
      });
      created.push({ id: advPayment.id, amount: b.advanceAmount, type: 'ADVANCE', paymentStatus: advPayment.paymentStatus });
    }
  });

  // Fire auto-journal entries for confirmed payments (best-effort, outside txn).
  // TDS tracked on the VendorPayment rows themselves — re-read to pass the right per-row tdsDeducted
  // so autoJournal can post: Dr Vendor ₹amount / Cr Bank ₹(amount−tds) / Cr TDS Payable ₹tds.
  for (const c of created) {
    if (c.paymentStatus !== 'CONFIRMED') continue;
    try {
      const row = await prisma.vendorPayment.findUnique({
        where: { id: c.id },
        select: { tdsDeducted: true, tdsSection: true },
      });
      await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
        id: c.id, amount: c.amount, mode: b.mode, reference: b.reference,
        tdsDeducted: row?.tdsDeducted || 0,
        tdsSection: row?.tdsSection || null,
        vendorId: b.vendorId, userId, paymentDate,
      });
    } catch { /* best effort */ }
  }

  res.json({
    ok: true,
    totalAmount,
    vendorName: vendor.name,
    payments: created,
    closedPOs,
    status: b.reference ? 'CONFIRMED' : 'INITIATED',
  });
}));

export default router;
