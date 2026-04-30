/**
 * Tax rate lookup — single source of truth for GST rates on purchase side.
 *
 * All purchase flows (materials, fuel, PO, GRN, vendor invoice) MUST call
 * getEffectiveGstRate() instead of reading InventoryItem.gstPercent or
 * hardcoding rates. This guarantees that a rate change on HsnCode/GstRate
 * master propagates everywhere on the next save.
 *
 * Phase A of Tax Unification (2026-04-14).
 */
import prisma from '../config/prisma';

export interface GstRateResolution {
  rate: number; // total GST rate (cgst+sgst OR igst)
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  isExempt: boolean;
  isOutsideGst: boolean;
  sourceHsnId: string | null;
  sourceRateId: string | null;
  sourceType: 'hsn_master' | 'item_override' | 'fallback_scalar' | 'none';
  conditionNote: string | null;
  asOf: Date;
}

export interface LookupInput {
  hsnCodeId?: string | null;
  on?: Date; // defaults to now
  conditionNote?: string | null; // e.g. "EBP only" | "Industrial use"
  // Fallbacks (for items not yet migrated)
  itemOverridePercent?: number | null;
  itemOverrideReason?: string | null;
  legacyGstPercent?: number | null; // InventoryItem.gstPercent — last-resort
}

/**
 * Resolve the effective GST rate for a given HSN on a given date.
 *
 * Precedence (item master is the source of truth — set by Saif 2026-04-30):
 *   1. Per-item override (InventoryItem.gstOverridePercent) — used only with reason
 *   2. InventoryItem.gstPercent (item master scalar — what procurement edits)
 *   3. HsnCode → GstRate (statutory fallback, used only if item has no scalar)
 *   4. Zero with sourceType='none' (caller must detect)
 *
 * Why item master wins over HSN master: the procurement team's mental model is
 * "I edit the item master, the rate applies." HSN-master propagation was the
 * old model — it confused the team because edits to item.gstPercent were silently
 * ignored when the item had an HSN linked. Now item master is authoritative;
 * HSN is only consulted when the item has no scalar (rare — schema default = 18).
 *
 * Intra-state (CGST+SGST) vs inter-state (IGST) split is the caller's job —
 * this service returns both halves so the caller picks.
 */
