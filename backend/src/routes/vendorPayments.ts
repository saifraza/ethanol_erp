import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { onVendorPaymentMade } from '../services/autoJournal';
import PDFDocument from 'pdfkit';
import { sendEmail } from '../services/messaging';

const router = Router();
router.use(authenticate as any);

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

    // Get invoices and payments
    const invoices = await prisma.vendorInvoice.findMany({
      where: { vendorId },
      orderBy: { invoiceDate: 'asc' },
    });

    const payments = await prisma.vendorPayment.findMany({
      where: { vendorId },
      orderBy: { paymentDate: 'asc' },
    });

    // Combine and sort by date
    const ledgerItems: any[] = [];
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
      vendorId: b.vendorId,
      userId: req.user!.id,
      paymentDate: b.paymentDate ? new Date(b.paymentDate) : new Date(),
    }).catch(() => {});

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

    // Fetch vendor name for cash voucher
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true } });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const results = await prisma.$transaction(async (tx: any) => {
      const created: Array<{ type: string; id: string; mode: string; amount: number }> = [];

      for (const split of splits) {
        const amt = parseFloat(String(split.amount)) || 0;
        if (amt <= 0) continue;

        if (split.mode === 'CASH') {
          // Create CashVoucher for cash portion
          const cv = await tx.cashVoucher.create({
            data: {
              type: 'PAYMENT',
              date: paymentDate,
              payeeName: vendor.name,
              amount: amt,
              purpose: b.poNo ? `Vendor payment — PO-${b.poNo}` : 'Vendor payment',
              category: 'MATERIAL',
              paymentMode: 'CASH',
              paymentRef: split.reference || '',
              authorizedBy: req.user!.name || req.user!.email,
              status: 'ACTIVE',
              remarks: split.remarks || `Split payment to ${vendor.name}`,
              userId,
            },
          });
          created.push({ type: 'CashVoucher', id: cv.id, mode: 'CASH', amount: amt });
        } else {
          // Create VendorPayment for bank portion
          const vp = await tx.vendorPayment.create({
            data: {
              vendorId,
              invoiceId,
              amount: amt,
              mode: split.mode || 'NEFT',
              reference: split.reference || '',
              tdsDeducted: created.length === 0 ? tdsDeducted : 0, // TDS only on first split
              tdsSection: created.length === 0 ? (b.tdsSection || null) : null,
              isAdvance: !invoiceId,
              remarks: split.remarks || (splits.length > 1 ? `Split payment (${split.mode})` : null),
              paymentDate,
              userId,
            },
          });
          created.push({ type: 'VendorPayment', id: vp.id, mode: split.mode, amount: amt });
        }
      }

      // Update invoice balance if linked
      if (invoiceId) {
        const invoice = await tx.vendorInvoice.findUnique({ where: { id: invoiceId } });
        if (invoice) {
          const newPaidAmount = (invoice.paidAmount || 0) + totalAmount;
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
