# Ethanol Job Work — Billing, GST & Document Rules

## CRITICAL: Two Different Documents, Two Different Rates, Two Different GST Treatments

Job work ethanol dispatch produces TWO documents per truck. They use DIFFERENT rates, HSN codes, and GST percentages. **Never mix them up.**

### Document 1: TAX INVOICE (the bill to the customer)

| Field | Value |
|-------|-------|
| **What it is** | Invoice for job work conversion charges |
| **Product name** | "Job Work Charges for Ethanol Production" |
| **HSN/SAC** | **998842** (manufacturing services on physical inputs owned by others) |
| **Rate** | `contract.conversionRate` (currently ₹14.00/BL for MASH, ₹2.99/BL for SM PRIMAL) |
| **GST** | **18%** (9% CGST + 9% SGST for intra-state, 18% IGST for inter-state) |
| **Amount example** | 40,000 BL × ₹14.00 = ₹5,60,000 + 18% GST = ₹6,60,800 |
| **Invoice series** | INV/ETH/001, INV/ETH/002, ... |
| **Who pays** | Customer pays us for the conversion service |

### Document 2: DELIVERY CHALLAN (movement document for the goods)

| Field | Value |
|-------|-------|
| **What it is** | Challan for physical movement of ethanol (owned by customer, produced on job work) |
| **Product name** | "Ethanol" |
| **HSN** | **22072000** (Ethyl alcohol and other spirits, denatured) |
| **Rate** | **₹71.86/BL** (fixed company-wide ethanol value for movement/insurance purposes) |
| **GST** | **5%** (on the movement value, NOT on job work charges) |
| **Amount example** | 40,000 BL × ₹71.86 = ₹28,74,400 + 5% GST = ₹30,18,120 |
| **Challan series** | DCH/ETH/161, DCH/ETH/162, ... |
| **Purpose** | Shows the value of goods being transported — required for E-Way Bill and transport |

### Why They're Different

The customer owns the raw material (grain). We convert it to ethanol on their behalf (job work). So:
- **Invoice** = charges for our service (conversion) → service HSN 998842, 18% GST
- **Challan** = movement of their goods (ethanol) → goods HSN 22072000, 5% GST on movement value

The challan value (₹71.86/BL) is the actual market price of ethanol — it's used for:
- E-Way Bill value calculation
- Insurance during transport
- Excise/transport compliance

The invoice value (₹14/BL or ₹2.99/BL) is just our conversion fee.

## E-Way Bill for Job Work

- **Cannot be generated via API** (Saral GSP doesn't support standalone EWB for job work)
- Team generates manually on ewaybillgst.gov.in
- PDF is uploaded via the EWB column → "Enter" button → attach PDF
- The `ewb-pdf` endpoint serves the uploaded binary (`ewbPdfData`) first, falls back to generated PDF

## Code Locations

| What | File | Line/Function |
|------|------|---------------|
| Invoice creation (auto) | `ethanolContracts.ts` | `POST /:id/liftings` — auto-invoice block |
| Invoice creation (manual) | `ethanolContracts.ts` | `POST /:id/liftings/:id/create-invoice` |
| Challan PDF | `ethanolContracts.ts` | `GET /:id/liftings/:id/delivery-challan-pdf` |
| Gate Pass PDF | `ethanolContracts.ts` | `GET /:id/liftings/:id/gate-pass-pdf` |
| Release flow (weighbridge) | `ethanolGatePass.ts` | `POST /:id/release` |
| Challan rate logic | `ethanolGatePass.ts` | Lines 275-282 (₹71.86 hardcoded for job work) |
| Gate pass rate logic | `ethanolGatePass.ts` | Lines 323-327 (reads contract.conversionRate) |

## NEVER Change These

1. **Invoice HSN 998842 + 18% GST** — this is the correct SAC for job work manufacturing services
2. **Challan HSN 22072000 + 5% GST** — this is the correct HSN for ethanol movement
3. **Challan rate ₹71.86/BL** — fixed company-wide value, NOT the contract rate
4. **Invoice rate from contract.conversionRate** — varies per contract (₹14 MASH, ₹2.99 SM PRIMAL)
5. **Product name on invoice** = "Job Work Charges for Ethanol Production" (NOT "ETHANOL")
6. **Product name on challan** = "Ethanol" (NOT "Job Work Charges...")

## Contract Setup Requirements

For job work contracts to work correctly, these fields MUST be set:

| Field | Purpose | Example |
|-------|---------|---------|
| `contractType` | Must be `JOB_WORK` | `JOB_WORK` |
| `conversionRate` | ₹/BL conversion fee (for invoice) | 14.00 |
| `gstPercent` | GST on conversion fee | 18 |
| `buyerGst` | Customer GSTIN (for e-invoice) | 21AAOCM6766C1ZF |
| `buyerCustomerId` | Link to Customer table | (UUID) |
| `autoGenerateEInvoice` | Auto-create invoice on lifting | true |

## SM PRIMAL vs MASH — Key Differences

| | MASH BIO-FUELS | SM PRIMAL |
|--|---------------|-----------|
| GSTIN | 21AAOCM6766C1ZF | 23ABGCS5473D1ZF |
| State | Odisha (21) | MP (23) |
| GST type | **IGST 18%** (inter-state) | **CGST 9% + SGST 9%** (intra-state) |
| Conversion rate | ₹14.00/BL | ₹2.99/BL |
| Challan series | DCH/ETH/161+ (shared series) | DCH/ETH/173 (shared series) |
| Payment terms | 10 days | 7 days |
