# Contractors (Thakedar) Module — Spec

## Overview
Track informal contractors ("thakedars") at the factory — mechanical, civil, manpower, electricians, welders, etc. NOT formal vendors (no GST, no PO, no invoice). Simple profile + payment history.

**Key insight**: Contractor payments are open-ended. There's no "invoice" or "outstanding balance" to track. The team just says "pay civil guy 1 lakh" and it gets done. So this module is a **directory + payment ledger**, not an accounts payable system.

## Design Philosophy
- Contractor profiles live here (who they are, what trade)
- Payments to contractors go through the **unified Payments Out** module (same as vendor/transporter payments)
- Work notes are optional free-text, not linked to amounts
- No outstanding balance, no approval flow, no invoice matching

## Prisma Model

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
  aadhaar       String?
  address       String?
  isActive      Boolean  @default(true)
  notes         String?                         // free-text: current work, special notes
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([trade])
  @@index([isActive])
}
```

No separate ContractorWork or ContractorPayment models. Payments are recorded in the unified payment system (future Payments Out module) with `payeeType: 'CONTRACTOR'` and `payeeId: contractor.id`.

## Backend Routes (`backend/src/routes/contractors.ts`)

- `GET /` — List contractors (filterable by trade, isActive, search by name)
- `GET /:id` — Contractor detail
- `POST /` — Create contractor
- `PUT /:id` — Update contractor
- `PATCH /:id/deactivate` — Soft deactivate
- `PATCH /:id/activate` — Reactivate

## Frontend Page (`frontend/src/pages/process/Contractors.tsx`)

### UI Style: Tier 2 SAP
Simple directory page:

1. **Toolbar**: "CONTRACTORS | Thakedar Directory"
2. **Filter bar**: Trade dropdown, Active/All toggle, name search
3. **KPI strip**: Total | Active | By Trade (Mechanical: X, Civil: Y, ...)
4. **Table**: Name, Trade, Phone, UPI/Bank, Notes, Actions (Edit)
5. **Add/Edit modal**: Name, phone, trade, bank details, UPI, notes

## Trade Categories
- MECHANICAL — pipe fitting, machine repair
- CIVIL — construction, masonry
- ELECTRICAL — wiring, panel work
- MANPOWER — daily labour supply
- WELDING — specialized welding
- PAINTING — painting, coating
- GENERAL — misc work

## Unified Payments Out (future)
When the Payments Out module is built, contractor payments will be recorded there:
- Payee type: CONTRACTOR
- Payee: selected from contractor directory
- Amount, mode (CASH/UPI/NEFT), reference, date, purpose
- View all payments to a contractor from their profile page

Until then, cash vouchers (`CashVoucher` model) can be used to track payments with the contractor's name in the `payeeName` field.

## Route Registration
- `app.ts`: `app.use('/api/contractors', contractorRoutes);`
- `App.tsx`: `<Route path="/process/contractors" element={<Contractors />} />`
- Sidebar: Under PLANT section or new "HQ" section
