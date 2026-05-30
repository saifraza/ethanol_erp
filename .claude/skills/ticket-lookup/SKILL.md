---
name: ticket-lookup
description: Read-only 360-degree lookup for a single weighbridge ticket. Runs `node scripts/ticket-lookup.js <ticketNo>` to merge factory weighment, photos, ML training cycle, correction log, and the full cloud chain (GRN, PO, vendor invoice, payment / DispatchTruck) into one chronological view. Use when the user says "check ticket N", "look up ticket N", "pull ticket N info", "show me everything about ticket N", or names a "ticket number NNNN".
when_to_use: User wants the complete picture for one ticket across factory + cloud — weighment details, gate/gross/tare times, lab result, photos, every field correction, and the inbound/outbound accounting chain. Diagnosing a mismatched GRN, a suspicious correction, or a sync/mirror-version problem on a specific ticket.
---

# Ticket Lookup — Full 360-degree View

One command pulls the full picture for one ticket: factory weighment + cloud GRN/PO + photos + ML training cycle (if any) + audit log. Read-only.

## Hard rules

- READ-ONLY. This is a lookup; never mutate factory or cloud data from here.
- Factory DB (`100.126.101.7`) is SELECT-only for Claude. The factory side runs `ticket-query.js` and returns JSON — never INSERT/UPDATE/DELETE/DDL.

## Usage

```bash
node scripts/ticket-lookup.js <ticketNo>
```

## What it pulls

1. **Factory Weighment** (via SSH to 100.126.101.7, local Postgres)
   - Vehicle, driver, transporter, supplier/customer
   - Gate entry / gross / tare times (IST 12h)
   - Weights, lab result, shift, operator
   - Cloud sync status
2. **Photos** → `~/Desktop/ticket-NNNN/`
   - `gross_cam1.jpg`, `gross_cam2.jpg`, `tare_cam1.jpg`, `tare_cam2.jpg`
3. **Training cycle manifest** (if post-2026-04-17)
   - Cycle duration, motion events, captured max weight
   - DIRECT vs fuzzy label source
   - Noise / unmatched classification
4. **WeighmentCorrectionLog** (factory audit log)
   - Every field correction with before/after + timestamp
5. **Cloud chain**
   - **INBOUND**: Weighment mirror · GRN (status, qty, amount, quality, payment) · PO (vendor, rate, status) · Vendor invoice
   - **OUTBOUND**: Weighment mirror · DispatchTruck rows
6. **Audit trail (chronological)** — one ordered timeline merging:
   - Weighment created · Gate entry · Gross / Tare captured · Lab tested
   - Every correction (field, old → new, applied-at, who approved)
   - Cloud sync · Mirror push (with version bump)
   - GRN created · GRN updated · Payment linked · Invoice booked / paid

## Under the hood

- `scripts/ticket-lookup.js` — local driver (pulls photos, queries cloud)
- `factory-server/scripts/ticket-query.js` — runs on factory, returns Weighment + CorrectionLog as JSON
- Cloud queries use `backend/node_modules/@prisma/client` + `backend/.env` `DATABASE_URL`

## Requirements

- `sshpass` installed locally (`brew install sshpass`)
- Tailscale up (factory at 100.126.101.7)
- `backend/.env` has a live Railway `DATABASE_URL`
- Factory side has `scripts/ticket-query.js` (SCP'd during deploy if missing)

## Example

```bash
$ node scripts/ticket-lookup.js 131

Ticket 0131 — full 360° view
============================================================

## Weighment (factory)
Vehicle:      MP20ZT6644 (Truck 6 Wheel)
Direction:    INBOUND · RICE HUSK (FUEL)
...

## Cloud chain
Mirror version: 29
GRN #153 · 8 Apr 2026, 1:25 pm · CONFIRMED
  Vendor:   HIMANSH ENTERPRISES DEEPAK BHAGTANI (JABALPUR)
  PO:       #61
  Qty:      13.5 MT of RICE HUSK
  Amount:   ₹87,750
...
```

## Gotchas

- If ticket has two cycles (e.g., gross and tare far apart), the script shows the first weighment row. Tickets are unique per weighment in new schema (`@unique` index on `ticketNo`).
- OUTBOUND path only pulls `DispatchTruck` today — add SalesOrder / Shipment / Invoice lookup when needed.
- Mirror version >5 is a hint something was re-corrected — cross-check the CorrectionLog.
- "qualityStatus: PENDING" + "status: CONFIRMED" is a known inconsistency for auto-GRNs (operator never confirmed quality manually).
