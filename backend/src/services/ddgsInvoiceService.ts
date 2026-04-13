import prisma from '../config/prisma';
import { nextInvoiceNo, nextCounter } from '../utils/invoiceCounter';
import { onSaleInvoiceCreated } from './autoJournal';
import { generateIRN, generateEWBByIRN } from './eInvoice';

const COMPANY_STATE = 'Madhya Pradesh';
const DDGS_GST_PCT = 5;

export function calcDDGSGstSplit(amount: number, gstPercent: number, customerState: string | null | undefined) {
  const gstAmount = Math.round((amount * gstPercent) / 100 * 100) / 100;
  const isInterstate = customerState && customerState !== COMPANY_STATE;
  if (isInterstate) {
    return { supplyType: 'INTER_STATE' as const, cgstPercent: 0, cgstAmount: 0, sgstPercent: 0, sgstAmount: 0, igstPercent: gstPercent, igstAmount: gstAmount, gstAmount };
  }
  const half = Math.round(gstAmount / 2 * 100) / 100;
  return { supplyType: 'INTRA_STATE' as const, cgstPercent: gstPercent / 2, cgstAmount: half, sgstPercent: gstPercent / 2, sgstAmount: Math.round((gstAmount - half) * 100) / 100, igstPercent: 0, igstAmount: 0, gstAmount };
}

/**
 * Creates an Invoice + DDGSContractDispatch for a DDGSDispatchTruck that
 * was weighed at the factory. Idempotent — skips if invoice already exists.
 *
 * Returns invoice ID on success, null if skipped.
 */
