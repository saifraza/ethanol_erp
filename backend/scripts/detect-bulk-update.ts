import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // If companyId was mass-reset to null via bulk UPDATE, many rows will share identical updatedAt
  console.log('=== UpdatedAt distribution on Vendor (last 14 days) ===');
  const r1: any[] = await p.$queryRawUnsafe(`
    SELECT DATE_TRUNC('second', "updatedAt") AS second, COUNT(*) AS n
    FROM "Vendor" WHERE "updatedAt" > NOW() - INTERVAL '14 days'
    GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10
  `);
  for (const r of r1) console.log(`  ${r.second.toISOString()}  ${r.n} rows`);
  if (r1.length === 0) console.log('  no bulk updates detected on Vendor');

  console.log('\n=== UpdatedAt on PurchaseOrder (last 14 days) ===');
  const r2: any[] = await p.$queryRawUnsafe(`
    SELECT DATE_TRUNC('second', "updatedAt") AS second, COUNT(*) AS n
    FROM "PurchaseOrder" WHERE "updatedAt" > NOW() - INTERVAL '14 days'
    GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10
  `);
  for (const r of r2) console.log(`  ${r.second.toISOString()}  ${r.n} rows`);
  if (r2.length === 0) console.log('  no bulk updates detected on PurchaseOrder');

  console.log('\n=== UpdatedAt on GrainTruck ===');
  const r3: any[] = await p.$queryRawUnsafe(`
    SELECT DATE_TRUNC('second', "updatedAt") AS second, COUNT(*) AS n
    FROM "GrainTruck" WHERE "updatedAt" > NOW() - INTERVAL '14 days'
    GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10
  `);
  for (const r of r3) console.log(`  ${r.second.toISOString()}  ${r.n} rows`);

  console.log('\n=== UpdatedAt on DispatchTruck ===');
  const r4: any[] = await p.$queryRawUnsafe(`
    SELECT DATE_TRUNC('second', "updatedAt") AS second, COUNT(*) AS n
    FROM "DispatchTruck" WHERE "updatedAt" > NOW() - INTERVAL '14 days'
    GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10
  `);
  for (const r of r4) console.log(`  ${r.second.toISOString()}  ${r.n} rows`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
