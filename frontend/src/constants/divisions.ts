// Company divisions — single source of truth (mirror of backend/shared/config/divisions.ts)
export const DIVISIONS = ['SUGAR', 'POWER', 'ETHANOL', 'COMMON'] as const;
export type Division = (typeof DIVISIONS)[number];
export const DEFAULT_DIVISION: Division = 'ETHANOL';

export const DIVISION_COLORS: Record<Division, string> = {
  SUGAR: 'bg-amber-500',
  POWER: 'bg-blue-500',
  ETHANOL: 'bg-emerald-500',
  COMMON: 'bg-slate-400',
};

export const DIVISION_TEXT_COLORS: Record<Division, string> = {
  SUGAR: 'text-amber-700',
  POWER: 'text-blue-700',
  ETHANOL: 'text-emerald-700',
  COMMON: 'text-slate-600',
};
