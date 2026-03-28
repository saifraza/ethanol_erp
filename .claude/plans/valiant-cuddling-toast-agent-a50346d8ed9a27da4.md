# PDF Generation Migration Plan: PDFKit/pdf-lib to HTML Templates + Puppeteer

## Executive Summary

Migrate 8 document types from coordinate-based PDFKit/pdf-lib rendering to HTML/CSS templates rendered via Puppeteer, while adding a live preview feature to the DocumentTemplates admin page. The migration preserves all existing API endpoints and visual fidelity.

---

## Current Architecture Analysis

### PDF Generation Locations

| Document | Route File | Generator | Library |
|----------|-----------|-----------|---------|
| Purchase Order | `purchaseOrders.ts` | `generatePOPdf()` in `pdfGenerator.ts` | pdfkit |
| Tax Invoice | `invoices.ts` | `generateInvoicePdf()` in `pdfGenerator.ts` | pdf-lib |
| Sales Order | `salesOrders.ts` | inline ~200 lines | pdfkit |
| Delivery Challan | `shipments.ts` | inline ~150 lines | pdfkit |
| Gate Pass | `shipments.ts` + `ddgsDispatch.ts` | inline ~150 lines each | pdfkit |
| DDGS Invoice | `ddgsDispatch.ts` | inline ~280 lines | pdfkit |
| Freight Inquiry | `freightInquiry.ts` | inline ~100 lines | pdfkit |
| Vendor Invoice | `vendorInvoices.ts` | inline ~100 lines | pdfkit |
### Shared Components
- **Letterhead**: `backend/src/utils/letterhead.ts` — `drawLetterhead()` used by shipments, ddgsDispatch, salesOrders, freightInquiry, vendorInvoices
- **Template data**: `backend/src/utils/templateHelper.ts` — `getTemplate()` fetches terms/footer/bankDetails from DB with fallback defaults
- **Barcode**: `bwip-js` — `generateBarcode()` in templateHelper.ts
- **Formatting helpers**: `numberToWords()`, `formatINR()`, `formatDate()` in pdfGenerator.ts
- **Assets**: `backend/assets/MSPIL_logo_transparent.png`, `MSPIL_letterhead.png`

### Template Admin
- **Backend**: `backend/src/routes/documentTemplates.ts` — CRUD for DocumentTemplate model
- **Frontend**: `frontend/src/pages/DocumentTemplates.tsx` — accordion editor, no preview
- **DB Model**: `DocumentTemplate` in Prisma schema (docType, title, terms JSON, footer, bankDetails, companyInfo, remarks)

### Email Sending Pattern
Several routes generate PDF buffers for email attachments (PO, Invoice, Sales Order, Vendor Invoice, Shipment Challan). The new system must return `Buffer` for these use cases, not just pipe to response.

---

## Phase 1: Infrastructure Setup

### 1.1 New Dependencies

Add to `backend/package.json`:
- `puppeteer-core` — headless Chrome PDF rendering (no bundled Chromium)
- `@sparticuz/chromium` — Chromium binary for Railway/serverless
- `handlebars` — HTML template engine

Rationale for `puppeteer-core` + `@sparticuz/chromium`:
Railway runs on Linux containers. `@sparticuz/chromium` provides a compressed Chromium build (~50MB) optimized for containers. Falls back to local Chrome in development via env var.

### 1.2 File Structure for Templates

```
backend/src/
  templates/
    layouts/
      base.hbs              # Base HTML wrapper (doctype, head, page styles)
      letterhead.hbs         # MSPIL letterhead partial (logo, green band, company info)
      footer.hbs             # Terms, signatures, footer text partial
    documents/
      purchase-order.hbs
      tax-invoice.hbs
      sales-order.hbs
      delivery-challan.hbs
      gate-pass.hbs
      ddgs-invoice.hbs
      freight-inquiry.hbs
      vendor-invoice.hbs
    styles/
      common.css             # Shared: typography, table, layout, INR formatting
      letterhead.css         # Letterhead-specific: green band, logo positioning
    sampleData/
      purchase-order.ts
      tax-invoice.ts
      sales-order.ts
      delivery-challan.ts
      gate-pass.ts
      ddgs-invoice.ts
      freight-inquiry.ts
      vendor-invoice.ts
    helpers/
      handlebars-helpers.ts  # Register: formatINR, formatDate, numberToWords, etc.
```

