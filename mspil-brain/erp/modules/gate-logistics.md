# Gate Entry & Logistics

## Gate Entry Register
Every vehicle entering or leaving the plant is logged.

**Purpose types**:
- GRAIN_IN — Grain delivery truck
- WASTE_OUT — Spent wash, waste disposal
- DISPATCH — Ethanol/DDGS outbound
- RETURN — Returnable containers, job work

**Status**: INSIDE → MOVED → EXITED (tracks in/out times)

**Fields**: entryNo, date, time, vehicleNo, driver, purpose, status

## Weighbridge Integration
- Physical scale connected to Weighbridge PC via serial COM port
- **Stack**: Python Flask + SQLite (port 8098)
- **Flow**: Scale → COM port → Flask → Factory Server → Cloud ERP
- Two weighments per vehicle: tare weight (empty) + gross weight (loaded)
- Net weight = gross - tare

## Factory Server
- Windows PC at plant (192.168.0.10:5000)
- Operator-facing UI for gate entry and weighments
- Connects to same Railway PostgreSQL (remote)
- Pushes data to Cloud ERP via webhooks (WB_PUSH_KEY auth)
- Syncs master data from cloud (vendors, materials, products)

## Grain Truck Records
- Per-truck tracking: truckNo, supplier, tonnage, moisture, quality grade
- Links to gate entry and GRN
- Quality parameters: moisture%, starch%, fungus, immature, damaged

## Dispatch Trucks
- Outbound vehicles for ethanol/DDGS
- Links to dispatch request and shipment
- Status: LOADING → SHIPPED → DELIVERED
- Gate exit requires payment clearance for advance-term orders

## Gate Pass Types
- **Challan** (DC-{no}) — Normal sales dispatch to customer
- **Gate Pass** (GP-{no}) — Returnable items, job work, party agreements
  - GATEPASS_OUTBOUND status for job work items

## Logistics Flow

### Inbound
```
Truck arrives → Gate Entry created (INSIDE) → Weighbridge (tare)
→ Unloading → Weighbridge (gross) → GRN created → Gate Entry (EXITED)
```

### Outbound
```
Dispatch Request approved → Loading → Gate Entry (INSIDE)
→ Weighbridge → Documents generated (challan, e-way bill)
→ Payment check (if advance terms) → Gate Entry (EXITED)
```

## GRN from Gate (Combined Page)
- Frontend: `GateAndReceipts.tsx` — tabbed view for Gate Register + GRN
- Route: `/logistics/gate-register`
- Combined so operators see the full inbound flow in one place
