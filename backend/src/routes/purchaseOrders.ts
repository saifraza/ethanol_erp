import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { generatePOPdf } from '../utils/pdfGenerator';
// RAG indexing removed — only compliance docs go to RAG
import { renderDocumentPdf } from '../services/documentRenderer';
import { sendEmail } from '../services/messaging';
import { nextDocNo } from '../utils/docSequence';
import { getCompanyForPdf } from '../utils/pdfCompanyHelper';

const router = Router();
router.use(authenticate as any);

// GET / — list POs with filters (status, vendorId), pagination
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const status = req.query.status as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const category = req.query.category as string | undefined; // FUEL, RAW_MATERIAL, etc.
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const where: any = { ...getCompanyFilter(req) };
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
    if (vendorId) where.vendorId = vendorId;
    // Filter by inventory item category on PO lines (not vendor category — those don't match)
    // FUEL = any PO with a line whose inventoryItem.category is 'FUEL'
    // RAW_MATERIAL = lines with category 'RAW_MATERIAL' or 'CHEMICAL' or 'GRAIN'
    // GENERAL = everything else (no fuel/raw material lines)
    if (category === 'FUEL') {
      where.lines = { some: { inventoryItem: { category: 'FUEL' } } };
    } else if (category === 'RAW_MATERIAL') {
      where.lines = { some: { inventoryItem: { category: { in: ['RAW_MATERIAL', 'CHEMICAL', 'GRAIN'] } } } };
    } else if (category === 'GENERAL') {
      where.AND = [
        { NOT: { lines: { some: { inventoryItem: { category: 'FUEL' } } } } },
        { NOT: { lines: { some: { inventoryItem: { category: { in: ['RAW_MATERIAL', 'CHEMICAL', 'GRAIN'] } } } } } },
      ];
    }

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, email: true } },
        lines: true,
        grns: { select: { id: true, status: true } },
        vendorInvoices: { select: { id: true, status: true, totalAmount: true, payments: { select: { amount: true, tdsDeducted: true } } } },
      },
      orderBy: [{ poNo: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await prisma.purchaseOrder.count({ where });

    const posWithCounts = pos.map((po: any) => {
      const invoices = po.vendorInvoices || [];
      const totalInvoiced = invoices.reduce((s: number, inv: any) => s + (inv.totalAmount || 0), 0);
      const totalPaid = invoices.reduce((s: number, inv: any) =>
        s + (inv.payments || []).reduce((ps: number, p: any) => ps + (p.amount || 0) + (p.tdsDeducted || 0), 0), 0);
      const paymentStatus = totalInvoiced === 0 ? 'NO_INVOICE' : totalPaid >= totalInvoiced ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';
      // Received value = sum of (receivedQty × rate + GST) across PO lines.
      // This is the real financial exposure — what we've actually received and owe for.
      // Contract grandTotal stays available as po.grandTotal for reference, but the list
      // now displays received value so an un-received PO shows ₹0 instead of the full
      // contract amount (user feedback 2026-04-09).
      const receivedValue = Math.round(
        (po.lines || []).reduce((s: number, l: any) => {
          const base = (l.receivedQty || 0) * (l.rate || 0);
          return s + base + (base * (l.gstPercent || 0)) / 100;
        }, 0) * 100,
      ) / 100;
      return {
        ...po,
        linesCount: po.lines?.length || 0,
        grnCount: po.grns?.length || 0,
        invoiceCount: invoices.length,
        totalInvoiced,
        totalPaid,
        paymentStatus,
        receivedValue,
      };
    });

    res.json({ pos: posWithCounts, total, page, limit });
}));

