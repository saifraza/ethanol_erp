import { prisma, WeighmentInput, PushContext, PushOutcome, emptyOutcome, syncToInventory } from '../shared';

/**
 * INBOUND + SPOT → DirectPurchase + Farmer + Inventory
 *
 * Farmer-direct purchase. Steps:
 *   1. Upsert Farmer by phone (fallback aadhaar). Captures the seller in the
 *      farmer master so the next trip rolls up under the same ledger.
 *   2. Create DirectPurchase row linked to that farmer.
 *   3. Increment InventoryItem stock for the material via syncToInventory
 *      (atomic — uses { increment } at the DB layer, not read-modify-write).
 *
 * Vendor model deliberately not touched — farmers are NOT vendors. They get
 * their own master + ledger via the Farmer model. See backend/prisma/schema.prisma.
 */
export async function handleSpotInbound(w: WeighmentInput, ctx: PushContext): Promise<PushOutcome> {
  const out = emptyOutcome();
  const netKg = w.weight_net || 0;
  const rate = w.rate || 0;
  const amount = Math.round(netKg * rate * 100) / 100;
  const deductions = w.deductions || 0;
  const netPayable = Math.round((amount - deductions) * 100) / 100;

  // ── 1. Upsert Farmer by phone (primary), aadhaar (fallback) ──
  const phone = (w.seller_phone || '').replace(/\D/g, '').slice(-10) || null;
  const aadhaar = w.seller_aadhaar || null;
  // Maan number arrives stuffed into remarks as "MAAN:xxx | ..." — see
  // factory-server/src/routes/weighbridge.ts. Extract it for the farmer master.
  const maanMatch = (w.remarks || '').match(/MAAN:([^\s|]+)/);
  const maanNumber = maanMatch ? maanMatch[1].trim() : null;

  let farmer = null;
  if (phone) {
    farmer = await prisma.farmer.findFirst({ where: { phone } });
  }
  if (!farmer && aadhaar) {
    farmer = await prisma.farmer.findFirst({ where: { aadhaar } });
  }
  if (!farmer && (w.supplier_name || phone || aadhaar)) {
    const count = await prisma.farmer.count();
    const code = `F-${String(count + 1).padStart(4, '0')}`;
    farmer = await prisma.farmer.create({
      data: {
        code,
        name: w.supplier_name || 'Unknown Farmer',
        phone,
        aadhaar,
        maanNumber,
        village: w.seller_village || null,
        rawMaterialTypes: w.material || null,
        kycStatus: 'PENDING',
        isRCM: true,
        companyId: w.company_id || null,
      },
    });
  } else if (farmer && maanNumber && !farmer.maanNumber) {
    // Existing farmer, no maan number on file — backfill from this trip.
    farmer = await prisma.farmer.update({ where: { id: farmer.id }, data: { maanNumber } });
  }

  // ── 2. Create DirectPurchase, link to farmer ──
  const dp = await prisma.directPurchase.create({
    data: {
      date: w.created_at ? new Date(w.created_at) : new Date(),
      sellerName: w.supplier_name || (farmer?.name ?? 'Unknown'),
      sellerPhone: phone || '',
      sellerVillage: w.seller_village || '',
      sellerAadhaar: aadhaar || '',
      materialName: w.material || 'Grain',
      quantity: netKg,
      unit: 'KG',
      rate,
      amount,
      vehicleNo: w.vehicle_no,
      weightSlipNo: `WB-${w.ticket_no}`,
      grossWeight: w.weight_gross,
      tareWeight: w.weight_tare,
      netWeight: w.weight_net,
      paymentMode: w.payment_mode || 'CASH',
      paymentRef: w.payment_ref || '',
      deductions,
      deductionReason: w.deduction_reason || '',
      netPayable,
      remarks: `${ctx.wbRef} | Auto from weighbridge`,
      userId: 'system-weighbridge',
      farmerId: farmer?.id ?? null,
      companyId: w.company_id || null,
    },
  });

  // ── 3. Push qty into inventory ──
  // Resolve InventoryItem by name (case-insensitive, active only). Falls back
  // to a no-op if the item master doesn't have the material — operator can
  // reconcile later via stock adjustment.
  if (netKg > 0 && w.material) {
    const item = await prisma.inventoryItem.findFirst({
      where: { name: { equals: w.material, mode: 'insensitive' }, isActive: true },
      select: { id: true },
    });
    if (item) {
      try {
        await syncToInventory(
          'DIRECT_PURCHASE',
          dp.id,
          `DP-${dp.entryNo}`,
          item.id,
          netKg,
          rate,
          'IN',
          'GRN_RECEIPT',
          `Farmer direct ${w.supplier_name || ''} | ${w.vehicle_no}`,
          'system-weighbridge',
        );
      } catch (err) {
        console.error('[SpotInbound] inventory sync failed:', err instanceof Error ? err.message : err);
      }
    } else {
      console.warn(`[SpotInbound] InventoryItem not found for material="${w.material}". DirectPurchase ${dp.id} created but stock not incremented.`);
    }
  }

  out.results.push({ id: dp.id, type: 'DirectPurchase', refNo: `DP-${dp.entryNo}`, sourceWbId: w.id });
  out.ids.push(dp.id);
  return out;
}
