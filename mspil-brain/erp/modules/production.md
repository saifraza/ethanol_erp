# Production Module

## The Process Flow

```
Grain → Milling → Liquefaction → Pre-Fermentation → Fermentation
→ Distillation → Ethanol (RS/HFO/LFO tanks)
                → Evaporation → Decanter → Dryer → DDGS (godown)
```

## Grain Intake
- Grain arrives by truck, weighed at gate, quality tested (moisture, starch, fungus)
- Unloaded into silos, tracked daily (grainUnloaded, grainConsumed, grainInProcess)
- Mass balance: grain consumed = washDiff x fermPercent (Settings-based formula)

## Milling
- Grain ground through mills A/B/C
- Sieve analysis: 1mm, 850µ, 600µ, 300µ particle sizes
- Mill RPM and load monitored per shift

## Liquefaction
- Starch → sugar conversion using enzymes + heat
- Two stages: ILT (Initial Liquefaction Tank) → FLT (Final Liquefaction Tank)
- Key readings: jet cooker temp/flow, specific gravity, pH, RS (reducing sugar), iodine test

## Pre-Fermentation (PF)
- Yeast propagation before main fermentation
- Batch-based tracking (batchNo + fermenterNo)
- Phase transitions: SETUP → DOSING → LAB → TRANSFER → CIP → DONE
- Chemical dosing: urea, yeast, formolin, enzyme — tracked per batch
- Ready condition: gravity >= pfGravityTarget (1.024) AND time >= fermRetentionHours (8h)

## Fermentation
- Main conversion: sugar → ethanol by yeast
- 4 fermenters (F1-F4), batch-tracked
- Phases: PF_TRANSFER → FILLING → REACTION → RETENTION → TRANSFER → CIP → DONE
- Hourly readings: level%, specific gravity, pH, RS, RST, alcohol%, DS, VFA, temperature
- Chemical dosing: yeast, enzyme, booster, urea — per batch with level% at dosing
- Phase auto-detected by Telegram bot from gravity trends
- Beer well readings: intermediate storage before distillation

## Distillation
- Fermented wash → ethanol separation
- Key outputs: RS (Rectified Spirit), HFO (High Fusel Oil), LFO (Low Fusel Oil)
- Key metrics: spent wash loss (NIL/SLIGHT/HIGH), RC strength, ethanol strength

## Evaporation & DDGS
- Spent wash → evaporation → concentrated syrup
- Syrup → decanter → dryer → DDGS (Dried Distillers Grains with Solubles)
- DDGS tracked as production tonnage, stock levels, dispatch trucks

## Tank Dips
- Daily measurements of all tanks (RS, HFO, LFO, production)
- Calibration tables: DIP cm → volume KL lookup (stored in calibrations.json)

## Data Collection
- **Primary**: Telegram auto-collect bot — operators reply to scheduled questions
- **Secondary**: Web UI (process pages)
- **Automated**: OPC DCS bridge for real-time readings (temp, flow, level, pressure)

## Key Business Metrics
- **Recovery %**: Ethanol produced / grain consumed
- **Efficiency %**: Actual vs theoretical yield
- **Grain consumed**: Derived from wash difference formula
- **Steam consumption**: Per KL of ethanol produced
