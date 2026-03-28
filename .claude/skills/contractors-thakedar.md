# Contractors (Thakedar) Module — Spec

## Overview
Track informal contractors ("thakedars") who work at the factory — mechanical, civil, manpower providers, electricians, etc. These are not registered vendors with GST invoices. They get paid variable amounts in cash or bank transfer based on work done. The ERP needs to track:
- Who they are (name, phone, trade, bank details)
- What work they did (work entries with dates, descriptions, amounts)
- What we paid them (payment log with mode, reference)
- Outstanding balance (work done minus payments)
- Monthly/weekly summaries

## Why Not Use Vendor Module?
- Vendors are formal entities with GST, POs, invoices, GRN
- Thakedars are informal — no GST, no PO, no invoice
- Payments are cash/UPI on the spot or weekly
- Need a simple, fast UI for plant managers to log work and payments

## Prisma Models

### Contractor
```prisma
model Contractor {
  id            String   @id @default(uuid())
  name          String                          // "Raju Thakedar", "Khan Bhai"
  phone         String?
  trade         String   @default("GENERAL")    // MECHANICAL, CIVIL, ELECTRICAL, MANPOWER, WELDING, PAINTING, GENERAL
  bankName      String?
  bankAccount   String?
  bankIfsc      String?
  upiId         String?
  aadhaar       String?                         // for compliance
  address       String?
  isActive      Boolean  @default(true)
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workEntries   ContractorWork[]
  payments      ContractorPayment[]

  @@index([trade])
  @@index([isActive])
}
```

### ContractorWork
```prisma
model ContractorWork {
  id            String   @id @default(uuid())
  contractorId  String
  contractor    Contractor @relation(fields: [contractorId], references: [id])
  date          DateTime
  description   String                          // "Boiler pipe welding", "Labour 5 men x 2 days"
  area          String?                         // Plant area: "Boiler", "Fermentation", "Civil"
  amount        Float                           // agreed amount for this work
  status        String   @default("PENDING")    // PENDING, APPROVED, DISPUTED, CANCELLED
  approvedBy    String?                         // who approved this work entry
  remarks       String?
  userId        String                          // who logged this entry
  createdAt     DateTime @default(now())

  @@index([contractorId])
  @@index([date])
  @@index([status])
}
```

### ContractorPayment
```prisma
model ContractorPayment {
  id            String   @id @default(uuid())
  contractorId  String
  contractor    Contractor @relation(fields: [contractorId], references: [id])
  date          DateTime
  amount        Float
  mode          String   @default("CASH")       // CASH, UPI, NEFT, RTGS, CHEQUE
  reference     String?                         // UTR, cheque no, UPI ref
  paidBy        String?                         // who handed over the cash
  remarks       String?
  userId        String
  createdAt     DateTime @default(now())

  @@index([contractorId])
  @@index([date])
  @@index([mode])
}
```

## Backend Routes (`backend/src/routes/contractors.ts`)

### Contractor CRUD
- `GET /` — List all contractors (filterable by trade, isActive)
- `GET /:id` — Contractor detail with work entries + payments + balance
- `POST /` — Create contractor
- `PUT /:id` — Update contractor
- `PATCH /:id/deactivate` — Soft delete

### Work Entries
- `GET /:id/work` — List work entries for a contractor
- `POST /:id/work` — Log new work entry
- `PUT /work/:workId` — Update work entry (before approval)
- `PATCH /work/:workId/approve` — Approve work entry

### Payments
- `GET /:id/payments` — List payments for a contractor
- `POST /:id/pay` — Record payment

### Dashboard/Reports
- `GET /dashboard` — Summary: total contractors, total outstanding, payments this month
- `GET /outstanding` — All contractors with outstanding balances

## Frontend Page (`frontend/src/pages/process/Contractors.tsx`)

### UI Style: Tier 2 SAP (enterprise back-office)
Use all SAP design tokens from CLAUDE.md.

### Page Layout
1. **Toolbar**: "CONTRACTORS | Thakedar Management"
2. **Filter bar**: Trade dropdown, Active/All toggle, search by name
3. **KPI strip**: Total Contractors | Active | Total Outstanding | Paid This Month
4. **Contractor table**: Name, Trade, Phone, Work Total, Paid Total, Outstanding, Actions
5. **Click row → Detail panel** (slide-in or modal):
   - Contractor info (name, phone, bank, UPI)
   - Work entries table (date, description, area, amount, status)
   - Payments table (date, amount, mode, reference)
   - Balance summary
   - Quick buttons: "+ Log Work", "+ Record Payment"

### Quick Actions
- "+ New Contractor" button in toolbar
- "+ Log Work" — simple form: date, description, area, amount
- "+ Pay" — form: amount, mode (cash/UPI/NEFT), reference

## Route Registration
- Import in `app.ts`: `import contractorRoutes from './routes/contractors';`
- Register: `app.use('/api/contractors', contractorRoutes);`

## Frontend Route
- Add to `App.tsx`: `<Route path="/process/contractors" element={<Contractors />} />`
- Add to sidebar under PLANT section or a new "HQ" section

## Integration Points
- **Cash Voucher module**: When paying a contractor in cash, optionally create a CashVoucher entry
- **Journal Entry**: Auto-create journal entry on payment (debit: Contractor Expense, credit: Cash/Bank)
- **WhatsApp**: Send payment confirmation to contractor's phone (future)

## Trade Categories
- MECHANICAL — pipe fitting, welding, machine repair
- CIVIL — construction, masonry, painting
- ELECTRICAL — wiring, panel work
- MANPOWER — daily labour supply
- WELDING — specialized welding work
- PAINTING — painting, coating
- GENERAL — misc work
