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
interface Material { id: string; name: string; unit: string | null; category: string | null; hsnCode: string | null; gstPercent: number }
interface POLine { id: string; inventory_item_id: string | null; material_id: string | null; description: string; quantity: number; received_qty: number; pending_qty: number; rate: number; unit: string; hsn_code: string; gst_percent: number }
interface PO { id: string; po_no: number; vendor_name: string; vendor_id: string; status: string; deal_type: string; lines: POLine[] }
interface Trader { id: string; name: string; phone: string | null; productTypes: string | null; category: string | null }
interface Customer { id: string; name: string; shortName: string | null; gstNo: string | null; address: string | null; state: string | null; pincode: string | null }
interface EthContract { id: string; contractNo: string; contractType: string; buyerName: string; buyerGst: string | null; buyerAddress: string | null; conversionRate: number | null; ethanolRate: number | null; gstPercent: number | null; paymentTermsDays: number | null; omcDepot: string | null }
interface DdgsContract { id: string; contractNo: string; status: string; dealType: string; buyerName: string; buyerGstin: string | null; buyerAddress: string | null; buyerState: string | null; principalName: string | null; rate: number | null; processingChargePerMT: number | null; gstPercent: number | null; contractQtyMT: number | null; totalSuppliedMT: number | null; startDate: string | null; endDate: string | null }

interface MasterCache {
  suppliers: Supplier[];
  materials: Material[];
  pos: PO[];
  traders: Trader[];
  customers: Customer[];
  vehicles: string[];
  ethContracts: EthContract[];
  ddgsContracts: DdgsContract[];
  lastCloudSync: string | null;
  lastCloudCheck: string | null;
  cloudTimestamp: string | null;
  source: 'cloud' | 'disk' | 'empty';
}

const EMPTY_CACHE: MasterCache = {
  suppliers: [], materials: [], pos: [], traders: [], customers: [], vehicles: [], ethContracts: [], ddgsContracts: [],
  lastCloudSync: null, lastCloudCheck: null, cloudTimestamp: null, source: 'empty',
};

let cache: MasterCache = { ...EMPTY_CACHE };
let syncing = false;

// ── Public API ──

/** Get current cache (instant, < 1ms) */
export function getMasterData(): MasterCache {
  return cache;
}

/** Get cache stats */
export function getCacheStats() {
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
        (SELECT MAX("updatedAt") FROM "DDGSContract")
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
        select: { id: true, name: true, unit: true, category: true, hsnCode: true, gstPercent: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      cloud.purchaseOrder.findMany({
        where: {
          status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
          OR: [{ deliveryDate: null }, { deliveryDate: { gte: new Date() } }],
        },
        select: {
          id: true, poNo: true, vendorId: true, status: true, dealType: true,
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
        where: { isActive: true, isAgent: true },
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

    cache = {
      suppliers: vendors.map(v => ({ id: v.id, name: v.name, gstin: v.gstin, phone: v.phone })),
      materials: inventoryItems.map(m => ({ id: m.id, name: m.name, unit: m.unit, category: m.category, hsnCode: m.hsnCode, gstPercent: m.gstPercent })),
      pos: purchaseOrders.map(po => ({
        id: po.id,
        po_no: po.poNo,
        vendor_name: po.vendor.name,
        vendor_id: po.vendorId,
        status: po.status,
        deal_type: po.dealType,
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
      vehicles,
      lastCloudSync: now,
      lastCloudCheck: now,
      cloudTimestamp: cloudTs || now, // Use actual cloud timestamp to avoid unnecessary re-sync
      source: 'cloud',
    };

    saveToDisk();
    return true;
  } catch (err) {
    console.error('[CACHE] Full sync failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

async function smartSync() {
  if (syncing) return;
  syncing = true;

  try {
    // Quick ping: has anything changed?
    const cloudTs = await getCloudTimestamp();
    cache.lastCloudCheck = new Date().toISOString();

    if (cloudTs === null) {
      // Cloud unreachable — cache stays as-is (offline mode)
      return;
    }

    if (cloudTs === cache.cloudTimestamp) {
      // Nothing changed — skip full sync
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
