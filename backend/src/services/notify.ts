import prisma from '../config/prisma';

/**
 * Unified notification service. Any module can call notify() to drop a message
 * into the user/role inbox. Dedupe prevents spam for recurring conditions
 * (low stock, sync errors, etc). Auto-resolve clears notifications once the
 * underlying condition is gone.
 *
 * Usage:
 *   await notify({ category: 'APPROVAL', severity: 'WARNING', role: 'ADMIN',
 *                  title: 'PO-64 overage 65.5%', message: '...',
 *                  link: '/admin/approvals', entityType: 'Approval', entityId });
 */

export type NotifyCategory =
  | 'APPROVAL'
  | 'STOCK_LOW'
  | 'PAYMENT_DUE'
  | 'SYNC_ERROR'
  | 'FACTORY'
  | 'SYSTEM'
  | 'INFO';

export type NotifySeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface NotifyInput {
  category: NotifyCategory;
  severity?: NotifySeverity;
  title: string;
  message: string;
  link?: string;
  userId?: string;
  role?: string;
  entityType?: string;
  entityId?: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    // Dedupe: if an unread/unresolved notification with same dedupeKey exists, skip
    if (input.dedupeKey) {
      const existing = await prisma.notification.findFirst({
        where: { dedupeKey: input.dedupeKey, resolved: false },
        select: { id: true },
      });
      if (existing) return;
    }

    await prisma.notification.create({
      data: {
        category: input.category,
        severity: input.severity || 'INFO',
        title: input.title,
        message: input.message,
        link: input.link || null,
        userId: input.userId || null,
        role: input.role || null,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        dedupeKey: input.dedupeKey || null,
        metadata: (input.metadata as any) || undefined,
      },
    });
  } catch (err) {
    // Never let notification failures break the caller
    console.error('[notify] failed:', err);
  }
}

/**
 * Resolve notifications tied to an entity once the underlying condition is gone.
 * Called from e.g. approval approve/reject, GRN confirm, stock replenish.
 */
export async function resolveNotifications(
  entityType: string,
  entityId: string,
): Promise<void> {
  try {
    await prisma.notification.updateMany({
      where: { entityType, entityId, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });
  } catch (err) {
    console.error('[notify] resolve failed:', err);
  }
}

/**
 * Resolve notifications by dedupeKey (e.g. "low-stock:ITEM-123" when stock replenished)
 */
export async function resolveByDedupeKey(dedupeKey: string): Promise<void> {
  try {
    await prisma.notification.updateMany({
      where: { dedupeKey, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });
  } catch (err) {
    console.error('[notify] resolve by key failed:', err);
  }
}
