// ==========================================================================
//  PAYMENTS-BY-PO — shared handlers for per-PO invoice + ledger CRUD.
//
//  These handlers are reusable across surfaces (Fuel, Raw Material, Store,
//  etc). They are PO-id keyed; the optional `category` query/body param
//  is only used as an upload-guard so an operator can't attach a fuel
//  invoice to a chemical PO from the wrong tab. Behaviour is the same as
//  the original handlers that lived inline in `fuel.ts` — moving them
//  here is a pure extraction so the Raw Material payments page can mount
//  them under its own URL prefix.
//
//  Multer middleware lives in fuel.ts (and is now also re-exported below
//  via getInvoiceUploadMiddleware) so each mount site can wire it in.
// ==========================================================================
import { Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { AuthRequest, getActiveCompanyId } from '../middleware/auth';
import prisma from '../config/prisma';

// Shared on-disk location for vendor-invoice uploads. Same directory the
// existing /uploads static serve already exposes — so URLs like
// /uploads/vendor-invoices/<file> keep working unchanged for fuel + RM.
const invoiceUploadDir = path.join(__dirname, '../../uploads/vendor-invoices');
if (!fs.existsSync(invoiceUploadDir)) fs.mkdirSync(invoiceUploadDir, { recursive: true });

// Multer instance — exported so each route surface can register the same
// middleware in front of postPoInvoice. 10 MB limit mirrors vendorInvoices.ts.
export const invoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, invoiceUploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Convenience helper — returns the multer middleware chain accepting both
// `files` (preferred multi-pick) and `file` (legacy single-pick) field
// names. Keeps the mount sites tidy.
export const invoiceUploadFields = invoiceUpload.fields([
  { name: 'files', maxCount: 20 },
  { name: 'file', maxCount: 1 },
]);

// --------------------------------------------------------------------------
//  GET /:poId/ledger — running ledger for a single PO.
// --------------------------------------------------------------------------
export async function getPoLedger(req: AuthRequest, res: Response): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.poId },
    select: {
      id: true, poNo: true, grandTotal: true, status: true,
      vendor: { select: { id: true, name: true, phone: true } },
      lines: { select: { quantity: true, receivedQty: true, rate: true, gstPercent: true } },
    },
  });
  if (!po) { res.status(404).json({ error: 'PO not found' }); return; }

  const receivedValue = Math.round(po.lines.reduce((s, l) => {
    const base = (l.receivedQty || 0) * l.rate;
    return s + base + base * ((l.gstPercent || 0) / 100);
  }, 0) * 100) / 100;
  const plannedValue = Math.round(po.lines.reduce((s, l) => {
    const q = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
    const base = q * (l.rate || 0);
    return s + base + base * ((l.gstPercent || 0) / 100);
  }, 0) * 100) / 100;
  const poTotal = po.grandTotal > 0 ? po.grandTotal : Math.max(plannedValue, receivedValue);

  const [invoices, payments, cashVouchers] = await Promise.all([
    prisma.vendorInvoice.findMany({
      where: { poId: po.id },
      select: { id: true, vendorInvNo: true, invoiceDate: true, totalAmount: true, status: true, originalFileName: true, filePath: true, createdAt: true },
      take: 500,
    }),
    prisma.vendorPayment.findMany({
      where: { purchaseOrderId: po.id },
      select: { id: true, paymentNo: true, paymentDate: true, amount: true, mode: true, reference: true, paymentStatus: true, invoiceId: true },
      take: 500,
    }),
    prisma.cashVoucher.findMany({
      where: { purchaseOrderId: po.id, status: { not: 'CANCELLED' } },
      select: { id: true, voucherNo: true, date: true, amount: true, paymentMode: true, paymentRef: true, status: true, payeeName: true, purpose: true },
      take: 500,
    }),
  ]);

  type LedgerRow =
    | { type: 'INVOICE'; date: Date; id: string; vendorInvNo: string | null; amount: number; status: string; fileName: string | null; filePath: string | null }
    | { type: 'PAYMENT'; date: Date; id: string; paymentNo: number; amount: number; mode: string; reference: string | null; paymentStatus: string; invoiceId: string | null }
    | { type: 'CASH_VOUCHER'; date: Date; id: string; voucherNo: number; amount: number; mode: string; reference: string | null; status: string };

  const rows: LedgerRow[] = [
    ...invoices.map<LedgerRow>((inv) => ({
      type: 'INVOICE',
      date: inv.invoiceDate || inv.createdAt,
      id: inv.id,
      vendorInvNo: inv.vendorInvNo,
      amount: inv.totalAmount || 0,
      status: inv.status,
      fileName: inv.originalFileName,
      filePath: inv.filePath,
    })),
    ...payments.map<LedgerRow>((p) => ({
      type: 'PAYMENT',
      date: p.paymentDate,
      id: p.id,
      paymentNo: p.paymentNo,
      amount: p.amount,
      mode: p.mode,
      reference: p.reference,
      paymentStatus: p.paymentStatus,
      invoiceId: p.invoiceId,
    })),
    ...cashVouchers.map<LedgerRow>((cv) => ({
      type: 'CASH_VOUCHER',
      date: cv.date,
      id: cv.id,
      voucherNo: cv.voucherNo,
      amount: cv.amount,
      mode: cv.paymentMode,
      reference: cv.paymentRef,
      status: cv.status,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = 0;
  const ledger = rows.map((r) => {
    // Invoices add to "owed", payments + cash vouchers subtract.
    // Running > 0 = vendor still owed.
    running += r.type === 'INVOICE' ? r.amount : -r.amount;
    return { ...r, runningBalance: Math.round(running * 100) / 100 };
  });

  const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
  const totalPaid = payments
    .filter((p) => p.paymentStatus === 'CONFIRMED')
    .reduce((s, p) => s + p.amount, 0)
    + cashVouchers
      .filter((cv) => cv.status === 'SETTLED')
      .reduce((s, cv) => s + cv.amount, 0);
  const pendingBank = payments
    .filter((p) => p.paymentStatus === 'INITIATED')
    .reduce((s, p) => s + p.amount, 0);
  const pendingCash = cashVouchers
    .filter((cv) => cv.status === 'ACTIVE')
    .reduce((s, cv) => s + cv.amount, 0);

  // Same fallback chain as the row-listing endpoint — without it a manual
  // PO (no GRNs) with bills uploaded but totals not yet filled in pins to
  // outstanding=0 and renders as "✓ Settled" while nothing is paid.
  let payableBasis: number;
  let basisSource: 'RECEIVED' | 'INVOICED' | 'PLANNED';
  if (receivedValue > 0) {
    payableBasis = receivedValue;
    basisSource = 'RECEIVED';
  } else if (totalInvoiced > 0) {
    payableBasis = totalInvoiced;
    basisSource = 'INVOICED';
  } else {
    payableBasis = poTotal;
    basisSource = 'PLANNED';
  }
  const outstanding = Math.max(0, Math.round((payableBasis - totalPaid - pendingBank - pendingCash) * 100) / 100);

  res.json({
    poNo: po.poNo,
    vendor: po.vendor,
    poTotal: Math.round(poTotal * 100) / 100,
    receivedValue,
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    pendingBank: Math.round(pendingBank * 100) / 100,
    pendingCash: Math.round(pendingCash * 100) / 100,
    outstanding,
    payableBasis: Math.round(payableBasis * 100) / 100,
    basisSource,
    ledger,
  });
}

// --------------------------------------------------------------------------
//  GET /:poId/invoices — list uploaded invoices for a PO.
// --------------------------------------------------------------------------
export async function getPoInvoices(req: AuthRequest, res: Response): Promise<void> {
  const invoices = await prisma.vendorInvoice.findMany({
    where: { poId: req.params.poId },
    take: 200,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, vendorInvNo: true, vendorInvDate: true, invoiceDate: true,
      totalAmount: true, paidAmount: true, status: true,
      filePath: true, originalFileName: true, remarks: true, createdAt: true,
    },
  });
  res.json(invoices);
}

// --------------------------------------------------------------------------
//  POST /:poId/invoice — multer multi-file upload + optional payment.
//  Caller must register the multer middleware (invoiceUploadFields) ahead
//  of this handler. Accepts up to 20 files under either `files` or `file`.
// --------------------------------------------------------------------------
export async function postPoInvoice(req: AuthRequest, res: Response): Promise<void> {
  const filesByField = (req.files || {}) as Record<string, Express.Multer.File[]>;
  const uploaded: Express.Multer.File[] = [
    ...(filesByField.files || []),
    ...(filesByField.file || []),
  ];
  if (uploaded.length === 0) { res.status(400).json({ error: 'No files uploaded' }); return; }

  const cleanupAll = () => {
    for (const f of uploaded) {
      try { fs.unlinkSync(f.path); } catch { /* best effort */ }
    }
  };

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.poId },
    select: { id: true, poNo: true, vendorId: true, companyId: true, division: true, lines: { select: { inventoryItem: { select: { category: true } } } } },
  });
  if (!po) {
    cleanupAll();
    res.status(404).json({ error: 'PO not found' });
    return;
  }
  // Validate the PO carries an inventory line in one of the expected
  // categories. Caller passes ?category= (or body.category) — same
  // comma-separated convention as the row listing. Default 'FUEL' for
  // back-compat with existing fuel UI.
  const rawCategory = (typeof req.query.category === 'string' && req.query.category) || (typeof req.body?.category === 'string' && req.body.category) || '';
  const allowedCategories = rawCategory
    ? rawCategory.split(',').map((c: string) => c.trim().toUpperCase()).filter(Boolean)
    : ['FUEL'];
  const matchesCategory = po.lines.some((l) => l.inventoryItem && allowedCategories.includes(l.inventoryItem.category));
  if (!matchesCategory) {
    cleanupAll();
    res.status(400).json({ error: `PO has no line in the requested category (${allowedCategories.join(', ')}).` });
    return;
  }

  // Bulk fallback fields (apply to every file when per-file `meta` not provided).
  const remarks = (typeof req.body?.remarks === 'string' ? req.body.remarks : '').slice(0, 500) || null;
  const fallbackInvNo = (typeof req.body?.vendorInvNo === 'string' ? req.body.vendorInvNo : '').slice(0, 50) || null;

  // Per-file metadata. JSON-encoded array, length should match files order.
  // Each entry: { vendorInvNo?, vendorInvDate? (ISO), totalAmount? (number) }
  interface PerFileMeta { vendorInvNo?: string | null; vendorInvDate?: string | null; totalAmount?: number | null }
  let metaList: PerFileMeta[] = [];
  if (typeof req.body?.meta === 'string' && req.body.meta.trim().length > 0) {
    try {
      const parsed = JSON.parse(req.body.meta);
      if (Array.isArray(parsed)) metaList = parsed as PerFileMeta[];
    } catch { /* malformed — ignore, use fallback */ }
  }

  // Optional payment to record once invoices are created.
  interface PaymentMeta { amount?: number; mode?: string; reference?: string; remarks?: string }
  let paymentMeta: PaymentMeta | null = null;
  if (typeof req.body?.payment === 'string' && req.body.payment.trim().length > 0) {
    try {
      const parsed = JSON.parse(req.body.payment) as PaymentMeta;
      if (parsed && typeof parsed.amount === 'number' && parsed.amount > 0) paymentMeta = parsed;
    } catch { /* malformed — ignore */ }
  }

  interface PerFileResult {
    ok: boolean;
    deduped: boolean;
    fileName: string;
    invoice?: { id: string; filePath: string | null; originalFileName: string | null; createdAt: Date; totalAmount: number; vendorInvNo: string | null };
    error?: string;
  }
  const results: PerFileResult[] = [];
  const newlyCreatedInvoiceIds: string[] = [];

  for (let i = 0; i < uploaded.length; i++) {
    const f = uploaded[i];
    const meta = metaList[i] || {};
    try {
      const fileBuffer = fs.readFileSync(f.path);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const filePath = `vendor-invoices/${f.filename}`;

      const existing = await prisma.vendorInvoice.findFirst({
        where: { poId: po.id, fileHash },
        select: { id: true, filePath: true, originalFileName: true, createdAt: true, totalAmount: true, vendorInvNo: true },
      });
      if (existing) {
        try { fs.unlinkSync(f.path); } catch { /* best effort */ }
        results.push({ ok: true, deduped: true, fileName: f.originalname, invoice: existing });
        continue;
      }

      const totalAmount = typeof meta.totalAmount === 'number' && isFinite(meta.totalAmount) && meta.totalAmount > 0
        ? Math.round(meta.totalAmount * 100) / 100
        : 0;
      const vendorInvNo = (meta.vendorInvNo || '').toString().slice(0, 50) || fallbackInvNo;
      const vendorInvDate = meta.vendorInvDate ? new Date(meta.vendorInvDate) : null;

      const invoice = await prisma.vendorInvoice.create({
        data: {
          vendorId: po.vendorId,
          poId: po.id,
          vendorInvNo,
          vendorInvDate,
          invoiceDate: new Date(),
          productName: '',
          status: 'PENDING',
          // Header totals — when totalAmount given we mirror it into balanceAmount
          // so the existing accounts ledger / outstanding views light up correctly.
          totalAmount,
          balanceAmount: totalAmount,
          filePath,
          fileHash,
          originalFileName: f.originalname,
          remarks,
          userId: req.user!.id,
          companyId: po.companyId ?? getActiveCompanyId(req),
          division: po.division ?? 'ETHANOL',
        },
        select: { id: true, filePath: true, originalFileName: true, createdAt: true, totalAmount: true, vendorInvNo: true },
      });
      results.push({ ok: true, deduped: false, fileName: f.originalname, invoice });
      newlyCreatedInvoiceIds.push(invoice.id);
    } catch (err: unknown) {
      try { fs.unlinkSync(f.path); } catch { /* best effort */ }
      const msg = err instanceof Error ? err.message : 'Upload failed';
      results.push({ ok: false, deduped: false, fileName: f.originalname, error: msg });
    }
  }

  // Optional payment alongside the upload. Linked to a single invoice via
  // invoiceId only when exactly one new invoice was created in this batch
  // (clean attribution); otherwise the payment hangs off the PO via FK.
  let createdPayment: { id: string; amount: number; paymentNo: number; mode: string; reference: string | null } | null = null;
  if (paymentMeta && paymentMeta.amount && paymentMeta.amount > 0) {
    const mode = (paymentMeta.mode || 'CASH').toString().slice(0, 20);
    const reference = (paymentMeta.reference || '').toString().slice(0, 100) || '';
    const payRemarks = (paymentMeta.remarks || '').toString().slice(0, 500)
      || `PO-${po.poNo}${newlyCreatedInvoiceIds.length === 1 ? ' (1 invoice attached)' : newlyCreatedInvoiceIds.length > 1 ? ` (${newlyCreatedInvoiceIds.length} invoices attached)` : ''}`;
    const linkedInvoiceId = newlyCreatedInvoiceIds.length === 1 ? newlyCreatedInvoiceIds[0] : null;

    const payment = await prisma.vendorPayment.create({
      data: {
        vendorId: po.vendorId,
        purchaseOrderId: po.id,
        invoiceId: linkedInvoiceId,
        paymentDate: new Date(),
        amount: Math.round(paymentMeta.amount * 100) / 100,
        mode,
        reference,
        paymentStatus: reference ? 'CONFIRMED' : 'INITIATED',
        confirmedAt: reference ? new Date() : null,
        isAdvance: false,
        remarks: payRemarks,
        userId: req.user!.id,
        companyId: po.companyId ?? getActiveCompanyId(req),
      },
      select: { id: true, amount: true, paymentNo: true, mode: true, reference: true, paymentStatus: true },
    });

    // When linked to a single invoice, bump its paid/balance figures so the
    // accounts ledger reflects the partial/full pay-down. Status mirrors
    // the existing PaymentsOut convention (PARTIAL_PAID vs PAID).
    if (linkedInvoiceId) {
      const inv = await prisma.vendorInvoice.findUnique({
        where: { id: linkedInvoiceId },
        select: { totalAmount: true, paidAmount: true },
      });
      if (inv) {
        const newPaid = Math.round(((inv.paidAmount || 0) + payment.amount) * 100) / 100;
        const total = inv.totalAmount || 0;
        const newBalance = Math.max(0, Math.round((total - newPaid) * 100) / 100);
        const newStatus = total > 0 && newPaid >= total - 0.01 ? 'PAID' : newPaid > 0 ? 'PARTIAL_PAID' : 'PENDING';
        await prisma.vendorInvoice.update({
          where: { id: linkedInvoiceId },
          data: { paidAmount: newPaid, balanceAmount: newBalance, status: newStatus },
        });
      }
    }

    // Auto-journal — same path the standalone fuel/Pay button uses.
    if (payment.paymentStatus === 'CONFIRMED') {
      try {
        const { onVendorPaymentMade } = await import('../services/autoJournal');
        await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
          id: payment.id, amount: payment.amount, mode, reference,
          tdsDeducted: 0, vendorId: po.vendorId, userId: req.user!.id, paymentDate: new Date(),
        });
      } catch { /* best-effort */ }
    }

    createdPayment = { id: payment.id, amount: payment.amount, paymentNo: payment.paymentNo, mode: payment.mode, reference: payment.reference };
  }

  const created = results.filter((r) => r.ok && !r.deduped).length;
  const deduped = results.filter((r) => r.ok && r.deduped).length;
  const failed = results.filter((r) => !r.ok).length;
  res.status(created > 0 || createdPayment ? 201 : 200).json({
    ok: failed === 0,
    results,
    payment: createdPayment,
    summary: { created, deduped, failed },
  });
}

