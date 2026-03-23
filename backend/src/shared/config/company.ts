/**
 * Centralized company configuration.
 * Replaces 11+ hardcoded GSTIN/address/bank occurrences across the codebase.
 * TODO: Move to Settings model in DB for runtime configurability.
 */
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
