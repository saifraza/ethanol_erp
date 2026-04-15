/**
 * Business Rules Engine
 * Checks configurable rules before weighbridge operations.
 * Rules are cached in memory and refreshed on update.
 */

import prisma from '../prisma';
import { getAllPCStatus, fetchLiveWeight } from './pcMonitor';

export interface RuleResult {
  passed: boolean;
  ruleKey: string;
  ruleLabel: string;
  message: string;
  canOverride: boolean;
  meta?: Record<string, unknown>; // extra data for the operator UI (live weight, prev capture details, etc)
}

interface CachedRule {
  key: string;
  label: string;
  value: string;
  valueType: string;
  category: string;
  enabled: boolean;
}

// In-memory cache
let _rules: CachedRule[] = [];
let _lastLoad = 0;
const CACHE_TTL_MS = 10_000; // 10s — fast enough for admin changes

/** Load rules from DB (with TTL cache). */
async function loadRules(): Promise<CachedRule[]> {
  const now = Date.now();
  if (_rules.length > 0 && now - _lastLoad < CACHE_TTL_MS) return _rules;

  const rows = await prisma.businessRule.findMany({
    where: { enabled: true },
    select: { key: true, label: true, value: true, valueType: true, category: true, enabled: true },
  });
  _rules = rows;
  _lastLoad = now;
  return _rules;
}

/** Force cache refresh (call after admin updates a rule). */
export function invalidateRuleCache(): void {
  _lastLoad = 0;
}

/** Get a single rule value by key. Returns null if not found or disabled. */
export async function getRuleValue(key: string): Promise<string | null> {
  const rules = await loadRules();
  const rule = rules.find(r => r.key === key);
  return rule ? rule.value : null;
}

/** Get numeric rule value. Returns default if not found. */
export async function getNumericRule(key: string, defaultVal: number): Promise<number> {
  const val = await getRuleValue(key);
  if (val === null) return defaultVal;
  const num = parseFloat(val);
  return isNaN(num) ? defaultVal : num;
}

// ============================================================
// RULE CHECKS — one function per rule key
// ============================================================

interface WeighmentContext {
  id: string;
  ticketNo: number | null;
  direction: string;
  status: string;
  grossTime: Date | null;
  tareTime: Date | null;
  vehicleNo: string;
  materialCategory: string | null;
}

async function checkDuplicateWeight(
  ctx: WeighmentContext,
  action: 'GROSS' | 'TARE',
  newWeight: number,
  pcId: string,
): Promise<RuleResult | null> {
  const rules = await loadRules();
  // Master switch = the enabled flag on DUPLICATE_WEIGHT_WINDOW_MINUTES rule.
  // loadRules() only returns enabled rules, so absence = disabled.
  const windowRule = rules.find(r => r.key === 'DUPLICATE_WEIGHT_WINDOW_MINUTES');
  if (!windowRule) return null;

  const windowMin = parseFloat(windowRule.value) || 30;
  const lookback = Math.max(1, Math.min(20, await getNumericRule('DUPLICATE_WEIGHT_LOOKBACK', 3)));
  const toleranceKg = await getNumericRule('DUPLICATE_WEIGHT_TOLERANCE_KG', 0);

  const since = new Date(Date.now() - windowMin * 60_000);
  // Scope: same PC (weighbridge station). We compare against whichever field this action writes.
  const weightField = action === 'GROSS' ? 'grossWeight' : 'tareWeight';
  const timeField = action === 'GROSS' ? 'grossTime' : 'tareTime';
  const pcField = action === 'GROSS' ? 'grossPcId' : 'tarePcId';

  const recent = await prisma.weighment.findMany({
    where: {
      id: { not: ctx.id },
      [pcField]: pcId,
      [timeField]: { gte: since },
      [weightField]: { not: null },
    },
    orderBy: { [timeField]: 'desc' },
    take: lookback,
    select: { ticketNo: true, vehicleNo: true, [weightField]: true, [timeField]: true } as Record<string, true>,
  });

  const match = (recent as Array<Record<string, unknown>>).find(r => {
    const w = r[weightField] as number | null;
    if (w == null) return false;
    return Math.abs(w - newWeight) <= toleranceKg;
  });

  if (!match) {
    return { passed: true, ruleKey: windowRule.key, ruleLabel: windowRule.label, message: '', canOverride: false };
  }

  const prevWt = match[weightField] as number;
  const prevTicket = match.ticketNo as number | null;
  const prevVeh = match.vehicleNo as string;
  const prevTime = match[timeField] as Date;
  const minsAgo = Math.round((Date.now() - new Date(prevTime).getTime()) / 60_000);

  return {
    passed: false,
    ruleKey: windowRule.key,
    ruleLabel: windowRule.label,
    message: `Weight ${newWeight.toLocaleString('en-IN')} kg is identical to previous weighment T-${prevTicket} (${prevVeh}, ${prevWt.toLocaleString('en-IN')} kg, ${minsAgo} min ago). Digitizer may be frozen — press ESC on digitizer and re-weigh.`,
    canOverride: true,
  };
}

