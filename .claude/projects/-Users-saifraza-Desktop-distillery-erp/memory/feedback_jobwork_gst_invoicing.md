---
type: feedback
---

# Job Work GST & Invoicing — NEVER change this logic

Job work ethanol has TWO separate documents with DIFFERENT GST treatments. Never conflate them.

## 1. Tax Invoice (billing the conversion charge)
- Bills: processing/conversion charge only (₹14/BL for MASH, ₹2.987/BL for SM PRIMAL)
- HSN/SAC: **998842** (service code — "Manufacturing services on physical inputs owned by others")
- GST: **18%** (9+9 CGST/SGST intra-state, or 18% IGST inter-state)
- IsServc: 'Y' (service, not goods — SAC starts with 99)
- Product description: "Job Work Charges for Ethanol Production"
- Unit: BL (Bulk Litres)
- e-Invoice (IRN): generates via Saral GSP API

## 2. Delivery Challan (transporting the ethanol)
- Covers: physical movement of ethanol (belongs to principal, not MSPIL)
- HSN: **22072000** (Ethanol — goods code)
- Product value: **₹71.86/L** (govt fixed rate — for transport/insurance)
- GST on challan value: **5%** (goods rate, for EWB)
- Document type: Delivery Challan (DC), NOT tax invoice
- EWB: must use goods HSN 22072000, NOT SAC 998842 (govt error 4009 rejects SAC)
- EWB generation: manual on ewaybillgst.gov.in (Saral doesn't support standalone EWB API)

## Rules — NEVER break
1. NEVER apply 5% to job work invoice — it's 18% service
2. NEVER use SAC 998842 on EWB — EWB needs goods HSN 22072000
3. NEVER use ₹14/BL on challan — challan uses ₹71.86/L product value
4. NEVER use ₹71.86/L on invoice — invoice bills only conversion charge
5. Tax compliance auto-rate engine must NOT override job work lines — detect SAC 998842 → 18%

## DDGS Job Work (same pattern)
- SAC: 998817
- GST: 18% on processing charge
- Same two-document structure

## Code refs
- `ethanolContracts.ts` — isJobWork flag drives all branching
- `eInvoice.ts:229` — IsServc auto-detect from HSN starting with '99'
- `eInvoice.ts:264-267` — SAC mapping (998842 ETH, 998817 DDGS)
- `ewb-jobwork-issue.md` — full EWB workaround details
