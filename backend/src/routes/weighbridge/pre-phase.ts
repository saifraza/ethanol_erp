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

  // ── 2b. OUTBOUND DDGS partial-state stub ──
  // Mirrors how ethanol shows in-progress trucks. At GATE_ENTRY (no weights) or
  // FIRST_DONE (tare only), upsert a DDGSDispatchTruck row keyed by sourceWbId
  // so the cloud /sales/ddgs-contracts pipeline shows it immediately. The
  // COMPLETE handler (handleDDGSOutbound) later updates weights via the same
  // unique key — no duplicate row.
  if (isGateOrPending && !isInbound && isDdgsOutbound(w, ctx)) {
    return await createOrUpdateDdgsTruckStub(w, ctx);
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

// ==========================================================================
//  OUTBOUND DDGS — partial-state stub for in-progress trucks
// ==========================================================================

/** Same DDGS detection as the dispatcher in push.ts — keep in sync. */
function isDdgsOutbound(w: WeighmentInput, ctx: PushContext): boolean {
  if (w.direction !== 'OUT') return false;
  if (ctx.materialCategory === 'DDGS') return true;
  const lower = (w.material || '').toLowerCase();
  return lower.includes('ddgs') || lower.includes('wdgs') ||
    lower.includes('distillers') || lower.includes('dried grain') ||
    lower.includes('wet grain') || lower.includes('wet distillers');
}

async function createOrUpdateDdgsTruckStub(w: WeighmentInput, ctx: PushContext): Promise<PrePhaseResult> {
  const dateVal = w.created_at ? new Date(w.created_at) : new Date();
  const gateInVal = w.first_weight_at ? new Date(w.first_weight_at) : dateVal;
  // Outbound DDGS: empty truck weighed first → that's the TARE.
  // (Inbound is the opposite — first weighing is GROSS for a loaded truck.)
  const tareKg = w.weight_tare || 0;
  const grossKg = w.weight_gross || 0;
  const tareTimeVal = w.first_weight_at ? new Date(w.first_weight_at) : undefined;
  const partyName = (w.customer_name || w.supplier_name || '').trim();
  const wbRef = `WB:${w.id} | Ticket #${w.ticket_no} | ${w.weight_source}`;

  // Contract resolution — prefer the EXPLICIT cloud_contract_id picked by
  // the operator at gate entry (immune to mid-flight buyer name edits).
  // Fall back to STRICT name match for legacy weighments without the field.
  let contract: any = null;
  if (w.cloud_contract_id) {
    contract = await prisma.dDGSContract.findUnique({
      where: { id: w.cloud_contract_id },
    });
    // If the chosen contract was deleted between gate entry and sync, leave
    // contract = null so the truck still gets a stub (operator links manually).
  }
  if (!contract && partyName) {
    const now = new Date();
    const candidates = await prisma.dDGSContract.findMany({
      where: {
        status: 'ACTIVE',
        startDate: { lte: now },
        endDate: { gte: now },
        OR: [{ buyerName: { equals: partyName, mode: 'insensitive' } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    const active = candidates.filter((c: any) =>
      (c.contractQtyMT || 0) === 0 || (c.totalSuppliedMT || 0) < (c.contractQtyMT || 0)
    );
    if (active.length === 1) contract = active[0];
  }

  let rate = 0;
  if (contract) {
    rate = contract.dealType === 'JOB_WORK'
      ? Number(contract.processingChargePerMT) || 0
      : Number(contract.rate) || 0;
  }

  // Validate Ship-To FK exists (or null it out, keep snapshot)
  let shipToFkValid: string | null = null;
  if (w.ship_to_customer_id) {
    const exists = await prisma.customer.findUnique({
      where: { id: w.ship_to_customer_id },
      select: { id: true },
    });
    shipToFkValid = exists?.id || null;
  }

  // Status: GATE_IN if no weights, TARE_WEIGHED if first weight only.
  // (COMPLETE handler later flips to GROSS_WEIGHED then BILLED.)
  const stubStatus = tareKg > 0 ? 'TARE_WEIGHED' : 'GATE_IN';

  const dispatch = await prisma.dDGSDispatchTruck.upsert({
    where: { sourceWbId: w.id },
    update: {
      // Only fill in tare on the partial-state update — never overwrite
      // weights/contract/status that may have been set by a later push.
      ...(tareKg > 0 ? { weightTare: tareKg, tareTime: tareTimeVal } : {}),
    },
    create: {
      sourceWbId: w.id,
      date: dateVal,
      vehicleNo: w.vehicle_no,
      partyName: contract?.buyerName || partyName,
      partyGstin: contract?.buyerGstin || null,
      partyAddress: contract?.buyerAddress || null,
      driverName: w.driver_name || null,
      driverMobile: w.driver_mobile || null,
      transporterName: w.transporter || null,
      weightGross: grossKg,
      weightTare: tareKg,
      weightNet: 0, // not yet billable
      bags: w.bags || 0,
      status: stubStatus,
      hsnCode: '2303',
      gateInTime: gateInVal,
      tareTime: tareTimeVal,
      remarks: `${wbRef} | ${w.remarks || ''}`.trim(),
      contractId: contract?.id || null,
      customerId: contract?.customerId || null,
      rate: rate > 0 ? rate : null,
      userId: 'factory-server',
      shipToCustomerId: shipToFkValid,
      shipToName: w.ship_to_name || null,
      shipToGstin: w.ship_to_gstin || null,
      shipToAddress: w.ship_to_address || null,
      shipToState: w.ship_to_state || null,
      shipToPincode: w.ship_to_pincode || null,
    },
  });

  return {
    ids: [dispatch.id],
    results: [{ id: dispatch.id, type: 'DDGSDispatchTruck', refNo: `STUB-${dispatch.id.slice(0, 8)}`, sourceWbId: w.id }],
    shortCircuit: true,
  };
}
