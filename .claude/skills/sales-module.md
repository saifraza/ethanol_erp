# Sales Module

## Files
- **Backend**: `routes/salesOrders.ts`, `routes/customers.ts`, `routes/invoices.ts`, `routes/payments.ts`, `routes/shipments.ts`, `routes/dispatchRequests.ts`, `routes/ethanolContracts.ts`, `routes/freightInquiry.ts`, `routes/transporters.ts`, `routes/transporterPayments.ts`, `routes/shipmentDocuments.ts`
- **Frontend**: `pages/sales/SalesOrders.tsx`, `pages/sales/Customers.tsx`, `pages/sales/Invoices.tsx`, `pages/sales/Payments.tsx`, `pages/sales/Shipments.tsx`, `pages/sales/DispatchRequests.tsx`, `pages/sales/EthanolContracts.tsx`, `pages/sales/FreightManagement.tsx`, `pages/sales/Transporters.tsx`, `pages/sales/SalesDashboard.tsx`
- **Models**: SalesOrder, SalesOrderLine, Customer, Invoice, InvoiceLine, Payment, Shipment, ShipmentDocument, DispatchRequest, EthanolContract, EthanolLifting, Transporter, TransporterPayment, FreightInquiry, FreightQuotation, Product

## Sales Channels
1. **Job work (Mash Bio)**: Rs 14/BL conversion charge — Mash Bio supplies molasses, MSPIL converts to ethanol
2. **Fixed price party sales**: e.g., Rs 60/L with SM Primal — direct ethanol sales
3. **OMC contracts**: JioBP, Nayara, PSU OMCs — government-regulated pricing via EthanolContract

## Order-to-Cash Flow
```
EthanolContract → SalesOrder → DispatchRequest → Shipment → Invoice → Payment
```

1. **EthanolContract**: Defines customer, quantity (KL), rate, validity, OMC allocation
2. **SalesOrder**: Created against contract (or standalone), has SalesOrderLine items
3. **DispatchRequest**: 5-step workflow:
   - NEW → APPROVED → TRUCK_ASSIGNED → DISPATCHED → DELIVERED
   - Each step has status validation — don't skip steps
4. **Shipment**: Physical truck movement
   - Weighing (gross → tare → net)
   - Gate pass generation
   - E-way bill via ewayBill.ts service
   - E-invoice (IRN) via eInvoice.ts service
5. **Invoice**: Generated from shipment data, has InvoiceLine items
6. **Payment**: Recorded against invoices

## E-Invoice & E-Way Bill (Saral GSP API)
- E-invoice generates IRN (Invoice Reference Number) — required by GST law
- E-way bill required for goods movement > Rs 50,000
- Both have sandbox and production modes (controlled by env/config)
- GSTIN: Use `COMPANY.gstin` from `shared/config/company.ts` — never hardcode
- Company address: Use `COMPANY.address` — never hardcode

## Critical Issues
- **shipments.ts** is 1,137 lines — the largest route file. Be careful with edits.
- **DispatchRequest** workflow must validate current status before advancing — don't allow NEW → DISPATCHED
- **JWT tokens in URLs**: PDF download URLs pass token as query param — use blob fetch instead
- **FreightManagement.tsx** is 1,874 lines — the largest frontend file

## Indexes
- Shipment: [date], [status], [dispatchRequestId]
- Invoice: [customerId], [status], [shipmentId]
- SalesOrder: [customerId], [status]
