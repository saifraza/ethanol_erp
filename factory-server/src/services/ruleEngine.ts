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
