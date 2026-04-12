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

  // ── 2b. OUTBOUND ETHANOL partial-state (tare update on FIRST_DONE) ──
  if (isGateOrPending && !isInbound && isEthanolOutbound(w, ctx)) {
    return await updateEthanolDispatchTare(w, ctx);
  }

  // ── 2c. OUTBOUND DDGS partial-state stub ──
  if (isGateOrPending && !isInbound && isDdgsOutbound(w, ctx)) {
    return await createOrUpdateDdgsTruckStub(w, ctx);
  }

  // ── 2d. OUTBOUND SCRAP partial-state stub ──
  if (isGateOrPending && !isInbound && isScrapOutbound(w, ctx)) {
    return await createOrUpdateScrapShipmentStub(w, ctx);
  }

  // ── 3. COMPLETE inbound: dupGrain merge with fall-through ──
  if (w.status === 'COMPLETE' && isInbound) {
    const dupGrain = await prisma.grainTruck.findFirst({
      where: { remarks: { contains: `WB:${w.id}` } },
      select: { id: true, weightNet: true },
    });
    if (dupGrain) {
      // Always update stub on COMPLETE — weights, lab data, and remarks
      const grossTon = (w.weight_gross || 0) / 1000;
      const tareTon = (w.weight_tare || 0) / 1000;
      const netTon = (w.weight_net || 0) / 1000;
      const updateData: Record<string, unknown> = {
        remarks: `WB:${w.id} | Ticket #${w.ticket_no} | COMPLETE | ${w.remarks || ''}`.trim(),
        companyId: w.company_id || undefined,
      };
      // Update weights if they were missing (gate entry stub had 0)
      if (dupGrain.weightNet === 0 || dupGrain.weightNet === null) {
        updateData.weightGross = grossTon;
        updateData.weightTare = tareTon;
        updateData.weightNet = netTon;
      }
      // Always update lab data if factory sent it (even if weights were already set)
      if (w.lab_moisture != null || w.lab_starch != null || w.moisture != null) {
        updateData.moisture = w.lab_moisture ?? w.moisture ?? undefined;
        updateData.starchPercent = w.lab_starch ?? undefined;
        updateData.damagedPercent = w.lab_damaged ?? undefined;
        updateData.foreignMatter = w.lab_foreign_matter ?? undefined;
      }
      if (w.lab_status === 'FAIL') {
        updateData.quarantine = true;
        updateData.quarantineWeight = netTon;
        updateData.quarantineReason = w.lab_remarks || 'Failed lab test';
      } else if (w.lab_status === 'PASS') {
        updateData.quarantine = false;
        updateData.quarantineWeight = 0;
        updateData.quarantineReason = '';
      }
      await prisma.grainTruck.update({
        where: { id: dupGrain.id },
        data: updateData,
      });

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
        companyId: w.company_id || undefined,
        factoryLocalId: w.id,
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
      companyId: w.company_id || undefined,
    },
  });
  return {
    ids: [dupGrain.id],
    results: [{ id: dupGrain.id, type: 'GrainTruck', refNo: `UPDATED-${dupGrain.id.slice(0, 8)}`, sourceWbId: w.id }],
    shortCircuit: true,
  };
}

// ==========================================================================
//  OUTBOUND ETHANOL — update DispatchTruck tare on FIRST_DONE
// ==========================================================================

/** Same ethanol detection as the dispatcher in push.ts — keep in sync. */
function isEthanolOutbound(w: WeighmentInput, _ctx: PushContext): boolean {
  if (w.direction !== 'OUT') return false;
  const hasValidGatePassId = w.cloud_gate_pass_id && /^[0-9a-f-]{36}$/i.test(w.cloud_gate_pass_id);
  if (hasValidGatePassId) return true;
  const lower = (w.material || '').toLowerCase();
  return lower.includes('ethanol');
}

/**
 * Update an existing DispatchTruck with tare weight when FIRST_DONE arrives.
 * Unlike DDGS/scrap, ethanol DispatchTruck is already created by cloud ERP
 * (operator adds it on the dispatch page), so we only UPDATE — never create.
 * If no matching DispatchTruck found, just ack so factory doesn't retry.
 */
