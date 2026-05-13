/**
 * Orphan-GRN Watchdog
 *
 * Detects the failure pattern that produced the Apr-2026 missing GRNs:
 * a COMPLETE inbound Weighment exists in cloud but no GoodsReceipt was
 * ever created from it. Three known root causes (all fixed in code now,
 * but the safety net protects against new instances + repair-script gaps):
 *
 *  - Bug 1 (pre-04-13): /push silent skips without PlantIssue.
 *    Fixed in commit 2363189 (safety-net writes PlantIssue on SKIPPED).
 *  - Bug 2 (04-01 → 04-24): unconditional updateMany on factory sync —
 *    factory marked cloudSynced=true while cloud only had FIRST_DONE.
 *    Fixed in commit 9bc92d4 (conditional updateMany).
 *  - Bug 3 (still live in repo): backend/scripts/fix-all-stuck.ts patches
 *    the Weighment mirror via raw SQL but does not create the missing
 *    GoodsReceipt. Watchdog catches whatever that script leaves behind.
 *
 * Loop:
 *   - Every TICK_MS, scan for orphan trucks older than GRACE_MIN minutes
 *     (so a fresh push that just hasn't finished round-tripping isn't
 *     mis-flagged).
 *   - For each orphan, ensure a HIGH-severity PlantIssue exists (dedupe
 *     by Weighment.localId in description).
 *   - If the set of orphans changed since last tick (new arrivals), send
 *     a single Telegram alert to the weighbridge group listing them.
 */

import prisma from '../config/prisma';
import { broadcastToGroup } from './messagingGateway';
import { syncToInventory } from '../routes/weighbridge/shared';

const TICK_MS = 10 * 60 * 1000; // 10 minutes
const GRACE_MIN = 30; // ignore weighments completed less than 30 min ago
let _timer: NodeJS.Timeout | null = null;
let _lastSeen: Set<string> = new Set(); // Weighment.localId set from previous tick
let _lastSeenStockGaps: Set<string> = new Set(); // GoodsReceipt.id set from previous tick
let _enabled = true;

export function isOrphanWatchdogEnabled(): boolean { return _enabled; }
export function setOrphanWatchdogEnabled(v: boolean): void { _enabled = v; }

interface OrphanRow {
  localId: string;
  ticketNo: number | null;
  vehicleNo: string;
  supplierName: string | null;
  materialName: string | null;
  netWeight: number | null;
  secondWeightAt: Date | null;
}

async function findOrphans(): Promise<OrphanRow[]> {
  return prisma.$queryRaw<OrphanRow[]>`
    SELECT w."localId", w."ticketNo", w."vehicleNo", w."supplierName",
           w."materialName", w."netWeight", w."secondWeightAt"
    FROM "Weighment" w
    WHERE w.direction = 'INBOUND'
      AND w.status = 'COMPLETE'
      AND COALESCE(w.cancelled, false) = false
      AND w."secondWeightAt" < NOW() - INTERVAL '30 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM "GoodsReceipt" g
        WHERE g."ticketNo" = w."ticketNo"
           OR g.remarks ILIKE '%' || w."localId" || '%'
           OR g.remarks ILIKE '%Ticket #' || w."ticketNo" || ' %'
      )
    ORDER BY w."secondWeightAt" DESC
    LIMIT 500
  `;
}

async function ensurePlantIssue(o: OrphanRow): Promise<boolean> {
  // Dedupe by localId (cheapest unique key per truck). Returns true if a new
  // issue was created so caller can decide whether to Telegram.
  const existing = await prisma.plantIssue.findFirst({
    where: { description: { contains: o.localId } },
    select: { id: true },
  });
  if (existing) return false;
  await prisma.plantIssue.create({
    data: {
      title: `Orphan truck: ${o.vehicleNo} (ticket #${o.ticketNo ?? '?'})`,
      description: [
        'Weighment is COMPLETE on cloud mirror but no GoodsReceipt links to it.',
        '',
        `Ticket: ${o.ticketNo ?? '?'}`,
        `Vehicle: ${o.vehicleNo}`,
        `Vendor: ${o.supplierName ?? 'unknown'}`,
        `Material: ${o.materialName ?? 'unknown'}`,
        `Net: ${o.netWeight ? (o.netWeight / 1000).toFixed(2) + ' MT' : 'unknown'}`,
        `Completed at: ${o.secondWeightAt?.toISOString() ?? 'unknown'}`,
        `Weighment localId: ${o.localId}`,
        '',
        'Detected by Orphan-GRN Watchdog. Open /procurement/orphan-trucks to review and create the GRN manually.',
      ].join('\n'),
      issueType: 'OTHER',
      severity: 'HIGH',
      equipment: 'Weighbridge / Cloud Sync',
      location: 'Cloud ERP',
      status: 'OPEN',
      reportedBy: 'system-orphan-watchdog',
      userId: 'system-orphan-watchdog',
    },
  });
  return true;
}

// ── Stock-gap scan: CONFIRMED GRN > 30 min old without StockMovement ──
// This is the Apr-2026 ₹3.1 cr failure class. Watchdog attempts a single
// self-heal retry via syncToInventory; if that still fails, logSyncFailure
// inside syncToInventory writes a HIGH PlantIssue so it doesn't stay silent.
interface StockGap {
  id: string;
  grnNo: number;
  vehicleNo: string | null;
  inventoryItemId: string;
  acceptedQty: number;
  rate: number;
}

