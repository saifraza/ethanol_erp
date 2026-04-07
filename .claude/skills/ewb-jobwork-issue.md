# E-Way Bill for Job Work — Issue & Findings

## Status: BLOCKED (Manual Workaround Active)
**Date**: 2026-04-06
**Affects**: All MASH BIO-FUELS job work ethanol dispatches

---

## The Problem

Job work e-invoices use **SAC 998842** (service code). The government e-way bill system requires at least one **goods HSN** to generate an EWB. Two paths tried, both fail:

| Approach | Endpoint | Result |
|----------|----------|--------|
| EWB from IRN | `/eiewb/v1.03/ewaybill` | Error 4009: "HSN 998842 does not belong to Goods" |
| Standalone EWB | `/ewaybillapi/v1.03/ewayapi` | HTTP 500 empty body — Saral has no standalone EWB auth |
| EWB portal auth | `/ewaybillapi/v1.04/authenticate` | HTTP 404 — endpoint doesn't exist on Saral |

**Root cause**: Saral GSP (Relyon) only supports EWB-from-IRN via the e-invoice portal. They don't expose the standalone EWB API.

---

## How the Old System Did It

Reference: `/Users/saifraza/Downloads/Eway And Challan 00131.pdf`

The old Oracle ERP generated EWBs **manually on the government portal** (ewaybillgst.gov.in), NOT via API:

- **Supply Type**: Outward
- **Sub Type**: Job Work (code 3)
- **Document Type**: Delivery Challan (CHL)
- **Document No**: Challan number (e.g., M-EIW/26030427-00131)
- **HSN**: 220710 (Ethanol — goods code, NOT the service SAC)
- **Rate**: 71.86/ltr (government fixed ethanol product value)
- **Value of Goods**: ₹30,18,120 (40,000 × 71.86 × 1.05 with 5% GST)
- **No invoice number** on the EWB — only challan number

---

## Current Workaround

1. e-Invoice (IRN) generates successfully via API with SAC 998842, rate ₹14/BL, 18% GST
2. EWB button shows info for manual generation:
   - Challan number, HSN 22072000, total value, vehicle, distance
3. Team generates EWB manually at ewaybillgst.gov.in

---

## Correct EWB Payload (Verified)

This payload is correct and ready — just needs a working API endpoint:

```json
{
  "supplyType": "O",
  "subSupplyType": "3",
  "docType": "CHL",
  "docNo": "DCH/ETH/002",
  "docDate": "06/04/2026",
  "fromGstin": "23AAECM3666P1Z1",
  "fromTrdName": "Mahakaushal Sugar and Power Industries Ltd.",
  "fromAddr1": "Village Bachai, Dist. Narsinghpur",
  "fromPincode": 487001,
  "fromStateCode": 23,
  "toGstin": "21AAOCM6766C1ZF",
  "toTrdName": "MASH BIO-FUELS PRIVATE LIMITED",
  "toAddr1": "Plot No. 4, Tehsil- Tarbha, Panimurajangle, Subarnapur, Odisha",
  "toPincode": 767016,
  "toStateCode": 21,
  "transactionType": 1,
  "totalValue": 2874400,
  "igstValue": 143720,
  "totInvValue": 3018120,
  "transMode": "1",
  "vehicleNo": "KA01AM3271",
  "vehicleType": "R",
  "transDistance": 900,
  "itemList": [{
    "hsnCode": 22072000,
    "productName": "Ethanol",
    "quantity": 40000,
    "qtyUnit": "LTR",
    "taxableAmount": 2874400,
    "igstRate": 5
  }]
}
```

---

## Three Options to Automate

### Option A: Ask Saral/Relyon for Standalone EWB API
- Contact Relyon support, ask if they have a separate EWB API subscription
- They may have `/ewaybillapi/` endpoints that need separate activation + credentials
- **Effort**: Low (if they support it)

### Option B: NIC Direct API
- The `ewayBill.ts` already has partial NIC mode implementation
- Requires: RSA public key from NIC, AES-256 encryption of payloads
- Auth endpoint: `https://ewaybillgst.gov.in/ewayapi/auth/`
- Generate endpoint: `https://ewaybillgst.gov.in/ewayapi/` with action `GENEWAYBILL`
- **Effort**: Medium (crypto + testing)

### Option C: Different GSP
- Switch to a GSP that supports both e-invoice AND standalone EWB
- Examples: MasterGST, Adaequare, ClearTax
- **Effort**: High (migration + testing)

---

## Code Locations

| What | File | Function/Section |
|------|------|-----------------|
| Standalone EWB function | `backend/src/services/eInvoice.ts` | `generateStandaloneEWB()` |
| Job work EWB routing | `backend/src/routes/ethanolContracts.ts` | `isJobWork` branch in e-invoice endpoint |
| EWB payload builder | `backend/src/services/ewayBill.ts` | `buildEwayBillPayload()` |
| NIC direct mode (partial) | `backend/src/services/ewayBill.ts` | NIC mode section |
| Saral auth | `backend/src/services/ewayBill.ts` | `saralAuthenticate()` |
| e-Invoice IsServc fix | `backend/src/services/eInvoice.ts` | `buildIRNPayload()` — HSN starting with 99 → IsServc='Y' |

---

## Other Fixes Done Today (2026-04-06)

1. **e-Invoice IsServc**: SAC codes (99xxxx) now set `IsServc: 'Y'` (Service) not 'N' (Goods)
2. **Invoice number**: Fixed double prefix `INV-INV/ETH/018` → `INV/ETH/018`
3. **QR code**: Converts government JWT signedQRCode into actual QR code image on invoice PDF
4. **Delivery challan**: Shows base value + GST separately (not combined), rate 71.86/L
5. **Product rate**: Fixed weighbridge sync setting job work conversion rate (14) as productRatePerLtr instead of product value (71.86)
6. **Customer pincode**: Invoice template now shows "City - Pincode"
7. **MASH BIO address**: Updated to include Odisha, pincode 767016
