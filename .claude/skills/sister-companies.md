# Sister Companies — Multi-Company Corn Procurement

## Why This Exists

MSPIL buys corn (grain) for its distillery. However, some corn purchases are made **on behalf of sister companies** — MAEL and MGAL. These are LLPs related to MSPIL's promoters.

**The business flow:**
- A corn truck arrives at the MSPIL plant gate
- The operator selects **which company is buying** this truck (MSPIL, MAEL, or MGAL)
- Everything else is identical — same gate, same weighbridge, same unloading, same quality checks
- The only difference is the **buying entity** on the books
- In MSPIL's accounts, payments to MAEL/MGAL vendors appear as inter-company purchases
- MAEL and MGAL are also registered as **vendors** in MSPIL's vendor master

**Why separate companies?**
- Different GSTINs, different legal entities, different books
- MSPIL processes the corn regardless — it's the same plant
- But the purchase invoice, payment, and GST input credit go to the correct entity

## Companies

| Code | Legal Name | Short | GSTIN |
|------|-----------|-------|-------|
| MSPIL | Mahakaushal Sugar & Power Industries Ltd | MSPIL | 23AADCM0622N1Z0 |
| NARSINGHPUR LLP | Mahakaushal Agri Energy LLP | MAEL | 23ACAFM4843R1ZU |
| CHAAPARA LLP | Mahakaushal Green Agri LLP | MGAL | 23ACAFM4842Q1ZX |

## Login Credentials

| Company | Email | Password | Role |
|---------|-------|----------|------|
| MAEL | admin@mael.local | admin123 | ADMIN |
| MGAL | admin@mgal.local | admin123 | ADMIN |

## Architecture

### Key Files
- **Company model**: `backend/prisma/schema.prisma` (Company table)
- **Company CRUD**: `backend/src/routes/companies.ts`
- **Auth scoping**: `getCompanyFilter(req)` in `backend/src/middleware/auth.ts`
- **Frontend**: `frontend/src/pages/admin/Companies.tsx`
- **Gate entry selector**: `factory-server/frontend/src/pages/GateEntry.tsx` (company dropdown)
- **Sidebar filtering**: `frontend/src/components/Layout.tsx` (sister concern users see only enterprise modules)

### How Company Scoping Works
- `companyId` field on: User, Vendor, PurchaseOrder, GoodsReceipt, VendorInvoice, VendorPayment, GrainTruck, Account, JournalEntry
- JWT contains `companyId` + `companyCode`
- `getCompanyFilter(req)` returns `{ companyId }` for sister concern users, `{}` for MSPIL users
- **MSPIL users see ALL data** (no filter) — they run the plant
- **Sister concern users see only their company's data** + only enterprise modules (no plant modules)

### Gate Entry Flow
When a truck arrives:
1. Operator selects buying company from dropdown (MSPIL / MAEL / MGAL)
2. `companyId` is saved on the `GateEntry` record
3. Flows through to `GrainTruck` → `GoodsReceipt` → `VendorInvoice` → `VendorPayment`
4. All downstream records inherit the `companyId`

### Adding companyId to New Modules
When building new enterprise modules:
1. Add `companyId String?` to the Prisma model + relation to Company
2. Use `getCompanyFilter(req)` on list endpoints
3. Set `companyId` from `req.user.companyId` on create
4. Plant/process modules do NOT need company scoping
