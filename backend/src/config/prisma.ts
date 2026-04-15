import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

// Activity log middleware — captures CREATE/UPDATE/DELETE on a whitelist of
// high-value models (invoices, payments, POs, GRNs, master data, weighbridge,
// contracts). See services/activityLogger.ts for the model whitelist.
// Lazy-imported (then) so the middleware module can import this same prisma
// instance for its own writes without a circular dep.
import('../services/activityLogger').then(m => {
  prisma.$use(m.activityLogMiddleware);
}).catch(err => {
  // Don't crash the server if the logger fails to load — it's auxiliary.
  console.error('[prisma] activity logger failed to load:', err instanceof Error ? err.message : err);
});

export default prisma;
