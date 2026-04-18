/**
 * One-shot data repair: 2 EthanolLifting rows have wrong liftingDate
 * (operator created them with yesterday's date instead of today's release).
 *
 * Safe: touches exactly 2 rows, identified by id. Dry-run first.
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const FIXES = [
  // KA01AM4665 / INV/ETH/096 — was 16 Apr, should be 17 Apr (truck released 17 Apr 12:10 PM IST)
  { id: 'b3f8199f-fd1c-45aa-a513-3183794b6fa8', expectVehicle: 'KA01AM4665', expectOldDate: '2026-04-16', newDateIST: '2026-04-17' },
  // KA01AM3264 / INV/ETH/043 — was 11 Apr, should be 12 Apr (truck released 12 Apr 12:13 PM IST)
  { id: '',                                     expectVehicle: 'KA01AM3264', expectOldDate: '2026-04-11', newDateIST: '2026-04-12' },
];

async function main() {
  const dry = process.argv.includes('--apply') ? false : true;
  console.log(dry ? 'DRY RUN — pass --apply to actually update\n' : 'APPLY MODE\n');

  // Resolve KA01AM3264 id
  const row3264 = await p.ethanolLifting.findFirst({
    where: { vehicleNo: 'KA01AM3264', invoiceNo: 'INV/ETH/043' },
    select: { id: true, liftingDate: true, vehicleNo: true, invoiceNo: true },
  });
  if (!row3264) { console.error('Could not find KA01AM3264 / INV/ETH/043 — aborting.'); return; }
  FIXES[1].id = row3264.id;

  for (const fix of FIXES) {
    const row = await p.ethanolLifting.findUnique({
      where: { id: fix.id },
      select: { id: true, vehicleNo: true, liftingDate: true, invoiceNo: true, invoiceId: true },
    });
    if (!row) { console.error(`❌ Row ${fix.id} not found`); continue; }
    if (row.vehicleNo !== fix.expectVehicle) {
      console.error(`❌ Vehicle mismatch for ${fix.id}: expected ${fix.expectVehicle}, got ${row.vehicleNo} — skipping`);
      continue;
    }
    const currentIST = new Date(row.liftingDate.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (currentIST !== fix.expectOldDate) {
      console.error(`❌ Date mismatch for ${fix.id}: expected ${fix.expectOldDate}, got ${currentIST} — skipping`);
      continue;
    }
    // New liftingDate — store as the same UTC-midnight pattern already used in DB
    const newDate = new Date(fix.newDateIST + 'T00:00:00.000Z');
    console.log(`[${dry ? 'DRY' : 'APPLY'}] Lifting ${row.id}  ${row.vehicleNo}  ${row.invoiceNo}  ${row.liftingDate.toISOString()} → ${newDate.toISOString()}`);

    if (!dry) {
      await p.$transaction(async (tx) => {
        await tx.ethanolLifting.update({
          where: { id: row.id },
          data: { liftingDate: newDate },
        });
        // Also fix the Invoice.invoiceDate for consistency
        if (row.invoiceId) {
          await tx.invoice.update({
            where: { id: row.invoiceId },
            data: { invoiceDate: newDate },
          });
          console.log(`   ↳ invoice ${row.invoiceId} invoiceDate → ${newDate.toISOString()}`);
        }
      });
    }
  }

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
