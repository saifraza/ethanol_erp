import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import { invoiceDisplayNo } from '../utils/invoiceDisplay';

// Bill-to / Ship-to override fields — null = use Customer master / contract default.
// Each Addr field is gated to ≤ 200 chars; the NIC IRN serializer splits to 100/100 (Addr1/Addr2).
const partySchema = {
  Name: z.string().trim().max(120).optional().nullable(),
  Gstin: z.string().trim().max(15).optional().nullable(),
  Address: z.string().trim().max(200).optional().nullable(),
  State: z.string().trim().max(60).optional().nullable(),
  Pincode: z.string().trim().max(10).optional().nullable(),
};

const createInvoiceSchema = z.object({
  customerId: z.string().min(1),
  orderId: z.string().optional().nullable(),
  shipmentId: z.string().optional().nullable(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  productName: z.string().optional().default(''),
  quantity: z.coerce.number().nonnegative().default(0),
  unit: z.string().optional().default('KL'),
  rate: z.coerce.number().nonnegative().default(0),
  gstPercent: z.coerce.number().nonnegative().default(0),
  freightCharge: z.coerce.number().nonnegative().default(0),
  challanNo: z.string().optional().nullable(),
  ewayBill: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  buyerPoNo: z.string().trim().max(60).optional().nullable(),
  billToName:    partySchema.Name,
  billToGstin:   partySchema.Gstin,
  billToAddress: partySchema.Address,
  billToState:   partySchema.State,
  billToPincode: partySchema.Pincode,
  shipToName:    partySchema.Name,
  shipToGstin:   partySchema.Gstin,
  shipToAddress: partySchema.Address,
  shipToState:   partySchema.State,
  shipToPincode: partySchema.Pincode,
});

const updateInvoiceSchema = z.object({
  quantity: z.coerce.number().nonnegative().optional(),
  rate: z.coerce.number().nonnegative().optional(),
  gstPercent: z.coerce.number().nonnegative().optional(),
  freightCharge: z.coerce.number().nonnegative().optional(),
  productName: z.string().optional(),
  unit: z.string().optional(),
  remarks: z.string().optional().nullable(),
  challanNo: z.string().optional().nullable(),
  ewayBill: z.string().optional().nullable(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  buyerPoNo: z.string().trim().max(60).optional().nullable(),
  billToName:    partySchema.Name,
  billToGstin:   partySchema.Gstin,
  billToAddress: partySchema.Address,
  billToState:   partySchema.State,
  billToPincode: partySchema.Pincode,
  shipToName:    partySchema.Name,
  shipToGstin:   partySchema.Gstin,
  shipToAddress: partySchema.Address,
  shipToState:   partySchema.State,
  shipToPincode: partySchema.Pincode,
});

const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(3, 'A cancellation reason is required'),
});
import { renderDocumentPdf } from '../services/documentRenderer';
import { nextDocNo } from '../utils/docSequence';
import { getCompanyForPdf } from '../utils/pdfCompanyHelper';
// RAG indexing removed — only compliance docs go to RAG
import { sendEmail } from '../services/messaging';
import { generateIRN, cancelIRN, getIRNDetails } from '../services/eInvoice';
import { freezeInvoice, auditAllSnapshots, backfillSnapshots, renderInvoicePdfBuffer } from '../services/invoiceSnapshot';
import { resolveBuyerPo } from '../utils/buyerPo';
import { onSaleInvoiceCreated, reverseAutoJournal } from '../services/autoJournal';
import { calcGstSplit } from '../utils/gstSplit';

const router = Router();

// Key-authed audit endpoint — verifies SHA of every snapshot on disk vs DB.
// Returns { totalChecked, ok, issues[], checkedAt }. Meant to be called by a daily cron.
router.get('/admin/snapshot-audit-key', asyncHandler(async (req, res) => {
    const backfillKey = req.headers['x-backfill-key'];
    const expectedKey = process.env.DATABASE_URL
      ? process.env.DATABASE_URL.split('://')[1]?.split(':')[1]?.split('@')[0]
      : null;
    if (!expectedKey || backfillKey !== expectedKey) {
      return res.status(403).json({ error: 'Invalid audit key' });
    }
    const limit = Math.min(parseInt(String(req.query.limit || '500')) || 500, 2000);
    const result = await auditAllSnapshots(limit);
    // Always 200; caller inspects `issues.length` to decide alarm.
    res.json(result);
}));