async function checkMinWeightInterval(ctx: WeighmentContext, action: 'GROSS' | 'TARE'): Promise<RuleResult | null> {
  const rules = await loadRules();
  const rule = rules.find(r => r.key === 'MIN_WEIGHT_INTERVAL_MINUTES');
  if (!rule) return null;

  const minMinutes = parseFloat(rule.value);
  if (isNaN(minMinutes) || minMinutes <= 0) return null;

  // Check time since previous weight
  let prevTime: Date | null = null;
  if (action === 'TARE' && ctx.direction === 'INBOUND') {
    // Inbound: gross was first, now doing tare
    prevTime = ctx.grossTime;
  } else if (action === 'GROSS' && ctx.direction === 'OUTBOUND') {
    // Outbound: tare was first, now doing gross
    prevTime = ctx.tareTime;
  }

  // First weight — no prior to compare
  if (!prevTime) return null;

  const elapsedMs = Date.now() - prevTime.getTime();
  const elapsedMinutes = elapsedMs / 60_000;

  if (elapsedMinutes >= minMinutes) {
    return { passed: true, ruleKey: rule.key, ruleLabel: rule.label, message: '', canOverride: false };
  }

  const remaining = Math.ceil(minMinutes - elapsedMinutes);
  return {
    passed: false,
    ruleKey: rule.key,
    ruleLabel: rule.label,
    message: `Must wait ${minMinutes} minutes between weights. ${remaining} minute(s) remaining.`,
    canOverride: true,
  };
}

// ============================================================
// R1: SCALE-MUST-RETURN-TO-ZERO between captures (HARD BLOCK)
//
// Catches the cross-ticket "two trucks back-to-back without removing the
// first one" case (incident 2026-04-15). The 10-min interval rule does NOT
// catch this because it scopes to the same weighment.
//
// Approach: at capture time, fetch live weight from the WB PC. If a previous
// capture happened on this scale within the staleness window AND the live
// reading is still close to that captured weight, the truck never left.
// Block until the operator removes the truck.
//
// Master switch: SCALE_ZERO_REQUIRED enabled flag (loadRules filters by enabled).
// Threshold: SCALE_ZERO_THRESHOLD_KG (default 50).
// Lookback: SCALE_ZERO_WINDOW_MINUTES (default 30).
// ============================================================

