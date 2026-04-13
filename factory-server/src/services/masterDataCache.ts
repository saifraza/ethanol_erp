/**
 * In-Memory Master Data Cache
 *
 * All master data (suppliers, materials, POs, traders, customers) lives in memory.
 * - Gate entry reads from memory (< 1ms, works offline)
 * - 5-second smart sync pings cloud for changes
 * - Disk backup (JSON file) survives server restarts
 * - On startup: load from disk → then sync from cloud
 */

import fs from 'fs';
import path from 'path';
import { getCloudPrisma } from '../cloudPrisma';

const CACHE_FILE = path.join(__dirname, '..', '..', 'data', 'master-cache.json');
const SYNC_INTERVAL_MS = 5000; // 5 seconds
let syncTimer: ReturnType<typeof setInterval> | null = null;

// ── The Cache ──
interface Supplier { id: string; name: string; gstin: string | null; phone: string | null }
interface Material { id: string; name: string; unit: string | null; category: string | null; hsnCode: string | null; gstPercent: number; division: string | null; aliases: string[]; handlerKey: string | null; isContractBased: boolean; needsLabTest: boolean }
interface POLine { id: string; inventory_item_id: string | null; material_id: string | null; description: string; quantity: number; received_qty: number; pending_qty: number; rate: number; unit: string; hsn_code: string; gst_percent: number }
interface PO { id: string; po_no: number; vendor_name: string; vendor_id: string; status: string; deal_type: string; company_id: string | null; lines: POLine[] }
interface Trader { id: string; name: string; phone: string | null; productTypes: string | null; category: string | null }
interface Customer { id: string; name: string; shortName: string | null; gstNo: string | null; address: string | null; state: string | null; pincode: string | null }
interface EthContract { id: string; contractNo: string; contractType: string; buyerName: string; buyerGst: string | null; buyerAddress: string | null; conversionRate: number | null; ethanolRate: number | null; gstPercent: number | null; paymentTermsDays: number | null; omcDepot: string | null }
interface DdgsContract { id: string; contractNo: string; status: string; dealType: string; buyerName: string; buyerGstin: string | null; buyerAddress: string | null; buyerState: string | null; principalName: string | null; rate: number | null; processingChargePerMT: number | null; gstPercent: number | null; contractQtyMT: number | null; totalSuppliedMT: number | null; startDate: string | null; endDate: string | null }
interface ScrapSalesOrder { id: string; entryNo: number; buyerName: string; productName: string; rate: number; unit: string; validFrom: string | null; validTo: string | null; status: string; quantity: number; totalSuppliedQty: number }
interface Company { id: string; code: string; name: string; shortName: string | null; isDefault: boolean }

interface MasterCache {
  suppliers: Supplier[];
  materials: Material[];
  pos: PO[];
  traders: Trader[];
  customers: Customer[];
  vehicles: string[];
  ethContracts: EthContract[];
  ddgsContracts: DdgsContract[];
  scrapOrders: ScrapSalesOrder[];
  companies: Company[];
  outboundProducts: string[];
  lastCloudSync: string | null;
  lastCloudCheck: string | null;
  cloudTimestamp: string | null;
  source: 'cloud' | 'disk' | 'empty';
}

// Default outbound product types — used as fallback if cloud doesn't provide them.
// Single source of truth for the gate entry dropdown (was hardcoded in GateEntry.tsx).
// Sugar excluded — separate weighbridge system (not routed through this one)
const DEFAULT_OUTBOUND_PRODUCTS = ['DDGS', 'Ethanol', 'Scrap', 'Press Mud', 'LFO', 'HFO', 'Ash', 'Other'];

const EMPTY_CACHE: MasterCache = {
  suppliers: [], materials: [], pos: [], traders: [], customers: [], vehicles: [], ethContracts: [], ddgsContracts: [], scrapOrders: [], companies: [],
  outboundProducts: DEFAULT_OUTBOUND_PRODUCTS,
  lastCloudSync: null, lastCloudCheck: null, cloudTimestamp: null, source: 'empty',
};

let cache: MasterCache = { ...EMPTY_CACHE };
let syncing = false;

// ── Public API ──

/** Get current cache (instant, < 1ms) */
export function getMasterData(): MasterCache {
  return cache;
}

