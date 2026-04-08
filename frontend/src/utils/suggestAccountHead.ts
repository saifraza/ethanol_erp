// Heuristic: suggest a GL account type/subtype + likely parent code from a name or narration.
// Mirrors backend/src/services/autoJournal.ts getSalesAccountCode + getExpenseAccountCode.
// Used by QuickCreateAccountModal (for a new head) and NewJournalEntryModal (for narration-based hints).

export type AccountType = 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE' | 'EQUITY';
export type ContextSide = 'DEBIT' | 'CREDIT' | 'UNKNOWN';

export interface SuggestedHead {
  type: AccountType;
  subType: string;
  parentCode?: string;    // existing GL account code in seeded Chart of Accounts
  reason: string;         // short human explanation — shown as "Suggested because…"
}

interface Rule {
  keywords: RegExp;
  side?: ContextSide;
  result: Omit<SuggestedHead, 'reason'>;
  reason: string;
}

// Order matters — first match wins
const RULES: Rule[] = [
  // INCOME — products
  {
    keywords: /\b(ethanol|ena|rs|rectified spirit|rectified)\b/i,
    result: { type: 'INCOME', subType: 'DIRECT_INCOME', parentCode: '3001' },
    reason: 'contains ethanol/ENA/RS',
  },
  {
    keywords: /\b(ddgs|distiller'?s? dried|dried grain)\b/i,
    result: { type: 'INCOME', subType: 'DIRECT_INCOME', parentCode: '3002' },
    reason: 'contains DDGS',
  },

  // EXPENSE — raw materials
  {
    keywords: /\b(grain|wheat|rice|maize|paddy|broken rice|sorghum|bajra|jowar)\b/i,
    result: { type: 'EXPENSE', subType: 'DIRECT_EXPENSE', parentCode: '4001' },
    reason: 'grain/raw material keyword',
  },
  {
    keywords: /\b(chemical|enzyme|yeast|acid|caustic|alpha amylase)\b/i,
    result: { type: 'EXPENSE', subType: 'DIRECT_EXPENSE', parentCode: '4002' },
    reason: 'chemical/enzyme keyword',
  },
  {
    keywords: /\b(spare|maintenance|repair|service|overhaul)\b/i,
    result: { type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', parentCode: '4030' },
    reason: 'spares/maintenance keyword',
  },
  {
    keywords: /\b(power|electricity|coal|husk|fuel|utility|water|diesel)\b/i,
    result: { type: 'EXPENSE', subType: 'DIRECT_EXPENSE', parentCode: '4003' },
    reason: 'power/fuel/utility keyword',
  },
  {
    keywords: /\b(transport|freight|lorry|truck|cartage|hamali)\b/i,
    result: { type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', parentCode: '4010' },
    reason: 'freight/transport keyword',
  },
  {
    keywords: /\b(salary|wage|payroll|bonus|pf|esi)\b/i,
    result: { type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', parentCode: '4020' },
    reason: 'payroll keyword',
  },

  // ASSET — banks & cash
  {
    keywords: /\b(bank|sbi|hdfc|icici|ubi|axis|kotak|yes bank|canara|bob)\b/i,
    result: { type: 'ASSET', subType: 'BANK' },
    reason: 'bank name detected',
  },
  {
    keywords: /\bcash\b/i,
    result: { type: 'ASSET', subType: 'CASH' },
    reason: 'cash keyword',
  },

  // Party (company-like name) — split by context
  {
    keywords: /\b(traders?|pvt|ltd|limited|enterprises?|industries|& sons|agencies|corporation|corp|inc)\b/i,
    side: 'DEBIT',
    result: { type: 'ASSET', subType: 'CURRENT_ASSET', parentCode: '1100' },
    reason: 'looks like a party name, Dr context → debtor',
  },
  {
    keywords: /\b(traders?|pvt|ltd|limited|enterprises?|industries|& sons|agencies|corporation|corp|inc)\b/i,
    side: 'CREDIT',
    result: { type: 'LIABILITY', subType: 'CURRENT_LIABILITY', parentCode: '2001' },
    reason: 'looks like a party name, Cr context → creditor',
  },
  {
    keywords: /\b(traders?|pvt|ltd|limited|enterprises?|industries|& sons|agencies|corporation|corp|inc)\b/i,
    result: { type: 'LIABILITY', subType: 'CURRENT_LIABILITY', parentCode: '2001' },
    reason: 'looks like a party name → default sundry creditor',
  },

  // Tax / duty
  {
    keywords: /\b(gst|cgst|sgst|igst|tds|tcs)\b/i,
    result: { type: 'LIABILITY', subType: 'CURRENT_LIABILITY' },
    reason: 'tax/duty keyword',
  },
];

export function suggestAccountHead(input: {
  searchText?: string;
  narration?: string;
  contextSide?: ContextSide;
}): SuggestedHead {
  const text = `${input.searchText || ''} ${input.narration || ''}`.trim();
  const side = input.contextSide || 'UNKNOWN';

  if (!text) {
    return {
      type: 'EXPENSE',
      subType: 'INDIRECT_EXPENSE',
      reason: 'default (no keywords)',
    };
  }

  for (const rule of RULES) {
    if (!rule.keywords.test(text)) continue;
    if (rule.side && rule.side !== side) continue;
    return { ...rule.result, reason: rule.reason };
  }

  return {
    type: 'EXPENSE',
    subType: 'INDIRECT_EXPENSE',
    reason: 'default fallback',
  };
}