// GET /:id — single PO with full pipeline (lines, GRNs, invoices, payments)
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        lines: {
          include: {
            inventoryItem: { select: { id: true, name: true, code: true, unit: true, category: true } },
          },
        },
        grns: {
          include: { lines: true },
          orderBy: { grnDate: 'desc' },
        },
        vendorInvoices: {
          include: {
            payments: { orderBy: { paymentDate: 'desc' } },
          },
          orderBy: { invoiceDate: 'desc' },
        },
      },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Calculate pipeline summary
    const totalOrdered = po.lines.reduce((s, l) => s + l.quantity, 0);
    const totalReceived = po.lines.reduce((s, l) => s + (l.receivedQty || 0), 0);
    const totalPending = po.lines.reduce((s, l) => s + (l.pendingQty || l.quantity - (l.receivedQty || 0)), 0);
    const totalInvoiced = (po.vendorInvoices || []).reduce((s: number, inv: any) => s + (inv.totalAmount || 0), 0);
    let totalPaid = (po.vendorInvoices || []).reduce((s: number, inv: any) =>
      s + (inv.payments || []).reduce((ps: number, p: any) => ps + (p.amount || 0), 0), 0);
    const totalTDS = (po.vendorInvoices || []).reduce((s: number, inv: any) =>
      s + (inv.payments || []).reduce((ps: number, p: any) => ps + (p.tdsDeducted || 0), 0), 0);

    // Also count direct PO payments (not linked to invoices — from Pay on PO flow)
    const directPayments = await prisma.vendorPayment.findMany({
      where: {
        vendorId: po.vendorId,
        invoiceId: null,
        OR: [
          { remarks: { contains: `PO-${po.poNo} ` } },
          { remarks: { endsWith: `PO-${po.poNo}` } },
        ],
      },
      orderBy: { paymentDate: 'desc' },
      select: { id: true, amount: true, mode: true, reference: true, paymentDate: true, tdsDeducted: true, remarks: true },
    });
    const directPaidTotal = directPayments.reduce((s, p) => s + p.amount, 0);
    totalPaid += directPaidTotal;

    // Pending cash vouchers (ACTIVE, not yet settled)
    const pendingCashVouchers = await prisma.cashVoucher.findMany({
      where: { status: 'ACTIVE', purpose: { contains: `PO-${po.poNo}` } },
      select: { id: true, voucherNo: true, amount: true, status: true },
    });
    const pendingCashTotal = pendingCashVouchers.reduce((s, v) => s + v.amount, 0);

    // For OPEN/fuel deals: grandTotal is 0, compute from PO line rate * received qty
    const isOpenDeal = (po as any).dealType === 'OPEN';
    let effectiveAmount = po.grandTotal;
    if (isOpenDeal && po.grandTotal === 0) {
      // Use PO line rate * received qty as effective ordered value
      const lineValue = po.lines.reduce((s: number, l: any) => {
        const base = (l.receivedQty || 0) * (l.rate || 0);
        return s + base + base * (l.gstPercent || 0) / 100;
      }, 0);
      // Fallback to GRN totals if line-level calc is 0
      const grnTotalValue = lineValue || po.grns.reduce((s: number, g: any) => s + (g.totalAmount || 0), 0);
      effectiveAmount = grnTotalValue;
    }
    // Compute received value (rate * received qty + GST) for money-first pipeline
    const receivedValue = Math.round(po.lines.reduce((s: number, l: any) => {
      const base = (l.receivedQty || 0) * (l.rate || 0);
      return s + base + base * (l.gstPercent || 0) / 100;
    }, 0) * 100) / 100;

    // Balance: use invoice balance when invoices exist, else effective amount minus direct payments
    const invoiceBalance = totalInvoiced - totalPaid - totalTDS;
    const effectiveBalance = totalInvoiced > 0 ? invoiceBalance : Math.max(0, effectiveAmount - totalPaid);

    const pipeline = {
      ordered: { qty: totalOrdered, amount: effectiveAmount },
      received: { qty: totalReceived, pending: totalPending, grnCount: po.grns.length, amount: receivedValue },
      invoiced: { amount: totalInvoiced, count: (po.vendorInvoices || []).length },
      paid: { amount: totalPaid, tds: totalTDS, balance: effectiveBalance, directPayments, pendingCash: pendingCashTotal, pendingCashVouchers },
    };

    res.json({ ...po, pipeline });
}));

