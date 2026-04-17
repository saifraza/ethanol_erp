# Invoice Snapshot — Immutability Spec

> **Status:** Proposed, not built. Write this before touching any invoice code.
> **Motivation:** 2026-04-16/17 DB damage wiped GST breakdowns on 71 invoices. Render logic recomputes from live DB columns, so any DB drift silently changes printed invoices. GST law requires the issued invoice to be frozen forever. This fixes that.

## The problem

Today's render path:
```
Invoice #248 → read Invoice row → JOIN Customer, Shipment, Lifting, Settings → render HBS → PDF
```
Any change (typo fix in customer address, rate revision, Settings update) silently changes the "same" invoice's output. There is no notion of "the invoice as it was issued".

## The fix — snapshot at IRN-generation time

When the e-invoice call to NIC succeeds and returns an IRN:

1. Build a full self-contained snapshot JSON — everything needed to render the PDF with zero further DB reads.
2. Save JSON to disk (Railway volume + S3/object storage mirror).
3. Save rendered PDF alongside.
4. Compute SHA256 of both, store in DB.
5. Future views load the PDF from disk. DB row becomes metadata only.

## Snapshot shape (v1)

```json
{
  "schemaVersion": 1,
  "invoiceNo": 248,
  "irn": "1355ddb82013da0a6b176590f88f5b6ca5f7f6f40d0fe1f7c9d00696564e1b00",
  "ackNo": "162624317786843",
  "ackDate": "2026-04-16T14:30:00+05:30",
  "signedQRCode": "…base64…",
  "signedInvoicePayload": { "…full NIC response…" },
  "issuedAt": "2026-04-16T14:30:01+05:30",

  "supplier": {
    "name": "Mahakaushal Sugar & Power Industries Ltd",
    "gstin": "23AADCM0622N1Z0",
    "address": "…",
    "stateCode": "23"
  },
  "buyer": {
    "name": "MASH BIO-FUELS PRIVATE LIMITED",
    "gstin": "21AAOCM6766C1ZF",
    "address": "…",
    "stateCode": "21"
  },
  "shipTo": { "…same shape…" },

  "lines": [
    {
      "description": "JOBWORK CHARGES FOR DDGS PRODUCTION",
      "hsnCode": "998817",
      "quantity": 25.46,
      "unit": "MT",
      "rate": 5256.08,
      "amount": 133839.2,
      "gstPercent": 18,
      "cgstPercent": 0, "cgstAmount": 0,
      "sgstPercent": 0, "sgstAmount": 0,
      "igstPercent": 18, "igstAmount": 24091.06
    }
  ],

  "totals": {
    "subTotal": 133839.2,
    "cgstTotal": 0, "sgstTotal": 0, "igstTotal": 24091.06,
    "gstTotal": 24091.06,
    "freight": 0, "other": 0, "roundOff": 0,
    "grandTotal": 157930.26,
    "amountInWords": "Rupees One Lakh Fifty Seven Thousand Nine Hundred Thirty And Twenty Six Paise Only"
  },

  "references": {
    "ethanolLiftingId": "…uuid…",
    "ddgsDispatchTruckId": "…uuid…",
    "shipmentId": "…uuid…",
    "poId": null,
    "contractNo": "MSPIL/JW/MASH/2026-01"
  },

  "bank": {
    "name": "State Bank of India",
    "branch": "Gadarwara",
    "accountNo": "…",
    "ifsc": "…"
  },

  "terms": "…payment terms text…",
  "placeOfSupply": "21-Odisha",
  "reverseCharge": false,
  "supplyType": "B2B"
}
```

## Data model changes

Add to `Invoice` model (additive only — no breaking changes):
```prisma
snapshotJsonPath  String?    // e.g. snapshots/2026/04/INV-248.json
snapshotPdfPath   String?    // e.g. snapshots/2026/04/INV-248.pdf
snapshotJsonSha   String?    // SHA256 hex of JSON bytes
snapshotPdfSha    String?    // SHA256 hex of PDF bytes
snapshotAt        DateTime?  // when frozen
```

Nullable = old invoices keep working the old way. New invoices populate these.

## Storage layout

```
<storage-root>/snapshots/
  2026/04/
    INV-248.json   (~4-8 KB)
    INV-248.pdf    (~80-200 KB)
    INV-247.json
    INV-247.pdf
```

**Two places:**
1. Railway volume mount (primary) — fast read for PDF serving
2. S3-compatible object storage (mirror) — long-term retention, immutable with Object Lock

