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
  // Top-level safety net: NEVER let an unexpected error cause an infinite retry loop.
  // If anything inside throws, log it loudly and ack the weighment anyway. The cloud
  // DispatchTruck may stay in GATE_IN/TARE_WEIGHED state — that's a separate issue we
  // fix manually — but the factory weighment must NOT keep retrying forever.
  try {
    return await handleEthanolOutboundInner(w, _ctx);
  } catch (err: any) {
    // Capture Prisma error code/meta + full context so the next failure tells us EXACTLY what's wrong
    const errCode = err?.code || 'UNKNOWN';
    const errMeta = err?.meta ? JSON.stringify(err.meta) : '';
    const errMessage = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : '';
    console.error(`[WB-PUSH][ETHANOL] FATAL handler error for ${w.vehicle_no} | weighmentId=${w.id} | gatePassId=${w.cloud_gate_pass_id || 'none'} | code=${errCode} | meta=${errMeta} | message=${errMessage}\nstack=${errStack}`);

    // Persist to PlantIssue table so we can read the error from the cloud DB next time
    // (no Railway log access needed). Fire-and-forget — we still ack the weighment.
    setImmediate(async () => {
      try {
        const { default: prismaClient } = await import('../../../config/prisma');
        await prismaClient.plantIssue.create({
          data: {
            title: `Ethanol sync handler error: ${w.vehicle_no}`,
            description: `Vehicle: ${w.vehicle_no}\nWeighment ID: ${w.id}\nGate Pass ID: ${w.cloud_gate_pass_id || 'none'}\nPrisma code: ${errCode}\nMeta: ${errMeta}\nMessage: ${errMessage}\n\nStack:\n${errStack}`,
            issueType: 'OTHER',
            severity: 'HIGH',
            equipment: 'Weighbridge / Ethanol Sync',
            location: 'Cloud ERP',
            status: 'OPEN',
            reportedBy: 'system-weighbridge',
            userId: 'system-weighbridge',
          },
        });
      } catch (logErr) {
        console.error(`[WB-PUSH][ETHANOL] Failed to persist error to PlantIssue:`, logErr);
      }
    });

    const out = emptyOutcome();
    out.results.push({ id: w.id, type: 'EthanolDispatch_HANDLER_ERROR', refNo: w.vehicle_no, sourceWbId: w.id });
    out.ids.push(w.id);
    return out;
  }
}

async function handleEthanolOutboundInner(w: WeighmentInput, _ctx: PushContext): Promise<PushOutcome> {
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

    // No existing DispatchTruck — auto-create from factory gate entry.
    // BEFORE creating with sourceWbId=w.id, check whether the unique slot is already taken
    // (orphan from an earlier partial run). If taken, create WITHOUT sourceWbId so we don't
    // throw on the unique constraint.
    if (!dispatchTruck) {
      const orphan = await tx.dispatchTruck.findUnique({
        where: { sourceWbId: w.id },
        select: { id: true },
      });
      const setSrc = orphan == null;
      if (!setSrc) {
        console.warn(`[WB-PUSH][ETHANOL] ${w.vehicle_no} auto-create: sourceWbId=${w.id} already owned by ${orphan!.id}; creating new row without sourceWbId.`);
      }
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
          ...(setSrc ? { sourceWbId: w.id } : {}),
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
            // Codex audit fix: persist all dispatch fields, not just BL/strength/seal
            ...(w.quantity_bl != null ? { quantityBL: w.quantity_bl } : {}),
            ...(w.ethanol_strength != null ? { strength: w.ethanol_strength } : {}),
            ...(w.seal_no ? { sealNo: w.seal_no } : {}),
            ...(w.rst_no ? { rstNo: w.rst_no } : {}),
            ...(w.driver_license ? { driverLicense: w.driver_license } : {}),
            ...(w.peso_date ? { pesoDate: w.peso_date } : {}),
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

    // Calculate product value from contract rate.
    //
    // CRITICAL "first-write-wins" rule for rate/value:
    //   If dispatchTruck.productRatePerLtr is already set (non-null, non-zero), DO NOT
    //   overwrite it. The truck was already priced at gate-pass / first sync time, and
    //   if the contract rate has changed since then (which it does), recomputing would
    //   silently revalue an already-billed dispatch.
    //
    // 2026-04-07 incident postscript: my recover-ethanol endpoint hit this exact bug —
    // it recomputed rate from current contract on RELEASED rows, overwriting yesterday's
    // ₹71.86/ltr with today's ₹14/ltr on 3 trucks. Operators caught it. Lesson: rate
    // is HISTORICAL data once set; never recompute.
    const bl = w.quantity_bl || dispatchTruck.quantityBL || 0;
    const rateAlreadySet = dispatchTruck.productRatePerLtr != null && dispatchTruck.productRatePerLtr > 0;
    let productRate: number | null = null;
    let productValue: number | null = null;
    if (!rateAlreadySet && dispatchTruck.contractId && bl > 0) {
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
    // 2026-04-07 incident.)
    //
    // CRITICAL: sourceWbId is @unique on DispatchTruck. The real bug from 2026-04-07 incident:
    //   1. dispatchTruck (matched by cloud_gate_pass_id) has sourceWbId = null
    //   2. ANOTHER orphan DispatchTruck row already owns sourceWbId = w.id (from a prior
    //      auto-create branch run)
    //   3. updateMany tries to set sourceWbId = w.id → P2002 unique violation → tx rollback
    //
    // Fix: query inside the tx whether any OTHER row already owns w.id. If yes, skip writing
    // sourceWbId on this update (still write weights/status), and log a structured warning so
    // the orphan can be cleaned up later.
    let canSetSourceWbId = dispatchTruck.sourceWbId == null;
    if (canSetSourceWbId) {
      const orphan = await tx.dispatchTruck.findUnique({
        where: { sourceWbId: w.id },
        select: { id: true, vehicleNo: true, status: true },
      });
      if (orphan && orphan.id !== dispatchTruck.id) {
        canSetSourceWbId = false;
        console.warn(`[WB-PUSH][ETHANOL] ${w.vehicle_no} ORPHAN COLLISION: sourceWbId=${w.id} already owned by DispatchTruck ${orphan.id} (vehicle=${orphan.vehicleNo}, status=${orphan.status}). Updating weights on ${dispatchTruck.id} without claiming sourceWbId. Manual cleanup needed for orphan.`);
      }
    } else if (dispatchTruck.sourceWbId !== w.id) {
      console.warn(`[WB-PUSH][ETHANOL] ${w.vehicle_no} dispatchTruck.sourceWbId=${dispatchTruck.sourceWbId} (not w.id=${w.id}); updating weights only, leaving sourceWbId untouched.`);
    }
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
        ...(canSetSourceWbId ? { sourceWbId: w.id } : {}),
        // NOTE: quantityKL was removed here on 2026-04-07 — DispatchTruck schema only has
        // quantityBL, not quantityKL (those live on EthanolLifting / EthanolContract).
        // Writing quantityKL caused PrismaClientValidationError → tx rollback → factory
        // weighment retry loop → 4 trucks stuck for 5 hours. KL can be computed at display
        // time as quantityBL / 1000.
        ...(bl > 0 ? { quantityBL: bl } : {}),
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
