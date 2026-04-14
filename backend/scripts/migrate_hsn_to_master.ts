/**
 * One-shot migration: fold backend/src/data/hsnDatabase.ts (static) into the
 * HsnCode + GstRate Prisma master so purchase flows have a single source.
 *
 * Safety
 *   • Idempotent — re-runnable, upsert by hsn code
 *   • Only creates new GstRate rows when the effective rate actually differs
 *     from whatever is currently effective; otherwise skips so we don't churn
 *     audit history.
 *   • Links existing InventoryItem rows by their legacy hsnCode string.
 *   • NO deletes. NO renames. NO overwrites of user-authored rates.
 *
 * Usage
 *   npx ts-node backend/scripts/migrate_hsn_to_master.ts
 *   npx ts-node backend/scripts/migrate_hsn_to_master.ts --dry-run
 *   npx ts-node backend/scripts/migrate_hsn_to_master.ts --fix-diesel-drift
 *
 * Phase A of Tax Unification (2026-04-14).
 */
import prisma from '../src/config/prisma';
import { hsnDatabase } from '../src/data/hsnDatabase';

const DRY_RUN = process.argv.includes('--dry-run');
const FIX_DIESEL_DRIFT = process.argv.includes('--fix-diesel-drift');
const EFFECTIVE_FROM = new Date(Date.UTC(2017, 6, 1)); // 2017-07-01: GST rollout

function log(...args: unknown[]) {
  console.log('[hsn-migrate]', ...args);
}

function uqcForUnit(unit: string): string {
  // Map internal units to UQC (Unit Quantity Code — GSTN list)
  const u = unit.toUpperCase();
  if (['MT', 'TON', 'TONNE', 'MTS'].includes(u)) return 'MTS';
  if (['KG', 'KGS'].includes(u)) return 'KGS';
  if (['LTR', 'L', 'LITRE', 'LITER'].includes(u)) return 'LTR';
  if (['KL', 'KLR'].includes(u)) return 'KLR';
  if (['NOS', 'PCS', 'SET'].includes(u)) return 'NOS';
  if (['MTR', 'M'].includes(u)) return 'MTR';
  if (['BOX'].includes(u)) return 'BOX';
  return 'OTH';
}

async function main() {
  log(DRY_RUN ? 'DRY RUN — no writes' : 'LIVE — will upsert');
  log(`Input: ${hsnDatabase.length} items from static hsnDatabase.ts`);

  // Dedupe static rows by HSN code — keep highest gst variant for the
  // "default" rate. (Some codes appear multiple times with different
  // branded/unbranded rates; user can add conditionNote variants later.)
  const byCode = new Map<string, { gsts: Set<number>; rows: typeof hsnDatabase; }>();
  for (const row of hsnDatabase) {
    const entry = byCode.get(row.hsn) ?? { gsts: new Set(), rows: [] };
    entry.gsts.add(row.gst);
    entry.rows.push(row);
    byCode.set(row.hsn, entry);
  }
  log(`Deduped to ${byCode.size} unique HSN codes`);

  let createdHsn = 0, existedHsn = 0, createdRate = 0, existedRate = 0, linkedItems = 0;

  for (const [code, entry] of byCode.entries()) {
    const first = entry.rows[0];
    const rates = [...entry.gsts].sort((a, b) => a - b);

    // Upsert HsnCode by unique code
    const existing = await prisma.hsnCode.findUnique({ where: { code } });
    let hsnRow;
    if (existing) {
      existedHsn++;
      hsnRow = existing;
    } else {
      if (DRY_RUN) {
        hsnRow = { id: `dry-${code}`, code } as any;
      } else {
        hsnRow = await prisma.hsnCode.create({
          data: {
            code,
            description: first.name,
            uqc: uqcForUnit(first.unit),
            category: first.category,
            isActive: true,
          },
        });
      }
      createdHsn++;
      log(`  + HsnCode ${code} (${first.name})`);
    }

    // For each distinct GST rate, ensure there's a current effective GstRate.
    // Deterministic default: lowest rate gets conditionNote=null (wins default lookup),
    // higher rates carry an explicit condition so callers must opt in.
    for (const gst of rates) {
      const half = Math.round((gst / 2) * 1000) / 1000; // 2.5 / 6 / 9 / 14
      const isDefault = rates.length === 1 || gst === Math.min(...rates);
      const conditionNote = isDefault ? null : 'Branded / industrial';

      const liveRate = DRY_RUN ? null : await prisma.gstRate.findFirst({
        where: {
          hsnId: hsnRow.id,
          cgst: half,
          sgst: half,
          igst: gst,
          OR: [{ effectiveTill: null }, { effectiveTill: { gt: new Date() } }],
        },
      });

      if (liveRate) {
        existedRate++;
      } else {
        if (!DRY_RUN) {
          await prisma.gstRate.create({
            data: {
              hsnId: hsnRow.id,
              cgst: half,
              sgst: half,
              igst: gst,
              cess: 0,
              isExempt: gst === 0,
              isOutsideGst: false,
              conditionNote,
              effectiveFrom: EFFECTIVE_FROM,
            },
          });
        }
        createdRate++;
        log(`    → GstRate ${gst}% ${conditionNote ? `(${conditionNote})` : ''}`);
      }
    }

    // Link InventoryItem rows whose legacy hsnCode string matches
    if (!DRY_RUN) {
      const linked = await prisma.inventoryItem.updateMany({
        where: { hsnCode: code, hsnCodeId: null },
        data: { hsnCodeId: hsnRow.id },
      });
      linkedItems += linked.count;
      if (linked.count) log(`    ↳ linked ${linked.count} InventoryItem rows`);
    }
  }

  // One-off drift fix: seed diesel materials at 18%
  if (FIX_DIESEL_DRIFT && !DRY_RUN) {
    const fixed = await prisma.inventoryItem.updateMany({
      where: {
        OR: [
          { hsnCode: '2710', gstPercent: 0 },
          { name: { contains: 'diesel', mode: 'insensitive' }, gstPercent: 0 },
          { name: { contains: 'HSD', mode: 'insensitive' }, gstPercent: 0 },
        ],
      },
      data: { gstPercent: 18 },
    });
    log(`  fix-diesel-drift: updated ${fixed.count} rows from 0% → 18%`);
  }

  log('─────────────────────────────────────────');
  log(`HsnCode: ${createdHsn} new, ${existedHsn} existing`);
  log(`GstRate: ${createdRate} new, ${existedRate} existing`);
  log(`InventoryItem linked: ${linkedItems}`);
  log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
