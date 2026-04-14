/**
 * TDS Calculator — Phase 2 core logic.
 *
 * Given a vendor and a gross payment amount, calculates TDS deduction
 * per Indian Income Tax Act sections (mapped from new 393/394 to old 194x).
 *
 * Handles:
 * - Section-specific rates (individual vs company/others)
 * - Threshold checks (single txn + aggregate YTD)
 * - 206AB non-filer doubling
 * - Lower Deduction Certificate (Form 13)
 * - PAN missing → 20% override
 */

import prisma from '../config/prisma';

export interface TdsResult {
  shouldDeduct: boolean;
  sectionCode: string;       // "393_CONTRACTOR" (new) or legacy "194C"
  sectionLabel: string;      // "194C - Contractors"
  rate: number;              // effective rate after all adjustments (%)
  baseRate: number;          // rate before LDC/206AB/PAN adjustments
  grossAmount: number;       // original payment amount
  tdsAmount: number;         // amount to deduct
  netAmount: number;         // amount vendor actually receives
  ledgerId: string | null;   // Account.id for "TDS Payable – 194C" ledger
  reason: string;            // plain-English audit trail
}

/**
 * Calculate TDS for a vendor payment.
 *
 * @param vendorId  UUID of the vendor being paid
 * @param grossAmount  Total payment amount (before TDS deduction)
 * @param opts  Optional: { fiscalYearId, overrideSectionId }
 *   overrideSectionId — per-transaction override (e.g. RM PO tick "194Q 0.1%")
 *                       that takes precedence over vendor.tdsSectionId.
 *                       When set, TDS is deducted even if vendor.tdsApplicable=false
 *                       because the contract itself mandates it.
 */
