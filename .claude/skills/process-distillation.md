# Distillation & Downstream Module

## Files
- **Backend**: `routes/distillation.ts`, `routes/ethanolProduct.ts`, `routes/dispatch.ts`, `routes/evaporation.ts`, `routes/dryer.ts`, `routes/decanter.ts`, `routes/ddgsStock.ts`, `routes/ddgsDispatch.ts`, `routes/ddgs.ts`, `routes/calibration.ts`
- **Frontend**: `pages/process/Distillation.tsx`, `pages/process/EthanolProduct.tsx`, `pages/process/EthanolDispatch.tsx`, `pages/process/Evaporation.tsx`, `pages/process/DryerMonitor.tsx`, `pages/process/Decanter.tsx`, `pages/process/DDGSStock.tsx`, `pages/process/DDGSDispatch.tsx`
- **Models**: DistillationEntry, EthanolProductEntry, DispatchTruck, EvaporationEntry, DryerEntry, DecanterEntry, DDGSProductionEntry, DDGSStockEntry, DDGSDispatchTruck

## Process Flow
```
Fermented wash → Distillation → Ethanol Product (tanks)
                               → Spent wash → Decanter → Evaporation → Dryer → DDGS
```

## Ethanol Product Tracking
- EthanolProductEntry: daily record of tank dip readings, strength (% v/v), production
- **Production (BL)** = currentTotalStock - prevTotalStock + totalDispatch
- Tank readings use calibration data (84,470 entries in calibrations.json, cached 24h)
- All volumes in **BL (Bulk Liters)** at standard temperature — don't confuse with KG or regular liters
- Opening stock (1,357,471 BL) is hardcoded — should come from Settings model

## DDGS Tracking
- DDGSStockEntry: daily production + stock levels
- DDGSDispatchTruck: individual truck dispatches with PDF invoice generation
- DDGS invoices: GST rate 5% (GST.defaultRate), HSN code 2303.30.00 (GST.hsnCodes.ddgs)
- Invoice number prefix `GST/25-26/` is hardcoded — needs dynamic year detection

## Dispatch (Ethanol)
- DispatchTruck: records each truck leaving with ethanol
- Links to EthanolProductEntry via entryId
- Measured in BL with temperature correction

## Critical Issues
- **dispatch.ts**: Path traversal was fixed with path.basename on `/photo/:filename`
- **DDGS stock race condition**: Two simultaneous dispatches can overwrite each other — use `{ increment: amount }` in Prisma update
- **Calibration endpoint**: Sends all 84K entries — cached for 24 hours via Cache-Control header
- EthanolProductEntry calculations depend on previous day — always fetch prev entry

## Indexes
- DistillationEntry: [date]
- EvaporationEntry: [date]
- DispatchTruck: [date], [entryId]
- DDGSDispatchTruck: [date]
