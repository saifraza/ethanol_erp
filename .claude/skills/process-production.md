# Process & Production Module

## Overview
Complete grain-to-ethanol-to-DDGS production pipeline for MSPIL's distillery. Covers the full process flow from raw grain intake through milling, liquefaction, fermentation, distillation, and downstream byproduct (DDGS) processing.

## Process Flow
```
Grain Intake → Milling → Liquefaction → Fermentation → Distillation → Ethanol Product (tanks)
     (trucks)    (sieves)   (jet cooker)   (PF → F → BW)   (columns)      ↓ Dispatch
                                                               ↓
                                                          Spent Wash → Decanter → Evaporation → Dryer → DDGS
                                                                      (centrifuge)  (concentration)  (drying)  (bags)
```

## Plant Configuration (from `shared/config/constants.ts`)
- **Fermenters**: 4 units × 2,300 L each
- **Pre-Fermenters**: 2 units × 430 L each
- **Beer Well**: 430 L
- **Gravity target**: 1.024 (PF → READY transition)
- **Retention target**: 8 hours (FILLING → DRAINING)
- **Milling loss**: 2.5%
- **DDGS base production**: 3,160 MT
- **GST**: DDGS 5% (HSN 2303.30.00), Ethanol 18% (HSN 2207.20.00)
- **9AM shift cycle**: If current time < 9AM, shift date = yesterday

---

## Files

### Backend
| File | Purpose | Lines |
|------|---------|-------|
| `routes/grain.ts` | Daily grain entry, mass balance, silo tracking | ~471 |
| `routes/grainTruck.ts` | Truck weighing, lab sample linking, quarantine | ~410 |
| `routes/milling.ts` | Sieve analysis (particle size distribution) | |
| `routes/liquefaction.ts` | Jet cooker + ILT/FLT tank readings, iodine test photos | |
| `routes/fermentation.ts` | Fermenter batches, phase lifecycle, lab readings | |
| `routes/preFermentation.ts` | Pre-fermenter batches, phase lifecycle | |
| `routes/dosingRecipes.ts` | Chemical dosing recipes and tracking | |
| `routes/distillation.ts` | Distillation column readings, spent wash photos | |
| `routes/ethanolProduct.ts` | Daily tank dip readings, production calc, dispatch | |
| `routes/dispatch.ts` | Standalone ethanol truck dispatch | |
| `routes/calibration.ts` | Tank DIP→Volume lookup (84K entries, cached 24h) | |
| `routes/evaporation.ts` | Evaporator readings (FF/FC tanks, syrup, reboilers) | |
| `routes/decanter.ts` | Decanter centrifuge feed/cake/slop readings | |
| `routes/dryer.ts` | DDGS dryer moisture/steam/load per dryer | |
| `routes/ddgs.ts` | DDGS production entry (bags, weight, moisture) | |
| `routes/ddgsStock.ts` | Daily DDGS stock balance (upsert by date) | |
| `routes/ddgsDispatch.ts` | DDGS truck dispatch with invoice PDF generation | |
| `routes/dailyEntries.ts` | Daily plant summary with approval workflow | |

### Frontend
| File | Purpose |
|------|---------|
| `pages/process/GrainUnloading.tsx` | Daily grain entry form |
| `pages/process/GrainUnloadingTrucks.tsx` | Truck weighing UI |
| `pages/process/RawMaterial.tsx` | Raw material tracking |
| `pages/process/Milling.tsx` | Sieve analysis form |
| `pages/process/Liquefaction.tsx` | Jet cooker + tank readings |
| `pages/process/Fermentation.tsx` | Fermenter monitoring (polls every 30s) |
| `pages/process/PreFermentation.tsx` | Pre-fermenter monitoring |
| `pages/process/DosingRecipes.tsx` | Chemical dosing management |
| `pages/process/Distillation.tsx` | Distillation readings |
| `pages/process/EthanolProduct.tsx` | Tank levels + production |
| `pages/process/EthanolDispatch.tsx` | Dispatch tracking |
| `pages/process/Evaporation.tsx` | Evaporator readings |
| `pages/process/DryerMonitor.tsx` | Dryer monitoring |
| `pages/process/Decanter.tsx` | Decanter readings |
| `pages/process/DDGSStock.tsx` | DDGS stock balance |
| `pages/process/DDGSDispatch.tsx` | DDGS truck dispatch |

### Prisma Models
GrainEntry, GrainTruck, MillingEntry, LiquefactionEntry, FermentationBatch, FermentationEntry, PFBatch, PFEntry, PFLabReading, PreFermentationEntry, BeerWellReading, DosingRecipe, DosingChemical, PFChemical, FermChemical, FermDosing, PFDosing, DistillationEntry, EthanolProductEntry, DispatchTruck, EvaporationEntry, DryerEntry, DecanterEntry, DDGSProductionEntry, DDGSStockEntry, DDGSDispatchTruck, DailyEntry, LabSample

