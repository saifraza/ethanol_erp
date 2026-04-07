# Accounts Module

## Overview
Full double-entry accounting system with auto-journal generation, bank payment automation, and GST compliance reporting.

## Chart of Accounts (COA)
- Multi-level hierarchy (parent-child)
- Account types: ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
- Tree view and flat view in UI
- Each account has: code, name, type, parent, isActive

## Journal Entries
- Manual and auto-generated (from business transactions)
- Status: DRAFT → POSTED
- Each entry has debit/credit lines that must balance
- Reference fields link back to source document (PO, Invoice, etc.)

## Auto-Journal Rules

| Transaction | Debit | Credit |
|-------------|-------|--------|
| Sale Invoice | Trade Receivable | Sales Revenue + GST Output (CGST/SGST/IGST) |
| GRN Confirmed | Inventory (or Expense) | Trade Payable + GST Input |
| Vendor Payment | Trade Payable | Bank/Cash |
| Sale Payment | Bank/Cash | Trade Receivable |
| Stock Movement | Inventory/COGS | Inventory/WIP |

## Bank Payments (H2H Automation)
- **Batch processing**: Multiple vendor payments grouped into one batch
- **Approval workflow**: MAKER creates → CHECKER reviews → RELEASER approves
- **PIN verification** at each step (PaymentPin model)
- **File generation**: Encrypted STP file (ACH/NEFT/RTGS format)
- **Upload**: SFTP to UBI bank server
- **Audit trail**: BankPaymentAudit records every status change with userId + timestamp

## Bank Reconciliation
- Import bank statements
- Auto-match transactions by reference/amount/date
- Manual matching for unmatched items
- Cleared date tracking on BankTransaction

## Reports (18 pages)

### Transaction Reports
- **Cash Book** — Cash transactions journal
- **Bank Book** — Bank transactions journal
- **Day Book** — All transactions for a date range

### Financial Statements
- **Trial Balance** — All account balances
- **Profit & Loss** — Revenue vs expenses
- **Balance Sheet** — Assets, liabilities, equity

### Account Views
- **Ledger** — Transaction history per account
- **Chart of Accounts** — Full GL hierarchy

### Tax & Compliance
- **GST Summary** — Input/output GST, net liability
- **Taxes** — TDS, GST, other tax summaries

### Payment Management
- **Payments In** — Customer receipts
- **Payments Out** — Vendor/expense payments
- **Cash Vouchers** — Cash payment vouchers
- **Bank Payments** — Batch payment processing
- **PDC Register** — Post-dated cheques (PENDING/CLEARED/BOUNCED)
- **Bank Loans** — Loan tracking with repayment schedule
- **Bank Reconciliation** — Statement matching

## User Roles in Accounts
- **ACCOUNTANT** — Journal entry, ledger, reports
- **MAKER** — Create bank payment batches
- **CHECKER** — Review and approve
- **RELEASER** — Execute/release payments
