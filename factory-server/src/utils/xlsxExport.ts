/**
 * xlsxExport.ts
 * Streams a weighment history Excel workbook to the HTTP response.
 * Matches the 15-column layout used in the cloud ERP reports.
 */

import { Response } from 'express';
import ExcelJS from 'exceljs';
import { UnifiedWeighmentRow } from './weighmentNormalize';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  // Convert UTC → IST for display
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const yy = ist.getUTCFullYear();
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mi = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

const COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: 'Date',           key: 'date',             width: 18 },
  { header: 'Ticket',         key: 'ticketNo',         width: 10 },
  { header: 'Vehicle',        key: 'vehicleNo',        width: 14 },
  { header: 'Party',          key: 'partyName',        width: 28 },
  { header: 'Direction',      key: 'direction',        width: 11 },
  { header: 'Material',       key: 'materialType',     width: 14 },
  { header: 'Gate In',        key: 'gateEntryAt',      width: 18 },
  { header: '1st Wt',         key: 'firstWeightAt',    width: 18 },
  { header: '2nd Wt',         key: 'secondWeightAt',   width: 18 },
  { header: 'Gross (kg)',     key: 'grossWeight',      width: 12 },
  { header: 'Tare (kg)',      key: 'tareWeight',       width: 12 },
  { header: 'Net (kg)',       key: 'netWeight',        width: 12 },
  { header: 'Gate→1st (min)', key: 'gateToFirst',     width: 15 },
  { header: '1st→2nd (min)',  key: 'firstToSecond',   width: 15 },
  { header: 'Turnaround (min)', key: 'turnaround',    width: 17 },
  { header: 'Status',         key: 'status',           width: 12 },
];

export async function streamXlsxResponse(
  res: Response,
  rows: UnifiedWeighmentRow[],
  filename: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MSPIL Factory Hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Weighment History', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  sheet.columns = COLUMNS;

  // Header style
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF64748B' } },
    };
  });
  headerRow.height = 20;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const excelRow = sheet.addRow({
      date:         fmtDate(r.gateEntryAt),
      ticketNo:     r.ticketNo ?? '',
      vehicleNo:    r.vehicleNo,
      partyName:    r.partyName,
      direction:    r.direction,
      materialType: r.materialType,
      gateEntryAt:  fmtDate(r.gateEntryAt),
      firstWeightAt: fmtDate(r.firstWeightAt),
      secondWeightAt: fmtDate(r.secondWeightAt),
      grossWeight:  r.grossWeight ?? '',
      tareWeight:   r.tareWeight ?? '',
      netWeight:    r.netWeight ?? '',
      gateToFirst:  r.durationGateToFirstMin ?? '',
      firstToSecond: r.durationFirstToSecondMin ?? '',
      turnaround:   r.turnaroundMin ?? '',
      status:       r.status,
    });

    // Alternating row fill
    if (i % 2 === 1) {
      excelRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }

    // Right-align numeric columns
    ['grossWeight', 'tareWeight', 'netWeight', 'gateToFirst', 'firstToSecond', 'turnaround'].forEach((key) => {
      const cell = excelRow.getCell(key);
      cell.alignment = { horizontal: 'right' };
    });
  }

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Auto filter
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
}
