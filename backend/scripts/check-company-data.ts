import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const companies = await p.company.findMany({ select: { id: true, code: true, shortName: true, isDefault: true } });
  console.log('Companies:');
  for (const c of companies) console.log(`  ${c.code.padEnd(18)} ${c.shortName?.padEnd(8)} ${c.id} ${c.isDefault?'(DEFAULT)':''}`);

  // Now for each company, count records assigned to it across key tables
  const tables: Array<[string, string]> = [
    ['vendor', 'Vendor'], ['material', 'Material'], ['purchaseOrder', 'PO'],
    ['customer', 'Customer'], ['inventoryItem', 'InventoryItem'],
    ['ethanolContract', 'EthContract'], ['dDGSContract', 'DDGSContract'],
    ['goodsReceipt', 'GRN'], ['invoice', 'Invoice'], ['grainTruck', 'GrainTruck'],
    ['dispatchTruck', 'DispatchTruck'], ['weighment', 'Weighment'],
  ];
  console.log('\nCompany assignment counts (by table):');
  console.log('Table                | NULL | ' + companies.map(c=>c.code.slice(0,12).padStart(13)).join(' | '));
  for (const [key, label] of tables) {
    try {
      const m: any = (p as any)[key];
      if (!m) continue;
      const nullCount = await m.count({ where: { companyId: null } });
      const perCompany: string[] = [];
      for (const c of companies) {
        const cnt = await m.count({ where: { companyId: c.id } });
        perCompany.push(String(cnt).padStart(13));
      }
      console.log(`${label.padEnd(20)} | ${String(nullCount).padStart(4)} | ${perCompany.join(' | ')}`);
    } catch (e: any) {
      console.log(`${label.padEnd(20)} | ERR: ${e.message.slice(0,60)}`);
    }
  }
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
