// Tax & Compliance seed data — Phase 1 master data
// Effective from FY 2026-27 (2026-04-01)
// Consumed by POST /api/tax/seed (idempotent upsert).

const EFFECTIVE_FROM = new Date('2026-04-01');

export interface GstRateSeed {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  isExempt?: boolean;
  isOutsideGst?: boolean;
  conditionNote?: string;
}

export interface HsnSeed {
  code: string;
  description: string;
  uqc: string;
  category: 'FINISHED_GOOD' | 'RAW_MATERIAL' | 'BYPRODUCT' | 'SERVICE';
  rates: GstRateSeed[];
}

export const HSN_SEED: HsnSeed[] = [
  {
    code: '22072000',
    description: 'Denatured ethyl alcohol (Ethanol) — EBP & Industrial',
    uqc: 'KLR',
    category: 'FINISHED_GOOD',
    rates: [
      { cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, conditionNote: 'EBP (petrol blending) only' },
      { cgst: 9, sgst: 9, igst: 18, cess: 0, conditionNote: 'Industrial use' },
    ],
  },
  {
    code: '22071000',
    description: 'Undenatured ethyl alcohol (ENA) — outside GST',
    uqc: 'KLR',
    category: 'FINISHED_GOOD',
    rates: [
      { cgst: 0, sgst: 0, igst: 0, cess: 0, isOutsideGst: true, conditionNote: 'Alcohol for human consumption — State excise' },
    ],
  },
  {
    code: '23033000',
    description: 'DDGS / brewing or distilling dregs and waste',
    uqc: 'KGS',
    category: 'FINISHED_GOOD',
    rates: [
      { cgst: 0, sgst: 0, igst: 0, cess: 0, isExempt: true, conditionNote: 'Unbranded cattle feed' },
      { cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, conditionNote: 'Branded / packaged' },
    ],
  },
  {
    code: '17031000',
    description: 'Cane molasses',
    uqc: 'KGS',
    category: 'RAW_MATERIAL',
    rates: [
      { cgst: 2.5, sgst: 2.5, igst: 5, cess: 0 },
    ],
  },
  {
    code: '10059000',
    description: 'Maize (corn) — other',
    uqc: 'KGS',
    category: 'RAW_MATERIAL',
    rates: [
      { cgst: 0, sgst: 0, igst: 0, cess: 0, isExempt: true, conditionNote: 'Unbranded agricultural produce' },
    ],
  },
  {
    code: '28112100',
    description: 'Carbon dioxide (byproduct of fermentation)',
    uqc: 'KGS',
    category: 'BYPRODUCT',
    rates: [
      { cgst: 9, sgst: 9, igst: 18, cess: 0 },
    ],
  },
  {
    code: '38249900',
    description: 'Fusel oil / other chemical products n.e.s.',
    uqc: 'KGS',
    category: 'BYPRODUCT',
    rates: [
      { cgst: 9, sgst: 9, igst: 18, cess: 0 },
    ],
  },
  {
    code: '99884200',
    description: 'Job-work service — ethanol manufacturing',
    uqc: 'NOS',
    category: 'SERVICE',
    rates: [
      { cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, conditionNote: 'Job work on principal-owned inputs' },
    ],
  },
  {
    code: '99881700',
    description: 'Job-work service — DDGS / food product manufacturing',
    uqc: 'NOS',
    category: 'SERVICE',
    rates: [
      { cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, conditionNote: 'Job work on principal-owned inputs' },
    ],
  },
];

// ----------------------------------------------------------------------------
// TDS sections — Income-tax Act 2025 (new Section 393 replaces 194C/J/H/I/etc.)
// Rates reflect FY 2026-27 regime.
// ----------------------------------------------------------------------------

export interface TdsSectionSeed {
  code: string;
  newSection: string;
  oldSection?: string;
  nature: string;
  rateIndividual: number;
  rateOthers: number;
  thresholdSingle: number;
  thresholdAggregate: number;
  panMissingRate: number;
  nonFilerRate: number;
}

