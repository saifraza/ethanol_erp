---
name: ethanol-jobwork-billing
description: The invoicing hot-path anchor for ethanol/DDGS job-work dispatch billing. Use when working on ethanol or DDGS dispatch billing, job work conversion charges, IRN / e-invoice generation, e-way bill (EWB) for job work, HSN/SAC codes, the GST split between the two documents, or debugging a "GEN INVOICE" / wrong-rate / wrong-GST bug. Covers the TWO-document model (Tax Invoice SAC 998842 @18% conversion charge vs Delivery Challan HSN 22072000 @5% on the Rs71.86/L govt rate), MASH (Rs14/BL) vs SM PRIMAL (Rs2.987/BL) contracts, DDGS job-work (SAC 998817 @18%), and the exact code refs in ethanolContracts.ts / eInvoice.ts.
when_to_use: ethanol dispatch invoice, ethanol lifting billing, DDGS job work billing, job work conversion charge, IRN generation, e-invoice for job work, e-way bill rejected, error 4009, HSN 998842, SAC 998817, HSN 22072000, Rs71.86, MASH BIO-FUELS, SM PRIMAL, "tax invoice vs delivery challan", GST 18 vs 5 split, IsServc, "GEN INVOICE" appearing on invoice, wrong rate on challan vs invoice.
---

# Ethanol / DDGS Job Work — Billing, GST & Document Rules

Job work ethanol dispatch produces **TWO documents per truck**, with DIFFERENT rates, HSN/SAC codes, and GST %. The whole module exists to keep these two apart. Never conflate them.

## Hard rules — NEVER break (verbatim from feedback)

1. **NEVER apply 5% to job work invoice** — it's 18% service
2. **NEVER use SAC 998842 on EWB** — EWB needs goods HSN 22072000
3. **NEVER use ₹14/BL on challan** — challan uses ₹71.86/L product value
4. **NEVER use ₹71.86/L on invoice** — invoice bills only conversion charge
5. **Tax compliance auto-rate engine must NOT override job work lines** — detect SAC 998842 → 18%

Two more product-name rules that the same bugs keep violating:
- **Product name on invoice** = `"Job Work Charges for Ethanol Production"` (NOT "ETHANOL", and NOT the literal "GEN INVOICE" placeholder — if you see "GEN INVOICE" on a rendered invoice, the description field never got populated from the contract/lifting).
- **Product name on challan** = `"Ethanol"` (NOT "Job Work Charges...").

## The two documents

### Document 1 — TAX INVOICE (the bill to the customer)

| Field | Value |
|-------|-------|
| What it is | Invoice for job work conversion charges only |
| Product name | `"Job Work Charges for Ethanol Production"` |
| HSN/SAC | **998842** (manufacturing services on physical inputs owned by others) |
| Rate | `contract.conversionRate` — ₹14.00/BL MASH, ₹2.987/BL SM PRIMAL |
| GST | **18%** (9% CGST + 9% SGST intra-state, 18% IGST inter-state) |
| IsServc | `'Y'` (service — SAC starts with 99) |
| Unit | BL (Bulk Litres) |
| Example | 40,000 BL × ₹14.00 = ₹5,60,000 + 18% = ₹6,60,800 |
| Series | INV/ETH/001, INV/ETH/002, … |
| e-Invoice (IRN) | Generates via Saral GSP API |
| Who pays | Customer pays MSPIL for the conversion service |

### Document 2 — DELIVERY CHALLAN (movement document for the goods)

| Field | Value |
|-------|-------|
| What it is | Challan for physical movement of ethanol (owned by the customer/principal, produced on job work) |
| Product name | `"Ethanol"` |
| HSN | **22072000** (Ethyl alcohol and other spirits, denatured) |
| Rate | **₹71.86/BL** (fixed company-wide ethanol value for movement/insurance — NOT the contract rate) |
| GST on challan value | **5%** (on the movement value, NOT on job work charges) |
| Example | 40,000 BL × ₹71.86 = ₹28,74,400 + 5% = ₹30,18,120 |
| Series | DCH/ETH/161, DCH/ETH/162, … |
| Document type | Delivery Challan (DC), NOT a tax invoice |
| Purpose | Value of goods being transported — required for E-Way Bill, transport, insurance, excise |

### Why they differ

The customer owns the raw material (grain). MSPIL converts it to ethanol on their behalf (job work). So:
- **Invoice** = charge for MSPIL's service (conversion) → service SAC 998842, 18% GST, conversion rate.
- **Challan** = movement of the customer's goods (ethanol) → goods HSN 22072000, 5% GST, ₹71.86/BL govt fixed product value.

The challan ₹71.86/BL is the actual market value of ethanol, used for EWB value, insurance during transport, and excise/transport compliance. The invoice ₹14 (or ₹2.987) /BL is purely the conversion fee.

## DDGS job work — same two-document pattern

