# Sales Pipeline & GST Compliance Module

## Overview
Complete order-to-cash pipeline for MSPIL ethanol plant: contracts → orders → dispatch → shipments → invoices → e-Invoice (IRN) → e-Way Bill → payments.

## Files

### Backend
| File | Purpose | Lines |
|------|---------|-------|
| `routes/shipments.ts` | Shipments, weighing, PDFs, e-Invoice/EWB generation, cancel IRN | ~1100 |
| `routes/invoices.ts` | Invoice CRUD, PDF generation, payment tracking | |
| `routes/salesOrders.ts` | Sales orders with line items | |
| `routes/dispatchRequests.ts` | 5-step dispatch workflow | |
| `routes/ethanolContracts.ts` | OMC/party contracts, liftings | ~360 |
| `routes/customers.ts` | Customer CRUD + GSTIN lookup | |
| `routes/transporters.ts` | Transporter management | |
| `routes/freightInquiry.ts` | Freight rate inquiries | |
| `services/eInvoice.ts` | IRN generation, cancel, GSTIN lookup via Saral GSP | |
| `services/ewayBill.ts` | Saral GSP auth, e-Way Bill generation, cancel, vehicle update | |
| `utils/pdfGenerator.ts` | All PDF generators (invoices, challans, gate passes, POs) | |

### Frontend
| File | Purpose |
|------|---------|
| `pages/sales/Shipments.tsx` | Main shipment management UI with document flow |
| `pages/sales/Customers.tsx` | Customer form with GSTIN auto-fill lookup |
| `pages/sales/SalesOrders.tsx` | Order management |
| `pages/sales/DispatchRequests.tsx` | Dispatch workflow |
| `pages/sales/Invoices.tsx` | Invoice list and management |
| `pages/sales/EthanolContracts.tsx` | Contract management |
| `pages/sales/FreightManagement.tsx` | Freight inquiries and quotes (~1874 lines, largest FE file) |
| `pages/sales/SalesDashboard.tsx` | Sales analytics |

### Prisma Models
SalesOrder, SalesOrderLine, Customer, Invoice, InvoiceLine, Payment, Shipment, ShipmentDocument, DispatchRequest, EthanolContract, EthanolLifting, Transporter, TransporterPayment, FreightInquiry, FreightQuotation, Product

---

## Order-to-Cash Flow

```
EthanolContract → SalesOrder → DispatchRequest → Shipment → Invoice → e-Invoice (IRN) → E-Way Bill → Payment
```

### Sales Channels
1. **Job work (Mash Bio)**: ₹14/BL conversion charge — they supply molasses, MSPIL converts to ethanol
2. **Fixed price party sales**: e.g., ₹60/L with SM Primal — direct ethanol sales
3. **OMC contracts**: JioBP, Nayara, PSU OMCs — government-regulated pricing via EthanolContract

### DispatchRequest Workflow (5 steps — don't skip)
```
NEW → APPROVED → TRUCK_ASSIGNED → DISPATCHED → DELIVERED
```
Each step has status validation. Never allow direct transitions like NEW → DISPATCHED.

### Shipment Lifecycle
```
GATE_IN → LOADING → WEIGHED → RELEASED → EXITED
```
- **GATE_IN**: Truck arrives, basic info recorded
- **LOADING**: Being loaded with product
- **WEIGHED**: Gross/tare/net weights captured
- **RELEASED**: Invoice generated, documents ready
- **EXITED**: Left plant premises

### Auto-generated on Shipment Creation
- `challanNo`: `DC-{shipmentNo}` (Delivery Challan)
- `gatePassNo`: `GP-{shipmentNo}` (Gate Pass)

---

## Saral GSP Integration (e-Invoice + e-Way Bill)

### Environment Variables (Railway)
```
EWAY_BILL_MODE=saral
EWAY_SARAL_URL=https://saralgsp.com
EWAY_NIC_CLIENT_ID=<Saral GSP client ID>
EWAY_NIC_CLIENT_SECRET=<Saral GSP client secret>
EWAY_EWB_USERNAME=API_MHKSPIL_RELYON    # SAME user for both EWB and e-Invoice
EWAY_EWB_PASSWORD=Reladmin@123
EWAY_GSTIN=23AAECM3666P1Z1              # MSPIL GSTIN (MP)
```
**Important**: The EINV-specific credentials (`api_mspil2005`) are NOT mapped to the Saral client ID. Always use `EWAY_EWB_USERNAME` for everything.