Why files on disk (not DB): Version-controlled, syntax highlighting in editors, Handlebars partials require file-based registration, and the DB already stores the dynamic parts (terms, footer, bankDetails).

### 1.3 Puppeteer Service — `backend/src/services/pdfRenderer.ts`

Responsibilities:
1. Initialize and manage a Puppeteer browser singleton (lazy launch, reconnect on crash)
2. `renderHtml(templateName, data)` — compile Handlebars template into HTML string
3. `htmlToPdf(html)` — render HTML in Puppeteer page, return PDF Buffer
4. `renderPdf(templateName, data)` — combines both above
5. `closeBrowser()` — graceful shutdown

Key design decisions:
- Browser singleton: launch once, reuse across requests. Restart on crash via `disconnected` event.
- New page per request: pages are lightweight (~2MB each). Close after PDF generation.
- PDF options: A4 size, no margins (margins handled in CSS via `@page`), `printBackground: true`
- CSS inlined: embed all CSS in `<style>` tags within the HTML
- Images as base64: convert MSPIL logo to base64 data URI at startup, embed in letterhead partial
- Barcodes as base64: generate barcode PNG via bwip-js, convert to data URI, embed in `<img>` tag

Environment detection:
- `CHROMIUM_PATH` env var for explicit path
- Detect Railway via `RAILWAY_ENVIRONMENT` env var to auto-use `@sparticuz/chromium`
- Development: use system-installed Chrome

### 1.4 Template Engine — `backend/src/services/templateEngine.ts`

Responsibilities:
1. Pre-compile all .hbs templates at startup (fail fast on missing templates)
2. Register partials (letterhead, footer, base layout)
3. Register custom Handlebars helpers
4. Expose: `compileTemplate(docType, data)` returns HTML string

Handlebars helpers to register (ported from pdfGenerator.ts):
- `formatINR(n)` — Rs.X,XX,XXX.XX Indian format
- `formatDate(d)` — dd/mm/yyyy
- `numberToWords(n)` — Indian numbering system (Lakh, Crore)
- `inc(n)` — increment for row numbering
- `eq(a, b)` — equality check
- `multiply(a, b)`, `add(a, b)` — arithmetic in templates
- `base64Barcode(text)` — generate barcode and return data URI

### 1.5 Update Build Script

Current: `"build": "tsc --outDir dist && cp -r src/data dist/"`
New: `"build": "tsc --outDir dist && cp -r src/data dist/ && cp -r src/templates dist/"`

Handlebars (.hbs) and CSS files are not TypeScript, so they need explicit copying into the dist directory.

---

## Phase 2: Pilot Template (Purchase Order) + Preview

### 2.1 Create the PO Handlebars Template

Translate the ~400-line coordinate-based PDFKit code in `pdfGenerator.ts` (lines 96-400) into HTML/CSS.

Template structure for `purchase-order.hbs`:
- Include `base` layout (sets up HTML5, A4 @page CSS, inlines common.css)
- Include `letterhead` partial (green band, logo as base64, company info)
- Document title: "PURCHASE ORDER"
- Meta grid: PO Number, Date, Delivery Date, Supply Type, Place of Supply
- Two-column info boxes: Vendor details (left), Delivery details (right)
- Line items table with columns: #, Description, HSN, Qty, Unit, Rate, GST%, Taxable, Total
- Totals section: Subtotal, GST, Freight, Other Charges, Round Off, Grand Total (highlighted)
- Amount in words
- Remarks (conditional)
- Include `footer` partial (terms & conditions from template data, signature lines, footer text)

