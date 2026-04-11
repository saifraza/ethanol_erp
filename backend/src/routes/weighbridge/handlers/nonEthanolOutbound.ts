import { prisma, WeighmentInput, PushContext, PushOutcome, emptyOutcome } from '../shared';

/**
 * OUTBOUND + non-ethanol → Upsert DDGSDispatchTruck + Shipment
 *
 * Catch-all for outbound that isn't ethanol: DDGS, sugar, animal feed, etc.
 * Creates parallel records in DDGSDispatchTruck (factory ops view) and
 * Shipment (sales/customer view).
 */
export async function handleNonEthanolOutbound(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();
  const grossKg = w.weight_gross || 0;
  const tareKg = w.weight_tare || 0;
  const netKg = w.weight_net || 0;
  const netMT = netKg / 1000;
  const partyName = w.customer_name || w.supplier_name || '';
  const dateVal = w.created_at ? new Date(w.created_at) : new Date();
  const gateInVal = w.first_weight_at ? new Date(w.first_weight_at) : dateVal;
  const tareTimeVal = w.first_weight_at ? new Date(w.first_weight_at) : undefined;
  const grossTimeVal = w.second_weight_at ? new Date(w.second_weight_at) : undefined;

  // Validate Ship-To FK before tx (customer master may have been deleted after gate entry)
  let shipToFkValid: string | null = null;
  if (w.ship_to_customer_id) {
    const exists = await prisma.customer.findUnique({ where: { id: w.ship_to_customer_id }, select: { id: true } });
    shipToFkValid = exists?.id || null;
  }

  const txResult = await prisma.$transaction(async (tx) => {
    // 1. Atomic upsert DDGSDispatchTruck by sourceWbId @unique.
    // (Old findFirst→create was a TOCTOU race — two concurrent retries
    //  could both miss the find and both insert, even inside a tx.)
    const dispatch = await tx.dDGSDispatchTruck.upsert({
      where: { sourceWbId: w.id },
      update: {
        weightGross: grossKg,
        weightTare: tareKg,
        weightNet: netMT,
        grossTime: grossTimeVal,
        // Promote partial-state stub if one exists; never regress terminal states.
        status: 'GROSS_WEIGHED',
      },
      create: {
        sourceWbId: w.id,
        date: dateVal,
        vehicleNo: w.vehicle_no,
        partyName,
        driverName: w.driver_name || null,
        driverMobile: w.driver_mobile || null,
        transporterName: w.transporter || null,
        weightGross: grossKg,
        weightTare: tareKg,
        weightNet: netMT,
        bags: w.bags || 0,
        status: 'GROSS_WEIGHED',
        gateInTime: gateInVal,
        tareTime: tareTimeVal,
        grossTime: grossTimeVal,
        remarks: `${ctx.wbRef} | ${w.remarks || ''}`.trim(),
        shipToCustomerId: shipToFkValid,
        shipToName: w.ship_to_name || null,
        shipToGstin: w.ship_to_gstin || null,
        shipToAddress: w.ship_to_address || null,
        shipToState: w.ship_to_state || null,
        shipToPincode: w.ship_to_pincode || null,
      },
    });

    // 2. Atomic upsert Shipment by sourceWbId @unique
    const shipment = await tx.shipment.upsert({
      where: { sourceWbId: w.id },
      update: {
        weightTare: tareKg,
        weightGross: grossKg,
        weightNet: netKg,
        status: 'GROSS_WEIGHED',
        grossTime: grossTimeVal ? grossTimeVal.toISOString() : undefined,
      },
      create: {
        sourceWbId: w.id,
        productName: w.material || 'DDGS',
        customerName: partyName,
        vehicleNo: w.vehicle_no,
        driverName: w.driver_name || null,
        driverMobile: w.driver_mobile || null,
        transporterName: w.transporter || null,
        vehicleType: w.vehicle_type || null,
        weightTare: tareKg,
        weightGross: grossKg,
        weightNet: netKg,
        bags: w.bags || null,
        status: 'GROSS_WEIGHED',
        gateInTime: gateInVal.toISOString(),
        tareTime: tareTimeVal ? tareTimeVal.toISOString() : null,
        grossTime: grossTimeVal ? grossTimeVal.toISOString() : null,
        paymentStatus: 'NOT_REQUIRED',
        remarks: `WB:${w.id}`,
        shipToCustomerId: w.ship_to_customer_id || null,
        shipToName: w.ship_to_name || null,
        shipToGstin: w.ship_to_gstin || null,
        shipToAddress: w.ship_to_address || null,
        shipToState: w.ship_to_state || null,
        shipToPincode: w.ship_to_pincode || null,
      },
    });

    return { dispatch, shipment };
  });

  // Link to scrap sales order if cloudContractId provided (DirectSale)
  if (w.cloud_contract_id && netMT > 0 && ctx.materialCategory === 'SCRAP') {
    try {
      const order = await prisma.directSale.findUnique({
        where: { id: w.cloud_contract_id },
        select: { id: true, rate: true, status: true },
      });
      if (order && order.status === 'ACTIVE') {
        const amt = netMT * 1000 * order.rate; // rate is per unit (KG), netMT → KG
        await prisma.directSale.update({
          where: { id: order.id },
          data: {
            totalSuppliedQty: { increment: netMT * 1000 }, // KG
            totalSuppliedAmt: { increment: amt },
          },
        });
        console.log(`[WB-PUSH][SCRAP] Linked ${netMT.toFixed(2)} MT to order ${order.id}, amt=${amt.toFixed(0)}`);
      }
    } catch (e: any) {
      console.error('[WB-PUSH][SCRAP] Failed to link to scrap order:', e.message);
    }
  }

  out.results.push({ id: txResult.dispatch.id, type: ctx.materialCategory === 'SCRAP' ? 'ScrapDispatch' : 'DDGSDispatch', refNo: txResult.dispatch.id, sourceWbId: w.id });
  out.ids.push(txResult.dispatch.id);
  return out;
}
