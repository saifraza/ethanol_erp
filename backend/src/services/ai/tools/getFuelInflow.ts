import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

export const getFuelInflow: AIFeature = {
  id: 'chat.tool.get_fuel_inflow',
  kind: 'CHAT_TOOL',
  module: 'procurement',
  title: 'Get Fuel Inflow (Coal / Husk / Briquette)',
  description: 'Total fuel (coal / husk / wood / briquette / bagasse) received via weighbridge GRNs in a date range. Use when the user asks about fuel inwards, fuel deliveries, fuel consumption from procurement, or "fuel that came". DO NOT confuse with fuel ethanol (the product) — this is boiler fuel.',
  parameters: [
    { name: 'from', type: 'date', required: true, description: 'Start date YYYY-MM-DD inclusive. Convert relative dates ("from 6th", "yesterday") to absolute IST.' },
    { name: 'to', type: 'date', required: true, description: 'End date YYYY-MM-DD inclusive. Default to today if not specified.' },
    { name: 'fuelType', type: 'string', required: false, description: 'Optional substring filter on material name: COAL / HUSK / WOOD / BRIQUETTE / BAGASSE. Omit to include all fuel types.' },
  ],
  examplePrompt: 'How much coal came in last week?',
  async execute(args) {
    const from = new Date(String(args.from));
    const to = new Date(String(args.to) + 'T23:59:59.999Z');
    const fuelType = args.fuelType ? String(args.fuelType).toUpperCase() : null;

    const grns = await prisma.goodsReceipt.findMany({
      where: {
        grnDate: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
        po: { poType: 'FUEL' },
      },
      select: {
        id: true, grnNo: true, grnDate: true, netWeight: true, totalQty: true,
        vendor: { select: { name: true } },
        lines: { select: { description: true, receivedQty: true, unit: true, material: { select: { name: true, category: true, unit: true } } } },
      },
      take: 500,
      orderBy: { grnDate: 'desc' },
    });

    const filtered = fuelType
      ? grns.filter(g => g.lines.some(l => (l.material?.name || l.description || '').toUpperCase().includes(fuelType)))
      : grns;

    const byMaterial: Record<string, { material: string; grnCount: number; totalNetMT: number }> = {};
    for (const g of filtered) {
      const matName = g.lines[0]?.material?.name || g.lines[0]?.description || 'UNKNOWN';
      if (!byMaterial[matName]) byMaterial[matName] = { material: matName, grnCount: 0, totalNetMT: 0 };
      byMaterial[matName].grnCount++;
      byMaterial[matName].totalNetMT += g.netWeight || 0;
    }

    const totalNetMT = filtered.reduce((s, g) => s + (g.netWeight || 0), 0);

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      fuelTypeFilter: fuelType,
      grnCount: filtered.length,
      totalNetMT: Math.round(totalNetMT * 100) / 100,
      totalNetKg: Math.round(totalNetMT * 1000),
      byMaterial: Object.values(byMaterial).map(m => ({ ...m, totalNetMT: Math.round(m.totalNetMT * 100) / 100 })),
      sampleGRNs: filtered.slice(0, 5).map(g => ({
        grnNo: `GRN-${g.grnNo}`,
        date: g.grnDate.toISOString().slice(0, 10),
        vendor: g.vendor?.name,
        material: g.lines[0]?.material?.name || g.lines[0]?.description,
        netMT: Math.round((g.netWeight || 0) * 100) / 100,
      })),
    };
  },
};
