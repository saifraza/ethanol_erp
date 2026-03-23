# Grain Module Skill

## Files
- Backend: `backend/src/routes/grain.ts` (471 lines), `backend/src/routes/grainTruck.ts` (410 lines)
- Frontend: `frontend/src/pages/process/GrainUnloading.tsx`, `frontend/src/pages/process/GrainUnloadingTrucks.tsx`, `frontend/src/pages/process/RawMaterial.tsx`
- Models: `GrainEntry`, `GrainTruck`, `RawMaterialEntry`, `LabSample` in schema.prisma

## Business Logic
- Grain arrives by truck, gets weighed at gate (GrainTruck), then unloaded into silos
- Daily GrainEntry tracks: unloaded, consumed (milled), silo stocks, flour silo levels, grain in process
- Mass balance: `grainConsumed = max(0, grainDistilled + deltaGrainInProcess + deltaFlour)`
- Year starts from a simple `getCurrentYearStart()` function (calendar year)
- Cumulative tracking: `cumulativeUnloaded` and `cumulativeConsumed` roll forward from previous entry

## Key Calculations (from `calcGrain()` in grain.ts)
- `fermVol = f1Level + f2Level + f3Level + f4Level + beerWellLevel`
- `pfVol = pf1Level + pf2Level`
- `iltFltVol = iltLevel + fltLevel`
- `grainInProcess = (fermVol * fermPct) + (pfVol * pfPct) + (iltFltVol * fermPct)`
- `grainDistilled = (washConsumed - prevWashConsumed) * fermPct`
- `deltaFlour = (flourSilo1Tonnage + flourSilo2Tonnage) - prev`
- `siloClosingStock = siloOpeningStock + grainUnloaded - grainConsumed`
- `totalGrainAtPlant = siloClosingStock + grainInProcess + flourTonnage`
- Settings: `fermPct = grainPercent / 100` (default 31%), `pfPct = pfGrainPercent / 100` (default 15%), `millingLossPct` (default 2.5%)

## GrainTruck Workflow
- Truck arrives → weighed (gross) → unloaded → weighed (tare) → net = gross - tare
- Lab sample linked via `uidRst` field (matches `LabSample.rstNumber`)
- Quarantine: rejected trucks marked with `quarantine: true`, weight tracked separately in `quarantineWeight`
- Quarantined grain does NOT count toward silo stock

## Watch Out For
- `resolveLevel()` helper handles null/undefined levels with fallback to 0
- Cumulative values depend on previous day's entry — always fetch previous entry for calculations
- Date filtering uses `yearStart` field for financial year grouping
- GrainEntry has `@@index([date])` and `@@index([yearStart, date])` for query performance
- Flour silo levels are entered as % but the calculation uses them as tonnage (140 T * level%)
- The `r2()` helper rounds to 2 decimal places: `Math.round(n * 100) / 100`
- 9AM-9AM shift cycle: if current time is before 9AM, the shift date is yesterday
