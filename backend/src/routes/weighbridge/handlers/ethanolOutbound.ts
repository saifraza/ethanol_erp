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

    // Guard: never overwrite RELEASED; idempotent re-sync if same sourceWbId
    if (dispatchTruck.status === 'RELEASED') return { skipped: true, id: dispatchTruck.id };
    if (dispatchTruck.status === 'GROSS_WEIGHED' && dispatchTruck.sourceWbId === w.id) {
      return { skipped: false, id: dispatchTruck.id }; // idempotent
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
        productRate = contract.contractType === 'JOB_WORK' ? 71.86 : (contract.ethanolRate || null);
        productValue = productRate && bl > 0 ? Math.round(bl * productRate) : null;
      }
    }

    // RACE FIX 4: Compare-and-set — only update if status is GATE_IN/TARE_WEIGHED
    // AND (sourceWbId is null OR matches our weighment ID)
    // This prevents a second weighment from overwriting an already-GROSS_WEIGHED record
    const updated = await tx.dispatchTruck.updateMany({
      where: {
        id: dispatchTruck.id,
        status: { in: ['GATE_IN', 'TARE_WEIGHED'] },
        OR: [{ sourceWbId: null }, { sourceWbId: w.id }],
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
      },
    });
    return updated.count > 0 ? { skipped: false, id: dispatchTruck.id } : { skipped: true, id: dispatchTruck.id };
  });

  if (ethResult && !ethResult.skipped) {
    out.results.push({ id: ethResult.id, type: 'EthanolDispatch', refNo: ethResult.id, sourceWbId: w.id });
    out.ids.push(ethResult.id);
  } else if (!ethResult) {
    // Should be unreachable — transaction always returns an object
    console.warn(`[WB-PUSH] Ethanol outbound for ${w.vehicle_no} — no DispatchTruck found, will retry`);
    out.results.push({ id: w.id, type: 'EthanolDispatch_SKIPPED', refNo: w.vehicle_no, sourceWbId: w.id });
    // NOT pushing to ids[] — syncWorker won't mark this as synced
  } else {
    out.results.push({ id: ethResult.id, type: 'EthanolDispatch', refNo: ethResult.id, sourceWbId: w.id });
    out.ids.push(ethResult.id);
  }
  return out;
}
