/**
 * Refresh GST on every active PO line from the HSN master.
 *
 * Targets lines whose InventoryItem has a hsnCodeId set. For each line we:
 *   1. Re-read current effective GstRate from master
 *   2. Re-split CGST/SGST vs IGST based on the PO's supplyType
 *   3. Recompute taxableAmount, lineTotal, totalGst
 *   4. Roll up header totals (totalCgst/sgst/igst/gst, grandTotal)
 *
 * Scope: PO.status in DRAFT, APPROVED, SENT, PARTIAL_RECEIVED (not CLOSED /
 * CANCELLED / ARCHIVED — those are frozen history).
 *
 *   cd backend
 *   npx ts-node scripts/refresh_po_lines_from_hsn.ts --dry-run
 *   npx ts-node scripts/refresh_po_lines_from_hsn.ts --category=RAW_MATERIAL
 *   npx ts-node scripts/refresh_po_lines_from_hsn.ts                   # all
 */
import prisma from '../src/config/prisma';
import { getEffectiveGstRate, computeGstSplit } from '../src/services/taxRateLookup';

const DRY_RUN = process.argv.includes('--dry-run');
const CATEGORY_ARG = process.argv.find((a) => a.startsWith('--category='))?.split('=')[1];
const ACTIVE_STATUSES = ['DRAFT', 'APPROVED', 'SENT', 'PARTIAL_RECEIVED'];

async function main() {
  console.log(DRY_RUN ? '[refresh-po] DRY RUN' : '[refresh-po] LIVE');
  if (CATEGORY_ARG) console.log(`  · category filter: ${CATEGORY_ARG}`);

  // Find candidate POs
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      ...(CATEGORY_ARG
        ? { lines: { some: { inventoryItem: { category: CATEGORY_ARG } } } }
        : {}),
    },
    select: {
      id: true, poNo: true, status: true, supplyType: true, poDate: true,
      subtotal: true, totalCgst: true, totalSgst: true, totalIgst: true, totalGst: true,
      freightCharge: true, otherCharges: true, roundOff: true, grandTotal: true,
      lines: {
        select: {
          id: true, quantity: true, rate: true, discountPercent: true, isRateInclusive: true,
          gstPercent: true, cgstAmount: true, sgstAmount: true, igstAmount: true, totalGst: true,
          taxableAmount: true, lineTotal: true, hsnCode: true, hsnCodeId: true,
          inventoryItem: {
            select: {
              id: true, name: true, category: true, hsnCodeId: true, hsnCode: true,
              gstOverridePercent: true, gstOverrideReason: true, gstPercent: true,
            },
          },
        },
      },
    },
  });

  console.log(`Scanning ${pos.length} active PO(s)`);

  let changedPos = 0;
  let changedLines = 0;
  const report: Array<{ poNo: number; lines: number; oldTotal: number; newTotal: number }> = [];

  for (const po of pos) {
    let headerCgst = 0, headerSgst = 0, headerIgst = 0;
    let headerSubtotal = 0;
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

    for (const l of po.lines) {
      const mat = l.inventoryItem;
      // Use the line's own hsn FK if set, else fall back to the item's
      const effHsnId = l.hsnCodeId ?? mat?.hsnCodeId ?? null;

      const resolved = await getEffectiveGstRate({
        hsnCodeId: effHsnId,
        on: po.poDate,
        itemOverridePercent: mat?.gstOverridePercent,
        itemOverrideReason: mat?.gstOverrideReason,
        legacyGstPercent: mat?.gstPercent ?? l.gstPercent,
      });
      const newGst = resolved.rate;

      // Preserve the existing taxableAmount (respects OPEN-deal qty=999999
      // sentinel that was booked as 0 at PO create). Only rescale the GST
      // portion to the new rate. Lines with taxable=0 remain 0.
      const taxable = l.taxableAmount || 0;
      const split = computeGstSplit({
        amount: taxable,
        gstPercent: newGst,
        supplyType: (po.supplyType as 'INTRA_STATE' | 'INTER_STATE'),
        isInclusive: false, // taxable is already net of tax regardless of original flag
      });

      headerCgst += split.cgstAmount;
      headerSgst += split.sgstAmount;
      headerIgst += split.igstAmount;
      headerSubtotal += taxable;

      const changed =
        (l.gstPercent ?? 0) !== newGst ||
        Math.abs((l.totalGst ?? 0) - split.totalGst) > 0.01 ||
        (l.hsnCodeId ?? null) !== effHsnId;

      if (changed) {
        changedLines++;
        updates.push({
          id: l.id,
          data: {
            hsnCodeId: effHsnId,
            hsnCode: mat?.hsnCode || l.hsnCode,
            gstPercent: newGst,
            rateSnapshotGst: newGst,
            // taxableAmount left as-is (authoritative)
            cgstPercent: po.supplyType === 'INTRA_STATE' ? newGst / 2 : 0,
            cgstAmount: split.cgstAmount,
            sgstPercent: po.supplyType === 'INTRA_STATE' ? newGst / 2 : 0,
            sgstAmount: split.sgstAmount,
            igstPercent: po.supplyType === 'INTER_STATE' ? newGst : 0,
            igstAmount: split.igstAmount,
            totalGst: split.totalGst,
            lineTotal: Math.round((taxable + split.totalGst) * 100) / 100,
          },
        });
      }
    }

    if (updates.length === 0) continue;

    const newTotalGst = headerCgst + headerSgst + headerIgst;
    const newGrandTotal = headerSubtotal + newTotalGst + (po.freightCharge || 0) + (po.otherCharges || 0) + (po.roundOff || 0);

    report.push({
      poNo: po.poNo,
      lines: updates.length,
      oldTotal: po.grandTotal,
      newTotal: Math.round(newGrandTotal * 100) / 100,
    });

    console.log(
      `  ~ PO #${po.poNo} (${po.status}) — ${updates.length} line(s); ` +
        `grandTotal ₹${po.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} → ` +
        `₹${newGrandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
    );

    if (!DRY_RUN) {
      await prisma.$transaction([
        ...updates.map((u) => prisma.pOLine.update({ where: { id: u.id }, data: u.data })),
        prisma.purchaseOrder.update({
          where: { id: po.id },
          data: {
            subtotal: Math.round(headerSubtotal * 100) / 100,
            totalCgst: Math.round(headerCgst * 100) / 100,
            totalSgst: Math.round(headerSgst * 100) / 100,
            totalIgst: Math.round(headerIgst * 100) / 100,
            totalGst: Math.round(newTotalGst * 100) / 100,
            grandTotal: Math.round(newGrandTotal * 100) / 100,
          },
        }),
      ]);
      changedPos++;
    } else {
      changedPos++;
    }
  }

  console.log('─────────────────────────────────────────');
  console.log(`POs changed   : ${changedPos}`);
  console.log(`Lines updated : ${changedLines}`);
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
