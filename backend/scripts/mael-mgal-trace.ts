import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // All companies (including inactive / deleted)
  const allComps = await p.company.findMany({ select: { id: true, code: true, name: true, shortName: true, isActive: true, isDefault: true, createdAt: true, updatedAt: true } });
  console.log('ALL Company rows:');
  for (const c of allComps) console.log(`  ${c.id} | ${c.code?.padEnd(18)} | ${c.shortName?.padEnd(8)} | active=${c.isActive} default=${c.isDefault} | updated=${c.updatedAt.toISOString()}`);

  // Search for MAEL/MGAL-shaped records in free-text fields
  console.log('\n=== Vendor / PO / GRN names containing MAEL, MGAL, NARSINGH, CHAAPARA ===');
  const terms = ['MAEL', 'MGAL', 'NARSINGH', 'CHAAPARA', 'Agri Energy', 'Green Agri'];
  for (const t of terms) {
    const vs = await p.vendor.count({ where: { name: { contains: t, mode: 'insensitive' } } });
    const cs = await p.customer.count({ where: { name: { contains: t, mode: 'insensitive' } } });
    const inv = await p.invoice.count({ where: { OR: [{ productName: { contains: t, mode: 'insensitive' } }, { remarks: { contains: t, mode: 'insensitive' } }] } });
    console.log(`  "${t}"  vendors=${vs} customers=${cs} invoice_hits=${inv}`);
  }

  console.log('\n=== Distinct companyId values actually in Vendor table ===');
  const raw: any[] = await p.$queryRawUnsafe(`SELECT "companyId", COUNT(*) AS c FROM "Vendor" GROUP BY "companyId"`);
  for (const r of raw) console.log(`  ${r.companyId ?? 'NULL'.padEnd(36)}  ${r.c}`);

  console.log('\n=== Distinct companyId values in GrainTruck + Invoice + PO ===');
  const r1: any[] = await p.$queryRawUnsafe(`SELECT "companyId", COUNT(*) AS c FROM "GrainTruck" GROUP BY "companyId"`);
  console.log('GrainTruck:'); for (const r of r1) console.log(`  ${r.companyId ?? 'NULL'.padEnd(36)}  ${r.c}`);
  const r2: any[] = await p.$queryRawUnsafe(`SELECT "companyId", COUNT(*) AS c FROM "Invoice" GROUP BY "companyId"`);
  console.log('Invoice:'); for (const r of r2) console.log(`  ${r.companyId ?? 'NULL'.padEnd(36)}  ${r.c}`);
  const r3: any[] = await p.$queryRawUnsafe(`SELECT "companyId", COUNT(*) AS c FROM "PurchaseOrder" GROUP BY "companyId"`);
  console.log('PurchaseOrder:'); for (const r of r3) console.log(`  ${r.companyId ?? 'NULL'.padEnd(36)}  ${r.c}`);

  console.log('\n=== Top 5 most-recently-modified rows in GrainTruck (any company) ===');
  const recent = await p.grainTruck.findMany({
    select: { id: true, date: true, vehicleNo: true, supplier: true, companyId: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' }, take: 5,
  });
  for (const r of recent) console.log(`  ${r.updatedAt.toISOString()} ${r.vehicleNo?.padEnd(14)} ${r.supplier?.slice(0,25).padEnd(25)} co=${r.companyId ?? 'NULL'}`);

  console.log('\n=== ActivityLog entries touching Company / Vendor / PO in last 48h ===');
  try {
    const logs = await p.activityLog.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) },
        OR: [
          { entityType: 'Company' },
          { action: { contains: 'DELETE' } },
          { action: { contains: 'UPDATE_MANY' } },
        ],
      },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
    console.log(`found ${logs.length} log entries`);
    for (const l of logs) console.log(`  ${l.createdAt.toISOString()} ${(l as any).entityType?.padEnd(20)} ${(l as any).action?.padEnd(15)} ${JSON.stringify((l as any).diff ?? {}).slice(0,100)}`);
  } catch (e: any) { console.log('activityLog err:', e.message.slice(0, 120)); }

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