// One TDS Payable child ledger per section.
// All hang under parent account code "2200" (TDS Payable, LIABILITY).
// ledgerCode is the unique Account.code we'll create / upsert.
// tdsSectionCode matches TdsSectionSeed.code so seed.ts can back-link
// the resulting Account.id onto TdsSection.defaultLedgerId.
export interface TdsLedgerSeed {
  ledgerCode: string;
  ledgerName: string;
  tdsSectionCode: string;
}

export const TDS_LEDGER_SEED: TdsLedgerSeed[] = [
  { ledgerCode: '2201', ledgerName: 'TDS Payable - 194C - Contractors',     tdsSectionCode: '393_CONTRACTOR'    },
  { ledgerCode: '2202', ledgerName: 'TDS Payable - 194J - Professional',     tdsSectionCode: '393_PROFESSIONAL'  },
  { ledgerCode: '2203', ledgerName: 'TDS Payable - 194I(a) - Rent Plant',    tdsSectionCode: '393_RENT_PLANT'    },
  { ledgerCode: '2204', ledgerName: 'TDS Payable - 194I(b) - Rent Building', tdsSectionCode: '393_RENT_BUILDING' },
  { ledgerCode: '2205', ledgerName: 'TDS Payable - 194H - Commission',       tdsSectionCode: '393_COMMISSION'    },
  { ledgerCode: '2206', ledgerName: 'TDS Payable - 194A - Interest',         tdsSectionCode: '393_INTEREST'      },
  { ledgerCode: '2207', ledgerName: 'TDS Payable - 194Q - Goods Purchase',   tdsSectionCode: '393_GOODS'         },
  { ledgerCode: '2208', ledgerName: 'TDS Payable - 194IA - Property',        tdsSectionCode: '393_PROPERTY'      },
  { ledgerCode: '2209', ledgerName: 'TDS Payable - 194T - Partner Payments', tdsSectionCode: '394_PARTNER'       },
];

export const TDS_SEED: TdsSectionSeed[] = [
  {
    code: '393_CONTRACTOR',
    newSection: '393',
    oldSection: '194C',
    nature: 'Payment to contractors / sub-contractors (works, manpower, transport)',
    rateIndividual: 1,
    rateOthers: 2,
    thresholdSingle: 30000,
    thresholdAggregate: 100000,
    panMissingRate: 20,
    nonFilerRate: 5,
  },
  {
    code: '393_PROFESSIONAL',
    newSection: '393',
    oldSection: '194J',
    nature: 'Fees for professional or technical services',
    rateIndividual: 10,
    rateOthers: 10,
    thresholdSingle: 0,
    thresholdAggregate: 50000,
    panMissingRate: 20,
    nonFilerRate: 5,
  },
  {
    code: '393_RENT_PLANT',
    newSection: '393',
    oldSection: '194I',
    nature: 'Rent — plant, machinery & equipment',
    rateIndividual: 2,
    rateOthers: 2,
    thresholdSingle: 0,
    thresholdAggregate: 240000,
    panMissingRate: 20,
    nonFilerRate: 5,
  },
  {
    code: '393_RENT_BUILDING',
    newSection: '393',
    oldSection: '194I',
    nature: 'Rent — land, building or furniture',
    rateIndividual: 10,
    rateOthers: 10,
    thresholdSingle: 0,
    thresholdAggregate: 240000,
    panMissingRate: 20,
    nonFilerRate: 5,
  },
  {
    code: '393_COMMISSION',
    newSection: '393',
    oldSection: '194H',
    nature: 'Commission or brokerage',
    rateIndividual: 2,
    rateOthers: 2,
    thresholdSingle: 0,
    thresholdAggregate: 15000,
    panMissingRate: 20,
    nonFilerRate: 5,
  },
  {
    code: '393_INTEREST',
    newSection: '393',
    oldSection: '194A',
    nature: 'Interest other than interest on securities',
    rateIndividual: 10,
    rateOthers: 10,
    thresholdSingle: 0,
    thresholdAggregate: 5000,
    panMissingRate: 20,
    nonFilerRate: 5,
  },
  {
    code: '393_GOODS',
    newSection: '393',
    oldSection: '194Q',
    nature: 'Purchase of goods (aggregate > 50 lakh from single seller)',
    rateIndividual: 0.1,
    rateOthers: 0.1,
    thresholdSingle: 0,
    thresholdAggregate: 5000000,
    panMissingRate: 5,
    nonFilerRate: 5,
  },
  {
    code: '393_PROPERTY',
    newSection: '393',
    oldSection: '194IA',
    nature: 'Purchase of immovable property (value >= 50 lakh)',
    rateIndividual: 1,
    rateOthers: 1,
    thresholdSingle: 5000000,
    thresholdAggregate: 5000000,
    panMissingRate: 20,
    nonFilerRate: 5,
  },
  {
    code: '394_PARTNER',
    newSection: '394',
    oldSection: '194T',
    nature: 'Payment to partners — salary, remuneration, interest, commission',
    rateIndividual: 10,
    rateOthers: 10,
    thresholdSingle: 0,
    thresholdAggregate: 20000,
    panMissingRate: 20,
    nonFilerRate: 5,
  },
];

