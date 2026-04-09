/**
 * Normalizers for the three weighment sources (GrainTruck, DispatchTruck, DDGSDispatchTruck)
 * into a single UnifiedWeighmentRow shape used by the weighment-history report.
 */

export type WeighmentSource = 'GRAIN_TRUCK' | 'DISPATCH_TRUCK' | 'DDGS_TRUCK';
export type WeighmentDirection = 'INBOUND' | 'OUTBOUND';
export type WeighmentMaterialType = 'ETHANOL' | 'DDGS' | 'RAW_MATERIAL' | 'FUEL' | 'OTHER';
export type WeighmentStatus = 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'CANCELLED';

export interface UnifiedWeighmentRow {
  id: string;
  source: WeighmentSource;
  ticketNo: number | null;
  direction: WeighmentDirection;
  materialType: WeighmentMaterialType;
  materialName: string | null;
  vehicleNo: string;
  partyName: string;
  partyId: string | null;
  gateEntryAt: string | null;
  firstWeightAt: string | null;
  secondWeightAt: string | null;
  releaseAt: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  status: WeighmentStatus;
  durationGateToFirstMin: number | null;
  durationFirstToSecondMin: number | null;
  turnaroundMin: number | null;
}

// ──────────────────────────────────────────────────────────
// Status derivation
// ──────────────────────────────────────────────────────────

/** Derive status from weight presence.  For CANCELLED we rely on caller. */
export function deriveStatus(
  grossWeight: number | null | undefined,
  tareWeight: number | null | undefined,
  cancelled?: boolean,
): WeighmentStatus {
  if (cancelled) return 'CANCELLED';
  const hasGross = grossWeight != null && grossWeight > 0;
  const hasTare = tareWeight != null && tareWeight > 0;
  if (hasGross && hasTare) return 'COMPLETE';
  if (hasGross || hasTare) return 'PARTIAL';
  return 'PENDING';
}

// ──────────────────────────────────────────────────────────
// Duration helpers
// ──────────────────────────────────────────────────────────

function minutesBetween(a: Date | string | null | undefined, b: Date | string | null | undefined): number | null {
  if (!a || !b) return null;
  const da = typeof a === 'string' ? new Date(a) : a;
  const db = typeof b === 'string' ? new Date(b) : b;
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return null;
  const diffMs = db.getTime() - da.getTime();
  if (diffMs < 0) return null;
  return Math.round(diffMs / 60000);
}

export function computeDurations(
  gateEntryAt: string | null,
  firstWeightAt: string | null,
  secondWeightAt: string | null,
  releaseAt: string | null,
): Pick<UnifiedWeighmentRow, 'durationGateToFirstMin' | 'durationFirstToSecondMin' | 'turnaroundMin'> {
  const durationGateToFirstMin = minutesBetween(gateEntryAt, firstWeightAt);
  const durationFirstToSecondMin = minutesBetween(firstWeightAt, secondWeightAt);
  const turnaroundEnd = releaseAt ?? secondWeightAt;
  const turnaroundMin = minutesBetween(gateEntryAt, turnaroundEnd);
  return { durationGateToFirstMin, durationFirstToSecondMin, turnaroundMin };
}

// ──────────────────────────────────────────────────────────
// Material-type mapping for GrainTruck.materialType field
// (values stored by the weighbridge e.g. BROKEN_RICE, RICE_HUSK, MAIZE, FUEL, etc.)
// ──────────────────────────────────────────────────────────

const MATERIAL_FUEL_KEYWORDS = [
  'HUSK', 'BAGASSE', 'STALK', 'STRAW', 'WOOD', 'FIREWOOD', 'COAL',
  'BRIQUETTE', 'PELLET', 'BIOMASS', 'FUEL', 'HSD', 'DIESEL', 'PETROL',
  'LIGNITE', 'SAWDUST', 'CHIPS', 'TRASH', 'PITH',
];

// Supplier-name keywords that identify a fuel supplier.  Used as a fallback
// when GrainTruck.materialType is null (weighbridge didn't categorize the row).
// NOTE: this is a heuristic — the proper fix is stamping materialType upstream.
const SUPPLIER_FUEL_KEYWORDS = [
  'MASH BIO',      // Mash Bio Pvt Ltd (biomass supplier) + Godam Mash Bio
  'BIO FUEL', 'BIOFUEL', 'BIO ENERGY',
  'IRFAN',         // Irfan Khan — local husk/firewood trader
  'SIDRA',         // Sidra Trading and Transport — husk
  'SHYAM TRADER',  // New Shyam Trader — husk
  'GODAM',         // "Godam ..." = MSPIL fuel godown transfers
];

function mapGrainMaterial(
  raw: string | null | undefined,
  supplier?: string | null,
): WeighmentMaterialType {
  // 1. Explicit material label wins
  if (raw) {
    const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, ' ');
    if (MATERIAL_FUEL_KEYWORDS.some((kw) => norm.includes(kw))) return 'FUEL';
    return 'RAW_MATERIAL';
  }
  // 2. Fallback: infer from supplier name
  if (supplier) {
    const normSup = supplier.toUpperCase().replace(/[^A-Z0-9]/g, ' ');
    if (SUPPLIER_FUEL_KEYWORDS.some((kw) => normSup.includes(kw))) return 'FUEL';
  }
  return 'RAW_MATERIAL';
}

// ──────────────────────────────────────────────────────────
// Map dispatch-truck status string to WeighmentStatus
// ──────────────────────────────────────────────────────────

