import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { getTemplate, generateBarcode } from './templateHelper';

const LETTERHEAD_PATH = path.join(__dirname, '../../assets/MSPIL_Letterhead_Template.pdf');

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
  let pdfDoc: PDFDocument;

  // Try to use letterhead as base
  if (fs.existsSync(LETTERHEAD_PATH)) {
    const letterheadBytes = fs.readFileSync(LETTERHEAD_PATH);
    const letterheadPdf = await PDFDocument.load(letterheadBytes);
    pdfDoc = await PDFDocument.create();
    const [letterheadPage] = await pdfDoc.copyPages(letterheadPdf, [0]);
    pdfDoc.addPage(letterheadPage);
  } else {
    pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595.28, 841.89]); // A4
  }

  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // White-out the template's "Date:" and "[Your letter content goes here]" text
  page.drawRectangle({ x: 0, y: height - 240, width: width, height: 110, color: rgb(1, 1, 1) });

  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const darkBlue = rgb(0.29, 0.49, 0.25); // MSPIL green
  const headerBg = rgb(0.85, 0.9, 0.95);

  let y = height - 148; // Start just below letterhead
  const marginL = 40;
  const marginR = width - 40;
  const contentW = marginR - marginL;

  // Helper functions
  const drawText = (text: string, x: number, yPos: number, size: number, f = font, color = black) => {
    page.drawText(text, { x, y: yPos, size, font: f, color });
  };

  const drawLine = (y: number, thickness = 0.5) => {
    page.drawLine({ start: { x: marginL, y }, end: { x: marginR, y }, thickness, color: gray });
  };

  // ── Title ──
  drawText('PURCHASE ORDER', width / 2 - 70, y, 16, fontBold, darkBlue);
  y -= 22;
  drawLine(y, 1);
  y -= 12;

  // ── PO Details Row ──
  drawText('PO No:', marginL, y, 9, fontBold);
  drawText(`PO-${po.poNo}`, marginL + 45, y, 9);
  drawText('Date:', width / 2, y, 9, fontBold);
  drawText(formatDate(po.poDate), width / 2 + 35, y, 9);
  y -= 14;
  drawText('Delivery Date:', marginL, y, 9, fontBold);
  drawText(formatDate(po.deliveryDate), marginL + 80, y, 9);
  drawText('Supply:', width / 2, y, 9, fontBold);
  drawText(po.supplyType.replace('_', ' '), width / 2 + 42, y, 9);
  y -= 20;

  // ── Vendor Box ──
  page.drawRectangle({ x: marginL, y: y - 70, width: contentW / 2 - 10, height: 75, borderColor: gray, borderWidth: 0.5, color: rgb(0.97, 0.97, 0.97) });
  drawText('VENDOR', marginL + 5, y, 8, fontBold, gray);
  y -= 12;
  drawText(po.vendor.name, marginL + 5, y, 10, fontBold);
  y -= 12;
  if (po.vendor.tradeName) { drawText(po.vendor.tradeName, marginL + 5, y, 8); y -= 11; }
  if (po.vendor.address) { drawText(po.vendor.address, marginL + 5, y, 8); y -= 11; }
  const cityLine = [po.vendor.city, po.vendor.state, po.vendor.pincode].filter(Boolean).join(', ');
  if (cityLine) { drawText(cityLine, marginL + 5, y, 8); y -= 11; }
  if (po.vendor.gstin) { drawText(`GSTIN: ${po.vendor.gstin}`, marginL + 5, y, 8); y -= 11; }

  // Delivery address box
  const boxRight = marginL + contentW / 2 + 10;
  const delY = y + (po.vendor.gstin ? 11 : 0) + (cityLine ? 11 : 0) + (po.vendor.address ? 11 : 0) + (po.vendor.tradeName ? 11 : 0) + 12 + 12;
  page.drawRectangle({ x: boxRight, y: delY - 75, width: contentW / 2 - 10, height: 75, borderColor: gray, borderWidth: 0.5, color: rgb(0.97, 0.97, 0.97) });
  drawText('DELIVERY TO', boxRight + 5, delY - 5, 8, fontBold, gray);
  drawText(po.deliveryAddress || COMPANY.factory, boxRight + 5, delY - 17, 8);
  if (po.paymentTerms) drawText(`Payment: ${po.paymentTerms}`, boxRight + 5, delY - 29, 8);
  if (po.transportMode) drawText(`Transport: ${po.transportMode}`, boxRight + 5, delY - 41, 8);

  y -= 25;

  // ── Line Items Table ──
  const cols = [
    { label: '#', x: marginL, w: 18 },
    { label: 'Description', x: marginL + 18, w: 135 },
    { label: 'HSN', x: marginL + 153, w: 45 },
    { label: 'Qty', x: marginL + 198, w: 38 },
    { label: 'Unit', x: marginL + 236, w: 32 },
    { label: 'Rate', x: marginL + 268, w: 50 },
    { label: 'GST%', x: marginL + 318, w: 30 },
    { label: 'Taxable', x: marginL + 348, w: 65 },
    { label: 'Total', x: marginL + 413, w: 67 },
  ];

  // Table header
  page.drawRectangle({ x: marginL, y: y - 14, width: contentW, height: 16, color: darkBlue });
  cols.forEach(col => {
    drawText(col.label, col.x + 2, y - 11, 7, fontBold, rgb(1, 1, 1));
  });
  y -= 16;

  // Table rows
  po.lines.forEach((line, idx) => {
    const rowY = y - 14;
    if (idx % 2 === 0) {
      page.drawRectangle({ x: marginL, y: rowY, width: contentW, height: 15, color: rgb(0.96, 0.96, 0.96) });
    }
    drawText(`${idx + 1}`, cols[0].x + 2, y - 11, 7);
    // Truncate description if too long
    const desc = line.description.length > 30 ? line.description.substring(0, 28) + '..' : line.description;
    drawText(desc, cols[1].x + 2, y - 11, 7);
    drawText(line.hsnCode, cols[2].x + 2, y - 11, 7);
    drawText(line.quantity.toString(), cols[3].x + 2, y - 11, 7);
    drawText(line.unit, cols[4].x + 2, y - 11, 7);
    drawText(formatINR(line.rate).replace('₹', ''), cols[5].x + 2, y - 11, 7);
    drawText(`${line.gstPercent}%`, cols[6].x + 2, y - 11, 7);
    drawText(formatINR(line.taxableAmount).replace('₹', ''), cols[7].x + 2, y - 11, 7);
    drawText(formatINR(line.lineTotal).replace('₹', ''), cols[8].x + 2, y - 11, 7);
    y -= 15;
  });

  drawLine(y, 0.5);
  y -= 15;

  // ── Totals ──
  const totalsX = marginL + 380;
  const labelsX = marginL + 280;

  drawText('Subtotal:', labelsX, y, 9, fontBold);
  drawText(formatINR(po.subtotal), totalsX, y, 9);
  y -= 14;
  drawText('GST:', labelsX, y, 9, fontBold);
  drawText(formatINR(po.totalGst), totalsX, y, 9);
  y -= 14;
  if (po.freightCharge) {
    drawText('Freight:', labelsX, y, 9, fontBold);
    drawText(formatINR(po.freightCharge), totalsX, y, 9);
    y -= 14;
  }
  if (po.otherCharges) {
    drawText('Other Charges:', labelsX, y, 9, fontBold);
    drawText(formatINR(po.otherCharges), totalsX, y, 9);
    y -= 14;
  }
  if (po.roundOff) {
    drawText('Round Off:', labelsX, y, 9, fontBold);
    drawText(formatINR(po.roundOff), totalsX, y, 9);
    y -= 14;
  }
  drawLine(y + 2, 1);
  y -= 4;
  drawText('GRAND TOTAL:', labelsX, y, 11, fontBold, darkBlue);
  drawText(formatINR(po.grandTotal), totalsX, y, 11, fontBold, darkBlue);
  y -= 18;

  // Amount in words
  drawText('Amount in Words:', marginL, y, 8, fontBold, gray);
  y -= 12;
  drawText(numberToWords(po.grandTotal), marginL, y, 8, fontBold);
  y -= 20;

  // ── Remarks ──
  if (po.remarks) {
    drawText('Remarks:', marginL, y, 8, fontBold, gray);
    y -= 12;
    drawText(po.remarks, marginL, y, 8);
    y -= 20;
  }

  // ── Terms & Conditions (from template) ──
  const tmpl = await getTemplate('PURCHASE_ORDER');
  drawLine(y, 0.5);
  y -= 15;
  drawText('Terms & Conditions:', marginL, y, 8, fontBold);
  y -= 12;
  tmpl.terms.forEach((t, i) => {
    drawText(`${i + 1}. ${t}`, marginL, y, 7);
    y -= 11;
  });

  y -= 15;

  // ── Barcode ──
  try {
    const barcodeImg = await generateBarcode(`PO-${po.poNo}`);
    const bcImage = await pdfDoc.embedPng(barcodeImg);
    page.drawImage(bcImage, { x: marginR - 140, y: y - 5, width: 130, height: 25 });
  } catch { /* barcode failed */ }

  y -= 15;

  // ── Signatures ──
  drawText('Prepared By', marginL, y, 8, fontBold);
  drawText('Approved By', width / 2 - 30, y, 8, fontBold);
  drawText('Authorized Signatory', marginR - 120, y, 8, fontBold);
  y -= 30;
  drawLine(y, 0.3);

  // ── Footer ──
  drawText(tmpl.footer, width / 2 - 80, 25, 7, font, gray);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
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
  let pdfDoc: PDFDocument;

  if (fs.existsSync(LETTERHEAD_PATH)) {
    const letterheadBytes = fs.readFileSync(LETTERHEAD_PATH);
    const letterheadPdf = await PDFDocument.load(letterheadBytes);
    pdfDoc = await PDFDocument.create();
    const [letterheadPage] = await pdfDoc.copyPages(letterheadPdf, [0]);
    pdfDoc.addPage(letterheadPage);
  } else {
    pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595.28, 841.89]);
  }

  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // White-out "Date: ___" and "[Your letter content goes here]" from template
  // Template: letterhead box ends at ~y=700, Date at ~y=660, placeholder at ~y=628
  page.drawRectangle({ x: 0, y: height - 220, width: width, height: 82, color: rgb(1, 1, 1) });

  const black = rgb(0, 0, 0);
  const gray = rgb(0.35, 0.35, 0.35);
  const lightGray = rgb(0.55, 0.55, 0.55);
  const green = rgb(0.29, 0.49, 0.25); // MSPIL green #4a7c3f
  const white = rgb(1, 1, 1);

  const mL = 45;            // left margin
  const mR = width - 45;    // right margin
  const cW = mR - mL;       // content width
  let y = height - 148;     // start below letterhead (measured from template)

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
  text('Amount in Words:', mL, y, 7, fontItalic, lightGray);
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