// POST / — create PO with lines in a transaction
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;

    // Look up items for auto-fill (unified material master = InventoryItem)
    const itemIds = (b.lines || []).map((l: any) => l.materialId || l.inventoryItemId).filter(Boolean);
    const itemsMap: Record<string, any> = {};
    if (itemIds.length > 0) {
      const items = await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } } });
      items.forEach((m: any) => { itemsMap[m.id] = m; });
    }

    // Process lines with calculations
    const processedLines = (b.lines || []).map((line: any) => {
      const itemId = line.materialId || line.inventoryItemId || null;
      const mat = itemId ? itemsMap[itemId] : null;
      const quantity = parseFloat(line.quantity) || 0;
      const rate = parseFloat(line.rate) || 0;
      const discountPercent = parseFloat(line.discountPercent) || 0;
      const gstPercent = parseFloat(line.gstPercent) || (mat?.gstPercent || 0);

      const amount = quantity * rate;
      const discountAmount = amount * (discountPercent / 100);
      const taxableAmount = amount - discountAmount;

      let cgstPercent = 0, sgstPercent = 0, igstPercent = 0;
      let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;

      if (b.supplyType === 'INTRA_STATE') {
        cgstPercent = gstPercent / 2;
        sgstPercent = gstPercent / 2;
        cgstAmount = taxableAmount * (cgstPercent / 100);
        sgstAmount = taxableAmount * (sgstPercent / 100);
      } else if (b.supplyType === 'INTER_STATE') {
        igstPercent = gstPercent;
        igstAmount = taxableAmount * (igstPercent / 100);
      }

      const totalGst = cgstAmount + sgstAmount + igstAmount;
      const lineTotal = taxableAmount + totalGst;

      return {
        inventoryItemId: itemId,
        materialId: null, // deprecated — FK points to Material table, not InventoryItem
        description: line.description || mat?.name || '',
        hsnCode: line.hsnCode || mat?.hsnCode || '',
        quantity,
        unit: line.unit || mat?.unit || 'KG',
        rate,
        discountPercent,
        discountAmount,
        gstPercent,
        amount,
        taxableAmount,
        cgstPercent,
        cgstAmount,
        sgstPercent,
        sgstAmount,
        igstPercent,
        igstAmount,
        totalGst,
        lineTotal,
        isRCM: line.isRCM || false,
        pendingQty: quantity,
        receivedQty: 0,
      };
    });

    // Calculate header totals
    const subtotal = processedLines.reduce((sum: number, line: any) => sum + line.amount, 0);
    const totalCgst = processedLines.reduce((sum: number, line: any) => sum + line.cgstAmount, 0);
    const totalSgst = processedLines.reduce((sum: number, line: any) => sum + line.sgstAmount, 0);
    const totalIgst = processedLines.reduce((sum: number, line: any) => sum + line.igstAmount, 0);
    const totalGst = totalCgst + totalSgst + totalIgst;
    const freightCharge = parseFloat(b.freightCharge) || 0;
    const otherCharges = parseFloat(b.otherCharges) || 0;
    const roundOff = parseFloat(b.roundOff) || 0;
    const grandTotal = subtotal + totalGst + freightCharge + otherCharges + roundOff;

    // Get vendor for TDS check
    const vendor = await prisma.vendor.findUnique({
      where: { id: b.vendorId },
    });

    let tdsAmount = 0;
    if (vendor?.tdsApplicable) {
      tdsAmount = subtotal * ((vendor.tdsPercent || 0) / 100);
    }

    // Create PO with lines in transaction
    const companyId = getActiveCompanyId(req);
    const poNo = await nextDocNo('PurchaseOrder', 'poNo', companyId);
    const po = await prisma.purchaseOrder.create({
      data: {
        poNo,
        vendorId: b.vendorId,
        poDate: b.poDate ? new Date(b.poDate) : new Date(),
        deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : null,
        supplyType: b.supplyType || 'INTRA_STATE',
        placeOfSupply: b.placeOfSupply || '',
        paymentTerms: b.paymentTerms || '',
        creditDays: b.creditDays ? parseInt(b.creditDays) : 0,
        deliveryAddress: b.deliveryAddress || '',
        transportMode: b.transportMode || '',
        transportBy: b.transportBy || '',
        remarks: b.remarks || '',
        subtotal,
        totalCgst,
        totalSgst,
        totalIgst,
        totalGst,
        freightCharge,
        otherCharges,
        roundOff,
        grandTotal,
        tdsAmount,
        status: 'DRAFT',
        userId: req.user!.id,
        companyId: getActiveCompanyId(req),
        lines: {
          create: processedLines,
        },
      },
      include: { lines: true },
    });

    res.status(201).json(po);
}));

