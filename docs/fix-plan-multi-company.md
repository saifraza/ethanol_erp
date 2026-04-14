# Multi-Company Fix Plan — Post Audit 2026-04-13

## CRITICAL SAFETY RULE
**The ERP is LIVE. Trucks are weighing, POs are being created, invoices are being generated RIGHT NOW.**
**Every change must be ADDITIVE — never remove, rename, or break existing fields/endpoints.**
**Run `./scripts/smoke-test.sh` after every change. Do NOT push to main without it passing.**

---

## Session 1: Schema + Company Config (SAFE — additive only)

### Step 1: Add companyId to 4 missing dispatch models
**Risk: ZERO** — adding a nullable field never breaks existing code.

```prisma
// Add to backend/prisma/schema.prisma — ALL fields are String? (nullable)
// Existing rows get null, which is fine — they're all MSPIL anyway

model DispatchTruck {
  // ... existing fields ...
  companyId String?   // ADD THIS
}

model DDGSDispatchTruck {
  // ... existing fields ...
  companyId String?   // ADD THIS (if not already there)
}

model SugarDispatchTruck {
  // ... existing fields ...
  companyId String?   // ADD THIS
}

model TransporterPayment {
  // ... existing fields ...
  companyId String?   // ADD THIS
}
```

Then:
```bash
cd backend && npx prisma db push    # adds columns, no data loss
./scripts/smoke-test.sh             # verify nothing broke
```

**DO NOT** use `--accept-data-loss`. If prisma asks for it, STOP and investigate.

### Step 2: Add @relation to orphaned companyId fields
**Risk: LOW** — adding relations to existing fields. But do ONE model at a time and test.

The 13 models with `companyId String?` but no `@relation`:
- Account, PurchaseOrder, GoodsReceipt, JournalEntry, VendorInvoice, VendorPayment, Invoice, Payment, GrainTruck, EthanolContract, Vendor, CashVoucher, BankLoan

```prisma
// Example — do this for each model:
model PurchaseOrder {
  // ... existing ...
  companyId String?
  company   Company? @relation("CompanyPurchaseOrders", fields: [companyId], references: [id])  // ADD
}

// And on Company model, add the back-relation:
model Company {
  // ... existing ...
  purchaseOrders PurchaseOrder[] @relation("CompanyPurchaseOrders")  // ADD
}
```

**WARNING:** Do these in small batches (3-4 models per push). Run `prisma validate` after each batch.

### Step 3: Make company.ts DB-backed
**Risk: LOW** — this is a NEW function, doesn't change existing `COMPANY` constant.

```typescript
// Add to shared/config/company.ts — DON'T remove the existing COMPANY constant
// Existing code still uses COMPANY (works for MSPIL). New code uses getCompanyById().

export async function getCompanyById(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return COMPANY; // fallback to MSPIL
  return {
    name: company.name,
    gstin: company.gstin,
    address: { ... },
    bank: { ... },
  };
}
```

**The old `COMPANY` constant stays.** It's the MSPIL fallback. New multi-company code calls `getCompanyById()`.

After Step 3: `./scripts/smoke-test.sh` — should pass cleanly since nothing existing changed.

---

## Session 2: Wire companyId into Services (SAFE — additive params with defaults)

### Step 4: autoJournal.ts — add companyId parameter
**Risk: LOW** — add optional param with MSPIL default. Existing callers don't break.

```typescript
// Change function signatures from:
export async function onStockMovement(prisma: any, data: { ... }) {
// To:
export async function onStockMovement(prisma: any, data: { ..., companyId?: string }) {
  const cid = data.companyId || 'b499264a-8c73-4595-ab9b-7dc58f58c4d2'; // MSPIL fallback
  // ... use cid in journalEntry.create({ data: { companyId: cid, ... } })
}
```

Do this for ALL 10 `onXxx()` functions. Existing callers pass nothing → get MSPIL default → no change in behavior.

### Step 5: eInvoice.ts — add companyId parameter
**Risk: MEDIUM** — e-invoice affects GST filing. Test thoroughly.

```typescript
// Change buildIRNPayload to accept companyId:
export async function generateIRN(invoice: any, companyId?: string) {
  const company = await getCompanyById(companyId || invoice.companyId);
  // Use company.gstin, company.name, company.address instead of hardcoded
}
```

