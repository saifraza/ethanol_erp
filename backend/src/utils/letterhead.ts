/**
 * Shared HD letterhead renderer for all PDFKit-based PDF generators.
 * Uses the high-res MSPIL_letterhead.png banner image for pixel-perfect output.
 */
import * as fs from 'fs';
import * as path from 'path';

const LETTERHEAD_PNG = path.resolve(__dirname, '../../assets/MSPIL_letterhead.png');
const hasLetterhead = fs.existsSync(LETTERHEAD_PNG);

/**
 * Draw the MSPIL letterhead at the top of a PDFKit page.
 * Uses the official letterhead banner image (2448×520 PNG).
 *
 * @param doc  - PDFKit document instance
 * @param mL   - left margin (x start)
 * @param cW   - content width
 * @returns y position below the letterhead (where content should start)
 */
export function drawLetterhead(doc: PDFKit.PDFDocument, mL: number, cW: number): number {
  const bannerY = 18;

  if (hasLetterhead) {
    // Image aspect ratio: 2448/520 ≈ 4.71, so height = cW / 4.71
    const bannerH = Math.round(cW / 4.71);
    doc.image(LETTERHEAD_PNG, mL, bannerY, { width: cW, height: bannerH });

    // Thin green line below banner
    const lineY = bannerY + bannerH + 2;
    doc.moveTo(mL, lineY).lineTo(mL + cW, lineY)
       .strokeColor('#7a9a1a').lineWidth(0.5).stroke();

    // Reset font
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    return lineY + 6;
  }

  // ── Fallback: plain text header ──
  let ty = bannerY;
  doc.font('Times-BoldItalic').fontSize(15).fillColor('#1a3a1a');
  doc.text('Mahakaushal Sugar and Power Industries Ltd.', mL, ty, { width: cW, align: 'center' });
  ty += 18;
  doc.font('Helvetica').fontSize(7).fillColor('#555');
  doc.text('CIN - U01543MP2005PLC017514, GSTIN - 23AAECM3666P1Z1', mL, ty, { width: cW, align: 'center' });
  ty += 9;
  doc.text('Village Bachai, Dist. Narsinghpur (M.P.) - 487001 | mspil.acc@gmail.com', mL, ty, { width: cW, align: 'center' });
  ty += 12;

  doc.moveTo(mL, ty).lineTo(mL + cW, ty).strokeColor('#7a9a1a').lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  return ty + 6;
}