// --------------------------------------------------------------------------
//  PUT /invoices/:invoiceId — backfill / correct invoice metadata.
// --------------------------------------------------------------------------
export const editInvoiceSchema = z.object({
  vendorInvNo: z.string().max(50).optional().nullable(),
  vendorInvDate: z.string().optional().nullable(),
  totalAmount: z.coerce.number().min(0).optional(),
  remarks: z.string().max(500).optional().nullable(),
});

export async function putInvoice(req: AuthRequest, res: Response): Promise<void> {
  const inv = await prisma.vendorInvoice.findUnique({
    where: { id: req.params.invoiceId },
    select: { id: true, totalAmount: true, paidAmount: true, status: true },
  });
  if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const b = req.body as z.infer<typeof editInvoiceSchema>;
  const data: Record<string, unknown> = {};
  if (b.vendorInvNo !== undefined) data.vendorInvNo = (b.vendorInvNo || '').trim() || null;
  if (b.vendorInvDate !== undefined) data.vendorInvDate = b.vendorInvDate ? new Date(b.vendorInvDate) : null;
  if (b.remarks !== undefined) data.remarks = (b.remarks || '').trim() || null;

  if (b.totalAmount !== undefined && isFinite(b.totalAmount)) {
    const total = Math.round(b.totalAmount * 100) / 100;
    const paid = inv.paidAmount || 0;
    const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
    const status = total > 0 && paid >= total - 0.01 ? 'PAID' : paid > 0 ? 'PARTIAL_PAID' : (inv.status === 'CANCELLED' ? 'CANCELLED' : 'PENDING');
    data.totalAmount = total;
    data.balanceAmount = balance;
    data.status = status;
  }

  const updated = await prisma.vendorInvoice.update({
    where: { id: inv.id },
    data,
    select: {
      id: true, vendorInvNo: true, vendorInvDate: true, invoiceDate: true,
      totalAmount: true, paidAmount: true, status: true,
      filePath: true, originalFileName: true, remarks: true, createdAt: true,
    },
  });
  res.json(updated);
}

