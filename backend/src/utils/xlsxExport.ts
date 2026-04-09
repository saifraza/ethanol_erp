/**
 * Generic xlsx streaming helper using exceljs.
 * Usage: streamXlsxResponse(res, 'my-file.xlsx', 'Sheet1', columns, rows)
 */

import { Response } from 'express';
import ExcelJS from 'exceljs';

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  /** 'number' | 'date' | 'string' — controls cell formatting */
  type?: 'number' | 'date' | 'string';
  numFmt?: string; // custom number format string e.g. '#,##0.00'
}

export async function streamXlsxResponse(
  res: Response,
  filename: string,
  sheetName: string,
  columns: XlsxColumn[],
  rows: Record<string, unknown>[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MSPIL ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width ?? 16,
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // slate-800
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 20;

  // Add data rows
  for (const rowData of rows) {
    const addedRow = sheet.addRow(rowData);

    // Apply numeric format where specified
    columns.forEach((col, idx) => {
      const cell = addedRow.getCell(idx + 1);
      if (col.numFmt) {
        cell.numFmt = col.numFmt;
      } else if (col.type === 'number') {
        cell.numFmt = '#,##0.00';
      }
    });
  }

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Auto-filter
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
}