async function checkScaleZero(
  ctx: WeighmentContext,
  action: 'GROSS' | 'TARE',
  newWeight: number,
  pcId: string,
): Promise<RuleResult | null> {
  const rules = await loadRules();
  const masterRule = rules.find(r => r.key === 'SCALE_ZERO_REQUIRED');
  if (!masterRule || masterRule.value !== 'true') return null; // disabled

  const threshold = await getNumericRule('SCALE_ZERO_THRESHOLD_KG', 50);
  const windowMin = await getNumericRule('SCALE_ZERO_WINDOW_MINUTES', 30);
  const since = new Date(Date.now() - windowMin * 60_000);

  // Find the most recent capture on this scale (any ticket, any direction).
  // We compare against whichever weight column the previous capture wrote.
  const recent = await prisma.weighment.findFirst({
    where: {
      id: { not: ctx.id },
      OR: [
        { grossPcId: pcId, grossTime: { gte: since }, grossWeight: { not: null } },
        { tarePcId: pcId, tareTime: { gte: since }, tareWeight: { not: null } },
      ],
    },
    orderBy: [{ grossTime: 'desc' }, { tareTime: 'desc' }],
    select: {
      ticketNo: true, vehicleNo: true,
      grossWeight: true, tareWeight: true,
      grossTime: true, tareTime: true,
      grossPcId: true, tarePcId: true,
    },
  });

  if (!recent) return null; // no recent capture, scale is presumed clean

  // Pick whichever capture was actually on this PC and most recent
  let prevWeight: number | null = null;
  let prevTime: Date | null = null;
  if (recent.grossPcId === pcId && recent.grossTime && recent.grossWeight != null) {
    prevWeight = recent.grossWeight;
    prevTime = recent.grossTime;
  }
  if (recent.tarePcId === pcId && recent.tareTime && recent.tareWeight != null) {
    if (!prevTime || recent.tareTime > prevTime) {
      prevWeight = recent.tareWeight;
      prevTime = recent.tareTime;
    }
  }
  if (prevWeight == null || prevTime == null) return null;

  // Read live weight from the scale (fail-open on timeout — see fetchLiveWeight)
  const live = await fetchLiveWeight(pcId);
  if (live == null) {
    // Scale unreachable — log and allow (don't block trucks because the
    // monitor is down). The operator will see status DISCONNECTED in the UI.
    return null;
  }

  // If the live weight is still close to the captured weight AND non-zero,
  // the previous truck is still on the scale.
  const diffFromPrev = Math.abs(live - prevWeight);
  const liveAbs = Math.abs(live);
  const trucksLikelySame = diffFromPrev <= threshold && liveAbs > threshold;
  if (!trucksLikelySame) {
    return { passed: true, ruleKey: 'SCALE_ZERO_REQUIRED', ruleLabel: masterRule.label, message: '', canOverride: false };
  }

  const minsAgo = Math.round((Date.now() - prevTime.getTime()) / 60_000);
  return {
    passed: false,
    ruleKey: 'SCALE_ZERO_REQUIRED',
    ruleLabel: masterRule.label,
    message: `Scale not zero — previous truck T-${recent.ticketNo} (${recent.vehicleNo}, ${prevWeight.toLocaleString('en-IN')} kg, ${minsAgo} min ago) appears to still be on the scale. Live reading: ${live.toLocaleString('en-IN')} kg. Remove the vehicle and bring the scale to zero before capturing the next weight. Action requested: capture ${newWeight.toLocaleString('en-IN')} kg for T-${ctx.ticketNo ?? '?'}.`,
    canOverride: true,
    meta: {
      liveScaleWeight: live,
      prevWeight,
      prevTicket: recent.ticketNo,
      prevVehicle: recent.vehicleNo,
      prevAtMinAgo: minsAgo,
      thresholdKg: threshold,
    },
  };
}

// ============================================================
// R2: CONSECUTIVE-WEIGHT DELTA (SOFT CONFIRM + cloud audit log)
//
// Even if R1's live-scale check is unreachable / disabled, the next captured
// weight being within ±N kg of any recent capture on the same PC is a strong
// signal that the truck didn't move. This rule does NOT hard-block — it
// requires the operator to explicitly confirm via a flag, and the
// confirmation is logged to the cloud (WeighmentAuditEvent).
//
// Master switch: WEIGHT_DELTA_CONFIRM_KG enabled flag.
// Threshold: WEIGHT_DELTA_CONFIRM_KG (default 20). 0 disables.
// Lookback: WEIGHT_DELTA_LOOKBACK_MINUTES (default 30).
// Distinct from existing DUPLICATE_WEIGHT_* (which hard-blocks on near-exact
// match for the frozen-digitizer case). DELTA covers the truck-still-on-scale
// case where weight varies slightly due to fuel, driver moving, etc.
// ============================================================