### Authentication Flow (3 steps)
```
Step 1: GSP Auth
  GET /authentication/Authenticate
  Headers: ClientId, ClientSecret
  Returns: authenticationToken, subscriptionId

Step 2: IRP Auth
  POST /eivital/v1.04/auth
  Headers: AuthenticationToken, SubscriptionId, Gstin, UserName, Password
  Returns: authToken, sek, tokenExpiry

Step 3: API Call (IRN/EWB/GSTIN/Cancel)
  Headers: AuthenticationToken, SubscriptionId, Gstin, UserName, Password, AuthToken, sek
```

### Token Caching
- Auth tokens cached in memory with actual `tokenExpiry` from IRP response
- `clearSaralAuthCache()` clears on auth failures
- Retry logic: 3 attempts with 2s/4s exponential backoff on network errors
- 45s timeout on all Saral API calls

### API Endpoints

| Operation | Method | Saral URL | Key Notes |
|-----------|--------|-----------|-----------|
| **Generate IRN** | POST | `/eicore/v1.03/Invoice` | Full invoice payload in body |
| **Cancel IRN** | POST | `/eicore/v1.03/Invoice/Cancel` | `{Irn, CnlRsn, CnlRem}` in body (NOT in URL path) |
| **Get IRN Details** | GET | `/eicore/v1.03/Invoice?irn_no=XXX` | Query param, not path param |
| **Generate EWB from IRN** | POST | `/eiewb/v1.03/ewaybill` | NOT `/eicore/` — different base path |
| **Cancel EWB** | POST | `/v1.03/ewayapi` | `{ewbNo, cancelRsnCode, cancelRmrk}` |
| **Get EWB by IRN** | GET | `/eiewb/v1.03/ewaybill?irn_no=XXX` | |
| **GSTIN Lookup** | GET | `/eivital/v1.04/Master?gstin=XXX` | Needs `user_name` header (lowercase underscore) |

### e-Invoice (IRN) Generation — What Happens

When user clicks "e-Invoice + EWB" on a shipment:

1. **Find/Create Invoice**: Looks up linked invoice via DispatchRequest → SalesOrderLine
2. **Build IRN Payload**: Maps invoice data to NIC e-Invoice schema v1.1
3. **Generate IRN**: POST to `/eicore/v1.03/Invoice`
4. **Store IRN**: Saves `irn`, `irnAckNo`, `irnDate`, `irnStatus` on Shipment
5. **Generate EWB from IRN**: POST to `/eiewb/v1.03/ewaybill` with transport details
6. **Store EWB**: Saves `ewayBill`, `ewayBillDate`, `ewayBillExpiry`, `ewayBillStatus`

### IRN Payload Structure (NIC e-Invoice Schema v1.1)
```typescript
{
  Version: '1.1',
  TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
  DocDtls: { Typ: 'INV', No: invoiceNo, Dt: 'DD/MM/YYYY' },  // No max 16 chars, alphanumeric + /
  SellerDtls: { Gstin, LglNm, TrdNm, Addr1, Loc, Pin, Stcd, Ph, Em },
  BuyerDtls: { Gstin, LglNm, TrdNm, Pos, Addr1, Loc, Pin, Stcd },  // Pos = Place of Supply (state code)
  ItemList: [{
    SlNo, PrdDesc, IsServc: 'N', HsnCd, Qty, Unit, UnitPrice, TotAmt,
    AssAmt,  // Assessable Amount — REQUIRED
    GstRt, IgstAmt, CgstAmt, SgstAmt, TotItemVal,
    // All monetary values: MAX 2 DECIMAL PLACES (NIC rejects 0.025)
  }],
  ValDtls: { AssVal, CgstVal, SgstVal, IgstVal, TotInvVal },
}
```

