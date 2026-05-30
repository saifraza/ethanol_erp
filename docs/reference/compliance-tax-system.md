# Compliance & Tax System — MSPIL ERP

> Master compliance skill. Merges former `compliance-tax-system.md` (master), 4 phase files, and `compliance-tax-rules-page.md`.

---

## Part A — Master Plan (formerly compliance-tax-system.md)

# Compliance & Tax System — Master Reference

**Status**: Design phase. Build NOW while transaction volume is low. Retrofitting later = painful.

**Scope**: Every Indian tax, levy, and statutory compliance obligation that applies to MSPIL (distillery, ethanol, DDGS, CBG, exports, payroll). This file is the single source of truth for tax rules. Module-specific enforcement lives in phase skill files.

---

## Why build this now
- Zero/low transaction data today → clean migration, no back-population pain
- Design decisions (master data shape, ledger structure, section mapping) lock downstream modules
- Once the ERP has thousands of invoices + vendors, every compliance gap becomes a manual reconciliation nightmare
- Income-tax Act 2025 kicks in 1-Apr-2026 with new section codes (392/393/394) — we get to skip the legacy
- GSTR-2B strict ITC matching from Apr 2026 → cannot be a bolt-on, must be a block at posting

## Design principles
1. **Block at source, not at return time**. Invalid transactions must not enter the DB.
2. **Master data is law**. One table per tax rule. No hard-coded rates anywhere.
3. **Every compliance field is audited** (who changed, when, old value, new value).
4. **Effective-dated everything** (rates, sections, HSN, thresholds). Never overwrite history.
5. **Computed, not typed**. TDS/GST amounts are computed from master + transaction, never entered by user.
6. **Maker-Checker-Releaser** for every tax-impact action (like UBI H2H).
7. **One tax ledger per head** — GST out, GST in, RCM, TDS payable (by section), TCS collected, PF, ESI, PT, advance tax, MAT credit.
8. **Returns are views, not entries**. GSTR-1/3B/2B/26Q generated from posted transactions, never edited directly.
9. **No backdated transactions** in closed periods. Closing a period is a hard lock.

---

## 1. Direct Taxes (CBDT)

### 1.1 Corporate Income Tax — Income-tax Act, 2025 (w.e.f. 1-Apr-2026)
| Item | Rate |
|---|---|
| Domestic co, turnover ≤ ₹400 Cr | 25% |
| Domestic co, turnover > ₹400 Cr | 30% |
| Sec 115BAA (optional, no MAT) | 22% |
| Sec 115BAB (new manufacturing) | 15% |
| **Surcharge** 0 / 7% / 12% at ₹1 Cr / ₹10 Cr bands |
| **HEC** 4% on (tax + surcharge) |
| **MAT** 15% of book profit (not if 115BAA/BAB) |

**MSPIL tax regime decision point**: 115BAB (15% for new manufacturing) likely best if CBG/ethanol expansion qualifies. Record choice in `ComplianceConfig.taxRegime`.

### 1.2 Advance Tax (companies)
| Instalment | Cumulative |
|---|---|
| 15-Jun | 15% |
| 15-Sep | 45% |
| 15-Dec | 75% |
| 15-Mar | 100% |

Interest u/s 234B (delay) and 234C (deferment) auto-compute.

### 1.3 TDS — new sections 392 / 393 / 394
Replacing old 194C/194I/194J/etc. Mapping table below. Implementation must store BOTH old + new for transition reporting.

| Old § | New § | Nature | Rate | Threshold (single/aggregate) |
|---|---|---|---|---|
| 194C | 393 | Contractor (incl. manpower) | 1% ind/HUF, 2% others | ₹30K / ₹1L |
| 194J | 393 | Professional / technical | 10% | ₹30K |
| 194I | 393 | Rent — plant/machinery | 2% | ₹2.4L |
| 194I | 393 | Rent — land/building | 10% | ₹2.4L |
| 194H | 393 | Commission/brokerage | 2% | ₹15K |
| 194A | 393 | Interest (non-bank) | 10% | ₹5K |
| 194Q | 393 | Purchase of goods | 0.1% | ₹50L (buyer AATO > ₹10 Cr) |
| 194IA | 393 | Property > ₹50L | 1% | ₹50L |
| 194T | new | Partner payments | 10% | — |

**PAN missing → flat 20%.**
**Non-filer (206AB) → 2× rate or 5% whichever higher.** Must check against IT Dept compliance API.
**Lower deduction cert (Form 13)** — auto-issue from 2026. Store cert no, rate, valid-from, valid-to per vendor.

### 1.4 TCS
| Section | Nature | Rate |
|---|---|---|
| 206C(1) | Scrap sale | 1% |
| 206C(1H) | Goods > ₹50L (seller AATO > ₹10 Cr) | 0.1% |

### 1.5 Compliance forms (renamed under IT Act 2025)
| Old | New | Purpose |
|---|---|---|
| Form 16 | **Form 130** | Annual salary TDS cert |
| Form 16A | **Form 131** | Quarterly vendor TDS cert |
| Form 27D | **Form 133** | TCS cert |
| 26Q | 26Q | Quarterly TDS return (non-salary) |
| 24Q | 24Q | Quarterly TDS return (salary) |
| 27EQ | 27EQ | Quarterly TCS return |
| ITR-6 | ITR-6 | Corporate annual return |
| 3CA/3CD | 3CA/3CD | Tax audit report |

**Due dates**: 7th of next month for deposit; end of month after quarter for return; 31-Oct (audited) or 31-Jul (non-audited) for ITR.

---

## 2. Indirect Taxes (CBIC / State)