async function checkWeightDelta(
  ctx: WeighmentContext,
  action: 'GROSS' | 'TARE',
  newWeight: number,
  pcId: string,
): Promise<RuleResult | null> {
  const rules = await loadRules();
  const rule = rules.find(r => r.key === 'WEIGHT_DELTA_CONFIRM_KG');
  if (!rule) return null;
  const threshold = parseFloat(rule.value);
  if (isNaN(threshold) || threshold <= 0) return null;

  const windowMin = await getNumericRule('WEIGHT_DELTA_LOOKBACK_MINUTES', 30);
  const since = new Date(Date.now() - windowMin * 60_000);

  const recent = await prisma.weighment.findMany({
    where: {
      id: { not: ctx.id },
      OR: [
        { grossPcId: pcId, grossTime: { gte: since }, grossWeight: { not: null } },
        { tarePcId: pcId, tareTime: { gte: since }, tareWeight: { not: null } },
      ],
    },
    orderBy: [{ grossTime: 'desc' }, { tareTime: 'desc' }],
    take: 5,
    select: {
      ticketNo: true, vehicleNo: true,
      grossWeight: true, tareWeight: true,
      grossTime: true, tareTime: true,
      grossPcId: true, tarePcId: true,
    },
  });

  // Find the closest match within threshold
  let closest: { weight: number; time: Date; ticket: number | null; vehicle: string } | null = null;
  let closestDiff = Infinity;
  for (const r of recent) {
    const candidates: Array<{ w: number | null; t: Date | null; pc: string | null }> = [
      { w: r.grossWeight, t: r.grossTime, pc: r.grossPcId },
      { w: r.tareWeight, t: r.tareTime, pc: r.tarePcId },
    ];
    for (const c of candidates) {
      if (c.w == null || c.t == null || c.pc !== pcId) continue;
      const diff = Math.abs(c.w - newWeight);
      if (diff <= threshold && diff < closestDiff) {
        closestDiff = diff;
        closest = { weight: c.w, time: c.t, ticket: r.ticketNo, vehicle: r.vehicleNo };
      }
    }
  }

  if (!closest) {
    return { passed: true, ruleKey: rule.key, ruleLabel: rule.label, message: '', canOverride: false };
  }

  const minsAgo = Math.round((Date.now() - closest.time.getTime()) / 60_000);
  return {
    passed: false,
    ruleKey: rule.key,
    ruleLabel: rule.label,
    message: `Weight ${newWeight.toLocaleString('en-IN')} kg is within ${threshold} kg of T-${closest.ticket} (${closest.vehicle}, ${closest.weight.toLocaleString('en-IN')} kg, ${minsAgo} min ago). Possible same-truck-still-on-scale. Confirm to proceed (will be logged to cloud audit).`,
    canOverride: true,
    meta: {
      prevWeight: closest.weight,
      prevTicket: closest.ticket,
      prevVehicle: closest.vehicle,
      prevAtMinAgo: minsAgo,
      diffKg: closestDiff,
      thresholdKg: threshold,
      confirmType: 'DELTA_CONFIRM',
    },
  };
}

// ============================================================
// MAIN CHECK — runs all applicable rules
// ============================================================

/** Check all enabled weighment rules. Returns only violations (failed rules). */
export async function checkWeighmentRules(
  weighmentId: string,
  action: 'GROSS' | 'TARE',
  newWeight?: number,
  pcId?: string,
): Promise<RuleResult[]> {
  // Load weighment context
  const w = await prisma.weighment.findUnique({
    where: { id: weighmentId },
    select: {
      id: true, ticketNo: true, direction: true, status: true,
      grossTime: true, tareTime: true,
      vehicleNo: true, materialCategory: true,
    },
  });
  if (!w) return [];

  const ctx: WeighmentContext = {
    id: w.id,
    ticketNo: w.ticketNo,
    direction: w.direction,
    status: w.status,
    grossTime: w.grossTime,
    tareTime: w.tareTime,
    vehicleNo: w.vehicleNo,
    materialCategory: w.materialCategory,
  };

  const effectivePcId = pcId || 'web';

  // Run all rule checks
  const checks = [
    checkMinWeightInterval(ctx, action),
    newWeight != null ? checkDuplicateWeight(ctx, action, newWeight, effectivePcId) : Promise.resolve(null),
    newWeight != null ? checkScaleZero(ctx, action, newWeight, effectivePcId) : Promise.resolve(null),
    newWeight != null ? checkWeightDelta(ctx, action, newWeight, effectivePcId) : Promise.resolve(null),
    // Future rules added here:
    // checkMaxWeightLimit(ctx, action),
    // checkAllowedHours(ctx, action),
    // checkDuplicateVehicle(ctx, action),
  ];

  const results = await Promise.all(checks);
  return results.filter((r): r is RuleResult => r !== null && !r.passed);
}