// PUT /:id/status — status transitions
router.put('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { newStatus } = req.body;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['APPROVED', 'CANCELLED'],
      'APPROVED': ['SENT', 'CLOSED', 'CANCELLED'],
      'SENT': ['PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'],
      'PARTIAL_RECEIVED': ['RECEIVED', 'CLOSED', 'CANCELLED'],
      'RECEIVED': ['CLOSED'],
      'CLOSED': ['ARCHIVED'],
      'CANCELLED': ['ARCHIVED'],
    };

    if (!validTransitions[po.status] || !validTransitions[po.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${po.status} to ${newStatus}` });
    }

    const updateData: any = { status: newStatus };
    if (newStatus === 'APPROVED') {
      updateData.approvedBy = req.user!.id;
      updateData.approvedAt = new Date();
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: updateData,
      include: { lines: true },
    });

    res.json(updated);
}));

// PUT /:id — update PO details and lines (only if DRAFT)
// PATCH /:id/payment-terms — narrow update allowed even on approved POs
router.patch('/:id/payment-terms', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { paymentTerms, creditDays } = req.body as { paymentTerms?: string; creditDays?: number };
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status === 'CANCELLED' || po.status === 'ARCHIVED') {
      return res.status(400).json({ error: `Cannot update payment terms on ${po.status} PO` });
    }
    const termDays: Record<string, number> = { 'Advance 100%': 0, 'Advance 50% + Balance on Delivery': 0, 'Against Delivery': 0, 'Net 7': 7, 'Net 15': 15, 'Net 30': 30, 'Net 45': 45, 'Net 60': 60, 'Net 90': 90 };
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        paymentTerms: paymentTerms ?? po.paymentTerms,
        creditDays: creditDays ?? (paymentTerms && termDays[paymentTerms] !== undefined ? termDays[paymentTerms] : po.creditDays),
      },
      select: { id: true, poNo: true, paymentTerms: true, creditDays: true, status: true },
    });
    res.json(updated);
}));

router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { lines: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only update PO in DRAFT status' });
    }

    const b = req.body;

    // If lines are provided, rebuild them
    if (b.lines && Array.isArray(b.lines)) {
      // Look up items for auto-fill (unified material master)
      const itemIds = b.lines.map((l: any) => l.materialId || l.inventoryItemId).filter(Boolean);
      const itemsMap: Record<string, any> = {};
      if (itemIds.length > 0) {
        const items = await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } } });
        items.forEach((m: any) => { itemsMap[m.id] = m; });
      }

      const supplyType = b.supplyType || po.supplyType;
      const processedLines = b.lines.map((line: any) => {
        const itemId = line.materialId || line.inventoryItemId || null;
        const mat = itemId ? itemsMap[itemId] : null;
        const quantity = parseFloat(line.quantity) || 0;
        const rate = parseFloat(line.rate) || 0;
        const discountPercent = parseFloat(line.discountPercent) || 0;
        const gstPercent = parseFloat(line.gstPercent) || (mat?.gstPercent || 0);

        const amount = quantity * rate;
        const discountAmount = amount * (discountPercent / 100);
        const taxableAmount = amount - discountAmount;

        let cgstPercent = 0, sgstPercent = 0, igstPercent = 0;
        let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;

        if (supplyType === 'INTRA_STATE') {
          cgstPercent = gstPercent / 2; sgstPercent = gstPercent / 2;
          cgstAmount = taxableAmount * (cgstPercent / 100);
          sgstAmount = taxableAmount * (sgstPercent / 100);
        } else if (supplyType === 'INTER_STATE') {
          igstPercent = gstPercent;
          igstAmount = taxableAmount * (igstPercent / 100);
        }

        const totalGst = cgstAmount + sgstAmount + igstAmount;
        const lineTotal = taxableAmount + totalGst;

        return {
          inventoryItemId: itemId, materialId: null,
          description: line.description || mat?.name || '',
          hsnCode: line.hsnCode || mat?.hsnCode || '', quantity, unit: line.unit || mat?.unit || 'KG',
          rate, discountPercent, discountAmount, gstPercent, amount, taxableAmount,
          cgstPercent, cgstAmount, sgstPercent, sgstAmount, igstPercent, igstAmount,
          totalGst, lineTotal, isRCM: line.isRCM || false, pendingQty: quantity, receivedQty: 0,
        };
      });

      const subtotal = processedLines.reduce((s: number, l: any) => s + l.amount, 0);
      const totalCgst = processedLines.reduce((s: number, l: any) => s + l.cgstAmount, 0);
      const totalSgst = processedLines.reduce((s: number, l: any) => s + l.sgstAmount, 0);
      const totalIgst = processedLines.reduce((s: number, l: any) => s + l.igstAmount, 0);
      const totalGst = totalCgst + totalSgst + totalIgst;
      const freightCharge = parseFloat(b.freightCharge) ?? po.freightCharge;
      const otherCharges = parseFloat(b.otherCharges) ?? po.otherCharges;
      const roundOff = parseFloat(b.roundOff) ?? po.roundOff;
      const grandTotal = subtotal + totalGst + freightCharge + otherCharges + roundOff;

      const vendor = await prisma.vendor.findUnique({ where: { id: b.vendorId || po.vendorId } });
      let tdsAmount = 0;
      if (vendor?.tdsApplicable) tdsAmount = subtotal * ((vendor.tdsPercent || 0) / 100);

      // Delete old lines and update PO atomically
      const updated = await prisma.$transaction(async (tx) => {
        await tx.pOLine.deleteMany({ where: { poId: po.id } });
        return tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            vendorId: b.vendorId || po.vendorId,
            poDate: b.poDate ? new Date(b.poDate) : po.poDate,
            deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : po.deliveryDate,
            supplyType: supplyType, placeOfSupply: b.placeOfSupply ?? po.placeOfSupply,
            paymentTerms: b.paymentTerms ?? po.paymentTerms,
            creditDays: b.creditDays !== undefined ? parseInt(b.creditDays) : po.creditDays,
            deliveryAddress: b.deliveryAddress ?? po.deliveryAddress,
            transportMode: b.transportMode ?? po.transportMode,
            remarks: b.remarks ?? po.remarks,
            subtotal, totalCgst, totalSgst, totalIgst, totalGst,
            freightCharge, otherCharges, roundOff, grandTotal, tdsAmount,
            lines: { create: processedLines },
          },
          include: { lines: true },
        });
      });
      return res.json(updated);
    }

    // Header-only update (no lines provided)
    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: {
        vendorId: b.vendorId !== undefined ? b.vendorId : undefined,
        poDate: b.poDate !== undefined ? new Date(b.poDate) : undefined,
        deliveryDate: b.deliveryDate !== undefined ? new Date(b.deliveryDate) : undefined,
        supplyType: b.supplyType !== undefined ? b.supplyType : undefined,
        placeOfSupply: b.placeOfSupply !== undefined ? b.placeOfSupply : undefined,
        paymentTerms: b.paymentTerms !== undefined ? b.paymentTerms : undefined,
        creditDays: b.creditDays !== undefined ? parseInt(b.creditDays) : undefined,
        deliveryAddress: b.deliveryAddress !== undefined ? b.deliveryAddress : undefined,
        transportMode: b.transportMode !== undefined ? b.transportMode : undefined,
        transportBy: b.transportBy !== undefined ? b.transportBy : undefined,
        remarks: b.remarks !== undefined ? b.remarks : undefined,
      },
      include: { lines: true },
    });

    res.json(updated);
}));

// DELETE /:id — delete only if DRAFT
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only delete PO in DRAFT status' });
    }

    await prisma.purchaseOrder.delete({
      where: { id: req.params.id },
    });

    res.json({ ok: true });
}));

// GET /:id/pdf — Generate PO PDF with letterhead
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        lines: true,
        grns: { include: { lines: true } },
      },
    });

    if (!po) { res.status(404).json({ error: 'PO not found' }); return; }

    // Aggregate GRN lines by poLineId → received / accepted / rejected per PO line
    const grnAgg: Record<string, { received: number; accepted: number; rejected: number }> = {};
    for (const g of (po.grns || [])) {
      for (const gl of (g.lines || [])) {
        if (!gl.poLineId) continue;
        const a = grnAgg[gl.poLineId] || (grnAgg[gl.poLineId] = { received: 0, accepted: 0, rejected: 0 });
        a.received += gl.receivedQty || 0;
        a.accepted += gl.acceptedQty || 0;
        a.rejected += gl.rejectedQty || 0;
      }
    }

    const poData = {
      poNo: po.poNo,
      poDate: po.poDate,
      deliveryDate: po.deliveryDate || po.poDate,
      vendor: po.vendor,
      supplyType: po.supplyType,
      placeOfSupply: po.placeOfSupply,
      paymentTerms: po.paymentTerms,
      creditDays: po.creditDays,
      deliveryAddress: po.deliveryAddress,
      transportMode: po.transportMode,
      remarks: po.remarks,
      lines: po.lines.map((l: any) => {
        // For open fuel deals (qty=999999), use receivedQty for PDF display
        // For open/truck deals (qty=999999), show receivedQty. If no receipts yet, show 0 (not 999999)
        const displayQty = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
        const lineAmount = l.amount && l.amount > 0 ? l.amount : displayQty * l.rate;
        const taxable = l.taxableAmount && l.taxableAmount > 0 ? l.taxableAmount : lineAmount * (1 - (l.discountPercent || 0) / 100);
        const gstAmt = taxable * (l.gstPercent || 0) / 100;
        const isIntra = po.supplyType !== 'INTER_STATE';
        const agg = grnAgg[l.id] || { received: 0, accepted: 0, rejected: 0 };
        const orderedQty = l.quantity >= 900000 ? 0 : l.quantity;
        const overDelivered = agg.received > orderedQty && orderedQty > 0;
        return {
          description: l.description,
          hsnCode: l.hsnCode || '',
          quantity: displayQty,
          orderedQty,
          receivedQty: Math.round(agg.received * 100) / 100,
          acceptedQty: Math.round(agg.accepted * 100) / 100,
          rejectedQty: Math.round(agg.rejected * 100) / 100,
          overDelivered,
          unit: l.unit,
          rate: l.rate,
          discountPercent: l.discountPercent || 0,
          gstPercent: l.gstPercent || 0,
          isRCM: l.isRCM || false,
          amount: Math.round(lineAmount * 100) / 100,
          taxableAmount: Math.round(taxable * 100) / 100,
          cgst: l.cgstAmount || (isIntra ? Math.round(gstAmt / 2 * 100) / 100 : 0),
          sgst: l.sgstAmount || (isIntra ? Math.round(gstAmt / 2 * 100) / 100 : 0),
          igst: l.igstAmount || (isIntra ? 0 : Math.round(gstAmt * 100) / 100),
          lineTotal: l.lineTotal && l.lineTotal > 0 ? l.lineTotal : Math.round((taxable + gstAmt) * 100) / 100,
        };
      }),
      // Calculate totals from lines if DB values are 0 (e.g., open fuel deals)
      // For open deals (sentinel qty), use receivedQty (0 if nothing delivered yet)
      subtotal: po.subtotal > 0 ? po.subtotal : (() => {
        return Math.round(po.lines.reduce((s: number, l: any) => {
          const qty = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
          return s + qty * l.rate;
        }, 0) * 100) / 100;
      })(),
      totalGst: po.totalGst > 0 ? po.totalGst : (() => {
        return Math.round(po.lines.reduce((s: number, l: any) => {
          const qty = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
          return s + qty * l.rate * (l.gstPercent || 0) / 100;
        }, 0) * 100) / 100;
      })(),
      freightCharge: po.freightCharge,
      otherCharges: po.otherCharges,
      roundOff: po.roundOff,
      grandTotal: po.grandTotal > 0 ? po.grandTotal : (() => {
        return Math.round(po.lines.reduce((s: number, l: any) => {
          const qty = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
          const base = qty * l.rate;
          return s + base + base * (l.gstPercent || 0) / 100;
        }, 0) * 100) / 100;
      })(),
      preparedBy: 'Purchase Department',
      approvedBy: 'Sibtay Hasnain Zaidi',
      authorizedSignatory: 'OP Pandey — Unit Head',
      company: await getCompanyForPdf(po.companyId),
    };
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderDocumentPdf({
        docType: 'PURCHASE_ORDER',
        data: poData,
        verifyId: po.id,
      });
    } catch (renderErr) {
      console.error('[PO PDF] Puppeteer render failed, falling back to PDFKit:', (renderErr as Error).message);
      pdfBuffer = await generatePOPdf(poData);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="PO-${po.poNo}.pdf"`);
    res.send(pdfBuffer);
}));

