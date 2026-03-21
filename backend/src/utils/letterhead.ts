/**
 * Shared HD letterhead renderer for all PDFKit-based PDF generators.
 * Uses the MSPIL logo PNG + vector text for resolution-independent output.
 */
import * as fs from 'fs';
import * as path from 'path';

const LOGO_PATH = path.resolve(__dirname, '../../assets/MSPIL_logo_transparent.png');
const hasLogo = fs.existsSync(LOGO_PATH);

/**
 * Draw the MSPIL letterhead at the top of a PDFKit page.
 * Matches the official Word template exactly.
 *
 * @param doc  - PDFKit document instance
 * @param mL   - left margin (x start)
 * @param cW   - content width
 * @returns y position below the letterhead (where content should start)
 */
export function drawLetterhead(doc: PDFKit.PDFDocument, mL: number, cW: number): number {
  const bannerH = 90;
  const bannerY = 18;

  // ── Green gradient background ──
  const grad = (doc as any).linearGradient(mL, bannerY, mL, bannerY + bannerH);
  grad.stop(0, '#b8cc3c').stop(0.4, '#a8bc2c').stop(1, '#98ac1c');
  doc.save();
  doc.roundedRect(mL, bannerY, cW, bannerH, 3).fill(grad);
  doc.restore();

  // ── Logo ──
  const logoSize = 72;
  const logoX = mL + 10;
  const logoY = bannerY + (bannerH - logoSize) / 2;
  if (hasLogo) {
    doc.image(LOGO_PATH, logoX, logoY, { width: logoSize, height: logoSize });
  }

  // ── Text area (right of logo) ──
  const textX = logoX + logoSize + 12;
  const textW = cW - (logoSize + 32);
  let ty = bannerY + 6;

  // Company name — large bold italic
  doc.font('Times-BoldItalic').fontSize(16).fillColor('#1a3a1a');
  doc.text('Mahakaushal Sugar and Power Industries Ltd.', textX, ty, { width: textW, align: 'center' });
  ty += 20;

  // CIN & GSTIN
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#333');
  doc.text('CIN - U01543MP2005PLC017514,  GSTIN - 23AAECM3666P1Z1', textX, ty, { width: textW, align: 'center' });
  ty += 10;

  // Regd off (single line, no continued)
  doc.font('Helvetica').fontSize(6.5).fillColor('#444');
  doc.text('Regd off : SF-11, Second Floor, Aakriti Business Center, Aakriti Eco city,', textX, ty, { width: textW, align: 'center' });
  ty += 8;
  doc.text('Bawadiya Kalan, Bhopal-462039', textX, ty, { width: textW, align: 'center' });
  ty += 9;

  // Admin off & Factory
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#333');
  doc.text('Admin off & Factory : Village Bachai, Dist. Narsinghpur (M.P.) - 487001', textX, ty, { width: textW, align: 'center' });
  ty += 10;

  // Email
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#2e7d32');
  doc.text('E-mail : mspil.acc@gmail.com | mspil.power@gmail.com', textX, ty, { width: textW, align: 'center' });

  // ── Thin green line below banner ──
  doc.moveTo(mL, bannerY + bannerH + 2)
     .lineTo(mL + cW, bannerY + bannerH + 2)
     .strokeColor('#7a9a1a')
     .lineWidth(0.5)
     .stroke();

  // Reset font
  doc.font('Helvetica').fontSize(9).fillColor('#000');

  return bannerY + bannerH + 8;
}