// ----------------------------------------------------------------------------
// TCS sections
// ----------------------------------------------------------------------------

export interface TcsSectionSeed {
  code: string;
  nature: string;
  rate: number;
  threshold: number;
}

export const TCS_SEED: TcsSectionSeed[] = [
  {
    code: '206C_SCRAP',
    nature: 'Sale of scrap',
    rate: 1,
    threshold: 0,
  },
  {
    code: '206C_1H',
    nature: 'Sale of goods (aggregate > 50 lakh from single buyer)',
    rate: 0.1,
    threshold: 5000000,
  },
];

// ----------------------------------------------------------------------------
// Invoice series — FY 2026-27
// ----------------------------------------------------------------------------

export interface InvoiceSeriesSeed {
  docType: string;
  prefix: string;
  width: number;
}

export const INVOICE_SERIES_SEED: InvoiceSeriesSeed[] = [
  { docType: 'TAX_INVOICE', prefix: 'ETH/26-27/', width: 5 },
  { docType: 'CREDIT_NOTE', prefix: 'CN/26-27/', width: 5 },
  { docType: 'DEBIT_NOTE', prefix: 'DN/26-27/', width: 5 },
  { docType: 'DELIVERY_CHALLAN', prefix: 'DC/26-27/', width: 5 },
  { docType: 'EXPORT_INVOICE', prefix: 'EXP/26-27/', width: 5 },
  { docType: 'RCM_INVOICE', prefix: 'RCM/26-27/', width: 5 },
  { docType: 'JOBWORK_INVOICE', prefix: 'JW/26-27/', width: 5 },
];

// ----------------------------------------------------------------------------
// Tax rule explanations — plain-English cheat sheet for the Tax Rules page
// ----------------------------------------------------------------------------

export interface TaxRuleExplanationSeed {
  ruleKey: string;
  title: string;
  plainEnglish: string;
  whatErpDoes: string;
  whatUserDoes: string;
  sourceLink?: string;
  category: 'DIRECT_TAX' | 'GST' | 'PAYROLL' | 'ROC' | 'DISTILLERY' | 'OTHER';
  sortOrder: number;
}

