/**
 * One-shot migration: align every device user_id with the numeric part of
 * the ERP empCode/workerCode. Fixes the off-by-one supervisors were hitting
 * — 336/544 active employees had empNo ≠ MS-NNN-numeric, so reading "309"
 * on the device and searching "MS-309" in the ERP landed on the wrong row.
 *
 * After this:
 *   MS-308 (any empNo)  → device id "308"
 *   LW-014 (any workerNo) → device id "L14"
 * ERP remains the source of truth — empCode/workerCode are unchanged.
 *
 * Steps:
 *   1. Stop factory-server (pause autoPush so it doesn't race us)
 *   2. Wipe ALL user records on each device (parallel, retry on silent-fail)
 *   3. Update cloud Employee.deviceUserId  = numeric(empCode) for active MS-*
 *      Update cloud LaborWorker.deviceUserId = 'L' || numeric(workerCode) for active LW-*
 *   4. Restart factory-server
 *   5. AutoPush rebuilds every device user with the new aligned ids (~5 min)
 *
 * Safe because all fingerprints/face templates were already wiped on
 * 2026-05-08 cleanup ceremony — full re-enrollment was already planned.
 *
 * Usage:
 *   tsx backend/scripts/realign-device-userids-to-empcode.ts             # dry-run
 *   tsx backend/scripts/realign-device-userids-to-empcode.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const FACTORY_HOST = '100.126.101.7';
const FACTORY_USER = 'Administrator';
const FACTORY_PASS = 'Mspil@1212';
const BRIDGE_URL = `http://${FACTORY_HOST}:5005`;
const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

interface DeviceCfg { code: string; ip: string; port: number; password: number; }
const DEVICES: DeviceCfg[] = [
  { code: 'CM',      ip: '192.168.0.25', port: 4370, password: 0 },
  { code: 'ETHANOL', ip: '192.168.0.22', port: 4370, password: 0 },
  { code: 'MSPIL',   ip: '192.168.0.21', port: 4370, password: 0 },
];

function ssh(cmd: string): string {
  return execSync(`sshpass -p '${FACTORY_PASS}' ssh -T -o StrictHostKeyChecking=no -o LogLevel=ERROR -o ConnectTimeout=10 ${FACTORY_USER}@${FACTORY_HOST} ${cmd}`, { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 });
}
async function fetchBridgeKey(): Promise<string> {
  const out = ssh(`"powershell -NoProfile -Command \\"Get-Content C:\\mspil\\biometric-bridge\\.env | Select-String '^BIOMETRIC_BRIDGE_KEY=' | ForEach-Object { \\$_.Line }\\""`);
  const m = out.match(/BIOMETRIC_BRIDGE_KEY\s*=\s*(.+)/);
  if (!m) throw new Error('could not parse bridge key');
  return m[1].trim();
}
async function bridgePost(path: string, body: any, key: string, timeoutMs = 10 * 60_000) {
  const r = await fetch(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json() as any;
}

async function wipeDevice(d: DeviceCfg, key: string) {
  // Reuses the chunk-50 retry pattern that worked reliably last time —
  // some delete commands silently fail on this firmware in larger chunks.
  let lastCount = -1;
  for (let pass = 1; pass <= 5; pass++) {
    const r = await bridgePost('/devices/users/list', { device: d }, key);
    const ids = (r.users as any[]).map(u => String(u.user_id));
    console.log(`  [${d.code}] pass ${pass}: ${ids.length} users present`);
    if (ids.length === 0) return;
    if (ids.length === lastCount) {
      console.warn(`  [${d.code}] no progress — bailing with ${ids.length} remaining`);
      return;
    }
    lastCount = ids.length;
    const CHUNK = 50;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      try {
        const j = await bridgePost('/devices/users/bulk-delete', { device: d, user_ids: slice }, key);
        deleted += j.deleted ?? 0;
      } catch (e: any) {
        console.warn(`  [${d.code}] chunk ${i}: ${e.message}`);
      }
    }
    console.log(`  [${d.code}] pass ${pass}: deleted ${deleted}/${ids.length}`);
  }
}

async function main() {
  console.log('Fetching bridge key...');
  const key = await fetchBridgeKey();

  // Plan
  console.log('\nScanning current state...');
  const empPlan = await prisma.employee.findMany({
    where: { isActive: true, empCode: { startsWith: 'MS-' } },
    select: { id: true, empCode: true, empNo: true, deviceUserId: true },
  });
  const labPlan = await prisma.laborWorker.findMany({
    where: { isActive: true, workerCode: { startsWith: 'LW-' } },
    select: { id: true, workerCode: true, workerNo: true, deviceUserId: true },
  });

  const empUpdates = empPlan.map(e => {
    const m = e.empCode!.match(/^MS-(\d+)$/);
    return m ? { id: e.id, empCode: e.empCode, oldDev: e.deviceUserId, newDev: String(parseInt(m[1], 10)) } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const labUpdates = labPlan.map(l => {
    const m = l.workerCode!.match(/^LW-(\d+)$/);
    return m ? { id: l.id, workerCode: l.workerCode, oldDev: l.deviceUserId, newDev: `L${parseInt(m[1], 10)}` } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const empChanging = empUpdates.filter(u => u.oldDev !== u.newDev);
  const labChanging = labUpdates.filter(u => u.oldDev !== u.newDev);
  console.log(`  Employees:  ${empUpdates.length} valid, ${empChanging.length} will change deviceUserId`);
  console.log(`  Labor:      ${labUpdates.length} valid, ${labChanging.length} will change deviceUserId`);
  console.log(`\nSample changes:`);
  for (const u of empChanging.slice(0, 5)) console.log(`  ${u.empCode}: ${u.oldDev} → ${u.newDev}`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] Re-run with --apply to commit.');
    return;
  }

  console.log('\nStopping factory-server...');
  ssh('"powershell -NoProfile -ExecutionPolicy Bypass -File C:\\mspil\\factory-server\\scripts\\stop-factory-node.ps1"');

  try {
    console.log('\nWiping all users on devices (parallel)...');
    await Promise.all(DEVICES.map(d => wipeDevice(d, key)));

    console.log('\nUpdating cloud DB (Employee.deviceUserId from empCode)...');
    // Single SQL — cast SUBSTRING(empCode FROM 4) to int (drops leading zeros) then back to text
    const empUpd = await prisma.$executeRaw`
      UPDATE "Employee"
      SET "deviceUserId" = (SUBSTRING("empCode" FROM 4))::int::text
      WHERE "isActive" = true
        AND "empCode" LIKE 'MS-%'
        AND SUBSTRING("empCode" FROM 4) ~ '^[0-9]+$'
    `;
    const labUpd = await prisma.$executeRaw`
      UPDATE "LaborWorker"
      SET "deviceUserId" = 'L' || (SUBSTRING("workerCode" FROM 4))::int::text
      WHERE "isActive" = true
        AND "workerCode" LIKE 'LW-%'
        AND SUBSTRING("workerCode" FROM 4) ~ '^[0-9]+$'
    `;
    console.log(`  Employees rows updated: ${empUpd}`);
    console.log(`  Labor rows updated:     ${labUpd}`);

    // Spot check the well-known case from the supervisor report
    const verify = await prisma.employee.findFirst({
      where: { empCode: 'MS-308' },
      select: { empCode: true, empNo: true, deviceUserId: true, firstName: true, lastName: true },
    });
    if (verify) {
      console.log(`\nSpot check: ${verify.empCode} (empNo=${verify.empNo}) deviceUserId=${verify.deviceUserId} "${verify.firstName} ${verify.lastName ?? ''}"`);
      if (verify.deviceUserId !== '308') {
        console.warn('  ⚠ deviceUserId did not align — investigate');
      } else {
        console.log('  ✓ aligned');
      }
    }
  } finally {
    console.log('\nRestarting factory-server...');
    try {
      ssh('"schtasks /run /tn FactoryServer"');
      console.log('  ✓ schtask triggered');
    } catch (e) {
      console.error('  failed to restart:', e);
    }
  }

  console.log('\nDone. AutoPush will rebuild every device user record with the');
  console.log('new ids over the next ~5 min. Verify with the device-state script.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
