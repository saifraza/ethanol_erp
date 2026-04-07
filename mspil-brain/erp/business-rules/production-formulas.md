# Production Formulas & Calculations

## Grain Mass Balance

### Grain Consumed (daily)
```
grainConsumed = washDiff x fermPercent
```
- `washDiff`: Difference in wash volume (from DailyEntry)
- `fermPercent`: Grain percentage setting (from Settings.grainPercent)

### Grain Stock
```
closingStock = openingStock + grainUnloaded - grainConsumed
grainInProcess = grainConsumed - (converted to ethanol + DDGS + waste)
```

## Ethanol Recovery

### Recovery Percentage
```
recovery% = (ethanol produced in KL / grain consumed in MT) x 100
```
Target: industry standard ~400 liters per MT of grain

### Efficiency
```
efficiency% = (actual recovery / theoretical recovery) x 100
```

## Fermentation Batch Readiness

### PF Ready Condition
A pre-fermentation batch is ready to transfer when:
```
spGravity >= pfGravityTarget (default: 1.024)
AND
timeSinceSetup >= fermRetentionHours (default: 8 hours)
```

### Phase Auto-Detection (Telegram)
The fermenter phase detector infers phase from gravity trends:
- **CIP**: No readings, tank being cleaned
- **Setup**: Initial gravity high, just filled
- **Fermentation**: Gravity dropping (yeast active)
- **Final**: Gravity stabilized (fermentation complete)

## Tank Calibration

### DIP to Volume Conversion
Each tank has a calibration table: DIP measurement (cm) → volume (KL)
```
Stored in: calibrations.json
Lookup: given DIP cm, interpolate to get volume KL
```

### Tank Types
- RS (Rectified Spirit)
- HFO (High Fusel Oil)
- LFO (Low Fusel Oil)
- Production tanks

## Daily Entry Calculations
- **Syrup flow**: Liters processed through evaporation
- **Wash flow**: Liters sent to distillation
- **FLT flow**: Liters from final liquefaction
- **Steam**: Tons of steam consumed per KL ethanol
- **Fermenter levels**: % full for each fermenter (F1-F4)

## DDGS Yield
```
DDGS produced (MT) = f(spent wash volume, evaporation efficiency, dryer throughput)
```
Tracked daily via DDGSProductionEntry

## Fuel Consumption
- Types: LDO (Light Diesel Oil), HSD (High Speed Diesel)
- Tracked: quantity (liters), cost (Rs), purpose
- Key metric: fuel cost per KL of ethanol
