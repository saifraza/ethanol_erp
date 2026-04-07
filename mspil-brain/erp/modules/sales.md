# Sales Module

## Workflow

```
Sales Order → Dispatch Request → Shipment → e-Way Bill + e-Invoice → Payment
    (SO)           (DR)                        (GST compliance)
```

## Sales Order
- orderNo (auto-increment), customer, product lines
- Status: DRAFT → CONFIRMED → SHIPPED → INVOICED
- Payment terms set per order (PREPAID, CASH, NET7, NET15, NET30, NET45, NET60)
- Customer credit limit checked before confirmation

## Dispatch Request
- Created from confirmed sales order
- Status: PENDING → APPROVED → DISPATCHED
- Includes: signature, seal, loading details
- Approval required before truck can be loaded

## Shipment
- Tracks the physical movement of goods
- Links to: dispatch request, transporter, gate entry
- Status: IN_TRANSIT → DELIVERED
- Generates documents: Challan (DC-{shipmentNo}), Gate Pass (GP-{shipmentNo})
- Waybill tracking number

## Shipment Documents
- Types: CHALLAN, INVOICE, E_WAY_BILL
- Each uploaded and indexed in LightRAG
- e-Way Bill auto-generated via Saral GSP for interstate/high-value goods
- e-Invoice (IRN) auto-generated for B2B sales

## Invoice
- invoiceNo (auto-increment), linked to sales order
- GST calculation: CGST+SGST (intra-state) or IGST (inter-state)
- Status: DRAFT → ISSUED → PAID
- IRN (Invoice Reference Number) from NIC portal
- e-Way bill reference attached

## Payment Collection
- Against customer invoices
- Methods: CASH, CHEQUE, BANK transfer
- Payment status logic:
  - Advance-based terms (PREPAID, CASH): `paymentStatus: PENDING` — must pay before shipment exits gate
  - Credit-based terms (NET7-NET60): `paymentStatus: NOT_REQUIRED` — ship freely, collect later

## Customer Master
- name, email, phone, GST, state
- Credit limit, payment terms
- Billing + shipping addresses

## Freight Management
- Freight inquiry sent to transporters
- Multiple quotations received
- Best quote accepted
- Transporter payment tracked separately

## Ethanol Contracts
- Long-term supply contracts with buyers
- contractNo, buyerId, volumeKL, ratePerKL, delivery dates
- Liftings tracked per contract (date, volume, invoice)
- Status tracking for contract fulfillment

## Direct Sale (Spot)
- Quick sale without SO process
- partyName, qty, rate, amount, date
- For ad-hoc/gate sales

## Auto-Journal Entries
- Sale Invoice → Dr Trade Receivable, Cr Sales Revenue + GST Output
- Sale Payment → Dr Bank/Cash, Cr Trade Receivable