### 2.1 GST
**Our products**:
| Item | HSN | Rate | Notes |
|---|---|---|---|
| Denatured ethanol (EBP) | 2207 20 | **5%** | Petrol blending — verify invoice narration |
| Denatured ethanol (industrial) | 2207 20 | 18% | |
| ENA undenatured | 2207 10 | **Outside GST** | State VAT only (SC 2024 + Council Oct 2024) |
| DDGS | 2303 30 | Nil / 5% | Branded packaged = 5% |
| Molasses (inward) | 1703 | 5% | Reduced from 28% |
| Maize / grain (inward) | 1005 | Nil | |
| CO₂ byproduct | 2811 | 18% | |
| Fusel oil | 3824 | 18% | |
| Job-work ethanol | 9988 42 | 5% | |
| Job-work DDGS | 9988 17 | 5% | |

**Returns**:
| Return | Freq | Due |
|---|---|---|
| GSTR-1 | Monthly | 11th |
| GSTR-3B | Monthly | 20th |
| GSTR-2B (view) | Monthly | 14th |
| ITC-04 (job-work) | Half-yearly | 25-Oct / 25-Apr |
| GSTR-9 | Annual | 31-Dec |
| GSTR-9C (AATO > ₹5 Cr) | Annual | 31-Dec |

**E-invoicing (IRN)**: mandatory > ₹5 Cr AATO. ≥ ₹10 Cr must upload within **30 days** of invoice date (IRP rejects otherwise). We already cross this threshold.

**E-way bill**: > ₹50K. MP intra-state also ₹50K.

**ITC rules**:
- From Apr 2026: strict GSTR-2B match. No provisional claims.
- Blocked credits u/s 17(5): motor vehicles, food/beverage, club, works contracts for immovable, personal use
- 180-day payment rule: unpaid vendor > 180 days → reverse ITC
- Time limit: ITC of FY must be claimed by 30-Nov of next FY or GSTR-9 filing, whichever earlier

**RCM (we pay as buyer)**:
- GTA (transporter) 5% / 12% forward-charge option
- Legal fees from advocates
- Director sitting fees
- Import of services
- Agri produce from unregistered farmers (2026 addition)
- Certain professional services from unregistered (2026 addition)

**LUT**: annual, before first export invoice of FY. Block export invoice if expired.

**Document series**: fresh on 1-Apr every year. Previous year continuation = scrutiny trigger.

### 2.2 State Excise (MP)
- Ethanol denatured export permit (PD-25)
- Molasses transport permit
- Storage licence (annual)
- Per-tanker permit fee
- Digital permit tracking (MPSEC portal)

### 2.3 Customs (if we import)
BCD + SWS + IGST. EPCG scheme for capital goods. Advance Authorisation if we export.

### 2.4 Stamp Duty
State subject (MP). Agreements, leases, POAs, loan docs.

---

## 3. Payroll & Labour

### 3.1 EPF
- Employee 12% + Employer 12% (basic + DA)
- Employer split: 8.33% EPS (capped ₹15K wage) + 3.67% EPF
- Admin 0.50% (min ₹500), EDLI 0.50%
- Due **15th** next month. ECR upload.

### 3.2 ESI
- Employees ≤ ₹21K/month (₹25K if disabled)
- Employee 0.75% + Employer 3.25% of gross
- Due **15th** next month
- Half-yearly return (May, Nov)

### 3.3 Professional Tax (MP)
- Max ₹2,500/year per employee, salary slab based
- Monthly deduct, monthly/quarterly pay
- Annual return

### 3.4 Labour Welfare Fund (MP)
- ~₹10-30/employee/half-year (Jun, Dec)

### 3.5 Gratuity
- Applicable: 10+ employees
- 15 days' wages × years of service
- **Post-2025 reform**: fixed-term employees eligible after **1 year** (was 5)
- Fund via LIC Group Gratuity OR balance sheet provision
- Actuarial valuation annual (Ind AS 19)

### 3.6 Bonus Act
- 20+ employees
- 8.33–20% of wages, min ₹100 / max ₹7,000 base
- Pay within 8 months of FY end
- Form D return

### 3.7 Labour Codes (when notified)
- **Basic + fixed ≥ 50% of CTC** → increases PF/gratuity base → employer cost ↑
- Plan salary structure accordingly

### 3.8 TDS on Salary (24Q)
- Monthly deduction per projected annual tax
- Quarterly return + annual **Form 130**

---

## 4. Other Statutory

### 4.1 ROC / MCA
| Form | Purpose | Due |
|---|---|---|
| AOC-4 | Financials | 30 days post-AGM |
| MGT-7 / 7A | Annual return | 60 days post-AGM |
| DIR-3 KYC | Director KYC | 30-Sep |
| DPT-3 | Deposits return | 30-Jun |
| MSME-1 | MSME dues > 45 days | Half-yearly |

- Board meetings ≥ 4/yr, gap ≤ 120 days
- CSR 2% avg 3-yr profit if net worth ≥ ₹500 Cr / t/o ≥ ₹1,000 Cr / PAT ≥ ₹5 Cr

### 4.2 MSME 45-day rule — Sec 43B(h) Income-tax
**Critical**: payments to MSME (Udyam-registered) vendors must be made within **45 days** (15 if no written agreement). Otherwise **expense disallowed** in that FY → direct tax added back.
- Track `Vendor.isMSME`, `Vendor.udyamNo`, `Vendor.agreementTerms`
- Alert at day 30, block at day 44 without override
- Report: MSME aging as of 31-Mar

### 4.3 Pollution (MPPCB)
- Consent to Operate (CTO) — air + water
- Hazardous waste auth
- Annual returns Form 1, Form 4
- Not tax but statutory fees + penalty risk

### 4.4 Legal Metrology
- Weighbridge calibration — annual. Blocks factory operations if expired.

---

## 5. Sector-specific (Distillery/Ethanol)

- **OMC ethanol allocation** — EBP scheme, fixed pricing per tender cycle
- **State excise permits** — PD-25/PD-26 per tanker
- **Molasses Control Order** — permit per movement
- **Interest subvention** on sugar/ethanol loans — scheme-wise reconciliation
- **Sugar/ethanol incentives** — MPSI subsidies if availed

