import { prisma, syncToInventory, WeighmentInput, PushContext, PushOutcome, emptyOutcome } from '../shared';

/**
 * INBOUND + TRADER → Running monthly PO
 *
 * One open PO per trader per month. New deliveries are added as new PO lines.
 * Stale POs from previous months are auto-closed.
 *
 * Race condition fix from Codex audit:
 * - existingPO read moved INSIDE transaction to prevent two concurrent first
 *   deliveries from creating two POs for the same trader.
 */
export async function handleTraderInbound(w: WeighmentInput, _ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();
  const netKg = w.weight_net || 0;
  const rate = w.rate || 0;
  const materialName = w.material || 'Unknown';
  const wbRef = _ctx.wbRef;

  // Validate rate and material
  if (!rate || rate <= 0) {
    out.results.push({ id: w.id, type: 'SKIPPED', refNo: `Trader weighment missing rate`, sourceWbId: w.id });
    return out;
  }
  if (!materialName || materialName === 'Unknown') {
    out.results.push({ id: w.id, type: 'SKIPPED', refNo: `Trader weighment missing material`, sourceWbId: w.id });
    return out;
  }

  // Find the trader's vendor record and enforce isAgent
  const trader = await prisma.vendor.findUnique({
    where: { id: w.supplier_id! },
    select: { id: true, name: true, isAgent: true },
  });
  if (!trader || !trader.isAgent) {
    out.results.push({ id: w.id, type: 'SKIPPED', refNo: `Trader ${w.supplier_id} not found or not an agent`, sourceWbId: w.id });
    return out;
  }

  // Find matching inventory item by name
  const invItem = await prisma.inventoryItem.findFirst({
    where: { name: { equals: materialName, mode: 'insensitive' }, isActive: true },
    select: { id: true, name: true, unit: true, hsnCode: true, gstPercent: true },
  });

  // Convert KG to item's unit + convert rate from ₹/KG to ₹/unit
  const unit = invItem?.unit?.toUpperCase() || 'KG';
  let receivedQty: number;
  let unitRate: number;
  switch (unit) {
    case 'MT': receivedQty = netKg / 1000; unitRate = rate * 1000; break;
    case 'QUINTAL': case 'QTL': receivedQty = netKg / 100; unitRate = rate * 100; break;
    default: receivedQty = netKg; unitRate = rate; break;
  }

  // Calculate totals for this delivery
  const lineAmount = Math.round(receivedQty * unitRate * 100) / 100;
  const gstPct = invItem?.gstPercent ?? 0;
  const gstAmount = Math.round(lineAmount * gstPct / 100 * 100) / 100;
  const cgst = Math.round(gstAmount / 2 * 100) / 100;
  const sgst = Math.round(gstAmount / 2 * 100) / 100;
  const lineGrandTotal = Math.round((lineAmount + gstAmount) * 100) / 100;

  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Auto-close any stale running POs from previous months (outside txn — idempotent)
  await prisma.purchaseOrder.updateMany({
    where: {
      vendorId: trader.id,
      dealType: 'OPEN',
      status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
      poDate: { lt: firstOfMonth },
    },
    data: { status: 'RECEIVED' },
  });

  // RACE FIX 3: Read existingPO INSIDE transaction to prevent concurrent first-delivery races
  const { po, grn } = await prisma.$transaction(async (tx) => {
    const existingPO = await tx.purchaseOrder.findFirst({
      where: {
        vendorId: trader.id,
        dealType: 'OPEN',
        status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
        poDate: { gte: firstOfMonth },
      },
      orderBy: { poDate: 'desc' },
      include: { lines: { select: { id: true, lineNo: true } } },
    });

    if (existingPO) {
      // Add delivery line to existing running PO
      const maxLine = await tx.pOLine.findFirst({
        where: { poId: existingPO.id },
        orderBy: { lineNo: 'desc' },
        select: { lineNo: true },
      });
      const newLineNo = (maxLine?.lineNo ?? 0) + 1;

      const poLine = await tx.pOLine.create({
        data: {
          poId: existingPO.id,
          lineNo: newLineNo,
          inventoryItemId: invItem?.id || null,
          description: `${materialName} | ${w.vehicle_no || 'N/A'}`,
          hsnCode: invItem?.hsnCode || '',
          quantity: receivedQty,
          unit: invItem?.unit || 'KG',
          rate: unitRate,
          amount: lineAmount,
          pendingQty: 0,
          receivedQty,
          gstPercent: gstPct,
          cgstAmount: cgst,
          sgstAmount: sgst,
          taxableAmount: lineAmount,
          lineTotal: lineGrandTotal,
        },
      });

      // Update PO totals (add this delivery's amounts)
      await tx.purchaseOrder.update({
        where: { id: existingPO.id },
        data: {
          subtotal: { increment: lineAmount },
          totalCgst: { increment: cgst },
          totalSgst: { increment: sgst },
          totalGst: { increment: gstAmount },
          grandTotal: { increment: lineGrandTotal },
          status: 'PARTIAL_RECEIVED',
          remarks: `Running PO | ${existingPO.lines.length + 1} deliveries | ${trader.name}`,
        },
      });

      // Create GRN for this delivery
      const grn = await tx.goodsReceipt.create({
        data: {
          poId: existingPO.id,
          vendorId: trader.id,
          grnDate: new Date(),
          vehicleNo: w.vehicle_no,
          totalQty: receivedQty,
          totalAmount: lineAmount,
          status: 'CONFIRMED',
          remarks: `${wbRef} | Trader: ${trader.name} | Running PO-${existingPO.poNo} | Auto-confirmed (weighbridge verified)`,
          userId: 'system-weighbridge',
          lines: {
            create: [{
              poLineId: poLine.id,
              inventoryItemId: invItem?.id || null,
              description: `${materialName} | ${w.vehicle_no || 'N/A'}`,
              receivedQty,
              acceptedQty: receivedQty,
              rejectedQty: 0,
              unit: invItem?.unit || 'KG',
              rate: unitRate,
              amount: lineAmount,
            }],
          },
        },
      });

      return { po: { id: existingPO.id, poNo: existingPO.poNo }, grn };
    } else {
      // Create new running PO for this trader
      const newPo = await tx.purchaseOrder.create({
        data: {
          vendorId: trader.id,
          dealType: 'OPEN',
          status: 'PARTIAL_RECEIVED',
          poDate: new Date(),
          paymentTerms: 'ADVANCE',
          subtotal: lineAmount,
          totalCgst: cgst,
          totalSgst: sgst,
          totalGst: gstAmount,
          grandTotal: lineGrandTotal,
          remarks: `Running PO | 1 delivery | ${trader.name}`,
          userId: 'system-weighbridge',
          lines: {
            create: [{
              lineNo: 1,
              inventoryItemId: invItem?.id || null,
              description: `${materialName} | ${w.vehicle_no || 'N/A'}`,
              hsnCode: invItem?.hsnCode || '',
              quantity: receivedQty,
              unit: invItem?.unit || 'KG',
              rate: unitRate,
              amount: lineAmount,
              pendingQty: 0,
              receivedQty,
              gstPercent: gstPct,
              cgstAmount: cgst,
              sgstAmount: sgst,
              taxableAmount: lineAmount,
              lineTotal: lineGrandTotal,
            }],
          },
        },
        include: { lines: { select: { id: true, lineNo: true } } },
      });

      const grn = await tx.goodsReceipt.create({
        data: {
          poId: newPo.id,
          vendorId: trader.id,
          grnDate: new Date(),
          vehicleNo: w.vehicle_no,
          totalQty: receivedQty,
          totalAmount: lineAmount,
          status: 'CONFIRMED',
          remarks: `${wbRef} | Trader: ${trader.name} | Running PO-${newPo.poNo} | Auto-confirmed (weighbridge verified)`,
          userId: 'system-weighbridge',
          lines: {
            create: [{
              poLineId: newPo.lines[0].id,
              inventoryItemId: invItem?.id || null,
              description: `${materialName} | ${w.vehicle_no || 'N/A'}`,
              receivedQty,
              acceptedQty: receivedQty,
              rejectedQty: 0,
              unit: invItem?.unit || 'KG',
              rate: unitRate,
              amount: lineAmount,
            }],
          },
        },
      });

      return { po: { id: newPo.id, poNo: newPo.poNo }, grn };
    }
  });

  // Sync inventory (best-effort, post-commit)
  if (invItem?.id) {
    try {
      await syncToInventory(
        'GRN', grn.id, `GRN-${grn.grnNo}`,
        invItem.id, receivedQty, unitRate,
        'IN', 'GRN_RECEIPT',
        `Auto-GRN from trader weighbridge: ${w.vehicle_no} | ${trader.name} | Running PO-${po.poNo}`,
        'system-weighbridge',
      );
    } catch (invErr) {
      console.error(`[TRADER] Inventory sync failed for GRN-${grn.grnNo}: ${invErr}`);
    }
  }

  out.results.push({ id: grn.id, type: 'TRADER_GRN', refNo: `GRN-${grn.grnNo} | Running PO-${po.poNo}`, sourceWbId: w.id });
  out.ids.push(grn.id);
  return out;
}