/**
 * Cache is considered stale if the last successful CLOUD CHECK is older than this.
 *
 * IMPORTANT: staleness is based on `lastCloudCheck`, NOT `lastCloudSync`.
 *
 *   lastCloudCheck = most recent successful ping to cloud (every 5s via smartSync).
 *   lastCloudSync  = most recent time cloud data ACTUALLY CHANGED and we pulled it.
 *
 * If nothing has been edited on cloud for 10 minutes, `lastCloudSync` is 10 min old
 * but the system is perfectly healthy — sync is still running, cache is still
 * authoritative. Using `lastCloudSync` here produced false-positive "stale" banners
 * during quiet periods (incident: 2026-04-08 — operators ignored the warning because
 * it showed up constantly, defeating the purpose of the alert).
 *
 * We use `lastCloudCheck` so the banner only fires when the cloud ping itself has
 * been failing — which is the actual condition operators need to know about.
 *
 * Threshold is 2 minutes (not 5) because the sync runs every 5 seconds. 2 minutes
 * of failed checks = ~24 consecutive failures = definitely a real problem.
 */
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes of failed cloud checks

/** Get cache stats including staleness */
export function getCacheStats() {
  // Use lastCloudCheck (ping success), NOT lastCloudSync (data change).
  // See STALE_THRESHOLD_MS comment above.
  const lastCheckMs = cache.lastCloudCheck ? new Date(cache.lastCloudCheck).getTime() : 0;
  const ageMs = lastCheckMs > 0 ? Date.now() - lastCheckMs : null;
  const isStale = ageMs == null || ageMs > STALE_THRESHOLD_MS;
  return {
    source: cache.source,
    suppliers: cache.suppliers.length,
    materials: cache.materials.length,
    pos: cache.pos.length,
    traders: cache.traders.length,
    customers: cache.customers.length,
    vehicles: cache.vehicles.length,
    lastCloudSync: cache.lastCloudSync,
    lastCloudCheck: cache.lastCloudCheck,
    ageMs,
    ageMinutes: ageMs != null ? Math.floor(ageMs / 60000) : null,
    isStale,
    staleThresholdMs: STALE_THRESHOLD_MS,
  };
}

// ── Disk Persistence ──

function saveToDisk() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Atomic write: temp file then rename (survives power loss)
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf-8');
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    console.error('[CACHE] Failed to save to disk:', err instanceof Error ? err.message : err);
  }
}

function loadFromDisk(): boolean {
  try {
    if (!fs.existsSync(CACHE_FILE)) return false;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw) as MasterCache;
    if (data.suppliers && data.materials && data.pos) {
      // Ensure all arrays exist (handles schema evolution)
      data.traders = data.traders || [];
      data.customers = data.customers || [];
      data.vehicles = data.vehicles || [];
      data.ethContracts = data.ethContracts || [];
      data.ddgsContracts = data.ddgsContracts || [];
      data.scrapOrders = data.scrapOrders || [];
      data.companies = data.companies || [];
      data.outboundProducts = data.outboundProducts || DEFAULT_OUTBOUND_PRODUCTS;
      // Stage 2 schema evolution: backfill new Material fields on cached entries
      data.materials = (data.materials || []).map(m => ({
        ...m,
        division: (m as any).division ?? null,
        aliases: Array.isArray((m as any).aliases) ? (m as any).aliases : [],
        handlerKey: (m as any).handlerKey ?? null,
        isContractBased: (m as any).isContractBased ?? false,
        needsLabTest: (m as any).needsLabTest ?? false,
      }));
      cache = { ...data, source: 'disk' };
      console.log(`[CACHE] Loaded from disk: ${cache.suppliers.length} suppliers, ${cache.materials.length} materials, ${cache.pos.length} POs, ${cache.traders.length} traders`);
      return true;
    }
  } catch (err) {
    console.error('[CACHE] Failed to load from disk:', err instanceof Error ? err.message : err);
  }
  return false;
}

// ── Cloud Sync ──

async function getCloudTimestamp(): Promise<string | null> {
  const cloud = getCloudPrisma();
  if (!cloud) return null;
  try {
    const result = await cloud.$queryRaw<Array<{ max: Date | null }>>`
      SELECT GREATEST(
        (SELECT MAX("updatedAt") FROM "PurchaseOrder"),
        (SELECT MAX("updatedAt") FROM "Vendor"),
        (SELECT MAX("updatedAt") FROM "InventoryItem"),
        (SELECT MAX("updatedAt") FROM "Customer"),
        (SELECT MAX("updatedAt") FROM "EthanolContract"),
        (SELECT MAX("updatedAt") FROM "DDGSContract"),
        (SELECT MAX("updatedAt") FROM "DirectSale")
      ) as max
    `;
    return result[0]?.max?.toISOString() || null;
  } catch {
    return null;
  }
}

