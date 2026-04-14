import prisma from '../../config/prisma';

/**
 * Centralized company configuration.
 * Replaces 11+ hardcoded GSTIN/address/bank occurrences across the codebase.
 * COMPANY constant = MSPIL default (hardcoded fallback).
 * getCompanyById() = DB-backed lookup for multi-company support.
 */
export const MSPIL_COMPANY_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';

export const COMPANY = {
  name: 'Mahakaushal Sugar & Power Industries Ltd',
  shortName: 'MSPIL',
  gstin: '23AAECM3666P1Z1',
  pan: 'AAECM3666P',
  stateCode: '23',
  stateName: 'Madhya Pradesh',

  address: {
    line1: 'Village Bachai, Tehsil Gadarwara',
    line2: 'Dist. Narsinghpur',
    city: 'Narsinghpur',
    state: 'Madhya Pradesh',
    pincode: '487551',
  },

  bank: {
    name: 'State Bank of India',
    branch: 'Gadarwara',
    accountNo: '', // TODO: Move to env or Settings model
    ifsc: '',       // TODO: Move to env or Settings model
  },

  contact: {
    phone: '',
    email: '',
  },
} as const;

export type Company = typeof COMPANY;

/** Widened interface for DB-backed company lookups (same shape, mutable strings) */
export interface CompanyConfig {
  name: string;
  shortName: string;
  gstin: string;
  pan: string;
  stateCode: string;
  stateName: string;
  address: { line1: string; line2: string; city: string; state: string; pincode: string };
  bank: { name: string; branch: string; accountNo: string; ifsc: string };
  contact: { phone: string; email: string };
}

/**
 * DB-backed company lookup. Returns COMPANY (MSPIL) fallback when:
 * - companyId is null/undefined (backwards compat for old records)
 * - company not found in DB
 *
 * New multi-company code should call this instead of using COMPANY directly.
 * Existing code using COMPANY constant is unaffected.
 */
export async function getCompanyById(companyId?: string | null): Promise<CompanyConfig> {
  if (!companyId) return COMPANY;

  const row = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true, shortName: true, code: true,
      gstin: true, pan: true, gstState: true,
      address: true, city: true, state: true, pincode: true,
      bankName: true, bankBranch: true, bankAccount: true, bankIfsc: true,
      phone: true, email: true,
    },
  });
  if (!row) return COMPANY;

  return {
    name: row.name,
    shortName: row.shortName || row.code,
    gstin: row.gstin || '',
    pan: row.pan || '',
    stateCode: row.gstState || '23',
    stateName: row.state || 'Madhya Pradesh',
    address: {
      line1: row.address || '',
      line2: '',
      city: row.city || '',
      state: row.state || 'Madhya Pradesh',
      pincode: row.pincode || '',
    },
    bank: {
      name: row.bankName || '',
      branch: row.bankBranch || '',
      accountNo: row.bankAccount || '',
      ifsc: row.bankIfsc || '',
    },
    contact: {
      phone: row.phone || '',
      email: row.email || '',
    },
  };
}
