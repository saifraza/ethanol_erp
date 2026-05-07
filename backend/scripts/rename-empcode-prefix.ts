/**
 * One-shot: rename existing Employee.empCode from "MSPIL-XXX" to "MS-XXX".
 *
 * Cosmetic only — does NOT touch Employee.deviceUserId, so any fingerprint
 * already enrolled on a biometric device under the previous numeric user_id
 * stays bound and continues to match. The new shorter prefix just makes the
 * ERP-side display match the new "MS-NNN" / "LW-NNN" convention.
 *
 * Usage:
 *   tsx backend/scripts/rename-empcode-prefix.ts             # dry-run, prints counts + sample
 *   tsx backend/scripts/rename-empcode-prefix.ts --apply     # commits inside one transaction
 *
 * Pre-flight checks (always run):
 *   - count of MSPIL-* rows
 *   - sample of 5 rows showing old → new
 *   - count of MS-* rows that already exist (must be 0 to avoid unique conflict)
 *   - any pair where MSPIL-NNN and MS-NNN co-exist (would clash on rename)
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const oldPrefix = await prisma.employee.findMany({
    where: { empCode: { startsWith: 'MSPIL-' } },
    select: { id: true, empCode: true, empNo: true, firstName: true, lastName: true },
    orderBy: { empNo: 'asc' },
  });

  const newPrefix = await prisma.employee.findMany({
    where: { empCode: { startsWith: 'MS-' } },
    select: { id: true, empCode: true },
  });

  console.log(`Rows with MSPIL- prefix: ${oldPrefix.length}`);
  console.log(`Rows with MS- prefix already: ${newPrefix.length}`);

  if (oldPrefix.length === 0) {
    console.log('Nothing to rename. Exiting.');
    return;
  }

  // Conflict scan: would any MSPIL-NNN rename collide with an existing MS-NNN?
  const newCodeSet = new Set(newPrefix.map(e => e.empCode));
  const conflicts: Array<{ oldCode: string; newCode: string }> = [];
  for (const e of oldPrefix) {
    if (!e.empCode) continue;
    const newCode = e.empCode.replace(/^MSPIL-/, 'MS-');
    if (newCodeSet.has(newCode)) conflicts.push({ oldCode: e.empCode, newCode });
  }
  if (conflicts.length > 0) {
    console.error(`\nABORTING: ${conflicts.length} rename(s) would collide with existing MS- codes:`);
    for (const c of conflicts.slice(0, 10)) console.error(`  ${c.oldCode} -> ${c.newCode} (taken)`);
    process.exit(1);
  }

  console.log('\nSample of changes:');
  for (const e of oldPrefix.slice(0, 5)) {
    const newCode = e.empCode!.replace(/^MSPIL-/, 'MS-');
    console.log(`  ${e.empCode} -> ${newCode}  (${e.firstName} ${e.lastName ?? ''})`);
  }
  if (oldPrefix.length > 5) console.log(`  ...and ${oldPrefix.length - 5} more`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] Re-run with --apply to commit. No DB changes made.');
    return;
  }

  console.log('\nApplying inside transaction...');
  const result = await prisma.$transaction(async (tx) => {
    let renamed = 0;
    for (const e of oldPrefix) {
      if (!e.empCode) continue;
      const newCode = e.empCode.replace(/^MSPIL-/, 'MS-');
      await tx.employee.update({ where: { id: e.id }, data: { empCode: newCode } });
      renamed++;
    }
    return renamed;
  });
  console.log(`\nDone. Renamed ${result} employees. Transaction committed.`);

  // Sanity check: post-state
  const remaining = await prisma.employee.count({ where: { empCode: { startsWith: 'MSPIL-' } } });
  if (remaining > 0) {
    console.warn(`WARNING: ${remaining} MSPIL- rows still exist after apply.`);
  } else {
    console.log('Verified: no MSPIL- rows remain.');
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
