// Company divisions — single source of truth
// MSPIL operates three divisions: Sugar, Power, Ethanol
// COMMON is for overhead / unallocated entries (e.g. admin, head office expenses)

export const DIVISIONS = ['SUGAR', 'POWER', 'ETHANOL', 'COMMON'] as const;
export type Division = (typeof DIVISIONS)[number];

export const DEFAULT_DIVISION: Division = 'ETHANOL';

export function isValidDivision(v: unknown): v is Division {
  return typeof v === 'string' && (DIVISIONS as readonly string[]).includes(v);
}