// POST /:id/send-email — Send PO PDF to vendor via email
router.post('/:id/send-email', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { vendor: true, lines: true },
    });
    if (!po) { res.status(404).json({ error: 'PO not found' }); return; }

    const toEmail = req.body.to || po.vendor.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add vendor email or provide "to" in request.' }); return; }

    const poLabel = `PO-${String(po.poNo).padStart(4, '0')}`;
    const pdfBuffer = await generatePOPdf({
      poNo: po.poNo, poDate: po.poDate, deliveryDate: po.deliveryDate || po.poDate,
      vendor: po.vendor, supplyType: po.supplyType, placeOfSupply: po.placeOfSupply,
      paymentTerms: po.paymentTerms, creditDays: po.creditDays,
      deliveryAddress: po.deliveryAddress, transportMode: po.transportMode, remarks: po.remarks,
      lines: po.lines.map((l: any) => ({
        description: l.description, hsnCode: l.hsnCode || '', quantity: l.quantity, unit: l.unit,
        rate: l.rate, discountPercent: l.discountPercent || 0, gstPercent: l.gstPercent || 0,
        isRCM: l.isRCM || false, amount: l.amount || l.quantity * l.rate,
        taxableAmount: l.taxableAmount || (l.quantity * l.rate * (1 - (l.discountPercent || 0) / 100)),
        cgst: l.cgstAmount || l.cgst || 0, sgst: l.sgstAmount || l.sgst || 0,
        igst: l.igstAmount || l.igst || 0, lineTotal: l.lineTotal || 0,
      })),
      subtotal: po.subtotal, totalGst: po.totalGst, freightCharge: po.freightCharge,
      otherCharges: po.otherCharges, roundOff: po.roundOff, grandTotal: po.grandTotal,
    });

    const subject = req.body.subject || `${poLabel} — Purchase Order from MSPIL`;
    const body = req.body.body || `Dear ${po.vendor.name},\n\nPlease find attached Purchase Order ${poLabel} dated ${new Date(po.poDate).toLocaleDateString('en-IN')}.\n\nTotal Amount: Rs.${po.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\nDelivery Date: ${new Date(po.deliveryDate || po.poDate).toLocaleDateString('en-IN')}\nPayment Terms: ${po.paymentTerms || 'As agreed'}\n\nKindly acknowledge receipt and confirm delivery schedule.\n\nRegards,\nMahakaushal Sugar & Power Industries Ltd.\nVillage Bachai, Dist. Narsinghpur (M.P.)`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${poLabel}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
}));

