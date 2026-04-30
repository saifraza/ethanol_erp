/**
 * Shared PO creation logic — used by both the manual POST /purchase-orders
 * route and the auto-PO flow from indent issue.
 */
import prisma from '../config/prisma';

interface CreatePOLineInput {
  inventoryItemId: string | null;
  description: string;
  hsnCode?: string;
  quantity: number;
  unit: string;
  rate: number;
  gstPercent: number;
  discountPercent?: number;
  isRCM?: boolean;
}

interface CreatePOInput {
  vendorId: string;
  lines: CreatePOLineInput[];
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  placeOfSupply?: string;
  remarks?: string;
  requisitionId?: string;
  userId: string;
  paymentTerms?: string;
  creditDays?: number;
  deliveryDate?: Date;
  dealType?: string;
}

export async function createPurchaseOrder(input: CreatePOInput) {
  // Look up items for auto-fill (hsnCode, gstPercent defaults)
  const itemIds = input.lines.map(l => l.inventoryItemId).filter(Boolean) as string[];
  const itemsMap: Record<string, { name: string; hsnCode: string | null; gstPercent: number; unit: string }> = {};
  if (itemIds.length > 0) {
    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, hsnCode: true, gstPercent: true, unit: true },
    
    take: 500,
  });
    items.forEach(m => { itemsMap[m.id] = m; });
  }

  // Process lines with GST calculations
  const processedLines = input.lines.map(line => {
    const mat = line.inventoryItemId ? itemsMap[line.inventoryItemId] : null;
    const quantity = line.quantity;
    const rate = line.rate;
    const discountPercent = line.discountPercent || 0;
    const gstPercent = line.gstPercent || (mat?.gstPercent || 0);

    const amount = quantity * rate;
    const discountAmount = amount * (discountPercent / 100);
    const taxableAmount = amount - discountAmount;

    let cgstPercent = 0, sgstPercent = 0, igstPercent = 0;
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;

    if (input.supplyType === 'INTRA_STATE') {
      cgstPercent = gstPercent / 2;
      sgstPercent = gstPercent / 2;
      cgstAmount = taxableAmount * (cgstPercent / 100);
      sgstAmount = taxableAmount * (sgstPercent / 100);
    } else if (input.supplyType === 'INTER_STATE') {
      igstPercent = gstPercent;
      igstAmount = taxableAmount * (igstPercent / 100);
    }

    const totalGst = cgstAmount + sgstAmount + igstAmount;
    const lineTotal = taxableAmount + totalGst;

    return {
      inventoryItemId: line.inventoryItemId,
      materialId: null,
      description: line.description || mat?.name || '',
      hsnCode: line.hsnCode || mat?.hsnCode || '',
      quantity,
      unit: line.unit || mat?.unit || 'KG',
      rate,
      discountPercent,
      discountAmount,
      gstPercent,
      amount,
      taxableAmount,
      cgstPercent,
      cgstAmount,
      sgstPercent,
      sgstAmount,
      igstPercent,
      igstAmount,
      totalGst,
      lineTotal,
      isRCM: line.isRCM || false,
      pendingQty: quantity,
      receivedQty: 0,
    };
  });

  // Calculate header totals
  const subtotal = processedLines.reduce((sum, line) => sum + line.amount, 0);
  const totalCgst = processedLines.reduce((sum, line) => sum + line.cgstAmount, 0);
  const totalSgst = processedLines.reduce((sum, line) => sum + line.sgstAmount, 0);
  const totalIgst = processedLines.reduce((sum, line) => sum + line.igstAmount, 0);
  const totalGst = totalCgst + totalSgst + totalIgst;
  const grandTotal = subtotal + totalGst;

  // Get vendor for TDS check
  const vendor = await prisma.vendor.findUnique({
    where: { id: input.vendorId },
    select: { tdsApplicable: true, tdsPercent: true },
  });

  let tdsAmount = 0;
  if (vendor?.tdsApplicable) {
    tdsAmount = subtotal * ((vendor.tdsPercent || 0) / 100);
  }

  // Create PO with lines
  const po = await prisma.purchaseOrder.create({
    data: {
      vendorId: input.vendorId,
      poDate: new Date(),
      deliveryDate: input.deliveryDate || null,
      supplyType: input.supplyType,
      placeOfSupply: input.placeOfSupply || '',
      paymentTerms: input.paymentTerms || '',
      creditDays: input.creditDays || 0,
      dealType: input.dealType || 'STANDARD',
      remarks: input.remarks || '',
      requisitionId: input.requisitionId || null,
      subtotal,
      totalCgst,
      totalSgst,
      totalIgst,
      totalGst,
      freightCharge: 0,
      otherCharges: 0,
      roundOff: 0,
      grandTotal,
      tdsAmount,
      status: 'DRAFT',
      userId: input.userId,
      lines: {
        create: processedLines,
      },
    },
    include: { lines: true, vendor: { select: { id: true, name: true } } },
  });

  return po;
}