---

## Module Details

### 1. Grain Intake

#### GrainTruck (truck weighing)
- Truck arrives → weighed gross → unloaded → weighed tare → net = gross - tare
- Lab sample linked via `uidRst` field (matches `LabSample.rstNumber`)
- **Quarantine**: rejected trucks marked `quarantine: true`, weight tracked in `quarantineWeight`
- Quarantined grain does NOT count toward silo stock

#### GrainEntry (daily mass balance)
- Key formula in `calcGrain()`:
  - `fermVol = f1Level + f2Level + f3Level + f4Level + beerWellLevel`
  - `pfVol = pf1Level + pf2Level`
  - `iltFltVol = iltLevel + fltLevel`
  - `grainInProcess = (fermVol × fermPct) + (pfVol × pfPct) + (iltFltVol × fermPct)`
  - `grainDistilled = (washConsumed - prevWashConsumed) × fermPct`
  - `deltaFlour = (flourSilo1Tonnage + flourSilo2Tonnage) - prev`
  - `grainConsumed = max(0, grainDistilled + deltaGrainInProcess + deltaFlour)`
  - `siloClosingStock = siloOpeningStock + grainUnloaded - grainConsumed`
  - `totalGrainAtPlant = siloClosingStock + grainInProcess + flourTonnage`
- Settings: `fermPct` default 31%, `pfPct` default 15%, `millingLossPct` default 2.5%
- Flour silos entered as % but calculated as tonnage (140 T × level%)
- Cumulative values (`cumulativeUnloaded`, `cumulativeConsumed`) roll forward from previous entry

### 2. Milling (Sieve Analysis)
- Tracks particle size distribution after grain milling
- Sieves: 1mm, 850µm, 600µm, 300µm retention percentages
- `calcFine()` = 100 - (sieve_1mm + sieve_850 + sieve_600 + sieve_300)
- Mills A/B/C: RPM, Load (amps)
- Routes: `GET /` (list), `GET /chart` (60 chronological), `GET /latest`, `POST /`, `PUT /:id`, `DELETE /:id`

### 3. Liquefaction
- Jet cooker temperature and flow monitoring
- ILT/FLT tank readings: Temp, Sp.Gravity, pH, RS, DS, TS, Brix, Viscosity, Acidity, Level
- Flow tracking: FLT, Flour, Hot water, Thin slop recycle, Slurry, Steam flows
- Iodine test result with photo upload (multer → `/uploads/iodine/`)
- Routes: `GET /`, `POST /` (with photo), `PUT /:id`, `DELETE /:id`

### 4. Fermentation

#### Batch Phase Lifecycle
```
FILLING → REACTION → READY → DRAINING → EMPTY
```
- FILLING → REACTION: Level reaches target (within 0.005 tolerance)
- REACTION → READY: spGravity drops below pfGravityTarget (default 1.024)
- READY → DRAINING: Manual operator trigger
- DRAINING → EMPTY: Manual operator trigger
- Retention time = hours from FILLING start to DRAINING start (target: 8h)

#### Pre-Fermenter → Fermenter → Beer Well
- PF must be READY before fermenter starts FILLING
- Lab readings per batch: level, temperature, spGravity, pH, analysisTime
- Readings auto-advance batch phase based on level/gravity thresholds
- Frontend polls `/overview` every 30 seconds for live vessel status

#### Dosing
- DosingRecipe defines chemicals per phase
- PFDosing/FermDosing tracks actual additions per batch
- PFChemical/FermChemical are chemical inventory models

### 5. Distillation
- Column readings: spent wash loss %, RC less loss %
- Ethanol strength, RC reflex/regeneration/actual strength
- Evaporation Sp.Gravity
- Photo upload for spent wash + RC loss documentation
- Routes: `GET /`, `POST /` (with photos), `DELETE /:id`

### 6. Ethanol Product & Dispatch

#### Tank Readings
- 7 tanks (recA/B/C, bulkA/B/C, disp) with: dip (cm), liters, strength (% v/v), volume (L)
- DIP → Volume via calibration lookup (84K entries in `calibrations.json`)
- DIP key conversion: 45.7cm → key "457" (×10, rounded)

#### Production Calculations
- **Total stock** = Σ all tank volumes
- **Weighted avg strength** = (Σ volume × strength) / total stock
- **Production BL** = current stock - prev stock + total dispatch
- **Production AL** = Production BL × avg strength / 100
- **KLPD** = (Production BL / hours since prev) × 24 / 1000
- All volumes in **BL (Bulk Liters)** — don't confuse with KG or regular liters
- `plantNotRunning` flag overrides production to 0

