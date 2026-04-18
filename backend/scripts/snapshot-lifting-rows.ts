import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const p = new PrismaClient();
(async () => {
  const rows = await p.ethanolLifting.findMany({
    where: { OR: [
      { id: 'b3f8199f-fd1c-45aa-a513-3183794b6fa8' },
      { vehicleNo: 'KA01AM3264', invoiceNo: 'INV/ETH/043' },
    ]},
  });
  const invIds = rows.map(r => r.invoiceId).filter(Boolean) as string[];
  const invs = await p.invoice.findMany({ where: { id: { in: invIds } } });
  const snap = { capturedAt: new Date().toISOString(), liftings: rows, invoices: invs };
  const path = `/Users/saifraza/Desktop/mspil-db-backups/snap-2rows-${Date.now()}_IST.json`;
  fs.writeFileSync(path, JSON.stringify(snap, null, 2));
  console.log(`snapshot: ${path}`);
  console.log(`rows: ${rows.length} lifting + ${invs.length} invoice`);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
