/**
 * Standalone tax seed runner — mirrors POST /api/tax/seed handler logic.
 *
 * Used when HTTP auth isn't available (e.g., CI/one-shot bootstrap). The
 * upstream handler is `backend/src/routes/tax/seed.ts`; this script duplicates
 * its logic exactly (idempotent upserts). Safe to re-run.
 *
 *   cd backend
 *   npx ts-node scripts/run_tax_seed.ts
 */
import prisma from '../src/config/prisma';
import {
  HSN_SEED,
  TDS_SEED,
  TDS_LEDGER_SEED,
  TCS_SEED,
  INVOICE_SERIES_SEED,
  TAX_RULE_EXPLANATIONS_SEED,
} from '../src/data/taxComplianceSeed';

const EFFECTIVE_FROM = new Date('2026-04-01');

async function main() {
  let hsnCount = 0, gstRateCount = 0, tdsCount = 0, tcsCount = 0;
  let seriesCount = 0, explanationCount = 0, ledgerCount = 0, ledgerLinkCount = 0;

  // Compliance config — create only if missing
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
    console.log('  + ComplianceConfig created');
  } else {
    console.log('  · ComplianceConfig exists');
  }

  // Fiscal years
  await prisma.fiscalYear.upsert({
    where: { code: '2025-26' },
    update: {},
    create: { code: '2025-26', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31'), isCurrent: false },
  });
  const fy2627 = await prisma.fiscalYear.upsert({
    where: { code: '2026-27' },
    update: {},
    create: { code: '2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), isCurrent: true },
  });
  const anyCurrent = await prisma.fiscalYear.findFirst({ where: { isCurrent: true } });
  if (!anyCurrent) {
    await prisma.fiscalYear.update({ where: { id: fy2627.id }, data: { isCurrent: true } });
  }
  console.log('  · FY 2025-26 + 2026-27 ensured');

  // HSN + GstRate
  for (const hsnSeed of HSN_SEED) {
    const hsn = await prisma.hsnCode.upsert({
      where: { code: hsnSeed.code },
      update: { description: hsnSeed.description, uqc: hsnSeed.uqc, category: hsnSeed.category },
      create: { code: hsnSeed.code, description: hsnSeed.description, uqc: hsnSeed.uqc, category: hsnSeed.category },
    });
    hsnCount++;
    for (const rate of hsnSeed.rates) {
      const existing = await prisma.gstRate.findFirst({
        where: { hsnId: hsn.id, conditionNote: rate.conditionNote || null, effectiveFrom: EFFECTIVE_FROM },
      });
      if (!existing) {
        await prisma.gstRate.create({
          data: {
            hsnId: hsn.id,
            cgst: rate.cgst, sgst: rate.sgst, igst: rate.igst, cess: rate.cess,
            isExempt: rate.isExempt || false, isOutsideGst: rate.isOutsideGst || false,
            conditionNote: rate.conditionNote || null,
            effectiveFrom: EFFECTIVE_FROM, effectiveTill: null,
          },
        });
        gstRateCount++;
      }
    }
  }
  console.log(`  · HSN ${hsnCount} upserted, GstRate ${gstRateCount} new`);

  // TDS sections
  for (const tds of TDS_SEED) {
    await prisma.tdsSection.upsert({
      where: { code: tds.code },
      update: {
        newSection: tds.newSection, oldSection: tds.oldSection || null, nature: tds.nature,
        rateIndividual: tds.rateIndividual, rateOthers: tds.rateOthers,
        thresholdSingle: tds.thresholdSingle, thresholdAggregate: tds.thresholdAggregate,
        panMissingRate: tds.panMissingRate, nonFilerRate: tds.nonFilerRate,
      },
      create: {
        code: tds.code, newSection: tds.newSection, oldSection: tds.oldSection || null, nature: tds.nature,
        rateIndividual: tds.rateIndividual, rateOthers: tds.rateOthers,
        thresholdSingle: tds.thresholdSingle, thresholdAggregate: tds.thresholdAggregate,
        panMissingRate: tds.panMissingRate, nonFilerRate: tds.nonFilerRate,
        effectiveFrom: EFFECTIVE_FROM, isActive: true,
      },
    });
    tdsCount++;
  }
  console.log(`  · TdsSection ${tdsCount} upserted`);

  // TCS sections
  for (const tcs of TCS_SEED) {
    await prisma.tcsSection.upsert({
      where: { code: tcs.code },
      update: { nature: tcs.nature, rate: tcs.rate, threshold: tcs.threshold },
      create: { code: tcs.code, nature: tcs.nature, rate: tcs.rate, threshold: tcs.threshold, effectiveFrom: EFFECTIVE_FROM, isActive: true },
    });
    tcsCount++;
  }
  console.log(`  · TcsSection ${tcsCount} upserted`);

  // Invoice series (FY 2026-27)
  for (const series of INVOICE_SERIES_SEED) {
    await prisma.invoiceSeries.upsert({
      where: { fyId_docType: { fyId: fy2627.id, docType: series.docType } },
      update: { prefix: series.prefix, width: series.width },
      create: { fyId: fy2627.id, docType: series.docType, prefix: series.prefix, width: series.width, nextNumber: 1, isActive: true },
    });
    seriesCount++;
  }
  console.log(`  · InvoiceSeries ${seriesCount} upserted`);

  // Tax rule explanations
  for (const expl of TAX_RULE_EXPLANATIONS_SEED) {
    await prisma.taxRuleExplanation.upsert({
      where: { ruleKey: expl.ruleKey },
      update: {
        title: expl.title, plainEnglish: expl.plainEnglish, whatErpDoes: expl.whatErpDoes,
        whatUserDoes: expl.whatUserDoes, sourceLink: expl.sourceLink || null,
        category: expl.category, sortOrder: expl.sortOrder,
      },
      create: {
        ruleKey: expl.ruleKey, title: expl.title, plainEnglish: expl.plainEnglish,
        whatErpDoes: expl.whatErpDoes, whatUserDoes: expl.whatUserDoes,
        sourceLink: expl.sourceLink || null, category: expl.category, sortOrder: expl.sortOrder,
      },
    });
    explanationCount++;
  }
  console.log(`  · TaxRuleExplanation ${explanationCount} upserted`);

  // TDS Payable ledgers (children of 2200) + back-link TdsSection.defaultLedgerId
  const tdsParent = await prisma.account.findUnique({ where: { code: '2200' } });
  if (tdsParent) {
    for (const seed of TDS_LEDGER_SEED) {
      const ledger = await prisma.account.upsert({
        where: { code: seed.ledgerCode },
        update: { parentId: tdsParent.id, type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
        create: {
          code: seed.ledgerCode, name: seed.ledgerName,
          type: 'LIABILITY', subType: 'CURRENT_LIABILITY',
          parentId: tdsParent.id, isSystem: true, isActive: true,
        },
      });
      ledgerCount++;
      const section = await prisma.tdsSection.findUnique({ where: { code: seed.tdsSectionCode } });
      if (section && section.defaultLedgerId !== ledger.id) {
        await prisma.tdsSection.update({ where: { id: section.id }, data: { defaultLedgerId: ledger.id } });
        ledgerLinkCount++;
      }
    }
    console.log(`  · TDS ledgers ${ledgerCount} upserted, ${ledgerLinkCount} newly linked`);
  } else {
    console.log('  ! Parent account code 2200 not found — skipping TDS ledger creation');
  }

  console.log('─────────────────────────────────────────');
  console.log(`HSN          : ${hsnCount}`);
  console.log(`GstRate new  : ${gstRateCount}`);
  console.log(`TdsSection   : ${tdsCount}`);
  console.log(`TcsSection   : ${tcsCount}`);
  console.log(`InvoiceSeries: ${seriesCount}`);
  console.log(`Explanations : ${explanationCount}`);
  console.log(`TDS Ledgers  : ${ledgerCount} (${ledgerLinkCount} newly linked)`);
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