#### Dispatch
- DispatchTruck: vehicle, party, destination, quantity (BL), strength, batchNo
- Linked trucks (entryId set) vs standalone trucks (entryId null)
- Photo upload to `/uploads/dispatch/`
- Totals = Σ EthanolProductEntry.totalDispatch + standalone overflow

### 7. Downstream (Spent Wash → DDGS)

#### Decanter (centrifuge)
- 8 decanters: feed, wet cake, thin slop gravity per unit
- Routes: `GET /`, `POST /`, `DELETE /:id`

#### Evaporation
- FF tanks (1-5): Sp.Gravity, Temp, Concentration
- FC tanks (1-2): Sp.Gravity, Temp
- Syrup concentration/gravity, Reboilers A/B/C temp
- Thin slop/spent wash gravity and solids
- Routes: `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`

#### Dryer
- 3 dryers: Moisture, Steam Flow, Steam Temp In/Out, Syrup Consumption, Load (Amps)
- Final moisture tracking
- Routes: `GET /`, `POST /`, `DELETE /:id`

#### DDGS Production
- Bags, weight per bag, total production
- Dryer inlet/outlet temps, moisture, protein %
- Routes: `GET /`, `POST /`, `DELETE /:id`

#### DDGS Stock (daily balance)
- Upsert by `date + yearStart` composite key (idempotent)
- `opening + production - dispatch = closing`
- Aggregates cumulative from DDGSProductionEntry + DDGSDispatchTruck
- Defaults from Settings: `ddgsBaseProduction` (3160), `ddgsBaseStock` (1956.01)
- Routes: `GET /latest`, `GET /`, `POST /` (upsert), `DELETE /:id`

#### DDGS Dispatch (truck workflow)
```
GATE_IN → TARE_WEIGHED → GROSS_WEIGHED → BILLED → PAYMENT_CONFIRMED → RELEASED
```
- Weight: net = gross - tare (automatic on gross weigh)
- Invoice: taxable = net MT × rate, GST = taxable × 5%, total = taxable + GST
- Interstate detection: compare GSTIN state code (first 2 digits) vs MSPIL's 23 (MP)
- PDF invoice with letterhead, bill-to/ship-to, line items, tax breakdown, bank details
- Routes: `GET /summary`, `GET /`, `POST /` (gate in), `PUT /:id`, `POST /:id/weigh`, `POST /:id/generate-bill`, `POST /:id/confirm-payment`, `POST /:id/release`, `GET /:id/invoice-pdf`

### 8. Daily Entry (Plant Summary)
- Consolidates daily readings: syrup flows, FLT flow, wash flow, fermenter levels, grain stocks, steam, efficiency
- Status: `DRAFT → APPROVED` (SUPERVISOR or ADMIN only for approval)
- Routes: `POST /create`, `GET /list`, `GET /:id`, `PATCH /:id`, `PATCH /:id/approve`

---

## Critical Bugs to Avoid

### Race Conditions
- **Fermentation phase advancement**: Two simultaneous lab readings can both trigger phase change — wrap state transitions in `prisma.$transaction`
- **DDGS stock dispatch**: Two simultaneous dispatches can overwrite each other — use `{ increment: amount }` in Prisma update
- **GRN stock updates**: Material.currentStock must update atomically — use `$transaction`

### N+1 Queries
- Fermentation `/history` loops 50 batches with individual queries — use `findMany({ where: { batchNo: { in: batchNos } } })`
- GRN creation loops POLines individually — batch fetch + batch update

### Unbounded Queries
- Fermentation `/anomaly/:fermenterNo` fetches ALL entries — always add `take` limit
- All `findMany` must have `take` (default 50, max 500)

### Data Dependencies
- GrainEntry, EthanolProductEntry, DDGSStockEntry all depend on previous day's entry for cumulative/opening values — always fetch previous entry
- Flour silos: entered as % but used as tonnage (140 T × level%)

### Helpers
- `resolveLevel()` handles null/undefined with fallback to 0
- `r2()` rounds to 2 decimal places: `Math.round(n × 100) / 100`
- `calcFine()` computes fine fraction from sieve retentions

---

## Indexes
- GrainEntry: `[date]`, `[yearStart, date]`
- GrainTruck: `[date]`
- FermentationEntry: `[batchNo, fermenterNo]`, `[date]`, `[createdAt]`, `[fermenterNo]`
- FermentationBatch: `[phase]`, `[createdAt]`
- PFBatch: `[phase]`, `[createdAt]`
- BeerWellReading: `[createdAt]`
- DistillationEntry: `[date]`
- EvaporationEntry: `[date]`
- DispatchTruck: `[date]`, `[entryId]`
- DDGSDispatchTruck: `[date]`
- DailyEntry: `[date]`, `[status]`
