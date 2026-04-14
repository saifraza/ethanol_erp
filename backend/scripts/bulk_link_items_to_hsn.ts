/**
 * Bulk-link every active InventoryItem to the HSN master (HsnCode + GstRate)
 * so PO flows pull their GST from ONE place.
 *
 * Strategy (least-risk, idempotent):
 *   1. Exact HSN match on the item's legacy `hsnCode` string
 *   2. 4→8-digit prefix fuzzy match (e.g., item "1005" → master "10059000")
 *   3. 8→4-digit reverse prefix (e.g., item "27101900" → master "2710")
 *   4. For items with zero master match, fall back to the static
 *      hsnDatabase.ts catalog — but only CREATE a new HsnCode row if no
 *      existing master row's code is a prefix of / covered by the static code.
 *      This prevents duplicate entries when Phase 1 seed already has a long form.
 *
 * After linking, overwrite InventoryItem.gstPercent with the current master
 * rate so the per-item cache is never stale.
 *
 *   cd backend
 *   npx ts-node scripts/bulk_link_items_to_hsn.ts --dry-run
 *   npx ts-node scripts/bulk_link_items_to_hsn.ts --create-missing
 *   npx ts-node scripts/bulk_link_items_to_hsn.ts             # link only
 */
import prisma from '../src/config/prisma';
import { hsnDatabase } from '../src/data/hsnDatabase';

const DRY_RUN = process.argv.includes('--dry-run');
const CREATE_MISSING = process.argv.includes('--create-missing');
const EFFECTIVE_FROM = new Date(Date.UTC(2017, 6, 1));

function uqcForUnit(unit: string): string {
  const u = (unit || '').toUpperCase();
  if (['MT', 'TON', 'TONNE', 'MTS'].includes(u)) return 'MTS';
  if (['KG', 'KGS'].includes(u)) return 'KGS';
  if (['LTR', 'L', 'LITRE', 'LITER'].includes(u)) return 'LTR';
  if (['KL', 'KLR'].includes(u)) return 'KLR';
  if (['NOS', 'PCS', 'SET'].includes(u)) return 'NOS';
  if (['MTR', 'M'].includes(u)) return 'MTR';
  return 'OTH';
}

/** Pick the best-matching HsnCode master row for an item's legacy hsn string */
function matchHsn(itemHsn: string, master: Array<{ id: string; code: string }>): { id: string; code: string } | null {
  if (!itemHsn) return null;
  const a = itemHsn.trim();
  // 1. Exact
  const exact = master.find((m) => m.code === a);
  if (exact) return exact;
  // 2. Item is prefix of master (e.g. "1005" → "10059000")
  const fwd = master.find((m) => m.code.startsWith(a));
  if (fwd) return fwd;
  // 3. Master is prefix of item (e.g. "10059000" → "1005")
  const rev = master.find((m) => a.startsWith(m.code));
  if (rev) return rev;
  return null;
}