export async function calculateTds(
  vendorId: string,
  grossAmount: number,
  opts?: { fiscalYearId?: string; overrideSectionId?: string | null } | string,
): Promise<TdsResult> {
  // Back-compat: legacy call signature calculateTds(id, amount, fiscalYearId)
  const fiscalYearId = typeof opts === 'string' ? opts : opts?.fiscalYearId;
  const overrideSectionId = typeof opts === 'string' ? undefined : opts?.overrideSectionId ?? undefined;

  const noDeduction = (reason: string): TdsResult => ({
    shouldDeduct: false, sectionCode: '', sectionLabel: '', rate: 0, baseRate: 0,
    grossAmount, tdsAmount: 0, netAmount: grossAmount, ledgerId: null, reason,
  });

  // ── 1. Load vendor with TDS section
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      tdsSectionRef: true,
    },
  });
  if (!vendor) return noDeduction('Vendor not found');

  // Resolve effective section: PO override wins over vendor default.
  // When override is set, TDS applies even if vendor.tdsApplicable=false
  // (the contract clause makes it mandatory — e.g., 194Q on grain purchase ≥ ₹50L).
  let section = vendor.tdsSectionRef;
  if (overrideSectionId) {
    const override = await prisma.tdsSection.findUnique({ where: { id: overrideSectionId } });
    if (override) section = override;
  } else if (!vendor.tdsApplicable) {
    return noDeduction('TDS not applicable for this vendor');
  }

  if (!section) return noDeduction('No TDS section linked to vendor. Update vendor master → TDS Section dropdown.');

  // ── 2. Determine base rate (individual vs company)
  // Simple heuristic: if vendor has GSTIN, treat as company; else individual.
  // More accurate: add a vendorType field later (INDIVIDUAL, HUF, COMPANY, FIRM, LLP, etc.)
  const isCompanyLike = !!vendor.gstin;
  const baseRate = isCompanyLike ? section.rateOthers : section.rateIndividual;

  // ── 3. Determine current FY
  let fy: { id: string; startDate: Date; endDate: Date } | null;
  if (fiscalYearId) {
    fy = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
  } else {
    fy = await prisma.fiscalYear.findFirst({ where: { isCurrent: true } });
  }
  if (!fy) return noDeduction('No current fiscal year configured. Seed via POST /api/tax/seed.');

  // ── 4. YTD aggregate (all vendor payments this FY where TDS was applicable)
  const ytdPayments = await prisma.vendorPayment.aggregate({
    where: {
      vendorId,
      paymentDate: { gte: fy.startDate, lte: fy.endDate },
    },
    _sum: { amount: true },
  });
  const ytdTotal = (ytdPayments._sum.amount || 0) + grossAmount;

  // ── 5. Threshold check
  const singleThreshold = section.thresholdSingle || 0;
  const aggregateThreshold = section.thresholdAggregate || 0;

  const exceedsSingle = singleThreshold > 0 && grossAmount >= singleThreshold;
  const exceedsAggregate = aggregateThreshold > 0 && ytdTotal >= aggregateThreshold;

  // Both must be checked: some sections have both single + aggregate (194C: 30K single OR 1L aggregate)
  if (singleThreshold > 0 || aggregateThreshold > 0) {
    if (!exceedsSingle && !exceedsAggregate) {
      const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
      return noDeduction(
        `Below threshold. This txn: ${fmt(grossAmount)} (limit ${fmt(singleThreshold)}). ` +
        `YTD total: ${fmt(ytdTotal)} (limit ${fmt(aggregateThreshold)}).`
      );
    }
  }

  // ── 6. Effective rate — start from base, then apply adjustments
  let effectiveRate = baseRate;
  const reasons: string[] = [];
  reasons.push(`Base rate: ${baseRate}% (${isCompanyLike ? 'company/others' : 'individual'})`);

  // 6a. PAN missing → Section 206AA: rate is higher of (normal rate, 20%)
  if (!vendor.pan) {
    const panRate = Math.max(effectiveRate, 20);
    if (panRate !== effectiveRate) {
      reasons.push(`PAN missing → 206AA override: ${panRate}% (was ${effectiveRate}%)`);
      effectiveRate = panRate;
    }
  }

  // 6b. 206AB non-filer → rate doubles (or 5%, whichever is higher)
  if (vendor.is206ABNonFiler) {
    const nonFilerRate = Math.max(effectiveRate * 2, section.nonFilerRate || 5);
    reasons.push(`206AB non-filer → rate: ${nonFilerRate}% (was ${effectiveRate}%)`);
    effectiveRate = nonFilerRate;
  }

  // 6c. Lower Deduction Certificate (Form 13) — overrides everything above
  if (vendor.lowerDeductionCertNo && vendor.lowerDeductionRate != null) {
    const now = new Date();
    const validFrom = vendor.lowerDeductionValidFrom;
    const validTill = vendor.lowerDeductionValidTill;
    if ((!validFrom || now >= validFrom) && (!validTill || now <= validTill)) {
      reasons.push(`Lower Deduction Cert ${vendor.lowerDeductionCertNo}: ${vendor.lowerDeductionRate}% (overrides ${effectiveRate}%)`);
      effectiveRate = vendor.lowerDeductionRate;
    } else {
      reasons.push(`LDC ${vendor.lowerDeductionCertNo} expired — using standard rate`);
    }
  }

  // ── 7. Calculate amounts
  const tdsAmount = Math.round(grossAmount * effectiveRate / 100 * 100) / 100;
  const netAmount = Math.round((grossAmount - tdsAmount) * 100) / 100;

  const sectionLabel = `${section.oldSection || section.newSection} - ${section.nature}`;

  if (exceedsSingle) reasons.push(`Single txn ₹${grossAmount.toLocaleString('en-IN')} >= threshold ₹${singleThreshold.toLocaleString('en-IN')}`);
  if (exceedsAggregate) reasons.push(`YTD ₹${ytdTotal.toLocaleString('en-IN')} >= aggregate threshold ₹${aggregateThreshold.toLocaleString('en-IN')}`);
  reasons.push(`TDS: ₹${tdsAmount.toLocaleString('en-IN')} @ ${effectiveRate}% on ₹${grossAmount.toLocaleString('en-IN')}`);

  return {
    shouldDeduct: true,
    sectionCode: section.code,
    sectionLabel,
    rate: effectiveRate,
    baseRate,
    grossAmount,
    tdsAmount,
    netAmount,
    ledgerId: section.defaultLedgerId,
    reason: reasons.join('. ') + '.',
  };
}
