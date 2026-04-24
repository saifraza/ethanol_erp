import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '../prisma';
import type { ScaleSession } from './activeScaleSession';

/**
 * Per-truck-cycle manifest writer + Weighment-table enricher.
 *
 * Each weight-triggered capture cycle gets its own subdirectory
 * (data/videos/motion/{date}/{cycle_id}/) containing all media + a
 * manifest.json describing the cycle. The manifest is the structured label
 * that downstream training pipelines read — it answers:
 *   - Which files belong to this truck visit?
 *   - When did each event fire and at what weight?
 *   - What was the truck (plate, transporter, supplier, material) — joined
 *     from the Weighment table 60 sec after cycle end (Phase A enrichment).
 *
 * Manifest is updated incrementally as events fire so we never lose data even
 * if the server restarts mid-cycle.
 */

const VIDEO_ROOT = path.join(__dirname, '..', '..', 'data', 'videos');
const ENRICHMENT_WINDOW_MIN = 10;           // search Weighment grossTime/tareTime within ±10 min
const ENRICHMENT_WEIGHT_TOLERANCE_KG = 750; // ± kg from capturedMax to consider a match (widened 2026-04-22 from 500 — recovered close-but-just-over matches)
// Re-enrich at increasing delays — recovers late-finalized weighments (operator selects pending
// minutes after truck leaves) without needing to get the first try right.
const ENRICHMENT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const NOISE_DURATION_THRESHOLD_SEC = 20;    // cycles shorter than this are pass-throughs (truck drove across without stopping), not weighments

export interface CycleEvent {
  type: 'arrival' | 'motion' | 'departure';
  seq?: number;
  at: string;
  weight_kg: number;
  delta_kg?: number;     // for motion events
  files: string[];       // relative to cycle dir
}

export interface CycleManifest {
  cycle_id: string;
  date: string;
  started_at: string;
  ended_at?: string;
  duration_sec?: number;
  captured_max_kg?: number;
  motion_event_count?: number;
  events: CycleEvent[];
  // Direct association (set during capture when operator has an active weighment on scale)
  direct_weighment?: {
    weighment_id: string;
    vehicle_no: string;
    ticket_no: number | null;
    direction: string | null;
    phase: 'gross' | 'tare';
    material_name: string | null;
    material_category: string | null;
    associated_at: string;
    source: 'active_session';
  };
  // Enriched fields (populated 60s after cycle end — uses direct_weighment ID if available, else fuzzy match)
  weighment?: {
    matched_at: string;
    weighment_id: string;
    ticket_no: number | null;
    vehicle_no: string;                  // ← truck identity / plate-OCR label
    direction: string;                   // INBOUND/OUTBOUND ← direction-classifier label
    phase: 'gross' | 'tare';             // which weighing this cycle was
    transporter: string | null;
    vehicle_type: string | null;         // ← truck-type-classifier label (Truck 14W, Tractor Trolley, etc.)
    driver_name: string | null;
    supplier_name: string | null;
    material_name: string | null;        // ← material-classifier label (corn, DDGS, ethanol, etc.)
    material_category: string | null;    // RAW_MATERIAL/FUEL/CHEMICAL/PACKING
    purchase_type: string | null;
    po_number: string | null;
    weight_loaded_kg: number | null;     // Weighment.grossWeight ← weight-regression label
    weight_empty_kg: number | null;      // Weighment.tareWeight
    net_weight_kg: number | null;        // computed: loaded - empty (the actual cargo weight)
    bags: number | null;                 // ← bag-count regression label (when applicable)
    shift: string | null;                // operational metadata (time-of-day proxy)
    // Ethanol-tanker-specific labels (when present): cross-validate against
    // capacity OCR painted on tanker side (e.g. "40000 LTR") + alcohol-strength
    // OCR if displayed.
    quantity_bl: number | null;          // Weighment.quantityBL — volume in bulk litres
    strength_pct: number | null;         // Weighment.strength — alcohol %
    seal_no: string | null;              // Weighment.sealNo — tanker seal number
    weight_match_delta_kg: number;       // |capturedMax - matched weighment weight|
  };
  // Set if cycle was too short to be a real weighment (truck drove across without stopping)
  noise?: { reason: string; classified_at: string };
  // Set if enrichment found no plausible Weighment match. Cleared on a later retry that succeeds.
  weighment_unmatched?: { reason: string; checked_at: string };
}