export async function getEffectiveGstRate(input: LookupInput): Promise<GstRateResolution> {
  const asOf = input.on ?? new Date();

  // 1. Per-item override wins (rare special cases — e.g. statutory exemption notification)
  if (input.itemOverridePercent != null && input.itemOverrideReason) {
    const r = input.itemOverridePercent;
    return {
      rate: r,
      cgst: r / 2,
      sgst: r / 2,
      igst: r,
      cess: 0,
      isExempt: r === 0,
      isOutsideGst: false,
      sourceHsnId: input.hsnCodeId ?? null,
      sourceRateId: null,
      sourceType: 'item_override',
      conditionNote: input.itemOverrideReason,
      asOf,
    };
  }

  // 2. Item master scalar — the day-to-day source of truth
  if (input.legacyGstPercent != null) {
    const r = input.legacyGstPercent;
    return {
      rate: r,
      cgst: r / 2,
      sgst: r / 2,
      igst: r,
      cess: 0,
      isExempt: r === 0,
      isOutsideGst: false,
      sourceHsnId: input.hsnCodeId ?? null,
      sourceRateId: null,
      sourceType: 'fallback_scalar',
      conditionNote: null,
      asOf,
    };
  }

  // 3. HSN master fallback — only reached when item has no scalar (rare; schema default is 18)
  if (input.hsnCodeId) {
    const rates = await prisma.gstRate.findMany({
      where: {
        hsnId: input.hsnCodeId,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTill: null }, { effectiveTill: { gte: asOf } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      take: 5,
    });

    // Prefer exact conditionNote match; fall back to rate with no condition
    let match = rates.find(r => r.conditionNote === input.conditionNote) ?? null;
    if (!match) match = rates.find(r => !r.conditionNote) ?? null;
    if (!match && rates.length > 0) match = rates[0];

    if (match) {
      const total = match.isOutsideGst || match.isExempt ? 0 : match.cgst + match.sgst;
      const igst = match.isOutsideGst || match.isExempt ? 0 : match.igst;
      return {
        rate: igst || total, // prefer igst if cgst/sgst both 0 (inter-state-only HSN)
        cgst: match.cgst,
        sgst: match.sgst,
        igst: match.igst,
        cess: match.cess,
        isExempt: match.isExempt,
        isOutsideGst: match.isOutsideGst,
        sourceHsnId: input.hsnCodeId,
        sourceRateId: match.id,
        sourceType: 'hsn_master',
        conditionNote: match.conditionNote,
        asOf,
      };
    }
  }

  // 4. No info at all
  return {
    rate: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    cess: 0,
    isExempt: false,
    isOutsideGst: false,
    sourceHsnId: null,
    sourceRateId: null,
    sourceType: 'none',
    conditionNote: null,
    asOf,
  };
}

/**
 * Compute CGST/SGST/IGST amounts given taxable amount + supply type.
 * Supports both tax-exclusive (rate on top) and tax-inclusive (rate embedded).
 */
export interface GstSplitInput {
  amount: number; // line amount before GST (or gross amount if isInclusive)
  gstPercent: number; // total rate — e.g., 18 for 18%
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  isInclusive?: boolean;
}
export interface GstSplitResult {
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalGst: number;
  lineTotal: number;
}
export function computeGstSplit(input: GstSplitInput): GstSplitResult {
  const r = input.gstPercent / 100;
  let taxable: number;
  let lineTotal: number;
  if (input.isInclusive && r > 0) {
    lineTotal = input.amount;
    taxable = input.amount / (1 + r);
  } else {
    taxable = input.amount;
    lineTotal = input.amount * (1 + r);
  }
  const totalGst = lineTotal - taxable;
  let cgstAmount = 0,
    sgstAmount = 0,
    igstAmount = 0;
  if (input.supplyType === 'INTRA_STATE') {
    cgstAmount = totalGst / 2;
    sgstAmount = totalGst / 2;
  } else {
    igstAmount = totalGst;
  }
  // Round to 2 decimals
  return {
    taxableAmount: round2(taxable),
    cgstAmount: round2(cgstAmount),
    sgstAmount: round2(sgstAmount),
    igstAmount: round2(igstAmount),
    totalGst: round2(totalGst),
    lineTotal: round2(lineTotal),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Fuzzy-resolve an HSN code string to a master HsnCode.id, so routes that
 * still accept a free-text `hsnCode` from the client can auto-link to the
 * master without the client having to know the FK. Single source of truth.
 *
 * Strategy:
 *   1. Exact code match
 *   2. Forward prefix: item "1005" → master "10059000"
 *   3. Reverse prefix: item "10059000" → master "1005"
 *
 * Returns { hsnCodeId, matchedCode } or both-null if nothing matches.
 */
export async function resolveHsnFromString(
  hsnString: string | null | undefined,
): Promise<{ hsnCodeId: string | null; matchedCode: string | null }> {
  if (!hsnString || !hsnString.trim()) return { hsnCodeId: null, matchedCode: null };
  const q = hsnString.trim();
  const exact = await prisma.hsnCode.findUnique({ where: { code: q } });
  if (exact) return { hsnCodeId: exact.id, matchedCode: exact.code };
  // Prefix scans — active codes only, limit to safe range
  const candidates = await prisma.hsnCode.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    take: 500,
  });
  const fwd = candidates.find((m) => m.code.startsWith(q));
  if (fwd) return { hsnCodeId: fwd.id, matchedCode: fwd.code };
  const rev = candidates.find((m) => q.startsWith(m.code));
  if (rev) return { hsnCodeId: rev.id, matchedCode: rev.code };
  return { hsnCodeId: null, matchedCode: null };
}

/**
 * Returns blast radius for a HsnCode rate change.
 * Used by the HSN master page to warn before saving.
 */
export async function getHsnRateImpact(hsnId: string) {
  const [items, openPoLines] = await Promise.all([
    prisma.inventoryItem.count({ where: { hsnCodeId: hsnId, isActive: true } }),
    prisma.pOLine.count({
      where: {
        hsnCodeId: hsnId,
        po: { status: { in: ['DRAFT', 'APPROVED', 'SENT', 'PARTIAL_RECEIVED'] } },
      },
    }),
  ]);
  return { inventoryItemsAffected: items, openPoLinesAffected: openPoLines };
}