CSS requirements for A4 PDF fidelity:
- `@page { size: A4; margin: 0; }`
- Body padding: 40px sides, 30px top/bottom (matching current PDFKit margins)
- Font family: Arial, Helvetica, sans-serif
- Green color scheme: `#4A7D28` primary, `#1A3B0A` dark, `#C5D49E` light bg
- Table: alternating rows `#F5F5F5` / `#FFFFFF`, green header row
- `break-inside: avoid` on critical sections (totals, signatures)

### 2.2 Sample Data — `sampleData/purchase-order.ts`

Export a `samplePOData` object matching the `POData` interface (defined at pdfGenerator.ts:49-94). Include:
- Realistic vendor (Indian company with GSTIN)
- 2-3 line items with HSN codes, GST calculations
- Proper totals (subtotal, GST, freight, grand total)
- Remarks text

### 2.3 Update PO Route

In `backend/src/routes/purchaseOrders.ts`:
1. Replace `import { generatePOPdf }` with `import { renderPdf }` from pdfRenderer
2. Keep existing data-fetching logic (lines 374-418) unchanged
3. Call `renderPdf('purchase-order', poData)` instead of `generatePOPdf(poData)`
4. Email endpoint (line 426) uses same `renderPdf()` — returns Buffer

### 2.4 Preview Endpoints

Add to `backend/src/routes/documentTemplates.ts`:

**GET `/api/document-templates/:docType/preview`**
- Load template data from DB (terms, footer, bankDetails)
- Load sample data for the docType
- Merge template data into sample data context
- Call `templateEngine.compileTemplate(docType, mergedData)` to get HTML
- Return HTML with `Content-Type: text/html`

**POST `/api/document-templates/:docType/preview`**
- Accept `{ terms, footer, bankDetails, remarks }` in request body (unsaved edits)
- Merge with sample data (using POST body instead of DB values)
- Return rendered HTML
- This lets admins preview changes before saving

**GET `/api/document-templates/:docType/preview?format=pdf`**
- Same as GET but passes HTML through `pdfRenderer.htmlToPdf()` and returns PDF
- For "Download Sample PDF" functionality

### 2.5 Frontend Preview Component

Modify `frontend/src/pages/DocumentTemplates.tsx`:

Add a `PreviewModal` component:
- Triggered by a new "Preview" button (Eye icon) next to Save/Reset
- On click: POST current unsaved template data to preview endpoint
- Display returned HTML in an `<iframe>` using `srcDoc` attribute
- Modal: full-screen overlay or right-side panel (60% width)
- Include "Download PDF" button (calls `?format=pdf` endpoint, triggers browser download)
- Include "Close" button

The preview button calls:
```typescript
const previewHtml = async (docType: string) => {
  const data = editData[docType];
  const res = await api.post(`/document-templates/${docType}/preview`, {
    terms: data.terms, footer: data.footer,
    bankDetails: data.bankDetails, remarks: data.remarks,
  }, { responseType: 'text' });
  setPreviewHtml(res.data);
  setPreviewOpen(true);
};
```

---

## Phase 3: Convert Remaining Templates

### Migration Order (simplest first)

1. **Vendor Invoice** (`vendorInvoices.ts:325`) — ~70 lines inline, simple layout
2. **Freight Inquiry** (`freightInquiry.ts:151`) — ~80 lines inline, simple layout
3. **Sales Order** (`salesOrders.ts:332`) — ~220 lines inline, has email sending
4. **Delivery Challan** (`shipments.ts:774`) — uses `drawLetterhead()` + barcode
5. **Gate Pass - Ethanol** (`shipments.ts:924`) — similar to challan, different data
6. **Gate Pass - DDGS** (`ddgsDispatch.ts:587`) — similar structure, DDGS data
7. **DDGS Invoice** (`ddgsDispatch.ts:298`) — complex, ~280 lines, SAP B1 style
8. **Tax Invoice** (`invoices.ts` via `pdfGenerator.ts:432`) — uses pdf-lib (different API)

