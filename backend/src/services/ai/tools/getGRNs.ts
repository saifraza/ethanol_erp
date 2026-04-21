import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

export const getGRNs: AIFeature = {
  id: 'chat.tool.get_grns',
  kind: 'CHAT_TOOL',
  module: 'procurement',
  title: 'Get Goods Receipt Notes (GRNs)',
  description: 'List GRNs (goods received) in a date range with filters by PO type, vendor, or material. Use for "what was received", "GRN list", "deliveries". For trucks/vehicles use get_truck_arrivals instead.',
  parameters: [
    { name: 'from', type: 'date', required: true, description: 'YYYY-MM-DD inclusive (IST)' },
    { name: 'to', type: 'date', required: true, description: 'YYYY-MM-DD inclusive (IST)' },
    { name: 'poType', type: 'string', required: false, description: 'Optional PO type filter: GOODS, FUEL, SERVICE, CONTRACTOR, TRANSPORT, RENT, UTILITY, OTHER' },
    { name: 'vendor', type: 'string', required: false, description: 'Optional vendor name fuzzy match' },
    { name: 'material', type: 'string', required: false, description: 'Optional material name substring (matches GRN line description or material name)' },
  ],
  examplePrompt: 'GRNs received this week',
  async execute(args) {
    const from = new Date(String(args.from));
    const to = new Date(String(args.to) + 'T23:59:59.999Z');
    const poType = args.poType ? String(args.poType).toUpperCase() : null;
    const vendor = args.vendor ? String(args.vendor) : null;
    const material = args.material ? String(args.material) : null;

    const where: any = {
      grnDate: { gte: from, lte: to },
      status: { not: 'CANCELLED' },
    };
    if (poType) where.po = { poType };
    if (vendor) where.vendor = { name: { contains: vendor, mode: 'insensitive' } };
    if (material) where.lines = { some: { OR: [{ description: { contains: material, mode: 'insensitive' } }, { material: { name: { contains: material, mode: 'insensitive' } } }] } };

    const grns = await prisma.goodsReceipt.findMany({
      where,
      select: {
        grnNo: true, grnDate: true, vehicleNo: true, status: true, division: true,
        netWeight: true, totalQty: true, totalAmount: true,
        vendor: { select: { name: true } },
        po: { select: { poNo: true, poType: true } },
        lines: { select: { description: true, receivedQty: true, unit: true, material: { select: { name: true } } } },
      },
      orderBy: { grnDate: 'desc' },
      take: 500,
    });

    const byPoType: Record<string, { poType: string; count: number; totalAmount: number }> = {};
    for (const g of grns) {
      const k = g.po?.poType || 'UNKNOWN';
      if (!byPoType[k]) byPoType[k] = { poType: k, count: 0, totalAmount: 0 };
      byPoType[k].count++;
      byPoType[k].totalAmount += g.totalAmount || 0;
    }

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      filters: { poType, vendor, material },
      summary: {
        grn_count: grns.length,
        total_amount: Math.round(grns.reduce((s, g) => s + g.totalAmount, 0)),
        total_net_MT: Math.round(grns.reduce((s, g) => s + (g.netWeight || 0), 0) * 100) / 100,
      },
      by_po_type: Object.values(byPoType).sort((a, b) => b.count - a.count),
      rows: grns.slice(0, 100).map(g => ({
        grn_no: `GRN-${g.grnNo}`,
        date: g.grnDate.toISOString().slice(0, 10),
        vendor: g.vendor?.name,
        po_type: g.po?.poType,
        po_no: g.po?.poNo ? `PO-${g.po.poNo}` : '',
        material: g.lines[0]?.material?.name || g.lines[0]?.description || '',
        vehicle: g.vehicleNo || '',
        net_MT: Math.round((g.netWeight || 0) * 100) / 100,
        amount: g.totalAmount,
        status: g.status,
        division: g.division,
      })),
    };
  },
};
