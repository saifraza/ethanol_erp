import prisma from '../config/prisma';
import bwipjs from 'bwip-js';

// Default terms for each doc type (fallback if not in DB)
const DEFAULTS: Record<string, { terms: string[]; footer: string; bankDetails?: string }> = {
  PURCHASE_ORDER: {
    terms: [
      'All goods must conform to the specifications mentioned above.',
      'Delivery must be made on or before the delivery date mentioned.',
      'GST invoice must be provided along with delivery challan.',
      'Payment will be made as per the payment terms mentioned above.',
      'Quality inspection will be done at the time of receipt.',
    ],
    footer: 'This is a computer-generated document.',
  },
  CHALLAN: {
    terms: [
      'Goods are delivered as per the sale order terms.',
      'Any damage during transit is the responsibility of the transporter.',
      'Receiver must verify quantity and quality at the time of delivery.',
      'This challan must be signed and returned as proof of delivery.',
    ],
    footer: 'This is a system-generated delivery challan from MSPIL ERP.',
  },
  INVOICE: {
    terms: [
      'Payment is due as per the agreed terms.',
      'Interest @ 18% p.a. will be charged on delayed payments.',
      'Subject to Narsinghpur (M.P.) jurisdiction.',
    ],
    footer: 'This is a computer-generated invoice.',
    bankDetails: 'Bank: State Bank of India  |  A/c: 30613498188  |  Branch: Narsinghpur  |  IFSC: SBIN0000636',
  },
  RATE_REQUEST: {
    terms: [
      'Vehicle in good condition with valid fitness certificate.',
      'GR (Bilty) to be provided at loading point.',
      '50% advance after bill submission, balance after delivery confirmation.',
      'Insurance of goods by purchaser.',
      'Loading & unloading charges borne by transporter.',
    ],
    footer: 'MSPIL, Narsinghpur',
  },
  SALE_ORDER: {
    terms: [
      'Delivery as per schedule mentioned in the order.',
      'GST as applicable will be charged extra.',
      'Payment terms as mentioned above.',
      'Force majeure conditions apply.',
    ],
    footer: 'This is a computer-generated sale order.',
  },
};

export interface TemplateData {
  terms: string[];
  footer: string;
  bankDetails?: string;
  title?: string;
}

export async function getTemplate(docType: string): Promise<TemplateData> {
  try {
    const saved = await prisma.documentTemplate.findUnique({ where: { docType } });
    const defaults = DEFAULTS[docType] || { terms: [], footer: '' };

    if (saved) {
      return {
        terms: saved.terms ? JSON.parse(saved.terms) : defaults.terms,
        footer: saved.footer || defaults.footer,
        bankDetails: saved.bankDetails || defaults.bankDetails,
        title: saved.title || undefined,
      };
    }
    return defaults;
  } catch {
    return DEFAULTS[docType] || { terms: [], footer: '' };
  }
}

// Generate barcode as PNG buffer
export async function generateBarcode(text: string, opts?: { width?: number; height?: number }): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 3,
    width: opts?.width || 40,
    height: opts?.height || 8,
    includetext: true,
    textxalign: 'center',
    textsize: 8,
  });
}
