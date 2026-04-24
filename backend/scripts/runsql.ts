import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const rows: any[] = await p.$queryRawUnsafe(`
    SELECT 'Vendor' t, "companyId"::text as cid, COUNT(*)::int as n FROM "Vendor" GROUP BY "companyId"
    UNION ALL SELECT 'PO', "companyId"::text, COUNT(*)::int FROM "PurchaseOrder" GROUP BY "companyId"
    UNION ALL SELECT 'Invoice', "companyId"::text, COUNT(*)::int FROM "Invoice" GROUP BY "companyId"
    UNION ALL SELECT 'GrainTruck', "companyId"::text, COUNT(*)::int FROM "GrainTruck" GROUP BY "companyId"
    UNION ALL SELECT 'GRN', "companyId"::text, COUNT(*)::int FROM "GoodsReceipt" GROUP BY "companyId"
    UNION ALL SELECT 'DispatchTruck', "companyId"::text, COUNT(*)::int FROM "DispatchTruck" GROUP BY "companyId"
    UNION ALL SELECT 'InventoryItem', "companyId"::text, COUNT(*)::int FROM "InventoryItem" GROUP BY "companyId"
    UNION ALL SELECT 'Customer', "companyId"::text, COUNT(*)::int FROM "Customer" GROUP BY "companyId"
    ORDER BY t, cid NULLS FIRST
  `);
  const comps: any[] = await p.$queryRawUnsafe(`SELECT id, code, "shortName" FROM "Company"`);
  const codeById: Record<string,string> = {};
  for (const c of comps) codeById[c.id] = c.shortName || c.code;
  console.log('Table'.padEnd(16) + ' | Company'.padEnd(20) + ' | Rows');
  console.log('-'.repeat(52));
  for (const r of rows) {
    const label = r.cid == null ? '<NULL (=MSPIL)>' : (codeById[r.cid] || r.cid.slice(0,8));
    console.log(r.t.padEnd(16) + ' | ' + label.padEnd(18) + ' | ' + String(r.n).padStart(5));
  }
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
