/**
 * One-shot cleanup: delete stale numeric user_ids from every factory-managed
 * device. The rename ceremony left ~half the records orphaned because pyzk's
 * delete_user was silently dropped while the device was actively matching.
 * The new bulk-delete endpoint wraps everything in disable_device/enable_device
 * so the deletes commit deterministically.
 *
 * Safety: we only delete user_ids that DON'T start with "MS-" or "LW-" AND
 * either (a) have no enrolled fingerprint, or (b) the corresponding MS-/LW-
 * id on the same device DOES have a fingerprint (so the worker's print is
 * safe under the new id). Any numeric with templates whose MS-/LW- doesn't
 * have templates is reported but NOT deleted — needs manual review.
 *
 * Usage:
 *   tsx backend/scripts/cleanup-stale-device-users.ts             # dry-run
 *   tsx backend/scripts/cleanup-stale-device-users.ts --apply     # commits
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const FACTORY_HOST = '100.126.101.7';
const FACTORY_USER = 'Administrator';
const FACTORY_PASS = 'Mspil@1212';
const BRIDGE_URL = `http://${FACTORY_HOST}:5005`;

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

function ssh(cmd: string): string {
  return execSync(`sshpass -p '${FACTORY_PASS}' ssh -T -o StrictHostKeyChecking=no -o LogLevel=ERROR -o ConnectTimeout=10 ${FACTORY_USER}@${FACTORY_HOST} ${cmd}`, { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 });
}
async function fetchBridgeKey(): Promise<string> {
  const out = ssh(`"powershell -NoProfile -Command \\"Get-Content C:\\mspil\\biometric-bridge\\.env | Select-String '^BIOMETRIC_BRIDGE_KEY=' | ForEach-Object { \\$_.Line }\\""`);
  const m = out.match(/BIOMETRIC_BRIDGE_KEY\s*=\s*(.+)/);
  if (!m) throw new Error(`could not parse BIOMETRIC_BRIDGE_KEY`);
  return m[1].trim();
}

async function listUsers(deviceRef: any, key: string): Promise<{ user_id: string }[]> {
  const r = await fetch(`${BRIDGE_URL}/devices/users/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': key },
    body: JSON.stringify({ device: deviceRef }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`list ${r.status}`);
  return (await r.json() as any).users;
}

async function listTemplates(deviceRef: any, key: string): Promise<Record<string, number[]>> {
  const r = await fetch(`${BRIDGE_URL}/devices/templates/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': key },
    body: JSON.stringify({ device: deviceRef }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`tpl ${r.status}`);
  return (await r.json() as any).templates;
}

async function bulkDelete(deviceRef: any, key: string, user_ids: string[]): Promise<any> {
  // Send in chunks of 200 so each HTTP request stays well within proxy timeouts
  const CHUNK = 200;
  const results: any[] = [];
  let totalDeleted = 0, totalNotFound = 0, totalFailed = 0;
  for (let i = 0; i < user_ids.length; i += CHUNK) {
    const slice = user_ids.slice(i, i + CHUNK);
    const r = await fetch(`${BRIDGE_URL}/devices/users/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': key },
      body: JSON.stringify({ device: deviceRef, user_ids: slice }),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!r.ok) throw new Error(`bulk-delete chunk ${i}: ${r.status}`);
    const body = await r.json() as any;
    totalDeleted += body.deleted ?? 0;
    totalNotFound += body.not_found ?? 0;
    totalFailed += body.failed ?? 0;
    results.push(...(body.results ?? []));
  }
  return { deleted: totalDeleted, notFound: totalNotFound, failed: totalFailed, results };
}

async function main() {
  const devices = await prisma.biometricDevice.findMany({
    where: { active: true, factoryManaged: true },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, ip: true, port: true, password: true },
  });

  console.log(`Factory-managed devices: ${devices.length}`);
  for (const d of devices) console.log(`  ${d.code} @ ${d.ip}`);

  console.log('\nFetching bridge key...');
  const bridgeKey = await fetchBridgeKey();

  // Per-device plan
  const plans: Array<{ device: typeof devices[number]; safeDeletes: string[]; risky: Array<{ user_id: string; reason: string }>; }> = [];

  for (const d of devices) {
    const ref = { ip: d.ip, port: d.port, password: d.password, timeout: 30 };
    console.log(`\n=== ${d.code} (${d.ip}) ===`);
    const users = await listUsers(ref, bridgeKey);
    const templates = await listTemplates(ref, bridgeKey);
    const tplKeys = new Set(Object.keys(templates));
    const numericIds = users.map(u => String(u.user_id)).filter(uid => !uid.startsWith('MS-') && !uid.startsWith('LW-'));

    console.log(`  total user records: ${users.length}`);
    console.log(`  stale numeric user_ids: ${numericIds.length}`);

    const safeDeletes: string[] = [];
    const risky: Array<{ user_id: string; reason: string }> = [];

    for (const numId of numericIds) {
      const numHasTpl = tplKeys.has(numId);
      // Find the MS-XXX or LW-XXX mapped to this numeric. We don't know that
      // mapping from the device — must look it up via cloud. But since the
      // rename target was always empCode/workerCode, we can ask: does *any*
      // MS-/LW- user with templates exist? If overall MS-/LW- coverage is good,
      // the numeric is duplicate.
      // Conservative version: only treat numeric-without-templates as safe,
      // and numeric-with-templates only when we can show the worker's MS-XXX
      // also has at least one template. We'll cross-check via cloud.
      if (!numHasTpl) {
        safeDeletes.push(numId);
        continue;
      }
      // Numeric has templates. Find the cloud Employee whose deviceUserId WAS
      // this numeric (look at cardNumber / empNo / workerNo as breadcrumbs).
      // Easier: find the corresponding MS-XXX by mapping numId → empNo.
      // The original allocator used either empNo (e.g., "457") or "L<n>".
      // Or for LaborWorker, "L1". We rebuild empCode like "MS-{padded empNo}".
      const empMatch = await prisma.employee.findFirst({
        where: { OR: [{ empNo: parseInt(numId, 10) || -1 }, { deviceUserId: numId }] },
        select: { empCode: true },
      });
      const labMatch = !empMatch && numId.startsWith('L')
        ? await prisma.laborWorker.findFirst({
            where: { OR: [{ workerNo: parseInt(numId.replace(/^L/i, ''), 10) || -1 }, { deviceUserId: numId }] },
            select: { workerCode: true },
          })
        : null;
      const newId = empMatch?.empCode ?? labMatch?.workerCode ?? null;
      if (!newId) {
        risky.push({ user_id: numId, reason: 'has templates AND no cloud match — keep, manual review' });
        continue;
      }
      if (tplKeys.has(newId)) {
        // Both old and new have templates → templates are duplicated, safe to drop old
        safeDeletes.push(numId);
      } else {
        risky.push({ user_id: numId, reason: `has templates but ${newId} has none — keep, fix rename first` });
      }
    }

    console.log(`  safe to delete: ${safeDeletes.length}`);
    console.log(`  needs manual review: ${risky.length}`);
    if (risky.length > 0) {
      for (const r of risky.slice(0, 20)) console.log(`    [keep] ${r.user_id} — ${r.reason}`);
    }
    plans.push({ device: d, safeDeletes, risky });
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] Re-run with --apply to commit. No device changes made.');
    return;
  }

  console.log('\n--- APPLYING (3 devices in parallel) ---');
  const t0 = Date.now();
  await Promise.all(plans.map(async (p) => {
    if (p.safeDeletes.length === 0) {
      console.log(`[${p.device.code}] nothing to delete`);
      return;
    }
    console.log(`[${p.device.code}] starting ${p.safeDeletes.length} deletes...`);
    const ref = { ip: p.device.ip, port: p.device.port, password: p.device.password, timeout: 30 };
    const r = await bulkDelete(ref, bridgeKey, p.safeDeletes);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${p.device.code}] DONE ${elapsed}s · deleted=${r.deleted} not_found=${r.notFound} failed=${r.failed}`);
    const silentFails = (r.results as any[]).filter(x => x.status === 'delete_silent_fail');
    if (silentFails.length > 0) {
      console.warn(`[${p.device.code}] ${silentFails.length} silent-fail deletes. Examples:`);
      for (const f of silentFails.slice(0, 10)) console.warn(`  ${f.user_id}`);
    }
    const errors = (r.results as any[]).filter(x => x.status === 'error');
    if (errors.length > 0) {
      console.warn(`[${p.device.code}] ${errors.length} delete errors. Examples:`);
      for (const e of errors.slice(0, 10)) console.warn(`  ${e.user_id}: ${e.error}`);
    }
  }));

  console.log('\n--- VERIFY ---');
  for (const p of plans) {
    const ref = { ip: p.device.ip, port: p.device.port, password: p.device.password, timeout: 30 };
    const users = await listUsers(ref, bridgeKey);
    const numericLeft = users.filter(u => !String(u.user_id).startsWith('MS-') && !String(u.user_id).startsWith('LW-')).length;
    const msLeft = users.filter(u => String(u.user_id).startsWith('MS-') || String(u.user_id).startsWith('LW-')).length;
    console.log(`[${p.device.code}] total ${users.length} (MS-/LW-: ${msLeft}, stale numeric: ${numericLeft})`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
