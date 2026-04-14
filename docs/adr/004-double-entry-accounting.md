# ADR 004: Double-Entry Accounting with Auto-Journal

**Status**: Accepted (2026-04)
**Decision**: Full double-entry GL with automated journal entries triggered by business events (GRN, invoice, payment, stock movement).

## Context
- Plant needs proper accounting for statutory audit (Indian Companies Act)
- Manual journal entry for every transaction is impractical
- Business events (receiving goods, dispatching ethanol, making payments) must create GL entries automatically

## Decision
- Chart of Accounts follows Indian standard structure (Assets, Liabilities, Income, Expense)
- `autoJournal.ts` service: `onStockMovement()`, `onSaleInvoiceCreated()`, etc. — fires GL entries automatically
- JournalEntry + JournalLine models (debit/credit must balance)
- Bank reconciliation against imported bank statements
- Multi-company support: each entry tagged with `companyId`

## Why NOT Alternatives
- **Single-entry cashbook**: Insufficient for statutory audit
- **External accounting software (Tally)**: Data silos — weighment → GRN → accounting needs to be one flow
- **Manual journal entries only**: Operators are not accountants — auto-journal prevents missing entries

## Consequences
- Every module that creates financial events must call the appropriate `autoJournal` function
- Weighbridge handlers (poInbound, ddgsOutbound) indirectly trigger GL via `syncToInventory` → `onStockMovement()`
- Bank payment batches (UBI H2H) create journal entries on confirmation
- Chart of Accounts must be seeded before accounting works
