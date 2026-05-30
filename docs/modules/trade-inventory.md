# Trade & Inventory Module

## Trade Files
- **Backend**: `routes/directPurchases.ts`, `routes/directSales.ts`
- **Frontend**: `pages/trade/DirectPurchases.tsx`, `pages/trade/DirectSales.tsx`
- **Models**: DirectPurchase, DirectSale

## Trade Logic
- Simplest module — direct buy/sell transactions without the full PO/SO workflow
- DirectPurchase: Buy materials directly (no PO, no GRN)
- DirectSale: Sell products directly (no contract, no dispatch workflow)
- Both have basic CRUD with date, party, material, quantity, rate, amount

## Inventory Files
- **Backend**: `routes/inventory.ts`
- **Frontend**: `pages/Inventory.tsx`
- **Models**: InventoryItem, InventoryTransaction

## Inventory Logic
- InventoryItem: Master list of trackable items (materials, chemicals, spare parts)
- InventoryTransaction: Records stock movements (in/out) with reason and reference
- InventoryTransaction.itemId links to InventoryItem
- Indexes: InventoryTransaction [itemId]

## Plant Issues
- **Backend**: `routes/issues.ts`
- **Frontend**: `pages/PlantIssues.tsx`
- **Models**: PlantIssue, IssueComment

## Plant Issues Logic
- Track maintenance issues, breakdowns, quality problems
- PlantIssue has status workflow (open, in-progress, resolved, closed)
- IssueComment for discussion thread on each issue
- Indexes: PlantIssue [status]

## Watch Out For
- Inventory list has no pagination — add take/skip
- Trade module is the simplest and best candidate for testing new patterns (asyncHandler, validate, etc.)
