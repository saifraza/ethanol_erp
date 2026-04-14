import prisma from '../../../config/prisma';
import { WeighmentInput, PushContext, PushOutcome, emptyOutcome } from '../shared';
import { nextInvoiceNo } from '../../../utils/invoiceCounter';
import { onSaleInvoiceCreated } from '../../../services/autoJournal';
import { generateIRN, generateEWBByIRN } from '../../../services/eInvoice';
import { calcDDGSGstSplit } from '../../../services/ddgsInvoiceService';

const SUGAR_HSN = '1701';
const SUGAR_GST_PCT = 5;

/**
 * OUTBOUND + SUGAR → Contract-aware dispatch + auto-invoice
 *
 * Mirrors handleDDGSOutbound. Idempotent via @unique sourceWbId on
 * SugarDispatchTruck and Shipment + prisma.upsert. Strict contract match.
 * Status guard for BILLED/RELEASED. Invoice creation INSIDE the main tx.
 */
export async function handleSugarOutbound(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();
  const grossKg = w.weight_gross || 0;
  const tareKg = w.weight_tare || 0;
  const netKg = w.weight_net || 0;
  const netMT = Math.round((netKg / 1000) * 1000) / 1000;
  const partyName = (w.customer_name || w.supplier_name || '').trim();
  const dateVal = w.created_at ? new Date(w.created_at) : new Date();
  const gateInVal = w.first_weight_at ? new Date(w.first_weight_at) : dateVal;
  const tareTimeVal = w.first_weight_at ? new Date(w.first_weight_at) : undefined;
  const grossTimeVal = w.second_weight_at ? new Date(w.second_weight_at) : undefined;

  // ── 1. STRICT contract match (read only, before tx) ──
  // Exact buyerName (case-insensitive) OR exact GSTIN, ACTIVE, within dates, has remaining qty
  let contract: any = null;
  let matchAmbiguous = false;
  if (partyName) {
    const now = new Date();
    const candidates = await prisma.sugarContract.findMany({
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
    if (active.length === 1) {
      contract = active[0];
    } else if (active.length > 1) {
      matchAmbiguous = true;
    }
  }

  // ── 2. Rate from contract ──
  const rate = contract ? (Number(contract.rate) || 0) : 0;
  const canBill = !!contract && rate > 0 && netMT > 0 && !!contract.customerId;

  // ── 3. Atomic transaction: upsert truck + shipment + (if canBill) invoice ──
  const txResult = await prisma.$transaction(async (tx) => {
    // Status guard — bail if existing truck is terminal
    const existing = await tx.sugarDispatchTruck.findUnique({ where: { sourceWbId: w.id } });
    if (existing && (existing.status === 'BILLED' || existing.status === 'RELEASED')) {
      return { dispatch: existing, billed: false, alreadyBilled: true };
    }

    // Upsert SugarDispatchTruck (atomic via @unique sourceWbId)
    const dispatch = await tx.sugarDispatchTruck.upsert({
      where: { sourceWbId: w.id },
      update: {
        ...(tareKg > 0 ? { weightTare: tareKg, tareTime: tareTimeVal } : {}),
        ...(grossKg > 0 ? { weightGross: grossKg, grossTime: grossTimeVal } : {}),
        ...(grossKg > 0 && tareKg > 0 ? { weightNet: netMT } : {}),
        ...(existing && (existing.status === 'GATE_IN' || existing.status === 'TARE_WEIGHED')
          ? { status: (grossKg > 0 && tareKg > 0) ? 'GROSS_WEIGHED' as const : (tareKg > 0 ? 'TARE_WEIGHED' as const : existing.status) }
          : {}),
        ...(contract && !existing?.contractId
          ? { contractId: contract.id, customerId: contract.customerId, rate: rate > 0 ? rate : null }
          : {}),
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
        ...(grossKg > 0 ? { weightGross: grossKg } : {}),
        ...(tareKg > 0 ? { weightTare: tareKg } : {}),
        ...(grossKg > 0 && tareKg > 0 ? { weightNet: netMT } : {}),
        bags: w.bags || 0,
        status: (grossKg > 0 && tareKg > 0) ? 'GROSS_WEIGHED' : (tareKg > 0 ? 'TARE_WEIGHED' : 'GATE_IN'),
        hsnCode: SUGAR_HSN,
        gateInTime: gateInVal,
        tareTime: tareTimeVal,
        grossTime: grossTimeVal,
        remarks: `${ctx.wbRef} | ${w.remarks || ''}`.trim(),
        contractId: contract?.id || null,
        customerId: contract?.customerId || null,
        rate: rate > 0 ? rate : null,
        userId: 'factory-server',
      },
    });

    // Upsert Shipment (parallel sales-facing view)
    await tx.shipment.upsert({
      where: { sourceWbId: w.id },
      update: {
        ...(tareKg > 0 ? { weightTare: tareKg } : {}),
        ...(grossKg > 0 ? { weightGross: grossKg } : {}),
        ...(grossKg > 0 && tareKg > 0 ? { weightNet: netKg } : {}),
        status: (grossKg > 0 && tareKg > 0) ? 'GROSS_WEIGHED' : (tareKg > 0 ? 'TARE_WEIGHED' : 'GATE_IN'),
        grossTime: grossTimeVal ? grossTimeVal.toISOString() : undefined,
      },
      create: {
        sourceWbId: w.id,
        productName: 'Sugar',
        customerName: contract?.buyerName || partyName,
        vehicleNo: w.vehicle_no,
        driverName: w.driver_name || null,
        driverMobile: w.driver_mobile || null,
        transporterName: w.transporter || null,
        vehicleType: w.vehicle_type || null,
        ...(tareKg > 0 ? { weightTare: tareKg } : {}),
        ...(grossKg > 0 ? { weightGross: grossKg } : {}),
        ...(grossKg > 0 && tareKg > 0 ? { weightNet: netKg } : {}),
        bags: w.bags || null,
        status: (grossKg > 0 && tareKg > 0) ? 'GROSS_WEIGHED' : (tareKg > 0 ? 'TARE_WEIGHED' : 'GATE_IN'),
        gateInTime: gateInVal.toISOString(),
        tareTime: tareTimeVal ? tareTimeVal.toISOString() : null,
        grossTime: grossTimeVal ? grossTimeVal.toISOString() : null,
        paymentStatus: 'NOT_REQUIRED',
        remarks: `WB:${w.id}`,
      },
    });

    // ── Invoice creation INSIDE the same tx (no setImmediate, no race) ──
    if (!canBill) {
      return { dispatch, billed: false, alreadyBilled: false };
    }
    const existingLink = await tx.sugarContractDispatch.findUnique({
      where: { sugarDispatchTruckId: dispatch.id },
      select: { id: true, invoiceId: true },
    });
    if (existingLink?.invoiceId) {
      return { dispatch, billed: false, alreadyBilled: true };
    }

    const customer = await tx.customer.findUnique({ where: { id: contract.customerId } });
    if (!customer) {
      return { dispatch, billed: false, alreadyBilled: false };
    }

    const amount = Math.round(netMT * rate * 100) / 100;
    const gstPercent = contract.gstPercent || SUGAR_GST_PCT;
    const gst = calcDDGSGstSplit(amount, gstPercent, customer.state, customer.gstNo);
    const total = Math.round((amount + gst.gstAmount) * 100) / 100;

    const customInvNo = await nextInvoiceNo(tx, 'SUG');

    const invoice = await tx.invoice.create({
      data: {
        customerId: customer.id,
        invoiceDate: grossTimeVal || dateVal,
        productName: 'Sugar',
        quantity: netMT,
        unit: 'MT',
        rate,
        amount,
        gstPercent,
        gstAmount: gst.gstAmount,
        supplyType: gst.supplyType,
        cgstPercent: gst.cgstPercent,
        cgstAmount: gst.cgstAmount,
        sgstPercent: gst.sgstPercent,
        sgstAmount: gst.sgstAmount,
        igstPercent: gst.igstPercent,
        igstAmount: gst.igstAmount,
        totalAmount: total,
        balanceAmount: total,
        status: 'UNPAID',
        remarks: customInvNo,
        userId: 'system-weighbridge',
      },
    });

    // Upsert SugarContractDispatch (idempotent via @unique sugarDispatchTruckId)
    if (existingLink) {
      await tx.sugarContractDispatch.update({
        where: { id: existingLink.id },
        data: { invoiceId: invoice.id, rate, amount, weightNetMT: netMT },
      });
    } else {
      await tx.sugarContractDispatch.create({
        data: {
          contractId: contract.id,
          sugarDispatchTruckId: dispatch.id,
          dispatchDate: grossTimeVal || dateVal,
          vehicleNo: dispatch.vehicleNo,
          driverName: dispatch.driverName || null,
          driverPhone: dispatch.driverMobile || null,
          transporterName: dispatch.transporterName || null,
          destination: dispatch.destination || null,
          bags: dispatch.bags || 0,
          weightPerBag: dispatch.weightPerBag || 50,
          weightGrossMT: grossKg / 1000,
          weightTareMT: tareKg / 1000,
          weightNetMT: netMT,
          rate,
          amount,
          gatePassNo: dispatch.gatePassNo || null,
          status: 'DISPATCHED',
          invoiceId: invoice.id,
          remarks: `Auto from WB ${w.id.slice(0, 8)}`,
        },
      });
    }

    // Transition to BILLED — gates the contract total increment
    const billedUpdate = await tx.sugarDispatchTruck.updateMany({
      where: { id: dispatch.id, status: { notIn: ['BILLED', 'RELEASED'] } },
      data: {
        invoiceNo: String(invoice.invoiceNo),
        invoiceAmount: total,
        status: 'BILLED',
      },
    });

    // Single-increment guard — only bump contract totals if we transitioned to BILLED
    if (billedUpdate.count > 0) {
      // Concurrency guard: re-read the contract INSIDE the tx and run a
      // conditional update so two simultaneous trucks can't oversubscribe a
      // FIXED-quantity contract. For OPEN contracts (contractQtyMT === 0)
      // there's no cap and we always increment.
      const fresh = await tx.sugarContract.findUnique({
        where: { id: contract.id },
        select: { contractQtyMT: true, totalSuppliedMT: true, contractNo: true },
      });
      const cap = fresh?.contractQtyMT || 0;
      const isOpen = cap === 0;
      const incremented = await tx.sugarContract.updateMany({
        where: isOpen
          ? { id: contract.id }
          : { id: contract.id, totalSuppliedMT: { lte: cap - netMT } },
        data: {
          totalSuppliedMT: { increment: netMT },
          totalInvoicedAmt: { increment: total },
        },
      });
      if (incremented.count === 0) {
        throw new Error(
          `Sugar contract ${fresh?.contractNo || contract.contractNo} oversubscribed: cannot bill ${netMT}MT (cap ${cap}MT, supplied ${fresh?.totalSuppliedMT}MT) from ${w.vehicle_no}`,
        );
      }
    }

    return { dispatch, billed: billedUpdate.count > 0, alreadyBilled: false, invoiceId: invoice.id, invoice, customer, amount, gst, total };
  }, { timeout: 15000 });

  // ── 4. Post-commit best-effort: journal + IRN/EWB ──
  if (txResult.billed && txResult.invoiceId) {
    try {
      onSaleInvoiceCreated(prisma, {
        id: txResult.invoiceId,
        invoiceNo: txResult.invoice!.invoiceNo,
        totalAmount: txResult.total!,
        amount: txResult.amount!,
        gstAmount: txResult.gst!.gstAmount,
        gstPercent: txResult.invoice!.gstPercent,
        cgstAmount: txResult.gst!.cgstAmount,
        sgstAmount: txResult.gst!.sgstAmount,
        igstAmount: txResult.gst!.igstAmount,
        supplyType: txResult.gst!.supplyType,
        productName: 'Sugar',
        customerId: txResult.customer!.id,
        userId: 'system-weighbridge',
        invoiceDate: txResult.invoice!.invoiceDate,
        customer: { state: txResult.customer!.state },
      } as any);
    } catch (err: any) {
      process.stderr.write(`[SUGAR_OUT] auto-journal failed for invoice ${txResult.invoiceId}: ${err?.message || err}\n`);
    }

    if (contract?.autoGenerateEInvoice && txResult.customer?.gstNo && txResult.customer?.state && txResult.customer?.pincode && txResult.customer?.address) {
      setImmediate(async () => {
        try {
          const cust = txResult.customer!;
          const inv = txResult.invoice!;
          const irnRes = await generateIRN({
            invoiceNo: inv.remarks || `INV-${inv.invoiceNo}`,
            invoiceDate: inv.invoiceDate,
            productName: 'Sugar', quantity: inv.quantity, unit: 'MT', rate: inv.rate, amount: inv.amount, gstPercent: inv.gstPercent,
            customer: { gstin: cust.gstNo!, name: cust.name, address: cust.address!, city: cust.city || '', pincode: cust.pincode!, state: cust.state!, phone: cust.phone || '', email: cust.email || '' },
          } as any);
          if (irnRes.success && irnRes.irn) {
            await prisma.invoice.update({
              where: { id: inv.id },
              data: { irn: irnRes.irn, irnDate: new Date(), irnStatus: 'GENERATED', ackNo: irnRes.ackNo ? String(irnRes.ackNo) : null, signedQRCode: irnRes.signedQRCode?.slice(0, 4000) || null } as any,
            });
            const vehNo = (txResult.dispatch.vehicleNo || '').replace(/\s/g, '');
            const autoEwbData: Record<string, any> = { Irn: irnRes.irn, Distance: 100, TransMode: '1', VehNo: vehNo, VehType: 'R' };
            if (txResult.dispatch.transporterName && txResult.dispatch.transporterName.length >= 3) autoEwbData.TransName = txResult.dispatch.transporterName;
            const ewbRes = await generateEWBByIRN(irnRes.irn, autoEwbData);
            if (ewbRes.success && ewbRes.ewayBillNo) {
              await prisma.invoice.update({ where: { id: inv.id }, data: { ewbNo: ewbRes.ewayBillNo, ewbDate: new Date(), ewbStatus: 'GENERATED' } as any });
            }
          }
        } catch (err: any) {
          process.stderr.write(`[SUGAR_OUT] IRN/EWB failed for invoice ${txResult.invoiceId}: ${err?.message || err}\n`);
        }
      });
    }
  }

  // ── 5. PushOutcome ──
  let type = 'SugarDispatch';
  if (!txResult.billed && !txResult.alreadyBilled) {
    if (matchAmbiguous) type = 'SugarDispatch_AMBIGUOUS_CONTRACT';
    else if (!contract) type = 'SugarDispatch_NO_CONTRACT';
    else if (rate <= 0) type = 'SugarDispatch_PENDING_RATE';
    else type = 'SugarDispatch_NOT_BILLED';
  }

  out.results.push({ id: txResult.dispatch.id, type, refNo: txResult.dispatch.id, sourceWbId: w.id });
  out.ids.push(txResult.dispatch.id);
  return out;
}
