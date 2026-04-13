/**
 * Daily Weighment Report — Auto-emailed at 9 AM IST
 *
 * Generates a styled Excel with Summary + All Weighments + category sheets
 * for the previous 24h window (9 AM IST → 9 AM IST).
 * Recipients: hardcoded for now, can move to Settings table later.
 */

import ExcelJS from 'exceljs';
import prisma from '../config/prisma';
import { sendEmail } from './messaging';

const RECIPIENTS = [
  'itmahakaushal@gmail.com',
  'sahil.raza01@gmail.com',
  'saif.raza9@gmail.com',
];

const IST_MS = 5.5 * 60 * 60 * 1000;

// ── Helpers ──

function nowIST(): Date { return new Date(Date.now() + IST_MS); }

function fmtDate(d: Date | null): string {
  if (!d) return '';
  const ist = new Date(d.getTime() + IST_MS);
  const day = ist.getUTCDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

function fmtTime(d: Date | null): string {
  if (!d) return '';
  const ist = new Date(d.getTime() + IST_MS);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDateFull(d: Date): string {
  const ist = new Date(d.getTime() + IST_MS);
  const day = ist.getUTCDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[ist.getUTCMonth()]} ${ist.getUTCFullYear()} 9:00 AM`;
}

// ── Colors ──

const C = {
  headerBg: 'FF1E3A5F',
  titleBg: 'FF0D47A1',
  subtitleBg: 'FF1565C0',
  accentGreen: 'FF2E7D32',
  accentOrange: 'FFE65100',
  accentBlue: 'FF1565C0',
  accentPurple: 'FF6A1B9A',
  stripEven: 'FFF5F7FA',
  stripOdd: 'FFFFFFFF',
  totalBg: 'FF263238',
  totalFont: 'FFFFFFFF',
  borderColor: 'FFB0BEC5',
  kpiBg: 'FFECEFF1',
  white: 'FFFFFFFF',
};

const CAT_COLORS: Record<string, { accent: string; label: string }> = {
  RAW_MATERIAL: { accent: 'FF2E7D32', label: 'Raw Material' },
  FUEL: { accent: 'FFE65100', label: 'Fuel' },
  DDGS: { accent: 'FF1565C0', label: 'DDGS' },
  ETHANOL: { accent: 'FF6A1B9A', label: 'Ethanol' },
  OTHER: { accent: 'FF546E7A', label: 'Other' },
};

function catLabel(cat: string): string { return CAT_COLORS[cat]?.label || cat; }
function catAccent(cat: string): string { return CAT_COLORS[cat]?.accent || 'FF546E7A'; }

// ── Styling ──

function styleHeader(row: ExcelJS.Row, bgColor?: string) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: C.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor || C.headerBg } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF455A64' } },
    };
  });
}

function styleDataRow(row: ExcelJS.Row, idx: number) {
  const bg = idx % 2 === 0 ? C.stripEven : C.stripOdd;
  row.height = 18;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    cell.font = { size: 9.5 };
    cell.alignment = { vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: C.borderColor } },
      right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    };
    if (typeof cell.value === 'number') {
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = '#,##0';
    }
  });
}

function styleTotalRow(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: C.totalFont } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { top: { style: 'medium', color: { argb: 'FF000000' } } };
    if (typeof cell.value === 'number') {
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = '#,##0';
    }
  });
}

// ── Excel Generation ──

interface WRow {
  ticketNo: number | null;
  vehicleNo: string;
  direction: string;
  materialName: string | null;
  materialCategory: string | null;
  supplierName: string | null;
  customerName: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  grossTime: Date | null;
  tareTime: Date | null;
  gateEntryAt: Date | null;
  status: string;
  bags: number | null;
  transporterName: string | null;
}

export async function generateWeighmentExcel(from: Date, to: Date): Promise<Buffer> {
  const rows: WRow[] = await prisma.weighment.findMany({
    where: { gateEntryAt: { gte: from, lt: to }, cancelled: false },
    orderBy: [{ materialCategory: 'asc' }, { gateEntryAt: 'asc' }],
    select: {
      ticketNo: true, vehicleNo: true, direction: true, materialName: true, materialCategory: true,
      supplierName: true, customerName: true, grossWeight: true, tareWeight: true, netWeight: true,
      grossTime: true, tareTime: true, gateEntryAt: true, status: true, bags: true, transporterName: true,
    },
    take: 1000,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MSPIL ERP';

  // Group by category
  const groups: Record<string, { count: number; netKg: number; grossKg: number }> = {};
  let inbound = 0, outbound = 0, totalNet = 0;
  for (const r of rows) {
    const cat = r.materialCategory || 'OTHER';
    if (!groups[cat]) groups[cat] = { count: 0, netKg: 0, grossKg: 0 };
    groups[cat].count++;
    groups[cat].netKg += r.netWeight || 0;
    groups[cat].grossKg += r.grossWeight || 0;
    totalNet += r.netWeight || 0;
    if (r.direction === 'INBOUND') inbound++; else outbound++;
  }

  // ═══ SUMMARY ═══
  const ws = wb.addWorksheet('Summary');
  ws.mergeCells('A1:F1');
  const t1 = ws.getCell('A1');
  t1.value = 'MAHAKAUSHAL SUGAR & POWER INDUSTRIES LTD';
  t1.font = { bold: true, size: 16, color: { argb: C.white } };
  t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.titleBg } };
  t1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:F2');
  const t2 = ws.getCell('A2');
  t2.value = 'Daily Weighment Report';
  t2.font = { bold: true, size: 13, color: { argb: C.white } };
  t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.subtitleBg } };
  t2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 26;

  ws.mergeCells('A3:F3');
  const t3 = ws.getCell('A3');
  t3.value = `Period: ${fmtDateFull(from)}  to  ${fmtDateFull(to)}`;
  t3.font = { size: 10, italic: true, color: { argb: 'FF37474F' } };
  t3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.kpiBg } };
  t3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(3).height = 22;

  ws.addRow([]);

  // KPI labels
  ws.mergeCells('A5:B5'); ws.getCell('A5').value = 'Total Trucks';
  ws.getCell('A5').font = { size: 9, color: { argb: 'FF78909C' } }; ws.getCell('A5').alignment = { horizontal: 'center' };
  ws.mergeCells('C5:D5'); ws.getCell('C5').value = 'Inbound';
  ws.getCell('C5').font = { size: 9, color: { argb: 'FF78909C' } }; ws.getCell('C5').alignment = { horizontal: 'center' };
  ws.mergeCells('E5:F5'); ws.getCell('E5').value = 'Outbound';
  ws.getCell('E5').font = { size: 9, color: { argb: 'FF78909C' } }; ws.getCell('E5').alignment = { horizontal: 'center' };

  ws.mergeCells('A6:B6'); ws.getCell('A6').value = rows.length;
  ws.getCell('A6').font = { bold: true, size: 22, color: { argb: C.titleBg } }; ws.getCell('A6').alignment = { horizontal: 'center' };
  ws.mergeCells('C6:D6'); ws.getCell('C6').value = inbound;
  ws.getCell('C6').font = { bold: true, size: 22, color: { argb: C.accentGreen } }; ws.getCell('C6').alignment = { horizontal: 'center' };
  ws.mergeCells('E6:F6'); ws.getCell('E6').value = outbound;
  ws.getCell('E6').font = { bold: true, size: 22, color: { argb: C.accentBlue } }; ws.getCell('E6').alignment = { horizontal: 'center' };
  ws.getRow(6).height = 32;
  for (let c = 1; c <= 6; c++) {
    ws.getCell(5, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.kpiBg } };
    ws.getCell(6, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.kpiBg } };
  }

  ws.addRow([]);
  styleHeader(ws.addRow(['Category', 'Trucks', 'Net (kg)', 'Net (MT)', 'Gross (kg)', 'Gross (MT)']), C.headerBg);
  let ri = 0;
  for (const [cat, d] of Object.entries(groups).sort()) {
    const row = ws.addRow([catLabel(cat), d.count, d.netKg, +(d.netKg / 1000).toFixed(2), d.grossKg, +(d.grossKg / 1000).toFixed(2)]);
    styleDataRow(row, ri++);
    row.getCell(1).font = { bold: true, size: 10, color: { argb: catAccent(cat) } };
  }
  styleTotalRow(ws.addRow(['TOTAL', rows.length, totalNet, +(totalNet / 1000).toFixed(2), '', '']));
  [18, 10, 16, 14, 16, 14].forEach((w, i) => ws.getColumn(i + 1).width = w);

  // ═══ ALL WEIGHMENTS ═══
  const det = wb.addWorksheet('All Weighments');
  styleHeader(det.addRow(['Ticket', 'Date', 'Gate In', 'Gross Time', 'Tare Time', 'Vehicle', 'Dir', 'Category', 'Material', 'Supplier / Customer', 'Gross (kg)', 'Tare (kg)', 'Net (kg)', 'Net (MT)', 'Bags', 'Status']), C.headerBg);
  rows.forEach((r, i) => {
    const row = det.addRow([
      r.ticketNo ? `T-${r.ticketNo}` : '--', fmtDate(r.gateEntryAt), fmtTime(r.gateEntryAt),
      fmtTime(r.grossTime), fmtTime(r.tareTime), r.vehicleNo,
      r.direction === 'OUTBOUND' ? 'OUT' : 'IN', catLabel(r.materialCategory || 'OTHER'),
      r.materialName || '--', r.direction === 'OUTBOUND' ? (r.customerName || '--') : (r.supplierName || '--'),
      r.grossWeight || 0, r.tareWeight || 0, r.netWeight || 0,
      +((r.netWeight || 0) / 1000).toFixed(2), r.bags || '--', r.status,
    ]);
    styleDataRow(row, i);
    row.getCell(7).font = { bold: true, size: 9, color: { argb: r.direction === 'OUTBOUND' ? C.accentBlue : C.accentGreen } };
    row.getCell(16).font = { bold: true, size: 9, color: { argb: r.status === 'COMPLETE' ? C.accentGreen : C.accentOrange } };
  });
  styleTotalRow(det.addRow(['', '', '', '', '', '', '', '', '', 'TOTAL',
    rows.reduce((s, r) => s + (r.grossWeight || 0), 0),
    rows.reduce((s, r) => s + (r.tareWeight || 0), 0),
    totalNet, +(totalNet / 1000).toFixed(2), '', '']));
  [8, 12, 10, 10, 10, 16, 6, 14, 16, 28, 14, 14, 14, 12, 8, 12].forEach((w, i) => det.getColumn(i + 1).width = w);
  det.views = [{ state: 'frozen', ySplit: 1 }];
  det.autoFilter = { from: 'A1', to: 'P1' };

  // ═══ CATEGORY SHEETS ═══
  for (const cat of Object.keys(groups).sort()) {
    const catRows = rows.filter(r => (r.materialCategory || 'OTHER') === cat);
    const cs = wb.addWorksheet(catLabel(cat));
    cs.mergeCells('A1:K1');
    const ch = cs.getCell('A1');
    const catNetMT = (catRows.reduce((s, r) => s + (r.netWeight || 0), 0) / 1000).toFixed(2);
    ch.value = `${catLabel(cat).toUpperCase()} — ${catRows.length} Trucks — ${catNetMT} MT Net`;
    ch.font = { bold: true, size: 12, color: { argb: C.white } };
    ch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: catAccent(cat) } };
    ch.alignment = { horizontal: 'center', vertical: 'middle' };
    cs.getRow(1).height = 28;

    styleHeader(cs.addRow(['Ticket', 'Date', 'Time', 'Vehicle', 'Material', 'Supplier / Customer', 'Gross (kg)', 'Tare (kg)', 'Net (kg)', 'Net (MT)', 'Status']), C.headerBg);
    catRows.forEach((r, i) => {
      const row = cs.addRow([
        r.ticketNo ? `T-${r.ticketNo}` : '--', fmtDate(r.gateEntryAt), fmtTime(r.gateEntryAt),
        r.vehicleNo, r.materialName || '--',
        r.direction === 'OUTBOUND' ? (r.customerName || '--') : (r.supplierName || '--'),
        r.grossWeight || 0, r.tareWeight || 0, r.netWeight || 0,
        +((r.netWeight || 0) / 1000).toFixed(2), r.status,
      ]);
      styleDataRow(row, i);
      if (r.status === 'COMPLETE') row.getCell(11).font = { bold: true, size: 9, color: { argb: C.accentGreen } };
    });
    const catTotalNet = catRows.reduce((s, r) => s + (r.netWeight || 0), 0);
    styleTotalRow(cs.addRow(['', '', '', '', '', 'TOTAL',
      catRows.reduce((s, r) => s + (r.grossWeight || 0), 0),
      catRows.reduce((s, r) => s + (r.tareWeight || 0), 0),
      catTotalNet, +(catTotalNet / 1000).toFixed(2), '']));
    [8, 12, 10, 16, 18, 28, 14, 14, 14, 12, 12].forEach((w, i) => cs.getColumn(i + 1).width = w);
    cs.views = [{ state: 'frozen', ySplit: 2 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ── Send Report ──

export async function sendDailyWeighmentReport(overrideFrom?: Date, overrideTo?: Date): Promise<{ success: boolean; error?: string }> {
  // Default: yesterday 9 AM IST → today 9 AM IST
  const ist = nowIST();
  const todayStr = ist.toISOString().slice(0, 10); // YYYY-MM-DD in IST
  const yesterdayDate = new Date(ist);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

  // 9 AM IST = 3:30 AM UTC
  const from = overrideFrom || new Date(`${yesterdayStr}T03:30:00Z`);
  const to = overrideTo || new Date(`${todayStr}T03:30:00Z`);

  try {
    const xlsxBuffer = await generateWeighmentExcel(from, to);
    const filename = `Weighment_Report_${yesterdayStr}.xlsx`;

    const result = await sendEmail({
      to: RECIPIENTS.join(', '),
      subject: `MSPIL Weighment Report — ${fmtDate(from)}`,
      text: `Daily weighment report attached.\n\nPeriod: ${fmtDateFull(from)} to ${fmtDateFull(to)}\n\nGenerated by MSPIL ERP`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <div style="background: #0D47A1; color: white; padding: 16px 24px;">
            <h2 style="margin: 0; font-size: 18px;">MSPIL Daily Weighment Report</h2>
          </div>
          <div style="padding: 16px 24px; background: #f5f5f5;">
            <p style="margin: 0 0 8px; color: #555; font-size: 14px;">
              <strong>Period:</strong> ${fmtDateFull(from)} to ${fmtDateFull(to)}
            </p>
            <p style="margin: 0; color: #888; font-size: 12px;">
              Please find the detailed weighment report attached as Excel.
            </p>
          </div>
          <div style="padding: 12px 24px; font-size: 11px; color: #aaa;">
            Auto-generated by MSPIL ERP &mdash; app.mspil.in
          </div>
        </div>
      `,
      attachments: [{ filename, content: xlsxBuffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
    });

    if (result.success) {
      console.log(`[WEIGHMENT-REPORT] Sent daily report (${fmtDate(from)}) to ${RECIPIENTS.length} recipients. MessageId: ${result.messageId}`);
    } else {
      console.error(`[WEIGHMENT-REPORT] Failed to send: ${result.error}`);
    }
    return result;
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[WEIGHMENT-REPORT] Error generating/sending report: ${msg}`);
    return { success: false, error: msg };
  }
}

// ── Scheduler ──

let _timer: ReturnType<typeof setTimeout> | null = null;

export function startDailyWeighmentReport() {
  // Calculate ms until next 9 AM IST
  const ist = nowIST();
  const target = new Date(ist);
  target.setUTCHours(9, 5, 0, 0); // 9:05 AM IST (5 min buffer for server load)
  if (ist > target) target.setUTCDate(target.getUTCDate() + 1); // next day if past 9 AM

  const msUntilFirst = target.getTime() - ist.getTime();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  console.log(`[WEIGHMENT-REPORT] Scheduled daily report at 9:05 AM IST (first run in ${Math.round(msUntilFirst / 60000)} min)`);

  _timer = setTimeout(() => {
    sendDailyWeighmentReport();
    // Then repeat every 24h
    _timer = setInterval(() => sendDailyWeighmentReport(), ONE_DAY) as unknown as ReturnType<typeof setTimeout>;
  }, msUntilFirst);
}

export function stopDailyWeighmentReport() {
  if (_timer) { clearTimeout(_timer); clearInterval(_timer as unknown as ReturnType<typeof setInterval>); _timer = null; }
}