// Key-authed backfill endpoint — mounted BEFORE authenticate so it can be called
// without a JWT using X-Backfill-Key header (value = first part of DATABASE_URL password).
// One-shot ops tool. Idempotent. Reads/writes only snapshot fields.
router.post('/admin/backfill-snapshots-key', asyncHandler(async (req, res) => {
    const backfillKey = req.headers['x-backfill-key'];
    const expectedKey = process.env.DATABASE_URL
      ? process.env.DATABASE_URL.split('://')[1]?.split(':')[1]?.split('@')[0]
      : null;
    if (!expectedKey || backfillKey !== expectedKey) {
      return res.status(403).json({ error: 'Invalid backfill key' });
    }

    // force=true re-freezes invoices that already have a snapshot (e.g. after a
    // presentation-layer template fix); invoiceNos=382,384 scopes to specific invoices.
    const force = String(req.query.force || '') === 'true';
    const invoiceNos = String(req.query.invoiceNos || '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
    const limit = parseInt(String(req.query.limit || '50')) || 50;

    const results = await backfillSnapshots({ force, invoiceNos, limit });
    res.json(results);
}));

router.use(authenticate);

// GET / — List invoices with filters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const customerId = req.query.customerId as string;
    const status = req.query.status as string;
    const from = req.query.from as string;
    const to = req.query.to as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    let where: any = { ...getCompanyFilter(req) };

    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    if (from || to) {
      where.invoiceDate = {};
      if (from) where.invoiceDate.gte = new Date(from + 'T00:00:00.000Z');
      if (to) where.invoiceDate.lte = new Date(to + 'T23:59:59.999Z');
    }

    const skip = (page - 1) * limit;

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, shortName: true },
        },
        // Cap payments payload — list view only needs latest 5 per invoice for
        // "received so far" display. Detail endpoint (/:id) still returns all.
        payments: {
          select: { id: true, amount: true, paymentDate: true, mode: true, reference: true },
          orderBy: { paymentDate: 'desc' },
          take: 5,
        },
      },
      orderBy: { invoiceDate: 'desc' },
      skip,
      take: limit,
    });

    const total = await prisma.invoice.count({ where });

    res.json({ invoices, total, page, limit });
}));

// GET /outstanding — Outstanding invoices summary
router.get('/outstanding', asyncHandler(async (req: AuthRequest, res: Response) => {
    // Cap limit to prevent unbounded queries
    const limit = Math.min(parseInt((req.query.limit as string) || '200'), 1000);
    const outstanding = await prisma.invoice.findMany({
      where: {
        ...getCompanyFilter(req),
        status: { in: ['UNPAID', 'PARTIAL'] },
      },
      include: {
        customer: {
          select: { id: true, name: true },
        },
      },
      take: limit,
    });

    // Group by customerId
    const grouped: { [key: string]: any } = {};

    outstanding.forEach((inv: any) => {
      const custId = inv.customerId;
      if (!grouped[custId]) {
        grouped[custId] = {
          customerId: custId,
          customerName: inv.customer.name,
          totalOutstanding: 0,
          invoiceCount: 0,
        };
      }
      grouped[custId].totalOutstanding += inv.balanceAmount;
      grouped[custId].invoiceCount += 1;
    });

    res.json(Object.values(grouped));
}));

// GET /:id — Single invoice with customer, order, payments
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        order: true,
        payments: true,
      },
    });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json(invoice);
}));

// POST / — Create invoice
router.post('/', validate(createInvoiceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const quantity = parseFloat(b.quantity) || 0;
    const rate = parseFloat(b.rate) || 0;
    const gstPercent = parseFloat(b.gstPercent) || 0;
    const freightCharge = parseFloat(b.freightCharge) || 0;

    const amount = quantity * rate;
    const cust = await prisma.customer.findUnique({ where: { id: b.customerId }, select: { state: true, gstNo: true } });
    const gst = calcGstSplit(amount, gstPercent, cust?.state, cust?.gstNo);
    const totalAmount = amount + gst.gstAmount + freightCharge;

    const companyId = getActiveCompanyId(req);
    const invoiceNo = await nextDocNo('Invoice', 'invoiceNo', companyId);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNo,
        customerId: b.customerId, orderId: b.orderId || null, shipmentId: b.shipmentId || null,
        companyId,
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : new Date(),
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
        productName: b.productName || '', quantity, unit: b.unit || 'KL', rate, gstPercent, amount,
        gstAmount: gst.gstAmount, supplyType: gst.supplyType, placeOfSupply: cust?.state || null,
        cgstPercent: gst.cgstPercent, cgstAmount: gst.cgstAmount,
        sgstPercent: gst.sgstPercent, sgstAmount: gst.sgstAmount,
        igstPercent: gst.igstPercent, igstAmount: gst.igstAmount,
        freightCharge, totalAmount, paidAmount: 0, balanceAmount: totalAmount, status: 'UNPAID',
        challanNo: b.challanNo || null, ewayBill: b.ewayBill || null, remarks: b.remarks || null,
        buyerPoNo: b.buyerPoNo?.trim() || null,
        // Bill-To / Ship-To overrides (null = use Customer master defaults)
        billToName:    b.billToName?.trim()    || null,
        billToGstin:   b.billToGstin?.trim()   || null,
        billToAddress: b.billToAddress?.trim() || null,
        billToState:   b.billToState?.trim()   || null,
        billToPincode: b.billToPincode?.trim() || null,
        shipToName:    b.shipToName?.trim()    || null,
        shipToGstin:   b.shipToGstin?.trim()   || null,
        shipToAddress: b.shipToAddress?.trim() || null,
        shipToState:   b.shipToState?.trim()   || null,
        shipToPincode: b.shipToPincode?.trim() || null,
        userId: req.user!.id,
      },
      include: { customer: { select: { id: true, name: true, shortName: true, state: true } }, payments: true },
    });

    onSaleInvoiceCreated(prisma, {
      id: invoice.id, invoiceNo: invoice.invoiceNo, remarks: invoice.remarks, totalAmount: invoice.totalAmount,
      amount: invoice.amount, gstAmount: invoice.gstAmount, gstPercent: invoice.gstPercent,
      cgstAmount: invoice.cgstAmount, sgstAmount: invoice.sgstAmount,
      igstAmount: invoice.igstAmount, supplyType: invoice.supplyType,
      freightCharge: invoice.freightCharge,
      tcsAmount: invoice.tcsAmount, tcsPercent: invoice.tcsPercent, tcsSection: invoice.tcsSection,
      productName: invoice.productName, customerId: b.customerId,
      userId: req.user!.id, invoiceDate: invoice.invoiceDate,
      companyId: invoice.companyId || undefined,
    }).catch(() => {});

    res.status(201).json(invoice);
}));

