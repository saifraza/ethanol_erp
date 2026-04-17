/**
 * One-shot backfill — compute FermentationFillEvent rows for historical data
 * and rewrite FermentationBatch.fillingStart/EndTime + totalHours.
 *
 * Run:
 *   cd backend && npx tsx src/services/fermentation/fillBackfill.ts --dry-run
 *   cd backend && npx tsx src/services/fermentation/fillBackfill.ts --apply
 *
 * Idempotent. Uses upsert on unique (fermenterNo, startTime).
 * Original operator-entered fillingStart/End are appended to `remarks` once
 * (prefixed with [audit]) before overwrite.
 */

import prisma from '../../config/prisma';
import { detectFillEvents, type DetectorConfig, type FillEvent } from './fillDetector';
import { fetchFermenterSeries } from './fillSources';

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--apply');

// For sparse lab-only data, widen time tolerances. OPC dense data uses tighter defaults.
const LAB_CONFIG: Partial<DetectorConfig> = {
  startSustainedMinutes: 120,
  endFlatWindowMinutes: 240,
  endFlatBandPct: 2,
};

const OPC_CONFIG: Partial<DetectorConfig> = {
  smoothWindow: 5,
};

interface BackfillStat {
  fermenterNo: number;
  source: string;
  detected: number;
  matched: number;
  orphaned: number;
  confidence: Record<string, number>;
}

async function backfillOne(fermenterNo: number): Promise<BackfillStat> {
  const stat: BackfillStat = {
    fermenterNo,
    source: '',
    detected: 0,
    matched: 0,
    orphaned: 0,
    confidence: { HIGH: 0, MEDIUM: 0, LOW: 0 },
  };

  // Window: from earliest batch for this fermenter, or default 90 days back
  const earliest = await prisma.fermentationBatch.findFirst({
    where: { fermenterNo },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, fillingStartTime: true },
  });
  const from = earliest?.fillingStartTime ?? earliest?.createdAt ?? new Date(Date.now() - 90 * 86_400_000);
  const to = new Date();

  const series = await fetchFermenterSeries(fermenterNo, from, to);
  stat.source = series.source;

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

  stat.detected = events.length;

  for (const ev of events) {
    stat.confidence[ev.confidence] = (stat.confidence[ev.confidence] ?? 0) + 1;

    // Match to batch by fermenterNo + ±4h window around startTime
    const matchFrom = new Date(ev.startTime.getTime() - 4 * 3_600_000);
    const matchTo = new Date(ev.startTime.getTime() + 4 * 3_600_000);
    const batch = await prisma.fermentationBatch.findFirst({
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

    if (batch) stat.matched++;
    else stat.orphaned++;

    if (DRY_RUN) {
      console.log(
        `[dry] F-${fermenterNo} batch=${batch?.batchNo ?? 'ORPHAN'} ` +
        `start=${ev.startTime.toISOString()} end=${ev.endTime?.toISOString() ?? 'IN_PROGRESS'} ` +
        `start=${ev.startLevel}% peak=${ev.peakLevel}% dur=${ev.durationHours ?? '-'}h ` +
        `conf=${ev.confidence} src=${ev.source}`,
      );
      continue;
    }

    // APPLY: upsert FermentationFillEvent
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

    // Rewrite FermentationBatch fields + preserve original in remarks (once)
    if (batch && ev.endTime) {
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

  return stat;
}

async function main() {
  console.log(`Fill backfill starting ${DRY_RUN ? '(DRY RUN — no writes)' : '(APPLY)'}`);
  const stats: BackfillStat[] = [];
  for (const f of [1, 2, 3, 4]) {
    const s = await backfillOne(f);
    stats.push(s);
    console.log(
      `F-${s.fermenterNo}: source=${s.source} detected=${s.detected} matched=${s.matched} orphaned=${s.orphaned} ` +
      `HIGH=${s.confidence.HIGH} MED=${s.confidence.MEDIUM} LOW=${s.confidence.LOW}`,
    );
  }
  const total = stats.reduce((a, s) => a + s.detected, 0);
  console.log(`\nTotal events: ${total}${DRY_RUN ? ' (dry run — rerun with --apply to commit)' : ''}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
