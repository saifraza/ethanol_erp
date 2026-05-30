# E-Way Bill for Job Work — Issue, Workaround & Automation Options

## Status: BLOCKED (manual workaround active)
- **Date**: 2026-04-06
- **Affects**: All MASH BIO-FUELS job work ethanol dispatches

---

## The problem

Job work e-invoices use **SAC 998842** (a service code). The government e-way bill system requires at least one **goods HSN** to generate an EWB. Two API paths were tried, both fail:

| Approach | Endpoint | Result |
|----------|----------|--------|
| EWB from IRN | `/eiewb/v1.03/ewaybill` | Error 4009: "HSN 998842 does not belong to Goods" |
| Standalone EWB | `/ewaybillapi/v1.03/ewayapi` | HTTP 500 empty body — Saral has no standalone EWB auth |
| EWB portal auth | `/ewaybillapi/v1.04/authenticate` | HTTP 404 — endpoint doesn't exist on Saral |

**Root cause**: Saral GSP (Relyon) only supports EWB-from-IRN via the e-invoice portal. They do NOT expose the standalone EWB API.

---

## How the old (Oracle ERP) system did it

Reference: `/Users/saifraza/Downloads/Eway And Challan 00131.pdf`

The old Oracle ERP generated EWBs **manually on the government portal** (ewaybillgst.gov.in), NOT via API:

- **Supply Type**: Outward
- **Sub Type**: Job Work (code 3)
- **Document Type**: Delivery Challan (CHL)
- **Document No**: Challan number (e.g., M-EIW/26030427-00131)
- **HSN**: 220710 (Ethanol — goods code, NOT the service SAC)
- **Rate**: 71.86/ltr (government fixed ethanol product value)
- **Value of Goods**: ₹30,18,120 (40,000 × 71.86 × 1.05 with 5% GST)
- **No invoice number** on the EWB — only the challan number

---

## Current workaround

1. e-Invoice (IRN) generates successfully via API with SAC 998842, rate ₹14/BL, 18% GST.
2. EWB button shows the info needed for manual generation: challan number, HSN 22072000, total value, vehicle, distance.
3. Team generates the EWB manually at ewaybillgst.gov.in.
4. EWB PDF is uploaded via the EWB column → "Enter" button → attach PDF. The `ewb-pdf` endpoint serves the uploaded binary (`ewbPdfData`) first, falling back to the generated PDF.

---

## Correct EWB payload (verified)

This payload is correct and ready — it just needs a working API endpoint. Note `hsnCode: 22072000` (goods), `igstRate: 5`, and `docType: "CHL"` — never the SAC.

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

## Three options to automate

### Option A — Ask Saral/Relyon for a standalone EWB API
- Contact Relyon support; ask if they have a separate EWB API subscription.
- They may have `/ewaybillapi/` endpoints needing separate activation + credentials.
- **Effort**: Low (if they support it).

### Option B — NIC direct API
- `ewayBill.ts` already has a partial NIC mode implementation.
- Requires: RSA public key from NIC, AES-256 encryption of payloads.
- Auth endpoint: `https://ewaybillgst.gov.in/ewayapi/auth/`
- Generate endpoint: `https://ewaybillgst.gov.in/ewayapi/` with action `GENEWAYBILL`
- **Effort**: Medium (crypto + testing).

### Option C — Different GSP
- Switch to a GSP that supports both e-invoice AND standalone EWB (e.g. MasterGST, Adaequare, ClearTax).
- **Effort**: High (migration + testing).

---

## Code locations

| What | File | Function / Section |
|------|------|--------------------|
| Standalone EWB function | `backend/src/services/eInvoice.ts` | `generateStandaloneEWB()` |
| Job work EWB routing | `backend/src/routes/ethanolContracts.ts` | `isJobWork` branch in the e-invoice endpoint |
| EWB payload builder | `backend/src/services/ewayBill.ts` | `buildEwayBillPayload()` |
| NIC direct mode (partial) | `backend/src/services/ewayBill.ts` | NIC mode section |
| Saral auth | `backend/src/services/ewayBill.ts` | `saralAuthenticate()` |
| e-Invoice IsServc fix | `backend/src/services/eInvoice.ts` | `buildIRNPayload()` — HSN starting with `99` → `IsServc='Y'` |

---

## Other fixes done same day (2026-04-06, for context)

1. **e-Invoice IsServc**: SAC codes (99xxxx) now set `IsServc: 'Y'` (Service), not `'N'` (Goods).
2. **Invoice number**: Fixed double prefix `INV-INV/ETH/018` → `INV/ETH/018`.
3. **QR code**: Converts the government JWT `signedQRCode` into an actual QR image on the invoice PDF.
4. **Delivery challan**: Shows base value + GST separately (not combined), rate 71.86/L.
5. **Product rate**: Fixed weighbridge sync setting the job work conversion rate (14) as `productRatePerLtr` instead of the product value (71.86).
6. **Customer pincode**: Invoice template now shows "City - Pincode".
7. **MASH BIO address**: Updated to include Odisha, pincode 767016.

---

For the parent two-document GST model, the Hard rules, and the MASH vs SM PRIMAL contract table, see `SKILL.md` in this same directory.
