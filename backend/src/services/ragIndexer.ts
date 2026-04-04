/**
 * RAG Indexer — auto-index ERP records into RAG when they reach final status.
 *
 * Composes text summaries from DB data and sends to RAG via lightragInsertText().
 * Call indexRecord() after status changes (PO approved, invoice created, GRN confirmed, etc.)
 */

import prisma from '../config/prisma';
import { lightragInsertText, isRagEnabled } from './lightragClient';

interface IndexOpts {
  sourceType: string;
  sourceId: string;
}

/** Format currency in INR */
function fmtINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

/** Format date as DD-MMM-YYYY */
function fmtDate(d: Date | null | undefined): string {
  if (!d) return '--';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── PO indexer ──────────────────────────────────────────────
async function indexPurchaseOrder(id: string): Promise<string> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      vendor: { select: { name: true, gstin: true } },
      lines: { include: { material: { select: { name: true } } } },
    },
  });
  if (!po) return '';

  const lineItems = po.lines.map((l) =>
    `${l.material?.name || l.description} ${l.quantity} ${l.unit} @ ${fmtINR(l.rate)}`
  ).join('; ');

  return [
    `Purchase Order PO-${po.poNo}`,
    `Vendor: ${po.vendor?.name || 'Unknown'}${po.vendor?.gstin ? ` (${po.vendor.gstin})` : ''}`,
    `Date: ${fmtDate(po.poDate)}`,
    `Items: ${lineItems}`,
    `Total: ${fmtINR(po.grandTotal || 0)}`,
    `Status: ${po.status}`,
    po.remarks ? `Remarks: ${po.remarks}` : '',
  ].filter(Boolean).join(' | ');
}

// ── Invoice indexer ─────────────────────────────────────────
async function indexInvoice(id: string): Promise<string> {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { customer: { select: { name: true } } },
  });
  if (!inv) return '';

  return [
    `Sales Invoice ${inv.invoiceNo}`,
    `Customer: ${inv.customer?.name || 'Unknown'}`,
    `Date: ${fmtDate(inv.invoiceDate)}`,
    `Product: ${inv.productName || '--'}`,
    `Quantity: ${inv.quantity} ${inv.unit || ''}`,
    `Amount: ${fmtINR(inv.totalAmount || 0)}`,
    `Status: ${inv.status}`,
  ].filter(Boolean).join(' | ');
}

// ── Vendor Invoice indexer ──────────────────────────────────
async function indexVendorInvoice(id: string): Promise<string> {
  const vi = await prisma.vendorInvoice.findUnique({
    where: { id },
    include: { vendor: { select: { name: true } } },
  });
  if (!vi) return '';

  return [
    `Vendor Invoice ${vi.invoiceNo}`,
    `Vendor: ${vi.vendor?.name || 'Unknown'}`,
    `Date: ${fmtDate(vi.invoiceDate)}`,
    `Amount: ${fmtINR(vi.totalAmount || 0)}`,
    `Status: ${vi.status}`,
  ].filter(Boolean).join(' | ');
}

// ── GRN indexer ─────────────────────────────────────────────
async function indexGoodsReceipt(id: string): Promise<string> {
  const grn = await prisma.goodsReceipt.findUnique({
    where: { id },
    include: {
      vendor: { select: { name: true } },
      lines: { include: { material: { select: { name: true } } } },
    },
  });
  if (!grn) return '';

  const lineItems = grn.lines.map((l) =>
    `${l.material?.name || 'Unknown'} ${l.receivedQty} ${l.unit}`
  ).join('; ');

  return [
    `Goods Receipt GRN-${grn.grnNo}`,
    `Vendor: ${grn.vendor?.name || 'Unknown'}`,
    `Date: ${fmtDate(grn.grnDate)}`,
    `Items: ${lineItems}`,
    `Vehicle: ${grn.vehicleNo || '--'}`,
    `Status: ${grn.status}`,
  ].filter(Boolean).join(' | ');
}

// ── Sales Order indexer ─────────────────────────────────────
async function indexSalesOrder(id: string): Promise<string> {
  const so = await prisma.salesOrder.findUnique({
    where: { id },
    include: { customer: { select: { name: true } } },
  });
  if (!so) return '';

  return [
    `Sales Order SO-${so.orderNo}`,
    `Customer: ${so.customer?.name || 'Unknown'}`,
    `Date: ${fmtDate(so.orderDate)}`,
    `Amount: ${fmtINR(so.grandTotal || 0)}`,
    `Status: ${so.status}`,
    so.remarks ? `Remarks: ${so.remarks}` : '',
  ].filter(Boolean).join(' | ');
}

// ── Dispatcher ──────────────────────────────────────────────
const INDEXERS: Record<string, (id: string) => Promise<string>> = {
  PurchaseOrder: indexPurchaseOrder,
  Invoice: indexInvoice,
  VendorInvoice: indexVendorInvoice,
  GoodsReceipt: indexGoodsReceipt,
  SalesOrder: indexSalesOrder,
};

/**
 * Index an ERP record into RAG. Call this when a record reaches a final status.
 * Fire-and-forget — wraps in setImmediate, never throws.
 */
export function indexRecord(opts: IndexOpts): void {
  if (!isRagEnabled()) return;

  const indexer = INDEXERS[opts.sourceType];
  if (!indexer) return;

  setImmediate(async () => {
    try {
      const text = await indexer(opts.sourceId);
      if (text.length > 50) {
        await lightragInsertText(text, {
          sourceType: opts.sourceType,
          sourceId: opts.sourceId,
        });
      }
    } catch (err) {
      console.error(`[RAGIndexer] Failed to index ${opts.sourceType}/${opts.sourceId}:`, err);
    }
  });
}
