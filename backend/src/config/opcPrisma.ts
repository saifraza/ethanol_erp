/**
 * OPC Prisma client — lazy singleton.
 *
 * The OPC database is separate from the main ERP database (DATABASE_URL_OPC).
 * Multiple routes and cron jobs query it; this module ensures there is exactly
 * one Prisma client per Node process so we're not opening/closing connection
 * pools on every request or every 3-minute watchdog tick.
 *
 * Callers must NOT call `.$disconnect()` on the returned client — it's shared.
 *
 * Usage:
 *   import { getOpcPrisma, isOpcAvailable } from '../config/opcPrisma';
 *   if (!isOpcAvailable()) return res.json({ tanks: [], opcOnline: false });
 *   const opc = getOpcPrisma();
 *   const rows = await opc.opcReading.findMany({ ... });
 */

let _opcPrisma: any = null;

export function isOpcAvailable(): boolean {
  return !!process.env.DATABASE_URL_OPC;
}

export function getOpcPrisma() {
  if (!_opcPrisma) {
    if (!process.env.DATABASE_URL_OPC) {
      throw new Error('DATABASE_URL_OPC not configured — OPC module disabled');
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/opc-client');
    _opcPrisma = new PrismaClient();
  }
  return _opcPrisma;
}
