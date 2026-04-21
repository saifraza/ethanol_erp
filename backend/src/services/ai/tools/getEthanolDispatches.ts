import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

export const getEthanolDispatches: AIFeature = {
  id: 'chat.tool.get_ethanol_dispatches',
  kind: 'CHAT_TOOL',
  module: 'sales',
  title: 'Get Ethanol Dispatches (Outgoing Tankers)',
  description: 'Count and list ETHANOL tankers/trucks DISPATCHED FROM the plant (outgoing sales). Use this for any question about ethanol trucks, ethanol dispatches, ethanol tankers, ethanol lifting, ethanol deliveries TO customers/OMCs. Filter by date, buyer/OMC, vehicle, or status. This is OUTGOING — for incoming grain trucks use get_truck_arrivals instead.',
  parameters: [
    { name: 'from', type: 'date', required: true, description: 'Start date YYYY-MM-DD inclusive IST. Convert relative dates ("today", "yesterday", "this week") to absolute.' },
    { name: 'to', type: 'date', required: true, description: 'End date YYYY-MM-DD inclusive IST.' },
    { name: 'buyer', type: 'string', required: false, description: 'Optional buyer / OMC name fuzzy match (e.g. "HPCL", "IOCL", "BPCL", "Mash Biotech")' },
    { name: 'vehicleNo', type: 'string', required: false, description: 'Optional exact or partial vehicle number' },
    { name: 'status', type: 'string', required: false, description: 'Optional: LOADED, IN_TRANSIT, DELIVERED, SHORTAGE' },
  ],
  examplePrompt: 'How many ethanol trucks went out today?',
  async execute(args) {
    const from = new Date(String(args.from));
    const to = new Date(String(args.to) + 'T23:59:59.999Z');

    const where: any = { liftingDate: { gte: from, lte: to } };
    if (args.buyer) {
      const b = String(args.buyer);
      where.contract = {
        OR: [
          { buyerName: { contains: b, mode: 'insensitive' } },
          { omcName: { contains: b, mode: 'insensitive' } },
          { principalName: { contains: b, mode: 'insensitive' } },
        ],
      };
    }
    if (args.vehicleNo) where.vehicleNo = { contains: String(args.vehicleNo), mode: 'insensitive' };
    if (args.status) where.status = String(args.status).toUpperCase();

    const liftings = await prisma.ethanolLifting.findMany({
      where,
      select: {
        id: true, liftingDate: true, vehicleNo: true, driverName: true, transporterName: true,
        destination: true, quantityBL: true, quantityKL: true, strength: true,
        rate: true, amount: true, status: true,
        invoiceNo: true, invoiceDate: true,
        rstNo: true, challanNo: true, dispatchMode: true, productValue: true,
        contract: { select: { contractNo: true, contractType: true, buyerName: true, omcName: true, principalName: true } },
      },
      orderBy: { liftingDate: 'desc' },
      take: 1000,
    });

    const byBuyer: Record<string, { buyer: string; count: number; totalKL: number; totalValue: number }> = {};
    for (const l of liftings) {
      const buyer = l.contract?.omcName || l.contract?.buyerName || 'Unknown';
      if (!byBuyer[buyer]) byBuyer[buyer] = { buyer, count: 0, totalKL: 0, totalValue: 0 };
      byBuyer[buyer].count++;
      byBuyer[buyer].totalKL += l.quantityKL || 0;
      byBuyer[buyer].totalValue += l.amount || 0;
    }

    const byStatus: Record<string, number> = {};
    for (const l of liftings) byStatus[l.status] = (byStatus[l.status] || 0) + 1;

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      filters: { buyer: args.buyer || null, vehicleNo: args.vehicleNo || null, status: args.status || null },
      summary: {
        truck_count: liftings.length,
        total_KL: Math.round(liftings.reduce((s, l) => s + (l.quantityKL || 0), 0) * 100) / 100,
        total_BL: Math.round(liftings.reduce((s, l) => s + (l.quantityBL || 0), 0)),
        total_invoice_value: Math.round(liftings.reduce((s, l) => s + (l.amount || 0), 0)),
        avg_load_KL: liftings.length > 0 ? Math.round((liftings.reduce((s, l) => s + (l.quantityKL || 0), 0) / liftings.length) * 100) / 100 : 0,
      },
      by_buyer: Object.values(byBuyer).sort((a, b) => b.count - a.count).map(b => ({ ...b, totalKL: Math.round(b.totalKL * 100) / 100, totalValue: Math.round(b.totalValue) })),
      by_status: byStatus,
      rows: liftings.slice(0, 100).map(l => ({
        date: l.liftingDate.toISOString().slice(0, 10),
        contract_no: l.contract?.contractNo || '',
        buyer: l.contract?.omcName || l.contract?.buyerName || '',
        vehicle_no: l.vehicleNo,
        driver: l.driverName || '',
        transporter: l.transporterName || '',
        destination: l.destination || '',
        quantity_KL: Math.round((l.quantityKL || 0) * 100) / 100,
        quantity_BL: Math.round(l.quantityBL || 0),
        strength_pct: l.strength,
        rate: l.rate,
        amount: l.amount,
        invoice_no: l.invoiceNo || '',
        invoice_date: l.invoiceDate ? l.invoiceDate.toISOString().slice(0, 10) : '',
        rst_no: l.rstNo || '',
        dch_no: l.challanNo || '',
        dispatch_mode: l.dispatchMode,
        status: l.status,
      })),
    };
  },
};
