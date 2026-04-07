import { prisma, WeighmentInput, PushContext, PushOutcome, emptyOutcome } from '../shared';

/**
 * INBOUND fallback → GrainTruck record only
 *
 * Last-resort handler for inbound weighments that didn't match PO/SPOT/TRADER.
 * Just creates a GrainTruck record (potentially quarantined) so the data isn't lost.
 */
export async function handleFallbackInbound(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();
  const grossTon = (w.weight_gross || 0) / 1000;
  const tareTon = (w.weight_tare || 0) / 1000;
  const netTon = (w.weight_net || 0) / 1000;
  const isQuarantine = w.lab_status === 'FAIL';
  const labInfo = w.lab_remarks ? ` | Lab: ${w.lab_remarks}` : '';

  const truck = await prisma.grainTruck.create({
    data: {
      date: w.created_at ? new Date(w.created_at) : new Date(),
      uidRst: ctx.wbUidRst,
      vehicleNo: w.vehicle_no,
      supplier: w.supplier_name || '',
      weightGross: grossTon,
      weightTare: tareTon,
      weightNet: netTon,
      moisture: w.lab_moisture ?? w.moisture ?? undefined,
      starchPercent: w.lab_starch ?? undefined,
      damagedPercent: w.lab_damaged ?? undefined,
      foreignMatter: w.lab_foreign_matter ?? undefined,
      quarantine: isQuarantine,
      quarantineWeight: isQuarantine ? netTon : 0,
      quarantineReason: isQuarantine ? `QUARANTINE — Lab FAIL${labInfo}` : undefined,
      bags: w.bags ?? undefined,
      remarks: `${ctx.wbRef} | ${isQuarantine ? 'QUARANTINE — Lab FAIL | ' : ''}${w.remarks || ''}${labInfo}`.trim(),
      vehicleType: w.vehicle_type || undefined,
      driverName: w.driver_name || undefined,
      driverMobile: w.driver_mobile || undefined,
      transporterName: w.transporter || undefined,
      materialType: w.material || undefined,
      ticketNo: w.ticket_no || undefined,
    },
  });

  out.results.push({ id: truck.id, type: isQuarantine ? 'QUARANTINE' : 'GrainTruck', refNo: truck.id, sourceWbId: w.id });
  out.ids.push(truck.id);
  return out;
}
