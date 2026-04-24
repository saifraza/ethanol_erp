import ExcelJS from 'exceljs';
async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/Users/saifraza/Downloads/Debt Schedule 2.xlsx');
  for (const ws of wb.worksheets) {
    console.log(`\n========== SHEET: ${ws.name} (${ws.rowCount} rows × ${ws.columnCount} cols) ==========`);
    let printed = 0;
    ws.eachRow((row, rowNum) => {
      if (printed >= 80) return;
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const v = cell.value;
        let s = '';
        if (v == null) s = '';
        else if (typeof v === 'object' && (v as any).richText) s = (v as any).richText.map((r: any) => r.text).join('');
        else if (typeof v === 'object' && (v as any).result !== undefined) s = String((v as any).result);
        else if (v instanceof Date) s = v.toISOString().slice(0,10);
        else s = String(v);
        if (colNum <= 12) vals.push(s.slice(0, 25));
      });
      if (vals.some(v => v.trim())) { console.log(`R${rowNum}: ${vals.map((v,i) => `[${String.fromCharCode(64+i+1)}] ${v}`).join(' | ')}`); printed++; }
    });
  }
}
main().catch(e => { console.error(e); process.exit(1); });
