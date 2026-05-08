/**
 * One-shot: revert device user_ids from MS-NNN/LW-NNN to short format
 * (employee = bare empNo, labor = "L"+workerNo). ERP-side empCode/workerCode
 * stay as MS-NNN/LW-NNN — only what's typed on the device's keypad changes.
 *
 * Why: supervisors at the gate found typing "MS-" prefix on the eSSL
 * keypad too painful when searching for users. Bare numeric is what they
 * had originally, and what they want back.
 *
 * Safe because all fingerprints were already wiped from devices on
 * 2026-05-08 (cleanup ceremony). The 2 face templates on MSPIL will be
 * lost in this migration — accepted, will be re-enrolled tomorrow with
 * the rest of the fresh setup.
 *
 * Steps:
 *   1. Stop factory-server's autoPush so it doesn't race with us
 *   2. Bulk-delete all MS-/LW- user records on each device (parallel)
 *   3. Update cloud Employee/LaborWorker deviceUserId in one DB hop each
 *   4. Restart factory-server
 *   5. AutoPush re-creates everyone with new short IDs on its next tick
 *
 * Usage:
 *   tsx backend/scripts/relabel-device-userids-short.ts             # dry-run
 *   tsx backend/scripts/relabel-device-userids-short.ts --apply
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
async function bridgePost(path: string, body: any, key: string, timeoutMs = 15 * 60_000) {
  const r = await fetch(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json();
}

async function main() {
  console.log('Fetching bridge key...');
  const key = await fetchBridgeKey();

  // Per-device list of MS-/LW- user_ids to delete
  console.log('\nScanning devices...');
  const plans = await Promise.all(DEVICES.map(async (d) => {
    const ref = { ip: d.ip, port: d.port, password: d.password, timeout: 30 };
    const r = await bridgePost('/devices/users/list', { device: ref }, key) as any;
    const targets = (r.users as any[])
      .map(u => String(u.user_id))
      .filter(uid => uid.startsWith('MS-') || uid.startsWith('LW-'));
    console.log(`  ${d.code}: ${r.count} total, ${targets.length} to delete`);
    return { device: d, targets };
  }));

  // Cloud DB plan
  const empToUpdate = await prisma.employee.count({
    where: { isActive: true, deviceUserId: { startsWith: 'MS-' } },
  });
  const laborToUpdate = await prisma.laborWorker.count({
    where: { isActive: true, deviceUserId: { startsWith: 'LW-' } },
  });
  console.log(`\nCloud DB:`);
  console.log(`  ${empToUpdate} active employees with MS- deviceUserId → bare empNo`);
  console.log(`  ${laborToUpdate} active labor with LW- deviceUserId → 'L'+workerNo`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] Re-run with --apply to commit.');
    return;
  }

  // Stop factory-server (pauses autoPush)
  console.log('\nStopping factory-server (pause autoPush)...');
  ssh('"powershell -NoProfile -ExecutionPolicy Bypass -File C:\\mspil\\factory-server\\scripts\\stop-factory-node.ps1"');

  try {
    // Wipe MS-/LW- user records on each device in parallel
    console.log('\nWiping MS-/LW- user records on devices (parallel)...');
    const t0 = Date.now();
    await Promise.all(plans.map(async (p) => {
      if (p.targets.length === 0) {
        console.log(`  [${p.device.code}] nothing to delete`);
        return;
      }
      const ref = { ip: p.device.ip, port: p.device.port, password: p.device.password, timeout: 30 };
      // Chunk in 200s — same pattern that worked for the cleanup
      const CHUNK = 200;
      let totalDeleted = 0;
      for (let i = 0; i < p.targets.length; i += CHUNK) {
        const slice = p.targets.slice(i, i + CHUNK);
        const r = await bridgePost('/devices/users/bulk-delete',
          { device: ref, user_ids: slice }, key, 10 * 60_000) as any;
        totalDeleted += r.deleted ?? 0;
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  [${p.device.code}] DONE ${elapsed}s · deleted ${totalDeleted}/${p.targets.length}`);
    }));

    // Update cloud DB — single SQL statements, atomic per-statement
    console.log('\nUpdating cloud DB...');
    const empUpd = await prisma.$executeRaw`
      UPDATE "Employee"
      SET "deviceUserId" = "empNo"::text
      WHERE "isActive" = true AND "deviceUserId" LIKE 'MS-%'
    `;
    const laborUpd = await prisma.$executeRaw`
      UPDATE "LaborWorker"
      SET "deviceUserId" = 'L' || "workerNo"::text
      WHERE "isActive" = true AND "deviceUserId" LIKE 'LW-%'
    `;
    console.log(`  Employees updated: ${empUpd}`);
    console.log(`  Labor updated: ${laborUpd}`);

    // Verify
    const remaining = await prisma.employee.count({
      where: { isActive: true, deviceUserId: { startsWith: 'MS-' } },
    });
    const remainingLabor = await prisma.laborWorker.count({
      where: { isActive: true, deviceUserId: { startsWith: 'LW-' } },
    });
    if (remaining > 0 || remainingLabor > 0) {
      console.warn(`  WARNING: ${remaining} employees + ${remainingLabor} labor still have prefixed deviceUserId`);
    } else {
      console.log('  ✓ all migrated');
    }
  } finally {
    // Restart factory-server unconditionally
    console.log('\nRestarting factory-server...');
    try {
      ssh('"schtasks /run /tn FactoryServer"');
      console.log('  ✓ schtask triggered (factory-server back up within ~10s)');
    } catch (e) {
      console.error('  failed to restart:', e);
    }
  }

  console.log('\nDone. Within the next ~5 min, autoPush will rebuild every');
  console.log('user record on each device with the new short IDs.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
