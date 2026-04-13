/**
 * Fetch company data for PDF generation.
 * Returns data shaped for both:
 *  - drawLetterhead(doc, mL, cW, companyInfo) — PDFKit letterhead
 *  - HBS template {{ company.name }}, {{ company.gstin }} etc.
 *
 * Returns undefined if companyId is null/MSPIL → callers use existing MSPIL defaults.
 */
import prisma from '../config/prisma';
import { LetterheadCompany } from './letterhead';

const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';

export interface PdfCompanyData extends LetterheadCompany {
  /** Full registered address line */
  fullAddress: string;
  /** For HBS templates */
  isSister: boolean;
}

/**
 * Get company data for PDF rendering.
 * @returns undefined if MSPIL (use hardcoded defaults) or PdfCompanyData for sister companies.
 */
export async function getCompanyForPdf(companyId?: string | null): Promise<PdfCompanyData | undefined> {
  if (!companyId || companyId === MSPIL_ID) return undefined;

  const co = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true, shortName: true, gstin: true, pan: true,
      address: true, city: true, state: true, pincode: true, email: true,
    },
  });

  if (!co) return undefined;
  // If it's actually MSPIL by shortName, return undefined (use defaults)
  if (co.shortName === 'MSPIL') return undefined;

  const fullAddress = [co.address, co.city, co.state, co.pincode].filter(Boolean).join(', ');

  return {
    name: co.name,
    shortName: co.shortName,
    gstin: co.gstin,
    pan: co.pan,
    address: co.address,
    city: co.city,
    state: co.state,
    pincode: co.pincode,
    email: co.email,
    fullAddress,
    isSister: true,
  };
}
