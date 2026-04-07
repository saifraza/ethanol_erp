import { prisma, WeighmentInput, PushContext, PushOutcome, emptyOutcome } from '../shared';

/**
 * INBOUND + SPOT → Auto-create DirectPurchase
 *
 * Ad-hoc farmer direct purchase. No PO, no GRN — just a DirectPurchase record
 * with seller details and rate.
 */
export async function handleSpotInbound(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();
  const netKg = w.weight_net || 0;
  const rate = w.rate || 0;
  const amount = Math.round(netKg * rate * 100) / 100;
  const deductions = w.deductions || 0;
  const netPayable = Math.round((amount - deductions) * 100) / 100;

  const dp = await prisma.directPurchase.create({
    data: {
      date: w.created_at ? new Date(w.created_at) : new Date(),
      sellerName: w.supplier_name || 'Unknown',
      sellerPhone: w.seller_phone || '',
      sellerVillage: w.seller_village || '',
      sellerAadhaar: w.seller_aadhaar || '',
      materialName: w.material || 'Grain',
      quantity: netKg,
      unit: 'KG',
      rate,
      amount,
      vehicleNo: w.vehicle_no,
      weightSlipNo: `WB-${w.ticket_no}`,
      grossWeight: w.weight_gross,
      tareWeight: w.weight_tare,
      netWeight: w.weight_net,
      paymentMode: w.payment_mode || 'CASH',
      paymentRef: w.payment_ref || '',
      deductions,
      deductionReason: w.deduction_reason || '',
      netPayable,
      remarks: `${ctx.wbRef} | Auto from weighbridge`,
      userId: 'system-weighbridge',
    },
  });

  out.results.push({ id: dp.id, type: 'DirectPurchase', refNo: `DP-${dp.entryNo}`, sourceWbId: w.id });
  out.ids.push(dp.id);
  return out;
}
