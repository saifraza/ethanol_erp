/**
 * Standard purchase-order terms & conditions for Raw Material (grain) contracts.
 *
 * Kept as a static TS constant for now (not a DB master) — these are industry-
 * standard corn/maize procurement clauses and rarely need per-row edits.
 * Promote to DB when per-vendor variations are needed.
 *
 * Schema: PurchaseOrder.termsAccepted String[] holds the ticked `key`s.
 *
 * Side-effect keys:
 *   TDS_194Q_0_1 — when ticked, caller must also set
 *                  PurchaseOrder.overrideTdsSectionId to the 194Q section so
 *                  the TDS calculator uses 0.1% instead of vendor default.
 */

export interface PoTerm {
  key: string; // enum-like stable identifier, printed into DB
  group: string; // display group header
  label: string; // full clause text — printed on PO PDF verbatim
  // When true, caller MUST also wire a backend side-effect (e.g., TDS override)
  hasBackendHook?: boolean;
  // Applicable categories — enables per-category visibility if expanded later
  categories: Array<'RAW_MATERIAL' | 'FUEL' | 'CHEMICAL' | 'CONSUMABLE' | 'ALL'>;
}

export const PO_TERMS_RAW_MATERIAL: PoTerm[] = [
  {
    key: 'QUALITY_STANDARD',
    group: 'Quality Conditions',
    label:
      'Moisture ≤14% accepted; 14–16% with deduction; >16% rejected. TFM ≤5% accepted; 5–10% with deduction; >10% rejected. Starch ≥58% required (below rejected).',
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'WEIGHBRIDGE_BUYER',
    group: 'Weight & Deduction',
    label: 'Buyer weighbridge final.',
    categories: ['RAW_MATERIAL', 'FUEL'],
  },
  {
    key: 'DHALTA_1KG',
    group: 'Weight & Deduction',
    label: '1 kg/quintal dhalta (dharamkanta) deduction applicable.',
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'PACKAGING_JUTE',
    group: 'Packaging',
    label: 'Supply in standard jute bags; bags non-returnable.',
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'DELIVERY_DRY',
    group: 'Delivery Conditions',
    label:
      'Material free from moisture/fungus/infestation; wet or rain-affected stock rejected; proper covering during transport mandatory.',
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'QC_BUYER_FINAL',
    group: 'Quality Check',
    label: 'Buyer lab report final & binding; random sampling per lot.',
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'DEDUCTIONS_APPLY',
    group: 'Pricing & Rejection',
    label: 'Quality-based deductions applicable.',
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'REJECT_LIFT_BY_SUPPLIER',
    group: 'Pricing & Rejection',
    label: 'Rejected goods to be lifted by supplier.',
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'TDS_194Q_0_1',
    group: 'Payment',
    label: '0.1% TDS (Section 194Q) and payment after final billing.',
    hasBackendHook: true,
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'RISK_TILL_UNLOAD',
    group: 'Risk & Legal',
    label: 'Risk till unloading on supplier.',
    categories: ['RAW_MATERIAL'],
  },
  {
    key: 'JURISDICTION_BUYER',
    group: 'Risk & Legal',
    label: 'Disputes under buyer jurisdiction.',
    categories: ['RAW_MATERIAL'],
  },
];

/** All keys pre-ticked by default on a new RM PO */
export const DEFAULT_RM_TERM_KEYS = PO_TERMS_RAW_MATERIAL.map((t) => t.key);

/** Terms applicable to a given category — expand later if fuel/chemical need custom clauses */
export function termsForCategory(category: string): PoTerm[] {
  const cat = category.toUpperCase();
  return PO_TERMS_RAW_MATERIAL.filter((t) =>
    t.categories.includes('ALL') || t.categories.includes(cat as PoTerm['categories'][number])
  );
}

/** Lookup a term by key — used when rendering accepted terms on the PDF */
export function termByKey(key: string): PoTerm | undefined {
  return PO_TERMS_RAW_MATERIAL.find((t) => t.key === key);
}
