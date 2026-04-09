import prisma from '../config/prisma';

/**
 * Write a single ComplianceAudit row for a field change.
 * Skips writing if old and new values are equal (no real change).
 */
export async function writeAudit(
  entityType: string,
  entityId: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  changedBy: string,
  reason?: string,
): Promise<void> {
  const oldStr = serialize(oldValue);
  const newStr = serialize(newValue);
  if (oldStr === newStr) return;
  await prisma.complianceAudit.create({
    data: {
      entityType,
      entityId,
      field,
      oldValue: oldStr,
      newValue: newStr,
      changedBy,
      reason: reason || null,
    },
  });
}

/**
 * Diff two objects and write one ComplianceAudit row per changed field.
 * Only fields present in `fields` are compared.
 */
export async function writeAuditMany(
  entityType: string,
  entityId: string,
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  fields: string[],
  changedBy: string,
  reason?: string,
): Promise<number> {
  const rows: Array<{
    entityType: string;
    entityId: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
    changedBy: string;
    reason: string | null;
  }> = [];
  for (const field of fields) {
    const oldStr = serialize(oldObj[field]);
    const newStr = serialize(newObj[field]);
    if (oldStr === newStr) continue;
    rows.push({
      entityType,
      entityId,
      field,
      oldValue: oldStr,
      newValue: newStr,
      changedBy,
      reason: reason || null,
    });
  }
  if (rows.length === 0) return 0;
  await prisma.complianceAudit.createMany({ data: rows });
  return rows.length;
}

function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