export async function createDDGSInvoiceFromTruck(truckId: string): Promise<string | null> {
  const truck = await prisma.dDGSDispatchTruck.findUnique({
    where: { id: truckId },
    include: {
      contract: { include: { customer: true } },
      ddgsContractDispatch: true,
    },
  });
  if (!truck) return null;
  if (truck.ddgsContractDispatch?.invoiceId) return truck.ddgsContractDispatch.invoiceId;
  if (!truck.contract || !truck.contract.customer) return null;

  const contract = truck.contract;
  const customer = contract.customer;
  const netMT = truck.weightNet || 0;
  const rate = truck.rate || 0;
  if (netMT <= 0 || rate <= 0) return null;

  const amount = Math.round(netMT * rate * 100) / 100;
  const gstPercent = contract.gstPercent || DDGS_GST_PCT;
  const gst = calcDDGSGstSplit(amount, gstPercent, customer.state);
  const total = Math.round((amount + gst.gstAmount) * 100) / 100;

  const invoiceId = await prisma.$transaction(async (tx) => {
    // Double-check inside tx (race safety)
    const existingLink = await tx.dDGSContractDispatch.findUnique({
      where: { ddgsDispatchTruckId: truck.id },
      select: { id: true, invoiceId: true },
    });
    if (existingLink?.invoiceId) return existingLink.invoiceId;

    const customInvNo = await nextInvoiceNo(tx);
    const challanNo = await nextCounter(tx, 'DCH/ETH');
    const gatePassNo = await nextCounter(tx, 'GP/ETH');
    const dispatchDate = truck.grossTime || truck.date || new Date();

    const invoice = await tx.invoice.create({
      data: {
        customerId: customer.id,
        invoiceDate: dispatchDate,
        productName: 'DDGS',
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

    // Upsert DDGSContractDispatch row linked to the truck
    if (existingLink) {
      await tx.dDGSContractDispatch.update({
        where: { id: existingLink.id },
        data: { invoiceId: invoice.id, rate, amount, weightNetMT: netMT, challanNo, gatePassNo },
      });
    } else {
      await tx.dDGSContractDispatch.create({
        data: {
          contractId: contract.id,
          ddgsDispatchTruckId: truck.id,
          dispatchDate,
          vehicleNo: truck.vehicleNo,
          driverName: truck.driverName || null,
          driverPhone: truck.driverMobile || null,
          transporterName: truck.transporterName || null,
          destination: truck.destination || null,
          bags: truck.bags || 0,
          weightPerBag: truck.weightPerBag || 50,
          // DDGSDispatchTruck stores weights in MT. Old weighbridge rows (pre-2026-04-12)
          // stored gross/tare in KG — detect by threshold (no truck > 100 MT = 100,000 KG).
          weightGrossMT: (truck.weightGross || 0) > 100 ? (truck.weightGross || 0) / 1000 : (truck.weightGross || 0),
          weightTareMT: (truck.weightTare || 0) > 100 ? (truck.weightTare || 0) / 1000 : (truck.weightTare || 0),
          weightNetMT: netMT,
          rate,
          amount,
          challanNo,
          gatePassNo,
          status: 'DISPATCHED',
          invoiceId: invoice.id,
          remarks: `Auto from WB truck ${truck.id.slice(0, 8)}`,
        },
      });
    }

    // Update truck with invoice info
    await tx.dDGSDispatchTruck.update({
      where: { id: truck.id },
      data: {
        invoiceNo: String(invoice.invoiceNo),
        invoiceAmount: total,
        challanNo,
        gatePassNo,
        status: 'BILLED',
      },
    });

    // Update contract totals atomically
    await tx.dDGSContract.update({
      where: { id: contract.id },
      data: {
        totalSuppliedMT: { increment: netMT },
        totalInvoicedAmt: { increment: total },
      },
    });

    return invoice.id;
  });

  if (!invoiceId) return null;

  // Post-commit side effects (journal + e-invoice/EWB)
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return invoiceId;

  try {
    onSaleInvoiceCreated(prisma, {
      id: inv.id, invoiceNo: inv.invoiceNo, totalAmount: total,
      amount, gstAmount: gst.gstAmount, gstPercent,
      cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
      supplyType: gst.supplyType, productName: 'DDGS',
      customerId: customer.id, userId: 'system-weighbridge', invoiceDate: inv.invoiceDate,
      customer: { state: customer.state },
    } as any);
  } catch (err: any) {
    process.stderr.write(`[ddgsInvoiceService] journal failed for ${invoiceId}: ${err.message}\n`);
  }

  // Auto IRN + EWB if contract flag set and customer has full GST details
  if (contract.autoGenerateEInvoice && customer.gstNo && customer.state && customer.pincode && customer.address) {
    try {
      const irnRes = await generateIRN({
        invoiceNo: inv.remarks || `INV-${inv.invoiceNo}`,
        invoiceDate: inv.invoiceDate,
        productName: 'DDGS', quantity: inv.quantity, unit: 'MT', rate: inv.rate, amount: inv.amount, gstPercent: inv.gstPercent,
        customer: { gstin: customer.gstNo, name: customer.name, address: customer.address, city: customer.city || '', pincode: customer.pincode, state: customer.state, phone: customer.phone || '', email: customer.email || '' },
      } as any);
      if (irnRes.success && irnRes.irn) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { irn: irnRes.irn, irnDate: new Date(), irnStatus: 'GENERATED', ackNo: irnRes.ackNo ? String(irnRes.ackNo) : null, signedQRCode: irnRes.signedQRCode?.slice(0, 4000) || null } as any,
        });

        const vehNo = (truck.vehicleNo || '').replace(/\s/g, '');
        const autoEwbData: Record<string, any> = { Irn: irnRes.irn, Distance: 100, TransMode: '1', VehNo: vehNo, VehType: 'R' };
        if (truck.transporterName && truck.transporterName.length >= 3) autoEwbData.TransName = truck.transporterName;
        const ewbRes = await generateEWBByIRN(irnRes.irn, autoEwbData);
        if (ewbRes.success && ewbRes.ewayBillNo) {
          await prisma.invoice.update({ where: { id: inv.id }, data: { ewbNo: ewbRes.ewayBillNo, ewbDate: new Date(), ewbStatus: 'GENERATED' } as any });
        }
      }
    } catch (err: any) {
      process.stderr.write(`[ddgsInvoiceService] IRN/EWB failed for ${invoiceId}: ${err.message}\n`);
    }
  }

  return invoiceId;
}
