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

  // Thin border style for grid lines
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };

  // Header bottom border — thicker
  headerRow.eachCell((cell) => {
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });

  // Alternating row fills
  const evenFill: ExcelJS.FillPattern = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF8FAFC' }, // slate-50
  };

  // Add data rows
  for (let ri = 0; ri < rows.length; ri++) {
    const addedRow = sheet.addRow(rows[ri]);
    addedRow.height = 18;

    columns.forEach((col, idx) => {
      const cell = addedRow.getCell(idx + 1);

      // Number formatting
      if (col.numFmt) {
        cell.numFmt = col.numFmt;
      } else if (col.type === 'number') {
        cell.numFmt = '#,##0.00';
      }

      // Grid borders
      cell.border = thinBorder;

      // Font
      cell.font = { size: 10, name: 'Calibri' };

      // Right-align numbers
      if (col.type === 'number') {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { vertical: 'middle' };
      }
    });

    // Alternating row color
    if (ri % 2 === 1) {
      addedRow.eachCell((cell) => {
        cell.fill = evenFill;
      });
    }
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
