# Accounts Module — Claude Code Skill

## Purpose
Central financial control module for MSPIL Distillery ERP. Handles payment confirmations (gates physical release of trucks), receivables, collections tracking, and will expand to cover payables, costing, and ledgers.

## Architecture

### Backend Route: `backend/src/routes/accounts.ts`
Registered in `app.ts` as `/api/accounts`.

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/pending` | Shipments with `paymentStatus=PENDING` (enriched with order rate, expected amount) |
| GET | `/dashboard` | Today's collections summary, mode breakdown, pending count, recent 30 confirmed |
| GET | `/:id/history` | Full shipment history with timeline (order → weighing → invoice → payment → EWB → release) |
| POST | `/:id/confirm-payment` | Accounts confirms payment: sets mode, ref, amount, status=CONFIRMED |
| DELETE | `/:id/payment` | Revoke confirmed payment (resets to PENDING). Blocked if EWB already generated. |

### Frontend Page: `frontend/src/pages/accounts/PaymentDashboard.tsx`
Route: `/accounts/payments` — Lazy-loaded in `App.tsx`.

**Key Features:**
- KPI strip: pending count, today's total, mode breakdown
- Two tabs: Awaiting (pending) and Confirmed (recent)
- Pending tab: table with inline expand payment form (mode, UTR, amount)
- Confirmed tab: table with revoke button (disabled if EWB generated)
- History drawer: right-side panel with full shipment details, order info, documents, timeline
- Click any vehicle number to open history

### Module Config: `frontend/src/config/modules.ts`
Group: `accounts` — contains:
- `payment-desk` → Payment Desk (the main page)
- `invoices` → Sales Billing (moved from sales group)
- `payments` → Collections (moved from sales group)
- `vendor-invoices` → Supplier Bills (moved from procurement group)
- `vendor-payments` → Supplier Payments (moved from procurement group)

### Sidebar: `frontend/src/components/Layout.tsx`
Collapsible "Accounts" section with `accountsNav` from modules config.

## Payment Flow (DDGS Sales)

```
SalesOrder (paymentTerms: ADVANCE/COD/NET7/NET15/NET30)
  → DispatchRequest
    → Shipment created (inherits paymentTerms)
      ├─ ADVANCE/COD → paymentStatus = "PENDING"
      └─ NET7/NET15/NET30 → paymentStatus = "NOT_REQUIRED"

For PENDING shipments:
  1. Factory: weighs truck, generates invoice (IRN)
  2. Factory: sees "Awaiting Payment" badge (cannot generate EWB)
  3. Accounts: opens Payment Desk → confirms with mode/UTR/amount
  4. Backend: sets paymentStatus = "CONFIRMED"
  5. Factory: EWB button unlocks → generates e-way bill → releases truck
```

## Prisma Schema (Shipment model fields)
```prisma
// ── Payment gate (for ADVANCE / COD orders) ──
paymentTerms    String?          // inherited from SalesOrder
paymentStatus   String  @default("PENDING")  // PENDING, CONFIRMED, NOT_REQUIRED
paymentMode     String?          // CASH, UPI, NEFT, RTGS, CHEQUE, BANK_TRANSFER
paymentRef      String?          // UTR / cheque no / transaction ID
paymentAmount   Float?
paymentConfirmedAt DateTime?
paymentConfirmedBy String?       // userId who confirmed
@@index([paymentStatus])
```

## Payment Modes
`CASH`, `UPI`, `NEFT`, `RTGS`, `CHEQUE`, `BANK_TRANSFER`

## Expected Amount Calculation
```
netMT = weightNet / 1000
line = order.lines[0]
taxable = netMT × line.rate
gst = taxable × line.gstPercent / 100
expectedAmount = taxable + gst
```

## Business Rules
1. **Separation of duties**: Factory handles physical ops (weighing, loading, release). Accounts handles financial ops (payment confirmation).
2. **Payment blocks EWB**: Cannot generate e-way bill if `paymentStatus === 'PENDING'`. Backend enforces in both `PUT /:id/status` (RELEASED) and `POST /:id/eway-bill`.
3. **Revoke restrictions**: Cannot revoke a confirmed payment if EWB has been generated against it.
4. **Credit terms bypass**: Orders with NET7/NET15/NET30 auto-set `paymentStatus = 'NOT_REQUIRED'` on shipment creation — no payment gate.
5. **Auto-refresh**: Payment Desk polls every 30 seconds.

## Shipments Page Integration
`frontend/src/pages/sales/Shipments.tsx` shows:
- "Awaiting Payment" pulsing yellow badge for PENDING shipments
- EWB button greyed out with tooltip when payment pending
- Release button disabled when payment pending
- No payment confirmation UI on Shipments page (moved to Accounts)

## Critical Rules
- Always use `asyncHandler` from `../shared/middleware` for route handlers
- Always use `AuthRequest` type for authenticated routes
- Always use `NotFoundError` for missing resources
- Revoke endpoint must check `ewayBill` field before allowing reset
- Never expose raw error messages — use structured error responses
- Expected amount is a frontend calculation aid, not authoritative billing amount

## Future Expansion
This module will grow to include:
- **Receivables aging** — track overdue NET7/15/30 payments
- **Customer ledger** — running account per buyer
- **Daily collection report** — printable summary for management
- **Procurement payables** — vendor invoice approvals, payment scheduling
- **Plant costing** — per-batch production cost (grain + chemicals + power)
- **Bank reconciliation** — match UTRs against bank statements