// ═══════════════════════════════════════════════════════
// PAY ON PO — Running account payments (partial OK)
// ═══════════════════════════════════════════════════════

// GET /:id/payments — payment ledger for this PO
router.get('/:id/payments', asyncHandler(async (req: AuthRequest, res: Response) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    select: { id: true, poNo: true, grandTotal: true, lines: { select: { quantity: true, receivedQty: true, rate: true, gstPercent: true } } },
  });
  if (!po) return res.status(404).json({ error: 'PO not found' });

  // Calculate receivable from RECEIVED quantity only (not full PO)
  const receivable = Math.round(po.lines.reduce((s, l) => {
    const base = (l.receivedQty || 0) * l.rate;
    return s + base + base * (l.gstPercent || 0) / 100;
  }, 0) * 100) / 100;
  const poTotal = po.grandTotal > 0 ? po.grandTotal : receivable;

  // Find all payments referencing this PO
  const payments = await prisma.vendorPayment.findMany({
    where: {
      OR: [
        { remarks: { contains: `PO-${po.poNo} ` } },
        { remarks: { endsWith: `PO-${po.poNo}` } },
      ],
    },
    orderBy: { paymentDate: 'asc' },
    select: { id: true, paymentDate: true, amount: true, mode: true, reference: true, remarks: true, isAdvance: true },
  });

  let running = 0;
  const ledger = payments.map(p => {
    running += p.amount;
    return { ...p, runningTotal: Math.round(running * 100) / 100 };
  });

  // Count pending cash vouchers
  const pendingCash = await prisma.cashVoucher.findMany({
    where: { status: 'ACTIVE', purpose: { contains: `PO-${po.poNo}` } },
    select: { id: true, voucherNo: true, amount: true, date: true },
  });
  const pendingCashTotal = pendingCash.reduce((s, v) => s + v.amount, 0);

  res.json({
    poNo: po.poNo,
    poTotal,
    receivedValue: receivable,
    totalPaid: Math.round(running * 100) / 100,
    pendingCash: Math.round(pendingCashTotal * 100) / 100,
    pendingCashVouchers: pendingCash,
    remaining: Math.round(Math.max(0, receivable - running - pendingCashTotal) * 100) / 100,
    isFullyPaid: (running + pendingCashTotal) >= receivable - 0.01,
    payments: ledger,
  });
}));

