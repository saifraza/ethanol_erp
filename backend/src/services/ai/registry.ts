/**
 * AI Feature Registry — single catalog of every AI-touched feature in the ERP.
 *
 * To add a new feature:
 *   1. Create a new file under tools/ exporting an AIFeature object
 *   2. Import + add it to AI_FEATURES below
 *   3. It auto-appears in /admin/ai-features and is callable by the chat
 */
import type { AIFeature, AIFeatureKind } from './types';

import { getFuelInflow } from './tools/getFuelInflow';
import { getEthanolProduction } from './tools/getEthanolProduction';
import { searchInvoices } from './tools/searchInvoices';
import { getOutstandingPayables } from './tools/getOutstandingPayables';
import { getAccountBalance } from './tools/getAccountBalance';
import { getTruckArrivals } from './tools/getTruckArrivals';
import { getEthanolDispatches } from './tools/getEthanolDispatches';
import { getGRNs } from './tools/getGRNs';
import { listTables } from './tools/listTables';
import { describeTable } from './tools/describeTable';
import { queryTable } from './tools/queryTable';

// Document features that already exist as their own routes — registered here
// for visibility/admin even though they are invoked via their own endpoints,
// not through the chat tool runner.
const documentClassifierFeature: AIFeature = {
  id: 'doc.classifier.smart_upload',
  kind: 'DOC_CLASSIFIER',
  module: 'documents',
  title: 'Smart Upload (Universal Doc Classifier)',
  description: 'Drop any document — vendor invoice, GRN, PO, bank receipt, contractor bill — and AI classifies it then routes to the right place. Vendor invoices are auto-extracted and matched to existing invoices.',
  examplePrompt: 'Upload an invoice PDF on the Payments Out page',
  preferredProvider: 'gemini',
  async execute() { throw new Error('Invoke via POST /api/document-classifier/classify'); },
};

const vendorInvoiceExtractFeature: AIFeature = {
  id: 'doc.extract.vendor_invoice',
  kind: 'DOC_EXTRACTOR',
  module: 'procurement',
  title: 'Vendor Invoice Extractor',
  description: 'Manual upload of a vendor invoice on the Add Invoice modal — extracts invoice number, date, line items, GST, totals to pre-fill the form.',
  preferredProvider: 'gemini',
  async execute() { throw new Error('Invoke via POST /api/vendor-invoices/upload-extract'); },
};

const bankReceiptScanFeature: AIFeature = {
  id: 'doc.extract.bank_receipt',
  kind: 'DOC_EXTRACTOR',
  module: 'accounts',
  title: 'Bank Receipt Scanner',
  description: 'Scan a payment confirmation receipt (bank PDF/image) — extracts UTR, amount, beneficiary, timestamp.',
  preferredProvider: 'gemini',
  async execute() { throw new Error('Invoke via POST /api/vendor-payments/:id/scan-bank-receipt'); },
};

const grnExtractFeature: AIFeature = {
  id: 'doc.extract.grn_documents',
  kind: 'DOC_EXTRACTOR',
  module: 'procurement',
  title: 'GRN Document Extractor',
  description: 'Extract weight, quantity, vehicle details from goods-receipt photos or scanned challans.',
  preferredProvider: 'gemini',
  async execute() { throw new Error('Invoke via POST /api/goods-receipts/:id/extract-document'); },
};

const bankPaymentVerifyFeature: AIFeature = {
  id: 'doc.verify.bank_payment',
  kind: 'DOC_VERIFIER',
  module: 'accounts',
  title: 'Bank Payment Verification',
  description: 'Cross-check a bank statement / receipt against a recorded vendor payment — flags amount or beneficiary mismatch.',
  preferredProvider: 'gemini',
  async execute() { throw new Error('Invoke via POST /api/bank-payments/verify'); },
};

export const AI_FEATURES: AIFeature[] = [
  // Specific chat tools — pick these FIRST when they fit
  getTruckArrivals,
  getEthanolDispatches,
  getGRNs,
  getFuelInflow,
  getEthanolProduction,
  searchInvoices,
  getOutstandingPayables,
  getAccountBalance,

  // Generic introspection + READ-ONLY query — fallback for anything specific tools don't cover
  listTables,
  describeTable,
  queryTable,

  // Document AI features — registered for catalog visibility
  documentClassifierFeature,
  vendorInvoiceExtractFeature,
  bankReceiptScanFeature,
  grnExtractFeature,
  bankPaymentVerifyFeature,
];

export function getChatTools(): AIFeature[] {
  return AI_FEATURES.filter(f => f.kind === 'CHAT_TOOL');
}

export function getFeatureById(id: string): AIFeature | undefined {
  return AI_FEATURES.find(f => f.id === id);
}

export function getFeaturesByKind(kind: AIFeatureKind): AIFeature[] {
  return AI_FEATURES.filter(f => f.kind === kind);
}
