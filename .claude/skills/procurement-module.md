# Procurement Module (Procure-to-Pay)

## Overview
Full procure-to-pay cycle: requisition → purchase order → goods receipt → vendor invoice → payment. Includes PO PDF generation with MSPIL letterhead, 3-way matching, ITC tracking, and vendor ledger.

## Files

### Backend
| File | Purpose |
|------|---------|
| `routes/purchaseOrders.ts` | PO CRUD, status workflow, PDF generation |
| `routes/goodsReceipts.ts` | GRN creation, stock updates, quality tracking |
| `routes/vendorInvoices.ts` | Invoice matching, ITC report, status workflow |
| `routes/vendorPayments.ts` | Payments, vendor ledger with running balance |
| `routes/purchaseRequisition.ts` | Internal material requests with urgency/category |
| `routes/vendors.ts` | Vendor CRUD, seed data |
| `routes/materials.ts` | Material master with live stock balance |
| `utils/pdfGenerator.ts` | PO PDF with letterhead, line items, GST breakdown |

### Frontend
| File | Purpose |
|------|---------|
| `pages/procurement/PurchaseOrders.tsx` | PO list, create/edit form |
| `pages/procurement/GoodsReceipts.tsx` | GRN creation against POs |
| `pages/procurement/VendorInvoices.tsx` | Invoice matching and ITC |
| `pages/procurement/VendorPayments.tsx` | Payment recording |
| `pages/procurement/Vendors.tsx` | Vendor management |
| `pages/procurement/Materials.tsx` | Material master |
| `pages/PurchaseRequisition.tsx` | Internal requisitions |

### Prisma Models
Vendor, Material, PurchaseOrder, POLine, GoodsReceipt, GRNLine, VendorInvoice, VendorPayment, PurchaseRequisition

---

## Procure-to-Pay Flow

```
PurchaseRequisition → PurchaseOrder → GoodsReceipt → VendorInvoice → VendorPayment
     (optional)         (+ POLines)     (+ GRNLines)    (3-way match)    (ledger)
```

### Purchase Requisition (optional first step)
- Status: `DRAFT → SUBMITTED → APPROVED/REJECTED → ORDERED → RECEIVED`
- Urgency: `ROUTINE | SOON | URGENT | EMERGENCY`
- Category: `SPARE_PART | RAW_MATERIAL | CONSUMABLE | TOOL | SAFETY | GENERAL`
- Routes:
  - `GET /` — list with status/urgency filters
  - `GET /stats` — counts by status, urgency, total value
  - `POST /` — create
  - `PUT /:id` — update
  - `DELETE /:id` — admin only

### Purchase Order
- Status workflow (finite state machine):
```
DRAFT → APPROVED → SENT → PARTIAL_RECEIVED → RECEIVED → CLOSED
  ↓        ↓        ↓
CANCELLED CANCELLED CANCELLED
```
- On `APPROVED`: captures `approvedBy` (userId) and `approvedAt` (timestamp)
- PO has multiple `POLine` items with: material, quantity, rate, discount, HSN, GST
- Supply type: `INTRA_STATE` or `INTER_STATE` (determines CGST/SGST vs IGST)
- Routes:
  - `GET /` — list with status/vendorId filters, pagination
  - `GET /:id` — single PO with lines, vendor, GRNs
  - `POST /` — create PO with lines (in transaction)
  - `PUT /:id` — update PO (DRAFT only)
  - `PUT /:id/status` — status transitions with validation
  - `GET /:id/pdf` — PO PDF with letterhead
  - `DELETE /:id` — delete PO

### PO PDF Generation
- Route: `GET /api/purchaseOrders/:id/pdf`
- Uses `generatePOPdf()` from `utils/pdfGenerator.ts`
- Content: MSPIL letterhead, PO details, vendor info, supply type, place of supply
- Line items: HSN, qty, rate, discount, GST breakdown (CGST/SGST or IGST)
- Totals: subtotal, freight, other charges, round-off, TDS (if applicable), grand total
- Barcode with PO number
- `Content-Disposition: inline` (opens in browser)

### Goods Receipt (GRN)
- Status: `DRAFT → CONFIRMED → CANCELLED`
- Quality: `PENDING → ACCEPTED / REJECTED / PARTIAL_ACCEPTED`
- **Critical**: GRN creation updates TWO things atomically:
  1. `POLine.receivedQuantity += received amount`
  2. `Material.currentStock += received amount`
- Tracks: vehicle number, challan number, e-way bill number
- Routes:
  - `GET /` — list with poId/vendorId/status filters
  - `GET /pending-pos` — POs with quantities still pending receipt
  - `GET /:id` — single GRN with lines, PO, vendor
  - `POST /` — create GRN (updates PO + stock in transaction)
  - `PUT /:id/quality` — update quality status
  - `PUT /:id/status` — status transitions
  - `DELETE /:id` — delete GRN (reverses stock updates)

### Vendor Invoice
- 3-way matching: PO ↔ GRN ↔ Invoice
- ITC (Input Tax Credit) tracking per invoice
- Routes:
  - `GET /` — list with vendorId/status filters
  - `GET /outstanding` — outstanding invoices grouped by vendor
  - `GET /itc-report` — ITC report for GST filing
  - `POST /` — create invoice
  - `PUT /:id/status` — status transitions
  - `PUT /:id/itc` — update ITC status

### Vendor Payment
- Routes:
  - `GET /` — list with vendorId/date range filters
  - `GET /ledger/:vendorId` — full vendor ledger with running balance
  - `GET /outstanding` — outstanding payments report
  - `POST /` — create payment against invoices

---

## Vendor Model Key Fields
```
gstin          — 15-char GSTIN
gstState       — State name
gstStateCode   — 2-digit state code
isRCM          — Reverse Charge Mechanism flag
isMSME         — MSME classification
tdsApplicable  — TDS deduction enabled
tdsPercent     — TDS rate
creditLimit    — Credit limit amount
creditDays     — Payment terms (days)
bankName, bankBranch, bankAccount, bankIfsc — Bank details
```

---

## Critical Bugs to Avoid

### N+1 Queries in GRN Creation/Deletion
- `goodsReceipts.ts CREATE`: Loops POLines with individual `findUnique` + `update`
- **Fix**: Batch fetch with `findMany({ where: { id: { in: ids } } })`, then batch update in `$transaction`
- Same issue in DELETE when reversing a GRN

### Missing Pagination
- Vendor and material list endpoints may not have `take`/`skip` — always add pagination

### Missing Validation
- Most POST/PUT routes lack Zod `validate()` middleware — add when touching these routes

### Stock Consistency
- `Material.currentStock` is live inventory — GRN create/delete must update atomically
- Use `prisma.$transaction` for all GRN operations that touch stock

---

## Indexes
- PurchaseOrder: `[vendorId]`, `[status]`
- GoodsReceipt: `[poId]`, `[vendorId]`
- VendorInvoice: `[vendorId]`, `[status]`
- PurchaseRequisition: `[status]`
