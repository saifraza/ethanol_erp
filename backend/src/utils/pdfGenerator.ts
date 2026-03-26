import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { getTemplate, generateBarcode } from './templateHelper';

const LOGO_PNG = path.join(__dirname, '../../assets/MSPIL_logo_transparent.png');

// Company info for fallback (if letterhead not found)
const COMPANY = {
  name: 'Mahakaushal Sugar and Power Industries Ltd.',
  cin: 'U01543MP2005PLC017514',
  gstin: '23AAECM3666P1Z1',
  regdOff: 'SF-11, Second Floor, Aakriti Business Center, Aakriti Eco city, Bawadiya Kalan, Bhopal-462039',
  factory: 'Village Bachai, Dist. Narsinghpur (M.P.) - 487001',
  email: 'mspil.acc@gmail.com | mspil.power@gmail.com',
};

function numberToWords(num: number): string {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(n: number): string {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let result = 'Rupees ' + convert(rupees);
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
  return result + ' Only';
}

function formatINR(n: number): string {
  return 'Rs.' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: Date | string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface POData {
  poNo: number;
  poDate: Date | string;
  deliveryDate: Date | string;
  vendor: {
    name: string;
    tradeName?: string | null;
    gstin?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  supplyType: string;
  placeOfSupply?: string | null;
  paymentTerms?: string | null;
  creditDays?: number;
  deliveryAddress?: string | null;
  transportMode?: string | null;
  remarks?: string | null;
  lines: {
    description: string;
    hsnCode: string;
    quantity: number;
    unit: string;
    rate: number;
    discountPercent: number;
    gstPercent: number;
    isRCM: boolean;
    amount: number;
    taxableAmount: number;
    cgst: number;
    sgst: number;
    igst: number;
    lineTotal: number;
  }[];
  subtotal: number;
  totalGst: number;
  freightCharge: number;
  otherCharges: number;
  roundOff: number;
  grandTotal: number;
}

export async function generatePOPdf(po: POData): Promise<Buffer> {
  const PDFDocument = require('pdfkit');

  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 30, bottom: 30, left: 40, right: 40 } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const W = doc.page.width;
      const M = 40; // margin
      const CW = W - 2 * M; // content width
      const green = '#4A7D28';
      const darkGreen = '#1A3B0A';
      const lightGreen = '#C5D49E';
      const grayText = '#666666';
      const lightBg = '#F7F7F7';

      // ═══════════════════════════════════════════
      // LETTERHEAD
      // ═══════════════════════════════════════════
      doc.rect(M, 25, CW, 85).fill(lightGreen);
      // Logo
      if (fs.existsSync(LOGO_PNG)) {
        doc.image(LOGO_PNG, M + 12, 32, { width: 60, height: 60 });
      }
      // Company text block
      const txLeft = M + 85;
      const txWidth = CW - 95;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(darkGreen)
        .text(COMPANY.name, txLeft, 33, { width: txWidth, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#2D4A2D')
        .text(`CIN - ${COMPANY.cin}   |   GSTIN - ${COMPANY.gstin}`, txLeft, 51, { width: txWidth, align: 'center' });
      doc.font('Helvetica').fontSize(6).fillColor('#3A5A3A')
        .text(`Regd off : ${COMPANY.regdOff}`, txLeft, 62, { width: txWidth, align: 'center' })
        .text(`Admin off & Factory : ${COMPANY.factory}`, txLeft, 71, { width: txWidth, align: 'center' })
        .text(`E-mail : ${COMPANY.email}`, txLeft, 80, { width: txWidth, align: 'center' });
      // Green border lines
      doc.moveTo(M, 113).lineTo(M + CW, 113).lineWidth(1.5).strokeColor(green).stroke();
      doc.moveTo(M, 115.5).lineTo(M + CW, 115.5).lineWidth(0.5).strokeColor('#7A9A10').stroke();

      // ═══════════════════════════════════════════
      // TITLE
      // ═══════════════════════════════════════════
      doc.font('Helvetica-Bold').fontSize(14).fillColor(green)
        .text('PURCHASE ORDER', M, 125, { width: CW, align: 'center' });
      doc.moveTo(M, 143).lineTo(M + CW, 143).lineWidth(0.8).strokeColor('#999').stroke();

      // ═══════════════════════════════════════════
      // PO DETAILS — 4-column grid
      // ═══════════════════════════════════════════
      let y = 150;
      const labelStyle = () => doc.font('Helvetica-Bold').fontSize(7).fillColor(grayText);
      const valueStyle = () => doc.font('Helvetica').fontSize(8).fillColor('#000');
      const valueBoldStyle = () => doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');

      const col1 = M;
      const col2 = M + 130;
      const col3 = M + CW / 2 + 10;
      const col4 = M + CW / 2 + 100;

      labelStyle().text('PO Number', col1, y);
      valueBoldStyle().text(`PO-${String(po.poNo).padStart(4, '0')}`, col2, y);
      labelStyle().text('PO Date', col3, y);
      valueStyle().text(formatDate(po.poDate), col4, y);
      y += 14;
      labelStyle().text('Delivery Date', col1, y);
      valueStyle().text(formatDate(po.deliveryDate), col2, y);
      labelStyle().text('Supply Type', col3, y);
      valueStyle().text(po.supplyType === 'INTER_STATE' ? 'Inter State' : 'Intra State', col4, y);
      if (po.placeOfSupply) {
        y += 14;
        labelStyle().text('Place of Supply', col1, y);
        valueStyle().text(po.placeOfSupply, col2, y);
      }
      y += 18;

      // ═══════════════════════════════════════════
      // VENDOR + DELIVERY BOXES (side by side)
      // ═══════════════════════════════════════════
      const boxW = (CW - 10) / 2;
      const boxH = 72;
      const boxY = y;

      // Vendor box
      doc.rect(M, boxY, boxW, boxH).lineWidth(0.5).strokeColor('#CCCCCC').fillAndStroke(lightBg, '#CCCCCC');
      doc.rect(M, boxY, boxW, 13).fill('#E8E8E8');
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(grayText)
        .text('VENDOR / SUPPLIER', M + 5, boxY + 3, { width: boxW - 10 });
      let vy = boxY + 16;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000')
        .text(po.vendor.name, M + 5, vy, { width: boxW - 10 });
      vy += 12;
      if (po.vendor.tradeName) {
        doc.font('Helvetica').fontSize(7).fillColor(grayText)
          .text(po.vendor.tradeName, M + 5, vy, { width: boxW - 10 });
        vy += 9;
      }
      if (po.vendor.address) {
        doc.font('Helvetica').fontSize(7).fillColor('#333')
          .text(po.vendor.address, M + 5, vy, { width: boxW - 10 });
        vy += 9;
      }
      const cityLine = [po.vendor.city, po.vendor.state, po.vendor.pincode].filter(Boolean).join(', ');
      if (cityLine) {
        doc.font('Helvetica').fontSize(7).fillColor('#333')
          .text(cityLine, M + 5, vy, { width: boxW - 10 });
        vy += 9;
      }
      if (po.vendor.gstin) {
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#333')
          .text(`GSTIN: ${po.vendor.gstin}`, M + 5, vy, { width: boxW - 10 });
      }

      // Delivery box
      const dx = M + boxW + 10;
      doc.rect(dx, boxY, boxW, boxH).lineWidth(0.5).strokeColor('#CCCCCC').fillAndStroke(lightBg, '#CCCCCC');
      doc.rect(dx, boxY, boxW, 13).fill('#E8E8E8');
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(grayText)
        .text('DELIVERY TO', dx + 5, boxY + 3, { width: boxW - 10 });
      let dy = boxY + 16;
      doc.font('Helvetica').fontSize(7.5).fillColor('#000')
        .text(po.deliveryAddress || COMPANY.factory, dx + 5, dy, { width: boxW - 10 });
      dy += 20;
      if (po.paymentTerms) {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(grayText).text('Payment:', dx + 5, dy);
        doc.font('Helvetica').fontSize(7).fillColor('#333').text(po.paymentTerms, dx + 55, dy);
        dy += 10;
      }
      if (po.transportMode) {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(grayText).text('Transport:', dx + 5, dy);
        doc.font('Helvetica').fontSize(7).fillColor('#333').text(po.transportMode, dx + 55, dy);
      }

      y = boxY + boxH + 12;

      // ═══════════════════════════════════════════
      // LINE ITEMS TABLE
      // ═══════════════════════════════════════════
      const tCols = [
        { label: '#',    w: 20,  align: 'center' as const },
        { label: 'Description', w: 140, align: 'left' as const },
        { label: 'HSN',  w: 45,  align: 'center' as const },
        { label: 'Qty',  w: 40,  align: 'right' as const },
        { label: 'Unit', w: 30,  align: 'center' as const },
        { label: 'Rate (₹)', w: 55, align: 'right' as const },
        { label: 'GST%', w: 30,  align: 'center' as const },
        { label: 'Taxable (₹)', w: 70, align: 'right' as const },
        { label: 'Total (₹)', w: CW - 20 - 140 - 45 - 40 - 30 - 55 - 30 - 70, align: 'right' as const },
      ];

      // Header
      const rowH = 16;
      doc.rect(M, y, CW, rowH).fill(green);
      let cx = M;
      tCols.forEach(col => {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#FFF')
          .text(col.label, cx + 3, y + 4, { width: col.w - 6, align: col.align });
        // Vertical divider
        if (cx > M) {
          doc.moveTo(cx, y).lineTo(cx, y + rowH).lineWidth(0.3).strokeColor('#2D5A14').stroke();
        }
        cx += col.w;
      });
      y += rowH;

      // Data rows
      po.lines.forEach((line, idx) => {
        const bg = idx % 2 === 0 ? '#F5F5F5' : '#FFFFFF';
        doc.rect(M, y, CW, rowH).fill(bg);
        // Bottom border
        doc.moveTo(M, y + rowH).lineTo(M + CW, y + rowH).lineWidth(0.3).strokeColor('#DDD').stroke();

        cx = M;
        const vals = [
          String(idx + 1),
          line.description,
          line.hsnCode,
          line.quantity.toLocaleString('en-IN'),
          line.unit,
          formatINR(line.rate).replace('Rs.', ''),
          `${line.gstPercent}%`,
          formatINR(line.taxableAmount).replace('Rs.', ''),
          formatINR(line.lineTotal).replace('Rs.', ''),
        ];
        tCols.forEach((col, ci) => {
          // Vertical divider
          if (cx > M) {
            doc.moveTo(cx, y).lineTo(cx, y + rowH).lineWidth(0.2).strokeColor('#E0E0E0').stroke();
          }
          const isDesc = ci === 1;
          const txt = isDesc && vals[ci].length > 32 ? vals[ci].substring(0, 30) + '..' : vals[ci];
          doc.font('Helvetica').fontSize(7).fillColor('#222')
            .text(txt, cx + 3, y + 4, { width: col.w - 6, align: col.align });
          cx += col.w;
        });
        y += rowH;
      });

      // Table bottom border
      doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.8).strokeColor('#999').stroke();
      // Table side borders
      doc.rect(M, y - (po.lines.length * rowH) - rowH, CW, (po.lines.length + 1) * rowH)
        .lineWidth(0.5).strokeColor('#999').stroke();

      y += 8;

      // ═══════════════════════════════════════════
      // TOTALS — right-aligned box
      // ═══════════════════════════════════════════
      const totW = 210;
      const totX = M + CW - totW;
      const totLabelX = totX + 5;
      const totValX = totX + 110;
      const totValW = totW - 115;

      const drawTotalRow = (label: string, value: number, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 9 : 8).fillColor(bold ? green : '#333')
          .text(label, totLabelX, y, { width: 100, align: 'right' });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 9 : 8).fillColor(bold ? green : '#000')
          .text(formatINR(value), totValX, y, { width: totValW, align: 'right' });
        y += bold ? 16 : 13;
      };

      // Divider line above totals
      doc.moveTo(totX, y - 2).lineTo(totX + totW, y - 2).lineWidth(0.3).strokeColor('#CCC').stroke();
      y += 4;

      drawTotalRow('Subtotal', po.subtotal);
      drawTotalRow('GST', po.totalGst);
      if (po.freightCharge) drawTotalRow('Freight', po.freightCharge);
      if (po.otherCharges) drawTotalRow('Other Charges', po.otherCharges);
      if (po.roundOff) drawTotalRow('Round Off', po.roundOff);

      // Grand total with background
      doc.rect(totX, y - 2, totW, 18).fill('#E8F0E0');
      doc.moveTo(totX, y - 2).lineTo(totX + totW, y - 2).lineWidth(1).strokeColor(green).stroke();
      drawTotalRow('GRAND TOTAL', po.grandTotal, true);

      // Amount in words — full width
      y += 2;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(grayText).text('Amount in Words:', M, y);
      y += 9;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000')
        .text(numberToWords(po.grandTotal), M, y, { width: CW });
      y += 14;

      // ═══════════════════════════════════════════
      // REMARKS
      // ═══════════════════════════════════════════
      if (po.remarks) {
        doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.3).strokeColor('#DDD').stroke();
        y += 6;
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(grayText).text('Remarks:', M, y);
        y += 9;
        doc.font('Helvetica').fontSize(7).fillColor('#333')
          .text(po.remarks, M, y, { width: CW });
        y += 14;
      }

      // ═══════════════════════════════════════════
      // TERMS & CONDITIONS
      // ═══════════════════════════════════════════
      const tmpl = await getTemplate('PURCHASE_ORDER');
      doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.3).strokeColor('#DDD').stroke();
      y += 6;
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#333').text('Terms & Conditions:', M, y);
      y += 10;
      tmpl.terms.forEach((t: string, i: number) => {
        doc.font('Helvetica').fontSize(6.5).fillColor(grayText)
          .text(`${i + 1}. ${t}`, M + 5, y, { width: CW - 10 });
        y += 9;
      });
      y += 8;

      // ═══════════════════════════════════════════
      // BARCODE
      // ═══════════════════════════════════════════
      try {
        const barcodeImg = await generateBarcode(`PO-${po.poNo}`);
        doc.image(barcodeImg, M + CW - 130, y - 3, { width: 120, height: 22 });
      } catch { /* barcode failed */ }

      // ═══════════════════════════════════════════
      // SIGNATURES
      // ═══════════════════════════════════════════
      y += 25;
      const sigW = CW / 3;
      const sigs = ['Prepared By', 'Approved By', 'Authorized Signatory'];
      sigs.forEach((label, i) => {
        const sx = M + i * sigW;
        doc.moveTo(sx + 10, y + 20).lineTo(sx + sigW - 10, y + 20).lineWidth(0.3).strokeColor('#CCC').stroke();
        doc.font('Helvetica-Bold').fontSize(7).fillColor(grayText)
          .text(label, sx, y + 24, { width: sigW, align: 'center' });
      });

      // ═══════════════════════════════════════════
      // FOOTER
      // ═══════════════════════════════════════════
      doc.font('Helvetica').fontSize(6).fillColor('#999')
        .text(tmpl.footer, M, doc.page.height - 25, { width: CW, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Generate Invoice PDF
interface InvoiceData {
  invoiceNo: number;
  invoiceDate: Date | string;
  dueDate?: Date | string | null;
  customer: {
    name: string;
    shortName?: string | null;
    gstin?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
  };
  productName: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  gstPercent: number;
  gstAmount: number;
  freightCharge: number;
  totalAmount: number;
  challanNo?: string | null;
  ewayBill?: string | null;
  remarks?: string | null;
  orderId?: string | null;
  shipmentId?: string | null;
}

export async function generateInvoicePdf(inv: InvoiceData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([595.28, 841.89]); // A4

  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalicH = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontTimesBI = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);

  // Vector letterhead
  const bandY2 = height - 118;
  const bandH2 = 100;
  page.drawRectangle({ x: 40, y: bandY2, width: width - 80, height: bandH2, color: rgb(0.77, 0.83, 0.62) });
  if (fs.existsSync(LOGO_PNG)) {
    const logoPng2 = fs.readFileSync(LOGO_PNG);
    const logoImg2 = await pdfDoc.embedPng(logoPng2);
    page.drawImage(logoImg2, { x: 58, y: bandY2 + 17, width: 65, height: 65 });
  }
  // Company text — centered between logo and right edge
  const txL2 = 135;
  const txR2 = width - 45;
  const txW2 = txR2 - txL2;
  const cx2 = (t: string, sz: number, f: typeof font) => txL2 + (txW2 - f.widthOfTextAtSize(t, sz)) / 2;
  const nameStr2 = COMPANY.name;
  page.drawText(nameStr2, { x: cx2(nameStr2, 17, fontBold), y: bandY2 + 72, size: 17, font: fontBold, color: rgb(0.1, 0.23, 0.1) });
  const cinStr2 = `CIN - ${COMPANY.cin}, GSTIN - ${COMPANY.gstin}`;
  page.drawText(cinStr2, { x: cx2(cinStr2, 7.5, fontBold), y: bandY2 + 58, size: 7.5, font: fontBold, color: rgb(0.18, 0.29, 0.18) });
  const regdStr2 = `Regd off : ${COMPANY.regdOff}`;
  page.drawText(regdStr2, { x: cx2(regdStr2, 7, font), y: bandY2 + 46, size: 7, font, color: rgb(0.23, 0.35, 0.23) });
  const factStr2 = `Admin off & Factory : ${COMPANY.factory}`;
  page.drawText(factStr2, { x: cx2(factStr2, 7, font), y: bandY2 + 34, size: 7, font, color: rgb(0.29, 0.49, 0.25) });
  const emailStr2 = `E-mail : ${COMPANY.email}`;
  page.drawText(emailStr2, { x: cx2(emailStr2, 7, font), y: bandY2 + 22, size: 7, font, color: rgb(0.29, 0.49, 0.25) });
  page.drawLine({ start: { x: 40, y: bandY2 - 3 }, end: { x: width - 40, y: bandY2 - 3 }, thickness: 1.5, color: rgb(0.29, 0.49, 0.25) });
  page.drawLine({ start: { x: 40, y: bandY2 - 5.5 }, end: { x: width - 40, y: bandY2 - 5.5 }, thickness: 0.5, color: rgb(0.48, 0.6, 0.1) });

  const black = rgb(0, 0, 0);
  const gray = rgb(0.35, 0.35, 0.35);
  const lightGray = rgb(0.55, 0.55, 0.55);
  const green = rgb(0.29, 0.49, 0.25); // MSPIL green #4a7c3f
  const white = rgb(1, 1, 1);

  const mL = 45;            // left margin
  const mR = width - 45;    // right margin
  const cW = mR - mL;       // content width
  let y = bandY2 - 16;      // start below letterhead

  const text = (t: string, x: number, yP: number, size: number, f = font, color = black) => {
    page.drawText(t, { x, y: yP, size, font: f, color });
  };
  const line = (yP: number, thick = 0.5, color = rgb(0.8, 0.8, 0.8)) => {
    page.drawLine({ start: { x: mL, y: yP }, end: { x: mR, y: yP }, thickness: thick, color });
  };
  const rightText = (t: string, yP: number, size: number, f = font, color = black) => {
    const w = f.widthOfTextAtSize(t, size);
    text(t, mR - w, yP, size, f, color);
  };

  // ═══ TITLE BAR ═══
  page.drawRectangle({ x: mL, y: y - 4, width: cW, height: 22, color: green });
  const titleW = fontBold.widthOfTextAtSize('TAX INVOICE', 13);
  text('TAX INVOICE', mL + (cW - titleW) / 2, y, 13, fontBold, white);
  y -= 28;

  // ═══ INVOICE DETAILS — 2 column grid ═══
  const col2 = width / 2 + 10;
  text('Invoice No:', mL, y, 9, fontBold, lightGray);
  text(`INV-${inv.invoiceNo}`, mL + 62, y, 9, fontBold);
  text('Date:', col2, y, 9, fontBold, lightGray);
  text(formatDate(inv.invoiceDate), col2 + 32, y, 9, fontBold);
  y -= 13;
  if (inv.dueDate) { text('Due Date:', mL, y, 8, font, lightGray); text(formatDate(inv.dueDate), mL + 55, y, 8); }
  if (inv.challanNo) { text('Challan:', col2, y, 8, font, lightGray); text(inv.challanNo, col2 + 45, y, 8); }
  y -= 13;
  if (inv.ewayBill) { text('E-Way Bill:', mL, y, 8, font, lightGray); text(inv.ewayBill, mL + 60, y, 8); }
  y -= 14;
  line(y, 0.3);
  y -= 10;

  // ═══ BILL TO ═══
  page.drawRectangle({ x: mL, y: y - 52, width: cW, height: 56, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });
  text('BILL TO', mL + 6, y - 2, 7, fontBold, lightGray);
  let bY = y - 14;
  text(inv.customer.name, mL + 6, bY, 10, fontBold); bY -= 11;
  const custAddr = [inv.customer.address].filter(Boolean).join('');
  if (custAddr) { text(custAddr, mL + 6, bY, 8); bY -= 10; }
  const custCity = [inv.customer.city, inv.customer.state, inv.customer.pincode].filter(Boolean).join(', ');
  if (custCity) { text(custCity, mL + 6, bY, 8); bY -= 10; }
  if (inv.customer.gstin) { text(`GSTIN: ${inv.customer.gstin}`, mL + 6, bY, 8, font, lightGray); }
  y -= 62;

  // ═══ LINE ITEMS TABLE ═══
  // Header
  page.drawRectangle({ x: mL, y: y - 15, width: cW, height: 17, color: green });
  const hCols = [
    { l: '#', x: mL + 3, w: 18 },
    { l: 'Description', x: mL + 22, w: 150 },
    { l: 'Qty', x: mL + 175, w: 42 },
    { l: 'Unit', x: mL + 220, w: 30 },
    { l: 'Rate (Rs.)', x: mL + 252, w: 65 },
    { l: 'Amount (Rs.)', x: mL + 320, w: 80 },
    { l: 'GST', x: mL + 405, w: 100 },
  ];
  hCols.forEach(c => text(c.l, c.x, y - 11, 7.5, fontBold, white));
  y -= 19;

  // Row
  page.drawRectangle({ x: mL, y: y - 15, width: cW, height: 17, color: rgb(0.97, 0.98, 0.97) });
  text('1', hCols[0].x, y - 11, 8);
  text(inv.productName, hCols[1].x, y - 11, 8);
  text(inv.quantity.toFixed(2), hCols[2].x, y - 11, 8);
  text(inv.unit, hCols[3].x, y - 11, 8);
  text(formatINR(inv.rate), hCols[4].x, y - 11, 7.5);
  text(formatINR(inv.amount), hCols[5].x, y - 11, 7.5);
  const gstHalf = inv.gstPercent / 2;
  text(`${inv.gstPercent}% (CGST ${gstHalf}% + SGST ${gstHalf}%)`, hCols[6].x, y - 11, 6.5);
  y -= 19;
  line(y, 0.5, green);
  y -= 12;

  // ═══ TOTALS — right aligned ═══
  const labX = mL + 300;
  const valX = mL + 410;
  text('Taxable Amount:', labX, y, 8, font, gray); text(formatINR(inv.amount), valX, y, 8, fontBold); y -= 12;

  // CGST + SGST split
  text(`CGST (${gstHalf}%):`, labX, y, 8, font, gray);
  text(formatINR(inv.gstAmount / 2), valX, y, 8); y -= 11;
  text(`SGST (${gstHalf}%):`, labX, y, 8, font, gray);
  text(formatINR(inv.gstAmount / 2), valX, y, 8); y -= 11;

  if (inv.freightCharge) {
    text('Freight:', labX, y, 8, font, gray); text(formatINR(inv.freightCharge), valX, y, 8); y -= 11;
  }
  y -= 2;
  page.drawLine({ start: { x: labX, y }, end: { x: mR, y }, thickness: 1.5, color: green });
  y -= 14;
  text('TOTAL:', labX, y, 11, fontBold, green);
  text(formatINR(inv.totalAmount), valX, y, 11, fontBold, green);
  y -= 16;

  // Amount in words
  text('Amount in Words:', mL, y, 7, fontItalicH, lightGray);
  y -= 11;
  text(numberToWords(inv.totalAmount), mL, y, 8, fontBold);
  y -= 18;

  // ═══ BANK DETAILS ═══
  line(y, 0.3);
  y -= 12;
  const invTmpl = await getTemplate('INVOICE');
  text('Bank Details:', mL, y, 7.5, fontBold, gray);
  y -= 10;
  const bankInfo = invTmpl.bankDetails || 'Bank: State Bank of India | A/c: 30613498188 | Branch: Narsinghpur | IFSC: SBIN0000636';
  text(bankInfo, mL, y, 6.5, font, lightGray);
  y -= 14;

  // ═══ TERMS ═══
  if (invTmpl.terms.length > 0) {
    text('Terms & Conditions:', mL, y, 7.5, fontBold, gray);
    y -= 10;
    invTmpl.terms.forEach((t, i) => {
      text(`${i + 1}. ${t}`, mL + 4, y, 6, font, lightGray);
      y -= 8;
    });
  }

  // ═══ SIGNATURES ═══
  y = 70;
  line(y + 20, 0.3);
  text('_____________________', mL, y, 8, font, rgb(0.7, 0.7, 0.7));
  text('For MSPIL', mL, y - 10, 7, fontBold, gray);
  text('_____________________', mR - 130, y, 8, font, rgb(0.7, 0.7, 0.7));
  text('Authorized Signatory', mR - 130, y - 10, 7, fontBold, gray);

  // Footer
  const footerText = invTmpl.footer || 'This is a computer-generated invoice from MSPIL ERP.';
  page.drawRectangle({ x: mL, y: 22, width: cW, height: 1, color: green });
  const ftW = font.widthOfTextAtSize(footerText, 6);
  text(footerText, mL + (cW - ftW) / 2, 12, 6, font, lightGray);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
