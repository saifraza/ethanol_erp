// Import item master from old-ERP xlsx dump.
// Per user: use ONLY the item name. Ignore codes and stock counts from the sheet —
// those don't reflect current reality (old ERP data is frozen).
//
// Run:  cd backend && npx tsx scripts/import-items-from-xlsx.ts [path-to-xlsx]
// Default path: ~/Downloads/RptItemList.xlsx
//
// Behavior:
//  - Peeks at the sheet first — logs columns + first 5 rows so you can verify.
//  - Finds the column that looks like "Item Name" / "Particulars" / "Description".
//  - Dedupes by trimmed name.
//  - Skips items that already exist in InventoryItem (case-insensitive name match).
//  - Inserts new items with a generated unique code, unit="nos", category="GENERAL",
//    currentStock=0, minStock=0, costPerUnit=0.
//  - Prints summary: total rows, unique names, already-existed, newly imported.
//
// Safe to re-run.

import ExcelJS from 'exceljs';
import path from 'path';
import os from 'os';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const filePath = process.argv[2] || path.join(os.homedir(), 'Downloads', 'RptItemList.xlsx');
  console.log(`[import] Reading ${filePath}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  console.log('[import] Sheets:', wb.worksheets.map(w => `${w.name} (${w.rowCount} rows)`));

  // Try each sheet; pick the one with an item-name-like column
  let chosenSheet: ExcelJS.Worksheet | null = null;
  let nameColIdx = -1;
  let headerRow = -1;

  const NAME_HINTS = ['item name', 'particulars', 'description', 'material', 'product', 'name'];
  const CODE_HINTS = ['code', 'item code', 'sku'];

  for (const ws of wb.worksheets) {
    // Scan first 10 rows looking for a header
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const values = (row.values as unknown[]).slice(1).map(v => String(v ?? '').trim().toLowerCase());
      for (let c = 0; c < values.length; c++) {
        if (NAME_HINTS.some(h => values[c] === h || values[c].includes(h))) {
          // Require that another column looks like a code, or that this is the widest textual col
          const hasCode = values.some((v, idx) => idx !== c && CODE_HINTS.some(h => v.includes(h)));
          const textCols = values.filter(v => v.length > 0).length;
          if (hasCode || textCols >= 2) {
            chosenSheet = ws;
            nameColIdx = c + 1; // 1-indexed in exceljs row.values
            headerRow = r;
            break;
          }
        }
      }
      if (chosenSheet) break;
    }
    if (chosenSheet) break;
  }

  if (!chosenSheet) {
    // Fallback — first non-empty text column of first sheet
    const ws = wb.worksheets[0];
    console.log('[import] No obvious header found — peek:');
    ws.eachRow((row, num) => {
      if (num > 5) return;
      console.log(`  row ${num}:`, (row.values as unknown[]).slice(1));
    });
    throw new Error('Could not detect item-name column. Inspect peek output and adjust script.');
  }

  console.log(`[import] Using sheet "${chosenSheet.name}", header row ${headerRow}, name col ${nameColIdx}`);

  // Collect names
  const rawNames: string[] = [];
  chosenSheet.eachRow((row, num) => {
    if (num <= headerRow) return;
    const cellVal = row.getCell(nameColIdx).value;
    const name = cellVal == null ? '' : String(typeof cellVal === 'object' && 'text' in (cellVal as object) ? (cellVal as { text: string }).text : cellVal).trim();
    if (name && name.toLowerCase() !== 'item name' && name.length > 1) rawNames.push(name);
  });

  console.log(`[import] Raw names: ${rawNames.length}`);

  // Dedupe by normalized lowercase name
  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const n of rawNames) {
    const key = n.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!seen.has(key) && key) {
      seen.add(key);
      uniqueNames.push(n.replace(/\s+/g, ' ').trim());
    }
  }
  console.log(`[import] Unique names: ${uniqueNames.length}`);

  // Check existing items (case-insensitive)
  const existing = await prisma.inventoryItem.findMany({ select: { name: true } });
  const existingSet = new Set(existing.map(e => e.name.toLowerCase().trim()));

  const toInsert: string[] = [];
  let alreadyExisted = 0;
  for (const n of uniqueNames) {
    if (existingSet.has(n.toLowerCase().trim())) alreadyExisted++;
    else toInsert.push(n);
  }
  console.log(`[import] Already in DB: ${alreadyExisted}  |  To insert: ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log('[import] Nothing to do.');
    return;
  }

  // Find max existing code numeric suffix for auto-increment
  const allCodes = await prisma.inventoryItem.findMany({ select: { code: true } });
  let maxN = 0;
  for (const { code } of allCodes) {
    const m = /(\d+)$/.exec(code);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }

  // Insert in batches of 50 for safety
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((name, j) => {
        const code = `ITM-IMP-${String(maxN + i + j + 1).padStart(5, '0')}`;
        return prisma.inventoryItem.create({
          data: {
            name,
            code,
            category: 'GENERAL',
            unit: 'nos',
            currentStock: 0,
            minStock: 0,
            costPerUnit: 0,
          },
        });
      })
    );
    inserted += chunk.length;
    process.stdout.write(`  inserted ${inserted}/${toInsert.length}\r`);
  }
  console.log(`\n[import] Done. Inserted ${inserted} new items.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