// POST /:id/pay — record payment against PO (partial OK, auto-close when fully paid)
router.post('/:id/pay', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { mode, reference, remarks: userRemarks } = req.body;
  const amount = parseFloat(req.body.amount);
  if (!amount || !isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    select: { id: true, poNo: true, vendorId: true, grandTotal: true, status: true, lines: { select: { quantity: true, receivedQty: true, rate: true, gstPercent: true, description: true, inventoryItem: { select: { category: true } } } } },
  });
  if (!po) return res.status(404).json({ error: 'PO not found' });

  // Detect category from inventory item (FUEL, RAW_MATERIAL, CHEMICAL, etc.)
  const itemCategory = po.lines[0]?.inventoryItem?.category || '';
  const FUEL_KEYWORDS = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'biomass'];
  const isFuel = itemCategory === 'FUEL' || FUEL_KEYWORDS.some(kw => (po.lines[0]?.description || '').toLowerCase().includes(kw));

  // Calculate receivable — based on RECEIVED quantity only (not full PO value)
  // User can only pay for material that's actually been delivered
  const receivedValue = Math.round(po.lines.reduce((s, l) => {
    const base = (l.receivedQty || 0) * l.rate;
    return s + base + base * (l.gstPercent || 0) / 100;
  }, 0) * 100) / 100;
  const poTotal = po.grandTotal > 0 ? po.grandTotal : Math.round(po.lines.reduce((s, l) => {
    const qty = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
    const base = qty * l.rate;
    return s + base + base * (l.gstPercent || 0) / 100;
  }, 0) * 100) / 100;
  const receivable = receivedValue; // Cap at received value, not PO total

  // Calculate already paid (confirmed payments)
  const existingPayments = await prisma.vendorPayment.findMany({
    where: {
      vendorId: po.vendorId,
      invoiceId: null,
      OR: [
        { remarks: { contains: `PO-${po.poNo} ` } },
        { remarks: { endsWith: `PO-${po.poNo}` } },
      ],
    },
    select: { amount: true },
  });
  const alreadyPaid = existingPayments.reduce((s, p) => s + p.amount, 0);

  // Count INITIATED (pending bank) payments — committed but UTR not entered yet
  const pendingBankPayments = await prisma.vendorPayment.findMany({
    where: {
      vendorId: po.vendorId,
      paymentStatus: 'INITIATED',
      OR: [
        { remarks: { contains: `PO-${po.poNo} ` } },
        { remarks: { endsWith: `PO-${po.poNo}` } },
      ],
    },
    select: { amount: true },
  });
  const pendingBank = pendingBankPayments.reduce((s, p) => s + p.amount, 0);

  // Count ACTIVE (pending) cash vouchers
  const pendingCashVouchers = await prisma.cashVoucher.findMany({
    where: {
      status: 'ACTIVE',
      purpose: { contains: `PO-${po.poNo}` },
    },
    select: { amount: true },
  });
  const pendingCash = pendingCashVouchers.reduce((s, v) => s + v.amount, 0);

  const totalCommitted = alreadyPaid + pendingBank + pendingCash;
  const remaining = receivable - totalCommitted;

  if (amount > remaining + 0.01) {
    const parts = [];
    if (alreadyPaid > 0) parts.push(`paid ₹${alreadyPaid.toLocaleString('en-IN')}`);
    if (pendingCash > 0) parts.push(`₹${pendingCash.toLocaleString('en-IN')} awaiting cash confirmation`);
    return res.status(400).json({ error: `Payment ₹${amount.toLocaleString('en-IN')} exceeds remaining ₹${remaining.toFixed(2)} (${parts.join(', ')})` });
  }

  const payMode = mode || 'NEFT';

  // CASH payments → create CashVoucher (ACTIVE). VendorPayment created on settlement.
  if (payMode === 'CASH') {
    const vendor = await prisma.vendor.findUnique({ where: { id: po.vendorId }, select: { name: true, phone: true } });
    const voucher = await prisma.cashVoucher.create({
      data: {
        date: new Date(),
        type: 'PAYMENT',
        payeeName: vendor?.name || 'Unknown',
        payeePhone: vendor?.phone || null,
        purpose: `${isFuel ? 'Fuel' : 'Material'} payment against PO-${po.poNo}${userRemarks ? ' | ' + userRemarks : ''}`,
        category: isFuel ? 'FUEL' : 'MATERIAL',
        amount,
        paymentMode: 'CASH',
        authorizedBy: req.user!.name || 'Admin',
        status: 'ACTIVE',
        userId: req.user!.id,
        companyId: getActiveCompanyId(req),
      },
    });

    // Auto-journal for cash advance
    try {
      const { createAdvanceJournal } = await import('../services/autoJournal');
      if (typeof createAdvanceJournal === 'function') {
        const jid = await createAdvanceJournal(prisma as Parameters<typeof createAdvanceJournal>[0], {
          id: voucher.id, amount, mode: 'CASH', reference: `CV-${voucher.voucherNo}`,
          vendorId: po.vendorId, userId: req.user!.id, paymentDate: voucher.date,
        });
        if (jid) await prisma.cashVoucher.update({ where: { id: voucher.id }, data: { journalEntryId: jid } });
      }
    } catch { /* best effort */ }

    return res.json({
      type: 'CASH_VOUCHER',
      voucher,
      message: `Cash voucher #${voucher.voucherNo} created. Go to Cash Vouchers to confirm payment.`,
      totalPaid: Math.round(alreadyPaid * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      fullyPaid: false,
    });
  }

  // BANK payments → create VendorPayment with INITIATED status (pending UTR confirmation)
  const vendor = await prisma.vendor.findUnique({
    where: { id: po.vendorId },
    select: { name: true, phone: true, bankName: true, bankAccount: true, bankIfsc: true },
  });

  const payment = await prisma.vendorPayment.create({
    data: {
      vendorId: po.vendorId,
      paymentDate: new Date(),
      amount,
      mode: payMode,
      reference: reference || '', // UTR can be empty — filled later on confirm
      paymentStatus: reference ? 'CONFIRMED' : 'INITIATED', // If UTR provided, auto-confirm
      confirmedAt: reference ? new Date() : null,
      isAdvance: false,
      remarks: `Payment against PO-${po.poNo}${userRemarks ? ' | ' + userRemarks : ''}`,
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
    },
  });

  // Auto-journal only if confirmed (has UTR)
  if (payment.paymentStatus === 'CONFIRMED') {
    try {
      const { onVendorPaymentMade } = await import('../services/autoJournal');
      await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
        id: payment.id, amount, mode: payMode, reference: reference || '',
        tdsDeducted: 0, vendorId: po.vendorId, userId: req.user!.id, paymentDate: payment.paymentDate,
      });
    } catch { /* best effort */ }
  }

  // Auto-close PO when fully paid (only count confirmed payments)
  if (payment.paymentStatus === 'CONFIRMED') {
    const newTotalPaid = alreadyPaid + amount;
    const fullyPaid = newTotalPaid >= receivable - 0.01;
    if (fullyPaid && po.status !== 'CLOSED') {
      await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CLOSED' } });
    }
  }

  res.json({
    type: payment.paymentStatus === 'CONFIRMED' ? 'BANK_PAYMENT' : 'BANK_INITIATED',
    payment,
    vendor: vendor ? { name: vendor.name, phone: vendor.phone, bankName: vendor.bankName, bankAccount: vendor.bankAccount, bankIfsc: vendor.bankIfsc } : null,
    poNo: po.poNo,
    totalPaid: Math.round((alreadyPaid + (payment.paymentStatus === 'CONFIRMED' ? amount : 0)) * 100) / 100,
    remaining: Math.round(Math.max(0, receivable - alreadyPaid - (payment.paymentStatus === 'CONFIRMED' ? amount : 0)) * 100) / 100,
    fullyPaid: payment.paymentStatus === 'CONFIRMED' && (alreadyPaid + amount) >= receivable - 0.01,
  });
}));

