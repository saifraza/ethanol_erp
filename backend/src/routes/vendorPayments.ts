import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// GET / — list payments with filters (vendorId, from, to)
router.get('/', async (req: Request, res: Response) => {
  try {
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
    });

    res.json({ payments });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /ledger/:vendorId — vendor ledger (timeline with running balance)
router.get('/ledger/:vendorId', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /outstanding — outstanding payables grouped by vendor
router.get('/outstanding', async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        balanceAmount: {
          gt: 0,
        },
      },
      include: {
        vendor: true,
      },
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create payment
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const amount = parseFloat(b.amount) || 0;
    const tdsDeducted = parseFloat(b.tdsDeducted) || 0;

    const payment = await prisma.vendorPayment.create({
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
        paymentDate: new Date(),
        userId: (req as any).user.id,
      },
    });

    // Update invoice if linked
    if (b.invoiceId) {
      const invoice = await prisma.vendorInvoice.findUnique({
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

        await prisma.vendorInvoice.update({
          where: { id: b.invoiceId },
          data: {
            paidAmount: newPaidAmount,
            balanceAmount: Math.max(0, newBalanceAmount),
            status: newStatus,
          },
        });
      }
    }

    res.status(201).json(payment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /tds-report — TDS report
router.get('/tds-report', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
