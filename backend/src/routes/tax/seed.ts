import { Router, Response } from 'express';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import {
  HSN_SEED,
  TDS_SEED,
  TDS_LEDGER_SEED,
  TCS_SEED,
  INVOICE_SERIES_SEED,
  TAX_RULE_EXPLANATIONS_SEED,
} from '../../data/taxComplianceSeed';

const router = Router();
router.use(authenticate);

const EFFECTIVE_FROM = new Date('2026-04-01');

/**
 * POST /api/tax/seed — idempotent upsert of all Phase 1 master data.
 * Safe to re-run. Does not overwrite manual edits to existing rows (update-on-match).
 */
router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  let hsnCount = 0;
  let gstRateCount = 0;
  let tdsCount = 0;
  let tcsCount = 0;
  let seriesCount = 0;
  let explanationCount = 0;
  let ledgerCount = 0;
  let ledgerLinkCount = 0;

  // ---- Compliance config (create only if missing)
  const existingConfig = await prisma.complianceConfig.findFirst();
  if (!existingConfig) {
    await prisma.complianceConfig.create({
      data: {
        legalName: 'Mahakaushal Sugar and Power Industries Ltd',
        pan: 'PENDING000',
        tan: 'PENDING000',
        gstin: 'PENDING00000000',
        registeredState: '23',
        registeredStateName: 'Madhya Pradesh',
        taxRegime: 'NORMAL',
        fyStartMonth: 4,
        eInvoiceEnabled: true,
        eInvoiceThresholdCr: 5,
        eWayBillMinAmount: 50000,
      },
    });
  }

  // ---- Fiscal years
  const fy2526 = await prisma.fiscalYear.upsert({
    where: { code: '2025-26' },
    update: {},
    create: {
      code: '2025-26',
      startDate: new Date('2025-04-01'),
      endDate: new Date('2026-03-31'),
      isCurrent: false,
    },
  });

  const fy2627 = await prisma.fiscalYear.upsert({
    where: { code: '2026-27' },
    update: {},
    create: {
      code: '2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31'),
      isCurrent: true,
    },
  });

  // Ensure exactly one isCurrent
  const anyCurrent = await prisma.fiscalYear.findFirst({ where: { isCurrent: true } });
  if (!anyCurrent) {
    await prisma.fiscalYear.update({ where: { id: fy2627.id }, data: { isCurrent: true } });
  }

  // ---- HSN + GstRate
  for (const hsnSeed of HSN_SEED) {
    const hsn = await prisma.hsnCode.upsert({
      where: { code: hsnSeed.code },
      update: {
        description: hsnSeed.description,
        uqc: hsnSeed.uqc,
        category: hsnSeed.category,
      },
      create: {
        code: hsnSeed.code,
        description: hsnSeed.description,
        uqc: hsnSeed.uqc,
        category: hsnSeed.category,
      },
    });
    hsnCount++;

    for (const rate of hsnSeed.rates) {
      const existingRate = await prisma.gstRate.findFirst({
        where: {
          hsnId: hsn.id,
          conditionNote: rate.conditionNote || null,
          effectiveFrom: EFFECTIVE_FROM,
        },
      });
      if (!existingRate) {
        await prisma.gstRate.create({
          data: {
            hsnId: hsn.id,
            cgst: rate.cgst,
            sgst: rate.sgst,
            igst: rate.igst,
            cess: rate.cess,
            isExempt: rate.isExempt || false,
            isOutsideGst: rate.isOutsideGst || false,
            conditionNote: rate.conditionNote || null,
            effectiveFrom: EFFECTIVE_FROM,
            effectiveTill: null,
          },
        });
        gstRateCount++;
      }
    }
  }

  // ---- TDS sections
  for (const tds of TDS_SEED) {
    await prisma.tdsSection.upsert({
      where: { code: tds.code },
      update: {
        newSection: tds.newSection,
        oldSection: tds.oldSection || null,
        nature: tds.nature,
        rateIndividual: tds.rateIndividual,
        rateOthers: tds.rateOthers,
        thresholdSingle: tds.thresholdSingle,
        thresholdAggregate: tds.thresholdAggregate,
        panMissingRate: tds.panMissingRate,
        nonFilerRate: tds.nonFilerRate,
      },
      create: {
        code: tds.code,
        newSection: tds.newSection,
        oldSection: tds.oldSection || null,
        nature: tds.nature,
        rateIndividual: tds.rateIndividual,
        rateOthers: tds.rateOthers,
        thresholdSingle: tds.thresholdSingle,
        thresholdAggregate: tds.thresholdAggregate,
        panMissingRate: tds.panMissingRate,
        nonFilerRate: tds.nonFilerRate,
        effectiveFrom: EFFECTIVE_FROM,
        isActive: true,
      },
    });
    tdsCount++;
  }

  // ---- TCS sections
  for (const tcs of TCS_SEED) {
    await prisma.tcsSection.upsert({
      where: { code: tcs.code },
      update: {
        nature: tcs.nature,
        rate: tcs.rate,
        threshold: tcs.threshold,
      },
      create: {
        code: tcs.code,
        nature: tcs.nature,
        rate: tcs.rate,
        threshold: tcs.threshold,
        effectiveFrom: EFFECTIVE_FROM,
        isActive: true,
      },
    });
    tcsCount++;
  }

  // ---- Invoice series (FY 2026-27)
  for (const series of INVOICE_SERIES_SEED) {
    await prisma.invoiceSeries.upsert({
      where: { fyId_docType: { fyId: fy2627.id, docType: series.docType } },
      update: {
        prefix: series.prefix,
        width: series.width,
      },
      create: {
        fyId: fy2627.id,
        docType: series.docType,
        prefix: series.prefix,
        width: series.width,
        nextNumber: 1,
        isActive: true,
      },
    });
    seriesCount++;
  }

  // ---- Tax rule explanations
  for (const expl of TAX_RULE_EXPLANATIONS_SEED) {
    await prisma.taxRuleExplanation.upsert({
      where: { ruleKey: expl.ruleKey },
      update: {
        title: expl.title,
        plainEnglish: expl.plainEnglish,
        whatErpDoes: expl.whatErpDoes,
        whatUserDoes: expl.whatUserDoes,
        sourceLink: expl.sourceLink || null,
        category: expl.category,
        sortOrder: expl.sortOrder,
      },
      create: {
        ruleKey: expl.ruleKey,
        title: expl.title,
        plainEnglish: expl.plainEnglish,
        whatErpDoes: expl.whatErpDoes,
        whatUserDoes: expl.whatUserDoes,
        sourceLink: expl.sourceLink || null,
        category: expl.category,
        sortOrder: expl.sortOrder,
      },
    });
    explanationCount++;
  }

  // ---- TDS Payable ledgers (9 child accounts under parent code 2200)
  // Parent "TDS Payable" (2200) already exists in every MSPIL Chart of Accounts.
  // We create 9 section-specific children and back-link each TdsSection.defaultLedgerId.
  const tdsParent = await prisma.account.findUnique({ where: { code: '2200' } });
  if (tdsParent) {
    for (const seed of TDS_LEDGER_SEED) {
      const ledger = await prisma.account.upsert({
        where: { code: seed.ledgerCode },
        update: {
          // Preserve any manual rename — only ensure parent + type stay correct
          parentId: tdsParent.id,
          type: 'LIABILITY',
          subType: 'CURRENT_LIABILITY',
          isSystem: true,
        },
        create: {
          code: seed.ledgerCode,
          name: seed.ledgerName,
          type: 'LIABILITY',
          subType: 'CURRENT_LIABILITY',
          parentId: tdsParent.id,
          isSystem: true,
          isActive: true,
        },
      });
      ledgerCount++;

      // Back-link to TdsSection
      const section = await prisma.tdsSection.findUnique({
        where: { code: seed.tdsSectionCode },
      });
      if (section && section.defaultLedgerId !== ledger.id) {
        await prisma.tdsSection.update({
          where: { id: section.id },
          data: { defaultLedgerId: ledger.id },
        });
        ledgerLinkCount++;
      }
    }
  }

  res.json({
    hsn: hsnCount,
    gstRates: gstRateCount,
    tdsSections: tdsCount,
    tcsSections: tcsCount,
    invoiceSeries: seriesCount,
    explanations: explanationCount,
    fiscalYears: 2,
    tdsLedgers: ledgerCount,
    tdsLedgerLinks: ledgerLinkCount,
  });
}));

export default router;