// POST /payments/:paymentId/confirm — enter UTR and confirm a bank payment
router.post('/payments/:paymentId/confirm', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { reference } = req.body;
  if (!reference || !reference.trim()) return res.status(400).json({ error: 'UTR / Reference is required to confirm' });

  const payment = await prisma.vendorPayment.findUnique({ where: { id: req.params.paymentId } });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.paymentStatus === 'CONFIRMED') return res.status(400).json({ error: 'Payment already confirmed' });

  const updated = await prisma.vendorPayment.update({
    where: { id: payment.id },
    data: { reference: reference.trim(), paymentStatus: 'CONFIRMED', confirmedAt: new Date() },
  });

  // Now create journal entry (was deferred until confirmation)
  try {
    const { onVendorPaymentMade } = await import('../services/autoJournal');
    await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
      id: updated.id, amount: updated.amount, mode: updated.mode, reference: updated.reference || '',
      tdsDeducted: 0, vendorId: updated.vendorId, userId: req.user!.id, paymentDate: updated.paymentDate,
    });
  } catch { /* best effort */ }

  // Check if PO is now fully paid
  const poMatch = (payment.remarks || '').match(/PO-(\d+)/);
  if (poMatch) {
    const poNo = parseInt(poMatch[1]);
    const po = await prisma.purchaseOrder.findFirst({
      where: { poNo },
      select: { id: true, status: true, grandTotal: true, vendorId: true, lines: { select: { receivedQty: true, rate: true, gstPercent: true, quantity: true } } },
    });
    if (po && po.status !== 'CLOSED') {
      const receivable = Math.round(po.lines.reduce((s, l) => {
        const base = (l.receivedQty || 0) * l.rate;
        return s + base + base * (l.gstPercent || 0) / 100;
      }, 0) * 100) / 100;
      const allPayments = await prisma.vendorPayment.findMany({
        where: { vendorId: po.vendorId, paymentStatus: 'CONFIRMED', invoiceId: null, OR: [{ remarks: { contains: `PO-${poNo} ` } }, { remarks: { endsWith: `PO-${poNo}` } }] },
        select: { amount: true },
      });
      const totalPaid = allPayments.reduce((s, p) => s + p.amount, 0);
      if (totalPaid >= receivable - 0.01) {
        await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CLOSED' } });
      }
    }
  }

  res.json({ ok: true, payment: updated });
}));

export default router;
