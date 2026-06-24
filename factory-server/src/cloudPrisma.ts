// Cloud DB client — READ-ONLY connection to Railway PostgreSQL
// Used to query POs, vendors, materials, customers directly
// instead of relying on cached/synced copies.
//
// NEVER use this for writes — cloud DB is managed by the main ERP.

import { PrismaClient } from '../node_modules/.prisma/cloud-client';

let cloudPrisma: PrismaClient | null = null;

export function getCloudPrisma(): PrismaClient | null {
  if (cloudPrisma) return cloudPrisma;

  const url = process.env.CLOUD_DATABASE_URL;
  if (!url) {
    console.warn('[CLOUD-DB] CLOUD_DATABASE_URL not set — cloud queries disabled, falling back to cached data');
    return null;
  }

  cloudPrisma = new PrismaClient({
    datasources: { db: { url } },
    log: ['error'],
  });

  console.log('[CLOUD-DB] Connected to Railway PostgreSQL (read-only)');
  return cloudPrisma;
}

/**
 * Drop the current cloud client so the next getCloudPrisma() dials a FRESH
 * connection. Use when the client is stuck on a dead socket: Prisma can keep
 * reporting "Can't reach database server" even while the host is TCP-reachable,
 * because a long-lived pooled connection died (Railway proxy recycle, NAT idle
 * reap, brief blip) and the engine never redials on its own. A long-running
 * factory process then stays blind to cloud master data until a human restart.
 * Rebuilding the client self-heals it.
 * (Root cause of the 2026-06-24 "new POs invisible at the gate" incident — a
 * 10-day-old process whose client was stuck while TCP to the DB tested True.)
 */
export async function resetCloudPrisma(): Promise<void> {
  const stale = cloudPrisma;
  cloudPrisma = null; // next getCloudPrisma() reconnects
  if (stale) {
    try { await stale.$disconnect(); } catch { /* already dead — ignore */ }
    console.warn('[CLOUD-DB] Cloud client reset — next query will reconnect');
  }
}

export default getCloudPrisma;
