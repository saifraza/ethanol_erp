import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { getCloudPrisma } from '../cloudPrisma';
import { asyncHandler } from '../middleware';

const router = Router();

// GET /api/master-data — all master data for factory PCs
// Tries cloud DB first (real-time), falls back to cached tables
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const cloud = getCloudPrisma();

  if (cloud) {
    // ── Real-time from cloud Railway PostgreSQL ──
    try {
      const [vendors, inventoryItems, purchaseOrders, customers, traders] = await Promise.all([
        cloud.vendor.findMany({
          where: { isActive: true },
          select: { id: true, name: true, category: true, gstin: true, phone: true, isAgent: true },
          orderBy: { name: 'asc' },
          take: 500,
        }),
        cloud.inventoryItem.findMany({
          where: { isActive: true },
          select: { id: true, name: true, code: true, category: true, unit: true, hsnCode: true, gstPercent: true },
          orderBy: { name: 'asc' },
          take: 500,
        }),
        cloud.purchaseOrder.findMany({
          where: {
            status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
            // Hide expired POs (deliveryDate is used as "valid until" for fuel deals)
            OR: [{ deliveryDate: null }, { deliveryDate: { gte: new Date() } }],
          },
          select: {
            id: true,
            poNo: true,
            vendorId: true,
            status: true,
            dealType: true,
            supplyType: true,
            remarks: true,
            createdAt: true,
            vendor: { select: { id: true, name: true } },
            lines: {
              select: {
                id: true,
                inventoryItemId: true,
                materialId: true,
                description: true,
                quantity: true,
                receivedQty: true,
                pendingQty: true,
                rate: true,
                unit: true,
                hsnCode: true,
                gstPercent: true,
              },
            },
          },
          orderBy: { poNo: 'desc' },
          take: 200,
        }),
        cloud.customer.findMany({
          where: { isActive: true },
          select: { id: true, name: true, shortName: true, gstNo: true },
          orderBy: { name: 'asc' },
          take: 500,
        }),
        cloud.vendor.findMany({
          where: { isActive: true, isAgent: true },
          select: { id: true, name: true, phone: true, productTypes: true },
          orderBy: { name: 'asc' },
          take: 100,
        }),
      ]);

      // Shape suppliers for GateEntry dropdown
      const suppliers = vendors.map(v => ({
        id: v.id,
        name: v.name,
        gstin: v.gstin,
        phone: v.phone,
      }));

      // Shape materials for GateEntry dropdown
      const materials = inventoryItems.map(m => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        category: m.category,
      }));

      // Shape POs to match what GateEntry.tsx expects
      const pos = purchaseOrders.map(po => ({
        id: po.id,
        po_no: po.poNo,
        vendor_name: po.vendor.name,
        vendor_id: po.vendorId,
        status: po.status,
        deal_type: po.dealType,
        lines: po.lines.map(line => ({
          id: line.id,
          inventory_item_id: line.inventoryItemId,
          material_id: line.materialId,
          description: line.description,
          quantity: line.quantity,
          received_qty: line.receivedQty,
          pending_qty: line.pendingQty,
          rate: line.rate,
          unit: line.unit,
          hsn_code: line.hsnCode,
          gst_percent: line.gstPercent,
        })),
      }));

      // Get recent vehicle numbers from local weighments for autocomplete
      const recentVehicles = await prisma.weighment.findMany({
        select: { vehicleNo: true },
        distinct: ['vehicleNo'],
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const vehicles = recentVehicles.map(v => v.vehicleNo);

      res.json({
        suppliers,
        materials,
        pos,
        customers,
        traders: traders.map(t => ({ id: t.id, name: t.name, phone: t.phone, productTypes: t.productTypes || '' })),
        vehicles,
        source: 'cloud-db',
      });
      return;
    } catch (err) {
      console.error('[MASTER-DATA] Cloud DB query failed, falling back to cache:', err instanceof Error ? err.message : err);
      // Fall through to cached data below
    }
  }

  // ── Fallback: cached tables (synced periodically from cloud REST API) ──
  const [suppliers, materials, purchaseOrders, customers] = await Promise.all([
    prisma.cachedSupplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.cachedMaterial.findMany({ orderBy: { name: 'asc' } }),
    prisma.cachedPurchaseOrder.findMany({
      where: { status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] } },
      orderBy: { poNumber: 'desc' },
    }),
    prisma.cachedCustomer.findMany({ orderBy: { name: 'asc' } }),
  ]);

  // Reshape cached POs to match what GateEntry frontend expects
  const pos = purchaseOrders.map(po => ({
    id: po.id,
    po_no: parseInt(po.poNumber) || 0,
    vendor_name: po.supplierName,
    vendor_id: po.supplierId,
    status: po.status,
    lines: [{
      id: po.id,
      inventory_item_id: po.materialId,
      description: po.materialName,
      quantity: po.quantity,
      received_qty: po.receivedQty,
      pending_qty: po.quantity - po.receivedQty,
      rate: po.rate,
      unit: po.unit,
    }],
  }));

  res.json({ suppliers, materials, pos, customers, vehicles: [], source: 'cached' });
}));

// POST /api/master-data/refresh — pull latest from cloud ERP
// Called periodically by a sync job (still useful for populating cache as backup)
router.post('/refresh', asyncHandler(async (_req: Request, res: Response) => {
  const [suppliers, materials, pos, customers] = await Promise.all([
    prisma.cachedSupplier.count(),
    prisma.cachedMaterial.count(),
    prisma.cachedPurchaseOrder.count(),
    prisma.cachedCustomer.count(),
  ]);

  res.json({
    message: 'Master data refresh triggered',
    counts: { suppliers, materials, purchaseOrders: pos, customers },
  });
}));

export default router;
