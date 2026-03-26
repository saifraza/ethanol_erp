import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { generatePOPdf } from '../utils/pdfGenerator';
import { sendEmail } from '../services/messaging';

const router = Router();
router.use(authenticate as any);

// GET / — list POs with filters (status, vendorId), pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 500;

    const where: any = {};
    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: true,
        lines: true,
      },
      orderBy: { poDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await prisma.purchaseOrder.count({ where });

    const posWithCounts = pos.map(po => ({
      ...po,
      linesCount: po.lines.length,
    }));

    res.json({ pos: posWithCounts, total, page, limit });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single PO with all lines, vendor, GRNs
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        lines: true,
        grns: true,
      },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    res.json(po);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create PO with lines in a transaction
router.post('/', async (req: Request, res: Response) => {
  try {
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
        materialId: itemId, // backward compat — same ID now points to InventoryItem
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
    const po = await prisma.purchaseOrder.create({
      data: {
        vendorId: b.vendorId,
        poDate: b.poDate ? new Date(b.poDate) : new Date(),
        deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : null,
        supplyType: b.supplyType || 'INTRA_STATE',
        placeOfSupply: b.placeOfSupply || '',
        paymentTerms: b.paymentTerms || '',
        creditDays: b.creditDays ? parseInt(b.creditDays) : 0,
        deliveryAddress: b.deliveryAddress || '',
        transportMode: b.transportMode || '',
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
        userId: (req as any).user.id,
        lines: {
          create: processedLines,
        },
      },
      include: { lines: true },
    });

    res.status(201).json(po);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/status — status transitions
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { newStatus } = req.body;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['APPROVED', 'CANCELLED'],
      'APPROVED': ['SENT', 'CANCELLED'],
      'SENT': ['PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'],
      'PARTIAL_RECEIVED': ['RECEIVED', 'CLOSED'],
      'RECEIVED': ['CLOSED'],
    };

    if (!validTransitions[po.status] || !validTransitions[po.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${po.status} to ${newStatus}` });
    }

    const updateData: any = { status: newStatus };
    if (newStatus === 'APPROVED') {
      updateData.approvedBy = (req as any).user.id;
      updateData.approvedAt = new Date();
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: updateData,
      include: { lines: true },
    });

    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update PO details and lines (only if DRAFT)
router.put('/:id', async (req: Request, res: Response) => {
  try {
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
          inventoryItemId: itemId, materialId: itemId,
          description: line.description || mat?.name || '',
          hsnCode: line.hsnCode || mat?.hsnCode || '', quantity, unit: line.unit || mat?.unit || 'KG',
          rate, discountPercent, discountAmount, gstPercent, amount, taxableAmount,
          cgstPercent, cgstAmount, sgstPercent, sgstAmount, igstPercent, igstAmount,
          totalGst, lineTotal, isRCM: line.isRCM || false, pendingQty: quantity, receivedQty: 0,
        };
      });

      // Delete old lines and create new ones
      await prisma.pOLine.deleteMany({ where: { poId: po.id } });

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

      const updated = await prisma.purchaseOrder.update({
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
        remarks: b.remarks !== undefined ? b.remarks : undefined,
      },
      include: { lines: true },
    });

    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — delete only if DRAFT
router.delete('/:id', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/pdf — Generate PO PDF with letterhead
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        lines: true,
      },
    });

    if (!po) { res.status(404).json({ error: 'PO not found' }); return; }

    const pdfBuffer = await generatePOPdf({
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
      lines: po.lines.map((l: any) => ({
        description: l.description,
        hsnCode: l.hsnCode || '',
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate,
        discountPercent: l.discountPercent || 0,
        gstPercent: l.gstPercent || 0,
        isRCM: l.isRCM || false,
        amount: l.amount || l.quantity * l.rate,
        taxableAmount: l.taxableAmount || (l.quantity * l.rate * (1 - (l.discountPercent || 0) / 100)),
        cgst: l.cgstAmount || l.cgst || 0,
        sgst: l.sgstAmount || l.sgst || 0,
        igst: l.igstAmount || l.igst || 0,
        lineTotal: l.lineTotal || 0,
      })),
      subtotal: po.subtotal,
      totalGst: po.totalGst,
      freightCharge: po.freightCharge,
      otherCharges: po.otherCharges,
      roundOff: po.roundOff,
      grandTotal: po.grandTotal,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="PO-${po.poNo}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/send-email — Send PO PDF to vendor via email
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
