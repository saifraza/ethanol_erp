# Session State — Last Updated 2026-03-25

## Accounts Module — BUILT (Phase 1 Complete)
Full double-entry bookkeeping module built and ready for deployment.

### What was built:
1. **Prisma Models** (4 new): Account, JournalEntry, JournalLine, BankTransaction
2. **Backend Routes** (2 new files):
   - `routes/chartOfAccounts.ts` — CRUD, tree view, balances, seed endpoint
   - `routes/journalEntries.ts` — CRUD, daybook, ledger, trial balance, P&L, balance sheet, reversal
3. **Frontend Pages** (7 new files in `pages/accounts/`):
   - `ChartOfAccounts.tsx` — Tree + flat view, add/edit/deactivate, seed button, type filtering
   - `JournalEntry.tsx` — Create entries with multi-line debit/credit, expand to view lines, reverse
   - `Ledger.tsx` — Account-wise ledger with running balance, date filter
   - `TrialBalance.tsx` — Grouped by type, debit/credit columns, balanced indicator
   - `DayBook.tsx` — All entries for a date, prev/next navigation
   - `ProfitLoss.tsx` — Income vs Expense, FY/monthly presets, grouped by subType
   - `BalanceSheet.tsx` — Assets vs Liabilities+Equity, retained P&L, as-on-date
4. **Navigation** — 7 new items in accounts group (modules.ts), routes in App.tsx
5. **Seed Data** — 44 default accounts (Indian standard: 1xxx Assets, 2xxx Liabilities, 3xxx Income, 4xxx Expense, 5xxx Equity) with GST accounts (CGST/SGST/IGST input+output)
6. **Indian Law compliance** in seed data:
   - Separate CGST, SGST, IGST input credit accounts (1200-1202)
   - Separate CGST, SGST, IGST output tax accounts (2100-2102)
   - TDS Receivable and TDS Payable accounts
   - FY April-March date presets in P&L

### Integration points registered:
- `app.ts`: `/api/chart-of-accounts` and `/api/journal-entries`
- `modules.ts`: Chart of Accounts, Journal Entry, Ledger, Trial Balance, Day Book, P&L, Balance Sheet

### What's NOT yet built (Phase 2+):
- Auto-journal generation from sales/procurement events
- Bank Reconciliation (CSV upload + matching)
- GST Summary report (GSTR-3B format)
- Outstanding/Aging reports
- Cost center reporting
- WhatsApp integration (daily outstanding alerts)

## Recent Changes (uncommitted — need git push from Mac)
All previous changes from last session PLUS:
1. **CLAUDE.md** — Added WhatsApp-first design principles, module build approach, IST timezone pattern, WhatsApp integration table
2. **Full Accounts Module** — Schema, seed, routes, 7 frontend pages, navigation
3. **session-state.md** — Updated with current status

### Files changed:
- `backend/prisma/schema.prisma` — Added Account, JournalEntry, JournalLine, BankTransaction models
- `backend/src/app.ts` — Registered chartOfAccounts and journalEntries routes
- `backend/src/routes/chartOfAccounts.ts` — NEW
- `backend/src/routes/journalEntries.ts` — NEW
- `frontend/src/App.tsx` — Added 7 lazy-loaded account page routes
- `frontend/src/config/modules.ts` — Added 7 accounts nav items + icons
- `frontend/src/pages/accounts/ChartOfAccounts.tsx` — NEW
- `frontend/src/pages/accounts/JournalEntry.tsx` — NEW
- `frontend/src/pages/accounts/Ledger.tsx` — NEW
- `frontend/src/pages/accounts/TrialBalance.tsx` — NEW
- `frontend/src/pages/accounts/DayBook.tsx` — NEW
- `frontend/src/pages/accounts/ProfitLoss.tsx` — NEW
- `frontend/src/pages/accounts/BalanceSheet.tsx` — NEW
- `CLAUDE.md` — WhatsApp-first design, module build approach
- `.claude/skills/session-state.md` — This file

## Git Push Command (run on Mac)
```bash
rm -f .git/HEAD.lock && git add -A && git commit -m "Add full accounts module: Chart of Accounts, Journal Entries, Ledger, Trial Balance, Day Book, P&L, Balance Sheet with Indian GST accounts" && git push origin main
```

## Already Pushed (deployed on Railway)
- Commit `28b09e6`: DDGS time window, group sharing, server IST, BW header
- Commit `35a8a1b`: IST timezone for all backend times
- Commit `1ebdfa7`: BW share fix, multi-number phones, DDGS private-only, IST timezone
- Commit `1eb4a57`: setupGravity source, DDGS Hindi bot, fermentation timestamps

## Known Issues
- `backend/src/routes/dashboard.ts` has ~182 pre-existing TS errors (implicit `any` types) — not blocking deployment
- Sandbox can't `git push` or remove `.git/HEAD.lock` — user must push from Mac
- Sandbox can't `npx prisma generate` — TS errors for new Account/JournalEntry models show in sandbox but resolve on Railway after `prisma generate`

## Next Planned Work
1. **Accounts Phase 2** — Auto-journal generation from sales/procurement events
2. **Accounts Phase 3** — Bank Reconciliation, GST Summary (GSTR-3B), Outstanding reports
3. **Inventory upgrade** — GRN linkage, batch tracking, HSN codes, project standards
4. **Utilities module** — steam, power, water tracking
5. **Maintenance module** — equipment, PM schedules, breakdowns

## User Preferences
- Saif (saifraza9@gmail.com) — technically smart, prefers concise answers
- Hindi prompts for DDGS bot (default), English toggle available
- IST timezone (UTC+5:30) for all time displays
- Railway auto-deploys from GitHub main branch
- User must run `rm -f .git/HEAD.lock` before git operations on Mac
- Build modules sequentially (not parallel agents) — modules are interlinked
- Always create skill file FIRST before building a module
- WhatsApp integration is core — every module should consider it
