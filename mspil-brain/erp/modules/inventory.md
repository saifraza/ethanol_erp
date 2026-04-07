# Inventory Module

## Overview
SAP-style inventory management with warehouses, stock levels, movements, physical counts, and ABC analysis.

## Material Master
- code, name, unit of measure, category
- HSN code, GST percentage
- Reorder point, reorder quantity
- Cost: weighted average cost (WAC)

## Warehouses
- name, location, manager, capacity
- Storage bins within warehouses (binCode, itemId, qty)
- Multiple warehouses supported

## Stock Levels
- Real-time stock per warehouse per item
- Fields: warehouseId, itemId, qty, value, lastUpdated
- Value = qty x avgCost

## Stock Movements
- Types: IN, OUT, TRANSFER, ADJUSTMENT
- Reference links to source (PO, GRN, SO, manual)
- From/to warehouse tracking
- Reason field for adjustments

## Weighted Average Cost (WAC)
When new stock arrives (GRN):
```
newAvgCost = (existingQty x existingAvgCost + incomingQty x incomingRate)
             / (existingQty + incomingQty)
```
Total value always = currentStock x avgCost

## Physical Stock Counts
- Count cycles: DRAFT → IN_PROGRESS → COMPLETED
- Count lines per item: physicalQty, systemQty, variance
- Variance = physicalQty - systemQty
- Adjustment journal entries created for discrepancies

## Reorder Rules
- Per item: minQty, maxQty, reorderPoint, leadDays
- When stock drops below reorderPoint → alert/auto-draft PO

## ABC Analysis
- Classify items by consumption value
- A items: high value (top 20% items, ~80% value)
- B items: medium value
- C items: low value
- Helps prioritize procurement and count frequency

## Stock Valuation
- By cost method (WAC is standard)
- Report: all items with qty, avg cost, total value
- Filterable by warehouse, category

## Store Indents
- Internal requisition (one department requests from another)
- Similar to purchase requisition but for internal stock transfers

## Inventory Transactions Flow

### Inbound
- GRN confirmed → IN transaction → stock level increases → WAC recalculated

### Outbound
- Dispatch confirmed → OUT transaction → stock level decreases
- Production consumption → OUT transaction

### Transfer
- Warehouse A → Warehouse B → TRANSFER transaction
- Source decreases, destination increases

### Adjustment
- Physical count variance → ADJUSTMENT transaction
- Increases or decreases stock to match physical count

## Frontend Pages (9)
- Stock Dashboard — KPIs, movements, low-stock alerts
- Material Master — Item CRUD
- Warehouses — Warehouse management
- Stock Movements — Movement journal
- Stock Ledger — Item movement history
- Stock Count — Physical counting
- Stock Valuation — Value reports
- ABC Analysis — Consumption classification
- Store Indents — Internal requisitions