Write to (1) synchronously during invoice creation. Push to (2) via background job (can retry).

## Code changes — where

Today's flow (backend/src/routes/invoices.ts) generates invoice after `nextDocNo`. Wire snapshot after e-invoice:

1. `createInvoice()` → writes Invoice row → calls `eInvoiceService.submit(invoice)`
2. `eInvoiceService.submit` returns `{ irn, ackNo, qrCode, payload }`
3. **NEW:** `invoiceSnapshotService.freeze(invoiceId)`:
   - Gather all joined data NOW (customer, lines, bank, etc.)
   - Render `invoice.hbs` → PDF
   - Build snapshot JSON
   - Compute SHA256 of both
   - Write files to volume
   - Update `Invoice` row with paths + SHA + `snapshotAt`
4. From that moment, `GET /invoices/:id/pdf` serves the file from disk + verifies SHA. Never regenerates.

## Read path — 3 modes

| Caller wants… | Behavior |
|---|---|
| View frozen invoice PDF | Stream file from volume. Verify SHA on serve. If mismatch → critical alarm. |
| Re-render with updated branding (rare) | **Blocked.** Surface error: "Invoice is frozen. Create a CREDIT_NOTE + new INVOICE instead." |
| Show invoice list summary | Read Invoice row fields (invoiceNo, customer, total, IRN) — these are display metadata, not authoritative. |

## Edge cases

- **Snapshot write fails after IRN success:** IRN at NIC is already generated and cannot be cancelled immediately. Retry snapshot write inline 3x; if all fail, write to a fallback location + alarm admin. Never rollback the IRN.
- **Invoice cancellation via NIC (within 24h):** Mark snapshot `cancelled: true` in a sidecar `INV-248.cancellation.json`. Original snapshot stays immutable.
- **Credit note / debit note:** Same pattern, own IRN, own snapshot file.
- **Historical invoices without snapshot:** Run a one-time backfill job that generates snapshots from current DB state — flag those as `snapshotAt = <backfill date>` and `snapshotBackfilled = true` so auditors know they're reconstructions.

## Rollout plan

1. **Phase 1 (week 1):** Build service. Shadow-write snapshots for every new invoice alongside existing flow. PDF still served by HBS render. Compare daily: is snapshot-PDF === live-render?
2. **Phase 2 (week 2):** Flip read path — new invoices served from snapshot. Old invoices still via live render.
3. **Phase 3 (week 3):** Backfill snapshots for all historical invoices (flag `snapshotBackfilled=true`).
4. **Phase 4 (month 2):** Remove the "live render" code path entirely. All reads go through snapshot.

Each phase is reversible. Only phase 4 is one-way.

## Testing requirements

- Byte-for-byte equality of live-render vs snapshot-render during phase 1 (automated).
- SHA mismatch must alarm loudly (Slack + Telegram + email).
- Snapshot JSON schema validated against a Zod schema on write.
- Load test: 1000 concurrent PDF reads from volume vs live render (volume should be ~50x faster).
- Disaster drill: wipe Invoice table. Verify all PDFs still render from snapshots + SHAs still match.

## What this protects against (post-mortem)

The 2026-04-16/17 damage would have been fully invisible to customers with this in place:
- GST breakdown wiped on 71 invoices → **no effect** — snapshot JSON has the breakdown
- EthanolLifting.invoiceId wiped → **no effect** — snapshot.references has the lifting id frozen
- Customer address typo fix a week after issue → **no effect** — snapshot has the address as it was

The only remaining risk: snapshot files themselves getting deleted. Mitigated by:
- Object Lock on S3 bucket (WORM mode)
- Daily SHA audit: recompute SHA of every snapshot file, match against DB, alarm on drift

## Open questions (ask user before building)

1. S3 bucket or Railway volume only? (Volume is simpler, S3 is safer)
2. Naming convention: `INV-248.pdf` or `MSPIL-ETH-248.pdf`?
3. Retention: keep forever, or purge after 8 years (GST rule)?
4. Encryption: encrypt JSON at rest? (Buyer PII lives there)
5. Credit/debit notes — same snapshot system or separate?

---

**For future Claude session picking this up:** start with Phase 1. Write the `invoiceSnapshotService` class. Shadow-write only. Don't touch read path until Phase 2. All 4 phases are reversible until Phase 4 — treat Phase 4 like a major deploy (maintenance window, backups, rollback plan).