**TEST:** Generate a test IRN on the Saral sandbox (not production) before pushing.

### Step 6: ewayBill.ts — same pattern as eInvoice

After Session 2: `./scripts/smoke-test.sh` + manually test one PO creation, one GRN, one invoice to verify nothing broke.

---

## Session 3: Sweep GET Endpoints (SAFE — only adds WHERE clauses)

### Step 7: Add getCompanyFilter to all GET list endpoints
**Risk: LOW for MSPIL users** — `getCompanyFilter` returns `{}` for MSPIL (sees everything, same as before). Only affects MAEL/MGAL users who will now see scoped data.

Priority order (fix most-used endpoints first):
1. accountsReports.ts — cash-book, bank-book, GST summary, customer/vendor ledger
2. vendorInvoices.ts — outstanding, ITC report
3. vendorPayments.ts — outstanding, TDS report, bank file generation
4. accounts.ts — pending shipments, dashboard
5. inventoryStock.ts — stock levels, valuation, ABC analysis
6. unifiedPayments.ts — transporter/contractor payments
7. shipments.ts — active shipments
8. All remaining GET endpoints

**Pattern for each fix:**
```typescript
// Before:
const items = await prisma.model.findMany({ where: { status: 'ACTIVE' } });

// After:
const items = await prisma.model.findMany({
  where: { status: 'ACTIVE', ...getCompanyFilter(req) },
});
```

### Step 8: Add getActiveCompanyId to all POST endpoints
Same pattern — add `companyId: getActiveCompanyId(req)` to every `create()` call that doesn't already have it.

### Step 9: Add companyId to factory cached models
```prisma
// factory-server/prisma/schema.prisma
model CachedPurchaseOrder {
  // ... existing ...
  companyId    String?   // ADD
  companyCode  String?   // ADD (for display: "MSPIL", "MAEL")
}
model CachedSupplier {
  // ... existing ...
  companyId    String?   // ADD
}
```

Then update `masterDataCache.ts` to pull and cache companyId from cloud.
Then update factory gate entry UI to filter POs/suppliers by selected company.

**DEPLOY FACTORY WITH `./factory-server/scripts/deploy.sh`** — never manual SCP.

---

## Session 4: asyncHandler + Zod (SAFE — error handling improvement)

### Step 10: Wrap all handlers in asyncHandler
**Risk: ZERO** — asyncHandler catches errors that were already being caught. The only change is errors get sanitized instead of leaked.

```typescript
// Before:
router.get('/', async (req, res) => {
  try { ... } catch (err: any) { res.status(500).json({ error: err.message }) }
});

// After:
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  // ... same code, just remove try/catch
}));
```

Priority files (worst offenders):
1. salesOrders.ts (8 handlers)
2. invoices.ts (12 handlers)
3. shipments.ts (13 handlers)
4. freightInquiry.ts (8 handlers)
5. issues.ts (7 handlers)
6. All 16 process files

### Step 11: Add Zod validation to financial write paths
Priority (money at stake):
1. vendorInvoices.ts POST/PUT
2. vendorPayments.ts POST
3. invoices.ts POST/PUT
4. payments.ts POST
5. postDatedCheques.ts POST/PUT
6. purchaseOrders.ts POST/PUT

---

## DO NOT DO IN ANY SESSION

- Never rename existing fields — add new ones, backfill, then deprecate
- Never change field types (String → Enum) on live tables — add new enum field alongside
- Never use `--accept-data-loss` on Railway Prisma push
- Never modify factory-server without using deploy.sh
- Never stop Oracle, WtService, or any Windows service on factory
- Never push to main without smoke-test.sh passing
- Never change auth.ts getCompanyFilter behavior for MSPIL users (returns {} = sees all) until all endpoints are verified to work with company scoping

---

## Verification After Each Session

```bash
# 1. Compile check
./scripts/smoke-test.sh

# 2. Manual checks (do these in browser at app.mspil.in after push)
- Create a PO → verify companyId is set
- Push a weighment from factory → verify GRN created with companyId
- Generate an invoice PDF → verify correct company letterhead
- Check accounts reports → verify data is scoped

# 3. Factory check (after factory deploy)
curl -s http://100.126.101.7:5000/api/health
curl -s http://100.126.101.7:5000/api/master-data/status
```