### Per-Template Migration Steps

1. Create `templates/documents/{name}.hbs`
2. Create `templates/sampleData/{name}.ts`
3. Update route to call `renderPdf()` instead of inline PDFKit code
4. Update email-sending endpoints if applicable
5. Test: visual comparison with old PDF, email attachment, barcode rendering

### Expand DocumentTemplate Doc Types

Current DEFAULTS in `documentTemplates.ts` cover: CHALLAN, PURCHASE_ORDER, INVOICE, RATE_REQUEST, SALE_ORDER.

Add new entries:
- `GATE_PASS` — Gate Pass cum Challan
- `DDGS_INVOICE` — DDGS Tax Invoice  
- `VENDOR_INVOICE` — Vendor Invoice

Update `DOC_TYPE_LABELS` in `DocumentTemplates.tsx` frontend to include these new types with appropriate labels, descriptions, and colors.

---

## Phase 4: Cleanup

### Remove Old Dependencies
From `backend/package.json` dependencies:
- `pdfkit`
- `pdf-lib`
- `@pdf-lib/standard-fonts`
- `@pdf-lib/upng`

From devDependencies:
- `@types/pdfkit`

### Delete Old Files
- `backend/src/utils/pdfGenerator.ts` — both `generatePOPdf` and `generateInvoicePdf`
- `backend/src/utils/letterhead.ts` — replaced by `letterhead.hbs` partial

### Keep
- `backend/src/utils/templateHelper.ts` — `getTemplate()` still fetches DB template data, `generateBarcode()` still used
- `backend/assets/MSPIL_logo_transparent.png` — read at startup, converted to base64 for templates
- `bwip-js` dependency — still used for barcode generation

---

## Railway Deployment Considerations

### Chromium on Railway

Use `@sparticuz/chromium` (recommended):

In `pdfRenderer.ts`:
```typescript
async function launchBrowser() {
  const isProduction = !!process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
  if (isProduction) {
    const chromium = require('@sparticuz/chromium');
    return puppeteer.launch({
      args: [...chromium.args, '--disable-dev-shm-usage', '--no-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }
  // Development: use locally installed Chrome
  return puppeteer.launch({ headless: true });
}
```

### Memory
- Chromium browser instance: ~100-200MB RSS
- Railway default 512MB may be tight; recommend 1GB
- Browser singleton + per-request pages minimizes overhead
- Add page-level timeout (30s) to prevent runaway renders

### Build Size
- `@sparticuz/chromium` adds ~50MB compressed
- Removing pdfkit + pdf-lib saves ~5MB
- Net increase: ~45MB — acceptable

### Graceful Shutdown
Add to server shutdown handler:
```typescript
process.on('SIGTERM', async () => {
  await pdfRenderer.closeBrowser();
  process.exit(0);
});
```

---

## Risk Mitigation

1. **Visual regression**: Keep old PDF code on a branch for A/B comparison. Do not delete until all templates validated.
2. **Puppeteer crashes**: Browser `disconnected` event triggers automatic re-launch. Wrap all `htmlToPdf` calls in try/catch with retry.
3. **Railway memory**: Monitor via Railway metrics dashboard. Browser singleton + page cleanup keeps usage bounded.
4. **Concurrent load**: Puppeteer pages are ~2MB each. At 10 concurrent PDFs = ~20MB extra. Add a semaphore (max 5 concurrent pages) if needed.
5. **Template errors**: Pre-compile all templates at server startup. Missing or malformed templates fail immediately, not at request time.
6. **Font differences**: PDFKit uses Helvetica; HTML uses system fonts. Specify `font-family: Arial, Helvetica, sans-serif` in CSS for near-identical rendering.