// POST /from-shipment/:shipmentId — Auto-create invoice from a completed shipment
router.post('/from-shipment/:shipmentId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const shipmentId = req.params.shipmentId;

    // Read the shipment
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        dispatchRequest: {
          include: {
            order: {
              include: {
                lines: true,
              },
            },
          },
        },
      },
    });

    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (!shipment.dispatchRequest) { res.status(400).json({ error: 'Shipment has no dispatch request' }); return; }

    const order = shipment.dispatchRequest.order;
    const orderLine = order?.lines?.[0];

    if (!order || !orderLine) { res.status(400).json({ error: 'Order or order line not found' }); return; }

    // Calculate quantity from shipment (weightNet / 1000 for TON, or quantityKL for KL)
    let quantity = 0;
    if (shipment.quantityKL) {
      quantity = shipment.quantityKL;
    } else if (shipment.weightNet) {
      quantity = shipment.weightNet / 1000; // Convert to TON
    }

    const rate = orderLine.rate || 0;
    const gstPercent = orderLine.gstPercent || 0;
    const freightCharge = 0;

    const amount = quantity * rate;
    const cust2 = await prisma.customer.findUnique({ where: { id: order.customerId }, select: { state: true, gstNo: true } });
    const gst2 = calcGstSplit(amount, gstPercent, cust2?.state, cust2?.gstNo);
    const totalAmount = amount + gst2.gstAmount + freightCharge;

    const companyId2 = getActiveCompanyId(req);
    const invoiceNo2 = await nextDocNo('Invoice', 'invoiceNo', companyId2);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNo: invoiceNo2,
        customerId: order.customerId, orderId: order.id, shipmentId: shipment.id,
        companyId: companyId2,
        invoiceDate: new Date(), dueDate: null,
        productName: shipment.productName || orderLine.productName || '',
        quantity, unit: orderLine.unit || 'KL', rate, gstPercent, amount,
        gstAmount: gst2.gstAmount, supplyType: gst2.supplyType, placeOfSupply: cust2?.state || null,
        cgstPercent: gst2.cgstPercent, cgstAmount: gst2.cgstAmount,
        sgstPercent: gst2.sgstPercent, sgstAmount: gst2.sgstAmount,
        igstPercent: gst2.igstPercent, igstAmount: gst2.igstAmount,
        freightCharge, totalAmount, paidAmount: 0, balanceAmount: totalAmount, status: 'UNPAID',
        challanNo: shipment.challanNo || null, ewayBill: shipment.ewayBill || null, remarks: null,
        userId: req.user!.id,
      },
      include: { customer: { select: { id: true, name: true, shortName: true, state: true } }, payments: true },
    });

    await prisma.shipment.update({ where: { id: shipmentId }, data: { invoiceRef: String(invoice.invoiceNo) } });

    onSaleInvoiceCreated(prisma, {
      id: invoice.id, invoiceNo: invoice.invoiceNo, remarks: invoice.remarks, totalAmount: invoice.totalAmount,
      amount: invoice.amount, gstAmount: invoice.gstAmount, gstPercent: invoice.gstPercent,
      cgstAmount: invoice.cgstAmount, sgstAmount: invoice.sgstAmount,
      igstAmount: invoice.igstAmount, supplyType: invoice.supplyType,
      tcsAmount: invoice.tcsAmount, tcsPercent: invoice.tcsPercent, tcsSection: invoice.tcsSection,
      productName: invoice.productName, customerId: order.customerId,
      userId: req.user!.id, invoiceDate: invoice.invoiceDate,
      companyId: invoice.companyId || undefined,
    }).catch(() => {});

    res.status(201).json(invoice);
}));

