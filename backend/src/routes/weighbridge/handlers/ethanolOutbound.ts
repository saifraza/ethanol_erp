import { prisma, WeighmentInput, PushContext, PushOutcome, emptyOutcome } from '../shared';

/**
 * OUTBOUND + ETHANOL → Update DispatchTruck on cloud
 *
 * Looks up DispatchTruck by:
 *   1. cloud_gate_pass_id (UUID)
 *   2. sourceWbId (previous sync)
 *   3. vehicleNo + today's date + status in [GATE_IN, TARE_WEIGHED]
 *
 * Auto-creates DispatchTruck if none found (factory gate entry case).
 *
 * Race condition fix from Codex audit:
 * - Compare-and-set on (id, expected status, sourceWbId match) prevents
 *   second weighment from overwriting an existing GROSS_WEIGHED record.
 */
export async function handleEthanolOutbound(w: WeighmentInput, _ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();
  const grossKg = w.weight_gross || 0;
  const tareKg = w.weight_tare || 0;
  const partyName = w.customer_name || w.supplier_name || '';
  const dateVal = w.created_at ? new Date(w.created_at) : new Date();
  const gateInVal = w.first_weight_at ? new Date(w.first_weight_at) : dateVal;
  const tareTimeVal = w.first_weight_at ? new Date(w.first_weight_at) : undefined;
  const grossTimeVal = w.second_weight_at ? new Date(w.second_weight_at) : undefined;

  const hasValidGatePassId = w.cloud_gate_pass_id && /^[0-9a-f-]{36}$/i.test(w.cloud_gate_pass_id);

  // Validate Ship-To FK before tx (customer master may have been deleted after gate entry)
  let shipToFkValid: string | null = null;
  if (w.ship_to_customer_id) {
    const exists = await prisma.customer.findUnique({ where: { id: w.ship_to_customer_id }, select: { id: true } });
    shipToFkValid = exists?.id || null;
  }

  const ethResult = await prisma.$transaction(async (tx) => {
    // Find DispatchTruck: cloudGatePassId → sourceWbId → vehicleNo+date
    let dispatchTruck = hasValidGatePassId
      ? await tx.dispatchTruck.findUnique({ where: { id: w.cloud_gate_pass_id! } })
      : null;

    if (!dispatchTruck) {
      dispatchTruck = await tx.dispatchTruck.findFirst({ where: { sourceWbId: w.id } });
    }

    if (!dispatchTruck) {
      const todayStart = new Date(dateVal);
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayEnd = new Date(dateVal);
      todayEnd.setUTCHours(23, 59, 59, 999);
      dispatchTruck = await tx.dispatchTruck.findFirst({
        where: {
          vehicleNo: w.vehicle_no.toUpperCase(),
          date: { gte: todayStart, lte: todayEnd },
          status: { in: ['GATE_IN', 'TARE_WEIGHED'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // No existing DispatchTruck — auto-create from factory gate entry
    if (!dispatchTruck) {
      const newTruck = await tx.dispatchTruck.create({
        data: {
          date: dateVal,
          vehicleNo: w.vehicle_no.toUpperCase(),
          partyName: partyName,
          destination: '',
          driverName: w.driver_name || null,
          driverPhone: w.driver_mobile || null,
          transporterName: w.transporter || null,
          status: 'GATE_IN',
          gateInTime: gateInVal,
          sourceWbId: w.id,
          userId: 'factory-server',
          // Ship-To (outbound) — null when Bill-To == Ship-To
          shipToCustomerId: shipToFkValid,
          shipToName: w.ship_to_name || null,
          shipToGstin: w.ship_to_gstin || null,
          shipToAddress: w.ship_to_address || null,
          shipToState: w.ship_to_state || null,
          shipToPincode: w.ship_to_pincode || null,
        },
      });
      if (grossKg > 0 && tareKg > 0) {
        await tx.dispatchTruck.update({
          where: { id: newTruck.id },
          data: {
            weightTare: tareKg,
            weightGross: grossKg,
            weightNet: grossKg - tareKg,
            tareTime: tareTimeVal,
            grossTime: grossTimeVal,
            status: 'GROSS_WEIGHED',
            ...(w.quantity_bl != null ? { quantityBL: w.quantity_bl } : {}),
            ...(w.ethanol_strength != null ? { strength: w.ethanol_strength } : {}),
            ...(w.seal_no ? { sealNo: w.seal_no } : {}),
          },
        });
      }
      return { skipped: false, id: newTruck.id };
    }

    // Guard: never overwrite RELEASED (already gone). Always ACK so syncWorker stops retrying.
    if (dispatchTruck.status === 'RELEASED') return { skipped: false, id: dispatchTruck.id };
    // Idempotent re-sync if already GROSS_WEIGHED — ack and move on regardless of sourceWbId.
    // (Stale sourceWbId from a deleted+recreated factory weighment must NOT cause infinite retry.)
    if (dispatchTruck.status === 'GROSS_WEIGHED') {
      if (dispatchTruck.sourceWbId !== w.id) {
        console.warn(`[WB-PUSH][ETHANOL] ${w.vehicle_no} cloud GROSS_WEIGHED has sourceWbId=${dispatchTruck.sourceWbId} but factory pushed ${w.id} — keeping cloud record, acking factory.`);
      }
      return { skipped: false, id: dispatchTruck.id };
    }

    // Calculate KL from BL and product value from contract rate
    const bl = w.quantity_bl || dispatchTruck.quantityBL || 0;
    const kl = bl > 0 ? bl / 1000 : 0;
    let productRate: number | null = null;
    let productValue: number | null = null;
    if (dispatchTruck.contractId && bl > 0) {
      const contract = await tx.ethanolContract.findUnique({
        where: { id: dispatchTruck.contractId },
        select: { contractType: true, ethanolRate: true, conversionRate: true },
      });
      if (contract) {
        productRate = contract.contractType === 'JOB_WORK' ? (contract.conversionRate || null) : (contract.ethanolRate || null);
        productValue = productRate && bl > 0 ? Math.round(bl * productRate) : null;
      }
    }

    // Compare-and-set on STATUS only — only update if still GATE_IN/TARE_WEIGHED.
    // (Status guards against overwriting an already-GROSS_WEIGHED record; the GROSS_WEIGHED
    // branch above handles that case explicitly. We deliberately do NOT guard on sourceWbId
    // because stale sourceWbId from a deleted+recreated factory weighment used to cause an
    // infinite retry loop where the handler silently skipped — see ethanol stuck trucks
    // 2026-04-07 incident. Factory is source of truth: take over the sourceWbId.)
    const updated = await tx.dispatchTruck.updateMany({
      where: {
        id: dispatchTruck.id,
        status: { in: ['GATE_IN', 'TARE_WEIGHED'] },
      },
      data: {
        weightTare: tareKg,
        weightGross: grossKg,
        weightNet: grossKg - tareKg,
        tareTime: tareTimeVal,
        grossTime: grossTimeVal,
        status: 'GROSS_WEIGHED',
        sourceWbId: w.id,
        ...(bl > 0 ? { quantityBL: bl, quantityKL: kl } : {}),
        ...(w.ethanol_strength != null ? { strength: w.ethanol_strength } : {}),
        ...(w.seal_no ? { sealNo: w.seal_no } : {}),
        ...(w.rst_no ? { rstNo: w.rst_no } : {}),
        ...(w.driver_license ? { driverLicense: w.driver_license } : {}),
        ...(w.peso_date ? { pesoDate: w.peso_date } : {}),
        ...(productRate != null ? { productRatePerLtr: productRate } : {}),
        ...(productValue != null ? { productValue } : {}),
        // Ship-To — only set on first sync (don't clobber later edits)
        ...(w.ship_to_customer_id && !dispatchTruck.shipToCustomerId
          ? {
              shipToCustomerId: shipToFkValid,
              shipToName: w.ship_to_name || null,
              shipToGstin: w.ship_to_gstin || null,
              shipToAddress: w.ship_to_address || null,
              shipToState: w.ship_to_state || null,
              shipToPincode: w.ship_to_pincode || null,
            }
          : {}),
      },
    });
    if (updated.count === 0) {
      // Race: status changed between findFirst and updateMany (e.g. operator clicked Release).
      // Re-read once to log accurate state, then ACK so factory stops retrying.
      const fresh = await tx.dispatchTruck.findUnique({ where: { id: dispatchTruck.id }, select: { status: true } });
      console.warn(`[WB-PUSH][ETHANOL] ${w.vehicle_no} updateMany matched 0 rows; current cloud status=${fresh?.status}; acking anyway to avoid retry loop.`);
    }
    return { skipped: false, id: dispatchTruck.id };
  });

  // ALWAYS ack to syncWorker — prevents the infinite-retry pattern that stuck 4 ethanol trucks
  // on 2026-04-07 (handler returned skipped=true → not in processedWbIds → factory retried 60+ times).
  out.results.push({ id: ethResult.id, type: 'EthanolDispatch', refNo: ethResult.id, sourceWbId: w.id });
  out.ids.push(ethResult.id);
  return out;
}
