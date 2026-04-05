import prisma from '../config/prisma';

interface RefCheckResult {
  canDelete: boolean;
  message: string;
}

export async function checkVendorReferences(vendorId: string): Promise<RefCheckResult> {
  const [pos, grns, invoices, payments] = await Promise.all([
    prisma.purchaseOrder.count({ where: { vendorId } }),
    prisma.goodsReceipt.count({ where: { vendorId } }),
    prisma.vendorInvoice.count({ where: { vendorId } }),
    prisma.vendorPayment.count({ where: { vendorId } }),
  ]);

  const parts: string[] = [];
  if (pos) parts.push(`${pos} purchase order${pos > 1 ? 's' : ''}`);
  if (grns) parts.push(`${grns} goods receipt${grns > 1 ? 's' : ''}`);
  if (invoices) parts.push(`${invoices} invoice${invoices > 1 ? 's' : ''}`);
  if (payments) parts.push(`${payments} payment${payments > 1 ? 's' : ''}`);

  if (parts.length === 0) return { canDelete: true, message: '' };
  return { canDelete: false, message: `Cannot delete: ${parts.join(', ')} reference this vendor` };
}

export async function checkCustomerReferences(customerId: string): Promise<RefCheckResult> {
  const [orders, invoices, payments, contracts] = await Promise.all([
    prisma.salesOrder.count({ where: { customerId } }),
    prisma.invoice.count({ where: { customerId } }),
    prisma.payment.count({ where: { customerId } }),
    prisma.ethanolContract.count({ where: { buyerCustomerId: customerId } }),
  ]);

  const parts: string[] = [];
  if (orders) parts.push(`${orders} sales order${orders > 1 ? 's' : ''}`);
  if (invoices) parts.push(`${invoices} invoice${invoices > 1 ? 's' : ''}`);
  if (payments) parts.push(`${payments} payment${payments > 1 ? 's' : ''}`);
  if (contracts) parts.push(`${contracts} contract${contracts > 1 ? 's' : ''}`);

  if (parts.length === 0) return { canDelete: true, message: '' };
  return { canDelete: false, message: `Cannot delete: ${parts.join(', ')} reference this customer` };
}

export async function checkTransporterReferences(transporterId: string): Promise<RefCheckResult> {
  const [quotations, payments] = await Promise.all([
    prisma.freightQuotation.count({ where: { transporterId } }),
    prisma.transporterPayment.count({ where: { transporterId } }),
  ]);

  const parts: string[] = [];
  if (quotations) parts.push(`${quotations} freight quotation${quotations > 1 ? 's' : ''}`);
  if (payments) parts.push(`${payments} payment${payments > 1 ? 's' : ''}`);

  if (parts.length === 0) return { canDelete: true, message: '' };
  return { canDelete: false, message: `Cannot delete: ${parts.join(', ')} reference this transporter` };
}

export async function checkInventoryItemReferences(itemId: string): Promise<RefCheckResult> {
  const [poLines, grnLines, stockLevels, movements] = await Promise.all([
    prisma.pOLine.count({ where: { inventoryItemId: itemId } }),
    prisma.gRNLine.count({ where: { inventoryItemId: itemId } }),
    prisma.stockLevel.count({ where: { itemId } }),
    prisma.stockMovement.count({ where: { itemId } }),
  ]);

  const parts: string[] = [];
  if (poLines) parts.push(`${poLines} PO line${poLines > 1 ? 's' : ''}`);
  if (grnLines) parts.push(`${grnLines} GRN line${grnLines > 1 ? 's' : ''}`);
  if (stockLevels) parts.push(`${stockLevels} stock level${stockLevels > 1 ? 's' : ''}`);
  if (movements) parts.push(`${movements} stock movement${movements > 1 ? 's' : ''}`);

  if (parts.length === 0) return { canDelete: true, message: '' };
  return { canDelete: false, message: `Cannot delete: ${parts.join(', ')} reference this item` };
}

export async function checkMaterialReferences(materialId: string): Promise<RefCheckResult> {
  const [poLines, grnLines] = await Promise.all([
    prisma.pOLine.count({ where: { materialId } }),
    prisma.gRNLine.count({ where: { materialId } }),
  ]);

  const parts: string[] = [];
  if (poLines) parts.push(`${poLines} PO line${poLines > 1 ? 's' : ''}`);
  if (grnLines) parts.push(`${grnLines} GRN line${grnLines > 1 ? 's' : ''}`);

  if (parts.length === 0) return { canDelete: true, message: '' };
  return { canDelete: false, message: `Cannot delete: ${parts.join(', ')} reference this material` };
}
