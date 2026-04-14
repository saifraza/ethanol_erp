/**
 * One-off: create the 7 HSNs that the static catalog didn't cover, at the
 * statutory Indian rates verified via CBIC / ClearTax tariff pages.
 *
 * Also reclassifies two items whose hsnCode string (11061000 = flour of
 * dried leguminous vegetables) was legally wrong:
 *   - BIOCULTURE ENZYME → HSN 3507 (prepared enzymes, 18%)
 *   - NUTRIENTS         → HSN 2309 (feed/fermentation preps, 18%)
 *
 *   cd backend
 *   npx ts-node scripts/fix_missing_hsns.ts --dry-run
 *   npx ts-node scripts/fix_missing_hsns.ts
 */
import prisma from '../src/config/prisma';

const DRY_RUN = process.argv.includes('--dry-run');
const EFFECTIVE_FROM = new Date(Date.UTC(2017, 6, 1));

interface Row {
  hsn: string;
  description: string;
  uqc: string;
  category: string;
  gst: number;
  isExempt?: boolean;
  // itemCode OR fuzzyNameMatch: which InventoryItem to link to this HSN
  itemCodes?: string[];
  // If we need to overwrite the item's stored hsnCode string (reclassification)
  rewriteItemHsnString?: boolean;
}

const ROWS: Row[] = [
  { hsn: '3808', description: 'Disinfectant / Biocide',              uqc: 'KGS', category: 'CHEMICAL',    gst: 18, itemCodes: ['ITM-00011'],                           rewriteItemHsnString: true },
  { hsn: '3105', description: 'Mineral fertilizer (DAP etc.)',       uqc: 'KGS', category: 'CHEMICAL',    gst: 5,  itemCodes: ['CH-00004'] },
  { hsn: '5202', description: 'Cotton waste',                        uqc: 'KGS', category: 'CONSUMABLE',  gst: 5,  itemCodes: ['CO-00004'] },
  { hsn: '2814', description: 'Ammonia (anhydrous / aqueous)',       uqc: 'LTR', category: 'CHEMICAL',    gst: 18, itemCodes: ['ITM-00044'],                           rewriteItemHsnString: true },
  // 3507 already exists from bulk-link run; we only reclassify BIOCULTURE to it
  { hsn: '3507', description: 'Prepared enzymes (amylase/protease)', uqc: 'KGS', category: 'CHEMICAL',    gst: 18, itemCodes: ['ITM-00062'],                           rewriteItemHsnString: true },
  { hsn: '2309', description: 'Preparations for animal feed / fermentation', uqc: 'KGS', category: 'CHEMICAL', gst: 18, itemCodes: ['ITM-00063'],                      rewriteItemHsnString: true },
  { hsn: '1213', description: 'Cereal straw / husks (boiler fuel)',  uqc: 'MTS', category: 'RAW_MATERIAL', gst: 0, isExempt: true, itemCodes: ['FUEL-003'] },
];

async function main() {
  console.log(DRY_RUN ? '[fix-missing-hsn] DRY RUN' : '[fix-missing-hsn] LIVE');

  let createdHsn = 0, linkedItems = 0, existedHsn = 0, createdRate = 0;

  for (const r of ROWS) {
    // 1. Upsert HSN master row
    let hsn = await prisma.hsnCode.findUnique({ where: { code: r.hsn } });
    if (hsn) {
      existedHsn++;
    } else if (!DRY_RUN) {
      hsn = await prisma.hsnCode.create({
        data: { code: r.hsn, description: r.description, uqc: r.uqc, category: r.category, isActive: true },
      });
      createdHsn++;
      console.log(`  + HSN ${r.hsn} ${r.description} (${r.gst}%)`);
    } else {
      console.log(`  + [dry] HSN ${r.hsn} ${r.description} (${r.gst}%)`);
      createdHsn++;
      continue; // skip rate/link in dry
    }

    // 2. Ensure a current GstRate row exists for the default condition (null)
    if (!DRY_RUN && hsn) {
      const existingRate = await prisma.gstRate.findFirst({
        where: {
          hsnId: hsn.id,
          conditionNote: null,
          OR: [{ effectiveTill: null }, { effectiveTill: { gt: new Date() } }],
        },
      });
      if (!existingRate) {
        const half = Math.round((r.gst / 2) * 1000) / 1000;
        await prisma.gstRate.create({
          data: {
            hsnId: hsn.id,
            cgst: half, sgst: half, igst: r.gst, cess: 0,
            isExempt: !!r.isExempt, isOutsideGst: false,
            conditionNote: null, effectiveFrom: EFFECTIVE_FROM,
          },
        });
        createdRate++;
      }
    }

    // 3. Link items
    if (hsn && r.itemCodes && !DRY_RUN) {
      for (const code of r.itemCodes) {
        const updateData: { hsnCodeId: string; gstPercent: number; hsnCode?: string } = {
          hsnCodeId: hsn.id,
          gstPercent: r.gst,
        };
        if (r.rewriteItemHsnString) updateData.hsnCode = r.hsn;
        const res = await prisma.inventoryItem.updateMany({
          where: { code, isActive: true },
          data: updateData,
        });
        if (res.count) {
          linkedItems++;
          console.log(`    ↳ linked ${code} → HSN ${r.hsn} @ ${r.gst}%`);
        } else {
          console.log(`    ! ${code} not found — skipping`);
        }
      }
    }
  }

  console.log('─────────────────────────────────────────');
  console.log(`HsnCode  : ${createdHsn} new, ${existedHsn} existing`);
  console.log(`GstRate  : ${createdRate} new`);
  console.log(`Linked   : ${linkedItems} item(s)`);
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
