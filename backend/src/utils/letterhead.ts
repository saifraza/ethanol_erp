/**
 * Shared professional letterhead renderer for all PDFKit-based PDF generators.
 * Matches the pdf-lib Tax Invoice letterhead style: centered text, clean olive band.
 *
 * Multi-company: pass optional `companyInfo` to swap company name/GSTIN/address.
 * No param = exact same MSPIL letterhead as before (backward compatible).
 */
import * as fs from 'fs';
import * as path from 'path';

const LOGO_PNG = path.resolve(__dirname, '../../assets/MSPIL_logo_transparent.png');
const hasLogo = fs.existsSync(LOGO_PNG);

/** Optional company data for sister company letterheads */
export interface LetterheadCompany {
  name: string;
  shortName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  email?: string | null;
}

/**
 * Draw letterhead at the top of a PDFKit page.
 * Same olive band, same layout, same logo for MSPIL.
 * Pass companyInfo to swap text for sister companies — everything else identical.
 *
 * @param doc  - PDFKit document instance
 * @param mL   - left margin (x start)
 * @param cW   - content width
 * @param companyInfo - optional company data. Omit = MSPIL default (zero change).
 * @returns y position below the letterhead (where content should start)
 */
export function drawLetterhead(doc: PDFKit.PDFDocument, mL: number, cW: number, companyInfo?: LetterheadCompany): number {
  const startY = 15;
  const rightEdge = mL + cW;

  // ── Olive/green background band ──
  const bandH = 100;
  doc.save();
  doc.rect(mL, startY, cW, bandH).fill('#c5d39e');
  doc.restore();

  // ── Logo (left side) ──
  const logoSize = 70;
  const logoX = mL + 15;
  const logoY = startY + 15;
  if (hasLogo) {
    doc.image(LOGO_PNG, logoX, logoY, { width: logoSize, height: logoSize });
  }

  // ── Text area: centered between logo and right edge ──
  const textX = logoX + logoSize + 10;
  const textW = rightEdge - textX - 5;
  let ty = startY + 8;

  // Resolve company details — MSPIL defaults if no companyInfo
  const isSister = companyInfo && companyInfo.shortName && companyInfo.shortName !== 'MSPIL';
  const coName = isSister ? companyInfo!.name : 'Mahakaushal Sugar and Power Industries Ltd.';
  const coGstin = isSister ? (companyInfo!.gstin || '') : '23AAECM3666P1Z1';
  const coPan = isSister ? (companyInfo!.pan || '') : 'AAECM3666P';
  const coIdLine = isSister
    ? [coPan && `PAN - ${coPan}`, coGstin && `GSTIN - ${coGstin}`].filter(Boolean).join(',  ')
    : 'CIN - U01543MP2005PLC017514,  GSTIN - 23AAECM3666P1Z1';

  // Company name — large bold
  doc.font('Helvetica-Bold').fontSize(17).fillColor('#1a3a1a');
  doc.text(coName, textX, ty, { width: textW, align: 'center', lineBreak: false });
  ty += 23;

  // CIN/PAN + GSTIN
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#2d4a2d');
  doc.text(coIdLine, textX, ty, { width: textW, align: 'center', lineBreak: false });
  ty += 12;

  if (isSister) {
    // Sister company: regd address from DB
    const addr = [companyInfo!.address, companyInfo!.city, companyInfo!.state, companyInfo!.pincode].filter(Boolean).join(', ');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#3a5a3a');
    doc.text(`Regd off : ${addr}`, textX, ty, { width: textW, align: 'center', lineBreak: false });
    ty += 10;

    // Email (if provided)
    if (companyInfo!.email) {
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#4a7c3f');
      doc.text(`E-mail : ${companyInfo!.email}`, textX, ty, { width: textW, align: 'center', lineBreak: false });
      ty += 10;
    }

    // Factory address — same for all companies (single plant)
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#4a7c3f');
    doc.text('Factory : Village Bachai, Dist. Narsinghpur (M.P.) - 487001', textX, ty, { width: textW, align: 'center', lineBreak: false });
  } else {
    // MSPIL: exact original text, byte-for-byte
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#3a5a3a');
    doc.text('Regd off : SF-11, Second Floor, Aakriti Business Center, Aakriti Eco city,', textX, ty, { width: textW, align: 'center', lineBreak: false });
    ty += 9;
    doc.font('Helvetica').text('Bawadiya Kalan, Bhopal-462039', textX, ty, { width: textW, align: 'center', lineBreak: false });
    ty += 10;

    doc.font('Helvetica-Bold').fontSize(7).fillColor('#4a7c3f');
    doc.text('Admin off & Factory : Village Bachai, Dist. Narsinghpur (M.P.) - 487001', textX, ty, { width: textW, align: 'center', lineBreak: false });
    ty += 10;

    doc.font('Helvetica-Bold').fontSize(7).fillColor('#4a7c3f');
    doc.text('E-mail : mspil.acc@gmail.com | mspil.power@gmail.com', textX, ty, { width: textW, align: 'center', lineBreak: false });
  }

  // ── Bottom border lines ──
  const lineY = startY + bandH + 3;
  doc.moveTo(mL, lineY).lineTo(rightEdge, lineY)
     .strokeColor('#4a7c3f').lineWidth(1.5).stroke();
  doc.moveTo(mL, lineY + 2.5).lineTo(rightEdge, lineY + 2.5)
     .strokeColor('#7a9a1a').lineWidth(0.5).stroke();

  // Reset font state
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  return lineY + 10;
}
