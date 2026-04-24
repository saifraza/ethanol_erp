/**
 * In-memory shared state: which weighment is currently on the scale.
 *
 * Written by weighbridge.ts (operator captures gross/tare).
 * Read by weightTriggeredCapture.ts (training data collection).
 *
 * Single variable — one physical scale, one truck at a time.
 * Auto-expires after 30 min as safety valve against stale associations.
 */

const SESSION_TTL_MS = 30 * 60_000;

export interface ScaleSession {
  weighmentId: string;
  vehicleNo: string;
  ticketNo: number | null;
  direction: string | null;
  phase: 'gross' | 'tare';
  materialName: string | null;
  materialCategory: string | null;
  setAt: number; // Date.now()
}

let current: ScaleSession | null = null;

export function setActiveSession(info: Omit<ScaleSession, 'setAt'>): void {
  current = { ...info, setAt: Date.now() };
  console.log(`[SCALE-SESSION] set: ${info.vehicleNo} t${info.ticketNo} ${info.phase} (${info.weighmentId.slice(0, 8)})`);
}

export function getActiveSession(): ScaleSession | null {
  if (!current) return null;
  if (Date.now() - current.setAt > SESSION_TTL_MS) {
    console.log(`[SCALE-SESSION] expired after ${SESSION_TTL_MS / 60_000} min — clearing`);
    current = null;
    return null;
  }
  return current;
}

export function clearActiveSession(): void {
  if (current) {
    console.log(`[SCALE-SESSION] cleared: ${current.vehicleNo} t${current.ticketNo}`);
  }
  current = null;
}
