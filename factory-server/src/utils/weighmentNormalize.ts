/**
 * weighmentNormalize.ts
 * Converts a raw Weighment DB row to the UnifiedWeighmentRow shape used
 * for reports. Keeps all business logic (status mapping, duration calc,
 * party name resolution) in one place so route and xlsx export share it.
 */

// Raw Weighment fields selected from Prisma (only what we need)
export interface RawWeighment {
  id: string;
  ticketNo: number | null;
  direction: string;
  materialCategory: string | null;
  materialName: string | null;
  vehicleNo: string;
  supplierName: string | null;
  shipToName: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  gateEntryAt: Date | null;
  firstWeightAt: Date | null;
  secondWeightAt: Date | null;
  status: string;
}

export type UnifiedMaterialType = 'ETHANOL' | 'DDGS' | 'RAW_MATERIAL' | 'FUEL' | 'OTHER';
export type UnifiedStatus = 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'CANCELLED';
export type UnifiedDirection = 'INBOUND' | 'OUTBOUND';

export interface UnifiedWeighmentRow {
  id: string;
  source: 'FACTORY_WEIGHMENT';
  ticketNo: number | null;
  direction: UnifiedDirection;
  materialType: UnifiedMaterialType;
  materialName: string | null;
  vehicleNo: string;
  partyName: string;
  partyId: null;
  gateEntryAt: string | null;
  firstWeightAt: string | null;
  secondWeightAt: string | null;
  releaseAt: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  status: UnifiedStatus;
  durationGateToFirstMin: number | null;
  durationFirstToSecondMin: number | null;
  turnaroundMin: number | null;
}

function mapMaterialCategory(cat: string | null): UnifiedMaterialType {
  switch (cat?.toUpperCase()) {
    case 'RAW_MATERIAL': return 'RAW_MATERIAL';
    case 'FUEL':         return 'FUEL';
    case 'ETHANOL':      return 'ETHANOL';
    case 'DDGS':         return 'DDGS';
    default:             return 'OTHER';
  }
}

/** DB status → unified status
 *  GATE_ENTRY  → PENDING
 *  FIRST_DONE  → PARTIAL
 *  COMPLETE    → COMPLETE
 *  CANCELLED   → CANCELLED
 *  (anything else treated as PENDING)
 */
function mapStatus(s: string): UnifiedStatus {
  switch (s?.toUpperCase()) {
    case 'COMPLETE':   return 'COMPLETE';
    case 'CANCELLED':  return 'CANCELLED';
    case 'FIRST_DONE': return 'PARTIAL';
    case 'GATE_ENTRY':
    default:           return 'PENDING';
  }
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function diffMin(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  if (ms < 0) return null;
  return Math.round(ms / 60000);
}

export function normalize(w: RawWeighment): UnifiedWeighmentRow {
  const direction: UnifiedDirection = w.direction?.toUpperCase() === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND';

  // partyName: inbound → supplierName, outbound → shipToName (fall back to supplierName)
  const partyName =
    direction === 'INBOUND'
      ? (w.supplierName ?? '')
      : (w.shipToName ?? w.supplierName ?? '');

  const gateToFirst   = diffMin(w.gateEntryAt, w.firstWeightAt);
  const firstToSecond = diffMin(w.firstWeightAt, w.secondWeightAt);
  // turnaround = gate-in to second weight (full cycle)
  const turnaround    = diffMin(w.gateEntryAt, w.secondWeightAt);

  return {
    id:           w.id,
    source:       'FACTORY_WEIGHMENT',
    ticketNo:     w.ticketNo,
    direction,
    materialType: mapMaterialCategory(w.materialCategory),
    materialName: w.materialName ?? null,
    vehicleNo:    w.vehicleNo,
    partyName,
    partyId:      null,
    gateEntryAt:  isoOrNull(w.gateEntryAt),
    firstWeightAt: isoOrNull(w.firstWeightAt),
    secondWeightAt: isoOrNull(w.secondWeightAt),
    releaseAt:    null, // not tracked separately in factory
    grossWeight:  w.grossWeight ?? null,
    tareWeight:   w.tareWeight ?? null,
    netWeight:    w.netWeight ?? null,
    status:       mapStatus(w.status),
    durationGateToFirstMin:    gateToFirst,
    durationFirstToSecondMin:  firstToSecond,
    turnaroundMin:             turnaround,
  };
}
