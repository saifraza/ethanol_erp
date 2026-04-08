const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const lifting = await p.ethanolLifting.findFirst({
    where: { invoiceNo: { contains: 'ETH/030' } },
    select: { id: true, invoiceId: true, rate: true, amount: true, quantityBL: true, contractId: true, status: true, invoiceNo: true },
  });
  console.log('LIFTING:', JSON.stringify(lifting, null, 2));
  if (!lifting) { await p.$disconnect(); return; }
  const inv = lifting.invoiceId ? await p.invoice.findUnique({
    where: { id: lifting.invoiceId },
    select: { id: true, invoiceNo: true, rate: true, amount: true, gstAmount: true, totalAmount: true, paidAmount: true, balanceAmount: true, irn: true, irnStatus: true, ackNo: true, status: true, createdAt: true, customerId: true, cgstAmount: true, sgstAmount: true, igstAmount: true, gstPercent: true },
  }) : null;
  console.log('INVOICE:', JSON.stringify(inv, null, 2));
  const truck = await p.dispatchTruck.findFirst({ where: { liftingId: lifting.id }, select: { id: true, productRatePerLtr: true, productValue: true, quantityBL: true, status: true, challanNo: true, gatePassNo: true } });
  console.log('TRUCK:', JSON.stringify(truck, null, 2));
  const contract = await p.ethanolContract.findUnique({ where: { id: lifting.contractId }, select: { id: true, contractNo: true, contractType: true, conversionRate: true, ethanolRate: true, ethanolBenchmark: true, gstPercent: true, totalInvoicedAmt: true, totalSuppliedKL: true, buyerName: true, buyerGst: true } });
  console.log('CONTRACT:', JSON.stringify(contract, null, 2));
  if (inv) {
    const je = await p.journalEntry.findMany({
      where: { OR: [{ sourceType: 'INVOICE', sourceId: String(inv.id) }, { reference: { contains: String(inv.invoiceNo) } }] },
      include: { lines: { select: { accountId: true, debit: true, credit: true, account: { select: { code: true, name: true } } } } },
    });
    console.log('JOURNALS:', JSON.stringify(je, null, 2));
  }
  await p.$disconnect();
})();
