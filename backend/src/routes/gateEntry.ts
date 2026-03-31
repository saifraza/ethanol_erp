import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import prisma from '../config/prisma';

const router = Router();

// GET / — list gate entries for a date
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = req.query.date as string;
  const status = req.query.status as string | undefined;

  const where: Record<string, unknown> = {};

  if (dateStr) {
    const startOfDay = new Date(dateStr);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setUTCHours(23, 59, 59, 999);
    where.date = { gte: startOfDay, lte: endOfDay };
  }

  if (status) where.status = status;

  const entries = await prisma.gateEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Enrich with GRN data for linked entries
  const grnIds = entries.map((e: any) => e.grnId).filter(Boolean);
  let grnMap: Record<string, { id: string; grnNo: number; status: string }> = {};
  if (grnIds.length > 0) {
    const grns = await prisma.goodsReceipt.findMany({
      where: { id: { in: grnIds } },
      select: { id: true, grnNo: true, status: true },
    });
    grns.forEach((g: any) => { grnMap[g.id] = g; });
  }

  const enriched = entries.map((e: any) => ({
    ...e,
    grn: e.grnId ? grnMap[e.grnId] || null : null,
  }));

  res.json(enriched);
}));

// POST / — create gate entry
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const userId = req.user?.id;

  const entry = await prisma.gateEntry.create({
    data: {
      date: b.date ? new Date(b.date) : new Date(),
      vehicleNo: b.vehicleNo || '',
      capacityTon: parseFloat(b.capacityTon) || 0,
      vendor: b.vendor || '',
      transporterName: b.transporterName || '',
      material: b.material || 'OTHER',
      direction: b.direction || 'INBOUND',
      status: b.status || 'INSIDE',
      entryTime: b.entryTime || '',
      exitTime: b.exitTime || null,
      driverMobile: b.driverMobile || '',
      rstNo: b.rstNo || '',
      remarks: b.remarks || null,
      grossWeight: b.grossWeight ? parseFloat(b.grossWeight) : null,
      netWeight: b.netWeight ? parseFloat(b.netWeight) : null,
      grnId: b.grnId || null,
      shipmentId: b.shipmentId || null,
      userId: userId || null,
    },
  });

  res.status(201).json(entry);
}));

// PUT /:id — update gate entry (status changes, dispatch details)
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.gateEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('GateEntry', req.params.id);

  const b = req.body;
  const data: Record<string, unknown> = {};

  if (b.status !== undefined) data.status = b.status;
  if (b.exitTime !== undefined) data.exitTime = b.exitTime;
  if (b.grossWeight !== undefined) data.grossWeight = parseFloat(b.grossWeight) || null;
  if (b.netWeight !== undefined) data.netWeight = parseFloat(b.netWeight) || null;
  if (b.remarks !== undefined) data.remarks = b.remarks;
  if (b.vehicleNo !== undefined) data.vehicleNo = b.vehicleNo;
  if (b.vendor !== undefined) data.vendor = b.vendor;
  if (b.transporterName !== undefined) data.transporterName = b.transporterName;
  if (b.material !== undefined) data.material = b.material;
  if (b.driverMobile !== undefined) data.driverMobile = b.driverMobile;
  if (b.rstNo !== undefined) data.rstNo = b.rstNo;
  if (b.capacityTon !== undefined) data.capacityTon = parseFloat(b.capacityTon) || 0;
  if (b.grnId !== undefined) data.grnId = b.grnId;
  if (b.shipmentId !== undefined) data.shipmentId = b.shipmentId;

  const entry = await prisma.gateEntry.update({
    where: { id: req.params.id },
    data,
  });

  res.json(entry);
}));

// DELETE /:id — delete gate entry
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.gateEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('GateEntry', req.params.id);

  await prisma.gateEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
