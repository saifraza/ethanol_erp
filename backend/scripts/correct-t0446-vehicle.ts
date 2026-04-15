/**
 * One-shot correction: T-0446 DDGS outbound (SHREE SEETA SOLVEX)
 * Change vehicleNo UP71281326 → UP71AT1336
 *
 * Safety verified 2026-04-15:
 *  - Invoice 235 exists but irn=null, ewbNo=null, ewayBill=null
 *  - Status = UNPAID, DDGSContractDispatch.status = DISPATCHED
 *  - Shipment not yet DELIVERED → safe to correct DDGS.vehicleNo
 *
 * Updates: Weighment mirror + DDGSDispatchTruck + DDGSContractDispatch snapshot
 * Pushes to factory-server /api/weighbridge/correction so reprint shows new vehicle.
 */
import prisma from '../src/config/prisma';
import { randomUUID } from 'crypto';
import { runAsCliUser } from '../src/services/requestContext';
import { flushActivityLogs } from '../src/services/activityLogger';

const WEIGHMENT_ID = 'e62bff2a-fb0b-404b-be26-8ce16f95251a';
const DDGS_ID = 'd07fca6b-4e29-447d-b701-ac2c2280e168';
const FACTORY_LOCAL_ID = 'e5d0d203-5006-432c-be08-79ee3a232814';
const TICKET_NO = 446;
const OLD_VEH = 'UP71281326';
const NEW_VEH = 'UP71AT1336';
const REASON = 'Vehicle number typo on printed slip — actual vehicle per handwritten correction is UP71AT1336 (operator entry error, invoice not yet e-invoiced/EWB)';

const FACTORY_URL = process.env.FACTORY_SERVER_URL || 'http://100.126.101.7:5000';
const WB_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

async function main() {
  const correctionId = randomUUID();

  const mirror = await prisma.weighment.findUnique({ where: { id: WEIGHMENT_ID } });
  const ddgs = await prisma.dDGSDispatchTruck.findUnique({ where: { id: DDGS_ID } });
  if (!mirror || !ddgs) throw new Error('Record not found');
  if (mirror.vehicleNo !== OLD_VEH || ddgs.vehicleNo !== OLD_VEH) {
    throw new Error(`Stale — mirror=${mirror.vehicleNo} ddgs=${ddgs.vehicleNo}`);
  }

  // Re-verify guards at runtime (defence in depth)
  const snap = await prisma.dDGSContractDispatch.findUnique({ where: { ddgsDispatchTruckId: DDGS_ID } });
  if (snap?.invoiceId) {
    const inv = await prisma.invoice.findUnique({
      where: { id: snap.invoiceId },
      select: { irn: true, ewbNo: true, ewayBill: true } as any,
    });
    if ((inv as any)?.irn) throw new Error('IRN already generated — cannot correct vehicle');
    if ((inv as any)?.ewbNo || (inv as any)?.ewayBill) throw new Error('EWB already generated — cancel EWB first');
  }

  const rawPayload = { ...(mirror.rawPayload as Record<string, unknown>), vehicleNo: NEW_VEH };
  const auditStamp = `[CORRECTION ${new Date().toISOString()} by Saif] vehicleNo ${OLD_VEH}→${NEW_VEH}. Reason: ${REASON}. correctionId=${correctionId}`;
  const newRemarks = ddgs.remarks ? `${ddgs.remarks} | ${auditStamp}` : auditStamp;

  await prisma.$transaction(async (tx) => {
    await tx.weighment.update({
      where: { id: WEIGHMENT_ID },
      data: { vehicleNo: NEW_VEH, rawPayload, mirrorVersion: { increment: 1 } },
    });

    await tx.dDGSDispatchTruck.update({
      where: { id: DDGS_ID },
      data: { vehicleNo: NEW_VEH, remarks: newRemarks },
    });

    if (snap && snap.vehicleNo !== NEW_VEH) {
      await tx.dDGSContractDispatch.update({ where: { id: snap.id }, data: { vehicleNo: NEW_VEH } });
    }
  });
  console.log(`[cloud] updated mirror + DDGS + dispatch snapshot (audit in remarks). correctionId=${correctionId}`);

  // Push to factory
  const resp = await fetch(`${FACTORY_URL}/api/weighbridge/correction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wb-key': WB_KEY },
    body: JSON.stringify({
      correctionIds: [correctionId],
      factoryLocalId: FACTORY_LOCAL_ID,
      ticketNo: TICKET_NO,
      vehicleNo: NEW_VEH,
      fields: { vehicleNo: NEW_VEH },
    }),
  });
  const result = await resp.json().catch(() => ({}));
  console.log(`[factory] HTTP ${resp.status}`, result);

  if (!resp.ok) {
    console.error('[factory] push FAILED — factory DB still has old vehicle. Investigate.');
    process.exit(2);
  }
  console.log('[factory] correction applied — reprint will show new vehicle.');
}

runAsCliUser('Saif', main)
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => {
    await flushActivityLogs();
    process.exit(0);
  });
