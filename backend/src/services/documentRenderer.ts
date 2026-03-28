import { renderTemplate, generateQRCode } from './templateEngine';
import { renderPdf } from './pdfRenderer';
import { getTemplate } from '../utils/templateHelper';
import { SAMPLE_DATA, DOC_TYPE_TO_TEMPLATE } from '../templates/sampleData';

const BASE_URL = process.env.BASE_URL || 'https://app.mspil.in';

interface RenderOptions {
  docType: string;
  templateName?: string;
  data: Record<string, unknown>;
  verifyId?: string;
  templateOverrides?: { terms?: string[]; footer?: string; bankDetails?: string };
}

/**
 * Render a document as HTML string
 */
export async function renderDocumentHtml(opts: RenderOptions): Promise<string> {
  const { docType, data, verifyId, templateOverrides } = opts;
  const templateName = opts.templateName || DOC_TYPE_TO_TEMPLATE[docType] || docType.toLowerCase();

  // Get template terms/footer from DB (or use overrides for preview)
  const tmpl = templateOverrides || await getTemplate(docType);

  // Generate QR code if we have a verify ID
  let qrDataUrl: string | undefined;
  if (verifyId) {
    const verifyUrl = `${BASE_URL}/verify/${docType}/${verifyId}`;
    qrDataUrl = await generateQRCode(verifyUrl);
  }

  const fullData = {
    ...data,
    terms: tmpl.terms || [],
    footer: tmpl.footer || '',
    bankDetails: tmpl.bankDetails || '',
    qrDataUrl,
  };

  return renderTemplate(templateName, fullData);
}

/**
 * Render a document as PDF buffer
 */
export async function renderDocumentPdf(opts: RenderOptions): Promise<Buffer> {
  const html = await renderDocumentHtml(opts);
  return renderPdf(html);
}

/**
 * Render a preview with sample data (for template editing page)
 */
export async function renderPreviewHtml(
  docType: string,
  templateOverrides?: { terms?: string[]; footer?: string; bankDetails?: string }
): Promise<string> {
  const sampleData = SAMPLE_DATA[docType];
  if (!sampleData) {
    throw new Error(`No sample data for document type: ${docType}`);
  }

  return renderDocumentHtml({
    docType,
    data: sampleData,
    verifyId: 'SAMPLE-PREVIEW',
    templateOverrides,
  });
}

/**
 * Render a preview as PDF with sample data
 */
export async function renderPreviewPdf(
  docType: string,
  templateOverrides?: { terms?: string[]; footer?: string; bankDetails?: string }
): Promise<Buffer> {
  const html = await renderPreviewHtml(docType, templateOverrides);
  return renderPdf(html);
}

export { DOC_TYPE_TO_TEMPLATE, SAMPLE_DATA };
