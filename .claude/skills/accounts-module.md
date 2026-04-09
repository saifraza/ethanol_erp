# Accounts Module — MSPIL ERP

> Full spec for the double-entry accounting module. This file merges the former `accounts-module.md` (summary) and `accounts-full-module.md` (full spec).

---

## Part A — Module Summary (formerly accounts-module.md)

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

---

## Part B — Full Double-Entry Spec (formerly accounts-full-module.md)

# Full Accounts & Financial Module — Build Spec

## Status: PLANNED (not yet built)
## Priority: HIGH — next major module to build

## Overview
Complete double-entry bookkeeping system for MSPIL Distillery ERP. Integrates with existing sales, procurement, and production modules to auto-generate journal entries. Replaces manual Excel-based accounting.

## What EXISTS today (accounts-module.md)
- Payment Desk (confirm/revoke payments on DDGS shipments)
- Payment Dashboard (pending/confirmed tabs)
- Shipment payment flow (ADVANCE/COD/NET terms)
- Basic receivables tracking via Shipment.paymentStatus
- Customer invoices (e-invoice with IRN)
- Vendor invoices and vendor payments

## What NEEDS to be built

### Phase 1: Chart of Accounts & Ledgers
**Prisma Models:**
```prisma
model Account {
  id          String   @id @default(uuid())
  code        String   @unique          // e.g. "1001", "2001", "3001"
  name        String                     // e.g. "Cash in Hand", "SBI Current A/c"
  type        String                     // ASSET, LIABILITY, INCOME, EXPENSE, EQUITY
  subType     String?                    // CURRENT_ASSET, FIXED_ASSET, DIRECT_INCOME, etc.
  parentId    String?                    // for hierarchical chart
  parent      Account? @relation("AccountTree", fields: [parentId], references: [id])
  children    Account[] @relation("AccountTree")
  isSystem    Boolean  @default(false)   // system accounts can't be deleted
  isActive    Boolean  @default(true)
  openingBalance Float @default(0)
  journals    JournalLine[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([type])
  @@index([parentId])
}

model JournalEntry {
  id          String   @id @default(uuid())
  entryNo     Int      @unique @default(autoincrement())
  date        DateTime
  narration   String
  refType     String?                    // SALE, PURCHASE, PAYMENT, RECEIPT, CONTRA, JOURNAL
  refId       String?                    // FK to Invoice/VendorInvoice/Payment etc.
  isAutoGenerated Boolean @default(false)
  isReversed  Boolean  @default(false)
  reversalOf  String?                    // original entry ID if this is a reversal
  lines       JournalLine[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  userId      String
  @@index([date])
  @@index([refType, refId])
}

model JournalLine {
  id          String   @id @default(uuid())
  journalId   String
  journal     JournalEntry @relation(fields: [journalId], references: [id], onDelete: Cascade)
  accountId   String
  account     Account  @relation(fields: [accountId], references: [id])
  debit       Float    @default(0)
  credit      Float    @default(0)
  narration   String?
  costCenter  String?                    // DISTILLERY, BOILER, DDGS, ADMIN, etc.
  @@index([journalId])
  @@index([accountId])
}

model BankTransaction {
  id          String   @id @default(uuid())
  accountId   String                     // Bank account
  date        DateTime
  description String
  refNo       String?                    // cheque/UTR
  debit       Float    @default(0)
  credit      Float    @default(0)
  balance     Float    @default(0)
  isReconciled Boolean @default(false)
  reconciledWith String?                 // JournalEntry ID
  importBatch String?                    // batch ID for CSV imports
  createdAt   DateTime @default(now())
  @@index([accountId, date])
  @@index([isReconciled])
}
```

### Phase 2: Auto Journal Entry Generation
When these events happen, auto-create journal entries:

| Event | Debit | Credit | Trigger |
|-------|-------|--------|---------|
| Sale Invoice | Customer A/c (Receivable) | Sales A/c + GST Payable | Invoice creation |
| Sale Payment Received | Bank/Cash A/c | Customer A/c | Payment confirmation |
| Purchase GRN | Purchase A/c + GST Input | Vendor A/c (Payable) | GRN creation |
| Vendor Payment | Vendor A/c | Bank A/c + TDS Payable | Vendor payment |
| Contra (cash→bank) | Bank A/c | Cash A/c | Manual entry |

