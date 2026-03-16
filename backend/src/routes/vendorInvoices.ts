import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// GET / — list with filters (vendorId, status)
router.get('/', async (req: Request, res: Response) => {
  try {
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;

    const invoices = await prisma.vendorInvoice.findMany({
      where,
      include: {
        vendor: true,
        po: true,
        grn: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });

    res.json({ invoices });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /outstanding — outstanding vendor invoices grouped by vendor
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

// GET /itc-report — ITC report
router.get('/itc-report', async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        status: { in: ['VERIFIED', 'APPROVED', 'PAID'] },
      },
      include: {
        vendor: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });

    const report = invoices.map((inv: any) => ({
      ...inv,
      calcCgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 2 / 100),
      calcSgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 2 / 100),
      calcIgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 100),
      itcEligible: inv.isRCM === false,
    }));

    res.json({ report });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single with vendor, po, grn, payments
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        po: true,
        grn: true,
        payments: true,
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create vendor invoice
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;

    const quantity = parseFloat(b.quantity) || 0;
    const rate = parseFloat(b.rate) || 0;
    const gstPercent = parseFloat(b.gstPercent) || 0;
    const freightCharge = parseFloat(b.freightCharge) || 0;
    const loadingCharge = parseFloat(b.loadingCharge) || 0;
    const otherCharges = parseFloat(b.otherCharges) || 0;
    const roundOff = parseFloat(b.roundOff) || 0;
    const tdsPercent = parseFloat(b.tdsPercent) || 0;

    const subtotal = quantity * rate;

    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (b.supplyType === 'INTRA_STATE') {
      cgstAmount = subtotal * ((gstPercent / 2) / 100);
      sgstAmount = subtotal * ((gstPercent / 2) / 100);
    } else if (b.supplyType === 'INTER_STATE') {
      igstAmount = subtotal * (gstPercent / 100);
    }

    const totalGst = cgstAmount + sgstAmount + igstAmount;
    let rcmCgst = 0, rcmSgst = 0, rcmIgst = 0;

    if (b.isRCM) {
      rcmCgst = cgstAmount;
      rcmSgst = sgstAmount;
      rcmIgst = igstAmount;
    }

    const totalAmount = subtotal + totalGst + freightCharge + loadingCharge + otherCharges + roundOff;
    const tdsAmount = subtotal * (tdsPercent / 100);
    const netPayable = totalAmount - tdsAmount;
    const balanceAmount = netPayable;

    // 3-way match
    let matchStatus = 'UNMATCHED';
    if (b.poId && b.grnId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: b.poId },
        include: { lines: true },
      });
      const grn = await prisma.goodsReceipt.findUnique({
        where: { id: b.grnId },
        include: { lines: true },
      });

      if (po && grn) {
        const poQty = po.lines.reduce((sum, line) => sum + line.quantity, 0);
        const grnQty = grn.lines.reduce((sum, line) => sum + line.acceptedQty, 0);

        if (Math.abs(poQty - quantity) < 0.01 && Math.abs(grnQty - quantity) < 0.01) {
          matchStatus = 'MATCHED';
        } else {
          matchStatus = 'MISMATCH';
        }
      }
    }

    const invoice = await prisma.vendorInvoice.create({
      data: {
        vendorId: b.vendorId,
        poId: b.poId || null,
        grnId: b.grnId || null,
        vendorInvNo: b.vendorInvNo || '',
        vendorInvDate: b.vendorInvDate ? new Date(b.vendorInvDate) : new Date(),
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : new Date(),
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
        productName: b.productName || '',
        quantity,
        unit: b.unit || 'kg',
        rate,
        supplyType: b.supplyType || 'INTRA_STATE',
        gstPercent,
        isRCM: b.isRCM || false,
        cgstAmount,
        sgstAmount,
        igstAmount,
        totalGst,
        rcmCgst,
        rcmSgst,
        rcmIgst,
        itcEligible: b.isRCM === false,
        subtotal,
        freightCharge,
        loadingCharge,
        otherCharges,
        roundOff,
        totalAmount,
        tdsSection: b.tdsSection || null,
        tdsPercent,
        tdsAmount,
        netPayable,
        paidAmount: 0,
        balanceAmount,
        matchStatus,
        status: 'PENDING',
        remarks: b.remarks || null,
        userId: (req as any).user.id,
      },
    });

    res.status(201).json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/status — status transitions
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { newStatus } = req.body;
    const invoice = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const validTransitions: Record<string, string[]> = {
      'PENDING': ['VERIFIED', 'CANCELLED'],
      'VERIFIED': ['APPROVED', 'CANCELLED'],
      'APPROVED': ['PAID', 'CANCELLED'],
      'PAID': [],
      'CANCELLED': [],
    };

    if (!validTransitions[invoice.status] || !validTransitions[invoice.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${invoice.status} to ${newStatus}` });
    }

    const updated = await prisma.vendorInvoice.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });

    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/itc — update ITC status
router.put('/:id/itc', async (req: Request, res: Response) => {
  try {
    const { itcClaimed, itcClaimedDate, itcReversed, itcReversalReason } = req.body;
    const invoice = await prisma.vendorInvoice.update({
      where: { id: req.params.id },
      data: {
        itcClaimed,
        itcClaimedDate: itcClaimedDate ? new Date(itcClaimedDate) : undefined,
        itcReversed,
        itcReversalReason,
      },
    });
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