// ============================================================
// OVERRIDE VERIFICATION
// ============================================================

/** Verify admin override PIN. Returns true if valid. */
export async function verifyOverridePin(pin: string): Promise<boolean> {
  const storedPin = await getRuleValue('ADMIN_OVERRIDE_PIN');
  if (!storedPin) return pin === '1234'; // Default PIN
  return pin === storedPin;
}

/** Log an override to the audit trail (legacy local table — kept for backward compat). */
export async function logOverride(
  ruleKey: string,
  weighmentId: string,
  action: string,
  overriddenBy: string,
  reason?: string,
): Promise<void> {
  await prisma.ruleOverrideLog.create({
    data: { ruleKey, weighmentId, action, overriddenBy, reason },
  });
}

// ============================================================
// CLOUD AUDIT QUEUE — events pushed to cloud WeighmentAuditEvent
// via syncWorker. Local row is the source of truth until acked.
// ============================================================

export type AuditEventType =
  | 'SCALE_NOT_ZERO_OVERRIDE'
  | 'DELTA_CONFIRMED'
  | 'INTERVAL_OVERRIDE'
  | 'DUPLICATE_OVERRIDE';

export interface AuditEventInput {
  eventType: AuditEventType;
  ruleKey?: string | null;
  weighmentId: string;
  action: 'GROSS' | 'TARE' | 'GATE_ENTRY';
  pcId?: string | null;
  newWeight?: number | null;
  prevWeight?: number | null;
  liveScaleWeight?: number | null;
  thresholdKg?: number | null;
  message?: string | null;
  confirmedBy: string;
  confirmReason?: string | null;
  rawPayload?: Record<string, unknown> | null;
}

// Rule-key → audit-event-type mapping
const RULE_TO_EVENT: Record<string, AuditEventType> = {
  'SCALE_ZERO_REQUIRED': 'SCALE_NOT_ZERO_OVERRIDE',
  'WEIGHT_DELTA_CONFIRM_KG': 'DELTA_CONFIRMED',
  'MIN_WEIGHT_INTERVAL_MINUTES': 'INTERVAL_OVERRIDE',
  'DUPLICATE_WEIGHT_WINDOW_MINUTES': 'DUPLICATE_OVERRIDE',
};

export interface RuleEnforceOutcome {
  status: 'PASSED' | 'NEEDS_CONFIRM' | 'NEEDS_PIN' | 'BAD_PIN';
  violations: RuleResult[];
  errorCode?: 'DELTA_CONFIRM_REQUIRED' | 'SCALE_NOT_ZERO' | 'RULE_VIOLATION' | 'INVALID_PIN';
}

/**
 * Centralised gate for rule violations. Splits violations into two buckets:
 *   - DELTA_CONFIRMED → soft confirm (no PIN, just confirmDelta=true flag)
 *   - everything else → admin PIN required
 * Logs audit events for each handled violation to the cloud queue.
 *
 * Returns:
 *   PASSED         — no violations OR all cleared, route may proceed
 *   NEEDS_CONFIRM  — DELTA-only violations and confirmDelta not set → return 422
 *   NEEDS_PIN      — at least one PIN-required violation and no PIN → return 422
 *   BAD_PIN        — PIN supplied but invalid → return 403
 */
