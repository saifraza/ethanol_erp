import prisma from '../prisma';
import { config } from '../config';

// ==========================================================================
//  Background sync worker — pushes weighments to cloud, pulls master data
//  Runs automatically on interval; HTTP endpoints in sync.ts are manual triggers
// ==========================================================================

let _running = false;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _lastPushResult: { synced: number; failed: number; at: string } | null = null;
let _lastPullResult: { counts: Record<string, number>; at: string } | null = null;
let _consecutiveFailures = 0;

// ── Exponential backoff config ──
const BASE_INTERVAL_MS = 10_000;  // 10s when items pending
const IDLE_INTERVAL_MS = 60_000;  // 60s when nothing to sync
const MAX_BACKOFF_MS = 5 * 60_000; // 5 min max backoff on failures
const MASTER_DATA_INTERVAL_MS = 30_000; // pull master data every 30s (fast-poll until webhook push is set up)
let _lastMasterPull = 0;

/** Push unsynced weighments to cloud ERP. Returns { synced, failed }. */
export async function pushToCloud(): Promise<{ synced: number; failed: number }> {
  // Sync GATE_ENTRY (cloud creates truck record), COMPLETE (final weights),
  // FIRST_DONE inbound with lab results (so cloud lab page updates immediately),
  // and FIRST_DONE OUTBOUND **for DDGS only** — the cloud pre-phase has a stub
  // upsert path for DDGS (createOrUpdateDdgsTruckStub) but NOT for sugar / scrap
  // / other outbound products. Pushing non-DDGS partial states would clog the
  // sync queue with `Not in cloud response` failures because push.ts hits the
  // `status !== COMPLETE` skip and never acks them. Add new product categories
  // to this OR clause once their cloud handler grows a pre-phase stub.
  const unsynced = await prisma.weighment.findMany({
    where: {
      cloudSynced: false,
      OR: [
        { status: { in: ['GATE_ENTRY', 'COMPLETE'] } },
        { status: 'FIRST_DONE', direction: 'INBOUND', labStatus: { not: 'PENDING' } },
        {
          status: 'FIRST_DONE',
          direction: 'OUTBOUND',
          OR: [
            { materialCategory: 'DDGS' },
            { materialName: { contains: 'ddgs', mode: 'insensitive' } },
            { materialName: { contains: 'wdgs', mode: 'insensitive' } },
            { materialName: { contains: 'distillers', mode: 'insensitive' } },
          ],
        },
      ],
    },
    take: 20,
    orderBy: { createdAt: 'asc' },
  });

  if (unsynced.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  // Map factory-server DB fields to cloud weighmentSchema
  // Fields not in factory schema are omitted (cloud uses defaults)
  const cloudPayload = unsynced.map(w => ({
    id: w.localId,
    ticket_no: w.ticketNo || 0,
    vehicle_no: w.vehicleNo,
    direction: w.direction === 'INBOUND' ? 'IN' : 'OUT',
    purchase_type: w.purchaseType || 'PO',
    po_id: w.poId || null,
    po_line_id: w.poLineId || null,
    supplier_name: w.supplierName || '',
    supplier_id: w.supplierId || null,
    material: w.materialName || '',
    material_category: w.materialCategory || undefined,
    weight_gross: w.grossWeight,
    weight_tare: w.tareWeight,
    weight_net: w.netWeight,
    weight_source: 'factory-server',
    // Direction-agnostic timestamps. The factory captures whichever weighment
    // happens first (gross for inbound, tare for outbound) into firstWeightAt
    // and the second into secondWeightAt. The cloud DDGS handler maps
    // first_weight_at → tareTime and second_weight_at → grossTime, which is
    // correct for OUTBOUND. The previous mapping (grossTime → first_weight_at,
    // tareTime → second_weight_at) was inverted for outbound and produced the
    // wrong invoice date. Fall back to grossTime/tareTime per direction for
    // legacy rows that pre-date the firstWeightAt/secondWeightAt columns.
    first_weight_at: (w.firstWeightAt
      ?? (w.direction === 'OUTBOUND' ? w.tareTime : w.grossTime))?.toISOString(),
    second_weight_at: (w.secondWeightAt
      ?? (w.direction === 'OUTBOUND' ? w.grossTime : w.tareTime))?.toISOString(),
    status: w.status,
    bags: w.bags ?? null,
    remarks: [w.materialName, w.materialCategory, w.remarks].filter(Boolean).join(' | '),
    created_at: w.createdAt.toISOString(),
    // Lab fields
    lab_status: w.labStatus || undefined,
    lab_moisture: w.labMoisture ?? undefined,
    lab_starch: w.labStarch ?? undefined,
    lab_damaged: w.labDamaged ?? undefined,
    lab_foreign_matter: w.labForeignMatter ?? undefined,
    lab_remarks: w.labRemarks || undefined,
    // Spot purchase
    rate: w.rate ?? undefined,
    seller_phone: w.sellerPhone || undefined,
    seller_village: w.sellerVillage || undefined,
    // Driver/transporter (captured at gate entry, needed for cloud Shipment)
    transporter: w.transporter || undefined,
    driver_name: w.driverName || undefined,
    driver_mobile: w.driverPhone || undefined,
    vehicle_type: w.vehicleType || undefined,
    // Outbound overloads supplierName as customer
    customer_name: w.direction === 'OUTBOUND' ? (w.supplierName || undefined) : undefined,
    // Ethanol outbound: cloud DispatchTruck link + tanker data
    cloud_gate_pass_id: w.cloudGatePassId || undefined,
    // DDGS outbound: cloud DDGSContract picked at gate entry — cloud handler
    // prefers this over name-based contract resolution.
    cloud_contract_id: w.cloudContractId || undefined,
    quantity_bl: w.quantityBL ?? undefined,
    ethanol_strength: w.strength ?? undefined,
    seal_no: w.sealNo || undefined,
    rst_no: w.rstNo || undefined,
    driver_license: w.driverLicense || undefined,
    peso_date: w.pesoDate || undefined,
    // Ship-To snapshot (outbound only; null = same as Bill-To)
    ship_to_customer_id: w.shipToCustomerId || undefined,
    ship_to_name: w.shipToName || undefined,
    ship_to_gstin: w.shipToGstin || undefined,
    ship_to_address: w.shipToAddress || undefined,
    ship_to_state: w.shipToState || undefined,
    ship_to_pincode: w.shipToPincode || undefined,
  }));

  try {
    const response = await fetch(`${config.cloudErpUrl}/weighbridge/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WB-Key': config.cloudApiKey },
      body: JSON.stringify({ weighments: cloudPayload }),
    });

    if (response.ok) {
      const result = await response.json() as { ok: boolean; ids: string[]; count: number; processedWbIds?: string[] };
      if (result.ok && result.count > 0) {
        // NF-7 FIX: Per-item acknowledgment instead of batch-level
        const processedIds = new Set(result.processedWbIds || []);
        // Legacy ack only when the cloud response did NOT include the
        // `processedWbIds` key at all (old cloud version). An empty array
        // means "modern cloud processed 0 items" — DO NOT mark all synced.
        // Ghost-row incident 2026-04-09: empty-array → legacy path marked
        // 155 of 173 weighments as synced even though cloud dropped them.
        const useLegacyBatchAck = result.processedWbIds === undefined;
        for (const w of unsynced) {
          // Cloud payload sends id=localId, so processedWbIds contains localIds
          if (useLegacyBatchAck || processedIds.has(w.localId) || processedIds.has(w.id)) {
            await prisma.weighment.update({
              where: { id: w.id },
              data: { cloudSynced: true, cloudSyncedAt: new Date(), syncAttempts: w.syncAttempts + 1, cloudError: null },
            });
            synced++;
          } else {
            await prisma.weighment.update({
              where: { id: w.id },
              data: { cloudError: `Not in cloud response (${result.count}/${unsynced.length} processed)`, syncAttempts: w.syncAttempts + 1 },
            });
            failed++;
          }
        }
      } else {
        // Cloud returned ok but processed nothing — mark for retry
        for (const w of unsynced) {
          await prisma.weighment.update({
            where: { id: w.id },
            data: { cloudError: `Cloud processed 0/${unsynced.length}`, syncAttempts: w.syncAttempts + 1 },
          });
          failed++;
        }
      }
    } else {
      const errText = await response.text();
      for (const w of unsynced) {
        await prisma.weighment.update({
          where: { id: w.id },
          data: { cloudError: errText, syncAttempts: w.syncAttempts + 1 },
        });
      }
      failed = unsynced.length;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    for (const w of unsynced) {
      await prisma.weighment.update({
        where: { id: w.id },
        data: { cloudError: errMsg, syncAttempts: w.syncAttempts + 1 },
      });
    }
    failed = unsynced.length;
  }

  return { synced, failed };
}

// ==========================================================================
// RAW MIRROR PUSH — new Phase 2 path, complements the legacy pushToCloud()
// ==========================================================================
//
// Pushes raw Weighment rows to cloud POST /api/weighment/sync. The cloud
// endpoint upserts them into a passive `Weighment` mirror table by localId.
// No business logic — pure mirror for reports/audit.
//
// Runs ALONGSIDE pushToCloud() in the same sync cycle. Never blocks it.
// On error, logs and moves on. Idempotent — safe to re-run the same batch.
//
// Cursor strategy: in-memory `Date`, defaults to 7 days ago on startup.
// On successful batch, advances to the newest `updatedAt` seen. Survives
// cycles but resets on process restart → up to 7 days get re-pushed, which
// is safe because the cloud upsert is keyed by localId.
//
// No schema changes. No new dependencies. One outbound POST per cycle.

const RAW_MIRROR_BATCH = 200;
const RAW_MIRROR_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
let _rawMirrorCursor: Date = new Date(Date.now() - RAW_MIRROR_LOOKBACK_MS);
let _lastRawMirrorResult: { synced: number; failed: number; at: string } | null = null;

export async function pushRawToCloud(): Promise<{ synced: number; failed: number }> {
  const rows = await prisma.weighment.findMany({
    where: { updatedAt: { gt: _rawMirrorCursor } },
    orderBy: { updatedAt: 'asc' },
    take: RAW_MIRROR_BATCH,
  });

  if (rows.length === 0) return { synced: 0, failed: 0 };

  // Strip nulls — cloud Zod schema uses .optional() which rejects null
  // (only allows undefined). Factory row fields that are explicitly null
  // must be omitted from the JSON payload entirely.
  const cloudRows = rows.map(r => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) continue;
      if (v instanceof Date) {
        o[k] = v.toISOString();
      } else {
        o[k] = v;
      }
    }
    return o;
  });

  try {
    const response = await fetch(`${config.cloudErpUrl}/weighment/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WB-Key': config.cloudApiKey },
      body: JSON.stringify({ rows: cloudRows }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[RAW-MIRROR] Cloud ${response.status}: ${errText.slice(0, 300)}`);
      return { synced: 0, failed: rows.length };
    }

    const result = await response.json() as {
      ok: boolean;
      count: number;
      processedLocalIds: string[];
      failed: Array<{ localId: string; error: string }>;
    };

    const synced = result.processedLocalIds?.length || 0;
    const failed = result.failed?.length || 0;

    if (synced > 0) {
      // Advance cursor to the newest updatedAt among successful rows
      const successSet = new Set(result.processedLocalIds);
      let newestTs = _rawMirrorCursor.getTime();
      for (const r of rows) {
        if (successSet.has(r.localId)) {
          const ts = r.updatedAt.getTime();
          if (ts > newestTs) newestTs = ts;
        }
      }
      _rawMirrorCursor = new Date(newestTs);
    }

    if (failed > 0) {
      console.error(`[RAW-MIRROR] ${failed} row(s) rejected by cloud. First: ${JSON.stringify(result.failed[0])}`);
    }

    return { synced, failed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[RAW-MIRROR] Push threw: ${msg}`);
    return { synced: 0, failed: rows.length };
  }
}

export function getLastRawMirrorResult() {
  return _lastRawMirrorResult;
}

function setLastRawMirrorResult(r: { synced: number; failed: number }) {
  _lastRawMirrorResult = { ...r, at: new Date().toISOString() };
}

/** Pull master data from cloud ERP. */
export async function pullMasterData(): Promise<Record<string, number>> {
  const response = await fetch(`${config.cloudErpUrl}/weighbridge/master-data`, {
    headers: { 'X-WB-Key': config.cloudApiKey },
  });

  if (!response.ok) throw new Error(`Cloud returned ${response.status}`);

  const data = await response.json() as {
    suppliers: Array<{ id: string; name: string }>;
    materials: Array<{ id: string; name: string; category?: string }>;
    pos: Array<{
      id: string; po_no: number;
      vendor_id: string; vendor_name: string;
      deal_type: string; status: string;
      lines: Array<{
        id: string; inventory_item_id: string | null;
        description: string; quantity: number;
        received_qty: number; pending_qty: number;
        rate: number; unit: string;
      }>;
    }>;
    customers: Array<{ id: string; name: string; short_name?: string }>;
  };

  await prisma.$transaction(async (tx) => {
    for (const s of (data.suppliers || [])) {
      await tx.cachedSupplier.upsert({
        where: { id: s.id },
        create: { id: s.id, name: s.name },
        update: { name: s.name, updatedAt: new Date() },
      });
    }
    for (const m of (data.materials || [])) {
      await tx.cachedMaterial.upsert({
        where: { id: m.id },
        create: { id: m.id, name: m.name, category: m.category },
        update: { name: m.name, category: m.category, updatedAt: new Date() },
      });
    }
    for (const po of (data.pos || [])) {
      const firstLine = po.lines?.[0];
      await tx.cachedPurchaseOrder.upsert({
        where: { id: po.id },
        create: {
          id: po.id, poNumber: String(po.po_no),
          supplierName: po.vendor_name, supplierId: po.vendor_id,
          materialName: firstLine?.description || '',
          materialId: firstLine?.inventory_item_id || '',
          quantity: firstLine?.quantity || 0,
          receivedQty: firstLine?.received_qty || 0,
          rate: firstLine?.rate || 0,
          unit: firstLine?.unit || 'KG', status: po.status,
        },
        update: {
          poNumber: String(po.po_no), supplierName: po.vendor_name, supplierId: po.vendor_id,
          materialName: firstLine?.description || '',
          materialId: firstLine?.inventory_item_id || '',
          quantity: firstLine?.quantity || 0,
          receivedQty: firstLine?.received_qty || 0,
          rate: firstLine?.rate || 0,
          unit: firstLine?.unit || 'KG', status: po.status, updatedAt: new Date(),
        },
      });
    }
    for (const c of (data.customers || [])) {
      await tx.cachedCustomer.upsert({
        where: { id: c.id },
        create: { id: c.id, name: c.name },
        update: { name: c.name, updatedAt: new Date() },
      });
    }
  });

  return {
    suppliers: data.suppliers?.length || 0,
    materials: data.materials?.length || 0,
    purchaseOrders: data.pos?.length || 0,
    customers: data.customers?.length || 0,
  };
}

/** Single sync cycle — push weighments + optionally pull master data. */
async function syncCycle(): Promise<void> {
  if (_running) return; // skip if previous cycle still running
  _running = true;

  try {
    // Push weighments (legacy path — still drives GRN/inventory/accounting)
    const pushResult = await pushToCloud();
    _lastPushResult = { ...pushResult, at: new Date().toISOString() };

    if (pushResult.synced > 0 || pushResult.failed > 0) {
      console.log(`[SYNC-WORKER] Push: ${pushResult.synced} synced, ${pushResult.failed} failed`);
    }

    // Push raw rows to cloud mirror (Phase 2 — passive, no business logic).
    // Wrapped separately so any failure never impacts the legacy push path.
    try {
      const rawResult = await pushRawToCloud();
      setLastRawMirrorResult(rawResult);
      if (rawResult.synced > 0 || rawResult.failed > 0) {
        console.log(`[SYNC-WORKER] Raw mirror: ${rawResult.synced} synced, ${rawResult.failed} failed`);
      }
    } catch (err) {
      console.error(`[SYNC-WORKER] Raw mirror push crashed: ${err instanceof Error ? err.message : err}`);
    }

    // Pull master data periodically
    const now = Date.now();
    if (now - _lastMasterPull > MASTER_DATA_INTERVAL_MS) {
      try {
        const counts = await pullMasterData();
        _lastPullResult = { counts, at: new Date().toISOString() };
        _lastMasterPull = now;
      } catch (err) {
        console.error(`[SYNC-WORKER] Master pull failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Reset backoff on success
    if (pushResult.failed === 0) {
      _consecutiveFailures = 0;
    } else {
      _consecutiveFailures++;
    }
  } catch (err) {
    _consecutiveFailures++;
    console.error(`[SYNC-WORKER] Cycle error: ${err instanceof Error ? err.message : err}`);
  } finally {
    _running = false;
    // Schedule next cycle with adaptive interval
    scheduleNext();
  }
}

/** Schedule next sync with exponential backoff on failures. */
function scheduleNext(): void {
  if (_intervalId) { clearTimeout(_intervalId); _intervalId = null; }

  let delayMs: number;
  if (_consecutiveFailures > 0) {
    // Exponential backoff: 10s, 20s, 40s, 80s, ... capped at 5min
    delayMs = Math.min(BASE_INTERVAL_MS * Math.pow(2, _consecutiveFailures - 1), MAX_BACKOFF_MS);
  } else {
    // Check if there are pending items
    delayMs = BASE_INTERVAL_MS; // will be overridden after check
  }

  _intervalId = setTimeout(async () => {
    // Quick check: any pending?
    const pending = await prisma.weighment.count({
      where: { cloudSynced: false, status: { in: ['GATE_ENTRY', 'FIRST_DONE', 'COMPLETE'] } },
    }).catch(() => 0);

    if (pending === 0 && _consecutiveFailures === 0) {
      // Nothing to do — sleep longer
      _intervalId = setTimeout(syncCycle, IDLE_INTERVAL_MS);
    } else {
      syncCycle();
    }
  }, delayMs);
}

/** Start the background sync worker. Call once at server startup. */
export function startSyncWorker(): void {
  console.log('[SYNC-WORKER] Starting background sync (push every 10s, master data every 5min)');
  // Initial sync after 5s delay (let server finish starting)
  _intervalId = setTimeout(syncCycle, 5000);
}

/** Stop the background sync worker. */
export function stopSyncWorker(): void {
  if (_intervalId) { clearTimeout(_intervalId); _intervalId = null; }
  _running = false;
}

/** Get sync worker status (for health/status endpoints). */
export function getSyncWorkerStatus() {
  return {
    running: _running,
    consecutiveFailures: _consecutiveFailures,
    lastPush: _lastPushResult,
    lastPull: _lastPullResult,
  };
}