async function findStockGaps(): Promise<StockGap[]> {
  return prisma.$queryRaw<StockGap[]>`
    SELECT g.id, g."grnNo", g."vehicleNo",
           gl."inventoryItemId", gl."acceptedQty", gl.rate
    FROM "GoodsReceipt" g
    JOIN "GRNLine" gl ON gl."grnId" = g.id
    WHERE g.status = 'CONFIRMED'
      AND g."createdAt" < NOW() - INTERVAL '30 minutes'
      AND gl."inventoryItemId" IS NOT NULL
      AND gl."acceptedQty" > 0
      AND NOT EXISTS (
        SELECT 1 FROM "StockMovement" sm
        WHERE sm."refType" = 'GRN' AND sm."refId" = g.id
      )
    ORDER BY g."createdAt" DESC
    LIMIT 100
  `;
}

async function healStockGap(gap: StockGap): Promise<boolean> {
  try {
    await syncToInventory(
      'GRN', gap.id, `GRN-${gap.grnNo}`,
      gap.inventoryItemId, gap.acceptedQty, gap.rate,
      'IN', 'GRN_RECEIPT',
      `Watchdog self-heal: GRN-${gap.grnNo} | vehicle ${gap.vehicleNo || '?'}`,
      'system-orphan-watchdog',
    );
    return true;
  } catch (err) {
    console.error(`[orphan-watchdog] heal failed for GRN-${gap.grnNo}: ${(err as Error).message}`);
    return false;
  }
}

async function tick(): Promise<void> {
  if (!_enabled) return;
  try {
    const orphans = await findOrphans();
    const currentIds = new Set(orphans.map(o => o.localId));

    // Ensure PlantIssue exists for every orphan (idempotent — silent if already there).
    let newIssueCount = 0;
    const newlyAppearedTickets: OrphanRow[] = [];
    for (const o of orphans) {
      const created = await ensurePlantIssue(o);
      if (created) newIssueCount++;
      if (!_lastSeen.has(o.localId)) newlyAppearedTickets.push(o);
    }

    // Telegram only when the set CHANGED — avoids repeating the same 7 names
    // every 10 minutes. The PlantIssue dedupe handles the persistent record.
    if (newlyAppearedTickets.length > 0) {
      const settings = await prisma.settings.findFirst({ select: { telegramGroup2ChatId: true } });
      if (settings?.telegramGroup2ChatId) {
        const lines = newlyAppearedTickets.slice(0, 10).map(o => {
          const mt = o.netWeight ? (o.netWeight / 1000).toFixed(2) : '?';
          return `🚨 t=${o.ticketNo ?? '?'} ${o.vehicleNo} ${o.supplierName ?? 'unknown'} ${mt}MT`;
        });
        const more = newlyAppearedTickets.length > 10 ? `\n_...and ${newlyAppearedTickets.length - 10} more_` : '';
        const msg = [
          '⚠️ *ORPHAN TRUCKS DETECTED*',
          `${newlyAppearedTickets.length} new (total: ${orphans.length})`,
          '',
          lines.join('\n'),
          more,
          '',
          '_Inbound weighment is COMPLETE but no GRN was created. Open /procurement/orphan-trucks_',
        ].filter(Boolean).join('\n');
        await broadcastToGroup(settings.telegramGroup2ChatId, msg, 'orphan-watchdog').catch(() => {});
      }
    }

    if (orphans.length > 0 || newIssueCount > 0) {
      console.log(`[orphan-watchdog] orphans=${orphans.length} newIssues=${newIssueCount} newlyAppeared=${newlyAppearedTickets.length}`);
    }
    _lastSeen = currentIds;

    // ── Stock-gap pass ──
    const stockGaps = await findStockGaps();
    const currentStockIds = new Set(stockGaps.map(g => g.id));
    const newStockGaps = stockGaps.filter(g => !_lastSeenStockGaps.has(g.id));

    let healed = 0;
    let stillBroken = 0;
    for (const gap of stockGaps) {
      const ok = await healStockGap(gap);
      if (ok) healed++; else stillBroken++;
    }

    if (newStockGaps.length > 0 && stillBroken > 0) {
      const settings = await prisma.settings.findFirst({ select: { telegramGroup2ChatId: true } });
      if (settings?.telegramGroup2ChatId) {
        const lines = newStockGaps.slice(0, 10).map(g => `🚨 GRN-${g.grnNo} ${g.vehicleNo || '?'} qty=${g.acceptedQty}`);
        const more = newStockGaps.length > 10 ? `\n_...and ${newStockGaps.length - 10} more_` : '';
        const msg = [
          '⚠️ *GRN → NO STOCK MOVEMENT*',
          `${newStockGaps.length} new (still broken after heal: ${stillBroken})`,
          '',
          lines.join('\n'),
          more,
          '',
          '_Confirmed GRN >30min old has no StockMovement. Watchdog retried syncToInventory — see PlantIssue for reason._',
        ].filter(Boolean).join('\n');
        await broadcastToGroup(settings.telegramGroup2ChatId, msg, 'orphan-watchdog').catch(() => {});
      }
    }

    if (stockGaps.length > 0 || healed > 0) {
      console.log(`[orphan-watchdog] stockGaps=${stockGaps.length} healed=${healed} stillBroken=${stillBroken}`);
    }
    _lastSeenStockGaps = currentStockIds;
  } catch (err) {
    console.error('[orphan-watchdog] tick failed:', (err as Error).message);
  }
}

export function startOrphanGrnWatchdog(): void {
  if (_timer) return;
  console.log('[orphan-watchdog] starting (10 min tick, 30 min grace)');
  // First tick after 2 minutes so server settles + masterDataCache warms up
  setTimeout(() => {
    tick().catch(err => console.warn('[orphan-watchdog] initial tick failed:', err));
    _timer = setInterval(() => {
      tick().catch(err => console.warn('[orphan-watchdog] tick failed:', err));
    }, TICK_MS);
  }, 2 * 60 * 1000);
}

export function stopOrphanGrnWatchdog(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
