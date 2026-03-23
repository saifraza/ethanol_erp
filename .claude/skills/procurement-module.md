# Procurement Module

## Files
- **Backend**: `routes/vendors.ts`, `routes/materials.ts`, `routes/purchaseOrders.ts`, `routes/goodsReceipts.ts`, `routes/vendorInvoices.ts`, `routes/vendorPayments.ts`, `routes/purchaseRequisition.ts`
- **Frontend**: `pages/procurement/Vendors.tsx`, `pages/procurement/Materials.tsx`, `pages/procurement/PurchaseOrders.tsx`, `pages/procurement/GoodsReceipts.tsx`, `pages/procurement/VendorInvoices.tsx`, `pages/procurement/VendorPayments.tsx`, `pages/PurchaseRequisition.tsx`
- **Models**: Vendor, Material, PurchaseOrder, POLine, GoodsReceipt, GRNLine, VendorInvoice, VendorPayment, PurchaseRequisition

## Procure-to-Pay Flow
```
PurchaseRequisition → PurchaseOrder (+ POLines) → GoodsReceipt (+ GRNLines) → VendorInvoice → VendorPayment
```

1. **PurchaseRequisition**: Internal request for materials (optional first step)
2. **PurchaseOrder**: Issued to vendor with line items (POLine)
   - Status: DRAFT → APPROVED → PARTIALLY_RECEIVED → COMPLETED → CANCELLED
3. **GoodsReceipt**: Materials physically received
   - Updates POLine.receivedQuantity += received amount
   - Updates Material.currentStock += received amount
   - Links back to PO via poId
4. **VendorInvoice**: Vendor submits invoice against GRN(s)
5. **VendorPayment**: Payment recorded against vendor invoices

## Key Logic
- GRN creation updates two things atomically: POLine quantities AND Material stock
- PO status should auto-update when all lines fully received
- Vendor model has GSTIN lookup capability (queries government database)
- Material.currentStock is the live inventory balance

## Critical Bugs to Avoid
- **N+1 in goodsReceipts.ts CREATE**: Loops POLines with individual findUnique + update
  - Fix: Batch fetch `findMany({ where: { id: { in: ids } } })`, then batch update in `$transaction`
- **N+1 in goodsReceipts.ts DELETE**: Same loop pattern when reversing a GRN
- **No pagination** on vendor/material list endpoints — add `take`/`skip`
- **No input validation** on most POST/PUT routes — add Zod `validate()` middleware

## Indexes
- PurchaseOrder: [vendorId], [status]
- GoodsReceipt: [poId], [vendorId]