### Phase 3: Reports
- **Ledger View** — account-wise with opening/closing balance, date filter
- **Trial Balance** — all accounts, debit/credit totals, net balance
- **P&L Statement** — income vs expense accounts, period comparison
- **Balance Sheet** — assets vs liabilities + equity
- **Day Book** — all journal entries for a date
- **Cash/Bank Book** — filtered ledger for cash/bank accounts
- **Outstanding Report** — receivables aging (0-30, 30-60, 60-90, 90+ days)
- **GST Summary** — output tax vs input tax for GSTR-3B filing

### Phase 4: Bank Reconciliation
- CSV upload of bank statement
- Auto-match by UTR/amount/date
- Manual match for unmatched items
- Reconciliation report with unreconciled items

## Default Chart of Accounts (Seed Data)
```
ASSETS (1xxx)
  1001 Cash in Hand
  1002 SBI Current Account
  1003 HDFC Current Account
  1100 Accounts Receivable (Control)
  1200 GST Input Credit
  1300 TDS Receivable
  1400 Inventory - Raw Materials
  1401 Inventory - Ethanol
  1402 Inventory - DDGS
  1500 Fixed Assets
  1501 Plant & Machinery
  1502 Land & Building

LIABILITIES (2xxx)
  2001 Accounts Payable (Control)
  2100 GST Output Tax (CGST)
  2101 GST Output Tax (SGST)
  2102 GST Output Tax (IGST)
  2200 TDS Payable
  2300 Employee Payables
  2400 Loans

INCOME (3xxx)
  3001 Ethanol Sales
  3002 DDGS Sales
  3003 Other Income
  3004 Interest Income

EXPENSE (4xxx)
  4001 Raw Material - Grain
  4002 Raw Material - Chemicals
  4003 Utilities - Power
  4004 Utilities - Steam/Coal
  4005 Utilities - Water
  4010 Freight & Transport
  4020 Salary & Wages
  4030 Repairs & Maintenance
  4040 Administrative Expenses
  4050 Depreciation

EQUITY (5xxx)
  5001 Capital Account
  5002 Retained Earnings
```

## Backend Routes Plan
```
backend/src/routes/accounts/
  ├── chartOfAccounts.ts   # CRUD for accounts
  ├── journalEntries.ts    # Manual + auto journal entries
  ├── ledger.ts            # Ledger view, trial balance
  ├── reports.ts           # P&L, Balance Sheet, Outstanding
  ├── bankRecon.ts         # Bank reconciliation
  └── index.ts             # Router aggregator
```

## Frontend Pages Plan
```
frontend/src/pages/accounts/
  ├── PaymentDashboard.tsx  # EXISTS — payment desk
  ├── ChartOfAccounts.tsx   # Account tree with add/edit
  ├── JournalEntry.tsx      # Create/view journal entries
  ├── Ledger.tsx            # Account ledger with date filter
  ├── TrialBalance.tsx      # Period trial balance
  ├── ProfitLoss.tsx        # Income statement
  ├── BalanceSheet.tsx      # Balance sheet
  ├── DayBook.tsx           # All entries for a date
  ├── Outstanding.tsx       # Receivables/Payables aging
  ├── BankRecon.tsx         # Bank reconciliation
  └── GSTSummary.tsx        # GST data for filing
```

## Integration Points
- `invoices.ts` → after creating invoice, call `createAutoJournal('SALE', invoiceId, ...)`
- `payments.ts` → after confirming payment, call `createAutoJournal('RECEIPT', paymentId, ...)`
- `goodsReceipts.ts` → after GRN, call `createAutoJournal('PURCHASE', grnId, ...)`
- `vendorPayments.ts` → after vendor payment, call `createAutoJournal('PAYMENT', vpId, ...)`

## Build Strategy
1. Schema + seed data (chart of accounts) — 1 session
2. Journal entry engine (auto + manual) — 1 session
3. Ledger + Trial Balance + Day Book — 1 session
4. P&L + Balance Sheet + Outstanding — 1 session
5. Bank Reconciliation + GST Summary — 1 session
6. Integration hooks into existing modules — 1 session

Each session reads this file, builds one phase, updates status.

## Technical Notes
- All amounts in INR (Float in Prisma, could upgrade to Decimal for precision)
- IST timezone: use `new Date(Date.now() + 5.5 * 60 * 60 * 1000)` pattern
- Journal entries are IMMUTABLE — to correct, create a reversal entry
- Auto-generated entries are marked `isAutoGenerated: true` — can't be manually edited
- Cost centers: DISTILLERY, BOILER, DDGS, ADMIN, TRANSPORT, MAINTENANCE
- Financial year: April 1 to March 31 (Indian standard)
