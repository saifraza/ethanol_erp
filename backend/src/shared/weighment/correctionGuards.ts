/**
 * Weighment Correction Guards
 *
 * Checks whether a GrainTruck weighment record can be edited by an admin.
 * Blockers are ordered by severity — first match is the reason.
 *
 * See .claude/skills/weighment-corrections.md for the full specification.
 */

import prisma from '../../config/prisma';

export interface BlockerReason {
  code: string;
  message: string;
}

export interface CorrectableSummary {
  canEdit: boolean;
  blockers: BlockerReason[];
  requiresAdminPin: boolean;
}

// Admin PIN is required for edits to records older than this many days.
// Not a hard block — admin PIN unlocks it.
const AGED_RECORD_DAYS = 30;

/**
 * Check whether a GrainTruck can be edited.
 * Returns the list of blockers (empty = editable) + whether admin PIN is required.
 */
export async function checkGrainTruckCorrectable(
  id: string,
  opts: { adminPinProvided?: boolean } = {},
): Promise<CorrectableSummary> {
  const blockers: BlockerReason[] = [];

  const truck = await prisma.grainTruck.findUnique({
    where: { id },
    select: {
      id: true,
      cancelled: true,
      grnId: true,
      createdAt: true,
      goodsReceipt: {
        select: {
          id: true,
          grnNo: true,
          status: true,
          invoiceNo: true,
          fullyPaid: true,
          paymentLinkedAt: true,
        },
      },
    },
  });

  if (!truck) {
    return {
      canEdit: false,
      blockers: [{ code: 'NOT_FOUND', message: 'Weighment record not found' }],
      requiresAdminPin: false,
    };
  }

  // BLOCKER 1: Already cancelled
  if (truck.cancelled) {
    blockers.push({
      code: 'ALREADY_CANCELLED',
      message: 'This weighment has already been cancelled. Cancelled records cannot be edited.',
    });
    return { canEdit: false, blockers, requiresAdminPin: false };
  }

  // BLOCKER 2: Payment already made against the linked GRN
  if (truck.goodsReceipt?.fullyPaid || truck.goodsReceipt?.paymentLinkedAt) {
    blockers.push({
      code: 'PAYMENT_MADE',
      message: `Vendor payment has been made against GRN-${truck.goodsReceipt.grnNo}. Payment must be reversed first before the weighment can be corrected.`,
    });
    return { canEdit: false, blockers, requiresAdminPin: false };
  }

  // BLOCKER 3: Vendor invoice linked to the GRN
  if (truck.goodsReceipt?.invoiceNo) {
    blockers.push({
      code: 'INVOICE_LINKED',
      message: `Vendor invoice #${truck.goodsReceipt.invoiceNo} is linked to GRN-${truck.goodsReceipt.grnNo}. Invoice must be cancelled first.`,
    });
    return { canEdit: false, blockers, requiresAdminPin: false };
  }

  // BLOCKER 4: GRN is CONFIRMED (posted to inventory)
  if (truck.grnId && truck.goodsReceipt && truck.goodsReceipt.status === 'CONFIRMED') {
    blockers.push({
      code: 'GRN_CONFIRMED',
      message: `GRN-${truck.goodsReceipt.grnNo} has been confirmed and posted to inventory. The GRN must be reversed before the weighment can be corrected.`,
    });
    return { canEdit: false, blockers, requiresAdminPin: false };
  }

  // Soft block: record is older than 30 days — admin PIN required but not fatal
  const ageDays = (Date.now() - new Date(truck.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const requiresAdminPin = ageDays > AGED_RECORD_DAYS;
  if (requiresAdminPin && !opts.adminPinProvided) {
    blockers.push({
      code: 'AGED_RECORD',
      message: `Record is ${Math.floor(ageDays)} days old. Admin PIN required to edit aged records.`,
    });
    return { canEdit: false, blockers, requiresAdminPin: true };
  }

  return { canEdit: blockers.length === 0, blockers, requiresAdminPin };
}
