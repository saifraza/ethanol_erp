/**
 * Business Rules Engine
 * Checks configurable rules before weighbridge operations.
 * Rules are cached in memory and refreshed on update.
 */

import prisma from '../prisma';

export interface RuleResult {
  passed: boolean;
  ruleKey: string;
  ruleLabel: string;
  message: string;
  canOverride: boolean;
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
      id: true, direction: true, status: true,
      grossTime: true, tareTime: true,
      vehicleNo: true, materialCategory: true,
    },
  });
  if (!w) return [];

  const ctx: WeighmentContext = {
    id: w.id,
    direction: w.direction,
    status: w.status,
    grossTime: w.grossTime,
    tareTime: w.tareTime,
    vehicleNo: w.vehicleNo,
    materialCategory: w.materialCategory,
  };

  // Run all rule checks
  const checks = [
    checkMinWeightInterval(ctx, action),
    newWeight != null ? checkDuplicateWeight(ctx, action, newWeight, pcId || 'web') : Promise.resolve(null),
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

/** Log an override to the audit trail. */
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