---

## 6. Compliance Calendar (unified)

| Day of month | Obligation |
|---|---|
| 7 | TDS/TCS deposit (previous month) |
| 11 | GSTR-1 |
| 14 | GSTR-2B available (not a due date, but reconciliation starts) |
| 15 | PF, ESI deposit; advance tax (Jun/Sep/Dec/Mar) |
| 20 | GSTR-3B + GST payment |
| 25 | PT (state-dependent) |
| End of month after quarter | TDS return (26Q/24Q/27EQ) |
| 30-Jun | DPT-3 |
| 30-Sep | DIR-3 KYC; Tax audit (3CA/3CD) |
| 31-Oct | ITR-6 (audited) |
| 25-Oct / 25-Apr | ITC-04 |
| 30-Nov | ITC cut-off for previous FY |
| 31-Dec | GSTR-9 + 9C |
| 31-Mar | FY close; LUT renewal; MSME aging cut; actuarial valuation |

---

## 7. Implementation Phases

Each phase has its own skill file with data model, routes, UI, tests.

| Phase | Skill file | Priority | Dependencies |
|---|---|---|---|
| 1. Master data foundation | `compliance-phase1-master-data.md` | **Build now** | None |
| 2. Transaction enforcement | `compliance-phase2-transactions.md` | After Phase 1 | Sales + Procurement + Accounts modules |
| 3. Tax ledgers | `compliance-phase3-ledgers.md` | After Phase 2 | Accounts full module |
| 4. Returns generator | `compliance-phase4-returns.md` | After Phase 3 | 3 months of transaction data |
| 5. Calendar + alerts | `compliance-phase5-calendar.md` | Can parallel P2 | Telegram bot |
| 6. Audit + reports | `compliance-phase6-audit.md` | End of first FY | All above |

## 8. Sources & authority

