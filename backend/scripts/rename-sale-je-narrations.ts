/**
 * One-shot: rewrite "INV-{integer}" references in sale-JE narrations to the
 * printed invoice number (stored in Invoice.remarks as "INV/ETH/NNN").
 *
 * Usage:
 *   tsx backend/scripts/rename-sale-je-narrations.ts             # dry-run
 *   tsx backend/scripts/rename-sale-je-narrations.ts --apply     # write
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const invs = await prisma.invoice.findMany({
    select: { id: true, invoiceNo: true, remarks: true },
  });
  const docFormat = /^(INV|DCH|GP|CN|DN)\/[A-Z]+\/\d+$/;
  const byId = new Map(invs.map(i => [i.id, i]));

  const jes = await prisma.journalEntry.findMany({
    where: { refType: 'SALE' },
    select: { id: true, entryNo: true, narration: true, refId: true, lines: { select: { id: true, narration: true } } },
  });

  let entryUpdated = 0, lineUpdated = 0, skipped = 0;
  for (const je of jes) {
    if (!je.refId) { skipped++; continue; }
    const inv = byId.get(je.refId);
    if (!inv) { skipped++; continue; }
    if (!inv.remarks || !docFormat.test(inv.remarks)) { skipped++; continue; }

    const oldToken = `INV-${inv.invoiceNo}`;
    const newToken = inv.remarks;
    if (!je.narration?.includes(oldToken) && !je.lines.some(l => l.narration?.includes(oldToken))) continue;

    const newNarration = je.narration?.split(oldToken).join(newToken) || je.narration;

    if (APPLY) {
      await prisma.journalEntry.update({ where: { id: je.id }, data: { narration: newNarration } });
      for (const line of je.lines) {
        if (line.narration?.includes(oldToken)) {
          await prisma.journalLine.update({
            where: { id: line.id },
            data: { narration: line.narration.split(oldToken).join(newToken) },
          });
          lineUpdated++;
        }
      }
      entryUpdated++;
      console.log(`  ✓ JE #${je.entryNo} · ${oldToken} → ${newToken}`);
    } else {
      console.log(`  [DRY] JE #${je.entryNo} · "${je.narration}" → "${newNarration}"`);
      entryUpdated++;
    }
  }

  console.log(`\n${APPLY ? 'Updated' : 'Would update'}: ${entryUpdated} entries, ${lineUpdated} lines · skipped ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
