import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest, authenticate, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import { prisma, checkWBKey, syncToInventory } from './shared';
import { getLatestHeartbeat as getOPCHeartbeat } from '../opcBridge';

// ==========================================================================
//  PC HEARTBEAT TRACKING (in-memory)
// ==========================================================================

interface PCHeartbeat {
  pcId: string;
  pcName: string;
  timestamp: string;
  receivedAt: string;
  uptimeSeconds?: number;
  queueDepth?: number;
  dbSizeMb?: number;
  serialConnected?: boolean;
  serialProtocol?: string;
  webPort?: number;
  tailscaleIp?: string;
  localUrl?: string;
  weightsToday?: number;
  lastTicket?: number;
  version?: string;
  system?: {
    cpuPercent?: number;
    memoryMb?: number;
    diskFreeGb?: number;
    hostname?: string;
    os?: string;
  };
}

const pcHeartbeats = new Map<string, PCHeartbeat>();

// ==========================================================================
//  PUT /weighment/:wbId — update a previously pushed weighment
// ==========================================================================

const updateWeighmentSchema = z.object({
  vehicle_no: z.string().optional(),
  supplier_name: z.string().optional(),
  material: z.string().optional(),
  weight_first: z.number().nullable().optional(),
  weight_second: z.number().nullable().optional(),
  weight_gross: z.number().nullable().optional(),
  weight_tare: z.number().nullable().optional(),
  weight_net: z.number().nullable().optional(),
  weight_source: z.string().optional(),
  status: z.string().optional(),
  moisture: z.number().nullable().optional(),
  bags: z.number().nullable().optional(),
  remarks: z.string().nullable().optional(),
  first_weight_at: z.string().nullable().optional(),
  second_weight_at: z.string().nullable().optional(),
  lab_status: z.string().optional(),
  lab_moisture: z.number().nullable().optional(),
  lab_starch: z.number().nullable().optional(),
  lab_damaged: z.number().nullable().optional(),
  lab_foreign_matter: z.number().nullable().optional(),
  lab_remarks: z.string().nullable().optional(),
  rate: z.number().nullable().optional(),
  deductions: z.number().nullable().optional(),
  deduction_reason: z.string().nullable().optional(),
  seller_phone: z.string().nullable().optional(),
  seller_village: z.string().nullable().optional(),
  seller_aadhaar: z.string().nullable().optional(),
  payment_mode: z.string().nullable().optional(),
  payment_ref: z.string().nullable().optional(),
});

// ==========================================================================
//  Factory user management proxy helpers
// ==========================================================================

const FACTORY_SERVER_URL = process.env.FACTORY_SERVER_URL || 'http://100.126.101.7:5000';
const FACTORY_ADMIN_USER = process.env.FACTORY_ADMIN_USER || 'admin';
const FACTORY_ADMIN_PASS = process.env.FACTORY_ADMIN_PASS;
let _factoryToken: string | null = null;
let _factoryTokenExpiry = 0;

async function getFactoryAdminToken(): Promise<string | null> {
  if (!FACTORY_ADMIN_PASS) return null;
  if (_factoryToken && Date.now() < _factoryTokenExpiry) return _factoryToken;
  try {
    const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: FACTORY_ADMIN_USER, password: FACTORY_ADMIN_PASS }),
    });
    if (resp.ok) {
      const data = await resp.json() as { token: string };
      _factoryToken = data.token;
      _factoryTokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
      return _factoryToken;
    }
  } catch { /* factory server unreachable */ }
  return null;
}

// ==========================================================================
//  REGISTER ROUTES
// ==========================================================================

