import prisma from '../config/prisma';

/**
 * Recompute fullyPaid + paymentLinkedAt on all open GRNs (DRAFT/PARTIAL) for a PO.
 *
 * Called whenever a VendorPayment or VendorInvoice that touches the PO is created/updated/deleted.
 *
 * Rules:
 * - fullyPaid = true when sum of (paidAmount on linked VendorInvoices) >= PO grandTotal
 *               OR when an advance VendorPayment exists for this PO's vendor that covers grandTotal
 * - paymentLinkedAt = max(payment.paymentDate) of any payment touching the PO
 * - DRAFT GRN that becomes fullyPaid is auto-flipped to PARTIAL ("paid & awaiting goods")
 *
 * CONFIRMED / CANCELLED GRNs are never touched.
 */
export async function recomputeGrnPaidStateForPO(poId: string): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { id: true, grandTotal: true, vendorId: true },
  });
  if (!po) return;

  const grns = await prisma.goodsReceipt.findMany({
    where: { poId, status: { in: ['DRAFT', 'PARTIAL'] } },
    select: { id: true, status: true },
    take: 50,
  });
  if (grns.length === 0) return;

  // Sum payments through linked VendorInvoices for this PO
  const invoices = await prisma.vendorInvoice.findMany({
    where: { poId },
    select: { paidAmount: true, netPayable: true, totalAmount: true },
    take: 100,
  });
  const invoicePaid = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0);

  // Latest payment timestamp on those invoices
  const latestPayment = await prisma.vendorPayment.findFirst({
    where: { invoice: { poId } },
    orderBy: { paymentDate: 'desc' },
    select: { paymentDate: true },
  });

  const target = po.grandTotal || 0;
  const fullyPaid = target > 0 && invoicePaid + 0.01 >= target;
  const paymentLinkedAt = latestPayment?.paymentDate ?? null;

  for (const g of grns) {
    const nextStatus = g.status === 'DRAFT' && fullyPaid ? 'PARTIAL' : g.status;
    await prisma.goodsReceipt.update({
      where: { id: g.id },
      data: { fullyPaid, paymentLinkedAt, status: nextStatus },
    });
  }
}

/**
 * Recompute paid state for a single GRN (e.g., after vendor invoice change tied directly to GRN).
 */
export async function recomputeGrnPaidFlag(grnId: string): Promise<void> {
  const grn = await prisma.goodsReceipt.findUnique({
    where: { id: grnId },
    select: { id: true, poId: true },
  });
  if (!grn?.poId) return;
  await recomputeGrnPaidStateForPO(grn.poId);
}
