import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Comprehensive analytics endpoint ───
router.get('/analytics', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    // Run all queries in parallel
    const [
      grain, ethanol, dispatch, ddgsStock, ddgsDispatch,
      distillation, liquefaction, milling, fermentationBatches,
      pfBatches, rawMaterial, settings
    ] = await Promise.all([
      prisma.grainEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.ethanolProductEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.dispatchTruck.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.dDGSStockEntry.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
      prisma.dDGSDispatchTruck.findMany({ where: { date: { gte: from, lte: now } }, orderBy: { date: 'asc' } }),
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

    const totalDDGSProduced = ddgsStock.reduce((s, e) => s + (e.productionToday || 0), 0);
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