// PUT /:id — Update invoice (only if UNPAID)
router.put('/:id', validate(updateInvoiceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;

    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
    if (invoice.status !== 'UNPAID') { res.status(400).json({ error: 'Can only update UNPAID invoices' }); return; }

    const updateData: any = {};

    // Parse numeric fields
    if (b.quantity !== undefined) updateData.quantity = parseFloat(b.quantity);
    if (b.rate !== undefined) updateData.rate = parseFloat(b.rate);
    if (b.gstPercent !== undefined) updateData.gstPercent = parseFloat(b.gstPercent);
    if (b.freightCharge !== undefined) updateData.freightCharge = parseFloat(b.freightCharge);

    // Recalculate amounts with GST split if needed
    if (b.quantity !== undefined || b.rate !== undefined || b.gstPercent !== undefined || b.freightCharge !== undefined) {
      const quantity = parseFloat(b.quantity) || invoice.quantity;
      const rate = parseFloat(b.rate) || invoice.rate;
      const gstPercent = parseFloat(b.gstPercent) || invoice.gstPercent;
      const freightCharge = parseFloat(b.freightCharge) || invoice.freightCharge;

      const amount = quantity * rate;
      const cust = await prisma.customer.findUnique({ where: { id: invoice.customerId }, select: { state: true } });
      const gst = calcGstSplit(amount, gstPercent, cust?.state);
      const totalAmount = amount + gst.gstAmount + freightCharge;

      updateData.amount = amount;
      updateData.gstAmount = gst.gstAmount;
      updateData.supplyType = gst.supplyType;
      updateData.placeOfSupply = cust?.state || null;
      updateData.cgstPercent = gst.cgstPercent;
      updateData.cgstAmount = gst.cgstAmount;
      updateData.sgstPercent = gst.sgstPercent;
      updateData.sgstAmount = gst.sgstAmount;
      updateData.igstPercent = gst.igstPercent;
      updateData.igstAmount = gst.igstAmount;
      updateData.totalAmount = totalAmount;
      updateData.balanceAmount = totalAmount - invoice.paidAmount;
    }

    // Copy string fields
    ['productName', 'unit', 'remarks', 'challanNo', 'ewayBill'].forEach(field => {
      if (b[field] !== undefined) updateData[field] = b[field];
    });

    // Bill-To / Ship-To overrides — null/empty string clears the override and falls
    // back to Customer master / contract default. Only applied pre-IRN.
    if (invoice.irn) {
      // Once IRN is generated, address overrides are frozen with the e-invoice.
      // Block silently rather than partially update — operator must cancel IRN first.
    } else {
      ['buyerPoNo',
       'billToName','billToGstin','billToAddress','billToState','billToPincode',
       'shipToName','shipToGstin','shipToAddress','shipToState','shipToPincode'].forEach(field => {
        if (b[field] !== undefined) {
          const v = (b[field] || '').toString().trim();
          updateData[field] = v.length > 0 ? v : null;
        }
      });
    }

    if (b.invoiceDate !== undefined) updateData.invoiceDate = new Date(b.invoiceDate);
    if (b.dueDate !== undefined) updateData.dueDate = b.dueDate ? new Date(b.dueDate) : null;

    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        customer: {
          select: { id: true, name: true, shortName: true },
        },
        payments: true,
      },
    });
    res.json(updated);
}));

