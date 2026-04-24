/**
 * Read-only: list every JE that touches the suspicious test accounts,
 * with all its lines so we see what "other side" each JE hit.
 * Use this to decide what to delete.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const suspectCodes = ['2400', '1002', '2200', '1001', '1600'];
  const accs = await prisma.account.findMany({ where: { code: { in: suspectCodes } }, select: { id: true, code: true, name: true } });
  const idByCode = new Map(accs.map(a => [a.code, a.id]));
  const nameById = new Map(accs.map(a => [a.id, a.name]));

  for (const code of suspectCodes) {
    const accId = idByCode.get(code);
    if (!accId) continue;
    console.log(`\n══════ [${code}] ${nameById.get(accId)}`);

    const lines = await prisma.journalLine.findMany({
      where: { accountId: accId, journal: { isReversed: false } },
      select: {
        id: true, debit: true, credit: true, narration: true,
        journal: {
          select: {
            id: true, entryNo: true, date: true, narration: true, refType: true, refId: true,
            lines: { select: { debit: true, credit: true, account: { select: { code: true, name: true } } } },
          },
        },
      },
      orderBy: { journal: { date: 'asc' } },
    });

    const seenJeIds = new Set<string>();
    for (const l of lines) {
      if (seenJeIds.has(l.journal.id)) continue;
      seenJeIds.add(l.journal.id);
      const je = l.journal;
      const date = je.date.toISOString().slice(0, 10);
      console.log(`\n  JE #${je.entryNo} · ${date} · ${je.refType || 'JOURNAL'} · "${je.narration}"`);
      for (const jl of je.lines) {
        const side = jl.debit > 0 ? 'Dr' : 'Cr';
        const amt = jl.debit > 0 ? jl.debit : jl.credit;
        console.log(`    ${side}  [${jl.account.code}] ${jl.account.name}  ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
