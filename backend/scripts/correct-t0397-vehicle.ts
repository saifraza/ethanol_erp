/**
 * One-shot correction: T-0397 DDGS outbound
 * Change vehicleNo MP06HH4218 → MP09HH4218
 *
 * Updates: Weighment mirror + DDGSDispatchTruck + WeighmentCorrection audit row
 * Pushes to factory-server /api/weighbridge/correction so reprint shows new vehicle.
 */
import prisma from '../src/config/prisma';
import { randomUUID } from 'crypto';

const WEIGHMENT_ID = '29702edb-b998-4229-baca-3b3591385836';
const DDGS_ID = '24216767-4131-47e1-a1e1-3c076c10fbb8';
const FACTORY_LOCAL_ID = 'ea94fc9a-d87d-4fc2-b956-147af4ebe589';
const TICKET_NO = 397;
const OLD_VEH = 'MP06HH4218';
const NEW_VEH = 'MP09HH4218';
const REASON = 'Vehicle number typo on printed slip — MP06 should be MP09 (operator entry error)';

const FACTORY_URL = process.env.FACTORY_SERVER_URL || 'http://100.126.101.7:5000';
const WB_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

async function main() {
  const correctionId = randomUUID();

  // Sanity check current state
  const mirror = await prisma.weighment.findUnique({ where: { id: WEIGHMENT_ID } });
  const ddgs = await prisma.dDGSDispatchTruck.findUnique({ where: { id: DDGS_ID } });
  if (!mirror || !ddgs) throw new Error('Record not found');
  if (mirror.vehicleNo !== OLD_VEH || ddgs.vehicleNo !== OLD_VEH) {
    throw new Error(`Stale — mirror=${mirror.vehicleNo} ddgs=${ddgs.vehicleNo}`);
  }

  const rawPayload = { ...(mirror.rawPayload as Record<string, unknown>), vehicleNo: NEW_VEH };

  // NOTE: WeighmentCorrection cloud audit table has FK to GrainTruck only (skill Phase 1 scope).
  // DDGS corrections log via: DDGS.remarks append + factory WeighmentCorrectionLog (no FK).
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

    // If truck is already billed, DDGSContractDispatch has a snapshot copy
    const snap = await tx.dDGSContractDispatch.findUnique({ where: { ddgsDispatchTruckId: DDGS_ID } });
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

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
