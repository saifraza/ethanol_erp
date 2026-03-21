/**
 * Shared HD letterhead renderer for all PDFKit-based PDF generators.
 * Uses the MSPIL logo PNG + vector text for resolution-independent output.
 */
import * as fs from 'fs';
import * as path from 'path';

const LOGO_PATH = path.resolve(__dirname, '../../assets/MSPIL_logo_transparent.png');
const hasLogo = fs.existsSync(LOGO_PATH);

const COMPANY = {
  name: 'Mahakaushal Sugar and Power Industries Ltd.',
  cin: 'U01543MP2005PLC017514',
  gstin: '23AAECM3666P1Z1',
  regdOff: 'SF-11, Second Floor, Aakriti Business Center, Aakriti Eco city,',
  regdOff2: 'Bawadiya Kalan, Bhopal-462039',
  factory: 'Village Bachai, Dist. Narsinghpur (M.P.) - 487001',
  email: 'mspil.acc@gmail.com | mspil.power@gmail.com',
};

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
  const pageW = mL + cW + mL;

  // ── Green gradient background ──
  // Main olive-green banner
  const grad = (doc as any).linearGradient(mL, bannerY, mL, bannerY + bannerH);
  grad.stop(0, '#b8cc3c')    // lighter olive-green top
      .stop(0.4, '#a8bc2c')  // mid
      .stop(1, '#98ac1c');    // darker bottom
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
  let ty = bannerY + 8;

  // Company name — large bold italic
  doc.font('Times-BoldItalic').fontSize(16).fillColor('#1a3a1a');
  doc.text(COMPANY.name, textX, ty, { width: textW, align: 'center' });
  ty += 20;

  // CIN & GSTIN
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#333');
  doc.text(`CIN - ${COMPANY.cin},  GSTIN - ${COMPANY.gstin}`, textX, ty, { width: textW, align: 'center' });
  ty += 10;

  // Regd off
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#333');
  doc.text('Regd off : ', textX, ty, { width: textW, align: 'center', continued: true });
  doc.font('Helvetica').text(`${COMPANY.regdOff}`, { continued: false });
  ty += 9;
  doc.font('Helvetica').fontSize(6.5).text(COMPANY.regdOff2, textX, ty, { width: textW, align: 'center' });
  ty += 9;

  // Admin off & Factory
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#333');
  doc.text('Admin off & Factory : ', textX, ty, { width: textW, align: 'center', continued: true });
  doc.font('Helvetica').text(COMPANY.factory, { continued: false });
  ty += 10;

  // Email
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#2e7d32');
  doc.text('E-mail : ', textX, ty, { width: textW, align: 'center', continued: true });
  doc.font('Helvetica').text(COMPANY.email, { continued: false });

  // ── Thin green line below banner ──
  doc.moveTo(mL, bannerY + bannerH + 2)
     .lineTo(mL + cW, bannerY + bannerH + 2)
     .strokeColor('#7a9a1a')
     .lineWidth(0.5)
     .stroke();

  // Reset font
  doc.font('Helvetica').fontSize(9).fillColor('#000');

  return bannerY + bannerH + 8; // y position for content to start
}