function mapDispatchStatus(raw: string | null | undefined): WeighmentStatus {
  if (!raw) return 'PENDING';
  const upper = raw.toUpperCase();
  if (upper === 'RELEASED') return 'COMPLETE';
  if (upper === 'GATE_IN') return 'PENDING';
  // TARE_WEIGHED, LOADING, GROSS_WEIGHED → PARTIAL
  return 'PARTIAL';
}

// ──────────────────────────────────────────────────────────
// GrainTruck → UnifiedWeighmentRow
// ──────────────────────────────────────────────────────────

export interface GrainTruckRecord {
  id: string;
  ticketNo: number | null;
  vehicleNo: string;
  supplier: string;
  materialType: string | null;
  weightGross: number;
  weightTare: number;
  weightNet: number;
  createdAt: Date;
  // GrainTruck has no updatedAt column — use createdAt as fallback.
  cancelled: boolean;
}

export function normalizeGrainTruck(row: GrainTruckRecord): UnifiedWeighmentRow {
  const gateEntryAt = row.createdAt.toISOString();
  // GrainTruck doesn't store separate first/second weight timestamps.
  // We leave secondWeightAt null — there is no reliable proxy.
  const secondWeightAt: string | null = null;

  const materialType = mapGrainMaterial(row.materialType, row.supplier);
  const status = deriveStatus(row.weightGross, row.weightTare, row.cancelled);

  const durations = computeDurations(gateEntryAt, null, secondWeightAt, null);

  return {
    id: row.id,
    source: 'GRAIN_TRUCK',
    ticketNo: row.ticketNo,
    direction: 'INBOUND',
    materialType,
    materialName: row.materialType ?? null,
    vehicleNo: row.vehicleNo,
    partyName: row.supplier,
    partyId: null,
    gateEntryAt,
    firstWeightAt: null,
    secondWeightAt,
    releaseAt: null,
    grossWeight: row.weightGross || null,
    tareWeight: row.weightTare || null,
    netWeight: row.weightNet || null,
    status,
    ...durations,
  };
}

// ──────────────────────────────────────────────────────────
// DispatchTruck → UnifiedWeighmentRow
// ──────────────────────────────────────────────────────────

export interface DispatchTruckRecord {
  id: string;
  vehicleNo: string;
  partyName: string;
  weightGross: number | null;
  weightTare: number | null;
  weightNet: number | null;
  gateInTime: Date | null;
  tareTime: Date | null;
  grossTime: Date | null;
  releaseTime: Date | null;
  status: string;
  // DispatchTruck has no direct customerId — use shipToCustomerId as party reference
  shipToCustomerId: string | null;
  createdAt: Date;
}

export function normalizeDispatchTruck(row: DispatchTruckRecord): UnifiedWeighmentRow {
  const gateEntryAt = row.gateInTime ? row.gateInTime.toISOString() : row.createdAt.toISOString();
  const firstWeightAt = row.tareTime ? row.tareTime.toISOString() : null;
  const secondWeightAt = row.grossTime ? row.grossTime.toISOString() : null;
  const releaseAt = row.releaseTime ? row.releaseTime.toISOString() : null;

  const mappedStatus = mapDispatchStatus(row.status);

  const durations = computeDurations(gateEntryAt, firstWeightAt, secondWeightAt, releaseAt);

  return {
    id: row.id,
    source: 'DISPATCH_TRUCK',
    ticketNo: null,
    direction: 'OUTBOUND',
    materialType: 'ETHANOL',
    materialName: 'Ethanol',
    vehicleNo: row.vehicleNo,
    partyName: row.partyName,
    partyId: row.shipToCustomerId,
    gateEntryAt,
    firstWeightAt,
    secondWeightAt,
    releaseAt,
    grossWeight: row.weightGross,
    tareWeight: row.weightTare,
    netWeight: row.weightNet,
    status: mappedStatus,
    ...durations,
  };
}

// ──────────────────────────────────────────────────────────
// DDGSDispatchTruck → UnifiedWeighmentRow
// ──────────────────────────────────────────────────────────

export interface DDGSDispatchTruckRecord {
  id: string;
  rstNo: number | null;
  vehicleNo: string;
  partyName: string;
  weightGross: number;
  weightTare: number;
  weightNet: number;
  gateInTime: Date | null;
  tareTime: Date | null;
  grossTime: Date | null;
  releaseTime: Date | null;
  status: string;
  customerId: string | null;
  createdAt: Date;
}

export function normalizeDDGSDispatchTruck(row: DDGSDispatchTruckRecord): UnifiedWeighmentRow {
  const gateEntryAt = row.gateInTime ? row.gateInTime.toISOString() : row.createdAt.toISOString();
  const firstWeightAt = row.tareTime ? row.tareTime.toISOString() : null;
  const secondWeightAt = row.grossTime ? row.grossTime.toISOString() : null;
  const releaseAt = row.releaseTime ? row.releaseTime.toISOString() : null;

  const mappedStatus = mapDispatchStatus(row.status);

  const durations = computeDurations(gateEntryAt, firstWeightAt, secondWeightAt, releaseAt);

  return {
    id: row.id,
    source: 'DDGS_TRUCK',
    ticketNo: row.rstNo,
    direction: 'OUTBOUND',
    materialType: 'DDGS',
    materialName: 'DDGS',
    vehicleNo: row.vehicleNo,
    partyName: row.partyName,
    partyId: row.customerId,
    gateEntryAt,
    firstWeightAt,
    secondWeightAt,
    releaseAt,
    grossWeight: row.weightGross || null,
    tareWeight: row.weightTare || null,
    netWeight: row.weightNet || null,
    status: mappedStatus,
    ...durations,
  };
}
