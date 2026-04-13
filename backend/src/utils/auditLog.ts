import prisma from '../config/prisma';

/**
 * Write an audit log entry. Fire-and-forget (never blocks the caller).
 * @param entity  e.g. 'PurchaseOrder', 'FuelDeal'
 * @param entityId  the record ID
 * @param action  e.g. 'STATUS_CHANGE', 'EDIT', 'LINE_UPDATE', 'PAYMENT_TERMS'
 * @param changes  diff object — { field: { from, to } }
 * @param userId  who made the change
 */
export function writeAudit(
  entity: string,
  entityId: string,
  action: string,
  changes: Record<string, { from: unknown; to: unknown }>,
  userId: string,
): void {
  // Skip if no actual changes
  const meaningful = Object.entries(changes).filter(([, v]) => v.from !== v.to);
  if (meaningful.length === 0) return;

  const filtered = Object.fromEntries(meaningful);
  prisma.auditLog.create({
    data: {
      entity,
      entityId,
      action,
      changes: JSON.stringify(filtered),
      userId,
    },
  }).catch(() => { /* swallow — audit is best-effort */ });
}

/**
 * Diff two objects on specified keys and write audit log.
 */
export function auditDiff(
  entity: string,
  entityId: string,
  action: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
  userId: string,
): void {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    const from = before[k] ?? null;
    const to = after[k] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[k] = { from, to };
    }
  }
  writeAudit(entity, entityId, action, changes, userId);
}