async function updateEthanolDispatchTare(w: WeighmentInput, _ctx: PushContext): Promise<PrePhaseResult> {
  const tareKg = w.weight_tare || 0;
  const tareTimeVal = w.first_weight_at ? new Date(w.first_weight_at) : undefined;
  const hasValidGatePassId = w.cloud_gate_pass_id && /^[0-9a-f-]{36}$/i.test(w.cloud_gate_pass_id);

  // Find DispatchTruck: cloud_gate_pass_id → sourceWbId → vehicleNo+date
  let truck = hasValidGatePassId
    ? await prisma.dispatchTruck.findUnique({ where: { id: w.cloud_gate_pass_id! } })
    : null;

  if (!truck) {
    truck = await prisma.dispatchTruck.findFirst({ where: { sourceWbId: w.id } });
  }

  if (!truck) {
    const dateVal = w.created_at ? new Date(w.created_at) : new Date();
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(dateVal.getTime() + IST_MS);
    const todayStart = new Date(istDate);
    todayStart.setUTCHours(0, 0, 0, 0);
    todayStart.setTime(todayStart.getTime() - IST_MS);
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    truck = await prisma.dispatchTruck.findFirst({
      where: {
        vehicleNo: w.vehicle_no.toUpperCase(),
        date: { gte: todayStart, lte: todayEnd },
        status: 'GATE_IN',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!truck) {
    // No DispatchTruck found — ack anyway to prevent retry loop
    return {
      ids: [w.id],
      results: [{ id: w.id, type: 'EthanolDispatch_NO_MATCH', refNo: w.vehicle_no, sourceWbId: w.id }],
      shortCircuit: true,
    };
  }

  // Only update if still GATE_IN (don't regress TARE_WEIGHED/GROSS_WEIGHED/RELEASED)
  if (truck.status === 'GATE_IN' && tareKg > 0) {
    await prisma.dispatchTruck.update({
      where: { id: truck.id },
      data: {
        weightTare: tareKg,
        tareTime: tareTimeVal,
        status: 'TARE_WEIGHED',
        ...(truck.sourceWbId == null ? { sourceWbId: w.id } : {}),
        ...(w.driver_name && !truck.driverName ? { driverName: w.driver_name } : {}),
        ...(w.driver_mobile && !truck.driverPhone ? { driverPhone: w.driver_mobile } : {}),
        ...(w.transporter && !truck.transporterName ? { transporterName: w.transporter } : {}),
      },
    });
  }

  return {
    ids: [truck.id],
    results: [{ id: truck.id, type: 'EthanolDispatch', refNo: `TARE-${truck.id.slice(0, 8)}`, sourceWbId: w.id }],
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

// ==========================================================================
//  OUTBOUND SCRAP — partial-state stub (Shipment with directSaleId)
// ==========================================================================

function isScrapOutbound(w: WeighmentInput, ctx: PushContext): boolean {
  if (w.direction !== 'OUT') return false;
  if (ctx.materialCategory === 'SCRAP') return true;
  const lower = (w.material || '').toLowerCase();
  return lower.includes('scrap');
}

async function createOrUpdateScrapShipmentStub(w: WeighmentInput, _ctx: PushContext): Promise<PrePhaseResult> {
  const dateVal = w.created_at ? new Date(w.created_at) : new Date();
  const gateInVal = w.first_weight_at ? new Date(w.first_weight_at) : dateVal;
  const tareKg = w.weight_tare || 0;
  const tareTimeVal = w.first_weight_at ? new Date(w.first_weight_at).toISOString() : null;
  const partyName = (w.customer_name || w.supplier_name || '').trim();
  const stubStatus = tareKg > 0 ? 'TARE_WEIGHED' : 'GATE_IN';
  const directSaleId = w.cloud_contract_id || null;

  const shipment = await prisma.shipment.upsert({
    where: { sourceWbId: w.id },
    update: {
      ...(tareKg > 0 ? { weightTare: tareKg } : {}),
    },
    create: {
      sourceWbId: w.id,
      directSaleId,
      productName: w.material || 'Scrap',
      customerName: partyName,
      vehicleNo: w.vehicle_no,
      driverName: w.driver_name || null,
      driverMobile: w.driver_mobile || null,
      transporterName: w.transporter || null,
      weightTare: tareKg,
      weightGross: 0,
      weightNet: 0,
      status: stubStatus,
      gateInTime: gateInVal.toISOString(),
      tareTime: tareTimeVal,
      paymentStatus: 'NOT_REQUIRED',
      remarks: `WB:${w.id}`,
      shipToName: w.ship_to_name || null,
      shipToGstin: w.ship_to_gstin || null,
      shipToAddress: w.ship_to_address || null,
      shipToState: w.ship_to_state || null,
      shipToPincode: w.ship_to_pincode || null,
    },
  });

  return {
    ids: [shipment.id],
    results: [{ id: shipment.id, type: 'ScrapShipment', refNo: `STUB-${shipment.id.slice(0, 8)}`, sourceWbId: w.id }],
    shortCircuit: true,
  };
}