export const TAX_RULE_EXPLANATIONS_SEED: TaxRuleExplanationSeed[] = [
  {
    ruleKey: 'direct_tax.corporate',
    title: 'Corporate income tax',
    plainEnglish:
      'MSPIL is a domestic company. The tax regime controls the rate: 22% under 115BAA (no incentives), 15% under 115BAB (new manufacturing), or slab rates under the normal regime. Once you opt into 115BAA or 115BAB, you cannot revert.',
    whatErpDoes:
      'Stores the selected regime on ComplianceConfig.taxRegime and uses it as the default for tax provision workings and advance-tax calculations.',
    whatUserDoes:
      'Set the correct regime once in Compliance Config. Confirm the choice with your auditor before switching — it is binding.',
    sourceLink: 'https://incometaxindia.gov.in',
    category: 'DIRECT_TAX',
    sortOrder: 10,
  },
  {
    ruleKey: 'direct_tax.advance_tax',
    title: 'Advance tax schedule',
    plainEnglish:
      'Companies must pay advance tax in four instalments: 15% by 15-Jun, 45% by 15-Sep, 75% by 15-Dec, and 100% by 15-Mar. Short payment attracts interest under 234B/234C.',
    whatErpDoes:
      'The obligation tracker creates four reminders per fiscal year on these due dates and shows a running cumulative target.',
    whatUserDoes:
      'Review the advance-tax working one week before each due date. Approve the challan and settle via bank payments.',
    category: 'DIRECT_TAX',
    sortOrder: 20,
  },
  {
    ruleKey: 'tds.393.contractor',
    title: 'TDS on contractors (Section 393, formerly 194C)',
    plainEnglish:
      'When you pay a contractor (works, manpower, transport) more than Rs.30,000 on a single bill or Rs.1,00,000 in a year, deduct TDS at 1% for individuals/HUF and 2% for companies/firms. If the vendor has no PAN, deduct 20%.',
    whatErpDoes:
      'On every vendor invoice, the ERP looks up the vendor tdsSectionId, checks thresholds cumulatively for the year, and auto-calculates TDS. It also flags 206AB non-filers at the higher rate.',
    whatUserDoes:
      'Map each vendor to the correct TDS section at master-data creation. Do not override the auto-calc unless you have a lower-deduction certificate (store it under LDC fields).',
    category: 'DIRECT_TAX',
    sortOrder: 30,
  },
  {
    ruleKey: 'tds.393.professional',
    title: 'TDS on professional fees (Section 393, formerly 194J)',
    plainEnglish:
      'Fees paid to CA, consultants, technical service providers, etc., attract 10% TDS once aggregate in the year crosses Rs.50,000. No single-bill threshold.',
    whatErpDoes:
      'Tags professional vendors with the 393_PROFESSIONAL section and tracks aggregate spend against the Rs.50,000 ceiling before triggering deduction.',
    whatUserDoes:
      'Mark auditors, consultants, and lab-service providers as professional. Keep their PAN on file.',
    category: 'DIRECT_TAX',
    sortOrder: 40,
  },
  {
    ruleKey: 'tds.393.rent',
    title: 'TDS on rent (Section 393, formerly 194I)',
    plainEnglish:
      'Rent for plant/machinery attracts 2% TDS; rent for land/building/furniture attracts 10%. Threshold is Rs.2,40,000 per year per landlord.',
    whatErpDoes:
      'Separate TDS codes (393_RENT_PLANT vs 393_RENT_BUILDING) let you pick the right rate on the rent payable voucher.',
    whatUserDoes:
      'Tag each landlord vendor with the right rent code. Track total annual rent against the Rs.2.4 lakh ceiling per landlord.',
    category: 'DIRECT_TAX',
    sortOrder: 50,
  },
  {
    ruleKey: 'tcs.206c.scrap',
    title: 'TCS on scrap sales (Section 206C)',
    plainEnglish:
      'When you sell scrap (metal, MS cuttings, used drums, etc.), collect 1% TCS from the buyer and deposit it to the government. No threshold.',
    whatErpDoes:
      'Applies 1% TCS automatically on sales invoices when the customer is linked to scrap sales and the material is tagged as scrap.',
    whatUserDoes:
      'Mark scrap buyers with customerType=SCRAP_BUYER and the scrap material with the right HSN. Collect PAN from every scrap buyer.',
    category: 'DIRECT_TAX',
    sortOrder: 60,
  },
  {
    ruleKey: 'gst.ethanol.ebp',
    title: 'GST on ethanol for EBP (5%)',
    plainEnglish:
      'Denatured ethanol sold to OMCs under the Ethanol Blending Programme attracts 5% GST (2.5% CGST + 2.5% SGST intra-state or 5% IGST inter-state).',
    whatErpDoes:
      'Ethanol sales orders tagged as EBP automatically use the 5% rate from HSN 22072000 (EBP condition).',
    whatUserDoes:
      'Make sure the sales order has the EBP flag before raising the invoice so the correct rate and e-invoice schema apply.',
    category: 'GST',
    sortOrder: 70,
  },
  {
    ruleKey: 'gst.ethanol.industrial',
    title: 'GST on industrial ethanol (18%)',
    plainEnglish:
      'Denatured ethanol sold to industrial buyers (chemicals, pharma, paints) attracts 18% GST. Same HSN (22072000) as EBP, different rate based on end use.',
    whatErpDoes:
      'Industrial ethanol sales orders pick the 18% rate via the same HSN using the Industrial use conditionNote.',
    whatUserDoes:
      'Select the right use-case on the sales order. Keep the buyer declaration on file if asked by GST officers.',
    category: 'GST',
    sortOrder: 80,
  },
  {
    ruleKey: 'gst.ena',
    title: 'GST on ENA (outside GST)',
    plainEnglish:
      'Undenatured ethyl alcohol (ENA) used for human consumption is outside GST. It is taxed by state excise. No GST invoice is raised for ENA sales — only a state excise invoice.',
    whatErpDoes:
      'HSN 22071000 is flagged isOutsideGst=true, so ENA sales are excluded from GST returns and e-invoice generation.',
    whatUserDoes:
      'Use the ENA sales flow (state excise pass), not the GST invoice flow. Do not try to raise a tax invoice on ENA.',
    category: 'GST',
    sortOrder: 90,
  },
  {
    ruleKey: 'gst.einvoice.30day',
    title: 'E-invoice 30-day rule',
    plainEnglish:
      'Since 1-April-2025, taxpayers with turnover above Rs.10 Cr must upload invoices to the IRP within 30 days of invoice date. Older invoices are rejected.',
    whatErpDoes:
      'The e-invoice queue warns if an invoice is older than 25 days and blocks submission beyond 30 days.',
    whatUserDoes:
      'Push every invoice to IRP the same day. Do not let invoices sit in draft for more than a week.',
    category: 'GST',
    sortOrder: 100,
  },
  {
    ruleKey: 'gst.lut',
    title: 'LUT for zero-rated exports',
    plainEnglish:
      'Exports under Letter of Undertaking (LUT) are zero-rated without paying IGST. The LUT is renewed every fiscal year on the GST portal.',
    whatErpDoes:
      'Stores the LUT number and validity on ComplianceConfig. Export invoices use the EXP series and reference the active LUT.',
    whatUserDoes:
      'Renew the LUT every April and update the LUT fields in Compliance Config. Attach the LUT PDF to the Document Vault.',
    category: 'GST',
    sortOrder: 110,
  },
  {
    ruleKey: 'payment.msme.43bh',
    title: 'MSME 45-day payment rule (Section 43B(h))',
    plainEnglish:
      'Payments to registered MSME vendors must be made within 45 days of acceptance of goods/services. Delay disallows the expense in the year of non-payment — you pay income tax on it.',
    whatErpDoes:
      'Vendors with udyamNo set are flagged as MSME. The payment desk shows MSME invoices in a red priority bucket with days-to-deadline.',
    whatUserDoes:
      'Never delay an MSME vendor payment beyond 45 days. Collect Udyam registration from every small vendor at onboarding.',
    category: 'DIRECT_TAX',
    sortOrder: 120,
  },
];
