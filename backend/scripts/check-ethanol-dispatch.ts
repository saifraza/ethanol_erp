import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // 2026-04-17 IST window
  const istStart = new Date('2026-04-16T18:30:00.000Z');
  const istEnd   = new Date('2026-04-17T18:30:00.000Z');

  console.log('\n==========================================');
  console.log('  2026-04-17 IST — Ethanol dispatch audit');
  console.log('==========================================');

  // 1) EVERY weighment whose secondWeightAt (truck physically left) falls on 17 Apr IST
  console.log('\n=== A) Weighment: secondWeightAt within 2026-04-17 IST (truck physically released) ===');
  const released = await p.weighment.findMany({
    where: {
      secondWeightAt: { gte: istStart, lt: istEnd },
    },
    select: {
      id: true, ticketNo: true, vehicleNo: true, materialName: true, materialCategory: true,
      purchaseType: true, supplierName: true, customerName: true,
      grossWeight: true, tareWeight: true, netWeight: true, quantityBL: true,
      status: true, cancelled: true,
      gateEntryAt: true, firstWeightAt: true, secondWeightAt: true, syncedAt: true,
    },
    orderBy: { secondWeightAt: 'asc' },
  });
  console.log(`Total released on 2026-04-17 IST: ${released.length}`);
  for (const r of released) {
    const mat = (r.materialName ?? '').toUpperCase();
    const tag = mat.includes('ETHANOL') ? ' ⬅ ETHANOL' : '';
    console.log(`  #${r.ticketNo} ${r.vehicleNo} ${r.materialName}/${r.purchaseType} net=${r.netWeight} BL=${r.quantityBL} ${r.supplierName ?? r.customerName ?? ''} -> 2w@${r.secondWeightAt?.toISOString()} status=${r.status}${tag}`);
  }

  // 2) Ethanol-only, same window, with all details
  console.log('\n=== B) Ethanol weighments released on 2026-04-17 IST (full detail) ===');
  const ethReleased = released.filter(r => (r.materialName ?? '').toLowerCase().includes('ethanol'));
  console.log(JSON.stringify(ethReleased, null, 2));

  // 3) All DispatchTruck rows linked to MASH (the ethanol customer) for last 3 days
  console.log('\n=== C) DispatchTruck rows for MASH BIO-FUELS — last 3 days ===');
  const mashStart = new Date('2026-04-15T18:30:00.000Z');
  const mashDt = await p.dispatchTruck.findMany({
    where: {
      partyName: { contains: 'MASH', mode: 'insensitive' },
      createdAt: { gte: mashStart, lt: istEnd },
    },
    select: {
      id: true, date: true, vehicleNo: true, partyName: true, quantityBL: true,
      weightGross: true, weightTare: true, weightNet: true,
      gateInTime: true, tareTime: true, grossTime: true, releaseTime: true,
      sourceWbId: true, challanNo: true, gatePassNo: true, rstNo: true,
      liftingId: true, contractId: true,
      createdAt: true, updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(JSON.stringify(mashDt, null, 2));
  console.log(`DispatchTruck (MASH, last 3d): ${mashDt.length}`);

  // 4) For each ethanol weighment released on 17 Apr, is there a matching DispatchTruck (by vehicleNo)?
  console.log('\n=== D) Cross-check: each ethanol weighment vs DispatchTruck ===');
  for (const w of ethReleased) {
    const match = mashDt.find(d => d.vehicleNo === w.vehicleNo);
    console.log(`  Weighment ticket=${w.ticketNo} vehicle=${w.vehicleNo}`);
    if (!match) {
      console.log(`    ❌ NO DispatchTruck row with vehicleNo=${w.vehicleNo}`);
    } else {
      console.log(`    ✅ DispatchTruck.id=${match.id} sourceWbId=${match.sourceWbId} weightNet=${match.weightNet}`);
      if (match.sourceWbId !== w.id && match.sourceWbId !== w.ticketNo?.toString()) {
        console.log(`    ⚠ sourceWbId mismatch: dt.sourceWbId=${match.sourceWbId} vs weighment.id=${w.id} / ticket=${w.ticketNo}`);
      }
    }
  }

  // 5) Invoices generated on 2026-04-17 IST for MASH (helps correlate with screenshot)
  console.log('\n=== E) Invoices generated 2026-04-17 IST for MASH ===');
  try {
    const invs = await (p as any).salesInvoice?.findMany({
      where: {
        createdAt: { gte: istStart, lt: istEnd },
        OR: [
          { buyerName: { contains: 'MASH', mode: 'insensitive' } },
          { customerName: { contains: 'MASH', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true, invoiceNo: true, date: true, buyerName: true, customerName: true,
        totalValue: true, status: true, vehicleNo: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    console.log(JSON.stringify(invs, null, 2));
    console.log(`Invoices: ${invs?.length ?? 0}`);
  } catch (e: any) { console.log('invoice err:', e.message); }

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