/** Build a sortable, readable cycle id: YYYYMMDD_HHMMSS_4hex (UTC). */
export function generateCycleId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  const date = ts.slice(0, 8);
  const time = ts.slice(8, 14);
  const rand = crypto.randomBytes(2).toString('hex');
  return `${date}_${time}_${rand}`;
}

/** Get the on-disk dir for this cycle's media + manifest. */
export function getCycleDir(cycleId: string): string {
  // cycle_id starts with YYYYMMDD — group manifests by date for easy purging
  const dateStr = `${cycleId.slice(0, 4)}-${cycleId.slice(4, 6)}-${cycleId.slice(6, 8)}`;
  return path.join(VIDEO_ROOT, 'motion', dateStr, cycleId);
}

function manifestPath(cycleId: string): string {
  return path.join(getCycleDir(cycleId), 'manifest.json');
}

/** Create the cycle dir + initial manifest. Idempotent. */
export function initManifest(cycleId: string, startedAt: Date): void {
  try {
    const dir = getCycleDir(cycleId);
    fs.mkdirSync(dir, { recursive: true });
    const dateStr = `${cycleId.slice(0, 4)}-${cycleId.slice(4, 6)}-${cycleId.slice(6, 8)}`;
    const manifest: CycleManifest = {
      cycle_id: cycleId,
      date: dateStr,
      started_at: startedAt.toISOString(),
      events: [],
    };
    writeManifest(cycleId, manifest);
  } catch (err) {
    console.error('[MANIFEST] init error:', err instanceof Error ? err.message : err);
  }
}

/** Append an event to the cycle manifest. Safe if manifest doesn't exist yet. */
export function appendEvent(cycleId: string, event: CycleEvent): void {
  try {
    const m = readManifest(cycleId);
    if (!m) return;
    m.events.push(event);
    writeManifest(cycleId, m);
  } catch (err) {
    console.error('[MANIFEST] append error:', err instanceof Error ? err.message : err);
  }
}

/** Mark cycle as ended; schedule enrichment 60s later. */
export function finalizeManifest(
  cycleId: string,
  endedAt: Date,
  capturedMaxKg: number,
  motionEventCount: number,
): void {
  try {
    const m = readManifest(cycleId);
    if (!m) return;
    m.ended_at = endedAt.toISOString();
    m.duration_sec = Math.round((endedAt.getTime() - new Date(m.started_at).getTime()) / 1000);
    m.captured_max_kg = capturedMaxKg;
    m.motion_event_count = motionEventCount;
    writeManifest(cycleId, m);

    // Pass-through: truck drove across the scale without ever stopping. No operator capture possible.
    if (m.duration_sec != null && m.duration_sec < NOISE_DURATION_THRESHOLD_SEC) {
      m.noise = {
        reason: `cycle duration ${m.duration_sec}s < ${NOISE_DURATION_THRESHOLD_SEC}s (pass-through, not a weighment)`,
        classified_at: new Date().toISOString(),
      };
      writeManifest(cycleId, m);
      console.log(`[MANIFEST] ${cycleId}: NOISE — ${m.noise.reason}`);
      return;
    }

    // Schedule enrichment at 60s, 5min, 30min — later retries recover late-finalized weighments.
    // Each attempt is idempotent: skips if manifest already has a matched weighment.
    for (const delay of ENRICHMENT_RETRY_DELAYS_MS) {
      setTimeout(() => {
        enrichManifestFromWeighment(cycleId).catch((err) =>
          console.error(`[MANIFEST] enrichment error for ${cycleId}:`, err instanceof Error ? err.message : err),
        );
      }, delay);
    }
  } catch (err) {
    console.error('[MANIFEST] finalize error:', err instanceof Error ? err.message : err);
  }
}

/**
 * Look up the Weighment row that best matches this cycle (by timestamp + weight)
 * and write the enriched fields into the manifest.
 *
 * Matching: find Weighment rows where grossTime OR tareTime is within ±10 min
 * of the cycle, then pick the one whose grossWeight or tareWeight is closest
 * to capturedMax. Confident if delta < 500 kg.
 */
