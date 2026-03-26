# Gate Entry + GRN + Sales + Logistics Integration Plan

## Overview

The factory has two gates of material flow:
- **INBOUND**: Raw materials/chemicals coming IN (Procurement → Gate → GRN → Inventory)
- **OUTBOUND**: Finished goods going OUT (Sales → Dispatch → Gate → Shipment)

Both flows pass through the Gate Register, which is the physical checkpoint.

---

## Current State (What Exists)

| Module | Status | Notes |
|--------|--------|-------|
| Gate Register | Frontend only, backend just added | GateEntry model + CRUD routes created |
| GRN (Goods Receipt) | Working | Creates procurement receipts, now syncs to inventory |
| Shipments | Working | Tracks outbound dispatches in Sales |
| Dispatch Requests | Working | Sales creates requests, logistics fulfills |
| Transporters | Working | Transporter master data |
| Freight Management | Fixed | Was crashing, now works |
| Inventory Movements | Working | Stock in/out with audit trail |

---

## Target Flow: INBOUND (Purchase → Gate → GRN → Inventory)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Purchase    │     │  Gate Entry  │     │  Weighbridge │     │  Quality     │     │  GRN          │
│  Order (PO)  │────→│  (Vehicle    │────→│  (Gross      │────→│  Check       │────→│  (Accept/     │
│  Approved    │     │   arrives)   │     │   weight)    │     │  (Lab test)  │     │   Reject)     │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └───────┬───────┘
                     Status: INSIDE       grossWeight set      Optional step                │
                                                                                           ▼
                                                                               ┌───────────────────┐
                                                                               │  Inventory Receipt │
                                                                               │  (Stock + AvgCost) │
                                                                               └───────────────────┘
```

### Implementation Steps:

1. **PO Approved** → Shows in GRN page "Pending POs" section ✅ (done)

2. **Vehicle Arrives at Gate** → Security creates Gate Entry
   - Auto-suggest: If PO exists for this vendor, link to PO
   - Fields: vehicleNo, driver, vendor, material, entryTime
   - Direction: INBOUND
   - Status: INSIDE

3. **Weighbridge** → Update Gate Entry with grossWeight
   - Status: stays INSIDE or moves to LOADING (for outbound)
   - Future: integrate weighbridge hardware

4. **Quality Check** (optional) → Lab team tests samples
   - Already exists: LabSample module
   - Future: link lab sample to gate entry

5. **GRN Created** → Link to Gate Entry
   - GRN form shows "Select Gate Entry" dropdown (vehicles currently inside)
   - Gate Entry ID stored on GRN record
   - Vehicle's netWeight = grossWeight - tareWeight (calculate from accepted qty)

6. **GRN → Inventory** → Auto-create stock movement ✅ (done)
   - Weighted average cost recalculated
   - Stock level updated in warehouse

7. **Vehicle Exits** → Update Gate Entry
   - Status: DISPATCHED or EMPTY_OUT
   - exitTime recorded
   - Second weighbridge for tare weight (future)

---

## Target Flow: OUTBOUND (Sales → Dispatch → Gate → Shipment)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Sales Order │     │  Dispatch    │     │  Gate Entry  │     │  Loading     │     │  Shipment     │
│  Confirmed   │────→│  Request     │────→│  (Vehicle    │────→│  (Fill tank/ │────→│  (Docs +      │
│              │     │  (Logistics) │     │   arrives)   │     │   load bags) │     │   Invoice)    │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └───────┬───────┘
                     Logistics team       Status: INSIDE       Status: LOADING              │
                     arranges transport                        → LOADED                     ▼
                                                                               ┌───────────────────┐
                                                                               │  Inventory Issue   │
                                                                               │  (Stock goes down) │
                                                                               └───────────────────┘
```

### Implementation Steps:

1. **Sales Order** → Sales team creates dispatch request ✅ (exists)

2. **Logistics Assigns Transport** → Transporter + vehicle allocated
   - Freight rate negotiated or from rate master
   - Transport By: own fleet vs third-party vs supplier arrangement

3. **Vehicle Arrives** → Gate Entry created
   - Direction: OUTBOUND
   - Link to Dispatch Request / Sales Order
   - Status: INSIDE

4. **Loading** → Status: LOADING → LOADED
   - Loading supervisor confirms quantities
   - Weighbridge: grossWeight after loading

5. **Shipment Created** → Link to Gate Entry
   - Challan, E-way bill, invoice generated
   - Gate Entry updated with shipmentId
   - Status: DISPATCHED
   - exitTime recorded

6. **Inventory Issue** → Auto-deduct stock
   - Stock movement: SALES_ISSUE
   - Stock level reduced in warehouse

---

## Database Changes Needed

### Already Done:
- [x] GateEntry model with direction, grnId, shipmentId links
- [x] GateEntry CRUD routes
- [x] GRN → Inventory sync
- [x] VendorItem pricing model

### Still Needed:
- [ ] Add `gateEntryId` field to GoodsReceipt model
- [ ] Add `gateEntryId` field to Shipment model
- [ ] GRN form: dropdown to select gate entry (filter INBOUND + INSIDE status)
- [ ] Shipment form: dropdown to select gate entry (filter OUTBOUND + LOADED status)
- [ ] Gate Register page: show linked PO/GRN for inbound, linked SO/Shipment for outbound
- [ ] Auto-create gate entry when dispatch request is assigned a vehicle

---

## Sidebar Structure (Done)

**SALES**: Buyers, Sales Pipeline, Dispatch Requests, Ethanol Supply
**LOGISTICS**: Gate Register, Shipments, Transporters, Freight & Rates
**PROCUREMENT**: Suppliers, Items, Purchase Orders, GRN
**INVENTORY**: Stock Overview, Item Master, Warehouses, Movements, Ledger, Counts, Valuation, ABC

---

## Priority Order

1. **Phase 1** (Quick wins - mostly done):
   - Gate Entry backend ✅
   - Logistics sidebar ✅
   - GRN → Inventory sync ✅
   - Freight page fix ✅
   - Vendor-item pricing ✅
   - PO form improvements ✅

2. **Phase 2** (Wire connections):
   - Link Gate Entry ↔ GRN (add dropdown to GRN form)
   - Link Gate Entry ↔ Shipment (add dropdown to Shipment form)
   - Show linked records on Gate Register page

3. **Phase 3** (Automation):
   - Auto-create gate entry from dispatch request
   - Auto-create inventory issue on shipment dispatch
   - WhatsApp notifications on gate entry/exit
   - Weighbridge integration (hardware API)

4. **Phase 4** (Reports & Analytics):
   - Daily gate movement report
   - Turnaround time analysis (entry → exit)
   - Vendor delivery performance
   - Transport cost analysis