// GET /:id/pdf — Serve Invoice PDF
// Phase 2 (immutable snapshot):
//   1. If snapshot exists + SHA matches → serve file from disk (fast, tamper-proof)
//   2. If snapshot exists + SHA mismatch → log CRITICAL, fall back to live render
//   3. If no snapshot → live render + background self-heal if IRN'd
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    // Fast path: serve frozen snapshot if available
    const snapInfo = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { invoiceNo: true, snapshotPdfPath: true, snapshotPdfSha: true, snapshotAt: true, remarks: true } as any,
    });

    const snap = snapInfo as any;
    if (snap?.snapshotPdfPath && snap?.snapshotPdfSha) {
      try {
        const { promises: fsp } = await import('fs');
        const pathMod = await import('path');
        const { createHash } = await import('crypto');
        // Match resolution order used by invoiceSnapshot service
        const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR
          || (process.env.RAILWAY_VOLUME_MOUNT_PATH
                ? pathMod.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'invoice-snapshots')
                : pathMod.resolve(__dirname, '..', '..', 'public', 'snapshots'));
        const absPath = pathMod.join(SNAPSHOT_DIR, snap.snapshotPdfPath);
        const buf = await fsp.readFile(absPath);
        const sha = createHash('sha256').update(buf).digest('hex');
        if (sha === snap.snapshotPdfSha) {
          const invLabel = snap.remarks || `INV-${snap.invoiceNo}`;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${String(invLabel).replace(/\//g, '-')}.pdf"`);
          res.setHeader('X-Invoice-Source', 'snapshot');
          res.setHeader('X-Invoice-Frozen-At', new Date(snap.snapshotAt).toISOString());
          return res.send(buf);
        }
        console.error(`[Invoice] CRITICAL SHA MISMATCH on INV-${snap.invoiceNo}: file=${sha} db=${snap.snapshotPdfSha}. Falling back to live render.`);
      } catch (err: unknown) {
        const isMissing = (err as NodeJS.ErrnoException)?.code === 'ENOENT';
        if (isMissing) {
          // Snapshot file is gone (e.g. Railway redeploy wiped ephemeral disk).
          // Clear the orphan pointer so future self-heal can re-freeze, then fall through to live render.
          console.warn(`[Invoice] Snapshot file missing for INV-${snap.invoiceNo}, clearing orphan pointer + self-healing.`);
          prisma.invoice.update({
            where: { id: req.params.id },
            data: {
              snapshotJsonPath: null, snapshotPdfPath: null,
              snapshotJsonSha: null, snapshotPdfSha: null,
              snapshotAt: null,
            } as any,
          }).catch(() => {});
        } else {
          console.error(`[Invoice] Snapshot read failed for INV-${snap.invoiceNo}, falling back to live render:`, err instanceof Error ? (err instanceof Error ? err.message : String(err)) : err);
        }
      }
    }

    // Fallback / legacy path: live render from DB
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        ethanolLiftings: { take: 1, include: { contract: { select: { paymentTermsDays: true, paymentMode: true, buyerPoNo: true, contractType: true } } } },
        ddgsContractDispatches: {
          take: 1,
          include: {
            ddgsDispatchTruck: true,
            contract: { select: { paymentTermsDays: true, paymentMode: true, dealType: true } },
          },
        },
      },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    // Prefer the stored invoice.supplyType (snapshot at write time) over
    // recomputing from the customer's CURRENT state. Editing a customer's
    // state must NOT retroactively flip the GST split on historical PDFs.
    // Fall back to current-state computation only for legacy rows where
    // supplyType wasn't populated by the writing handler.
    const storedSupplyType = invoice.supplyType;
    const isIntraState = storedSupplyType
      ? storedSupplyType === 'INTRA_STATE'
      : !!invoice.customer.state?.toLowerCase().includes('madhya pradesh');
    const lifting = invoice.ethanolLiftings?.[0] || null;
    const ddgsLink = invoice.ddgsContractDispatches?.[0] || null;
    const ddgsTruck = ddgsLink?.ddgsDispatchTruck || null;
    const ddgsContract = ddgsLink?.contract || null;
    const isDDGSInvoice = !!ddgsLink || invoice.productName?.toUpperCase().includes('DDGS');
    const stateCode = invoice.customer.gstNo ? invoice.customer.gstNo.substring(0, 2) : '';

    // Fetch linked shipment for scrap/misc invoices (no lifting or ddgs dispatch)
    const shipment = (!lifting && !ddgsLink && invoice.shipmentId)
      ? await prisma.shipment.findUnique({
          where: { id: invoice.shipmentId },
          select: { vehicleNo: true, driverName: true, driverMobile: true, transporterName: true, destination: true, customerName: true },
        })
      : null;

    const customInvNo = lifting?.invoiceNo || invoice.remarks; // custom invoice no stored on lifting or in remarks
    const invData = {
      invoiceNo: invoice.invoiceNo,
      customInvoiceNo: customInvNo || null,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      challanNo: lifting?.challanNo || invoice.challanNo || ddgsLink?.challanNo || ddgsLink?.gatePassNo || null,
      ewayBill: invoice.ewayBill,
      paymentMode: lifting?.contract?.paymentTermsDays
        ? `${lifting.contract.paymentTermsDays} Days`
        : (lifting?.contract?.paymentMode
            || (ddgsContract?.paymentTermsDays ? `${ddgsContract.paymentTermsDays} Days` : null)
            || ddgsContract?.paymentMode
            || null),
      supplyType: storedSupplyType || (isIntraState ? 'INTRA_STATE' : 'INTER_STATE'),
      customer: (() => {
        // Bill-To resolution: per-invoice override wins, else Customer master.
        // City is not a billTo override (snapshot doesn't carry it), so always use master.
        const inv = invoice as any;
        const overrideGstin = inv.billToGstin || null;
        return {
          name: inv.billToName || invoice.customer.name,
          shortName: invoice.customer.shortName,
          gstin: overrideGstin || invoice.customer.gstNo,
          address: inv.billToAddress || invoice.customer.address,
          city: invoice.customer.city,
          state: inv.billToState || invoice.customer.state,
          stateCode: overrideGstin ? overrideGstin.substring(0, 2) : stateCode,
          pincode: inv.billToPincode || invoice.customer.pincode,
        };
      })(),
      productName: invoice.productName,
      hsnCode: (() => {
        // TODO(deferred): persist hsnCode as a snapshot column on Invoice at
        // write time so this map only handles legacy rows. Until then, derive
        // from productName. Order matters: jobwork checks come BEFORE product
        // checks because "JOBWORK CHARGES FOR DDGS" must yield 998817, not 2303.
        // Ethanol JW invoices print plain "Ethanol" (2026-06-04) — the name no longer
        // signals jobwork, so gate on the lifting's contractType FIRST.
        if (lifting?.contract?.contractType === 'JOB_WORK') return '998842';
        const p = (invoice.productName || '').toUpperCase();
        if (p.includes('JOBWORK') || p.includes('JOB WORK')) {
          if (p.includes('DDGS')) return '998817';
          if (p.includes('SUGAR')) return '998817';
          return '998842'; // ethanol jobwork
        }
        if (p.includes('ETHANOL')) return '22072000';
        if (p.includes('DDGS')) return '23033000';
        if (p.includes('SUGAR')) return '17019990';
        if (p.includes('PRESS MUD') || p.includes('PRESSMUD')) return '23031000';
        if (p.includes('SCRAP')) return '7204';
        if (p.includes('FLY ASH') || p.includes('ASH')) return '26219000';
        // Unknown product — fall back to generic services SAC; flag in remarks for review.
        return '998817';
      })(),
      // DDGS invoices render quantity in KG and rate in ₹/kg (matches reference Mash invoice).
      // Schema stores MT and ₹/MT — convert at print time. Keep 4 decimals on rate so qty×rate
      // round-trips back to the stored amount (Mash uses ₹4.54/kg = ₹4540/MT, but other rates may need more precision).
      quantity: isDDGSInvoice ? Math.round((invoice.quantity || 0) * 1000) : invoice.quantity,
      unit: isDDGSInvoice ? 'KG' : invoice.unit,
      rate: isDDGSInvoice ? Math.round(((invoice.rate || 0) / 1000) * 10000) / 10000 : invoice.rate,
      amount: invoice.amount,
      gstPercent: invoice.gstPercent,
      gstAmount: invoice.gstAmount,
      halfGst: invoice.gstAmount / 2,
      cgstAmount: invoice.cgstAmount || 0,
      sgstAmount: invoice.sgstAmount || 0,
      igstAmount: invoice.igstAmount || 0,
      cgstPercent: invoice.cgstPercent || 0,
      sgstPercent: invoice.sgstPercent || 0,
      igstPercent: invoice.igstPercent || 0,
      freightCharge: invoice.freightCharge,
      tcsPercent: (invoice as any).tcsPercent || 0,
      tcsAmount: (invoice as any).tcsAmount || 0,
      tcsSection: (invoice as any).tcsSection || null,
      totalAmount: invoice.totalAmount,
      // Round-off display: render the rounded-to-rupee total and the signed delta as a "Less:
      // BALANCE ROUND OFF A/C" line. Stored totalAmount keeps full precision; this is display-only.
      // Sample DDGS jobwork invoice: 1,94,627.08 raw → "Less: BALANCE ROUND OFF A/C (-)0.08" → ₹1,94,627.00.
      roundedTotalAmount: Math.round(invoice.totalAmount || 0),
      roundOff: Math.round((Math.round(invoice.totalAmount || 0) - (invoice.totalAmount || 0)) * 100) / 100,
      remarks: invoice.remarks,
        // Transport / Dispatch info — pull from ethanol lifting OR ddgs dispatch truck OR shipment (scrap)
      vehicleNo: lifting?.vehicleNo || ddgsTruck?.vehicleNo || ddgsLink?.vehicleNo || shipment?.vehicleNo || null,
      driverName: lifting?.driverName || ddgsTruck?.driverName || ddgsLink?.driverName || shipment?.driverName || null,
      transporterName: lifting?.transporterName || ddgsTruck?.transporterName || ddgsLink?.transporterName || shipment?.transporterName || null,
      destination: lifting?.destination || ddgsTruck?.destination || ddgsLink?.destination || shipment?.destination || null,
      distanceKm: lifting?.distanceKm || ddgsLink?.distanceKm || null,
      strength: lifting?.strength || null,
      rstNo: lifting?.rstNo || (ddgsTruck?.rstNo ? String(ddgsTruck.rstNo) : null),
      dispatchMode: lifting?.dispatchMode || (isDDGSInvoice ? 'TRUCK' : 'TANKER'),
      productRatePerLtr: lifting?.productRatePerLtr || null,
      productValue: lifting?.productValue || null,
      // Consignee (Ship To) — for DDGS pulled from invoice.shipTo* snapshot;
      // for ethanol legacy from lifting.consignee*. Always render the block when set.
      consignee: (() => {
        if (lifting?.consigneeName) {
          return {
            name: lifting.consigneeName,
            gstin: lifting.consigneeGstin || null,
            address: lifting.consigneeAddress || null,
            state: lifting.consigneeState || null,
            stateCode: lifting.consigneeGstin ? lifting.consigneeGstin.substring(0, 2) : null,
            pincode: lifting.consigneePincode || null,
          };
        }
        if ((invoice as any).shipToName) {
          const inv = invoice as any;
          return {
            name: inv.shipToName,
            gstin: inv.shipToGstin || null,
            address: inv.shipToAddress || null,
            state: inv.shipToState || null,
            stateCode: inv.shipToGstin ? inv.shipToGstin.substring(0, 2) : null,
            pincode: inv.shipToPincode || null,
          };
        }
        return null;
      })(),
      // Customer's PO No. — per-invoice override falls back to contract default.
      // Label adapts to the buyer (Reliance → "RIL PO No.", others → generic "PO No.")
      ...resolveBuyerPo((invoice as any).buyerPoNo, (lifting?.contract as any)?.buyerPoNo, (invoice as any).billToName || invoice.customer?.name),
      // E-Invoice / E-Way Bill data
      irn: invoice.irn || null,
      irnDate: invoice.irnDate || null,
      ackNo: invoice.ackNo || null,
      signedQRCode: invoice.signedQRCode || null,
      ewbNo: invoice.ewbNo || null,
      ewbDate: invoice.ewbDate || null,
      ewbValidTill: invoice.ewbValidTill || null,
    };

    // Convert signedQRCode JWT to actual QR code image, or generate QR from IRN URL
    if (invData.irn) {
      try {
        const { generateQRCode } = await import('../services/templateEngine');
        const qrContent = invData.signedQRCode || `https://einvoice1.gst.gov.in/Others/VSignQRCode?irn=${invData.irn}`;
        const qrDataUrl = await generateQRCode(qrContent);
        invData.signedQRCode = null; // Clear raw JWT so template uses irnQrDataUrl
        (invData as any).irnQrDataUrl = qrDataUrl;
      } catch { /* non-critical */ }
    }

    (invData as any).company = await getCompanyForPdf(invoice.companyId);

    const pdfBuffer = await renderDocumentPdf({
      docType: 'INVOICE',
      data: invData,
      verifyId: invoice.id,
    });

    res.setHeader('Content-Type', 'application/pdf');
    const invLabel = customInvNo ? customInvNo.replace(/\//g, '-') : `INV-${invoice.invoiceNo}`;
    res.setHeader('Content-Disposition', `inline; filename="${invLabel}.pdf"`);
    res.send(pdfBuffer);

    // Self-healing backfill: if invoice has IRN but no snapshot, freeze in background.
    // Phase 1 shadow-write means read path still goes through live render above,
    // but any IRN-generated invoice without a snapshot gets one on its next view.
    if (invoice.irn && !(invoice as any).snapshotAt) {
      freezeInvoice(invoice.id).catch(err => {
        console.error(`[Invoice] Self-heal snapshot failed for INV-${invoice.invoiceNo}:`, err);
      });
    }
}));