// --------------------------------------------------------------------------
//  DELETE /invoices/:invoiceId — remove an unpaid invoice attachment.
// --------------------------------------------------------------------------
export async function deleteInvoice(req: AuthRequest, res: Response): Promise<void> {
  const inv = await prisma.vendorInvoice.findUnique({
    where: { id: req.params.invoiceId },
    select: { id: true, filePath: true, status: true, paidAmount: true, poId: true },
  });
  if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
  if ((inv.paidAmount || 0) > 0) {
    res.status(400).json({ error: 'Cannot delete — invoice has payments recorded against it.' });
    return;
  }
  await prisma.vendorInvoice.delete({ where: { id: inv.id } });
  if (inv.filePath) {
    const onDisk = path.join(__dirname, '../../uploads', inv.filePath);
    try { fs.unlinkSync(onDisk); } catch { /* file may already be gone */ }
  }
  res.json({ ok: true });
}

// --------------------------------------------------------------------------
//  Row-listing helper — same shape as /api/fuel/payments, parameterised
//  on the inventory categories the caller wants. Used by both the fuel
//  surface (categories=['FUEL'] when `?category=` not passed) and the
//  Raw Material surface (categories=['RAW_MATERIAL'], no override).
// --------------------------------------------------------------------------
// Row shape returned by listPaymentRows. Mirrors the PaymentRow type the
// frontend uses (in components/payments/types.ts) — kind/sourceLabel/workOrderNo
// are optional carriers added so the same component renders WO/contractor
// payables alongside vendor POs without a second listing endpoint.
interface PaymentRowOut {
  id: string;
  poNo: number;
  kind: 'PO' | 'CONTRACTOR_BILL';
  sourceLabel: string;
  workOrderId: string | null;
  workOrderNo: number | null;
  poDate: Date;
  status: string;
  dealType: string;
  paymentTerms: string | null;
  creditDays: number;
  vendor: { id: string; name: string; phone: string | null; bankName: string | null; bankAccount: string | null; bankIfsc: string | null };
  fuelName: string;
  fuelUnit: string;
  totalReceived: number;
  poTotal: number;
  receivedValue: number;
  totalPaid: number;
  pendingBank: number;
  pendingCash: number;
  outstanding: number;
  payableBasis: number;
  basisSource: 'RECEIVED' | 'INVOICED' | 'PLANNED';
  lastPaymentDate: Date | null;
  grnCount: number;
  invoiceCount: number;
  invoicedTotal: number;
  isFullyPaid: boolean;
}