export async function enrichManifestFromWeighment(cycleId: string): Promise<void> {
  const m = readManifest(cycleId);
  if (!m || !m.captured_max_kg || !m.started_at || !m.ended_at) return;
  // Idempotent: a prior retry already matched this cycle — nothing more to do.
  if (m.weighment?.weighment_id) return;

  const capMax = m.captured_max_kg;

  const WEIGHMENT_SELECT = {
    id: true, ticketNo: true, vehicleNo: true, direction: true,
    transporter: true, vehicleType: true, driverName: true,
    supplierName: true, materialName: true, materialCategory: true,
    purchaseType: true, poNumber: true,
    grossWeight: true, tareWeight: true, netWeight: true,
    grossTime: true, tareTime: true,
    bags: true, shift: true,
    quantityBL: true, strength: true, sealNo: true,
  } as const;

  // ── DIRECT PATH: if active session linked a weighment ID, use it (no guessing) ──
  if (m.direct_weighment?.weighment_id) {
    let w;
    try {
      w = await prisma.weighment.findUnique({
        where: { id: m.direct_weighment.weighment_id },
        select: WEIGHMENT_SELECT,
      });
    } catch (err) {
      console.error(`[MANIFEST] direct lookup failed for ${cycleId}:`, err instanceof Error ? err.message : err);
      return;
    }

    const fresh = readManifest(cycleId);
    if (!fresh || !w) return;

    const netComputed = w.netWeight ?? (w.grossWeight != null && w.tareWeight != null ? w.grossWeight - w.tareWeight : null);
    const matchedWeight = m.direct_weighment.phase === 'gross' ? w.grossWeight : w.tareWeight;
    delete fresh.weighment_unmatched;
    fresh.weighment = {
      matched_at: new Date().toISOString(),
      weighment_id: w.id,
      ticket_no: w.ticketNo,
      vehicle_no: w.vehicleNo,
      direction: w.direction,
      phase: m.direct_weighment.phase,
      transporter: w.transporter,
      vehicle_type: w.vehicleType,
      driver_name: w.driverName,
      supplier_name: w.supplierName,
      material_name: w.materialName,
      material_category: w.materialCategory,
      purchase_type: w.purchaseType,
      po_number: w.poNumber,
      weight_loaded_kg: w.grossWeight,
      weight_empty_kg: w.tareWeight,
      net_weight_kg: netComputed,
      bags: w.bags,
      shift: w.shift,
      quantity_bl: w.quantityBL,
      strength_pct: w.strength,
      seal_no: w.sealNo,
      weight_match_delta_kg: matchedWeight != null ? Math.round(Math.abs(capMax - matchedWeight)) : 0,
    };
    writeManifest(cycleId, fresh);
    console.log(
      `[MANIFEST] ${cycleId}: DIRECT ENRICHED ticket=${w.ticketNo} vehicle=${w.vehicleNo} ` +
      `material=${w.materialName ?? '?'} phase=${m.direct_weighment.phase} delta=${fresh.weighment.weight_match_delta_kg}kg`,
    );
    return;
  }

  // ── FUZZY FALLBACK: no direct association — search by timestamp + weight (legacy) ──
  const cycleStart = new Date(m.started_at);
  const cycleEnd = new Date(m.ended_at);
  const lo = new Date(cycleStart.getTime() - ENRICHMENT_WINDOW_MIN * 60_000);
  const hi = new Date(cycleEnd.getTime() + ENRICHMENT_WINDOW_MIN * 60_000);

  let candidates;
  try {
    candidates = await prisma.weighment.findMany({
      where: {
        OR: [
          { grossTime: { gte: lo, lte: hi } },
          { tareTime: { gte: lo, lte: hi } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: WEIGHMENT_SELECT,
    });
  } catch (err) {
    console.error(`[MANIFEST] db query failed for ${cycleId}:`, err instanceof Error ? err.message : err);
    return;
  }

  let best: { w: typeof candidates[0]; phase: 'gross' | 'tare'; delta: number } | null = null;
  for (const w of candidates) {
    if (w.grossWeight != null) {
      const d = Math.abs(w.grossWeight - capMax);
      if (!best || d < best.delta) best = { w, phase: 'gross', delta: d };
    }
    if (w.tareWeight != null) {
      const d = Math.abs(w.tareWeight - capMax);
      if (!best || d < best.delta) best = { w, phase: 'tare', delta: d };
    }
  }

  const fresh = readManifest(cycleId);
  if (!fresh) return;

  if (!best || best.delta > ENRICHMENT_WEIGHT_TOLERANCE_KG) {
    fresh.weighment_unmatched = {
      reason: best
        ? `closest weight match was ${Math.round(best.delta)} kg off (>${ENRICHMENT_WEIGHT_TOLERANCE_KG} kg tolerance)`
        : `no Weighment row had grossTime/tareTime within ±${ENRICHMENT_WINDOW_MIN} min`,
      checked_at: new Date().toISOString(),
    };
    writeManifest(cycleId, fresh);
    console.log(`[MANIFEST] ${cycleId}: NO match — fuzzy fallback (${fresh.weighment_unmatched.reason})`);
    return;
  }

  const w = best.w;
  // Derive net weight: prefer stored value, fall back to (loaded - empty)
  const netComputed =
    w.netWeight ??
    (w.grossWeight != null && w.tareWeight != null ? w.grossWeight - w.tareWeight : null);
  delete fresh.weighment_unmatched;
  fresh.weighment = {
    matched_at: new Date().toISOString(),
    weighment_id: w.id,
    ticket_no: w.ticketNo,
    vehicle_no: w.vehicleNo,
    direction: w.direction,
    phase: best.phase,
    transporter: w.transporter,
    vehicle_type: w.vehicleType,
    driver_name: w.driverName,
    supplier_name: w.supplierName,
    material_name: w.materialName,
    material_category: w.materialCategory,
    purchase_type: w.purchaseType,
    po_number: w.poNumber,
    weight_loaded_kg: w.grossWeight,
    weight_empty_kg: w.tareWeight,
    net_weight_kg: netComputed,
    bags: w.bags,
    shift: w.shift,
    quantity_bl: w.quantityBL,
    strength_pct: w.strength,
    seal_no: w.sealNo,
    weight_match_delta_kg: Math.round(best.delta),
  };
  writeManifest(cycleId, fresh);
  console.log(
    `[MANIFEST] ${cycleId}: MATCHED ticket=${w.ticketNo} vehicle=${w.vehicleNo} ` +
    `material=${w.materialName ?? '?'} phase=${best.phase} delta=${Math.round(best.delta)}kg`,
  );
}

/**
 * Attach a direct weighment association from the active scale session.
 * Called at arrival, motion, departure, and finalization — idempotent,
 * only writes if not already set (first association wins).
 */
export function attachWeighmentDirect(cycleId: string, session: ScaleSession): void {
  try {
    const m = readManifest(cycleId);
    if (!m) return;
    if (m.direct_weighment) return; // already associated — don't overwrite
    m.direct_weighment = {
      weighment_id: session.weighmentId,
      vehicle_no: session.vehicleNo,
      ticket_no: session.ticketNo,
      direction: session.direction,
      phase: session.phase,
      material_name: session.materialName,
      material_category: session.materialCategory,
      associated_at: new Date().toISOString(),
      source: 'active_session',
    };
    writeManifest(cycleId, m);
    console.log(
      `[MANIFEST] ${cycleId}: DIRECT association → ${session.vehicleNo} t${session.ticketNo} ${session.phase}`,
    );
  } catch (err) {
    console.error('[MANIFEST] attachWeighmentDirect error:', err instanceof Error ? err.message : err);
  }
}

function readManifest(cycleId: string): CycleManifest | null {
  try {
    const buf = fs.readFileSync(manifestPath(cycleId), 'utf8');
    return JSON.parse(buf) as CycleManifest;
  } catch {
    return null;
  }
}

function writeManifest(cycleId: string, m: CycleManifest): void {
  fs.writeFileSync(manifestPath(cycleId), JSON.stringify(m, null, 2));
}
