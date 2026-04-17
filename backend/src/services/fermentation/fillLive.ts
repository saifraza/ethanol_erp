/**
 * Live fill detection — runs every 5 min from cronJobs.
 *
 * Per fermenter:
 *   1. Pull last 6h of series (OPC preferred, lab fallback)
 *   2. Run detector (can emit endTime=null for in-progress)
 *   3. Upsert FermentationFillEvent on unique (fermenterNo, startTime)
 *   4. When endTime is finalized, rewrite matched FermentationBatch.fillingStart/EndTime/totalHours
 *
 * Also exposes isFillingNow(fermenterNo) for callers that previously relied on
 * the brittle slope heuristic in fermenterPhaseDetector.ts.
 */

import prisma from '../../config/prisma';
import { detectFillEvents, type DetectorConfig } from './fillDetector';
import { fetchFermenterSeries } from './fillSources';

const LIVE_WINDOW_MS = 6 * 3_600_000;

const OPC_CONFIG: Partial<DetectorConfig> = { smoothWindow: 5 };
const LAB_CONFIG: Partial<DetectorConfig> = {
  startSustainedMinutes: 120,
  endFlatWindowMinutes: 240,
  endFlatBandPct: 2,
};

async function matchBatch(fermenterNo: number, startTime: Date) {
  const matchFrom = new Date(startTime.getTime() - 4 * 3_600_000);
  const matchTo = new Date(startTime.getTime() + 4 * 3_600_000);
  return prisma.fermentationBatch.findFirst({
    where: {
      fermenterNo,
      OR: [
        { fillingStartTime: { gte: matchFrom, lte: matchTo } },
        { createdAt: { gte: matchFrom, lte: matchTo } },
      ],
    },
    orderBy: { fillingStartTime: 'desc' },
    select: { id: true, batchNo: true, fillingStartTime: true, fillingEndTime: true, fermentationEndTime: true, remarks: true },
  });
}

async function processFermenter(fermenterNo: number): Promise<{ found: number; finalized: number }> {
  const to = new Date();
  const from = new Date(to.getTime() - LIVE_WINDOW_MS);

  const series = await fetchFermenterSeries(fermenterNo, from, to);
  if (series.level.length < 2) return { found: 0, finalized: 0 };

  const cfg = series.source === 'OPC' ? OPC_CONFIG : LAB_CONFIG;
  const events = detectFillEvents({
    fermenterNo,
    level: series.level,
    temp: series.temp,
    pfLevel: series.pfLevel.length ? series.pfLevel : undefined,
    labTimes: series.labTimes,
    source: series.source,
    config: cfg,
  });

  let finalized = 0;

  for (const ev of events) {
    const batch = await matchBatch(fermenterNo, ev.startTime);

    await prisma.fermentationFillEvent.upsert({
      where: { fermenterNo_startTime: { fermenterNo, startTime: ev.startTime } },
      create: {
        fermenterNo,
        batchNo: batch?.batchNo ?? null,
        startTime: ev.startTime,
        endTime: ev.endTime,
        startLevel: ev.startLevel,
        peakLevel: ev.peakLevel,
        durationHours: ev.durationHours,
        confidence: ev.confidence,
        source: ev.source,
        crossChecks: ev.crossChecks as any,
      },
      update: {
        batchNo: batch?.batchNo ?? null,
        endTime: ev.endTime,
        startLevel: ev.startLevel,
        peakLevel: ev.peakLevel,
        durationHours: ev.durationHours,
        confidence: ev.confidence,
        source: ev.source,
        crossChecks: ev.crossChecks as any,
      },
    });

    // Finalize: write back to FermentationBatch only when endTime is known
    if (batch && ev.endTime) {
      finalized++;
      const originalFooter = `[audit] originalFillingStart=${batch.fillingStartTime?.toISOString() ?? 'null'} originalFillingEnd=${batch.fillingEndTime?.toISOString() ?? 'null'}`;
      const alreadyAudited = (batch.remarks ?? '').includes('[audit] originalFillingStart');
      const newRemarks = alreadyAudited
        ? batch.remarks
        : [batch.remarks, originalFooter].filter(Boolean).join(' | ');
      // totalHours = full cycle: fillStart → fermentationEndTime (SG ≤ 1.0). null while reaction still running.
      const cycleEnd = batch.fermentationEndTime;
      const totalHours = cycleEnd
        ? Number(((cycleEnd.getTime() - ev.startTime.getTime()) / 3_600_000).toFixed(2))
        : null;

      await prisma.fermentationBatch.update({
        where: { id: batch.id },
        data: {
          fillingStartTime: ev.startTime,
          fillingEndTime: ev.endTime,
          totalHours,
          remarks: newRemarks,
        },
      });
    }
  }

  return { found: events.length, finalized };
}

let _timer: ReturnType<typeof setInterval> | null = null;
const RUN_INTERVAL_MS = 5 * 60 * 1000;

/** Start the 5-min cron. Idempotent. */
export function startFillLive(): void {
  if (_timer) return;
  // Initial run after 30s to let DB/prisma warm up
  setTimeout(() => runFillLive().catch(err => console.error('[fillLive] initial run failed:', err)), 30_000);
  _timer = setInterval(() => {
    runFillLive().catch(err => console.error('[fillLive] run failed:', err));
  }, RUN_INTERVAL_MS);
  console.log(`[fillLive] started (every ${RUN_INTERVAL_MS / 60_000} min)`);
}

export function stopFillLive(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

/** Cron entry — runs every 5 min. */
export async function runFillLive(): Promise<void> {
  const results = await Promise.allSettled(
    [1, 2, 3, 4].map(f => processFermenter(f).then(r => ({ f, ...r }))),
  );
  const ok = results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value);
  const fail = results.filter(r => r.status === 'rejected').length;
  const totalFound = ok.reduce((a, r) => a + r.found, 0);
  const totalFinalized = ok.reduce((a, r) => a + r.finalized, 0);
  if (totalFound > 0 || fail > 0) {
    console.log(`[fillLive] events=${totalFound} finalized=${totalFinalized} failures=${fail}`);
  }
}

/** Non-blocking trigger for on-lab-insert — recompute fills for this fermenter's recent window. */
export function triggerRecompute(fermenterNo: number): void {
  processFermenter(fermenterNo).catch(err => {
    console.error(`[fillLive] recompute F-${fermenterNo} failed:`, (err as Error).message);
  });
}

/** Replacement for the old slope heuristic. Reads the live FermentationFillEvent table. */
export async function isFillingNow(fermenterNo: number): Promise<{
  filling: boolean;
  startTime: Date | null;
  levelNow: number | null;
  confidence: string | null;
}> {
  const latest = await prisma.fermentationFillEvent.findFirst({
    where: { fermenterNo, endTime: null },
    orderBy: { startTime: 'desc' },
    select: { startTime: true, peakLevel: true, confidence: true },
  });
  if (!latest) return { filling: false, startTime: null, levelNow: null, confidence: null };
  return {
    filling: true,
    startTime: latest.startTime,
    levelNow: latest.peakLevel,
    confidence: latest.confidence,
  };
}
