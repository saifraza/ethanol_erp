/**
 * Weighment Correction Guards
 *
 * Checks whether a weighment record can be edited by an admin.
 * Supports GrainTruck, GoodsReceipt, DispatchTruck, DDGSDispatchTruck.
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
 * Shape of a GrainTruck pre-fetched by the caller with all fields needed for
 * correctability evaluation. When a caller (e.g. the admin correction list)
 * already has this data in memory from a batch query, it can call
 * `summarizeGrainTruckCorrectable` directly to avoid an N+1 findUnique loop.
 */
export interface GrainTruckCorrectableInput {
  id: string;
  cancelled: boolean;
  grnId: string | null;
  createdAt: Date;
  goodsReceipt: {
    id: string;
    grnNo: number;
    status: string;
    invoiceNo: string | null;
    fullyPaid: boolean;
    paymentLinkedAt: Date | null;
  } | null;
}

/**
 * Pure function — evaluates blockers from an already-loaded GrainTruck row.
 * No DB access. Used by batch callers; `checkGrainTruckCorrectable` is the
 * single-row async wrapper that fetches then delegates here.
 */
export function summarizeGrainTruckCorrectable(
  truck: GrainTruckCorrectableInput,
  opts: { adminPinProvided?: boolean } = {},
): CorrectableSummary {
  const blockers: BlockerReason[] = [];

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

/**
 * Check whether a GrainTruck can be edited.
 * Returns the list of blockers (empty = editable) + whether admin PIN is required.
 */
export async function checkGrainTruckCorrectable(
  id: string,
  opts: { adminPinProvided?: boolean } = {},
): Promise<CorrectableSummary> {
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

  return summarizeGrainTruckCorrectable(truck, opts);
}

/**
 * Check whether a GoodsReceipt (fuel inbound) can be edited.
 */
export async function checkGoodsReceiptCorrectable(
  id: string,
  opts: { adminPinProvided?: boolean } = {},
): Promise<CorrectableSummary> {
  const grn = await prisma.goodsReceipt.findUnique({
    where: { id },
    select: {
      id: true,
      grnNo: true,
      status: true,
      invoiceNo: true,
      fullyPaid: true,
      paymentLinkedAt: true,
      createdAt: true,
    },
  });

  if (!grn) {
    return {
      canEdit: false,
      blockers: [{ code: 'NOT_FOUND', message: 'GoodsReceipt not found' }],
      requiresAdminPin: false,
    };
  }

  if (grn.status === 'CANCELLED') {
    return {
      canEdit: false,
      blockers: [{ code: 'ALREADY_CANCELLED', message: `GRN-${grn.grnNo} is already cancelled` }],
      requiresAdminPin: false,
    };
  }

  if (grn.fullyPaid || grn.paymentLinkedAt) {
    return {
      canEdit: false,
      blockers: [{ code: 'PAYMENT_MADE', message: `Payment made against GRN-${grn.grnNo}. Reverse payment first.` }],
      requiresAdminPin: false,
    };
  }

  if (grn.invoiceNo) {
    return {
      canEdit: false,
      blockers: [{ code: 'INVOICE_LINKED', message: `Vendor invoice #${grn.invoiceNo} linked to GRN-${grn.grnNo}. Cancel invoice first.` }],
      requiresAdminPin: false,
    };
  }

  if (grn.status === 'CONFIRMED') {
    return {
      canEdit: false,
      blockers: [{ code: 'GRN_CONFIRMED', message: `GRN-${grn.grnNo} confirmed and posted to inventory. Reverse GRN first.` }],
      requiresAdminPin: false,
    };
  }

  const ageDays = (Date.now() - new Date(grn.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const requiresAdminPin = ageDays > AGED_RECORD_DAYS;
  if (requiresAdminPin && !opts.adminPinProvided) {
    return {
      canEdit: false,
      blockers: [{ code: 'AGED_RECORD', message: `Record is ${Math.floor(ageDays)} days old. Admin PIN required.` }],
      requiresAdminPin: true,
    };
  }

  return { canEdit: true, blockers: [], requiresAdminPin };
}

/**
 * Check whether a DispatchTruck (ethanol outbound) can be edited.
 */
export async function checkDispatchTruckCorrectable(
  id: string,
  opts: { adminPinProvided?: boolean } = {},
): Promise<CorrectableSummary> {
  const truck = await prisma.dispatchTruck.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      createdAt: true,
    },
  });

  if (!truck) {
    return {
      canEdit: false,
      blockers: [{ code: 'NOT_FOUND', message: 'DispatchTruck not found' }],
      requiresAdminPin: false,
    };
  }

  if (truck.status === 'CANCELLED') {
    return {
      canEdit: false,
      blockers: [{ code: 'ALREADY_CANCELLED', message: 'This dispatch has already been cancelled' }],
      requiresAdminPin: false,
    };
  }

  if (['RELEASED', 'EXITED'].includes(truck.status)) {
    return {
      canEdit: false,
      blockers: [{ code: 'SHIPMENT_RELEASED', message: `Truck has been ${truck.status.toLowerCase()}. Cannot edit after release.` }],
      requiresAdminPin: false,
    };
  }

  const ageDays = (Date.now() - new Date(truck.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const requiresAdminPin = ageDays > AGED_RECORD_DAYS;
  if (requiresAdminPin && !opts.adminPinProvided) {
    return {
      canEdit: false,
      blockers: [{ code: 'AGED_RECORD', message: `Record is ${Math.floor(ageDays)} days old. Admin PIN required.` }],
      requiresAdminPin: true,
    };
  }

  return { canEdit: true, blockers: [], requiresAdminPin };
}

/**
 * Check whether a DDGSDispatchTruck can be edited.
 */
export async function checkDDGSDispatchTruckCorrectable(
  id: string,
  opts: { adminPinProvided?: boolean } = {},
): Promise<CorrectableSummary> {
  const truck = await prisma.dDGSDispatchTruck.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      invoiceNo: true,
      createdAt: true,
    },
  });

  if (!truck) {
    return {
      canEdit: false,
      blockers: [{ code: 'NOT_FOUND', message: 'DDGSDispatchTruck not found' }],
      requiresAdminPin: false,
    };
  }

  if (truck.invoiceNo) {
    return {
      canEdit: false,
      blockers: [{ code: 'INVOICE_LINKED', message: `Invoice ${truck.invoiceNo} linked. Cannot edit after invoicing.` }],
      requiresAdminPin: false,
    };
  }

  if (['BILLED', 'RELEASED'].includes(truck.status)) {
    return {
      canEdit: false,
      blockers: [{ code: 'BILLED', message: `Truck has been ${truck.status.toLowerCase()}. Cannot edit after billing/release.` }],
      requiresAdminPin: false,
    };
  }

  const ageDays = (Date.now() - new Date(truck.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const requiresAdminPin = ageDays > AGED_RECORD_DAYS;
  if (requiresAdminPin && !opts.adminPinProvided) {
    return {
      canEdit: false,
      blockers: [{ code: 'AGED_RECORD', message: `Record is ${Math.floor(ageDays)} days old. Admin PIN required.` }],
      requiresAdminPin: true,
    };
  }

  return { canEdit: true, blockers: [], requiresAdminPin };
}