export async function enforceWeighmentRules(args: {
  weighmentId: string;
  action: 'GROSS' | 'TARE';
  weight: number;
  pcId: string;
  body: Record<string, unknown>;
  userName: string;
}): Promise<RuleEnforceOutcome> {
  const violations = await checkWeighmentRules(args.weighmentId, args.action, args.weight, args.pcId);
  if (violations.length === 0) return { status: 'PASSED', violations: [] };

  const isDelta = (v: RuleResult) => v.ruleKey === 'WEIGHT_DELTA_CONFIRM_KG';
  const deltaViolations = violations.filter(isDelta);
  const pinViolations = violations.filter(v => !isDelta(v));
  const isScaleZero = pinViolations.some(v => v.ruleKey === 'SCALE_ZERO_REQUIRED');

  const confirmDelta = args.body.confirmDelta === true;
  const overridePin = typeof args.body.overridePin === 'string' ? (args.body.overridePin as string) : '';
  const overrideBy = (typeof args.body.overrideBy === 'string' ? args.body.overrideBy : args.userName) || 'unknown';
  const confirmReason = typeof args.body.confirmReason === 'string' ? (args.body.confirmReason as string) : null;

  // Bucket 1: PIN-required violations
  if (pinViolations.length > 0) {
    if (!overridePin) {
      return {
        status: 'NEEDS_PIN',
        violations: pinViolations,
        errorCode: isScaleZero ? 'SCALE_NOT_ZERO' : 'RULE_VIOLATION',
      };
    }
    const pinOk = await verifyOverridePin(overridePin);
    if (!pinOk) return { status: 'BAD_PIN', violations: pinViolations, errorCode: 'INVALID_PIN' };
  }

  // Bucket 2: DELTA confirm
  if (deltaViolations.length > 0 && !confirmDelta) {
    return { status: 'NEEDS_CONFIRM', violations: deltaViolations, errorCode: 'DELTA_CONFIRM_REQUIRED' };
  }

  // All cleared — log every handled violation
  for (const v of pinViolations) {
    const eventType = RULE_TO_EVENT[v.ruleKey] || 'INTERVAL_OVERRIDE';
    const meta = (v.meta || {}) as Record<string, unknown>;
    await logOverride(v.ruleKey, args.weighmentId, args.action, overrideBy, confirmReason || undefined);
    await recordAuditEvent({
      eventType,
      ruleKey: v.ruleKey,
      weighmentId: args.weighmentId,
      action: args.action,
      pcId: args.pcId,
      newWeight: args.weight,
      prevWeight: typeof meta.prevWeight === 'number' ? meta.prevWeight : null,
      liveScaleWeight: typeof meta.liveScaleWeight === 'number' ? meta.liveScaleWeight : null,
      thresholdKg: typeof meta.thresholdKg === 'number' ? meta.thresholdKg : null,
      message: v.message,
      confirmedBy: overrideBy,
      confirmReason,
      rawPayload: { violation: v, body: args.body },
    });
  }
  for (const v of deltaViolations) {
    const meta = (v.meta || {}) as Record<string, unknown>;
    await recordAuditEvent({
      eventType: 'DELTA_CONFIRMED',
      ruleKey: v.ruleKey,
      weighmentId: args.weighmentId,
      action: args.action,
      pcId: args.pcId,
      newWeight: args.weight,
      prevWeight: typeof meta.prevWeight === 'number' ? meta.prevWeight : null,
      thresholdKg: typeof meta.thresholdKg === 'number' ? meta.thresholdKg : null,
      message: v.message,
      confirmedBy: overrideBy,
      confirmReason,
      rawPayload: { violation: v, body: args.body },
    });
  }

  return { status: 'PASSED', violations: [] };
}

/**
 * Queue an audit event for cloud sync. Reads ticketNo + vehicleNo + localId
 * from the weighment so the cloud row is human-readable without joins.
 * Idempotency: WeighmentAuditQueue.id is the cloud factoryEventId.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<string> {
  const w = await prisma.weighment.findUnique({
    where: { id: input.weighmentId },
    select: { ticketNo: true, vehicleNo: true, localId: true },
  });
  const row = await prisma.weighmentAuditQueue.create({
    data: {
      eventType: input.eventType,
      ruleKey: input.ruleKey ?? null,
      weighmentId: input.weighmentId,
      weighmentLocalId: w?.localId || input.weighmentId,
      ticketNo: w?.ticketNo ?? null,
      vehicleNo: w?.vehicleNo ?? null,
      pcId: input.pcId ?? null,
      action: input.action,
      newWeight: input.newWeight ?? null,
      prevWeight: input.prevWeight ?? null,
      liveScaleWeight: input.liveScaleWeight ?? null,
      thresholdKg: input.thresholdKg ?? null,
      message: input.message ?? null,
      confirmedBy: input.confirmedBy,
      confirmReason: input.confirmReason ?? null,
      rawPayload: input.rawPayload ? JSON.stringify(input.rawPayload) : null,
    },
  });
  return row.id;
}
