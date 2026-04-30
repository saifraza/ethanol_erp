import { prisma, syncToInventory, convertToUnit, WeighmentInput, PushContext, PushOutcome, emptyOutcome } from '../shared';
import { notify } from '../../../services/notify';

/**
 * INBOUND + PO/JOB_WORK → Auto-create GRN
 *
 * Handles:
 * - Lab FAIL: Quarantine GrainTruck (grain) or reject (fuel)
 * - Lab PASS/PENDING: Create GRN, update PO line, sync inventory, optional approval
 *
 * Race condition fixes from Codex audit:
 * - Truck cap check moved INSIDE transaction
 * - PO line receivedQty/pendingQty use atomic increment/decrement (not stale read+write)
 */
export async function handlePoInbound(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();

  if (!w.po_id) {
    out.results.push({ id: w.id, type: 'SKIPPED', refNo: 'PO id missing', sourceWbId: w.id });
    out.ids.push(w.id);
    return out;
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: w.po_id },
    include: {
      lines: { orderBy: { createdAt: 'asc' } },
      vendor: { select: { id: true, name: true } },
    },
  });

  // Validate PO is still receivable
  const receivableStatuses = ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'];
  // OPEN deals (running accounts) can receive even after RECEIVED status —
  // their qty is a convention (999999), not a real cap.
  if (po?.dealType === 'OPEN') receivableStatuses.push('RECEIVED');
  if (!po || !receivableStatuses.includes(po.status)) {
    if (!po) {
      out.results.push({ id: w.id, type: 'SKIPPED', refNo: `PO ${w.po_id} not found`, sourceWbId: w.id });
    } else {
      out.results.push({ id: w.id, type: 'SKIPPED', refNo: `PO-${po.poNo} not receivable (status=${po.status})`, sourceWbId: w.id });
    }
    out.ids.push(w.id);
    return out;
  }

  const netKg = w.weight_net || 0;
  // Find matching PO line — prefer explicit po_line_id, fall back to first line with pending qty
  const poLine = w.po_line_id
    ? po.lines.find(l => l.id === w.po_line_id)
    : po.lines.find(l => l.pendingQty > 0) || po.lines[0];

  if (!poLine) {
    out.results.push({ id: w.id, type: 'SKIPPED', refNo: `PO-${po.poNo} no lines`, sourceWbId: w.id });
    out.ids.push(w.id);
    return out;
  }

  const receivedQty = convertToUnit(netKg, poLine.unit);
  const rate = poLine.rate;

  // Overage tolerance: check if this delivery pushes total received beyond PO qty + 5%
  // OPEN deals have no qty limit (running account with fixed rate) — never flag overage.
  const newTotalReceived = poLine.receivedQty + receivedQty;
  const overageQty = newTotalReceived - poLine.quantity;
  const overagePercent = poLine.quantity > 0 ? (overageQty / poLine.quantity) * 100 : (newTotalReceived > 0 ? 100 : 0);
  let needsApproval = false;
  if (po.dealType !== 'OPEN' && overageQty > 0 && overagePercent > 5) needsApproval = true;

  // ── LAB FAIL → Quarantine GrainTruck (grain/RM) or reject (fuel), skip GRN ──
  if (w.lab_status === 'FAIL') {
    if (ctx.isFuel) {
      out.results.push({ id: w.id, type: 'FUEL_LAB_FAIL', refNo: `PO-${po.poNo} | ${w.vehicle_no} rejected`, sourceWbId: w.id });
      out.ids.push(w.id);
      return out;
    }
    const grossTon = (w.weight_gross || 0) / 1000;
    const tareTon = (w.weight_tare || 0) / 1000;
    const netTon = netKg / 1000;
    const labInfo = w.lab_remarks ? ` | Lab: ${w.lab_remarks}` : '';
    const existingTruck = await prisma.grainTruck.findFirst({
      where: {
        OR: [
          { factoryLocalId: w.id },
          { remarks: { contains: `WB:${w.id}` } },
        ],
      },
      select: { id: true },
    });
    const truckData = {
      date: w.created_at ? new Date(w.created_at) : new Date(),
      uidRst: ctx.wbUidRst,
      vehicleNo: w.vehicle_no,
      supplier: po.vendor.name || w.supplier_name || '',
      weightGross: grossTon,
      weightTare: tareTon,
      weightNet: netTon,
      moisture: w.lab_moisture ?? undefined,
      starchPercent: w.lab_starch ?? undefined,
      damagedPercent: w.lab_damaged ?? undefined,
      foreignMatter: w.lab_foreign_matter ?? undefined,
      quarantine: true,
      quarantineWeight: netTon,
      quarantineReason: `QUARANTINE — Lab FAIL | PO-${po.poNo}${labInfo}`,
      bags: w.bags ?? undefined,
      remarks: `${ctx.wbRef} | QUARANTINE — Lab FAIL | PO-${po.poNo}${labInfo}`,
      poId: po.id,
      grnId: null,
      materialId: poLine.inventoryItemId || undefined,
      vehicleType: w.vehicle_type || undefined,
      driverName: w.driver_name || undefined,
      driverMobile: w.driver_mobile || undefined,
      transporterName: w.transporter || undefined,
      materialType: w.material || undefined,
      ticketNo: w.ticket_no || undefined,
      companyId: w.company_id || po.companyId || undefined,
    };
    const truck = existingTruck
      ? await prisma.grainTruck.update({
          where: { id: existingTruck.id },
          data: truckData,
        })
      : await prisma.grainTruck.create({
          data: {
            ...truckData,
            factoryLocalId: w.id,
          },
        });

    out.results.push({ id: truck.id, type: 'QUARANTINE', refNo: `PO-${po.poNo} | Vehicle ${w.vehicle_no}`, sourceWbId: w.id });
    out.ids.push(truck.id);
    return out;
  }

  // ── LAB PASS or PENDING/unset → Normal GRN flow ──
  const grnDate = w.created_at ? new Date(w.created_at) : new Date();
  const labRemarksSuffix = w.lab_status === 'PASS'
    ? ` | Lab PASS${w.lab_moisture != null ? ` (M:${w.lab_moisture}%)` : ''}`
    : '';

  // Create GRN + update PO + truck cap check ALL inside transaction (race fix)
  let grn;
  try {
    grn = await prisma.$transaction(async (tx) => {
      // RACE FIX 1: Truck cap check INSIDE transaction
      if (po.truckCap) {
        const grnCount = await tx.goodsReceipt.count({ where: { poId: po.id, status: 'CONFIRMED' } });
        if (grnCount >= po.truckCap) {
          throw new Error(`TRUCK_CAP_REACHED:${po.truckCap}`);
        }
      }

      // If a PARTIAL GRN already exists for this PO ("paid & awaiting"),
      // fill it with received qty and flip to CONFIRMED instead of creating a new row.
      const partial = await tx.goodsReceipt.findFirst({
        where: { poId: po.id, status: 'PARTIAL', archived: false },
        include: { lines: true },
      });

      let grn;
      if (partial) {
        // Find or create the line for this poLine
        const matchingLine = partial.lines.find(l => l.poLineId === poLine.id);
        if (matchingLine) {
          await tx.gRNLine.update({
            where: { id: matchingLine.id },
            data: {
              receivedQty,
              acceptedQty: receivedQty,
              rejectedQty: 0,
              rate,
              amount: Math.round(receivedQty * rate * 100) / 100,
              remarks: `Vehicle: ${w.vehicle_no}${labRemarksSuffix}`,
            },
          });
        } else {
          await tx.gRNLine.create({
            data: {
              grnId: partial.id,
              poLineId: poLine.id,
              inventoryItemId: poLine.inventoryItemId || null,
              description: poLine.description || w.material || '',
              receivedQty,
              acceptedQty: receivedQty,
              rejectedQty: 0,
              unit: poLine.unit || 'KG',
              rate,
              amount: Math.round(receivedQty * rate * 100) / 100,
              storageLocation: '',
              batchNo: '',
              remarks: `Vehicle: ${w.vehicle_no}${labRemarksSuffix}`,
            },
          });
        }

        grn = await tx.goodsReceipt.update({
          where: { id: partial.id },
          data: {
            status: 'CONFIRMED',
            grnDate,
            vehicleNo: w.vehicle_no,
            remarks: `${ctx.wbRef} | Filled from PARTIAL via weighbridge${labRemarksSuffix}`,
            totalAmount: Math.round(receivedQty * rate * 100) / 100,
            totalQty: receivedQty,
            grossWeight: w.weight_gross != null ? w.weight_gross / 1000 : null,
            tareWeight: w.weight_tare != null ? w.weight_tare / 1000 : null,
            netWeight: netKg / 1000,
            firstWeightAt: w.first_weight_at ? new Date(w.first_weight_at) : null,
            secondWeightAt: w.second_weight_at ? new Date(w.second_weight_at) : null,
            ticketNo: w.ticket_no || null,
            driverName: w.driver_name || null,
            driverMobile: w.driver_mobile || null,
            transporterName: w.transporter || null,
            companyId: w.company_id || po.companyId || null,
          },
          include: { lines: true },
        });
      } else {
        grn = await tx.goodsReceipt.create({
        data: {
          poId: po.id,
          vendorId: po.vendorId,
          grnDate,
          vehicleNo: w.vehicle_no,
          challanNo: '',
          invoiceNo: '',
          remarks: `${ctx.wbRef} | Auto-GRN from weighbridge${labRemarksSuffix} | Auto-confirmed (weighbridge verified)`,
          totalAmount: Math.round(receivedQty * rate * 100) / 100,
          totalQty: receivedQty,
          // Weighbridge data — preserved for drill-down view + audit
          grossWeight: w.weight_gross != null ? w.weight_gross / 1000 : null,
          tareWeight: w.weight_tare != null ? w.weight_tare / 1000 : null,
          netWeight: netKg / 1000,
          firstWeightAt: w.first_weight_at ? new Date(w.first_weight_at) : null,
          secondWeightAt: w.second_weight_at ? new Date(w.second_weight_at) : null,
          ticketNo: w.ticket_no || null,
          driverName: w.driver_name || null,
          driverMobile: w.driver_mobile || null,
          transporterName: w.transporter || null,
          companyId: w.company_id || po.companyId || null,
          status: 'CONFIRMED',
          userId: 'system-weighbridge',
          lines: {
            create: [{
              poLineId: poLine.id,
              inventoryItemId: poLine.inventoryItemId || null,
              description: poLine.description || w.material || '',
              receivedQty,
              acceptedQty: receivedQty,
              rejectedQty: 0,
              unit: poLine.unit || 'KG',
              rate,
              amount: Math.round(receivedQty * rate * 100) / 100,
              storageLocation: '',
              batchNo: '',
              remarks: `Vehicle: ${w.vehicle_no}${labRemarksSuffix}`,
            }],
          },
        },
        include: { lines: true },
      });
      }

      // RACE FIX 2: Atomic increment/decrement on PO line (not stale read+write)
      await tx.pOLine.update({
        where: { id: poLine.id },
        data: {
          receivedQty: { increment: receivedQty },
          pendingQty: { decrement: receivedQty },
        },
      });

      // Re-fetch all PO lines to compute status from current values
      if (po.truckCap) {
        // Truck-based PO: completion by GRN count
        const grnCount = await tx.goodsReceipt.count({ where: { poId: po.id, status: 'CONFIRMED' } });
        if (grnCount >= po.truckCap) {
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'RECEIVED' } });
        } else {
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'PARTIAL_RECEIVED' } });
        }
      } else {
        const allLines = await tx.pOLine.findMany({ where: { poId: po.id } ,
    take: 500,
  });
        const allDone = allLines.every(l => l.pendingQty <= 0);
        const anyPartial = allLines.some(l => l.receivedQty > 0 && l.pendingQty > 0);
        if (allDone && po.dealType !== 'OPEN') {
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'RECEIVED' } });
        } else if (anyPartial) {
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'PARTIAL_RECEIVED' } });
        }
      }

      // Clamp any pendingQty that went negative (overage) back to 0
      await tx.pOLine.updateMany({
        where: { poId: po.id, pendingQty: { lt: 0 } },
        data: { pendingQty: 0 },
      });

      return grn;
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('TRUCK_CAP_REACHED:')) {
      const cap = err.message.split(':')[1];
      out.results.push({ id: w.id, type: 'SKIPPED', refNo: `PO-${po.poNo} truck cap (${cap}) reached`, sourceWbId: w.id });
      out.ids.push(w.id);
      return out;
    }
    throw err;
  }

  // ── Post-commit best-effort side effects ──
  // GrainTruck traceability for grain (skip for fuel)
  if (!ctx.isFuel && (w.lab_moisture != null || w.lab_starch != null)) {
    const grossTon = (w.weight_gross || 0) / 1000;
    const tareTon = (w.weight_tare || 0) / 1000;
    const netTon = netKg / 1000;
    const existingTruck = await prisma.grainTruck.findFirst({
      where: {
        OR: [
          { factoryLocalId: w.id },
          { remarks: { contains: `WB:${w.id}` } },
        ],
      },
      select: { id: true },
    });
    const grainTruckData = {
      date: w.created_at ? new Date(w.created_at) : new Date(),
      uidRst: ctx.wbUidRst,
      vehicleNo: w.vehicle_no,
      supplier: po.vendor.name || w.supplier_name || '',
      weightGross: grossTon,
      weightTare: tareTon,
      weightNet: netTon,
      moisture: w.lab_moisture ?? undefined,
      starchPercent: w.lab_starch ?? undefined,
      damagedPercent: w.lab_damaged ?? undefined,
      foreignMatter: w.lab_foreign_matter ?? undefined,
      quarantine: w.lab_status === 'PASS' ? false : undefined,
      quarantineWeight: w.lab_status === 'PASS' ? 0 : undefined,
      quarantineReason: w.lab_status === 'PASS' ? '' : undefined,
      bags: w.bags ?? undefined,
      remarks: `${ctx.wbRef} | GRN-${grn.grnNo} | PO-${po.poNo}${labRemarksSuffix}`,
      poId: po.id,
      grnId: grn.id,
      materialId: poLine.inventoryItemId || undefined,
      vehicleType: w.vehicle_type || undefined,
      driverName: w.driver_name || undefined,
      driverMobile: w.driver_mobile || undefined,
      transporterName: w.transporter || undefined,
      materialType: w.material || undefined,
      ticketNo: w.ticket_no || undefined,
      companyId: w.company_id || po.companyId || undefined,
    };
    const persistTruck = existingTruck
      ? prisma.grainTruck.update({
          where: { id: existingTruck.id },
          data: grainTruckData,
        })
      : prisma.grainTruck.create({
          data: {
            ...grainTruckData,
            factoryLocalId: w.id,
          },
        });
    await persistTruck.catch(() => {});
  }

  // Inventory sync
  if (poLine.inventoryItemId) {
    try {
      await syncToInventory(
        'GRN', grn.id, `GRN-${grn.grnNo}`,
        poLine.inventoryItemId, receivedQty, rate,
        'IN', 'GRN_RECEIPT',
        `Auto-GRN from weighbridge: ${w.vehicle_no} | Auto-confirmed`,
        'system-weighbridge',
      );
    } catch (invErr) {
      console.error(`[WB] Inventory sync failed for GRN-${grn.grnNo}: ${invErr}`);
    }
  }

  // Approval record if overage > 5% (never for OPEN deals — guarded above)
  if (needsApproval) {
    const approval = await prisma.approval.create({
      data: {
        type: 'PO_OVERAGE',
        status: 'PENDING',
        entityType: 'GoodsReceipt',
        entityId: grn.id,
        title: `PO-${po.poNo} overage ${overagePercent.toFixed(1)}%`,
        description: `Vehicle ${w.vehicle_no} delivered ${receivedQty.toFixed(2)} ${poLine.unit} against PO-${po.poNo} (ordered ${poLine.quantity} ${poLine.unit}). Overage: ${overageQty.toFixed(2)} ${poLine.unit} (${overagePercent.toFixed(1)}%). GRN-${grn.grnNo} created as DRAFT for admin review.`,
        requestedBy: 'system-weighbridge',
        metadata: { poNo: po.poNo, grnNo: grn.grnNo, orderedQty: poLine.quantity, receivedQty, overageQty: Math.round(overageQty * 100) / 100, overagePercent: Math.round(overagePercent * 10) / 10, vehicleNo: w.vehicle_no },
      },
    }).catch(() => null);

    if (approval) {
      await notify({
        category: 'APPROVAL',
        severity: 'WARNING',
        role: 'ADMIN',
        title: `PO-${po.poNo} overage ${overagePercent.toFixed(1)}%`,
        message: `${w.vehicle_no} delivered ${receivedQty.toFixed(2)} ${poLine.unit} — ${overageQty.toFixed(2)} ${poLine.unit} over PO line.`,
        link: '/admin/approvals',
        entityType: 'Approval',
        entityId: approval.id,
        dedupeKey: `po-overage:${grn.id}`,
        metadata: { poNo: po.poNo, grnNo: grn.grnNo, vehicleNo: w.vehicle_no },
      });
    }
  }

  out.results.push({ id: grn.id, type: needsApproval ? 'GRN_NEEDS_APPROVAL' : 'GRN', refNo: `GRN-${grn.grnNo}`, sourceWbId: w.id });
  out.ids.push(grn.id);
  return out;
}
