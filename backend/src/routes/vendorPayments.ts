import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { onVendorPaymentMade } from '../services/autoJournal';
import { recomputeGrnPaidStateForPO } from '../services/grnPaidState';
import { renderDocumentPdf } from '../services/documentRenderer';
import PDFDocument from 'pdfkit';
import { sendEmail } from '../services/messaging';

const router = Router();
router.use(authenticate as any);

// ═══════════════════════════════════════════════
// GET /:id/pdf — Payment confirmation PDF (single payment or full split view)
// ═══════════════════════════════════════════════
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const payment = await prisma.vendorPayment.findUnique({
    where: { id: req.params.id },
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
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  // Find ALL payments for the same invoice (to show full split picture)
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

  // Find CashVouchers linked to same vendor + PO (via remarks)
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

  // GRN details
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

  const data = {
    paymentNo: payment.paymentNo,
    paymentDate: payment.paymentDate,
    poNo,
    invoiceRef: payment.invoice?.vendorInvNo || '',
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

  const pdf = await renderDocumentPdf({ docType: 'PAYMENT_CONFIRMATION', data, verifyId: payment.id });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Payment-${payment.paymentNo}.pdf"`);
  res.send(pdf);
}));

// GET / — list payments with filters (vendorId, from, to)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vendorId = req.query.vendorId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where: any = {};
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
      prisma.vendorInvoice.findMany({ where: { vendorId }, orderBy: { invoiceDate: 'asc' } }),
      prisma.vendorPayment.findMany({ where: { vendorId }, orderBy: { paymentDate: 'asc' } }),
      prisma.purchaseOrder.findMany({ where: { vendorId }, orderBy: { poDate: 'asc' } }),
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
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const amount = parseFloat(b.amount) || 0;
    const tdsDeducted = parseFloat(b.tdsDeducted) || 0;

    // Wrap in transaction to ensure atomicity
    const payment = await prisma.$transaction(async (tx: any) => {
      const newPayment = await tx.vendorPayment.create({
        data: {
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
          userId: req.user!.id,
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
router.post('/split-payment', asyncHandler(async (req: AuthRequest, res: Response) => {
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
              userId,
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

// POST /:id/send-email — Send payment receipt/advice to vendor
router.post('/:id/send-email', asyncHandler(async (req: AuthRequest, res: Response) => {
    const pmt = await prisma.vendorPayment.findUnique({
      where: { id: req.params.id },
      include: { vendor: true },
    });
    if (!pmt) { res.status(404).json({ error: 'Payment not found' }); return; }

    const toEmail = req.body.to || (pmt as any).vendor?.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add vendor email or provide "to" in request.' }); return; }

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(14).font('Helvetica-Bold').text('PAYMENT ADVICE', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).font('Helvetica-Bold').text('MSPIL — Mahakaushal Sugar & Power Industries Ltd');
      doc.fontSize(8).font('Helvetica').text('Village Bachai, Dist. Narsinghpur, M.P.');
      doc.moveDown();

      doc.fontSize(9).font('Helvetica');
      doc.text(`Payment Date: ${pmt.paymentDate ? new Date(pmt.paymentDate).toLocaleDateString('en-IN') : '-'}`);
      doc.text(`Vendor: ${(pmt as any).vendor?.name || '-'}`);
      doc.text(`Mode: ${pmt.mode || '-'}`);
      doc.text(`Reference: ${pmt.reference || '-'}`);
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(`Amount Paid: Rs. ${(pmt.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
      if (pmt.tdsDeducted) {
        doc.fontSize(9).font('Helvetica');
        doc.text(`TDS Deducted: Rs. ${pmt.tdsDeducted.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
      }
      if (pmt.remarks) {
        doc.moveDown();
        doc.text(`Remarks: ${pmt.remarks}`);
      }
      doc.end();
    });

    const label = `Payment-${pmt.reference || String(pmt.paymentNo).padStart(4, '0')}`;
    const subject = req.body.subject || `${label} — Payment Advice from MSPIL`;
    const body = req.body.body || `Dear ${(pmt as any).vendor?.name || 'Vendor'},\n\nPlease find attached payment advice for Rs. ${(pmt.amount || 0).toLocaleString('en-IN')} dated ${pmt.paymentDate ? new Date(pmt.paymentDate).toLocaleDateString('en-IN') : '-'}.\n\nRegards,\nMSPIL Distillery`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${label}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
}));

export default router;
