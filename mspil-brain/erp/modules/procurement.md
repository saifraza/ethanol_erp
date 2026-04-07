# Procurement Module

## Workflow

```
Purchase Requisition → Purchase Order → Goods Receipt (GRN) → Vendor Invoice → Vendor Payment
     (PR)                  (PO)             (GRN)
```

## Purchase Requisition (PR)
- Internal request for materials (plant indent)
- Created by any department
- Status: PENDING → APPROVED → PO_CREATED
- Links to department for budget tracking

## Purchase Order (PO)
- Formal order to vendor
- Status: DRAFT → APPROVED → SENT → PARTIAL_RECEIVED → FULLY_RECEIVED → CLOSED
- PO lines: materialId, qty, rate, value
- Tracks `pendingQty` per line (decremented on GRN)
- GST handling: supply type determines CGST+SGST (intra-state) or IGST (inter-state)
- TDS: if vendor has `tdsApplicable`, deduct `subtotal x tdsPercent / 100`

## Goods Receipt Note (GRN)
- Records what was actually received vs what was ordered
- Status: DRAFT → RECEIVED → ARCHIVED
- GRN lines: receivedQty, rejectedQty, remarks per PO line
- Creates inventory transactions on confirmation
- Gate entry linked for truck/vehicle tracking
- Documents: invoice scan + e-way bill uploaded, both sent to LightRAG

## Vendor Invoice
- Matched against GRN (3-way match: PO → GRN → Invoice)
- Status: DRAFT → VERIFIED → PAID
- Gemini Vision OCR: upload invoice photo → auto-extract fields
- Tracks GST components (CGST, SGST, IGST, TDS)

## Vendor Payment
- Payment against verified invoices
- Methods: bank transfer, cash, UPI, cheque
- Bank payment batches: multiple payments grouped into one STP file
- Approval workflow: MAKER → CHECKER → RELEASER (with PIN verification)
- Post-dated cheques tracked separately

## Vendor Master
- name, email, phone, GST, PAN, bank details
- Payment terms, credit limit
- TDS applicability and percentage
- Vendor-item catalog (rate, lead time, min order per material)

## Material Master
- code, name, unit of measure, category
- HSN code, GST percentage
- Reorder point, reorder quantity
- Links to inventory system

## Direct Purchase (Spot)
- Quick purchase without PO process
- For small/urgent items
- Tracks: vendorName, qty, rate, amount, date, status

## Contractor Management
- Separate from vendors — for labour/service providers
- Specialty: mechanical, electrical, civil
- Bills tracked with line items (description, qty, rate)
- Bill status: DRAFT → VERIFIED → PAID
- Payments tracked per bill

## Auto-Journal Entries
- GRN confirmed → Dr Inventory/Expense, Cr Trade Payable + GST Input
- Vendor Payment → Dr Trade Payable, Cr Bank/Cash
