import { prisma, WeighmentInput, PushContext, PushResultEntry } from './shared';

/**
 * Pre-phase: handles gate entries and dupGrain merge BEFORE handler dispatch.
 *
 * Returns:
 *   - null: no pre-phase action, proceed to handler dispatch
 *   - { ids, results, shortCircuit: true }: handled completely, skip handler
 *   - { ids, results, shortCircuit: false }: ids/results captured, but
 *     fall through to handler (e.g., dupGrain stub needs PO/SPOT/TRADER work)
 */
export interface PrePhaseResult {
  ids: string[];
  results: PushResultEntry[];
  shortCircuit: boolean;
}

export async function runPrePhase(w: WeighmentInput, ctx: PushContext): Promise<PrePhaseResult | null> {
  const isInbound = w.direction === 'IN';
  const isGateOrPending = w.status === 'GATE_ENTRY' || w.status === 'FIRST_DONE';

  // ── 1. Fuel gate entry: ack only, no GrainTruck ──
  if (isGateOrPending && isInbound && ctx.isFuel) {
    return {
      ids: [w.id],
      results: [{ id: w.id, type: 'FUEL_GATE', refNo: `FUEL-${w.vehicle_no}`, sourceWbId: w.id }],
      shortCircuit: true,
    };
  }

  // ── 2. Non-fuel gate entry: create/update GrainTruck stub for lab page ──
  if (isGateOrPending && isInbound) {
    return await createOrUpdateGrainTruckStub(w, ctx);
  }

  // ── 3. COMPLETE inbound: dupGrain merge with fall-through ──
  if (w.status === 'COMPLETE' && isInbound) {
    const dupGrain = await prisma.grainTruck.findFirst({
      where: { remarks: { contains: `WB:${w.id}` } },
      select: { id: true, weightNet: true },
    });
    if (dupGrain) {
      // Update existing stub with weights (gate entry created it with 0 weights)
      if (dupGrain.weightNet === 0 || dupGrain.weightNet === null) {
        const grossTon = (w.weight_gross || 0) / 1000;
        const tareTon = (w.weight_tare || 0) / 1000;
        const netTon = (w.weight_net || 0) / 1000;
        await prisma.grainTruck.update({
          where: { id: dupGrain.id },
          data: {
            weightGross: grossTon,
            weightTare: tareTon,
            weightNet: netTon,
            moisture: w.lab_moisture ?? w.moisture ?? undefined,
            starchPercent: w.lab_starch ?? undefined,
            damagedPercent: w.lab_damaged ?? undefined,
            foreignMatter: w.lab_foreign_matter ?? undefined,
            quarantine: w.lab_status === 'FAIL' ? true : w.lab_status === 'PASS' ? false : undefined,
            quarantineWeight: w.lab_status === 'FAIL' ? netTon : w.lab_status === 'PASS' ? 0 : undefined,
            quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : w.lab_status === 'PASS' ? '' : undefined,
            remarks: `WB:${w.id} | Ticket #${w.ticket_no} | COMPLETE | ${w.remarks || ''}`.trim(),
          },
        });
      }

      // NF-1 FIX: Only short-circuit if there's no PO/SPOT/TRADER work to do.
      // Otherwise the stub gets reported but downstream handler still runs.
      const hasPOWork = w.po_id && (ctx.purchaseType === 'PO' || ctx.purchaseType === 'JOB_WORK');
      const hasSPOTWork = ctx.purchaseType === 'SPOT';
      const hasTRADERWork = ctx.purchaseType === 'TRADER' && w.supplier_id;
      const shortCircuit = !hasPOWork && !hasSPOTWork && !hasTRADERWork;

      return {
        ids: [dupGrain.id],
        results: [{ id: dupGrain.id, type: 'GrainTruck', refNo: `UPDATED-${dupGrain.id.slice(0, 8)}`, sourceWbId: w.id }],
        shortCircuit,
      };
    }
  }

  return null;
}

async function createOrUpdateGrainTruckStub(w: WeighmentInput, _ctx: PushContext): Promise<PrePhaseResult> {
  const dupGrain = await prisma.grainTruck.findFirst({
    where: { remarks: { contains: `WB:${w.id}` } },
    select: { id: true },
  });

  if (!dupGrain) {
    const grossTon = (w.weight_gross || 0) / 1000;
    const tareTon = (w.weight_tare || 0) / 1000;
    const netTon = (w.weight_net || 0) / 1000;
    const truck = await prisma.grainTruck.create({
      data: {
        date: w.created_at ? new Date(w.created_at) : new Date(),
        uidRst: _ctx.wbUidRst,
        vehicleNo: w.vehicle_no,
        supplier: w.supplier_name || '',
        weightGross: grossTon,
        weightTare: tareTon,
        weightNet: netTon,
        moisture: w.lab_moisture ?? undefined,
        starchPercent: w.lab_starch ?? undefined,
        damagedPercent: w.lab_damaged ?? undefined,
        foreignMatter: w.lab_foreign_matter ?? undefined,
        quarantine: w.lab_status === 'FAIL' ? true : w.lab_status === 'PASS' ? false : undefined,
        quarantineWeight: w.lab_status === 'FAIL' ? netTon : w.lab_status === 'PASS' ? 0 : undefined,
        quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : w.lab_status === 'PASS' ? '' : undefined,
        bags: w.bags || undefined,
        remarks: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.status} | ${w.remarks || ''}`.trim(),
        vehicleType: w.vehicle_type || undefined,
        driverName: w.driver_name || undefined,
        driverMobile: w.driver_mobile || undefined,
        transporterName: w.transporter || undefined,
        materialType: w.material || undefined,
        ticketNo: w.ticket_no || undefined,
      },
    });
    return {
      ids: [truck.id],
      results: [{ id: truck.id, type: 'GrainTruck', refNo: `PENDING-${truck.id.slice(0, 8)}`, sourceWbId: w.id }],
      shortCircuit: true,
    };
  }

  // Update existing stub with latest data (lab result, weights)
  await prisma.grainTruck.update({
    where: { id: dupGrain.id },
    data: {
      weightGross: (w.weight_gross || 0) / 1000 || undefined,
      weightTare: (w.weight_tare || 0) / 1000 || undefined,
      weightNet: (w.weight_net || 0) / 1000 || undefined,
      moisture: w.lab_moisture ?? undefined,
      starchPercent: w.lab_starch ?? undefined,
      damagedPercent: w.lab_damaged ?? undefined,
      foreignMatter: w.lab_foreign_matter ?? undefined,
      quarantine: w.lab_status === 'FAIL' ? true : w.lab_status === 'PASS' ? false : undefined,
      quarantineWeight: w.lab_status === 'FAIL' ? (w.weight_net || 0) / 1000 : w.lab_status === 'PASS' ? 0 : undefined,
      quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : w.lab_status === 'PASS' ? '' : undefined,
      remarks: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.status} | ${w.remarks || ''}`.trim(),
      vehicleType: w.vehicle_type || undefined,
      driverName: w.driver_name || undefined,
      driverMobile: w.driver_mobile || undefined,
      transporterName: w.transporter || undefined,
      materialType: w.material || undefined,
      ticketNo: w.ticket_no || undefined,
      supplier: w.supplier_name || undefined,
    },
  });
  return {
    ids: [dupGrain.id],
    results: [{ id: dupGrain.id, type: 'GrainTruck', refNo: `UPDATED-${dupGrain.id.slice(0, 8)}`, sourceWbId: w.id }],
    shortCircuit: true,
  };
}
