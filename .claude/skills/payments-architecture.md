# Payments Architecture — vendor / contractor / transporter / cash

> **Read first** before touching `unifiedPayments.ts`, `paymentsByPo.ts`, `vendorPayments.ts`, `contractorBills.ts`, or any payments-out / store-payments / fuel-payments page. Mistakes here double-count money.

## The four payment-out tables

There is **no single "payment" table**. Payments-out is a union view across four sources:

| Table | Holds | Created by | Frontend |
|---|---|---|---|
| `VendorPayment` | Cash + bank payments to vendors against POs / VendorInvoices | `/api/purchase-orders/:id/pay`, `/api/vendor-payments/*`, fuel deal payments | PaymentsTable Pay dialog (PO surface) |
| `ContractorPayment` | Payments to contractors against ContractorBill (which links to WO or PO) | `/api/contractor-bills/:id/pay` | PaymentsOut Pending tab — contractor row "Pay" |
| `TransporterPayment` | Freight payments against shipments | `/api/transporter-payments/*` | PaymentsOut Completed tab (no inline Pay) |
| `CashVoucher` | Petty-cash + voucher-style payouts (not always against a PO) | `/api/cash-vouchers/*` | CashVouchers page; settled cash vouchers also create a `VendorPayment` with `reference: CV-{n}` so they appear once on the unified view (NOT double-counted — see `unifiedPayments.ts`) |

**Read this**: when a cash voucher is *settled* against a PO, the settle handler writes a `VendorPayment` with `reference: CV-{voucherNo}`. That's why `unifiedPayments.ts` does NOT add cash voucher amounts when the matching VendorPayment already exists — would otherwise double-count.

## The two backend listing endpoints

### 1. `/api/fuel/payments?category=…` → `listPaymentRows()` in `paymentsByPo.ts`

Returns one `PaymentRow` per **PurchaseOrder** in the requested inventory categories. This is the row shape the shared `<PaymentsTable>` component renders. Used by:

- Fuel Management → Payments tab (`?category=FUEL`, no chips)
- Store Payments page (`?category=CHEMICAL,PACKING,SPARE,CONSUMABLE,GENERAL` + `?includeContractorBills=true`)
- Raw Material Purchase → Payments tab (`?category=RAW_MATERIAL`)

**`includeContractorBills=true`** appends ContractorBill rows with `kind: 'CONTRACTOR_BILL'` and `sourceLabel` (`WO-{n}` if WO-backed, else `BILL-{n}`). This is what lets Store Payments show POs and WOs in one list — Fuel and RM don't pass it.

Each PO row's outstanding uses a fallback chain: `RECEIVED` (GRN value) → `INVOICED` (vendor invoice net) → `PLANNED` (PO total). `PLANNED` rows hide the Pay button on purpose (no delivery / billing evidence yet).

### 2. `/api/unified-payments/outgoing/*` in `unifiedPayments.ts`

Returns the **union** of VendorPayment + TransporterPayment + ContractorPayment + CashVoucher, paginated. Used by `/accounts/payments-out`. Sub-endpoints:

- `/outgoing` — completed payments (default Completed tab)
- `/outgoing/summary` — KPIs for completed
- `/outgoing/pending` — POs awaiting invoice/payment + open ContractorBills (each row carries `kind`, `sourceLabel`, `workOrderNo` since PR #85)
- `/outgoing/pending-summary` — KPIs for pending
- `/outgoing/outstanding` — overdue items per party

The Pending tab on `PaymentsOut.tsx` reads `kind` to render a Type pill (PO blue / WO+BILL purple) and supports a Type filter.

## Pay flow — which endpoint to call

| Row source | Pay endpoint | Body |
|---|---|---|
| PO row (any category) via `paySurface='generic'` | `POST /api/purchase-orders/:id/pay` | `{ amount, mode, reference, remarks, hasGst }` |
| PO row via `paySurface='fuel'` (legacy fuel-deal flow) | `POST /api/fuel/deals/:id/payment` | `{ dealId, amount, mode, reference, remarks }` |
| ContractorBill row (kind=CONTRACTOR_BILL) | `POST /api/contractor-bills/:id/pay` | `{ amount, tdsDeducted, paymentMode, paymentRef, paymentDate, remarks }` |
| TransporterPayment | `POST /api/transporter-payments` | `{ shipmentId?, amount, mode, ... }` |

`PaymentsTable.tsx` currently disables the inline Pay button on `kind === 'CONTRACTOR_BILL'` rows and opens `/accounts/payments-out?contractorId=…` instead — there's no PayDialog variant for contractor bills yet. If you build one, follow the contractor-bill body shape above.

## Outstanding / paid-status logic — the gotchas

- `outstanding = max(0, payableBasis - totalPaid - pendingBank - pendingCash)` where `pendingBank` = INITIATED VendorPayments (UTR not yet entered), `pendingCash` = ACTIVE CashVouchers.
- A row is fully paid when `payableBasis > 0 && totalPaid + pendingBank + pendingCash >= payableBasis - 0.01`.
- `lastPaymentDate` only counts CONFIRMED payments — INITIATED and ACTIVE don't qualify.
- Fuel / OPEN-deal POs have `grandTotal: 0` because the value is unknown until GRN — `payableBasis` falls through to `RECEIVED` (GRN value).
- Direct VendorPayments without an invoice (common for fuel) are matched to a PO by `remarks LIKE 'PO-{n}%'`. Don't change that pattern without grepping every consumer.

## Where things show up

| Page | Surface | Categories | Includes WO bills? |
|---|---|---|---|
| `/accounts/payments-out` | unified-payments | All | Yes |
| `/store/payments` | listPaymentRows | CHEMICAL, PACKING, SPARE, CONSUMABLE, GENERAL | Yes (`includeContractorBills`) |
| Fuel Management → Payments | listPaymentRows | FUEL | No |
| Raw Material → Payments | listPaymentRows | RAW_MATERIAL | No |

## Schema columns to know

- `Settings.whatsapp*`, `CompanyDocument.rag*`, `VaultNote.ragIndexed` — unused since PR #77, retained to avoid destructive migration
- `WorkOrder.transportRateCard` (PR #93) — JSON array; only set when `contractType='TRANSPORT'`
- `WorkOrder.manpowerRateCard` — JSON array; only set when `contractType='MANPOWER_SUPPLY'`
- `ContractorBill.workOrderId` / `purchaseOrderId` — bills can be backed by either; sourceLabel prefers WO# when present
- `VendorPayment.paymentStatus` — `INITIATED | CONFIRMED | CANCELLED`. Only CONFIRMED counts as paid; INITIATED is "bank file built, UTR not entered yet"

## When changing things here

1. **Don't break the row shape silently** — `PaymentRow` (frontend `components/payments/types.ts`) and `PaymentRowOut` (backend `paymentsByPo.ts`) must agree. New fields go on both.
2. **Run the smoke test on prod-like data** — Fuel + RM + Store + PaymentsOut all four pages should render and pay. The category filter on Store Payments has skipped contractor rows in the past — the `kind === 'PO'` check in `filteredPending` is what stops it.
3. **Never add another listing endpoint** — extend the existing two. Three was already too many.