export function registerOtherRoutes(router: Router): void {

  // ── PUT /weighment/:wbId — update a previously pushed weighment ──
  router.put('/weighment/:wbId', asyncHandler(async (req: Request, res: Response) => {
    if (!checkWBKey(req, res)) return;

    const { wbId } = req.params;
    const updates = updateWeighmentSchema.parse(req.body);
    const wbMarker = `WB:${wbId}`;

    const [grainTruck, directPurchase, ddgsDispatch, goodsReceipt] = await Promise.all([
      prisma.grainTruck.findFirst({
        where: { remarks: { contains: wbMarker } },
        select: { id: true, remarks: true, weightNet: true },
      }),
      prisma.directPurchase.findFirst({
        where: { remarks: { contains: wbMarker } },
        select: { id: true, remarks: true },
      }),
      prisma.dDGSDispatchTruck.findFirst({
        where: { remarks: { contains: wbMarker } },
        select: { id: true, remarks: true },
      }),
      prisma.goodsReceipt.findFirst({
        where: { remarks: { contains: wbMarker } },
        select: { id: true, remarks: true, poId: true, lines: { select: { id: true, poLineId: true, receivedQty: true, rate: true, unit: true } } },
      }),
    ]);

    if (!grainTruck && !directPurchase && !ddgsDispatch && !goodsReceipt) {
      return res.status(404).json({ error: `No cloud record found for weighment ${wbId}` });
    }

    const results: Array<{ table: string; id: string; updated: boolean }> = [];

    // ── Update GrainTruck ──
    if (grainTruck) {
      const grossTon = updates.weight_gross != null ? updates.weight_gross / 1000 : undefined;
      const tareTon = updates.weight_tare != null ? updates.weight_tare / 1000 : undefined;
      const netTon = updates.weight_net != null ? updates.weight_net / 1000 : undefined;
      const isQuarantine = updates.lab_status === 'FAIL';

      await prisma.grainTruck.update({
        where: { id: grainTruck.id },
        data: {
          ...(updates.vehicle_no && { vehicleNo: updates.vehicle_no }),
          ...(updates.supplier_name && { supplier: updates.supplier_name }),
          ...(grossTon !== undefined && { weightGross: grossTon }),
          ...(tareTon !== undefined && { weightTare: tareTon }),
          ...(netTon !== undefined && { weightNet: netTon }),
          ...(updates.lab_moisture !== undefined
            ? { moisture: updates.lab_moisture }
            : updates.moisture !== undefined ? { moisture: updates.moisture } : {}),
          ...(updates.lab_starch !== undefined && { starchPercent: updates.lab_starch }),
          ...(updates.lab_damaged !== undefined && { damagedPercent: updates.lab_damaged }),
          ...(updates.lab_foreign_matter !== undefined && { foreignMatter: updates.lab_foreign_matter }),
          ...(updates.bags !== undefined && { bags: updates.bags }),
          // BUG-1 fix: explicitly clear quarantine fields when lab passes
          ...(updates.lab_status && {
            quarantine: isQuarantine,
            quarantineWeight: isQuarantine && netTon ? netTon : 0,
            quarantineReason: isQuarantine ? (updates.lab_remarks || 'Failed lab test') : '',
          }),
        },
      });
      results.push({ table: 'GrainTruck', id: grainTruck.id, updated: true });
    }

    // ── Update DirectPurchase ──
    if (directPurchase) {
      const netKg = updates.weight_net;
      const rate = updates.rate;
      const dpUpdate: Record<string, unknown> = {};
      if (updates.vehicle_no) dpUpdate.vehicleNo = updates.vehicle_no;
      if (updates.supplier_name) dpUpdate.sellerName = updates.supplier_name;
      if (updates.seller_phone !== undefined) dpUpdate.sellerPhone = updates.seller_phone || '';
      if (updates.seller_village !== undefined) dpUpdate.sellerVillage = updates.seller_village || '';
      if (updates.seller_aadhaar !== undefined) dpUpdate.sellerAadhaar = updates.seller_aadhaar || '';
      if (updates.material) dpUpdate.materialName = updates.material;
      if (netKg != null) {
        dpUpdate.quantity = netKg;
        dpUpdate.netWeight = netKg;
      }
      if (updates.weight_gross != null) dpUpdate.grossWeight = updates.weight_gross;
      if (updates.weight_tare != null) dpUpdate.tareWeight = updates.weight_tare;
      if (rate != null) dpUpdate.rate = rate;
      if (updates.payment_mode) dpUpdate.paymentMode = updates.payment_mode;
      if (updates.payment_ref !== undefined) dpUpdate.paymentRef = updates.payment_ref || '';
      if (updates.deductions != null) dpUpdate.deductions = updates.deductions;
      if (updates.deduction_reason !== undefined) dpUpdate.deductionReason = updates.deduction_reason || '';

      if (netKg != null || rate != null || updates.deductions != null) {
        const current = await prisma.directPurchase.findUnique({
          where: { id: directPurchase.id },
          select: { quantity: true, rate: true, deductions: true },
        });
        if (current) {
          const finalQty = netKg ?? current.quantity;
          const finalRate = rate ?? current.rate;
          const finalDeductions = updates.deductions ?? current.deductions;
          const amount = Math.round(finalQty * finalRate * 100) / 100;
          dpUpdate.amount = amount;
          dpUpdate.netPayable = Math.round((amount - finalDeductions) * 100) / 100;
        }
      }

      if (Object.keys(dpUpdate).length > 0) {
        await prisma.directPurchase.update({
          where: { id: directPurchase.id },
          data: dpUpdate,
        });
      }
      results.push({ table: 'DirectPurchase', id: directPurchase.id, updated: Object.keys(dpUpdate).length > 0 });
    }

    // ── Update DDGSDispatchTruck ──
    if (ddgsDispatch) {
      const ddgsUpdate: Record<string, unknown> = {};
      if (updates.vehicle_no) ddgsUpdate.vehicleNo = updates.vehicle_no;
      if (updates.supplier_name) ddgsUpdate.partyName = updates.supplier_name;
      if (updates.weight_gross != null) ddgsUpdate.weightGross = updates.weight_gross;
      if (updates.weight_tare != null) ddgsUpdate.weightTare = updates.weight_tare;
      if (updates.weight_net != null) ddgsUpdate.weightNet = updates.weight_net / 1000;
      if (updates.bags != null) ddgsUpdate.bags = updates.bags;

      if (Object.keys(ddgsUpdate).length > 0) {
        await prisma.dDGSDispatchTruck.update({
          where: { id: ddgsDispatch.id },
          data: ddgsUpdate,
        });
      }
      results.push({ table: 'DDGSDispatchTruck', id: ddgsDispatch.id, updated: Object.keys(ddgsUpdate).length > 0 });
    }

    // ── Update GoodsReceipt (GRN) ──
    if (goodsReceipt && goodsReceipt.lines.length > 0) {
      // MISSING-1 fix: reject if GRN has linked vendor invoice
      const linkedInvoice = await prisma.vendorInvoice.findFirst({
        where: { grnId: goodsReceipt.id },
        select: { id: true, invoiceNo: true },
      });
      if (linkedInvoice) {
        return res.status(409).json({
          error: `Cannot update weights — GRN has linked vendor invoice #${linkedInvoice.invoiceNo}. Void the invoice first.`,
        });
      }

      const line = goodsReceipt.lines[0];
      const netKg = updates.weight_net;

      if (netKg != null && line.poLineId) {
        const unit = line.unit?.toUpperCase() || 'KG';
        let newReceivedQty: number;
        switch (unit) {
          case 'MT': newReceivedQty = netKg / 1000; break;
          case 'QUINTAL': case 'QTL': newReceivedQty = netKg / 100; break;
          default: newReceivedQty = netKg; break;
        }
        const oldReceivedQty = line.receivedQty;
        const qtyDelta = newReceivedQty - oldReceivedQty;
        const rate = line.rate;
        const newAmount = Math.round(newReceivedQty * rate * 100) / 100;

        await prisma.$transaction(async (tx) => {
          await tx.gRNLine.update({
            where: { id: line.id },
            data: {
              receivedQty: newReceivedQty,
              acceptedQty: newReceivedQty,
              amount: newAmount,
              ...(updates.vehicle_no && { remarks: `Vehicle: ${updates.vehicle_no}` }),
            },
          });

          await tx.goodsReceipt.update({
            where: { id: goodsReceipt.id },
            data: {
              totalQty: newReceivedQty,
              totalAmount: newAmount,
              ...(updates.vehicle_no && { vehicleNo: updates.vehicle_no }),
            },
          });

          // RACE-3 fix: atomic increment/decrement for PO line
          if (line.poLineId && qtyDelta !== 0) {
            await tx.pOLine.update({
              where: { id: line.poLineId },
              data: {
                receivedQty: { increment: qtyDelta },
                pendingQty: { decrement: qtyDelta },
              },
            });

            // ISSUE-3 fix: only update PO status if not CLOSED/CANCELLED/INVOICED
            if (goodsReceipt.poId) {
              const po = await tx.purchaseOrder.findUnique({
                where: { id: goodsReceipt.poId },
                select: { status: true },
              });
              const frozenStatuses = ['CLOSED', 'CANCELLED', 'INVOICED'];
              if (po && !frozenStatuses.includes(po.status)) {
                const allLines = await tx.pOLine.findMany({ where: { poId: goodsReceipt.poId } });
                const allDone = allLines.every(l => l.pendingQty <= 0);
                const anyPartial = allLines.some(l => l.receivedQty > 0 && l.pendingQty > 0);
                if (allDone) {
                  await tx.purchaseOrder.update({ where: { id: goodsReceipt.poId }, data: { status: 'RECEIVED' } });
                } else if (anyPartial) {
                  await tx.purchaseOrder.update({ where: { id: goodsReceipt.poId }, data: { status: 'PARTIAL_RECEIVED' } });
                }
              }
            }
          }
        });

        const grnLine = await prisma.gRNLine.findUnique({
          where: { id: line.id },
          select: { inventoryItemId: true },
        });
        if (grnLine?.inventoryItemId && qtyDelta !== 0) {
          try {
            await syncToInventory(
              'GRN', goodsReceipt.id, `GRN-CORRECTION`,
              grnLine.inventoryItemId,
              Math.abs(qtyDelta),
              line.rate,
              qtyDelta > 0 ? 'IN' : 'OUT',
              'GRN_CORRECTION',
              `Weight correction for WB:${wbId} (delta: ${qtyDelta > 0 ? '+' : ''}${qtyDelta.toFixed(2)})`,
              'system-weighbridge',
            );
          } catch (_invErr) { /* manual reconcile */ }
        }
      }
      results.push({ table: 'GoodsReceipt', id: goodsReceipt.id, updated: netKg != null });
    }

    res.json({ ok: true, wbId, results });
  }));

  // ── POST /lab-results — pull lab status back to weighbridge PC ──
  router.post('/lab-results', asyncHandler(async (req: Request, res: Response) => {
    if (!checkWBKey(req, res)) return;

    const { weighment_ids } = req.body;
    if (!Array.isArray(weighment_ids) || weighment_ids.length === 0) {
      return res.json({ results: [] });
    }

    const results: Array<{ weighment_id: string; lab_status: string; moisture: number | null; starch: number | null; damaged: number | null; foreign_matter: number | null }> = [];

    for (const wid of weighment_ids.slice(0, 50)) {
      const truck = await prisma.grainTruck.findFirst({
        where: { remarks: { contains: `WB:${wid}` } },
        select: { moisture: true, starchPercent: true, damagedPercent: true, foreignMatter: true, quarantine: true },
      });
      if (truck && (truck.moisture !== null || truck.quarantine)) {
        results.push({
          weighment_id: wid,
          lab_status: truck.quarantine ? 'FAIL' : 'PASS',
          moisture: truck.moisture,
          starch: truck.starchPercent,
          damaged: truck.damagedPercent,
          foreign_matter: truck.foreignMatter,
        });
      }
    }

    res.json({ results });
  }));

  // ── GET /master-data — suppliers + materials + active POs + customers ──
  router.get('/master-data', asyncHandler(async (req: Request, res: Response) => {
    if (!checkWBKey(req, res)) return;

    const vendors = await prisma.vendor.findMany({
      take: 500,
      where: { isActive: true },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    });

    const recentTrucks = await prisma.grainTruck.findMany({
      where: {
        date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        supplier: { not: '' },
      },
      select: { supplier: true },
      distinct: ['supplier'],
      take: 200,
    });

    const supplierMap = new Map<string, { id: string; name: string }>();
    for (const v of vendors) {
      supplierMap.set(v.name.toLowerCase(), { id: v.id, name: v.name });
    }
    for (const t of recentTrucks) {
      if (t.supplier && !supplierMap.has(t.supplier.toLowerCase())) {
        supplierMap.set(t.supplier.toLowerCase(), { id: `truck-${t.supplier}`, name: t.supplier });
      }
    }

    const materials = await prisma.material.findMany({
      take: 500,
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    });

    const fuelItems = await prisma.inventoryItem.findMany({
      where: { category: 'FUEL', isActive: true },
      take: 100,
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    });

    const materialNames = new Set(materials.map(m => m.name.toLowerCase()));
    for (const f of fuelItems) {
      if (!materialNames.has(f.name.toLowerCase())) {
        materials.push({ id: f.id, name: f.name, category: 'FUEL' });
      }
    }

    const activePOs = await prisma.purchaseOrder.findMany({
      where: {
        status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
      },
      take: 200,
      select: {
        id: true,
        poNo: true,
        dealType: true,
        vendorId: true,
        vendor: { select: { name: true } },
        status: true,
        lines: {
          select: {
            id: true,
            inventoryItemId: true,
            description: true,
            quantity: true,
            receivedQty: true,
            pendingQty: true,
            rate: true,
            unit: true,
          },
        },
      },
      orderBy: { poNo: 'desc' },
    });

    const pos = activePOs.map(po => ({
      id: po.id,
      po_no: po.poNo,
      vendor_id: po.vendorId,
      vendor_name: po.vendor.name,
      deal_type: po.dealType || 'STANDARD',
      status: po.status,
      lines: po.lines.map(l => ({
        id: l.id,
        inventory_item_id: l.inventoryItemId,
        description: l.description,
        quantity: l.quantity,
        received_qty: l.receivedQty,
        pending_qty: l.pendingQty,
        rate: l.rate,
        unit: l.unit,
      })),
    }));

    const customers = await prisma.customer.findMany({
      where: { isActive: true },
      take: 200,
      select: { id: true, name: true, shortName: true },
      orderBy: { name: 'asc' },
    });

    const recentVehicles = await prisma.grainTruck.findMany({
      where: { date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      select: { vehicleNo: true },
      distinct: ['vehicleNo'],
      take: 200,
      orderBy: { date: 'desc' },
    });

    res.json({
      suppliers: Array.from(supplierMap.values()),
      materials: materials.map(m => ({ id: m.id, name: m.name, category: m.category })),
      pos,
      customers: customers.map(c => ({ id: c.id, name: c.name, short_name: c.shortName })),
      vehicles: recentVehicles.map(v => v.vehicleNo),
    });
  }));

  // ── POST /admin/recover-ethanol — TEMP one-off: fix stuck ethanol DispatchTrucks
  // and capture root-cause exception. Protected by WB key. Remove after use.
  router.post('/admin/recover-ethanol', asyncHandler(async (req: Request, res: Response) => {
    if (!checkWBKey(req, res)) return;
    const items: Array<{
      vehicleNo: string;
      grossKg: number;
      tareKg: number;
      sourceWbId: string;
      createdAt: string;
    }> = req.body.items || [];

    const results: any[] = [];

    for (const it of items) {
      const result: any = { vehicleNo: it.vehicleNo, sourceWbId: it.sourceWbId };
      try {
        const todayStart = new Date(it.createdAt);
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(it.createdAt);
        todayEnd.setUTCHours(23, 59, 59, 999);

        // Find candidate trucks: vehicleNo + same day + not RELEASED
        const candidates = await prisma.dispatchTruck.findMany({
          where: {
            vehicleNo: it.vehicleNo.toUpperCase(),
            date: { gte: todayStart, lte: todayEnd },
            status: { in: ['GATE_IN', 'TARE_WEIGHED', 'GROSS_WEIGHED'] },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, sourceWbId: true, weightGross: true, weightTare: true, contractId: true, quantityBL: true },
        });

        result.candidates = candidates.map(c => ({ id: c.id, status: c.status, sourceWbId: c.sourceWbId, gross: c.weightGross, tare: c.weightTare }));

        // Pick the one matching sourceWbId, else the first GATE_IN/TARE_WEIGHED, else first GROSS_WEIGHED with no weights
        let target = candidates.find(c => c.sourceWbId === it.sourceWbId);
        if (!target) target = candidates.find(c => c.status === 'GATE_IN' || c.status === 'TARE_WEIGHED');
        if (!target) target = candidates.find(c => c.status === 'GROSS_WEIGHED' && (c.weightGross == null || c.weightGross === 0));

        if (!target) {
          result.action = 'no-target';
          results.push(result);
          continue;
        }

        // Compute KL/productValue if contract present
        const bl = it.grossKg && it.tareKg ? (target.quantityBL || 0) : 0;
        const updateData: any = {
          weightGross: it.grossKg,
          weightTare: it.tareKg,
          weightNet: it.grossKg - it.tareKg,
          status: 'GROSS_WEIGHED',
        };

        // Only set sourceWbId if currently null (avoid unique-constraint conflict)
        if (target.sourceWbId == null) {
          updateData.sourceWbId = it.sourceWbId;
        }

        await prisma.dispatchTruck.update({ where: { id: target.id }, data: updateData });
        result.action = 'updated';
        result.targetId = target.id;
        result.previousStatus = target.status;
      } catch (err) {
        result.error = err instanceof Error ? (err.stack || err.message) : String(err);
      }
      results.push(result);
    }

    res.json({ ok: true, results });
  }));

  // ── POST /heartbeat — receive PC heartbeat ──
  router.post('/heartbeat', asyncHandler(async (req: Request, res: Response) => {
    if (!checkWBKey(req, res)) return;
    const pcId = req.body.pcId || req.body.service || 'default';
    const hb: PCHeartbeat = {
      pcId,
      pcName: req.body.pcName || pcId,
      timestamp: req.body.timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      uptimeSeconds: req.body.uptimeSeconds,
      queueDepth: req.body.queueDepth,
      dbSizeMb: req.body.dbSizeMb,
      serialConnected: req.body.serialConnected,
      serialProtocol: req.body.serialProtocol,
      webPort: req.body.webPort,
      tailscaleIp: req.body.tailscaleIp,
      localUrl: req.body.localUrl,
      weightsToday: req.body.weightsToday,
      lastTicket: req.body.lastTicket,
      version: req.body.version,
      system: req.body.system,
    };
    pcHeartbeats.set(pcId, hb);
    res.json({ ok: true });
  }));

  // ── GET /heartbeat — single PC (backward compat) ──
  router.get('/heartbeat', asyncHandler(async (_req: AuthRequest, res: Response) => {
    const allPCs = Array.from(pcHeartbeats.values());
    if (allPCs.length === 0) {
      return res.json({ connected: false, message: 'No heartbeat received yet' });
    }
    const hb = allPCs[0];
    const receivedAt = new Date(hb.receivedAt).getTime();
    const staleMs = 5 * 60 * 1000;
    const isAlive = Date.now() - receivedAt < staleMs;
    res.json({ connected: isAlive, lastHeartbeat: hb, staleAfterMs: staleMs });
  }));

  // ── GET /system-status — all PCs status (for admin page) ──
  router.get('/system-status', asyncHandler(async (_req: AuthRequest, res: Response) => {
    const staleMs = 5 * 60 * 1000;
    const now = Date.now();

    const pcs = Array.from(pcHeartbeats.values()).map(hb => {
      const receivedAt = new Date(hb.receivedAt).getTime();
      const isAlive = now - receivedAt < staleMs;
      const lastSeenSec = Math.round((now - receivedAt) / 1000);
      return { ...hb, isAlive, lastSeenSec };
    });

    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const [totalSynced, todaySynced] = await Promise.all([
      prisma.grainTruck.count({ where: { remarks: { startsWith: 'WB:' } } }),
      prisma.grainTruck.count({
        where: {
          remarks: { startsWith: 'WB:' },
          date: { gte: todayStart },
        },
      }),
    ]);

    // Include OPC bridge PC
    const opcHB = getOPCHeartbeat();
    if (opcHB) {
      const opcReceivedAt = new Date(opcHB.receivedAt).getTime();
      const opcAlive = now - opcReceivedAt < staleMs;
      pcs.push({
        pcId: 'opc-bridge',
        pcName: 'Lab Computer (OPC)',
        timestamp: opcHB.timestamp,
        receivedAt: opcHB.receivedAt.toISOString(),
        isAlive: opcAlive,
        lastSeenSec: Math.round((now - opcReceivedAt) / 1000),
        uptimeSeconds: opcHB.uptimeSeconds,
        queueDepth: opcHB.queueDepth,
        dbSizeMb: opcHB.dbSizeMb,
        serialConnected: opcHB.opcConnected,
        serialProtocol: 'OPC-UA',
        webPort: 8099,
        tailscaleIp: '100.74.209.72',
        version: opcHB.version,
        system: opcHB.system ? {
          cpuPercent: opcHB.system.cpuPercent,
          memoryMb: opcHB.system.memoryMb,
          diskFreeGb: opcHB.system.diskFreeGb,
          hostname: undefined,
          os: undefined,
        } : undefined,
      } as unknown as typeof pcs[0]);
    }

    res.json({
      pcs,
      totalPCs: pcs.length,
      alivePCs: pcs.filter(p => p.isAlive).length,
      totalSynced,
      todaySynced,
    });
  }));

  // ── GET /weighments — view synced weighments (for ERP web UI) ──
  router.get('/weighments', asyncHandler(async (req: AuthRequest, res: Response) => {
    const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const skip = parseInt(req.query.offset as string) || 0;
    const date = req.query.date as string;

    const where: Record<string, unknown> = {};
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      where.date = { gte: start, lt: end };
    }
    where.remarks = { contains: 'WB:' };

    const trucks = await prisma.grainTruck.findMany({
      take, skip, where,
      orderBy: { date: 'desc' },
      select: {
        id: true, date: true, vehicleNo: true, supplier: true,
        weightGross: true, weightTare: true, weightNet: true,
        bags: true, remarks: true, createdAt: true,
      },
    });

    res.json(trucks);
  }));

  // ── Factory user management proxy ──
  router.get('/factory-users', authenticate, authorize('ADMIN'), asyncHandler(async (_req: AuthRequest, res: Response) => {
    try {
      const token = await getFactoryAdminToken();
      if (!token) { res.json([]); return; }
      const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/users`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (resp.ok) { res.json(await resp.json()); }
      else { res.json([]); }
    } catch { res.json([]); }
  }));

  router.post('/factory-users', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const token = await getFactoryAdminToken();
      if (!token) { res.status(503).json({ error: 'Factory server unreachable' }); return; }
      const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch { res.status(503).json({ error: 'Factory server unreachable' }); }
  }));

  router.put('/factory-users/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const token = await getFactoryAdminToken();
      if (!token) { res.status(503).json({ error: 'Factory server unreachable' }); return; }
      const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/users/${req.params.id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch { res.status(503).json({ error: 'Factory server unreachable' }); }
  }));

  router.put('/factory-users/:id/password', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const token = await getFactoryAdminToken();
      if (!token) { res.status(503).json({ error: 'Factory server unreachable' }); return; }
      const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/users/${req.params.id}/password`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch { res.status(503).json({ error: 'Factory server unreachable' }); }
  }));
}
