// Re-classify items currently in "GENERAL" to a more specific category
// based on keyword matches on the name. Runs in a single transaction so a
// bad rule can be rolled back with ROLLBACK.
//
// Does NOT touch items already in a specific category — assumes the
// category was set intentionally. Does NOT change the name.
//
// Run:  cd backend && npx tsx scripts/reclassify-items.ts [--dry-run]

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Order MATTERS — first match wins. Place more specific patterns first.
const RULES: Array<{ category: string; pattern: RegExp }> = [
  // Safety — high priority so fire extinguisher / gloves / helmet don't fall into other categories
  { category: 'SAFETY', pattern: /\b(helmet|hand gloves?|safety (shoes?|boots?|gloves?|goggles?|belt|harness)|goggles?|nose mask|dust mask|respirator|ear ?plug|hi-?vis|reflective vest|fire ?extinguisher|first ?aid|safety ?sign|warning ?board)\b/i },
  // Pipe & plumbing fittings with a material prefix — SPARE_PART (MUST come before ELECTRICAL so "MS socket" is plumbing)
  { category: 'SPARE_PART', pattern: /\b(ms|m\.?s\.?|ss|gi|g\.?i\.?|pvc|upvc|cpvc|hdpe|ppr|ci|cast iron|brass|copper)[\s\.\-]+(pipe|hose|tube|flange|elbow|reducer|tee|bend|nipple|socket|coupling|union|cap|plug|strainer|ball valve|gate valve|globe valve|butterfly valve|check valve|nrv|valve|fitting)\b/i },
  // Raw materials specific to ethanol/sugar (must come before MECHANICAL which might match 'cane razor')
  { category: 'RAW_MATERIAL', pattern: /\b(broken rice|rice loose|maize|corn starch|jowar|bajra|wheat loose|sugar ?cane|sugarcane|molasses|bagasse)\b/i },
  // Mechanical — bolts, bearings, belts, seals (specific first)
  { category: 'MECHANICAL', pattern: /\b(bolt\b|\bnut[\s\d]|\bwasher|\bstud\b|hex (bolt|nut|head|screw)|hex\. (bolt|nut)|allen (bolt|screw)|socket head|rivet|gasket|o[- ]?ring|oil ?seal|lip seal|mechanical seal|bearing|ucf|ucp|ucfl|skf|ntn|roller bearing|ball bearing|pillow bearing|bush\b|coupling|pulley|sprocket|chain[\s\d]|timing chain|v[- ]?belt|\bspc[\s\-]|\bspb[\s\-]|\bspz[\s\-]|flat belt|timing belt|sleeve|shaft|circlip|snap ring|pillow ?block|taper lock|split ?pin|cotter pin|grub screw|anchor bolt|foundation bolt|j[- ]?bolt|u[- ]?bolt)\b/i },
  // Electrical / electronics — tighter patterns, require qualifiers for ambiguous words
  { category: 'ELECTRICAL', pattern: /\b(mcb|mccb|elcb|rccb|contactor|relay|fuse|starter|soft starter|vfd|ac drive|3[- ]?phase motor|submersible|induction motor|servo motor|stepper motor|transformer|rectifier|capacitor|battery|led (bulb|light|tube)|tube ?light|cfl|lamp|luminair|switch ?board|switch ?gear|switch socket|socket outlet|\d+a socket|\d+ amp socket|plug top|mcb box|bus ?bar|terminal ?block|lug|glanding|gland\b|conduit|junction box|rj45|ethernet|network cable|computer|laptop|desktop|monitor|keyboard|mouse|printer|cartridge|toner|\bups\b|router|server\b|\bhdd\b|\bssd\b|pen ?drive|power supply|smps|thermocouple|rtd|pt100|\bplc\b|scada|\bhmi\b|pressure transmitter|flow transmitter|level transmitter|proximity switch|photoelectric|limit switch|selector switch|push ?button|indicator lamp|annunciator|cable (\d|armou?red|flexible|copper|aluminium|pvc|xlpe)|wire (\d|copper|flexible))\b/i },
  // Chemicals — tightened (alum requires alum standalone not aluminium)
  { category: 'CHEMICAL', pattern: /\b(acid\b|hcl\b|h2so4|sulphuric|hydrochloric|nitric acid|h3po4|phosphoric|naoh|caustic soda|lye\b|sodium hypo|bleach|chlorine|ammonia|amylase|glucoamylase|protease|\benzyme|urea\b|\bdap\b|\byeast|antifoam|defoamer|biocide|flocc?ulant|poly ?electrolyte|anti ?scal|corros?ion inhibitor|alum\s|alum\b|\blime\b|kmno4|h2o2|peroxide|degreaser|sanitizer|disinfectant|cacl2|kcl|nacl|dextrose|maltose|glycerine|methanol|ipa\b|acetone|toluene|xylene|iodine\b|indion|dowex|resin\b)\b/i },
  // Tools & instruments (hand tools + measuring)
  { category: 'TOOL', pattern: /\b(spanner|pipe wrench|\bwrench\b|screwdriver|plier|\bcutter\b|hacksaw|hammer\b|chisel|file set|drill bit|hex key|allen key|measur(e|ing) tape|vernier|caliper|micrometer|welding (machine|rod|electrode)|grinding wheel|\btap\s?set|\bdie\s?set|tool ?box|tool ?kit|dial indicator|dial gauge|bench vice|c-clamp|g-clamp)\b/i },
  // Consumables (oils, greases, cleaning, fuel)
  { category: 'CONSUMABLE', pattern: /\b(engine oil|gear oil|hydraulic oil|turbine oil|compressor oil|transformer oil|thermic fluid|\bgrease\b|lubricant|coolant|brake fluid|antifreeze|hsd\b|diesel\b|petrol\b|cotton waste|\bjute\b|\brope\b|nylon rope|cleaning cloth|wiping ?cloth|broom|\bmop\b|teflon tape|sealant|silicone|loctite|m[-\s]?seal|epoxy|adhesive|glue\b|paint[\s\(]|primer\b|thinner\b|enamel|red oxide)\b/i },
  // Generic pipes/fittings (no material prefix caught earlier)
  { category: 'SPARE_PART', pattern: /\b(\bpipe\b|\bhose\b|\btube\b|flange|elbow|reducer|\btee\b|\bbend\b|nipple|ball valve|gate valve|globe valve|butterfly valve|check valve|nrv|solenoid valve|pressure gauge|temperature gauge|level gauge|sight glass|expansion joint|bellow|diaphragm|impeller|casing|\bpump\s)\b/i },
];

async function main() {
  const dry = process.argv.includes('--dry-run');

  const items = await prisma.inventoryItem.findMany({
    where: { category: 'GENERAL' },
    select: { id: true, name: true },
  });
  console.log(`[items] ${items.length} items currently in GENERAL`);

  const plan: Record<string, Array<{ id: string; name: string }>> = {};
  for (const it of items) {
    for (const r of RULES) {
      if (r.pattern.test(it.name)) {
        (plan[r.category] ??= []).push({ id: it.id, name: it.name });
        break;
      }
    }
  }

  const total = Object.values(plan).reduce((s, a) => s + a.length, 0);
  console.log(`\n[plan] ${total} items will be reclassified:`);
  Object.entries(plan).sort((a, b) => b[1].length - a[1].length).forEach(([cat, list]) => {
    console.log(`  ${cat.padEnd(16)} ${list.length}`);
  });
  console.log(`  (remaining in GENERAL: ${items.length - total})`);

  if (dry) {
    console.log('\n[dry-run] not writing. Samples per category:');
    Object.entries(plan).forEach(([cat, list]) => {
      console.log(`\n  → ${cat}`);
      list.slice(0, 5).forEach(i => console.log(`     ${i.name}`));
    });
    return;
  }

  console.log('\n[writing] applying category updates inside a transaction...');
  await prisma.$transaction(async (tx) => {
    for (const [cat, list] of Object.entries(plan)) {
      const ids = list.map(i => i.id);
      // batch in chunks of 500 to keep each UPDATE modest
      const BATCH = 500;
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        await tx.inventoryItem.updateMany({
          where: { id: { in: chunk } },
          data: { category: cat },
        });
      }
      console.log(`  ✓ ${cat}: ${ids.length} items`);
    }
  });
  console.log('\n[done] reclassification complete.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
