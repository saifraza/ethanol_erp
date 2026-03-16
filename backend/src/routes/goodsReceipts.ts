import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// GET / — list GRNs with filters (poId, vendorId, status)
router.get('/', async (req: Request, res: Response) => {
  try {
    const poId = req.query.poId as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (poId) where.poId = poId;
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;

    const grns = await prisma.goodsReceipt.findMany({
      where,
      include: {
        po: true,
        vendor: true,
        lines: true,
      },
      orderBy: { grnDate: 'desc' },
    });

    res.json({ grns });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /pending-pos — list POs with pending quantities
router.get('/pending-pos', async (req: Request, res: Response) => {
  try {
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: ['SENT', 'PARTIAL_RECEIVED', 'APPROVED'],
        },
      },
      include: {
        vendor: true,
        lines: {
          where: {
            pendingQty: {
              gt: 0,
            },
          },
        },
      },
    });

    const filtered = pos.filter(po => po.lines.length > 0);
    res.json({ pos: filtered });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single GRN with lines, po, vendor
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
      include: {
        po: true,
        vendor: true,
        lines: true,
      },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });
    res.json(grn);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create GRN against a PO
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;

    // Get PO for validation
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: b.poId },
      include: { lines: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Process lines
    const processedLines = (b.lines || []).map((line: any) => {
      const acceptedQty = parseFloat(line.acceptedQty) || 0;
      const rate = parseFloat(line.rate) || 0;
      const amount = acceptedQty * rate;

      return {
        poLineId: line.poLineId || null,
        materialId: line.materialId || null,
        description: line.description || '',
        receivedQty: parseFloat(line.receivedQty) || 0,
        acceptedQty,
        rejectedQty: parseFloat(line.rejectedQty) || 0,
        unit: line.unit || 'kg',
        rate,
        amount,
        storageLocation: line.storageLocation || '',
        batchNo: line.batchNo || '',
        remarks: line.remarks || '',
      };
    });

    // Calculate totals
    const totalAmount = processedLines.reduce((sum: number, line: any) => sum + line.amount, 0);
    const totalQty = processedLines.reduce((sum: number, line: any) => sum + line.acceptedQty, 0);

    // Create GRN
    const grn = await prisma.goodsReceipt.create({
      data: {
        poId: b.poId,
        vendorId: b.vendorId,
        grnDate: b.grnDate ? new Date(b.grnDate) : new Date(),
        vehicleNo: b.vehicleNo || '',
        challanNo: b.challanNo || '',
        challanDate: b.challanDate ? new Date(b.challanDate) : null,
        ewayBill: b.ewayBill || '',
        remarks: b.remarks || '',
        totalAmount,
        totalQty,
        status: 'DRAFT',
        userId: (req as any).user.id,
        lines: {
          create: processedLines,
        },
      },
      include: { lines: true },
    });

    // Update PO lines and material stocks
    for (const line of processedLines) {
      if (line.poLineId) {
        const poLine = await prisma.pOLine.findUnique({
          where: { id: line.poLineId },
        });
        if (poLine) {
          const newReceivedQty = poLine.receivedQty + line.acceptedQty;
          const newPendingQty = poLine.quantity - newReceivedQty;

          await prisma.pOLine.update({
            where: { id: line.poLineId },
            data: {
              receivedQty: newReceivedQty,
              pendingQty: newPendingQty,
            },
          });
        }
      }

      // Update material stock
      if (line.materialId) {
        const material = await prisma.material.findUnique({
          where: { id: line.materialId },
        });
        if (material) {
          await prisma.material.update({
            where: { id: line.materialId },
            data: {
              currentStock: material.currentStock + line.acceptedQty,
            },
          });
        }
      }
    }

    // Check if all PO lines are fully received
    const updatedPoLines = await prisma.pOLine.findMany({
      where: { poId: b.poId },
    });
    const allFullyReceived = updatedPoLines.every((line: any) => line.pendingQty === 0);
    const anyPartialReceived = updatedPoLines.some((line: any) => line.receivedQty > 0 && line.pendingQty > 0);

    if (allFullyReceived) {
      await prisma.purchaseOrder.update({
        where: { id: b.poId },
        data: { status: 'RECEIVED' },
      });
    } else if (anyPartialReceived) {
      await prisma.purchaseOrder.update({
        where: { id: b.poId },
        data: { status: 'PARTIAL_RECEIVED' },
      });
    }

    res.status(201).json(grn);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/quality — update quality status
router.put('/:id/quality', async (req: Request, res: Response) => {
  try {
    const { qualityStatus, qualityRemarks, inspectedBy } = req.body;
    const grn = await prisma.goodsReceipt.update({
      where: { id: req.params.id },
      data: {
        qualityStatus,
        qualityRemarks,
        inspectedBy,
      },
      include: { lines: true },
    });
    res.json(grn);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/status — status transitions
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { newStatus } = req.body;
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });

    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['CONFIRMED', 'CANCELLED'],
      'CONFIRMED': [],
      'CANCELLED': [],
    };

    if (!validTransitions[grn.status] || !validTransitions[grn.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${grn.status} to ${newStatus}` });
    }

    const updated = await prisma.goodsReceipt.update({
      where: { id: req.params.id },
      data: { status: newStatus },
      include: { lines: true },
    });

    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