// POST /admin/backfill-snapshots — One-shot admin endpoint to freeze IRN-generated invoices.
// Default: only invoices that don't yet have a snapshot (idempotent — safe to call repeatedly).
// ?force=true re-freezes invoices that already have a snapshot (use after a presentation-layer
// template fix). ?invoiceNos=382,384 scopes to specific invoices.
router.post('/admin/backfill-snapshots', asyncHandler(async (req: AuthRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const force = String(req.query.force || '') === 'true';
    const invoiceNos = String(req.query.invoiceNos || '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
    const limit = parseInt(String(req.query.limit || '50')) || 50;

    const results = await backfillSnapshots({ force, invoiceNos, limit });
    res.json(results);
}));

// POST /:id/e-invoice — Generate IRN for invoice
router.post('/:id/e-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    // Check if IRN already exists
    if ((invoice as any).irn) {
      return res.status(400).json({ error: `IRN already generated: ${(invoice as any).irn}` });
    }

    // Validate customer data
    const customer = invoice.customer;
    const missingFields: string[] = [];
    if (!customer.gstNo) missingFields.push('GSTIN');
    if (!customer.state) missingFields.push('State');
    if (!customer.pincode) missingFields.push('Pincode');
    if (!customer.address) missingFields.push('Address');

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Customer "${customer.name}" is missing: ${missingFields.join(', ')}. Update the customer record first.`,
        missingFields,
      });
    }

    if (!invoice.rate || invoice.rate <= 0) {
      return res.status(400).json({ error: 'Invoice rate is zero. Update the invoice first.' });
    }

    const displayNo = invoiceDisplayNo(invoice);
    console.log(`[Invoice] Generating e-invoice for ${displayNo}`);

    // Build proper payload from Invoice record — must use the PRINTED doc number (INV/ETH/NNN)
    // so the IRN returned by GSTN matches what the customer sees on the PDF.
    const invoiceData = {
      invoiceNo: displayNo,
      invoiceDate: invoice.invoiceDate,
      productName: invoice.productName,
      quantity: invoice.quantity,
      unit: invoice.unit,
      rate: invoice.rate,
      amount: invoice.amount,
      gstPercent: invoice.gstPercent,
      customer: {
        gstin: customer.gstNo || '',
        name: customer.name,
        address: customer.address || '',
        city: customer.city || '',
        pincode: customer.pincode || '',
        state: customer.state || '',
        phone: customer.phone || '',
        email: customer.email || '',
      },
    };

    const result = await generateIRN(invoiceData);

    if (!result.success) {
      return res.status(400).json({ error: result.error, rawResponse: result.rawResponse });
    }

    // Store IRN in proper dedicated fields on Invoice
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        irn: result.irn,
        irnDate: new Date(),
        irnStatus: 'GENERATED',
        ackNo: result.ackNo ? String(result.ackNo) : null,
        signedQRCode: result.signedQRCode ? result.signedQRCode.slice(0, 4000) : null,
      } as any,
      include: { customer: true },
    });

    // If invoice is linked to a shipment, copy IRN there too
    if (invoice.shipmentId) {
      await prisma.shipment.update({
        where: { id: invoice.shipmentId },
        data: {
          irn: result.irn,
          irnDate: new Date(),
          irnStatus: 'GENERATED',
          ackNo: result.ackNo ? String(result.ackNo) : null,
          signedQRCode: result.signedQRCode ? result.signedQRCode.slice(0, 4000) : null,
        } as any,
      }).catch(() => {}); // Non-critical
    }

    // Freeze snapshot (shadow-write Phase 1). Fire-and-forget — never blocks the response.
    // IRN at NIC is already generated above; snapshot failure is logged, not surfaced to caller.
    // See docs/design/invoice-snapshot-immutability.md
    freezeInvoice(invoice.id).catch(err => {
      console.error(`[Invoice] Snapshot freeze failed for INV-${invoice.invoiceNo}:`, err);
    });

    res.json({
      success: true,
      irn: result.irn,
      ackNo: result.ackNo,
      ackDt: result.ackDt,
      signedQRCode: result.signedQRCode,
      message: 'e-Invoice generated successfully',
      invoice: updated,
    });
}));

// POST /:id/e-invoice/cancel — Cancel IRN
// PUT /:id/clear-irn — Clear local IRN/EWB/snapshot pointers so a fresh IRN can be issued.
// Use case: operator has already cancelled the IRN on NIC and wants to re-generate from the ERP
// (e.g. because address/description was wrong on the first IRN). This does NOT call NIC —
// the operator is responsible for cancelling at NIC first. Only allowed if the invoice has
// no recorded payments (status is UNPAID or CANCELLED) so we don't break accounting.
router.put('/:id/clear-irn', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
    if ((invoice.paidAmount || 0) > 0) {
      res.status(400).json({ error: 'Cannot clear IRN on a paid invoice. Reverse the payment first.' });
      return;
    }
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        irn: null, irnDate: null, irnStatus: null, ackNo: null, signedQRCode: null,
        ewbNo: null, ewbDate: null, ewbStatus: null, ewbValidTill: null,
        snapshotAt: null, snapshotPdfPath: null, snapshotPdfSha: null,
        snapshotJsonPath: null, snapshotJsonSha: null,
      } as any,
    });
    console.log(`[Invoice] IRN cleared locally by ${req.user?.id || 'system'} on INV-${invoice.invoiceNo}. Operator must have cancelled at NIC first.`);
    res.json({ success: true, invoice: updated });
}));

router.post('/:id/e-invoice/cancel', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const irn = (invoice as any).irn;
    if (!irn) {
      return res.status(400).json({ error: 'Invoice does not have an IRN' });
    }

    // NIC Cancel: CnlRsn = 1 (Duplicate), 2 (Data Entry Mistake), 3 (Order Cancelled), 4 (Others)
    const cancelReason = req.body.cancelReason || '2'; // default: Data Entry Mistake
    const cancelRemarks = req.body.cancelRemarks || req.body.reason || 'Cancelled from ERP';

    console.log(`[Invoice] Cancelling IRN ${irn}, reason=${cancelReason}, remarks=${cancelRemarks}`);

    const result = await cancelIRN(irn, cancelReason, cancelRemarks);

    if (!result.success) {
      return res.status(400).json({ error: result.error, rawResponse: result.rawResponse });
    }

    // Update invoice IRN status
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        irnStatus: 'CANCELLED',
        status: 'CANCELLED',
      } as any,
      include: { customer: true },
    });

    // If linked to shipment, clear IRN there too
    if (invoice.shipmentId) {
      await prisma.shipment.update({
        where: { id: invoice.shipmentId },
        data: { irnStatus: 'CANCELLED' } as any,
      }).catch(() => {});
    }

    res.json({
      success: true,
      irn,
      cancelDate: result.cancelDate,
      message: 'IRN cancelled successfully',
      invoice: updated,
    });
}));

// POST /:id/cancel — Cancel/void an invoice in the ERP (with a remark).
// Marks status=CANCELLED, reverses the SALE journal, and (if an IRN exists) records
// irnStatus=CANCELLED. Does NOT call the NIC portal — cancel the e-invoice there
// yourself. Cannot cancel an invoice that already has payments against it.
router.post('/:id/cancel', validate(cancelInvoiceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
    const reason: string = req.body.reason.trim();

    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
    if (invoice.status === 'CANCELLED') { res.status(400).json({ error: 'Invoice is already cancelled' }); return; }
    if ((invoice.paidAmount || 0) > 0 || invoice.status === 'PAID' || invoice.status === 'PARTIAL') {
      res.status(400).json({ error: 'Cannot cancel an invoice that has payments recorded. Reverse the payments first.' });
      return;
    }

    const irn = (invoice as any).irn;
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'CANCELLED',
        balanceAmount: 0,
        cancelledAt: new Date(),
        cancelledBy: req.user?.id || 'system',
        cancelReason: reason,
        ...(irn ? { irnStatus: 'CANCELLED' } : {}),
      } as any,
      include: { customer: { select: { id: true, name: true, shortName: true } } },
    });

    // Reverse the auto-generated sale journal so the books don't carry a cancelled sale.
    await reverseAutoJournal(prisma, 'SALE', invoice.id, req.user?.id || 'system');

    // Mirror cancellation onto a linked shipment's IRN status, if any.
    if (invoice.shipmentId && irn) {
      await prisma.shipment.update({
        where: { id: invoice.shipmentId },
        data: { irnStatus: 'CANCELLED' } as any,
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Invoice cancelled', invoice: updated });
}));

// GET /:id/e-invoice/details — Get IRN details
router.get('/:id/e-invoice/details', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const irn = (invoice as any).irn;
    if (!irn) {
      return res.status(400).json({ error: 'Invoice does not have an IRN' });
    }

    const result = await getIRNDetails(irn);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      irn,
      details: result.data,
    });
}));

// GET /:id/ewb-pdf — Serve uploaded E-Way Bill PDF
router.get('/:id/ewb-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { ewbPdfData: true, ewbNo: true },
    });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
    if (!invoice.ewbPdfData) { res.status(404).json({ error: 'No EWB PDF uploaded' }); return; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="EWB-${invoice.ewbNo || 'unknown'}.pdf"`);
    res.send(invoice.ewbPdfData);
}));

