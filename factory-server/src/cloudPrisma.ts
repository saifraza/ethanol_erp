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

export default getCloudPrisma;