async function fullSyncFromCloud(cloudTs?: string | null): Promise<boolean> {
  const cloud = getCloudPrisma();
  if (!cloud) return false;

  try {
    const [vendors, inventoryItems, purchaseOrders, customers, traderVendors]: [any[], any[], any[], any[], any[]] = await Promise.all([
      cloud.vendor.findMany({
        where: { isActive: true },
        select: { id: true, name: true, gstin: true, phone: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      cloud.inventoryItem.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, unit: true, category: true, hsnCode: true, gstPercent: true,
          division: true, aliases: true, handlerKey: true, isContractBased: true, needsLabTest: true,
        },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      cloud.purchaseOrder.findMany({
        where: {
          status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
          OR: [{ deliveryDate: null }, { deliveryDate: { gte: new Date() } }],
        },
        select: {
          id: true, poNo: true, vendorId: true, status: true, dealType: true, companyId: true,
          vendor: { select: { id: true, name: true } },
          lines: {
            select: {
              id: true, inventoryItemId: true, materialId: true, description: true,
              quantity: true, receivedQty: true, pendingQty: true, rate: true,
              unit: true, hsnCode: true, gstPercent: true,
            },
          },
        },
        orderBy: { poNo: 'desc' },
        take: 200,
      }),
      cloud.customer.findMany({
        where: { isActive: true },
        select: { id: true, name: true, shortName: true, gstNo: true, address: true, state: true, pincode: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      cloud.vendor.findMany({
        where: { isActive: true, OR: [{ isAgent: true }, { category: 'TRADER' }] },
        select: { id: true, name: true, phone: true, productTypes: true, category: true },
        orderBy: { name: 'asc' },
        take: 100,
      }),
    ]);

    // Ethanol contracts — separate query with own error handling (won't break other data)
    let ethContracts: EthContract[] = cache.ethContracts; // keep existing on failure
    try {
      ethContracts = await cloud.$queryRawUnsafe<EthContract[]>(
        `SELECT id, "contractNo", "contractType", "buyerName", "buyerGst", "buyerAddress",
                "conversionRate", "ethanolRate", "gstPercent", "paymentTermsDays", "omcDepot"
         FROM "EthanolContract" WHERE status = 'ACTIVE' ORDER BY "contractNo" LIMIT 50`
      );
      console.log(`[CACHE] Ethanol contracts: ${ethContracts.length}`);
    } catch (err) {
      console.error('[CACHE] Ethanol contracts sync failed:', err instanceof Error ? err.message : err);
    }

    // DDGS contracts — separate query with own error handling
    let ddgsContracts: DdgsContract[] = cache.ddgsContracts; // keep existing on failure
    try {
      const rows = await cloud.$queryRawUnsafe<any[]>(
        `SELECT id, "contractNo", status, "dealType", "buyerName", "buyerGstin", "buyerAddress", "buyerState",
                "principalName", rate, "processingChargePerMT", "gstPercent", "contractQtyMT", "totalSuppliedMT",
                "startDate", "endDate"
         FROM "DDGSContract"
         WHERE status = 'ACTIVE' AND "endDate" >= NOW() AND "startDate" <= NOW()
         ORDER BY "contractNo" LIMIT 50`
      );
      ddgsContracts = rows.map(r => ({
        id: r.id,
        contractNo: r.contractNo,
        status: r.status,
        dealType: r.dealType,
        buyerName: r.buyerName,
        buyerGstin: r.buyerGstin,
        buyerAddress: r.buyerAddress,
        buyerState: r.buyerState,
        principalName: r.principalName,
        rate: r.rate != null ? Number(r.rate) : null,
        processingChargePerMT: r.processingChargePerMT != null ? Number(r.processingChargePerMT) : null,
        gstPercent: r.gstPercent != null ? Number(r.gstPercent) : null,
        contractQtyMT: r.contractQtyMT != null ? Number(r.contractQtyMT) : null,
        totalSuppliedMT: r.totalSuppliedMT != null ? Number(r.totalSuppliedMT) : null,
        startDate: r.startDate ? new Date(r.startDate).toISOString() : null,
        endDate: r.endDate ? new Date(r.endDate).toISOString() : null,
      }));
      console.log(`[CACHE] DDGS contracts: ${ddgsContracts.length}`);
    } catch (err) {
      console.error('[CACHE] DDGS contracts sync failed:', err instanceof Error ? err.message : err);
    }

    // Scrap sales orders — separate query with own error handling
    let scrapOrders: ScrapSalesOrder[] = cache.scrapOrders;
    try {
      const rows = await cloud.$queryRawUnsafe<any[]>(
        `SELECT id, "entryNo", "buyerName", "productName", rate, unit,
                "validFrom", "validTo", status, quantity, "totalSuppliedQty"
         FROM "DirectSale"
         WHERE status = 'ACTIVE' AND ("validTo" IS NULL OR "validTo" >= NOW())
         ORDER BY "entryNo" DESC LIMIT 50`
      );
      scrapOrders = rows.map(r => ({
        id: r.id,
        entryNo: Number(r.entryNo),
        buyerName: r.buyerName,
        productName: r.productName,
        rate: r.rate != null ? Number(r.rate) : 0,
        unit: r.unit || 'KG',
        validFrom: r.validFrom ? new Date(r.validFrom).toISOString() : null,
        validTo: r.validTo ? new Date(r.validTo).toISOString() : null,
        status: r.status,
        quantity: r.quantity != null ? Number(r.quantity) : 0,
        totalSuppliedQty: r.totalSuppliedQty != null ? Number(r.totalSuppliedQty) : 0,
      }));
      console.log(`[CACHE] Scrap orders: ${scrapOrders.length}`);
    } catch (err) {
      console.error('[CACHE] Scrap orders sync failed:', err instanceof Error ? err.message : err);
    }

    // Companies — separate query with own error handling
    let companies: Company[] = cache.companies;
    try {
      const rows = await cloud.company.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true, shortName: true, isDefault: true },
        orderBy: { code: 'asc' },
        take: 50,
      });
      companies = rows.map(r => ({ id: r.id, code: r.code, name: r.name, shortName: r.shortName, isDefault: r.isDefault }));
      console.log(`[CACHE] Companies: ${companies.length}`);
    } catch (err) {
      console.error('[CACHE] Companies sync failed:', err instanceof Error ? err.message : err);
    }

    // Get recent vehicles from local DB
    let vehicles: string[] = cache.vehicles; // Keep existing if local query fails
    try {
      const { default: prisma } = await import('../prisma');
      const recentVehicles = await prisma.weighment.findMany({
        select: { vehicleNo: true },
        distinct: ['vehicleNo'],
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      vehicles = recentVehicles.map(v => v.vehicleNo);
    } catch { /* keep existing */ }

    const now = new Date().toISOString();

    // Derive outbound products from InventoryItems that have an outbound handlerKey.
    // Falls back to DEFAULT_OUTBOUND_PRODUCTS if no items are flagged yet (silent switch).
    const outboundFromMaster = inventoryItems
      .filter((m: any) => m.handlerKey && String(m.handlerKey).endsWith('_OUTBOUND'))
      .map((m: any) => m.name as string);
    const outboundProducts = outboundFromMaster.length > 0
      ? [...new Set([...outboundFromMaster, 'Other'])]
      : DEFAULT_OUTBOUND_PRODUCTS;

    cache = {
      suppliers: vendors.map(v => ({ id: v.id, name: v.name, gstin: v.gstin, phone: v.phone })),
      materials: inventoryItems.map(m => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        category: m.category,
        hsnCode: m.hsnCode,
        gstPercent: m.gstPercent,
        division: m.division ?? null,
        aliases: Array.isArray(m.aliases) ? m.aliases : [],
        handlerKey: m.handlerKey ?? null,
        isContractBased: m.isContractBased ?? false,
        needsLabTest: m.needsLabTest ?? false,
      })),
      pos: purchaseOrders.map(po => ({
        id: po.id,
        po_no: po.poNo,
        vendor_name: po.vendor.name,
        vendor_id: po.vendorId,
        status: po.status,
        deal_type: po.dealType,
        company_id: po.companyId || null,
        lines: po.lines.map((l: any) => ({
          id: l.id,
          inventory_item_id: l.inventoryItemId,
          material_id: l.materialId,
          description: l.description,
          quantity: l.quantity,
          received_qty: l.receivedQty,
          pending_qty: l.pendingQty,
          rate: l.rate,
          unit: l.unit,
          hsn_code: l.hsnCode || '',
          gst_percent: l.gstPercent,
        })),
      })),
      traders: traderVendors.map(t => ({ id: t.id, name: t.name, phone: t.phone, productTypes: t.productTypes, category: t.category })),
      customers: customers.map(c => ({ id: c.id, name: c.name, shortName: c.shortName, gstNo: c.gstNo, address: c.address, state: c.state, pincode: c.pincode })),
      ethContracts: ethContracts.map(c => ({ id: c.id, contractNo: c.contractNo, contractType: c.contractType, buyerName: c.buyerName, buyerGst: c.buyerGst, buyerAddress: c.buyerAddress, conversionRate: c.conversionRate, ethanolRate: c.ethanolRate, gstPercent: c.gstPercent, paymentTermsDays: c.paymentTermsDays, omcDepot: c.omcDepot })),
      ddgsContracts,
      scrapOrders,
      companies,
      outboundProducts,
      vehicles,
      lastCloudSync: now,
      lastCloudCheck: now,
      cloudTimestamp: cloudTs || now, // Use actual cloud timestamp to avoid unnecessary re-sync
      source: 'cloud',
    };

    // Integrity check: detect duplicate material names with conflicting categories.
    // A human editing the cloud master can create two rows for the same material
    // (e.g. "Rice Husk" as RAW_MATERIAL and "RICE HUSK" as FUEL). Case-insensitive
    // name lookup is non-deterministic — operators would get the wrong category
    // roulette-style. We log loud so the wrong row gets fixed before it causes damage.
    const byName = new Map<string, { name: string; category: string | null }[]>();
    for (const m of cache.materials) {
      const k = (m.name || '').trim().toLowerCase();
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k)!.push({ name: m.name, category: m.category });
    }
    for (const [k, items] of byName.entries()) {
      if (items.length > 1) {
        const cats = new Set(items.map(i => i.category));
        if (cats.size > 1) {
          console.error(`[CACHE] ⚠ DUPLICATE MATERIAL NAME WITH CONFLICTING CATEGORIES: "${k}" → ${items.map(i => `${i.name} [${i.category}]`).join(' | ')}. Fix in cloud InventoryItem master — weighbridge category routing is non-deterministic until resolved.`);
        }
      }
    }

    saveToDisk();
    return true;
  } catch (err) {
    console.error('[CACHE] Full sync failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

// Track consecutive ping failures so we can alert loud when it's real.
let consecutiveCheckFailures = 0;
const ALERT_AFTER_FAILURES = 24; // ~2 min at 5s intervals

async function smartSync() {
  if (syncing) return;
  syncing = true;

  try {
    // Quick ping: has anything changed?
    const cloudTs = await getCloudTimestamp();

    if (cloudTs === null) {
      // Cloud unreachable — ping failed. DO NOT update lastCloudCheck.
      // Staleness check depends on lastCloudCheck; updating it on failure
      // would silently paper over real outages.
      consecutiveCheckFailures++;
      if (consecutiveCheckFailures === ALERT_AFTER_FAILURES) {
        console.error(`[CACHE] ⚠ CLOUD PING FAILED ${ALERT_AFTER_FAILURES} TIMES IN A ROW (~2 min). Master-data cache is going stale. Check cloud reachability.`);
      }
      return;
    }

    // Ping succeeded — update check timestamp and reset failure counter.
    cache.lastCloudCheck = new Date().toISOString();
    if (consecutiveCheckFailures > 0) {
      console.log(`[CACHE] ✓ Cloud ping recovered after ${consecutiveCheckFailures} failures`);
      consecutiveCheckFailures = 0;
    }

    if (cloudTs === cache.cloudTimestamp) {
      // Nothing changed on cloud — skip full sync. This is HEALTHY, not stale.
      return;
    }

    // Something changed — do full sync
    console.log('[CACHE] Cloud data changed, syncing...');
    const ok = await fullSyncFromCloud(cloudTs);
    if (ok) {
      console.log(`[CACHE] Synced: ${cache.pos.length} POs, ${cache.traders.length} traders`);
    }
  } catch (err) {
    console.error('[CACHE] Smart sync error:', err instanceof Error ? err.message : err);
  } finally {
    syncing = false;
  }
}

/** Expose failure count for monitoring endpoints */
export function getConsecutiveCheckFailures(): number {
  return consecutiveCheckFailures;
}

// ── Lifecycle ──

/** Initialize cache: load from disk, then start sync loop */
export async function initMasterDataCache() {
  // Step 1: Load from disk (instant, for immediate availability)
  const loaded = loadFromDisk();
  if (!loaded) console.log('[CACHE] No disk cache found, will sync from cloud');

  // Step 2: Try immediate cloud sync
  const synced = await fullSyncFromCloud();
  if (synced) {
    console.log('[CACHE] Initial cloud sync complete');
  } else if (loaded) {
    console.log('[CACHE] Cloud unavailable, using disk cache');
  } else {
    console.log('[CACHE] No cache available — gate entry will show empty until cloud connects');
  }

  // Step 3: Start 5-second smart sync loop
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(smartSync, SYNC_INTERVAL_MS);
  console.log(`[CACHE] Smart sync started (every ${SYNC_INTERVAL_MS / 1000}s)`);
}

/** Stop the sync loop */
export function stopMasterDataCache() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}
