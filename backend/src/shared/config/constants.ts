/**
 * Plant configuration constants.
 * Replaces hardcoded magic numbers scattered across route files.
 */
export const PLANT = {
  fermenters: {
    count: 4,
    capacityLiters: 2300,
  },
  preFermenters: {
    count: 2,
    capacityLiters: 430,
  },
  beerWell: {
    capacityLiters: 430,
  },
  defaults: {
    pfGravityTarget: 1.024,
    fermRetentionHours: 8,
    millingLossPercent: 2.5,
    ddgsBaseProduction: 3160,
  },
} as const;

export const GST = {
  defaultRate: 5,
  hsnCodes: {
    ddgs: '2303.30.00',
    ethanol: '2207.20.00',
  },
} as const;

export const PAGINATION = {
  defaultLimit: 50,
  maxLimit: 500,
} as const;