export interface ListPaymentRowsOptions {
  companyFilter: Prisma.PurchaseOrderWhereInput;
  categories: string[]; // upper-cased InventoryItem.category values
  // When true, append open ContractorBills (work-order or indent-PO backed)
  // as additional rows with kind='CONTRACTOR_BILL'. The store payments page
  // wants WO/contractor payables alongside its category POs; fuel and raw-
  // material surfaces leave the flag off.
  includeContractorBills?: boolean;
}

export async function listPaymentRows({ companyFilter, categories, includeContractorBills }: ListPaymentRowsOptions) {
  const fuelPos = await prisma.purchaseOrder.findMany({
    where: {
      ...companyFilter,
      lines: { some: { inventoryItem: { category: { in: categories } } } },
      status: { not: 'DRAFT' },
    },
    take: 500,
    orderBy: { poDate: 'desc' },
    select: {
      id: true, poNo: true, poDate: true, status: true, dealType: true,
      grandTotal: true, paymentTerms: true, creditDays: true,
      vendor: { select: { id: true, name: true, phone: true, bankName: true, bankAccount: true, bankIfsc: true } },
      lines: {
        select: {
          quantity: true, receivedQty: true, rate: true, gstPercent: true, description: true,
          inventoryItem: { select: { id: true, name: true, unit: true, category: true } },
        },
      },
      _count: { select: { grns: true, vendorInvoices: true } },
    },
  });

  // Aggregate invoiced totals per PO in a single query (cheaper than N round-trips).
  const fuelPoIds = fuelPos.map(p => p.id);
  const invoiceTotalsRaw = fuelPoIds.length > 0 ? await prisma.vendorInvoice.groupBy({
    by: ['poId'],
    where: { poId: { in: fuelPoIds } },
    _sum: { totalAmount: true },
  }) : [];
  const invoicedByPo = new Map<string, number>();
  for (const row of invoiceTotalsRaw) {
    if (row.poId) invoicedByPo.set(row.poId, row._sum.totalAmount || 0);
  }

  const result: Array<PaymentRowOut> = await Promise.all(fuelPos.map(async (po): Promise<PaymentRowOut> => {
    // Pick the first line whose inventory item matches the requested category
    // for the row label + unit. Legacy fallback: any line if none match.
    const matchingLines = po.lines.filter(l => l.inventoryItem && categories.includes(l.inventoryItem.category));
    const linesToSum = matchingLines.length > 0 ? matchingLines : po.lines;
    const fuelLabel = matchingLines[0]?.inventoryItem?.name || matchingLines[0]?.description || po.lines[0]?.description || 'Item';
    const fuelUnit = matchingLines[0]?.inventoryItem?.unit || po.lines[0]?.inventoryItem?.unit || 'MT';

    const totalReceived = linesToSum.reduce((s, l) => s + (l.receivedQty || 0), 0);
    const receivedValue = Math.round(linesToSum.reduce((s, l) => {
      const base = (l.receivedQty || 0) * (l.rate || 0);
      return s + base + base * ((l.gstPercent || 0) / 100);
    }, 0) * 100) / 100;
    const isOpen = po.dealType === 'OPEN';
    const plannedValue = Math.round(linesToSum.reduce((s, l) => {
      const q = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
      const base = q * (l.rate || 0);
      return s + base + base * ((l.gstPercent || 0) / 100);
    }, 0) * 100) / 100;
    const poTotal = po.grandTotal > 0 ? po.grandTotal : (isOpen ? receivedValue : Math.max(plannedValue, receivedValue));

    const confirmedPayments = await prisma.vendorPayment.findMany({
      where: { purchaseOrderId: po.id, paymentStatus: 'CONFIRMED' },
      select: { amount: true, paymentDate: true },
      take: 500,
    });
    const totalPaid = confirmedPayments.reduce((s, p) => s + p.amount, 0);
    const lastPaymentDate = confirmedPayments.reduce<Date | null>((latest, p) => {
      if (!latest || p.paymentDate > latest) return p.paymentDate;
      return latest;
    }, null);

    const pendingBankAgg = await prisma.vendorPayment.aggregate({
      where: { purchaseOrderId: po.id, paymentStatus: 'INITIATED' },
      _sum: { amount: true },
    });
    const pendingBank = pendingBankAgg._sum.amount || 0;

    const pendingCashAgg = await prisma.cashVoucher.aggregate({
      where: { status: 'ACTIVE', purchaseOrderId: po.id },
      _sum: { amount: true },
    });
    const pendingCash = pendingCashAgg._sum.amount || 0;

    const invoicedTotal = Math.round((invoicedByPo.get(po.id) || 0) * 100) / 100;

    // Outstanding fallback chain — figure out the right "what we owe" basis.
    // 1. If GRNs exist, use receivedValue (only pay for what arrived).
    // 2. Else if invoices have totals, use the invoiced total (vendor-billed POs without weighbridge).
    // 3. Else fall back to the planned PO total so a brand-new PO doesn't render as "✓ Paid".
    // Without this chain a manual PO with 0 GRNs and 0 invoiced total
    // shows outstanding=0 → looks settled even when nothing was paid.
    let payableBasis: number;
    let basisSource: 'RECEIVED' | 'INVOICED' | 'PLANNED';
    if (receivedValue > 0) {
      payableBasis = receivedValue;
      basisSource = 'RECEIVED';
    } else if (invoicedTotal > 0) {
      payableBasis = invoicedTotal;
      basisSource = 'INVOICED';
    } else {
      payableBasis = poTotal;
      basisSource = 'PLANNED';
    }
    const outstanding = Math.max(0, Math.round((payableBasis - totalPaid - pendingBank - pendingCash) * 100) / 100);

    return {
      id: po.id,
      poNo: po.poNo,
      kind: 'PO' as const,
      sourceLabel: `PO-${po.poNo}`,
      workOrderId: null as string | null,
      workOrderNo: null as number | null,
      poDate: po.poDate,
      status: po.status,
      dealType: po.dealType,
      paymentTerms: po.paymentTerms,
      creditDays: po.creditDays,
      vendor: po.vendor,
      fuelName: fuelLabel,
      fuelUnit,
      totalReceived: Math.round(totalReceived * 100) / 100,
      poTotal: Math.round(poTotal * 100) / 100,
      receivedValue,
      totalPaid: Math.round(totalPaid * 100) / 100,
      pendingBank: Math.round(pendingBank * 100) / 100,
      pendingCash: Math.round(pendingCash * 100) / 100,
      outstanding,
      payableBasis: Math.round(payableBasis * 100) / 100,
      basisSource,
      lastPaymentDate,
      grnCount: po._count.grns,
      invoiceCount: po._count.vendorInvoices,
      invoicedTotal,
      isFullyPaid: payableBasis > 0 && (totalPaid + pendingBank + pendingCash) >= payableBasis - 0.01,
    };
  }));

  if (!includeContractorBills) return result;

  // ── Append open contractor bills (WO + indent-PO backed) ──────────────
  // The store payments surface wants WO and contractor payables alongside
  // its category POs. We re-shape ContractorBill into the PaymentRow shape
  // so PaymentsTable can render them without a separate code path. The
  // `kind` discriminator + sourceLabel (`WO-N` / `BILL-N`) tell the UI to
  // gate features that only make sense for vendor POs (e.g. invoice upload).
  const bills = await prisma.contractorBill.findMany({
    where: {
      // Surface every active bill so the store team can chase invoices through
      // their full lifecycle (DRAFT → CONFIRMED → PARTIAL_PAID → PAID),
      // not just the unpaid balance phase.
      status: { in: ['DRAFT', 'CONFIRMED', 'PARTIAL_PAID', 'PAID'] },
    },
    select: {
      id: true, billNo: true, billDate: true, description: true, status: true,
      subtotal: true, totalAmount: true, netPayable: true, paidAmount: true, balanceAmount: true,
      workOrderId: true,
      workOrder: { select: { id: true, woNo: true } },
      contractor: { select: { id: true, name: true, phone: true, bankName: true, bankAccount: true, bankIfsc: true } },
    },
    orderBy: { billDate: 'desc' },
    take: 500,
  });

  for (const cb of bills) {
    const woNo = cb.workOrder?.woNo ?? null;
    const sourceLabel = woNo != null ? `WO-${woNo}` : `BILL-${cb.billNo}`;
    const isFullyPaid = cb.balanceAmount <= 0.01 && cb.netPayable > 0;
    result.push({
      id: cb.id,
      poNo: cb.billNo,
      kind: 'CONTRACTOR_BILL' as const,
      sourceLabel,
      workOrderId: cb.workOrder?.id ?? cb.workOrderId ?? null,
      workOrderNo: woNo,
      poDate: cb.billDate,
      status: cb.status,
      dealType: 'CONTRACTOR',
      paymentTerms: null,
      creditDays: 0,
      vendor: { id: cb.contractor.id, name: cb.contractor.name, phone: cb.contractor.phone, bankName: cb.contractor.bankName, bankAccount: cb.contractor.bankAccount, bankIfsc: cb.contractor.bankIfsc },
      fuelName: cb.description,
      fuelUnit: '',
      totalReceived: 0,
      poTotal: cb.totalAmount,
      receivedValue: cb.totalAmount,
      totalPaid: cb.paidAmount,
      pendingBank: 0,
      pendingCash: 0,
      outstanding: cb.balanceAmount,
      payableBasis: cb.netPayable,
      basisSource: 'INVOICED' as const,
      lastPaymentDate: null,
      grnCount: 0,
      invoiceCount: 0,
      invoicedTotal: cb.netPayable,
      isFullyPaid,
    });
  }

  return result;
}
