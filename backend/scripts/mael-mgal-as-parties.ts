import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const terms = ['MAEL', 'MGAL', 'NARSINGH', 'CHAAPARA', 'Agri Energy', 'Green Agri', 'Mahakaushal'];
  console.log('=== Where "MAEL/MGAL/Agri Energy/Green Agri" appear ===');
  for (const t of terms) {
    const vs = await p.vendor.findMany({
      where: { name: { contains: t, mode: 'insensitive' } },
      select: { id: true, name: true, companyId: true, gstin: true, category: true },
    });
    const cs = await p.customer.findMany({
      where: { name: { contains: t, mode: 'insensitive' } },
      select: { id: true, name: true, companyId: true, gstNo: true },
    });
    if (vs.length || cs.length) {
      console.log(`\n-- "${t}"`);
      for (const v of vs) console.log(`  VENDOR:   ${v.id} | ${v.name} | co=${v.companyId??'null'} | GST=${v.gstin??'-'} | cat=${v.category??'-'}`);
      for (const c of cs) console.log(`  CUSTOMER: ${c.id} | ${c.name} | co=${c.companyId??'null'} | GST=${c.gstNo??'-'}`);
    }
  }

  console.log('\n=== Recent GrainTrucks (top 5 by createdAt) supplier names ===');
  const recent = await p.grainTruck.findMany({
    select: { vehicleNo: true, supplier: true, companyId: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 5,
  });
  for (const r of recent) console.log(`  ${r.createdAt.toISOString()} ${r.vehicleNo?.padEnd(14)} supplier=${r.supplier} co=${r.companyId ?? 'NULL'}`);

  console.log('\n=== Recent Weighments — distinct customerName + supplierName in last 60 days ===');
  const wm = await p.weighment.findMany({
    where: { factoryCreatedAt: { gte: new Date(Date.now() - 60 * 86400000) } },
    select: { customerName: true, supplierName: true, purchaseType: true, materialName: true },
  });
  const partyCount = new Map<string, number>();
  for (const w of wm) {
    const k = `${w.supplierName ?? ''} | ${w.customerName ?? ''} | ${w.purchaseType}`;
    partyCount.set(k, (partyCount.get(k) ?? 0) + 1);
  }
  const entries = Array.from(partyCount.entries()).sort((a,b) => b[1] - a[1]).slice(0, 20);
  for (const [k, v] of entries) console.log(`  ${String(v).padStart(4)} | ${k}`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
