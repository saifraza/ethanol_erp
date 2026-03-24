import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Comprehensive analytics endpoint ───
router.get('/analytics', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Validate and cap days parameter
    const days = Math.max(1, Math.min(Number(req.query.days) || 30, 365));
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    // Run all queries in parallel
    const [
      grain, ethanol, dispatch, ddgsStock, ddgsDispatch, ddgsProduction,
      distillation, liquefaction, milling, fermentationBatches,
      pfBatches, rawMaterial, settings
    ] = await Promise.all([
      prisma.grainEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.ethanolProductEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.dispatchTruck.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.dDGSStockEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.dDGSDispatchTruck.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.dDGSProductionEntry.findMany({ where: { date: { gte: from, lte: now } }, select: { totalProduction: true, date: true, shiftDate: true } }),
      prisma.distillationEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.liquefactionEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.millingEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.fermentationBatch.findMany({
        where: { createdAt: { gte: from } },
        include: { dosings: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pFBatch.findMany({
        where: { createdAt: { gte: from } },
        include: { dosings: true, labReadings: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.rawMaterialEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.settings.findFirst(),
    ]);

    // ─── KPIs ───
    const totalGrainUnloaded = grain.reduce((s, e) => s + (e.grainUnloaded || 0), 0);
    const totalGrainConsumed = grain.reduce((s, e) => s + (e.grainConsumed || 0), 0);
    const latestGrain = grain.length > 0 ? grain[grain.length - 1] : null;

    const totalEthanolBL = ethanol.reduce((s, e) => s + (e.productionBL || 0), 0);
    const totalEthanolAL = ethanol.reduce((s, e) => s + (e.productionAL || 0), 0);
    const totalDispatchBL = dispatch.reduce((s, e) => s + (e.quantityBL || 0), 0);
    const latestEthanol = ethanol.length > 0 ? ethanol[ethanol.length - 1] : null;
    const avgStrength = ethanol.filter(e => e.avgStrength > 0).length > 0
      ? ethanol.filter(e => e.avgStrength > 0).reduce((s, e) => s + e.avgStrength, 0) / ethanol.filter(e => e.avgStrength > 0).length
      : 0;

    // DDGS production: use DDGSStockEntry.productionToday (manual daily summary)
    // OR DDGSProductionEntry.totalProduction (auto-collected hourly entries), whichever is greater
    const ddgsFromStock = ddgsStock.reduce((s: number, e: any) => s + (e.productionToday || 0), 0);
    const ddgsFromProd = ddgsProduction.reduce((s: number, e: any) => s + (e.totalProduction || 0), 0);
    const totalDDGSProduced = Math.max(ddgsFromStock, ddgsFromProd);
    const totalDDGSDispatched = ddgsDispatch.reduce((s, e) => s + (e.weightNet || 0), 0);

    const totalWashDistilled = grain.reduce((s, e) => s + (e.washConsumed || 0), 0);

    // Avg raw material quality
    const avgMoisture = rawMaterial.length > 0
      ? rawMaterial.reduce((s, e) => s + (e.moisture || 0), 0) / rawMaterial.length : 0;
    const avgStarch = rawMaterial.length > 0
      ? rawMaterial.reduce((s, e) => s + (e.starch || 0), 0) / rawMaterial.length : 0;

    // Avg distillation strength
    const distWithStrength = distillation.filter(e => e.ethanolStrength && e.ethanolStrength > 0);
    const avgEthanolStrength = distWithStrength.length > 0
      ? distWithStrength.reduce((s, e) => s + (e.ethanolStrength || 0), 0) / distWithStrength.length : 0;

    // ─── Daily trends (grouped by date) ───
    const fmtDate = (d: Date) => d.toISOString().split('T')[0];

    // Grain daily
    const grainDaily = grain.map(e => ({
      date: fmtDate(e.date),
      unloaded: e.grainUnloaded || 0,
      consumed: e.grainConsumed || 0,
      siloStock: e.siloClosingStock || 0,
      totalAtPlant: e.totalGrainAtPlant || 0,
    }));

    // Ethanol daily
    const ethanolDaily = ethanol.map(e => ({
      date: fmtDate(e.date),
      productionBL: e.productionBL || 0,
      productionAL: e.productionAL || 0,
      totalStock: e.totalStock || 0,
      dispatch: e.totalDispatch || 0,
      klpd: e.klpd || 0,
      avgStrength: e.avgStrength || 0,
    }));

    // Distillation daily
    const distDaily = distillation.map(e => ({
      date: fmtDate(e.date),
      time: e.analysisTime || '',
      ethanolStrength: e.ethanolStrength,
      rcReflexStrength: e.rcReflexStrength,
      rcStrength: e.rcStrength,
    }));

    // Liquefaction daily
    const liqDaily = liquefaction.map(e => ({
      date: fmtDate(e.date),
      iltGravity: e.iltSpGravity,
      fltGravity: e.fltSpGravity,
      iltPh: e.iltPh,
      fltPh: e.fltPh,
      iltTemp: e.iltTemp,
      fltTemp: e.fltTemp,
    }));

    // Milling daily
    const millDaily = milling.map(e => ({
      date: fmtDate(e.date),
      sieve1mm: e.sieve_1mm,
      sieve850: e.sieve_850,
      sieve600: e.sieve_600,
      sieve300: e.sieve_300,
    }));

    // DDGS daily
    const ddgsDaily = ddgsStock.map(e => ({
      date: fmtDate(e.date),
      produced: e.productionToday || 0,
      dispatched: e.dispatchToday || 0,
      closing: e.closingStock || 0,
    }));

    // Dispatch trucks (for table)
    const dispatchList = dispatch.slice(-50).reverse().map(e => ({
      date: fmtDate(e.date),
      vehicleNo: e.vehicleNo,
      party: e.partyName,
      destination: e.destination,
      quantityBL: e.quantityBL,
      strength: e.strength,
    }));

    // ─── Live status ───
    // Active fermentation batches (not DONE)
    const activeFermBatches = fermentationBatches
      .filter(b => b.phase !== 'DONE')
      .slice(0, 8)
      .map(b => ({
        batchNo: b.batchNo,
        fermenterNo: b.fermenterNo,
        phase: b.phase,
        fermLevel: b.fermLevel,
        setupGravity: b.setupGravity,
        finalAlcohol: b.finalAlcohol,
        totalHours: b.totalHours,
        fillingStart: b.fillingStartTime,
      }));

    const activePFBatches = pfBatches
      .filter(b => b.phase !== 'DONE')
      .slice(0, 4)
      .map(b => ({
        batchNo: b.batchNo,
        fermenterNo: b.fermenterNo,
        phase: b.phase,
        slurryVolume: b.slurryVolume,
        slurryGravity: b.slurryGravity,
        latestAlcohol: b.labReadings.length > 0 ? b.labReadings[b.labReadings.length - 1].alcohol : null,
      }));

    // Raw material recent
    const rawRecent = rawMaterial.slice(-10).reverse().map(e => ({
      date: fmtDate(e.date),
      vehicleNo: e.vehicleNo,
      material: e.material || 'Grain',
      moisture: e.moisture,
      starch: e.starch,
      damaged: e.damaged,
    }));

    // Party-wise dispatch summary
    const partyMap: Record<string, { qty: number; count: number }> = {};
    dispatch.forEach(d => {
      const p = d.partyName || 'Unknown';
      if (!partyMap[p]) partyMap[p] = { qty: 0, count: 0 };
      partyMap[p].qty += d.quantityBL || 0;
      partyMap[p].count += 1;
    });
    const dispatchByParty = Object.entries(partyMap)
      .map(([party, v]) => ({ party, ...v }))
      .sort((a, b) => b.qty - a.qty);

    res.json({
      period: { from: fmtDate(from), to: fmtDate(now), days },
      kpis: {
        grainUnloaded: totalGrainUnloaded,
        grainConsumed: totalGrainConsumed,
        siloStock: latestGrain?.siloClosingStock || 0,
        totalAtPlant: latestGrain?.totalGrainAtPlant || 0,
        ethanolProductionBL: totalEthanolBL,
        ethanolProductionAL: totalEthanolAL,
        ethanolStock: latestEthanol?.totalStock || 0,
        avgStrength,
        avgEthanolStrength,
        totalDispatchBL,
        dispatchTrucks: dispatch.length,
        ddgsProduced: totalDDGSProduced,
        ddgsDispatched: totalDDGSDispatched,
        washDistilled: totalWashDistilled,
        avgMoisture,
        avgStarch,
        latestKlpd: latestEthanol?.klpd || 0,
      },
      trends: {
        grain: grainDaily,
        ethanol: ethanolDaily,
        distillation: distDaily,
        liquefaction: liqDaily,
        milling: millDaily,
        ddgs: ddgsDaily,
      },
      live: {
        fermenters: activeFermBatches,
        preFermenters: activePFBatches,
      },
      tables: {
        recentDispatches: dispatchList,
        rawMaterial: rawRecent,
        dispatchByParty,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deep fermentation analytics ───
router.get('/fermentation-deep', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Validate and cap days parameter
    const days = Math.max(1, Math.min(Number(req.query.days) || 90, 365));
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    const fmtDate = (d: Date) => d.toISOString().split('T')[0];

    const [
      allFermBatches, allPFBatches, allFermEntries, allPFReadings,
      activeFermBatches, activePFBatches, settings,
      evaporation, grain, ethanol, distillation
    ] = await Promise.all([
      prisma.fermentationBatch.findMany({
        where: { createdAt: { gte: from } },
        include: { dosings: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.pFBatch.findMany({
        where: { createdAt: { gte: from } },
        include: { dosings: true, labReadings: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.fermentationEntry.findMany({
        where: { createdAt: { gte: from } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.pFLabReading.findMany({
        where: { createdAt: { gte: from } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.fermentationBatch.findMany({
        where: { phase: { not: 'DONE' } },
        include: { dosings: true },
      }),
      prisma.pFBatch.findMany({
        where: { phase: { not: 'DONE' } },
        include: { dosings: true, labReadings: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.settings.findFirst(),
      prisma.evaporationEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.grainEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.ethanolProductEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.distillationEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
    ]);

    const gravityTarget = (settings as any)?.pfGravityTarget ?? 1.024;

    // ═══ FERMENTATION KPIs ═══
    const completedBatches = allFermBatches.filter(b => b.phase === 'DONE');
    const totalBatches = allFermBatches.length;
    const completedCount = completedBatches.length;
    const activeFermCount = activeFermBatches.length;
    const activePFCount = activePFBatches.length;

    // Avg cycle time (filling to transfer) for completed batches
    const cycleTimes = completedBatches
      .filter(b => b.fillingStartTime && b.transferTime)
      .map(b => (new Date(b.transferTime!).getTime() - new Date(b.fillingStartTime!).getTime()) / 3600000);
    const avgCycleTime = cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : 0;

    // Avg final alcohol
    const alcBatches = completedBatches.filter(b => b.finalAlcohol != null && b.finalAlcohol > 0);
    const avgFinalAlcohol = alcBatches.length > 0 ? alcBatches.reduce((a, b) => a + (b.finalAlcohol || 0), 0) / alcBatches.length : 0;

    // PF throughput
    const pfCompleted = allPFBatches.filter(b => b.phase === 'DONE' || b.phase === 'CIP');
    const pfAvgCycleTime = pfCompleted
      .filter(b => b.setupTime && b.transferTime)
      .map(b => (new Date(b.transferTime!).getTime() - new Date(b.setupTime!).getTime()) / 3600000);
    const avgPFCycleTime = pfAvgCycleTime.length > 0 ? pfAvgCycleTime.reduce((a, b) => a + b, 0) / pfAvgCycleTime.length : 0;

    // ═══ GRAVITY CURVES — per batch readings over time ═══
    // Group fermentation entries by batch
    const fermEntriesByBatch: Record<number, any[]> = {};
    for (const e of allFermEntries) {
      if (!fermEntriesByBatch[e.batchNo]) fermEntriesByBatch[e.batchNo] = [];
      fermEntriesByBatch[e.batchNo].push(e);
    }

    // Build gravity curves: each batch's gravity readings relative to first reading time (hours)
    const gravityCurves: any[] = [];
    for (const [batchNo, entries] of Object.entries(fermEntriesByBatch)) {
      const readings = entries.filter(e => e.spGravity != null).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (readings.length < 2) continue;
      const t0 = new Date(readings[0].createdAt).getTime();
      const batch = allFermBatches.find(b => b.batchNo === parseInt(batchNo));
      gravityCurves.push({
        batchNo: parseInt(batchNo),
        fermenterNo: readings[0].fermenterNo,
        phase: batch?.phase || 'DONE',
        points: readings.map(r => ({
          hour: Math.round((new Date(r.createdAt).getTime() - t0) / 3600000 * 10) / 10,
          gravity: r.spGravity,
          temp: r.temp,
          alcohol: r.alcohol,
          ph: r.ph,
        })),
      });
    }

    // ═══ AVERAGE GRAVITY CURVE (historical benchmark) ═══
    const hourBuckets: Record<number, { gravity: number[]; temp: number[]; alcohol: number[] }> = {};
    for (const curve of gravityCurves.filter(c => c.phase === 'DONE')) {
      for (const pt of curve.points) {
        const bucket = Math.round(pt.hour / 2) * 2;
        if (!hourBuckets[bucket]) hourBuckets[bucket] = { gravity: [], temp: [], alcohol: [] };
        if (pt.gravity != null) hourBuckets[bucket].gravity.push(pt.gravity);
        if (pt.temp != null) hourBuckets[bucket].temp.push(pt.temp);
        if (pt.alcohol != null) hourBuckets[bucket].alcohol.push(pt.alcohol);
      }
    }
    const avgCurve = Object.entries(hourBuckets)
      .map(([h, v]) => ({
        hour: parseInt(h),
        avgGravity: v.gravity.length > 0 ? v.gravity.reduce((a, b) => a + b, 0) / v.gravity.length : null,
        avgTemp: v.temp.length > 0 ? v.temp.reduce((a, b) => a + b, 0) / v.temp.length : null,
        avgAlcohol: v.alcohol.length > 0 ? v.alcohol.reduce((a, b) => a + b, 0) / v.alcohol.length : null,
        minGravity: v.gravity.length > 0 ? Math.min(...v.gravity) : null,
        maxGravity: v.gravity.length > 0 ? Math.max(...v.gravity) : null,
      }))
      .sort((a, b) => a.hour - b.hour);

    // ═══ BATCH COMPARISON TABLE ═══
    const batchComparison = allFermBatches.slice(-20).reverse().map(b => {
      const entries = fermEntriesByBatch[b.batchNo] || [];
      const gravities = entries.filter(e => e.spGravity != null);
      const alcohols = entries.filter(e => e.alcohol != null);
      const temps = entries.filter(e => e.temp != null);
      const startG = gravities.length > 0 ? gravities[0].spGravity : null;
      const endG = gravities.length > 0 ? gravities[gravities.length - 1].spGravity : null;
      const maxAlc = alcohols.length > 0 ? Math.max(...alcohols.map(e => e.alcohol!)) : null;
      const maxTemp = temps.length > 0 ? Math.max(...temps.map(e => e.temp!)) : null;
      const avgTemp = temps.length > 0 ? temps.reduce((s, e) => s + e.temp!, 0) / temps.length : null;
      const cycleHrs = b.fillingStartTime && b.transferTime
        ? (new Date(b.transferTime).getTime() - new Date(b.fillingStartTime).getTime()) / 3600000
        : null;

      return {
        batchNo: b.batchNo,
        fermenterNo: b.fermenterNo,
        phase: b.phase,
        setupGravity: b.setupGravity,
        startGravity: startG,
        endGravity: endG,
        gravityDrop: startG && endG ? Math.round((startG - endG) * 1000) / 1000 : null,
        maxAlcohol: maxAlc,
        finalAlcohol: b.finalAlcohol,
        maxTemp,
        avgTemp: avgTemp ? Math.round(avgTemp * 10) / 10 : null,
        cycleHours: cycleHrs ? Math.round(cycleHrs * 10) / 10 : null,
        readings: entries.length,
        startDate: b.fillingStartTime || b.createdAt,
      };
    });

    // ═══ TEMPERATURE HEATMAP (fermenter × time) ═══
    const tempHeatmap: any[] = [];
    for (const e of allFermEntries.filter(x => x.temp != null)) {
      tempHeatmap.push({
        time: fmtDate(e.date) + ' ' + (e.analysisTime || ''),
        fermenterNo: e.fermenterNo,
        temp: e.temp,
        batchNo: e.batchNo,
      });
    }

    // ═══ ACTIVE BATCH PREDICTIONS ═══
    const predictions: any[] = [];
    for (const batch of activeFermBatches) {
      const entries = (fermEntriesByBatch[batch.batchNo] || [])
        .filter((e: any) => e.spGravity != null)
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (entries.length < 2) continue;
      // Use batch start time (pfTransferTime or fillingStartTime) for elapsed, not first reading
      const batchStart = batch.pfTransferTime || batch.fillingStartTime || batch.createdAt;
      const t0 = new Date(batchStart).getTime();
      // Simple linear regression on gravity
      const points = entries.map((e: any) => ({
        x: (new Date(e.createdAt).getTime() - t0) / 3600000,
        y: e.spGravity!,
      }));
      const n = points.length;
      const sumX = points.reduce((s: number, p: any) => s + p.x, 0);
      const sumY = points.reduce((s: number, p: any) => s + p.y, 0);
      const sumXY = points.reduce((s: number, p: any) => s + p.x * p.y, 0);
      const sumX2 = points.reduce((s: number, p: any) => s + p.x * p.x, 0);
      const denom = n * sumX2 - sumX * sumX;
      if (denom === 0) continue;
      const slope = (n * sumXY - sumX * sumY) / denom;
      const intercept = (sumY - slope * sumX) / n;

      // Predict when gravity hits target (e.g., 1.000 for fermentation end)
      const targetGravity = 1.000;
      const currentGravity = entries[entries.length - 1].spGravity!;
      const currentHour = points[points.length - 1].x;
      const predictedHour = slope < 0 ? (targetGravity - intercept) / slope : null;
      const hoursRemaining = predictedHour && predictedHour > currentHour ? predictedHour - currentHour : null;
      const latestTemp = entries.filter((e: any) => e.temp != null).slice(-1)[0]?.temp ?? null;
      const latestAlc = entries.filter((e: any) => e.alcohol != null).slice(-1)[0]?.alcohol ?? null;

      // Health score (0-100): based on gravity drop rate, temp, readings count
      let health = 80;
      if (slope < -0.001) health += 10; // good drop rate
      if (slope > -0.0005 && currentGravity > 1.010) health -= 20; // slow
      if (latestTemp && latestTemp > 37) health -= 15;
      if (latestTemp && latestTemp > 38) health -= 15;
      if (entries.length < 3) health -= 10; // not enough data
      health = Math.max(0, Math.min(100, health));

      predictions.push({
        batchNo: batch.batchNo,
        fermenterNo: batch.fermenterNo,
        phase: batch.phase,
        currentGravity,
        gravityDropRate: Math.round(slope * 10000) / 10000,
        currentTemp: latestTemp,
        currentAlcohol: latestAlc,
        hoursElapsed: Math.round((Date.now() - t0) / 3600000 * 10) / 10,
        hoursRemaining: hoursRemaining ? Math.round(hoursRemaining * 10) / 10 : null,
        predictedEndTime: hoursRemaining ? new Date(Date.now() + hoursRemaining * 3600000).toISOString() : null,
        health,
        readingsCount: entries.length,
      });
    }

    // ═══ PF ANALYTICS ═══
    const pfAnalytics = allPFBatches.slice(-20).reverse().map(b => {
      const lastReading = b.labReadings.length > 0 ? b.labReadings[b.labReadings.length - 1] : null;
      const cycleHrs = b.setupTime && b.transferTime
        ? (new Date(b.transferTime).getTime() - new Date(b.setupTime).getTime()) / 3600000
        : null;
      return {
        batchNo: b.batchNo,
        fermenterNo: b.fermenterNo,
        phase: b.phase,
        slurryGravity: b.slurryGravity,
        finalGravity: lastReading?.spGravity ?? null,
        finalAlcohol: lastReading?.alcohol ?? null,
        finalPh: lastReading?.ph ?? null,
        cycleHours: cycleHrs ? Math.round(cycleHrs * 10) / 10 : null,
        dosingCount: b.dosings.length,
        readingsCount: b.labReadings.length,
        createdAt: b.createdAt,
      };
    });

    // ═══ CHEMICAL CONSUMPTION ANALYTICS ═══
    const chemConsumption: Record<string, { total: number; count: number; unit: string }> = {};
    for (const b of allPFBatches) {
      for (const d of b.dosings) {
        if (!chemConsumption[d.chemicalName]) chemConsumption[d.chemicalName] = { total: 0, count: 0, unit: d.unit };
        chemConsumption[d.chemicalName].total += d.quantity;
        chemConsumption[d.chemicalName].count += 1;
      }
    }
    for (const b of allFermBatches) {
      for (const d of b.dosings) {
        if (!chemConsumption[d.chemicalName]) chemConsumption[d.chemicalName] = { total: 0, count: 0, unit: d.unit };
        chemConsumption[d.chemicalName].total += d.quantity;
        chemConsumption[d.chemicalName].count += 1;
      }
    }
    const chemicalSummary = Object.entries(chemConsumption).map(([name, v]) => ({
      name, total: Math.round(v.total * 100) / 100, avgPerBatch: Math.round(v.total / Math.max(v.count, 1) * 100) / 100, batches: v.count, unit: v.unit,
    })).sort((a, b) => b.total - a.total);

    // ═══ AI INSIGHTS / ALERTS ═══
    const alerts: any[] = [];
    // Temperature alerts on active batches
    for (const p of predictions) {
      if (p.currentTemp && p.currentTemp > 37) {
        alerts.push({ type: 'warning', vessel: `F-${p.fermenterNo}`, msg: `Temperature ${p.currentTemp}°C is above 37°C threshold`, severity: p.currentTemp > 38 ? 'critical' : 'warning' });
      }
      if (p.gravityDropRate > -0.0003 && p.hoursElapsed > 8) {
        alerts.push({ type: 'slow', vessel: `F-${p.fermenterNo}`, msg: `Gravity drop rate is very slow (${p.gravityDropRate}/hr). Check yeast health.`, severity: 'warning' });
      }
      if (p.health < 50) {
        alerts.push({ type: 'health', vessel: `F-${p.fermenterNo}`, msg: `Batch health score is low (${p.health}/100)`, severity: 'critical' });
      }
    }
    // PF alerts
    for (const b of activePFBatches) {
      const lastReading = b.labReadings.length > 0 ? b.labReadings[b.labReadings.length - 1] : null;
      if (lastReading?.spGravity && lastReading.spGravity <= gravityTarget) {
        alerts.push({ type: 'ready', vessel: `PF-${b.fermenterNo}`, msg: `Ready to transfer! Gravity ${lastReading.spGravity} ≤ target ${gravityTarget}`, severity: 'info' });
      }
      if (lastReading?.temp && lastReading.temp > 38) {
        alerts.push({ type: 'warning', vessel: `PF-${b.fermenterNo}`, msg: `PF temperature ${lastReading.temp}°C is high`, severity: 'warning' });
      }
    }

    // ═══ PLANT PIPELINE FLOW (interlinked) ═══
    const pipeline = {
      grainIn: grain.reduce((s, e) => s + (e.grainUnloaded || 0), 0),
      grainConsumed: grain.reduce((s, e) => s + (e.grainConsumed || 0), 0),
      washProduced: grain.reduce((s, e) => s + (e.washConsumed || 0), 0),
      pfBatchesRun: allPFBatches.length,
      fermBatchesRun: allFermBatches.length,
      fermBatchesDone: completedCount,
      ethanolProduced: ethanol.reduce((s, e) => s + (e.productionBL || 0), 0),
      ethanolDispatched: ethanol.reduce((s, e) => s + (e.totalDispatch || 0), 0),
      avgKLPD: ethanol.length > 0 ? ethanol.reduce((s, e) => s + (e.klpd || 0), 0) / ethanol.length : 0,
      avgDistStrength: distillation.filter(e => e.ethanolStrength && e.ethanolStrength > 0).length > 0
        ? distillation.filter(e => e.ethanolStrength! > 0).reduce((s, e) => s + (e.ethanolStrength || 0), 0) / distillation.filter(e => e.ethanolStrength! > 0).length : 0,
      // Evaporation data
      avgSyrupConc: evaporation.filter(e => e.syrupConcentration != null).length > 0
        ? evaporation.filter(e => e.syrupConcentration != null).reduce((s, e) => s + (e.syrupConcentration || 0), 0) / evaporation.filter(e => e.syrupConcentration != null).length : 0,
    };

    // ═══ DAILY FERMENTATION ACTIVITY (batch starts/ends per day) ═══
    const fermActivityDaily: Record<string, { started: number; completed: number; readings: number }> = {};
    for (const b of allFermBatches) {
      const d = fmtDate(b.createdAt);
      if (!fermActivityDaily[d]) fermActivityDaily[d] = { started: 0, completed: 0, readings: 0 };
      fermActivityDaily[d].started += 1;
      if (b.phase === 'DONE' && b.cipEndTime) {
        const ed = fmtDate(b.cipEndTime);
        if (!fermActivityDaily[ed]) fermActivityDaily[ed] = { started: 0, completed: 0, readings: 0 };
        fermActivityDaily[ed].completed += 1;
      }
    }
    for (const e of allFermEntries) {
      const d = fmtDate(e.date);
      if (!fermActivityDaily[d]) fermActivityDaily[d] = { started: 0, completed: 0, readings: 0 };
      fermActivityDaily[d].readings += 1;
    }
    const fermActivity = Object.entries(fermActivityDaily)
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      period: { from: fmtDate(from), to: fmtDate(now), days },
      fermKpis: {
        totalBatches, completedCount, activeFermCount, activePFCount,
        avgCycleTime: Math.round(avgCycleTime * 10) / 10,
        avgFinalAlcohol: Math.round(avgFinalAlcohol * 100) / 100,
        avgPFCycleTime: Math.round(avgPFCycleTime * 10) / 10,
        gravityTarget,
      },
      gravityCurves: gravityCurves.slice(-10),
      avgCurve,
      batchComparison,
      predictions,
      pfAnalytics,
      chemicalSummary,
      alerts,
      pipeline,
      fermActivity,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Keep the old endpoint for backward compat
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEntry = await prisma.dailyEntry.findFirst({
      where: { date: { gte: today, lt: new Date(today.getTime() + 86400000) } },
    });
    const last7 = await prisma.dailyEntry.findMany({
      where: { date: { gte: new Date(today.getTime() - 7 * 86400000) } },
      orderBy: { date: 'desc' },
    });
    res.json({
      todayEntry,
      kpis: {
        grainConsumption: todayEntry?.grainConsumed || 0,
        ethanol: (todayEntry?.syrup1Flow || 0) + (todayEntry?.syrup2Flow || 0) + (todayEntry?.syrup3Flow || 0),
        recovery: todayEntry?.recoveryPercentage || 0,
        efficiency: todayEntry?.distillationEfficiency || 0,
      },
      charts: {
        recovery: last7.map(e => ({ date: e.date, recovery: e.recoveryPercentage || 0 })),
        production: last7.map(e => ({ date: e.date, production: (e.syrup1Flow || 0) + (e.syrup2Flow || 0) + (e.syrup3Flow || 0) })),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
