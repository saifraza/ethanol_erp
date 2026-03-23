# Fermentation Module

## Files
- **Backend**: `routes/fermentation.ts`, `routes/preFermentation.ts`, `routes/dosingRecipes.ts`
- **Frontend**: `pages/process/Fermentation.tsx`, `pages/process/PreFermentation.tsx`, `pages/process/DosingRecipes.tsx`
- **Models**: FermentationBatch, FermentationEntry, PFBatch, PFEntry, PFLabReading, PreFermentationEntry, BeerWellReading, DosingRecipe, DosingChemical, PFChemical, FermChemical, FermDosing, PFDosing

## Plant Layout
- **4 fermenters** (F1-F4): 2,300 liters each (PLANT.fermenters.capacityLiters)
- **2 pre-fermenters** (PF1-PF2): 430 liters each (PLANT.preFermenters.capacityLiters)
- **Beer well**: 430 liters (PLANT.beerWell.capacityLiters)
- Pre-fermenter feeds into fermenter — PF must be READY before fermenter starts FILLING

## Batch Phase Lifecycle
```
FILLING → REACTION → READY → DRAINING → EMPTY
```
- **FILLING → REACTION**: When level reaches target (within 0.005 tolerance)
- **REACTION → READY**: When spGravity drops below pfGravityTarget (default 1.024)
- **READY → DRAINING**: Manual trigger by operator
- **DRAINING → EMPTY**: Manual trigger by operator
- **Retention time** = hours from FILLING start to DRAINING start (target: 8 hours)

## Lab Readings (FermentationEntry)
- Tracked per batch: level, temperature, spGravity (specific gravity), pH
- `analysisTime` records when reading was taken
- Readings auto-advance batch phase based on level/gravity thresholds
- Frontend polls `/overview` endpoint every 30 seconds for live vessel status

## Dosing
- DosingRecipe defines chemicals added at each phase
- PFDosing/FermDosing tracks actual additions per batch
- PFChemical/FermChemical are the chemical inventory models

## Critical Bugs to Avoid
- **Race condition**: Two simultaneous lab readings can both trigger phase advancement — wrap state transitions in `prisma.$transaction`
- **Unbounded queries**: `/anomaly/:fermenterNo` fetches ALL entries — always add `take` limit
- **N+1 in history**: `/history` loops 50 batches making individual queries — use `findMany({ where: { batchNo: { in: batchNos } } })` instead
- `fermenterNo` field: 1-4 for fermenters, 1-2 for pre-fermenters — validate range on input

## Indexes
- FermentationEntry: [batchNo, fermenterNo], [date], [createdAt], [fermenterNo]
- FermentationBatch: [phase], [createdAt]
- PFBatch: [phase], [createdAt]
- BeerWellReading: [createdAt]
