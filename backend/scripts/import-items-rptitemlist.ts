// Import items from old-ERP "RptItemList" xlsx dump, INCLUDING opening stock.
//
// Run:  cd backend && npx tsx scripts/import-items-rptitemlist.ts [path]
// Default path: ~/Downloads/RptItemList.xlsx
//
// Sheet layout (column indices):
//   col 2: Sr.No (numeric for items) OR merged group label
//   col 3: Item Code (old ERP, e.g. "010010010")
//   col 4: Item Description
//   col 6: Storing Unit (NOS, KG, LTR, …)
//   col 8: Current Stock
//   col 11: Old Code
//
// Rules:
//   - Group rows (col2 == col3, merged) are tracked as currentMain / currentSub, not imported.
//   - Existing items (matched case-insensitive by trimmed name) are SKIPPED.
//     Rationale: new ERP has been transacting — never clobber live stock with frozen data.
//   - New items inserted with: name, code=old-ERP-code, unit lowercased, currentStock from sheet,
//     category='GENERAL', subCategory=group label for traceability.
//   - If old ERP code collides with an existing code, fall back to ITM-IMP-xxxxx.
//
// Safe to re-run (existing match → skip).

import ExcelJS from 'exceljs';
import path from 'path';
import os from 'os';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'text' in v) return String((v as { text: string }).text);
  return String(v);
}

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/\s+/g, ' ').trim();
}

type Parsed = {
  name: string;
  oldCode: string;
  unit: string;
  stock: number;
  mainGroup: string;
  subGroup: string;
};

async function main() {
  const filePath = process.argv[2] || path.join(os.homedir(), 'Downloads', 'RptItemList.xlsx');
  console.log(`[import] Reading ${filePath}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  console.log(`[import] Sheet "${ws.name}" — ${ws.rowCount} rows`);

  const parsed: Parsed[] = [];
  let currentMain = '', currentSub = '';
  let groupRows = 0;

  for (let r = 11; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const c2 = asText(row.getCell(2).value).trim();
    const c3 = asText(row.getCell(3).value).trim();
    const c4 = asText(row.getCell(4).value).trim();
    const c6 = asText(row.getCell(6).value).trim();
    const c8 = asText(row.getCell(8).value).trim();

    if (!c2 && !c3 && !c4) continue;

    // Group row: col2 equals col3 (merged-cell effect)
    if (c2 && c2 === c3) {
      groupRows++;
      if (c2.includes('(MAIN GROUP)') || /^\d{1,2}-[A-Z]/i.test(c2)) {
        currentMain = c2;
      } else {
        currentSub = c2;
      }
      continue;
    }

    // Item row: Sr.No numeric, has code + description
    if (/^\d+$/.test(c2) && c3 && c4) {
      const stock = parseFloat(c8.replace(/,/g, '')) || 0;
      parsed.push({
        name: c4.replace(/\s+/g, ' ').trim(),
        oldCode: c3,
        unit: (c6 || 'nos').toLowerCase(),
        stock,
        mainGroup: currentMain,
        subGroup: currentSub,
      });
    }
  }

  console.log(`[import] Parsed: ${parsed.length} items, ${groupRows} group rows`);
  console.log(`[import] With stock > 0: ${parsed.filter(p => p.stock > 0).length}`);

  // Dedupe inside xlsx by normalized name (keep highest stock if repeated — shouldn't be, but safe)
  const byName = new Map<string, Parsed>();
  for (const p of parsed) {
    const key = normalizeName(p.name);
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev || p.stock > prev.stock) byName.set(key, p);
  }
  const unique = [...byName.values()];
  console.log(`[import] Unique by name: ${unique.length}`);

  // Load existing items (name + code + stock for matching)
  const existing = await prisma.inventoryItem.findMany({ select: { id: true, name: true, code: true, currentStock: true } });
  const existingByCode = new Map(existing.map(e => [e.code, e]));
  const existingByName = new Map(existing.map(e => [normalizeName(e.name), e]));

  const toInsert: Parsed[] = [];
  const toSeedStock: { id: string; newStock: number }[] = []; // only items currently at stock=0
  let skipExistingStock = 0; // matched + DB already has stock — don't touch

  for (const u of unique) {
    const nameHit = existingByName.get(normalizeName(u.name));
    const codeHit = existingByCode.get(u.oldCode);
    const hit = nameHit || codeHit;
    if (hit) {
      if (hit.currentStock > 0) {
        skipExistingStock++;
      } else if (u.stock > 0) {
        toSeedStock.push({ id: hit.id, newStock: u.stock });
      }
      continue;
    }
    toInsert.push(u);
  }

  console.log(`[import] To insert (new): ${toInsert.length}`);
  console.log(`[import] To seed stock on existing (DB stock=0, xlsx stock>0): ${toSeedStock.length}`);
  console.log(`[import] Skipped (existing with live stock or zero both sides): ${unique.length - toInsert.length - toSeedStock.length}`);
  console.log(`[import]   of which matched but DB already has stock: ${skipExistingStock}`);

  // Fallback code counter
  let maxFallback = 0;
  for (const { code } of existing) {
    const m = /^ITM-IMP-(\d+)$/.exec(code);
    if (m) { const n = parseInt(m[1], 10); if (!isNaN(n) && n > maxFallback) maxFallback = n; }
  }

  const usedCodes = new Set(existing.map(e => e.code));
  let fallbackUsed = 0;
  const records = toInsert.map(it => {
    let code = it.oldCode;
    if (!code || usedCodes.has(code)) {
      maxFallback++;
      code = `ITM-IMP-${String(maxFallback).padStart(5, '0')}`;
      fallbackUsed++;
    }
    usedCodes.add(code);
    return {
      name: it.name,
      code,
      category: 'GENERAL',
      unit: it.unit || 'nos',
      currentStock: it.stock,
      minStock: 0,
      costPerUnit: 0,
      subCategory: it.mainGroup || it.subGroup || null,
    };
  });
  console.log(`[import] Fallback codes used (collisions or blank): ${fallbackUsed}`);

  // Insert via createMany with skipDuplicates (safety net on code)
  let inserted = 0;
  if (records.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH);
      const res = await prisma.inventoryItem.createMany({ data: chunk, skipDuplicates: true });
      inserted += res.count;
      process.stdout.write(`  inserted ${inserted}/${records.length}\r`);
    }
    console.log();
  }

  // Seed stock on matched existing items (currentStock 0 → xlsx value)
  let seeded = 0;
  if (toSeedStock.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < toSeedStock.length; i += BATCH) {
      const chunk = toSeedStock.slice(i, i + BATCH);
      await prisma.$transaction(chunk.map(s =>
        prisma.inventoryItem.update({ where: { id: s.id }, data: { currentStock: s.newStock } })
      ));
      seeded += chunk.length;
      process.stdout.write(`  seeded stock ${seeded}/${toSeedStock.length}\r`);
    }
    console.log();
  }

  const totalStockInserted = records.reduce((s, r) => s + r.currentStock, 0);
  const totalStockSeeded = toSeedStock.reduce((s, r) => s + r.newStock, 0);
  console.log(`[import] Done. Inserted: ${inserted}  |  Seeded stock on existing: ${seeded}`);
  console.log(`[import] Opening stock: inserted=${totalStockInserted.toFixed(2)}, seeded=${totalStockSeeded.toFixed(2)}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
