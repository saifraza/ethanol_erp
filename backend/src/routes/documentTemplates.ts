import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { renderPreviewHtml, renderPreviewPdf } from '../services/documentRenderer';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate);

// Default terms for each document type
const DEFAULTS: Record<string, { title: string; terms: string[]; footer: string; bankDetails?: string }> = {
  PURCHASE_ORDER: {
    title: 'PURCHASE ORDER',
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
    title: 'DELIVERY CHALLAN',
    terms: [
      'Goods are delivered as per the sale order terms.',
      'Any damage during transit is the responsibility of the transporter.',
      'Receiver must verify quantity and quality at the time of delivery.',
      'This challan must be signed and returned as proof of delivery.',
    ],
    footer: 'This is a system-generated delivery challan from MSPIL ERP.',
  },
  INVOICE: {
    title: 'TAX INVOICE',
    terms: [
      'Payment is due as per the agreed terms.',
      'Interest @ 18% p.a. will be charged on delayed payments.',
      'Subject to Narsinghpur (M.P.) jurisdiction.',
    ],
    footer: 'This is a computer-generated invoice.',
    bankDetails: 'Bank: [Company Bank Name]  |  A/c: [Account Number]  |  IFSC: [IFSC Code]',
  },
  RATE_REQUEST: {
    title: 'FREIGHT RATE REQUEST',
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
    title: 'SALE ORDER',
    terms: [
      'Delivery as per schedule mentioned in the order.',
      'GST as applicable will be charged extra.',
      'Payment terms as mentioned above.',
      'Force majeure conditions apply.',
    ],
    footer: 'This is a computer-generated sale order.',
  },
};

// GET / — List all templates (with defaults merged)
router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const saved = await prisma.documentTemplate.findMany({ take: 500 });
  const savedMap = new Map(saved.map(t => [t.docType, t]));

  const templates = Object.entries(DEFAULTS).map(([docType, defaults]) => {
    const existing = savedMap.get(docType);
    if (existing) {
      return {
        ...existing,
        terms: existing.terms ? JSON.parse(existing.terms) : defaults.terms,
        companyInfo: existing.companyInfo ? JSON.parse(existing.companyInfo) : null,
      };
    }
    return {
      id: null,
      docType,
      title: defaults.title,
      terms: defaults.terms,
      footer: defaults.footer,
      bankDetails: defaults.bankDetails || null,
      companyInfo: null,
      remarks: null,
    };
  });

  res.json({ templates });
}));

// GET /:docType — Get single template
router.get('/:docType', asyncHandler(async (req: AuthRequest, res: Response) => {
  const docType = req.params.docType.toUpperCase();
  const existing = await prisma.documentTemplate.findUnique({ where: { docType } });
  const defaults = DEFAULTS[docType];

  if (existing) {
    res.json({
      ...existing,
      terms: existing.terms ? JSON.parse(existing.terms) : defaults?.terms || [],
      companyInfo: existing.companyInfo ? JSON.parse(existing.companyInfo) : null,
    });
  } else if (defaults) {
    res.json({
      id: null, docType,
      title: defaults.title,
      terms: defaults.terms,
      footer: defaults.footer,
      bankDetails: defaults.bankDetails || null,
      companyInfo: null,
      remarks: null,
    });
  } else {
    res.status(404).json({ error: 'Template not found' });
  }
}));

// PUT /:docType — Create or update template
router.put('/:docType', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const docType = req.params.docType.toUpperCase();
  const { title, terms, footer, bankDetails, companyInfo, remarks } = req.body;

  const data = {
    docType,
    title: title || null,
    terms: Array.isArray(terms) ? JSON.stringify(terms) : null,
    footer: footer || null,
    bankDetails: bankDetails || null,
    companyInfo: companyInfo ? JSON.stringify(companyInfo) : null,
    remarks: remarks || null,
  };

  const template = await prisma.documentTemplate.upsert({
    where: { docType },
    create: data,
    update: data,
  });

  res.json({
    ...template,
    terms: template.terms ? JSON.parse(template.terms) : [],
    companyInfo: template.companyInfo ? JSON.parse(template.companyInfo) : null,
  });
}));

// ── Preview Endpoints ──

// GET /:docType/preview — Preview with saved template data
router.get('/:docType/preview', asyncHandler(async (req: AuthRequest, res: Response) => {
  const docType = req.params.docType.toUpperCase();
  const html = await renderPreviewHtml(docType);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}));

// POST /:docType/preview — Preview with unsaved/custom template data
router.post('/:docType/preview', asyncHandler(async (req: AuthRequest, res: Response) => {
  const docType = req.params.docType.toUpperCase();
  const { terms, footer, bankDetails } = req.body;
  const overrides = {
    terms: Array.isArray(terms) ? terms : undefined,
    footer: footer || undefined,
    bankDetails: bankDetails || undefined,
  };
  const html = await renderPreviewHtml(docType, overrides);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}));

// GET /:docType/preview-pdf — Download sample PDF
router.get('/:docType/preview-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const docType = req.params.docType.toUpperCase();
  const pdfBuffer = await renderPreviewPdf(docType);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${docType.toLowerCase()}-preview.pdf"`);
  res.send(pdfBuffer);
}));

export default router;
