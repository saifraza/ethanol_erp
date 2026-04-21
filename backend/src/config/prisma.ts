import { PrismaClient } from '@prisma/client';
import { companyIdDefaultsMiddleware } from '../services/companyIdDefaults';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

// ── Middleware 1: companyId defaults ──────────────────────────────────────
// Fills in companyId = MSPIL_ID on every create/createMany/upsert-create for
// any model with a nullable companyId, when the caller didn't supply one.
// Registered synchronously so it sits FIRST in the middleware chain — the
// activity logger that registers later will see the filled-in companyId.
// See services/companyIdDefaults.ts for the full model list and rationale.
prisma.$use(companyIdDefaultsMiddleware);

// ── Middleware 2: activity log ────────────────────────────────────────────
// Captures CREATE/UPDATE/DELETE on a whitelist of high-value models (invoices,
// payments, POs, GRNs, master data, weighbridge, contracts). See
// services/activityLogger.ts for the model whitelist. Lazy-imported so the
// middleware module can import this same prisma instance for its own writes
// without a circular dep.
import('../services/activityLogger').then(m => {
  prisma.$use(m.activityLogMiddleware);
}).catch(err => {
  // Don't crash the server if the logger fails to load — it's auxiliary.
  console.error('[prisma] activity logger failed to load:', err instanceof Error ? err.message : err);
});

export default prisma;
