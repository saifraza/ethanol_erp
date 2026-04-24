// Read-only audit of InventoryItem master.
// Reports: total count, category distribution, case-insensitive duplicates,
// near-duplicates (trimmed/punctuation-normalized), and sample of misclassified
// items by keyword hints.

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Heuristic keyword → expected category mapping
const KEYWORD_HINTS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(acid|hcl|h2so4|naoh|caustic|ammonia|lye|chlorine|bleach|amylase|enzyme|urea|dap|yeast|antifoam|defoamer|biocide|flocculant|polymer|chemical)\b/i, category: 'CHEMICAL' },
  { pattern: /\b(bolt|nut|washer|screw|stud|hex|allen|rivet|gasket|o-?ring|oil seal|seal|bearing|bush|coupling|pulley|sprocket|chain|v-?belt|timing belt|sleeve|shaft|pin|key|circlip)\b/i, category: 'MECHANICAL' },
  { pattern: /\b(cable|wire|mcb|contactor|relay|fuse|switch|socket|bulb|led|tube light|starter|motor|panel|breaker|transformer|capacitor|resistor|thermistor|terminal|lug)\b/i, category: 'ELECTRICAL' },
  { pattern: /\b(helmet|gloves|boots|safety|goggles|mask|respirator|earplug|vest|harness|fire extinguisher|first aid)\b/i, category: 'SAFETY' },
  { pattern: /\b(wrench|spanner|hammer|screwdriver|plier|cutter|drill bit|file|chisel|measuring|tape|vernier|caliper|tool)\b/i, category: 'TOOL' },
  { pattern: /\b(grain|rice|maize|broken rice|jowar|dal|wheat|husk|bagasse|molasses|rm)\b/i, category: 'RAW_MATERIAL' },
  { pattern: /\b(oil|grease|lubricant|coolant|diesel|petrol|hsd|lsd|hydraulic oil|gear oil|turbine oil)\b/i, category: 'CONSUMABLE' },
  { pattern: /\b(pipe|hose|tube|flange|elbow|tee|reducer|valve|ball valve|gate valve|nrv|strainer|fitting|upvc|pvc|ms pipe|gi pipe|ss pipe|cpvc)\b/i, category: 'SPARE_PART' },
  { pattern: /\b(computer|laptop|desktop|monitor|keyboard|mouse|printer|ups|router|switch|network|cable rj45|toner|cartridge|hdd|ssd|ram)\b/i, category: 'ELECTRICAL' },
  { pattern: /\b(consultancy|consultant|audit|advisory|legal|retainer)\b/i, category: 'CONSULTANCY' },
  { pattern: /\b(amc|annual maintenance|service contract|maintenance service)\b/i, category: 'AMC_SERVICE' },
  { pattern: /\b(transport|freight|cartage|truck hire|lorry|carriage)\b/i, category: 'TRANSPORT_SERVICE' },
];

async function main() {
  const items = await prisma.inventoryItem.findMany({
    select: { id: true, name: true, code: true, category: true, unit: true, currentStock: true, division: true },
    take: 10000,
  });
  console.log(`\n[items] Total: ${items.length}`);

  // Category distribution
  const byCat: Record<string, number> = {};
  for (const it of items) byCat[it.category] = (byCat[it.category] || 0) + 1;
  console.log(`\n[categories] current distribution:`);
  Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${c.padEnd(20)} ${n}`));

  // Exact case-insensitive duplicates
  const byNormalName: Map<string, typeof items> = new Map();
  for (const it of items) {
    const key = normalize(it.name);
    const list = byNormalName.get(key) ?? [];
    list.push(it);
    byNormalName.set(key, list);
  }
  const dupes = [...byNormalName.entries()].filter(([_, list]) => list.length > 1);
  console.log(`\n[duplicates] normalized-name duplicates: ${dupes.length} groups (${dupes.reduce((s, [_, l]) => s + l.length, 0)} rows)`);
  dupes.slice(0, 10).forEach(([norm, list]) => {
    console.log(`  "${norm}" → ${list.length} rows:`);
    list.slice(0, 3).forEach(it => console.log(`     [${it.code}] "${it.name}" cat=${it.category} stock=${it.currentStock}`));
    if (list.length > 3) console.log(`     ...and ${list.length - 3} more`);
  });

  // Category misclassification — items whose name matches a keyword but are in GENERAL
  const misclassified: Array<{ id: string; code: string; name: string; currentCat: string; suggestedCat: string }> = [];
  for (const it of items) {
    for (const hint of KEYWORD_HINTS) {
      if (hint.pattern.test(it.name) && it.category !== hint.category) {
        // Only flag if current category is GENERAL or obviously wrong
        if (it.category === 'GENERAL' || it.category === '') {
          misclassified.push({ id: it.id, code: it.code, name: it.name, currentCat: it.category, suggestedCat: hint.category });
        }
        break;
      }
    }
  }
  console.log(`\n[misclass] items currently "GENERAL" that keyword-match a better category: ${misclassified.length}`);
  // Group by suggested category
  const suggestedByCat: Record<string, number> = {};
  for (const m of misclassified) suggestedByCat[m.suggestedCat] = (suggestedByCat[m.suggestedCat] || 0) + 1;
  Object.entries(suggestedByCat).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  → ${c.padEnd(20)} ${n} items`));

  console.log(`\n[samples]`);
  ['CHEMICAL', 'MECHANICAL', 'ELECTRICAL', 'SAFETY', 'TOOL', 'SPARE_PART', 'RAW_MATERIAL', 'CONSUMABLE'].forEach(cat => {
    const samp = misclassified.filter(m => m.suggestedCat === cat).slice(0, 3);
    if (samp.length > 0) {
      console.log(`  → ${cat}:`);
      samp.forEach(m => console.log(`     "${m.name}"`));
    }
  });

  // Items with no category / blank / weird
  const weird = items.filter(it => !it.category || it.category === 'GENERAL');
  console.log(`\n[uncategorized] items in GENERAL or blank: ${weird.length} of ${items.length} (${((weird.length / items.length) * 100).toFixed(1)}%)`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