- SAC: **998817**
- GST: **18%** on the processing charge
- Same Tax-Invoice-for-charge + Delivery-Challan-for-goods structure as ethanol.

## E-Way Bill for job work (summary — full detail in `eway-bill-jobwork.md`)

- EWB **cannot be generated via the Saral GSP API** for job work — the IRN uses SAC 998842, and the govt EWB system rejects a service SAC (error 4009: "HSN 998842 does not belong to Goods"). Saral (Relyon) only supports EWB-from-IRN and has no standalone EWB API.
- EWB must use the **goods HSN 22072000** at **₹71.86/L, 5%**, doc type Delivery Challan (CHL), sub-type Job Work (3) — never the service SAC.
- Workaround: IRN generates fine via API; the team generates the EWB **manually on ewaybillgst.gov.in**, then uploads the PDF via the EWB column → "Enter" button. The `ewb-pdf` endpoint serves the uploaded binary (`ewbPdfData`) first, falling back to the generated PDF.
- See bundled `eway-bill-jobwork.md` for the verified NIC payload, the old-Oracle manual process, and the three automation options.

## MASH BIO-FUELS vs SM PRIMAL

| | MASH BIO-FUELS | SM PRIMAL |
|--|---------------|-----------|
| GSTIN | 21AAOCM6766C1ZF | 23ABGCS5473D1ZF |
| State | Odisha (21) | MP (23) |
| GST type | **IGST 18%** (inter-state) | **CGST 9% + SGST 9%** (intra-state) |
| Conversion rate | ₹14.00/BL | ₹2.987/BL |
| Challan series | DCH/ETH/161+ (shared) | DCH/ETH/173 (shared) |
| Payment terms | 10 days | 7 days |

(MSPIL seller GSTIN for the challan/EWB "from" side: **23AAECM3666P1Z1**, Village Bachai, Dist. Narsinghpur, pincode 487001, state 23.)

## Contract setup requirements

For a job work contract to bill correctly these fields MUST be set:

| Field | Purpose | Example |
|-------|---------|---------|
| `contractType` | Must be `JOB_WORK` | `JOB_WORK` |
| `conversionRate` | ₹/BL conversion fee (drives the invoice) | 14.00 |
| `gstPercent` | GST on the conversion fee | 18 |
| `buyerGst` | Customer GSTIN (for e-invoice) | 21AAOCM6766C1ZF |
| `buyerCustomerId` | Link to Customer table | (UUID) |
| `autoGenerateEInvoice` | Auto-create invoice on lifting | true |

## Code locations (exact refs — keep them straight)

| What | File | Line / Function |
|------|------|-----------------|
| Job-work branching | `backend/src/routes/ethanolContracts.ts` | `isJobWork` flag drives ALL invoice/challan branching |
| IsServc auto-detect | `backend/src/services/eInvoice.ts:229` | HSN starting with `'99'` → `IsServc: 'Y'` (service, not goods) |
| SAC mapping | `backend/src/services/eInvoice.ts:264-267` | 998842 = ETH, 998817 = DDGS |
| Invoice creation (auto) | `backend/src/routes/ethanolContracts.ts` | `POST /:id/liftings` — auto-invoice block |
| Invoice creation (manual) | `backend/src/routes/ethanolContracts.ts` | `POST /:id/liftings/:id/create-invoice` |
| Challan PDF | `backend/src/routes/ethanolContracts.ts` | `GET /:id/liftings/:id/delivery-challan-pdf` |
| Gate Pass PDF | `backend/src/routes/ethanolContracts.ts` | `GET /:id/liftings/:id/gate-pass-pdf` |
| Release flow (weighbridge) | `backend/src/routes/ethanolGatePass.ts` | `POST /:id/release` |
| Challan rate logic | `backend/src/routes/ethanolGatePass.ts` | Lines 275-282 (₹71.86 hardcoded for job work) |
| Gate pass rate logic | `backend/src/routes/ethanolGatePass.ts` | Lines 323-327 (reads `contract.conversionRate`) |
| Standalone EWB | `backend/src/services/eInvoice.ts` | `generateStandaloneEWB()` |
| EWB payload builder | `backend/src/services/ewayBill.ts` | `buildEwayBillPayload()` |

## Links — point, don't fork

- **The 19-lifting supply-invoice-linking incident**: [`docs/postmortems/2026-04-11-ethanol-supply-invoice-linking.md`](../../../docs/postmortems/2026-04-11-ethanol-supply-invoice-linking.md)
- **GSP / IRN payload schema (full)**: [`docs/modules/sales-and-einvoice.md`](../../../docs/modules/sales-and-einvoice.md)
- **Full tax rulebase (HSN/SAC, rates, auto-rate engine)**: [`docs/reference/compliance-tax-system.md`](../../../docs/reference/compliance-tax-system.md)
- **EWB-for-job-work detail**: bundled `eway-bill-jobwork.md` in this skill dir