### Cancel IRN
- **Within 24 hours only** — after that, use Credit Note
- Reason codes: `1`=Duplicate, `2`=Data entry mistake, `3`=Order cancelled, `4`=Others
- Cancelling IRN auto-cancels linked EWB
- Frontend: Red "Cancel IRN" button on shipments with active IRN
- Route: `POST /api/shipments/:id/cancel-irn` with `{ reason, remarks }`

### GSTIN Lookup
- Auto-fills customer form: name, trade name, address, city, state, pincode, PAN
- Returns: `{ Gstin, TradeName, LegalName, AddrBno, AddrSt, AddrLoc, StateCode, AddrPncd, Status }`
- Route: `GET /api/customers/gstin-lookup/:gstin`
- Frontend: Search icon button next to GSTIN field in Customer form

### HSN Codes (validated by NIC)
```
DDGS       → 23033000  (5% GST)
ETHANOL    → 22072000  (18% GST)
ENA        → 22071090
RS         → 22071019
LFO        → 27101960
HFO        → 27101950
CO2        → 28112100
MAIZE      → 10059000
RICE       → 10063090
```

### GST Logic
- **Intra-state** (seller & buyer same state): Split into CGST + SGST (each = rate/2)
- **Inter-state** (different states): Full IGST
- Place of Supply (`Pos`): Buyer's state code, determines intra/inter-state
- Seller state: `23` (Madhya Pradesh)
- All amounts must be rounded to 2 decimal places: `round2(val)` helper

---

## PDF Generation

All PDFs use PDFKit with MSPIL letterhead from `utils/letterhead.ts`.

| PDF | Route | Content-Disposition |
|-----|-------|-------------------|
| Delivery Challan | `GET /api/shipments/:id/challan-pdf` | `inline` (opens in browser) |
| Gate Pass | `GET /api/shipments/:id/gate-pass-pdf` | `inline` |
| Tax Invoice | `GET /api/invoices/:id/pdf` | `inline` |
| Purchase Order | `GET /api/purchase-orders/:id/pdf` | `inline` |
| DDGS Invoice | `GET /api/ddgs-dispatch/:id/invoice-pdf` | `inline` |
| DDGS Challan | `GET /api/ddgs-dispatch/:id/challan-pdf` | `inline` |

**PDF margin fix**: Use `bottom: 0` to prevent blank second pages on single-page documents.

---

## Common Issues & Fixes

### "Invalid Token" (1005) on IRN generation
- **Cause**: Wrong API credentials. `api_mspil2005` (EINV user) is NOT mapped to Saral client ID.
- **Fix**: Use `EWAY_EWB_USERNAME=API_MHKSPIL_RELYON` for ALL Saral API calls.

### "GSTIN is invalid" (3028)
- **Cause**: Buyer GSTIN doesn't exist in NIC's GST registry.
- **Fix**: Use real GSTINs. Test GSTINs like `09AABCA1234F1Z5` are rejected by production NIC.

### NIC payload validation (5002)
- Missing `POS` (Place of Supply) → Add `Pos: buyerStateCode` to BuyerDtls
- Missing `IsServc` → Add `IsServc: 'N'` to each item
- Missing `AssAmt` → Add `AssAmt: baseAmount` to each item
- Decimal precision → Use `round2()` for all monetary values

### UND_ERR_SOCKET from Railway
- **Cause**: Railway's network to saralgsp.com is intermittent.
- **Fix**: 3 retry attempts with exponential backoff (2s, 4s), 45s timeout.

### PDFs downloading instead of opening
- Ensure `Content-Disposition: inline` (not `attachment`) in response headers.
- Already set on all PDF routes.

---

## Critical Rules
- **Never hardcode** GSTIN, company address, or API credentials — use env vars and `COMPANY` from `shared/config/company.ts`
- **shipments.ts is ~1100 lines** — be careful with edits, test thoroughly
- **FreightManagement.tsx is ~1874 lines** — largest frontend file
- **DispatchRequest status** must advance sequentially — validate current status before transitioning
- **Invoice document number** for NIC: max 16 chars, pattern `^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$`
- **All Saral API calls** use the same EWB user credentials — never use separate EINV credentials
- **Token expiry**: Parse actual `tokenExpiry` from IRP response, don't assume flat duration