- [CBDT Income-tax Act 2025 — TaxGuru](https://taxguru.in/income-tax/tds-rates-thresholds-fy-2026-27-effective-01-04-2026-income-tax-act-2025.html)
- [CBIC GST portal](https://www.gst.gov.in)
- [ClearTax GST changes Apr 2026](https://cleartax.in/s/gst-changes-from-april-2026)
- [PwC India corporate tax](https://taxsummaries.pwc.com/india/corporate/taxes-on-corporate-income)
- [Ethanol HSN 2207 — ClearTax](https://cleartax.in/s/ethyl-alcohol-other-spirits-gst-rates-hsn-code-2207)
- [Grant Thornton ENA position](https://www.grantthornton.in/insights/blogs/levying-vatgst-on-ena-the-undeciphered-saga-continues/)
- [EzTax compliance calendar](https://eztax.in/tax-compliance-calendar-it-tds-gst-roc)
- [Wisemonk payroll compliance](https://www.wisemonk.io/blogs/payroll-compliance-in-india)

## 9. Change log
- 2026-04-09: Initial map created. Phase 1 planned.
- 2026-04-09: **Phase 1 BUILT** (master data foundation).
  - Prisma schema extended: Vendor +9 fields, Customer +6, Material +3. Nine new models: ComplianceConfig, FiscalYear, InvoiceSeries, HsnCode, GstRate, TdsSection, TcsSection, ComplianceAudit, TaxRuleExplanation. All tables exist on Railway production.
  - Backend: 12 files under `backend/src/routes/tax/` + `backend/src/services/complianceAudit.ts` + seed data `backend/src/data/taxComplianceSeed.ts`. Registered at `/api/tax/*` in `app.ts`. `tsc --noEmit` clean.
  - Frontend: 8 SAP Tier 2 pages under `frontend/src/pages/tax/`. Routes registered at `/admin/tax/*` + `/compliance/tax-rules`. `vite build` clean.
  - **Not yet done**: seed not run on Railway (call `POST /api/tax/seed` as admin); ComplianceConfig still has empty fields (fill via UI `/admin/tax/config` — GSTIN, PAN, TAN, LUT, tax regime decision 115BAB vs 115BAA vs NORMAL needs CA input); no commit yet.
  - Next: smoke test locally → seed → fill config → commit → deploy.

---

## Part B — Phase 1: Master Data (formerly compliance-phase1-master-data.md)

# Compliance Phase 1 — Master Data Foundation

**Goal**: Build the rule-base that every future compliance check reads from. No hard-coded rates, no magic numbers, no section codes in business logic. Everything effective-dated and audited.

**Build first**. Do not start Phase 2 until this is done and seeded.

---

## Data model (Prisma)

Add to `backend/prisma/schema.prisma`:

```prisma
// ============ Compliance Master Data ============

model ComplianceConfig {
  id                  String   @id @default(cuid())
  legalName           String
  pan                 String   @unique
  tan                 String   @unique
  gstin               String   @unique
  cin                 String?
  udyamNo             String?
  registeredState     String   // "MP"
  taxRegime           String   // "115BAB" | "115BAA" | "NORMAL"
  fyStartMonth        Int      @default(4) // April
  eInvoiceEnabled     Boolean  @default(true)
  eInvoiceThresholdCr Float    @default(5)
  eWayBillMinAmount   Float    @default(50000)
  lutNumber           String?
  lutValidFrom        DateTime?
  lutValidTill        DateTime?
  updatedBy           String?
  updatedAt           DateTime @updatedAt
}

model FiscalYear {
  id           String   @id @default(cuid())
  code         String   @unique  // "2026-27"
  startDate    DateTime
  endDate      DateTime
  isCurrent    Boolean  @default(false)
  isClosed     Boolean  @default(false)
  closedAt     DateTime?
  closedBy     String?
  @@index([isCurrent])
}

model InvoiceSeries {
  id           String   @id @default(cuid())
  fyId         String
  fy           FiscalYear @relation(fields: [fyId], references: [id])
  docType      String   // "TAX_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE" | "DELIVERY_CHALLAN" | "EXPORT_INVOICE" | "RCM_INVOICE"
  prefix       String   // "ETH/26-27/"
  nextNumber   Int      @default(1)
  width        Int      @default(5)
  @@unique([fyId, docType])
}

// ============ HSN + Tax Rate Rules ============

model HsnCode {
  id          String    @id @default(cuid())
  code        String    @unique   // "2207 20"
  description String
  uqc         String    // "KLR" | "KGS" | "NOS"
  category    String    // "FINISHED_GOOD" | "RAW_MATERIAL" | "BYPRODUCT" | "SERVICE"
  isActive    Boolean   @default(true)
  rates       GstRate[]
}

model GstRate {
  id              String   @id @default(cuid())
  hsnId           String
  hsn             HsnCode  @relation(fields: [hsnId], references: [id])
  cgst            Float
  sgst            Float
  igst            Float
  cess            Float    @default(0)
  isExempt        Boolean  @default(false)
  isOutsideGst    Boolean  @default(false)   // ENA
  conditionNote   String?  // "EBP only" | "Industrial use"
  effectiveFrom   DateTime
  effectiveTill   DateTime?
  @@index([hsnId, effectiveFrom])
}

// ============ TDS / TCS Master ============

model TdsSection {
  id             String       @id @default(cuid())
  code           String       @unique   // "393_CONTRACTOR"
  newSection     String       // "393"
  oldSection     String       // "194C"
  nature         String       // "Contractor"
  rateIndividual Float        // 1
  rateOthers     Float        // 2
  thresholdSingle   Float     // 30000
  thresholdAggregate Float    // 100000
  panMissingRate Float        @default(20)
  nonFilerRate   Float        @default(5)
  effectiveFrom  DateTime
  effectiveTill  DateTime?
  @@index([newSection])
}

model TcsSection {
  id             String    @id @default(cuid())
  code           String    @unique   // "206C_1H"
  nature         String
  rate           Float
  threshold      Float
  effectiveFrom  DateTime
  effectiveTill  DateTime?
}

// ============ Vendor Compliance Profile ============
// Extend existing Vendor model with:
// pan, gstin, stateCode, isMSME, udyamNo, msmeCategory,
// tdsSectionId, lowerDeductionCertNo, lowerDeductionRate,
// lowerDeductionValidFrom, lowerDeductionValidTill,
// is206ABNonFiler, paymentTermDays, isUnregisteredForRCM

// ============ Customer Compliance Profile ============
// Extend existing Customer model with:
// pan, gstin, stateCode, placeOfSupply, isSEZ, isExport,
// isRCMApplicable, customerType ("B2B"|"B2C"|"SEZ"|"EXPORT"|"DEEMED_EXPORT")

// ============ Audit trail ============

model ComplianceAudit {
  id         String   @id @default(cuid())
  entityType String   // "Vendor" | "Customer" | "ComplianceConfig" | "GstRate" | ...
  entityId   String
  field      String
  oldValue   String?
  newValue   String?
  changedBy  String
  changedAt  DateTime @default(now())
  reason     String?
  @@index([entityType, entityId])
  @@index([changedAt])
}
```

Add these indexes + fields via a **non-destructive migration**. No drops.

---

## Seed data (required before Phase 2)

Create `backend/prisma/seeds/complianceSeed.ts`:

1. **ComplianceConfig** — one row with MSPIL's GSTIN, PAN, TAN, CIN, Udyam, tax regime
2. **FiscalYear** — 2025-26 (closed), 2026-27 (current)
3. **InvoiceSeries** — one row per doc type for current FY (ETH/26-27/, DDGS/26-27/, CN/26-27/, DN/26-27/, EXP/26-27/, RCM/26-27/)
4. **HsnCode + GstRate** — all items from compliance-tax-system.md §2.1 (ethanol 2207, DDGS 2303, molasses 1703, maize 1005, CO₂ 2811, fusel 3824, job-work 9988)
5. **TdsSection** — every row from compliance-tax-system.md §1.3 (old + new section codes)
6. **TcsSection** — 206C(1) scrap, 206C(1H) goods

Run via `npm run seed:compliance` — idempotent (upsert by code).

---

## Backend routes

Create `backend/src/routes/compliance/`:

```
compliance/
├── index.ts                  # Router aggregator — register in app.ts
├── config.ts                 # GET/PUT /api/compliance/config
├── fiscalYear.ts             # CRUD FY, close FY
├── invoiceSeries.ts          # CRUD series + reserveNextNumber(fyId, docType) → atomic
├── hsn.ts                    # CRUD HSN + rates
├── tdsSection.ts             # CRUD TDS sections
├── tcsSection.ts              # CRUD TCS
└── audit.ts                   # GET audit log with filters
```

**Rules**:
- All PUT/POST go through `validate()` Zod middleware
- Every write triggers `ComplianceAudit` insert
- Rate/section edits require `role: ADMIN_FINANCE`
- `reserveNextNumber` uses `$transaction` with `FOR UPDATE` semantics — no duplicate invoice numbers possible

---

## Frontend pages (SAP Tier 2 style — no rounded, no emoji)

`frontend/src/pages/compliance/`:
1. **ComplianceConfig.tsx** — company identity + tax regime + LUT
2. **FiscalYears.tsx** — list, create new FY, close current FY
3. **InvoiceSeriesManager.tsx** — view/edit prefixes per doc type
4. **HsnMaster.tsx** — HSN list + rate history per HSN
5. **TdsSectionMaster.tsx** — TDS section table with effective dates
6. **TcsSectionMaster.tsx** — TCS
7. **ComplianceAuditLog.tsx** — filterable audit trail
8. **TaxRulesReference.tsx** — **the user-facing tax rules page** (see `compliance-tax-rules-page.md`). Reads from all master data. Every user can view. Admins edit explanations. Build this last in Phase 1 as proof that master data is complete.

Register all under `/admin/compliance/*` in `App.tsx` with lazy loading.

---

## Extensions to existing models

### Vendor (extend, don't replace)
Add: `pan String?`, `gstin String?`, `stateCode String?`, `isMSME Boolean @default(false)`, `udyamNo String?`, `msmeCategory String?`, `tdsSectionId String?`, `lowerDeductionCertNo String?`, `lowerDeductionRate Float?`, `lowerDeductionValidFrom DateTime?`, `lowerDeductionValidTill DateTime?`, `is206ABNonFiler Boolean @default(false)`, `paymentTermDays Int @default(30)`, `isUnregisteredForRCM Boolean @default(false)`.

### Customer (extend)
Add: `pan String?`, `gstin String?`, `stateCode String?`, `placeOfSupply String?`, `isSEZ Boolean @default(false)`, `isExport Boolean @default(false)`, `isRCMApplicable Boolean @default(false)`, `customerType String @default("B2B")`.

### Material (extend)
Add: `hsnId String?`, `defaultUqc String?`, `isRcmApplicable Boolean @default(false)`.

All additions are nullable/defaulted — no data migration needed.

---

## Acceptance criteria (Phase 1 done when…)
- [ ] Migration applied locally + Railway without data loss
- [ ] Seed script populates all HSN, TDS, TCS, FY, series rows
- [ ] Compliance Config page renders with MSPIL data
- [ ] Can create FY 2027-28, close 2026-27
- [ ] Can reserve next invoice number atomically (test with concurrent requests)
- [ ] HSN master shows ethanol, DDGS, molasses with correct rates
- [ ] TDS section master shows new 393 + old 194C mapping side-by-side
- [ ] Every edit creates a ComplianceAudit row
- [ ] No existing route, page, or test is broken
- [ ] `cd backend && npx tsc --noEmit` passes
- [ ] `cd frontend && npx vite build` passes

---

## Implementation order (strict)
1. Prisma schema additions + `prisma migrate dev` locally
2. Seed script + run locally
3. Backend routes + asyncHandler + Zod schemas
4. Register in `app.ts`
5. Frontend pages one at a time (config → FY → series → HSN → TDS → TCS → audit)
6. Register lazy routes in `App.tsx`
7. Test each page end-to-end in browser
8. Manual end-to-end: edit a rate → check audit log → reserve invoice number → verify atomicity
9. `prisma migrate deploy` on Railway
10. Run seed on Railway (one-time)

---

## What NOT to build in Phase 1
- Any transaction-side enforcement (that's Phase 2)
- Any ledger posting (Phase 3)
- Any return generation (Phase 4)
- Any alerts (Phase 5)

Phase 1 is **master data only**. Keep scope tight.

---

## Part C — Phase 2: Transactions (formerly compliance-phase2-transactions.md)

# Compliance Phase 2 — Transaction Enforcement

**Depends on**: Phase 1 (master data must exist).
**Goal**: Every transaction that creates tax liability/credit is computed from master data and blocked at source if non-compliant. No user can bypass.

## Enforcement points

### Sales Invoice (`backend/src/routes/invoices.ts`)
On create:
1. Resolve `FiscalYear.current`. If closed → reject.
2. Resolve `InvoiceSeries` for docType + FY. Atomically reserve next number.
3. Look up `Material.hsnId` → `GstRate` effective on invoice date. Split CGST/SGST/IGST from `Customer.stateCode` vs `ComplianceConfig.registeredState`.
4. If `Customer.isExport` → require valid `ComplianceConfig.lutValidTill > invoiceDate` OR charge IGST.
5. If `Customer.isSEZ` → zero-rated.
6. Fire e-invoice call (if AATO > ₹5 Cr). Store IRN + ack no + QR.
7. Cron job: any invoice where `invoiceDate < today - 28 days AND irn IS NULL` → flag red; at day 30 → block PDF.
8. E-way bill if amount > `ComplianceConfig.eWayBillMinAmount`.

### Vendor Invoice (`backend/src/routes/vendorInvoices.ts`)
On create:
1. Require `Vendor.pan`. Missing → TDS rate = 20%.
2. Resolve `Vendor.tdsSectionId` → `TdsSection` rate (individual vs others from `Vendor.type`).
3. Check YTD aggregate per vendor per section. If crosses threshold → deduct on full amount from first rupee.
4. If `Vendor.lowerDeductionCertNo` valid → use cert rate instead.
5. If `Vendor.is206ABNonFiler` → higher of 2× or 5%.
6. If `Vendor.isUnregisteredForRCM` OR `Material.isRcmApplicable` → flag RCM, auto-create RCM self-invoice.
7. Compute ITC eligibility from `GstRate` + §17(5) block list.
8. Store computed TDS, GST, RCM values. **Block posting if computed values missing.**

### Payment (`backend/src/routes/unifiedPayments.ts`, `bankPayments.ts`)
On release:
1. If vendor invoice has `tdsAmount > 0` and `tdsDeducted = false` → block.
2. If `Vendor.isMSME = true` and invoice age > 44 days → require dual approval + reason.
3. If previous month's TDS challan unpaid (cross-check with `TdsDeposit` ledger) → block all payments of current month after 7th.
4. If previous month's GSTR-3B unfiled → block payments after 20th.

### GRN (`backend/src/routes/goodsReceipts.ts`)
On create:
1. RCM auto-flag for GTA / unregistered / import-of-service.
2. Link HSN + GST rate for valuation.

### Credit Note / Debit Note
Same series + rate resolution as invoice. Link original invoice. Reduce output tax liability only in month of issue.

## Utility module

Create `backend/src/services/taxComputation.ts`:

```ts
export async function computeGst({ hsnCode, amount, sellerState, buyerState, date }) { ... }
export async function computeTds({ vendorId, sectionCode, amount, ytdAggregate, date }) { ... }
export async function computeTcs({ customerId, sectionCode, amount, ytdAggregate, date }) { ... }
export async function checkBlockedCredits({ hsnCode, purpose }) { ... }
export async function resolveNextInvoiceNumber(docType: string): Promise<string> { ... }  // atomic
export async function checkEInvoiceDeadline(invoiceId: string): Promise<'OK' | 'DUE' | 'EXPIRED'> { ... }
```

All business code calls these — never computes tax inline.

## Maker-Checker-Releaser
Every compliance-override action (skip RCM, waive TDS, backdate, close period) requires:
- **Maker**: creates override request with reason + evidence
- **Checker**: validates, can approve or reject
- **Releaser**: final push (separate user)
- Full audit trail in `ComplianceOverride` table

## Acceptance
- [ ] All `taxComputation.ts` functions unit-tested with 20+ cases
- [ ] Vendor invoice without PAN triggers 20% TDS
- [ ] Export invoice without LUT fails validation
- [ ] Creating sales invoice reserves atomic series number
- [ ] RCM auto-flag fires on GTA vendor
- [ ] Payment blocked if TDS not deducted
- [ ] Override requires 3 distinct users

---

## Part D — Phase 3: Ledgers (formerly compliance-phase3-ledgers.md)

# Compliance Phase 3 — Tax Ledgers (Auto-Posting)

**Depends on**: Phase 2.
**Goal**: Every tax-impact transaction auto-posts to the correct ledger via double-entry. No manual journal entries for tax heads.

## Ledgers to create in Chart of Accounts

| Code | Name | Type | Nature |
|---|---|---|---|
| 2101 | CGST Output Payable | Liability | Credit |
| 2102 | SGST Output Payable | Liability | Credit |
| 2103 | IGST Output Payable | Liability | Credit |
| 2104 | Cess Output Payable | Liability | Credit |
| 1301 | CGST Input ITC | Asset | Debit |
| 1302 | SGST Input ITC | Asset | Debit |
| 1303 | IGST Input ITC | Asset | Debit |
| 1304 | Cess Input ITC | Asset | Debit |
| 2110 | RCM Payable | Liability | Credit |
| 1310 | RCM ITC Receivable | Asset | Debit |
| 2201 | TDS Payable — 393 Contractor | Liability | Credit |
| 2202 | TDS Payable — 393 Professional | Liability | Credit |
| 2203 | TDS Payable — 393 Rent | Liability | Credit |
| 2204 | TDS Payable — 394 Salary | Liability | Credit |
| 2205 | TDS Payable — 393 Interest | Liability | Credit |
| 2206 | TDS Payable — 194Q/393 Goods | Liability | Credit |
| 2210 | TCS Collected — 206C(1H) | Liability | Credit |
| 2211 | TCS Collected — Scrap | Liability | Credit |
| 2301 | PF Payable — Employee | Liability | Credit |
| 2302 | PF Payable — Employer | Liability | Credit |
| 2303 | ESI Payable — Employee | Liability | Credit |
| 2304 | ESI Payable — Employer | Liability | Credit |
| 2305 | Professional Tax Payable | Liability | Credit |
| 2306 | LWF Payable | Liability | Credit |
| 2401 | Advance Tax Paid | Asset | Debit |
| 2402 | MAT Credit Entitlement | Asset | Debit |
| 2403 | Income Tax Provision | Liability | Credit |
| 2404 | Gratuity Provision | Liability | Credit |

## Auto-posting rules

### Sales Invoice posted
```
Dr  Customer AR           (total)
Cr  Ethanol Sales         (taxable)
Cr  CGST Output           (if intra-state)
Cr  SGST Output           (if intra-state)
Cr  IGST Output           (if inter-state / export with tax)
Cr  Cess Output           (if applicable)
```

### Vendor Invoice posted
```
Dr  Material/Expense      (taxable)
Dr  CGST Input ITC        (if eligible, intra-state)
Dr  SGST Input ITC        (if eligible, intra-state)
Dr  IGST Input ITC        (if eligible, inter-state)
Cr  Vendor AP             (total - TDS)
Cr  TDS Payable (section) (if applicable)
```

### RCM transaction
```
Dr  Material/Expense
Dr  RCM ITC Receivable
Cr  Vendor AP
Cr  RCM Payable
```
Then on payment of RCM to govt:
```
Dr  RCM Payable
Cr  Bank
```

### Payroll run
```
Dr  Salary Expense (gross)
Cr  PF Employee, ESI Employee, PT, TDS 394 Salary, Net Pay
Dr  PF Employer Expense, ESI Employer Expense
Cr  PF Employer Payable, ESI Employer Payable
```

### Tax payment (GST/TDS/PF/ESI)
```
Dr  (specific payable ledger)
Cr  Bank
```
Must reference the challan/CIN/TRRN.

## Period close
When a month is closed (via FY module):
- Snapshot tax ledger balances to `TaxLedgerSnapshot` table
- Prevent any backdated transaction
- Generate filing dataset

## Acceptance
- [ ] All ledgers created in seed
- [ ] Posting engine covers 8 transaction types above
- [ ] Trial balance shows tax heads separated
- [ ] Journal entries traceable back to source invoice/vendor invoice
- [ ] Period close locks backdated entries

---

## Part E — Phase 4/5/6 (formerly compliance-phase4-5-6.md)

# Compliance Phases 4, 5, 6

## Phase 4 — Returns Generator
**Depends on**: Phase 3 (ledgers must post).

Generate filing artefacts from posted transactions. Never allow direct edit — return = view.

### Files to produce
| Return | Source | Format |
|---|---|---|
| GSTR-1 JSON | Sales invoices + CN/DN in month | JSON per GSTN schema |
| GSTR-3B summary | GST ledger balances | Values for portal entry |
| GSTR-2B reconciliation | Upload portal JSON, match to vendor invoices | HTML report + CSV |
| ITC-04 | Job-work challans (in/out) | JSON |
| 26Q TDS return | TDS payable ledger by section (non-salary) | FVU file |
| 24Q TDS return | Salary TDS ledger | FVU file |
| 27EQ TCS return | TCS collected ledger | FVU file |
| GSTR-9 annual | All monthly returns aggregated | JSON |
| GSTR-9C recon | Books vs GSTR-9 | JSON + PDF |
| Form 3CD data | Full-year transaction export | Excel for auditor |

### Backend
`backend/src/routes/compliance/returns.ts` + `services/returnsGenerator/`:
- `gstr1.ts`, `gstr3b.ts`, `gstr2bRecon.ts`, `tds26Q.ts`, `tds24Q.ts`, `tcs27eq.ts`, `gstr9.ts`
- Each exports `generate(fyCode: string, month: number)` returning filing object + download URL

### GSTR-2B reconciliation (critical)
1. User uploads 2B JSON from portal
2. Parser matches invoice-by-invoice against `VendorInvoice`
3. Three buckets: MATCHED / UNMATCHED-IN-2B / UNMATCHED-IN-BOOKS
4. Unmatched-in-2B → vendor hasn't filed → flag to follow up
5. Block ITC claim on unmatched invoices (updates eligibility flag)

### Frontend
`/compliance/returns` page — list by FY/month, download button per return, show status (Draft / Filed / Acknowledged).

---

## Phase 5 — Compliance Calendar & Alerts
**Can build in parallel with Phase 2.**

### Model
```prisma
model ComplianceObligation {
  id            String   @id @default(cuid())
  category      String   // "GST" | "TDS" | "PF" | "ESI" | "PT" | "ROC" | "AdvanceTax"
  name          String   // "GSTR-3B March 2026"
  dueDate       DateTime
  fyCode        String
  periodCode    String?  // "2026-03"
  status        String   @default("PENDING") // PENDING | IN_PROGRESS | FILED | LATE | WAIVED
  filedDate     DateTime?
  filedBy       String?
  ackNo         String?
  remindAt      DateTime[]  // [t-7, t-3, t-1, t-0]
  blockPayments Boolean  @default(false)
  @@index([dueDate, status])
}
```

### Logic
- Seed yearly obligations on FY creation
- Daily cron: generate Telegram reminders for `remindAt` hits
- Dashboard KPI: Compliance Health score (weighted by overdue × severity)
- Hard block: if GSTR-3B/TDS challan of prev month unpaid past due+3 days → block new invoice posting in accounts module (override requires Director+CFO)

### UI
- **Compliance Calendar** (`/compliance/calendar`) — month view with colour badges
- **Compliance Health** widget on main dashboard
- **Overdue alerts** panel on accounts dashboard

---

## Phase 6 — Audit & Reports
**Build at end of first compliance FY.**

### Deliverables
- **Form 3CD data sheet**: every clause that can be auto-filled pulls from ledgers + masters
- **Tax audit workpapers**: sample selection (random or judgemental), test checklist, work-done columns
- **Income tax computation**: Book profit → MAT vs normal → surcharge → cess → advance tax adjustment → final liability
- **Deferred tax**: temporary differences (depreciation book vs IT, 43B items) → DTA/DTL calc
- **TDS reconciliation**: ledger vs 26AS download (uploaded by user)
- **GST annual reconciliation**: books vs GSTR-9 vs GSTR-1 vs GSTR-3B vs books of accounts
- **MSME aging report** (Sec 43B(h)): all unpaid MSME vendors > 45 days as of 31-Mar → disallowance calc
- **CSR tracking**: if applicable
- **Director KYC tracker**: DIR-3 status per director
- **Related party tracker**: Sec 188 transactions

### Pages
- `/compliance/audit` — audit workpaper hub
- `/compliance/tax-computation` — IT computation
- `/compliance/msme-aging` — 43B(h) report
- `/compliance/26as-recon` — TDS reconciliation

### Exports
All reports exportable as Excel + PDF (HBS template via renderDocumentPdf).

## Acceptance (end of Phase 6)
- [ ] Can generate GSTR-1/3B/9, 26Q/24Q, ITC-04 for any closed month
- [ ] GSTR-2B upload matches ≥ 95% of vendor invoices automatically
- [ ] Compliance calendar shows all obligations + due dates
- [ ] Telegram reminders firing on schedule
- [ ] Dashboard health score visible
- [ ] MSME aging report balances to vendor ledger
- [ ] Form 3CD data sheet exports in auditor-ready format
- [ ] Audit trail traces every tax number back to source document

---

## Part F — Tax Rules Admin Page (formerly compliance-tax-rules-page.md)

# Compliance — Tax Rules Reference Page (in-app)

**Goal**: One page inside the ERP where every user (operators, accounts, management, auditors) sees the exact tax rules the system is enforcing. No hidden logic, no "ask the CA" — if the ERP blocks a transaction, this page explains why in plain English.

**Route**: `/compliance/tax-rules` (public to all logged-in users, read-only for non-admin).

**Why this matters**
- Operators see WHY an invoice is rejected (e.g. "LUT expired — cannot raise export invoice")
- Accounts team has a living reference instead of searching WhatsApp/email
- Auditors see rule-base + effective dates + last-updated timestamp
- We (dev + Claude) read from the same page as the user — zero ambiguity
- Changes to rates/sections go through the admin UI, reflect instantly here

## Page structure (SAP Tier 2 — no rounded, no emoji)

### Header toolbar
```
TAX RULES REFERENCE  |  Indian Tax System — MSPIL Distillery ERP
[Last updated: 09-Apr-2026 14:35 IST by admin@mspil.in]   [Export PDF]  [Print]
```

### Sub-nav (sticky tabs on left)
1. **Overview** — what this page is, how to read it
2. **Company Identity** — GSTIN, PAN, TAN, CIN, Udyam, LUT, tax regime
3. **Direct Tax** — corporate IT, advance tax, TDS (393/394), TCS
4. **GST** — rates by HSN, returns, e-invoice, e-way bill, ITC, RCM
5. **Payroll** — PF, ESI, PT, LWF, gratuity, bonus
6. **Other Statutory** — ROC, MSME 43B(h), pollution, metrology
7. **Distillery-Specific** — state excise, PD-25/26, molasses control
8. **Compliance Calendar** — every due date in one table
9. **Enforcement Map** — which ERP module enforces which rule (traceability)
10. **Change Log** — every rule change with who/when/why

### Data sources (critical — page must be dynamic, not static markdown)
This page is NOT hard-coded HTML. Every table reads live from the Phase 1 master data:

| Section | Data source |
|---|---|
| Company Identity | `ComplianceConfig` |
| HSN & GST rates | `HsnCode` + `GstRate` (effective-dated, show "as of today") |
| TDS sections | `TdsSection` (old + new code side by side) |
| TCS sections | `TcsSection` |
| Fiscal Year + series | `FiscalYear` + `InvoiceSeries` |
| Calendar | `ComplianceObligation` (Phase 5) |
| Change log | `ComplianceAudit` filtered to compliance entities |

If an admin updates the ethanol GST rate in HSN Master, the Tax Rules page reflects it **immediately**. No parallel docs to maintain.

### Plain-English explanation layer
Each rule row has:
- **The rule** (e.g. "TDS on contractor payments: 1% individual, 2% others, threshold ₹30K single / ₹1L aggregate")
- **Section** (new 393, old 194C)
- **Effective from** (01-Apr-2026)
- **What the ERP does** ("Auto-deducts at vendor invoice posting. Blocks payment if TDS not deducted.")
- **What the user must do** ("Ensure vendor PAN is filled. Confirm TDS section on vendor master.")
- **Source link** (CBDT circular, official notification)

### Alerts panel (top of page)
Live indicators:
```
[GREEN] LUT valid till 31-Mar-2027
[GREEN] E-invoice enabled (AATO > ₹5 Cr)
[YELLOW] 3 vendors missing PAN — will trigger 20% TDS
[RED]    GSTR-3B Mar 2026 not filed (due 20-Apr)
```
Clicking any row navigates to the fix.

### User-facing search
Top-right search box: "Find a rule..." → fuzzy match across rule text, section codes, HSN codes. Operators can type "ethanol GST" and find the row instantly.

---

## Backend endpoints

`backend/src/routes/compliance/taxRulesPage.ts`:
```ts
GET /api/compliance/tax-rules/summary         // everything needed to render the page
GET /api/compliance/tax-rules/section/:slug    // deep link to one section
GET /api/compliance/tax-rules/search?q=...     // fuzzy search
GET /api/compliance/tax-rules/export-pdf       // HBS template → Puppeteer PDF
```

All read-only. No auth beyond logged-in user (it's a reference, not a control).

## Frontend page

`frontend/src/pages/compliance/TaxRulesReference.tsx`:
- Lazy-loaded route
- Sticky left nav, scroll-spy highlighting current section
- Every table is SAP Tier 2 style
- Tooltip on each rule showing "Last changed: {date} by {user}"
- Print-friendly CSS (`@media print`) — removes nav, keeps tables

## Admin edit flow
Admins do NOT edit the Tax Rules page directly. They edit the **underlying master data** (HSN Master, TDS Section Master, Compliance Config). The Tax Rules page re-renders automatically. This forces consistency and creates an audit trail.

Exception: the "Plain-English explanation" text for each rule is stored in a new table:
```prisma
model TaxRuleExplanation {
  id            String   @id @default(cuid())
  ruleKey       String   @unique   // "tds.393.contractor"
  title         String
  plainEnglish  String   // rich text
  whatErpDoes   String
  whatUserDoes  String
  sourceLink    String?
  category      String   // "DIRECT_TAX" | "GST" | "PAYROLL" | ...
  sortOrder     Int
  updatedBy     String?
  updatedAt     DateTime @updatedAt
}
```
Admins edit these explanations from a separate `/admin/compliance/explanations` page. Each edit audited.

## PDF export
- Uses HBS template + renderDocumentPdf pipeline (per project rule — no raw PDFKit)
- Template: `backend/src/templates/taxRulesReference.hbs`
- Includes company letterhead, all sections, full calendar, change log (last 90 days)
- Auditors can be handed a 1-click PDF showing exactly what the ERP enforces

## Access control
| Role | Access |
|---|---|
| All logged-in users | Read |
| Accounts team | Read + can flag rules for review |
| Admin Finance | Read + edit explanations |
| Super Admin | Read + edit explanations + edit underlying master data |

## Where the link appears
- Left sidebar under "Compliance" (new section)
- Tooltip on every blocked action: *"Blocked by Tax Rule [TDS-393-Contractor]. [Read rule →]"*
- Footer link on every invoice PDF: *"Generated per Tax Rules as of {date} — see /compliance/tax-rules"*
- Referenced in every compliance error message in the app

## Acceptance
- [ ] Page renders with all sections populated from master data
- [ ] Every HSN/TDS/TCS row shows effective date + last-changed-by
- [ ] Search finds "ethanol", "193", "GSTR-3B", "MSME" etc.
- [ ] Alerts panel reflects real ComplianceConfig state
- [ ] PDF export uses HBS pipeline and includes letterhead
- [ ] Changing a GST rate in HSN Master updates the page within 2 seconds
- [ ] Print CSS produces a clean auditor-friendly document
- [ ] Every blocked action in the app links back to the relevant rule

## Build order
Build this page at the **end of Phase 1**. It's the visible proof that Phase 1 master data is complete and correct. If this page looks right, Phase 1 is done.