async function main() {
  console.log(DRY_RUN ? '[bulk-link] DRY RUN — no writes' : '[bulk-link] LIVE');
  console.log(CREATE_MISSING ? '  · create-missing: YES (will add stubs from hsnDatabase.ts)' : '  · create-missing: no (pure link pass)');

  const master = await prisma.hsnCode.findMany({
    select: { id: true, code: true, description: true, category: true, uqc: true },
  });
  console.log(`Master has ${master.length} HsnCode rows`);

  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, hsnCode: true, hsnCodeId: true, gstPercent: true, category: true, unit: true },
  });
  console.log(`Scanning ${items.length} active InventoryItems`);

  let linkedExisting = 0, skipAlreadyLinked = 0, skipNoHsn = 0;
  const unmatched: typeof items = [];

  for (const i of items) {
    if (i.hsnCodeId) { skipAlreadyLinked++; continue; }
    if (!i.hsnCode || !i.hsnCode.trim()) { skipNoHsn++; continue; }
    const m = matchHsn(i.hsnCode, master);
    if (!m) { unmatched.push(i); continue; }
    // Pull master rate
    const rate = await prisma.gstRate.findFirst({
      where: { hsnId: m.id, OR: [{ effectiveTill: null }, { effectiveTill: { gt: new Date() } }] },
      orderBy: [{ conditionNote: 'asc' }, { effectiveFrom: 'desc' }], // null condition first
    });
    const gst = rate ? (rate.isExempt || rate.isOutsideGst ? 0 : rate.cgst + rate.sgst || rate.igst) : i.gstPercent;
    if (!DRY_RUN) {
      await prisma.inventoryItem.update({
        where: { id: i.id },
        data: { hsnCodeId: m.id, hsnCode: m.code, gstPercent: gst },
      });
    }
    linkedExisting++;
    console.log(`  ✓ ${i.code} ${i.name.substring(0, 35).padEnd(35)} → HSN ${m.code}  @ ${gst}%`);
  }

  console.log('─────────────────────────────────────────');
  console.log(`Linked to existing master: ${linkedExisting}`);
  console.log(`Already linked         : ${skipAlreadyLinked}`);
  console.log(`No hsnCode on item     : ${skipNoHsn}`);
  console.log(`Unmatched              : ${unmatched.length}`);

  if (unmatched.length === 0) {
    console.log('\nDone.');
    return;
  }

  // Show what's missing + what the static catalog would suggest
  console.log('\nUnmatched items (hsnCode has no master row):');
  const suggestions: Array<{ item: typeof items[number]; static?: typeof hsnDatabase[number] }> = [];
  for (const i of unmatched) {
    const s = hsnDatabase.find((h) => h.hsn === i.hsnCode || i.hsnCode!.startsWith(h.hsn) || h.hsn.startsWith(i.hsnCode!));
    suggestions.push({ item: i, static: s });
    const hint = s ? `suggest "${s.hsn}" ${s.name} @ ${s.gst}%` : 'NO SUGGESTION in static catalog';
    console.log(`  - ${i.code} ${i.name} | hsnCode="${i.hsnCode}" → ${hint}`);
  }

  if (!CREATE_MISSING) {
    console.log('\nRe-run with --create-missing to auto-create HSNs from the static catalog (safe: skips if master prefix already exists).');
    return;
  }

  console.log('\nCreating missing HSNs from static catalog...');
  let createdHsn = 0, createdRate = 0, linkedNew = 0, skippedSuggest = 0;
  for (const s of suggestions) {
    if (!s.static) { skippedSuggest++; continue; }
    const hsnCode = s.static.hsn;
    // Guard against duplicates: if ANY master code already covers this (prefix in either direction), skip create
    const overlap = master.find((m) => m.code === hsnCode || m.code.startsWith(hsnCode) || hsnCode.startsWith(m.code));
    let targetId: string;
    if (overlap) {
      targetId = overlap.id;
    } else {
      if (!DRY_RUN) {
        const created = await prisma.hsnCode.create({
          data: {
            code: hsnCode,
            description: s.static.name,
            uqc: uqcForUnit(s.static.unit),
            category: s.static.category,
            isActive: true,
          },
        });
        targetId = created.id;
        master.push({ id: created.id, code: created.code, description: created.description, category: created.category, uqc: created.uqc });
        // Seed one rate at today's statutory level
        const half = Math.round((s.static.gst / 2) * 1000) / 1000;
        await prisma.gstRate.create({
          data: {
            hsnId: created.id,
            cgst: half, sgst: half, igst: s.static.gst, cess: 0,
            isExempt: s.static.gst === 0,
            isOutsideGst: false,
            conditionNote: null,
            effectiveFrom: EFFECTIVE_FROM,
          },
        });
        createdRate++;
      } else {
        targetId = 'dry-' + hsnCode;
      }
      createdHsn++;
    }
    // Link the item
    if (!DRY_RUN) {
      await prisma.inventoryItem.update({
        where: { id: s.item.id },
        data: { hsnCodeId: targetId, hsnCode: hsnCode, gstPercent: s.static.gst },
      });
    }
    linkedNew++;
    console.log(`  ✓ ${s.item.code} ${s.item.name.substring(0, 35).padEnd(35)} → HSN ${hsnCode}  @ ${s.static.gst}%${overlap ? ' (existing)' : ' (created)'}`);
  }

  console.log('─────────────────────────────────────────');
  console.log(`New HsnCode rows  : ${createdHsn}`);
  console.log(`New GstRate rows  : ${createdRate}`);
  console.log(`Newly linked items: ${linkedNew}`);
  console.log(`No suggestion     : ${skippedSuggest}  (you need to add HSN manually in /admin/tax/hsn-master)`);
  console.log('\nDone.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