// POST /:id/send-email — Send Invoice PDF to customer via email
router.post('/:id/send-email', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const toEmail = req.body.to || invoice.customer.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add customer email or provide "to" in request.' }); return; }

    const invLabel = `INV-${String(invoice.invoiceNo).padStart(4, '0')}`;
    // Render the SAME canonical PDF that GET /:id/pdf serves (PO line, IRN bar, Bill-To
    // overrides, no hardcoded signature) so the emailed copy matches the printed/filed one.
    const pdfBuffer = await renderInvoicePdfBuffer(invoice.id);
    if (!pdfBuffer) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const subject = req.body.subject || `${invLabel} — Tax Invoice from MSPIL`;
    const body = req.body.body || `Dear ${invoice.customer.name},\n\nPlease find attached Tax Invoice ${invLabel} dated ${new Date(invoice.invoiceDate).toLocaleDateString('en-IN')}.\n\nProduct: ${invoice.productName}\nQuantity: ${invoice.quantity} ${invoice.unit}\nTotal Amount: Rs.${invoice.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n${invoice.dueDate ? `Due Date: ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}` : ''}\n\nKindly process the payment as per agreed terms.\n\nRegards,\nMahakaushal Sugar & Power Industries Ltd.\nVillage Bachai, Dist. Narsinghpur (M.P.)`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${invLabel}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
}));

export default router;
