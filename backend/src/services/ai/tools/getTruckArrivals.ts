import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

export const getTruckArrivals: AIFeature = {
  id: 'chat.tool.get_truck_arrivals',
  kind: 'CHAT_TOOL',
  module: 'weighbridge',
  title: 'Get Truck Arrivals (Weighbridge Tickets)',
  description: 'Count and list trucks that came to the weighbridge in a date range. Use this whenever the user asks about TRUCKS, vehicles, weighments, gate entries, or how many vehicles came in. Filter by material (rice husk, broken rice, maize, coal, etc.), vendor, or division. This is the right tool for "how many trucks of X came" questions.',
  parameters: [
    { name: 'from', type: 'date', required: true, description: 'Start date YYYY-MM-DD inclusive (IST). Convert relative dates: "5th to 9th this month" -> from=YYYY-MM-05 to=YYYY-MM-09 using current month.' },
    { name: 'to', type: 'date', required: true, description: 'End date YYYY-MM-DD inclusive (IST). Default to today if user said "till now".' },
    { name: 'material', type: 'string', required: false, description: 'Optional substring filter on material/category. Common values: RICE_HUSK, RICE HUSK, BROKEN_RICE, BROKEN RICE, MAIZE, COAL, HUSK, BRIQUETTE, WOOD, BAGASSE, DDGS. Case-insensitive substring match — pass what the user said verbatim and it will match.' },
    { name: 'vendor', type: 'string', required: false, description: 'Optional vendor name fuzzy match' },
    { name: 'division', type: 'string', required: false, description: 'Optional division: SUGAR, POWER, ETHANOL, COMMON' },
  ],
  examplePrompt: 'How many rice husk trucks came from 5th to 9th this month?',
  async execute(args) {
    const from = new Date(String(args.from));
    const to = new Date(String(args.to) + 'T23:59:59.999Z');
    const matRaw = args.material ? String(args.material).toUpperCase().trim() : null;
    const vendorRaw = args.vendor ? String(args.vendor).trim() : null;
    const divRaw = args.division ? String(args.division).toUpperCase().trim() : null;

    const where: any = {
      date: { gte: from, lte: to },
      cancelled: false,
    };
    if (matRaw) {
      // Match against materialType OR supplier name OR linked PO/material name
      where.OR = [
        { materialType: { contains: matRaw.replace(' ', '_'), mode: 'insensitive' } },
        { materialType: { contains: matRaw, mode: 'insensitive' } },
        { supplier: { contains: matRaw, mode: 'insensitive' } },
      ];
    }
    if (vendorRaw) {
      const vendorClause = { supplier: { contains: vendorRaw, mode: 'insensitive' as const } };
      where.AND = where.AND ? [...where.AND, vendorClause] : [vendorClause];
    }
    if (divRaw) {
      const goodsReceipt = { is: { division: divRaw } };
      where.AND = where.AND ? [...where.AND, { goodsReceipt }] : [{ goodsReceipt }];
    }

    const trucks = await prisma.grainTruck.findMany({
      where,
      select: {
        id: true, date: true, ticketNo: true, vehicleNo: true, supplier: true, materialType: true,
        weightGross: true, weightTare: true, weightNet: true, quarantineWeight: true,
        moisture: true, starchPercent: true, damagedPercent: true,
        purchaseOrder: { select: { poNo: true } },
        goodsReceipt: { select: { grnNo: true, division: true } },
      },
      orderBy: { date: 'desc' },
      take: 1000,
    });

    // Group by material
    const byMaterial: Record<string, { material: string; count: number; totalNetMT: number; totalGrossMT: number }> = {};
    for (const t of trucks) {
      const key = (t.materialType || 'UNKNOWN').toUpperCase();
      if (!byMaterial[key]) byMaterial[key] = { material: key, count: 0, totalNetMT: 0, totalGrossMT: 0 };
      byMaterial[key].count++;
      byMaterial[key].totalNetMT += (t.weightNet || 0) / 1000;
      byMaterial[key].totalGrossMT += (t.weightGross || 0) / 1000;
    }

    // Group by vendor (supplier)
    const byVendor: Record<string, { vendor: string; count: number; totalNetMT: number }> = {};
    for (const t of trucks) {
      const key = t.supplier || 'UNKNOWN';
      if (!byVendor[key]) byVendor[key] = { vendor: key, count: 0, totalNetMT: 0 };
      byVendor[key].count++;
      byVendor[key].totalNetMT += (t.weightNet || 0) / 1000;
    }

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      filters: { material: matRaw, vendor: vendorRaw, division: divRaw },
      summary: {
        truck_count: trucks.length,
        total_net_MT: Math.round(trucks.reduce((s, t) => s + (t.weightNet || 0) / 1000, 0) * 100) / 100,
        total_gross_MT: Math.round(trucks.reduce((s, t) => s + (t.weightGross || 0) / 1000, 0) * 100) / 100,
        avg_load_MT: trucks.length > 0 ? Math.round((trucks.reduce((s, t) => s + (t.weightNet || 0) / 1000, 0) / trucks.length) * 100) / 100 : 0,
      },
      by_material: Object.values(byMaterial).sort((a, b) => b.count - a.count).map(m => ({ ...m, totalNetMT: Math.round(m.totalNetMT * 100) / 100, totalGrossMT: Math.round(m.totalGrossMT * 100) / 100 })),
      by_vendor: Object.values(byVendor).sort((a, b) => b.count - a.count).slice(0, 20).map(v => ({ ...v, totalNetMT: Math.round(v.totalNetMT * 100) / 100 })),
      rows: trucks.slice(0, 100).map(t => ({
        ticket_no: t.ticketNo || '',
        date: t.date.toISOString().slice(0, 10),
        vehicle_no: t.vehicleNo,
        supplier: t.supplier,
        material: t.materialType || '',
        po_no: t.purchaseOrder?.poNo || '',
        grn_no: t.goodsReceipt?.grnNo || '',
        gross_MT: Math.round((t.weightGross || 0) / 1000 * 100) / 100,
        tare_MT: Math.round((t.weightTare || 0) / 1000 * 100) / 100,
        net_MT: Math.round((t.weightNet || 0) / 1000 * 100) / 100,
        quarantine_MT: Math.round((t.quarantineWeight || 0) / 1000 * 100) / 100,
        moisture_pct: t.moisture,
        starch_pct: t.starchPercent,
      })),
    };
  },
};
