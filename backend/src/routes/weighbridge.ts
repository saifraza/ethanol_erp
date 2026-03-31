import { Router, Response, Request } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';
import { z } from 'zod';

const router = Router();

// API key for weighbridge Windows service to push data
const WB_PUSH_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

function checkWBKey(req: Request, res: Response): boolean {
  const key = req.headers['x-wb-key'] as string;
  if (key !== WB_PUSH_KEY) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  return true;
}

// In-memory health state (same pattern as OPC)
let lastHeartbeat: {
  timestamp: string;
  uptimeSeconds?: number;
  queueDepth?: number;
  dbSizeMb?: number;
  receivedAt: string;
} | null = null;

// ==========================================================================
//  PUSH — receive weighments from local service
// ==========================================================================

const weighmentSchema = z.object({
  id: z.string(),
  ticket_no: z.number(),
  direction: z.enum(['IN', 'OUT']),
  vehicle_no: z.string(),
  supplier_name: z.string().optional().default(''),
  material: z.string().optional().default(''),
  weight_first: z.number().nullable().optional(),
  weight_second: z.number().nullable().optional(),
  weight_gross: z.number().nullable().optional(),
  weight_tare: z.number().nullable().optional(),
  weight_net: z.number().nullable().optional(),
  weight_source: z.string().optional().default('SERIAL'),
  status: z.string().optional().default('COMPLETE'),
  moisture: z.number().nullable().optional(),
  bags: z.number().nullable().optional(),
  remarks: z.string().nullable().optional(),
  first_weight_at: z.string().nullable().optional(),
  second_weight_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

router.post('/push', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  const { weighments } = req.body;
  if (!Array.isArray(weighments) || weighments.length === 0) {
    return res.status(400).json({ error: 'No weighments provided' });
  }

  const ids: string[] = [];

  for (const raw of weighments) {
    const w = weighmentSchema.parse(raw);

    // Only sync completed weighments with valid weights
    if (w.status !== 'COMPLETE' || !w.weight_net || !w.weight_gross || !w.weight_tare) {
      continue;
    }

    if (w.direction === 'IN') {
      // INBOUND → Create GrainTruck record
      // Convert KG to Tons for GrainTruck model
      const grossTon = (w.weight_gross || 0) / 1000;
      const tareTon = (w.weight_tare || 0) / 1000;
      const netTon = (w.weight_net || 0) / 1000;

      // Check for duplicate (by local ID stored in remarks or vehicle+date)
      const existing = await prisma.grainTruck.findFirst({
        where: {
          remarks: { contains: `WB:${w.id}` },
        },
        select: { id: true },
      });

      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const truck = await prisma.grainTruck.create({
        data: {
          date: w.created_at ? new Date(w.created_at) : new Date(),
          vehicleNo: w.vehicle_no,
          supplier: w.supplier_name || '',
          weightGross: grossTon,
          weightTare: tareTon,
          weightNet: netTon,
          moisture: w.moisture || undefined,
          bags: w.bags || undefined,
          remarks: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.weight_source} | ${w.remarks || ''}`.trim(),
        },
      });
      ids.push(truck.id);

    } else {
      // OUTBOUND → Create DDGSDispatchTruck record
      // DDGS model stores in MT (metric tons)
      const grossKg = w.weight_gross || 0;
      const tareKg = w.weight_tare || 0;
      const netKg = w.weight_net || 0;
      const netMT = netKg / 1000;

      const existing = await prisma.dDGSDispatchTruck.findFirst({
        where: {
          remarks: { contains: `WB:${w.id}` },
        },
        select: { id: true },
      });

      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const dispatch = await prisma.dDGSDispatchTruck.create({
        data: {
          date: w.created_at ? new Date(w.created_at) : new Date(),
          vehicleNo: w.vehicle_no,
          partyName: w.supplier_name || '',
          weightGross: grossKg,
          weightTare: tareKg,
          weightNet: netMT,
          bags: w.bags || 0,
          status: 'GROSS_WEIGHED',
          gateInTime: w.first_weight_at ? new Date(w.first_weight_at) : new Date(),
          tareTime: w.first_weight_at ? new Date(w.first_weight_at) : undefined,
          grossTime: w.second_weight_at ? new Date(w.second_weight_at) : undefined,
          remarks: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.weight_source} | ${w.remarks || ''}`.trim(),
        },
      });
      ids.push(dispatch.id);
    }
  }

  res.json({ ok: true, ids, count: ids.length });
}));


// ==========================================================================
//  MASTER DATA — return suppliers + materials for local cache
// ==========================================================================

router.get('/master-data', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  // Suppliers: get from Vendor table + GrainTruck unique suppliers
  const vendors = await prisma.vendor.findMany({
    take: 500,
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
  });

  // Also get unique suppliers from recent grain trucks (last 90 days)
  const recentTrucks = await prisma.grainTruck.findMany({
    where: {
      date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      supplier: { not: '' },
    },
    select: { supplier: true },
    distinct: ['supplier'],
    take: 200,
  });

  // Merge: vendors as formal suppliers, truck suppliers as informal
  const supplierMap = new Map<string, { id: string; name: string }>();
  for (const v of vendors) {
    supplierMap.set(v.name.toLowerCase(), { id: v.id, name: v.name });
  }
  for (const t of recentTrucks) {
    if (t.supplier && !supplierMap.has(t.supplier.toLowerCase())) {
      supplierMap.set(t.supplier.toLowerCase(), { id: `truck-${t.supplier}`, name: t.supplier });
    }
  }

  // Materials: get from Material table
  const materials = await prisma.material.findMany({
    take: 500,
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
  });

  res.json({
    suppliers: Array.from(supplierMap.values()),
    materials: materials.map(m => ({ id: m.id, name: m.name, category: m.category })),
  });
}));


// ==========================================================================
//  HEARTBEAT — weighbridge service health check
// ==========================================================================

router.post('/heartbeat', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  lastHeartbeat = {
    ...req.body,
    receivedAt: new Date().toISOString(),
  };

  res.json({ ok: true });
}));

router.get('/heartbeat', asyncHandler(async (req: AuthRequest, res: Response) => {
  // Authenticated endpoint for the web UI to check weighbridge status
  if (!lastHeartbeat) {
    return res.json({ connected: false, message: 'No heartbeat received yet' });
  }

  const receivedAt = new Date(lastHeartbeat.receivedAt).getTime();
  const staleMs = 5 * 60 * 1000; // 5 minutes
  const isAlive = Date.now() - receivedAt < staleMs;

  res.json({
    connected: isAlive,
    lastHeartbeat,
    staleAfterMs: staleMs,
  });
}));


// ==========================================================================
//  WEIGHMENTS — view synced weighments (for ERP web UI)
// ==========================================================================

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
  // Only show weighbridge-synced trucks (have WB: in remarks)
  where.remarks = { contains: 'WB:' };

  const trucks = await prisma.grainTruck.findMany({
    take,
    skip,
    where,
    orderBy: { date: 'desc' },
    select: {
      id: true,
      date: true,
      vehicleNo: true,
      supplier: true,
      weightGross: true,
      weightTare: true,
      weightNet: true,
      bags: true,
      remarks: true,
      createdAt: true,
    },
  });

  res.json(trucks);
}));

export default router;
