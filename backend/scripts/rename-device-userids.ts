/**
 * Migrate biometric devices' user_ids: numeric → MS-NNN / "L<n>" → LW-NNN.
 *
 * For every active employee whose deviceUserId is a numeric like "1" / "457":
 *   - On every factory-managed device, pull all 10 fingerprint templates from
 *     the old user_id, create a new user with the empCode (e.g. "MS-457") +
 *     same name/card/privilege, save the templates under the new user, then
 *     delete the old user. NO worker re-scan needed.
 *   - After the device-side rename succeeds on EVERY device, update cloud
 *     Employee.deviceUserId to the new value so future autoPush is consistent.
 *
 * Same flow for LaborWorker rows where deviceUserId is "L<n>" → workerCode.
 *
 * Concurrency: factory-server's autoPush is paused for the duration of this
 * script (we kill the node process before running and restart it on exit).
 * autoPush operates from cloud's deviceUserId; if it ran during the migration
 * window it would create orphan numeric users on other devices.
 *
 * Idempotent: re-running is safe. Pairs that already renamed (old user gone,
 * new user has templates) are reported as `already_renamed` and skipped.
 *
 * Usage:
 *   tsx backend/scripts/rename-device-userids.ts                  # dry-run
 *   tsx backend/scripts/rename-device-userids.ts --limit=1        # try one
 *   tsx backend/scripts/rename-device-userids.ts --apply          # all
 *   tsx backend/scripts/rename-device-userids.ts --apply --limit=1
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

const FACTORY_HOST = '100.126.101.7';
const FACTORY_USER = 'Administrator';
const FACTORY_PASS = 'Mspil@1212';
const BRIDGE_URL = `http://${FACTORY_HOST}:5005`;

const APPLY = process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity;
const ONLY_ARG = process.argv.find(a => a.startsWith('--only='));
const ONLY = ONLY_ARG ? ONLY_ARG.split('=')[1] : null;  // e.g., "MS-310" or "LW-001"

interface Pair {
  kind: 'EMPLOYEE' | 'LABOR';
  id: string;
  old: string;
  new: string;
  label: string;
}

interface RenameResult {
  old: string;
  new: string;
  status: string;
  fingers?: number[];
  copied?: number[];
  error?: string;
}

interface RenameResponse {
  ok: boolean;
  total: number;
  renamed: number;
  already_renamed: number;
  failed: number;
  results: RenameResult[];
}

function ssh(cmd: string): string {
  // Use -T to disable pseudo-tty; suppress motd noise via -o LogLevel=ERROR
  const full = `sshpass -p '${FACTORY_PASS}' ssh -T -o StrictHostKeyChecking=no -o LogLevel=ERROR -o ConnectTimeout=10 ${FACTORY_USER}@${FACTORY_HOST} ${cmd}`;
  return execSync(full, { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 });
}

async function fetchBridgeKey(): Promise<string> {
  const out = ssh(`"powershell -NoProfile -Command \\"Get-Content C:\\mspil\\biometric-bridge\\.env | Select-String '^BIOMETRIC_BRIDGE_KEY=' | ForEach-Object { \\$_.Line }\\""`);
  const m = out.match(/BIOMETRIC_BRIDGE_KEY\s*=\s*(.+)/);
  if (!m) throw new Error(`could not parse BIOMETRIC_BRIDGE_KEY. raw: ${out.slice(0, 200)}`);
  return m[1].trim();
}

// Per-pair on-device rename takes ~8s (10 template-pull round trips + create +
// save-template + delete). 543 pairs in a single HTTP request would exceed
// upstream/proxy idle timeouts. Chunk into batches that complete in ~5 min each.
const CHUNK_SIZE = 30;

async function callRenameOneChunk(
  device: { ip: string; port: number; password: number },
  bridgeKey: string,
  pairs: Pair[],
): Promise<RenameResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10 * 60_000); // 10 min per chunk
  try {
    const res = await fetch(`${BRIDGE_URL}/devices/users/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': bridgeKey },
      body: JSON.stringify({
        device: { ip: device.ip, port: device.port, password: device.password, timeout: 30 },
        pairs: pairs.map(p => ({ old_user_id: p.old, new_user_id: p.new })),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`bridge ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<RenameResponse>;
  } finally {
    clearTimeout(timer);
  }
}

async function callRename(
  device: { code: string; ip: string; port: number; password: number },
  bridgeKey: string,
  pairs: Pair[],
): Promise<RenameResponse> {
  const merged: RenameResponse = { ok: true, total: 0, renamed: 0, already_renamed: 0, failed: 0, results: [] };
  const totalChunks = Math.ceil(pairs.length / CHUNK_SIZE);
  const t0 = Date.now();
  for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
    const chunkIdx = i / CHUNK_SIZE + 1;
    const chunk = pairs.slice(i, i + CHUNK_SIZE);
    try {
      const r = await callRenameOneChunk(device, bridgeKey, chunk);
      merged.total += r.total;
      merged.renamed += r.renamed;
      merged.already_renamed += r.already_renamed;
      merged.failed += r.failed;
      merged.results.push(...r.results);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  [${device.code}] chunk ${chunkIdx}/${totalChunks} (+${chunk.length}) · cum renamed=${merged.renamed} failed=${merged.failed} · ${elapsed}s`);
    } catch (err) {
      console.error(`  [${device.code}] chunk ${chunkIdx}/${totalChunks} FAILED: ${err instanceof Error ? err.message : err}`);
      // Mark every pair in this chunk as a chunk-level error so cloud doesn't
      // get updated for them. Re-running will retry the survivors.
      for (const p of chunk) {
        merged.results.push({ old: p.old, new: p.new, status: 'chunk_error', error: err instanceof Error ? err.message : String(err) });
        merged.failed++;
        merged.total++;
      }
    }
  }
  return merged;
}

async function main() {
  // 1. Devices
  const devices = await prisma.biometricDevice.findMany({
    where: { active: true, factoryManaged: true },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, ip: true, port: true, password: true },
  });
  if (devices.length === 0) {
    console.error('No active factory-managed devices. Aborting.');
    process.exit(1);
  }
  console.log(`Factory-managed devices: ${devices.length}`);
  for (const d of devices) console.log(`  ${d.code} @ ${d.ip}`);

  // 2. Build pairs
  const employeesRaw = await prisma.employee.findMany({
    where: {
      isActive: true,
      deviceUserId: { not: null },
      NOT: { deviceUserId: { startsWith: 'MS-' } },
    },
    orderBy: { empNo: 'asc' },
    select: { id: true, empCode: true, deviceUserId: true, firstName: true, lastName: true },
  });
  const employees = employeesRaw.filter(e => e.empCode && e.empCode.startsWith('MS-'));
  const empMissingCode = employeesRaw.filter(e => !e.empCode || !e.empCode.startsWith('MS-'));
  if (empMissingCode.length > 0) {
    console.warn(`${empMissingCode.length} employee(s) skipped (no MS- empCode set yet):`);
    for (const e of empMissingCode.slice(0, 5)) console.warn(`  ${e.deviceUserId} ${e.firstName} ${e.lastName ?? ''} empCode=${e.empCode ?? '(null)'}`);
  }

  const laborsRaw = await prisma.laborWorker.findMany({
    where: {
      isActive: true,
      deviceUserId: { not: null },
      NOT: { deviceUserId: { startsWith: 'LW-' } },
    },
    orderBy: { workerNo: 'asc' },
    select: { id: true, workerCode: true, deviceUserId: true, firstName: true, lastName: true },
  });
  const labors = laborsRaw.filter(l => l.workerCode && l.workerCode.startsWith('LW-'));
  const laborMissingCode = laborsRaw.filter(l => !l.workerCode || !l.workerCode.startsWith('LW-'));
  if (laborMissingCode.length > 0) {
    console.warn(`${laborMissingCode.length} labor(s) skipped (no LW- workerCode set yet):`);
    for (const l of laborMissingCode.slice(0, 5)) console.warn(`  ${l.deviceUserId} ${l.firstName} ${l.lastName ?? ''} workerCode=${l.workerCode ?? '(null)'}`);
  }

  let pairs: Pair[] = [
    ...employees.map<Pair>((e) => ({
      kind: 'EMPLOYEE',
      id: e.id,
      old: e.deviceUserId!,
      new: e.empCode!,
      label: `${e.firstName} ${e.lastName ?? ''}`.trim(),
    })),
    ...labors.map<Pair>((l) => ({
      kind: 'LABOR',
      id: l.id,
      old: l.deviceUserId!,
      new: l.workerCode!,
      label: `${l.firstName} ${l.lastName ?? ''}`.trim(),
    })),
  ];

  // Pre-flight: check no two pairs share the same `new` (would clobber each other)
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const p of pairs) {
    if (seen.has(p.new)) dupes.push(p.new);
    seen.add(p.new);
  }
  if (dupes.length > 0) {
    console.error(`Duplicate new ids: ${dupes.slice(0, 10).join(', ')}. Aborting.`);
    process.exit(1);
  }

  if (ONLY) {
    pairs = pairs.filter(p => p.new === ONLY);
    if (pairs.length === 0) {
      console.error(`No pair matched --only=${ONLY}. Either already renamed or the new id doesn't match.`);
      process.exit(1);
    }
    console.log(`(--only=${ONLY} — targeting just ${pairs[0].label})`);
  }
  if (Number.isFinite(LIMIT) && LIMIT > 0) {
    pairs = pairs.slice(0, LIMIT);
    console.log(`(limit=${LIMIT} — only first ${pairs.length} pair(s) will be processed)`);
  }

  console.log(`\nPairs to rename: ${pairs.length}`);
  console.log(`  Employees: ${employees.length}`);
  console.log(`  Labor: ${labors.length}`);
  console.log(`\nSample (first 5):`);
  for (const p of pairs.slice(0, 5)) {
    console.log(`  ${p.old.padEnd(8)} → ${p.new.padEnd(8)} (${p.label})`);
  }
  if (pairs.length > 5) console.log(`  ...and ${pairs.length - 5} more`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] Re-run with --apply to commit. No device or DB changes made.');
    return;
  }

  // 3. Fetch bridge key
  console.log('\nFetching bridge key from factory PC...');
  const bridgeKey = await fetchBridgeKey();
  console.log(`  ✓ key fetched (length=${bridgeKey.length})`);

  // 4. Stop factory-server (pause autoPush for the migration window)
  console.log('\nStopping factory-server node (pausing autoPush)...');
  ssh('"powershell -NoProfile -ExecutionPolicy Bypass -File C:\\mspil\\factory-server\\scripts\\stop-factory-node.ps1"');
  console.log('  ✓ factory-server stopped');

  // Track which (kind,id) succeeded on which device so we can update cloud
  // only for those that succeeded EVERYWHERE.
  const successCount = new Map<string, number>(); // key = `${kind}|${id}` => devices ok
  const failures: Array<{ device: string; pair: Pair; status: string; error?: string }> = [];

  try {
    // 5. Run rename per device IN PARALLEL — each device has its own connection slot,
    //    no contention across devices.
    console.log(`\nDispatching rename to ${devices.length} devices in parallel...`);
    const t0 = Date.now();
    const allResults = await Promise.all(devices.map(async (d) => {
      try {
        const r = await callRename({ code: d.code, ip: d.ip, port: d.port, password: d.password }, bridgeKey, pairs);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  [${d.code}] DONE ${elapsed}s · renamed=${r.renamed} already=${r.already_renamed} failed=${r.failed}`);
        return { device: d, response: r as RenameResponse };
      } catch (err) {
        console.error(`  [${d.code}] FAILED: ${err instanceof Error ? err.message : err}`);
        return { device: d, response: null as RenameResponse | null };
      }
    }));

    // 6. Reconcile per-pair results across devices
    const pairByNew = new Map(pairs.map(p => [p.new, p]));

    for (const { device: d, response } of allResults) {
      if (!response) continue;
      for (const r of response.results) {
        const pair = pairByNew.get(r.new);
        if (!pair) continue;
        const key = `${pair.kind}|${pair.id}`;
        // Count as success: explicit ok, ok_recovered (prior run finished
        // template-copy but didn't delete old, this run cleaned up), already_renamed
        // (prior run finished cleanly), or old_not_found (user not on that device).
        if (r.status === 'ok' || r.status === 'ok_recovered' || r.status === 'ok_resolved_conflict' || r.status === 'already_renamed' || r.status === 'old_not_found') {
          successCount.set(key, (successCount.get(key) ?? 0) + 1);
        } else {
          failures.push({ device: d.code, pair, status: r.status, error: r.error });
        }
      }
    }

    // 7. Update cloud DB only for pairs that succeeded on ALL devices
    let updated = 0;
    for (const p of pairs) {
      const key = `${p.kind}|${p.id}`;
      if ((successCount.get(key) ?? 0) === devices.length) {
        if (p.kind === 'EMPLOYEE') {
          await prisma.employee.update({ where: { id: p.id }, data: { deviceUserId: p.new } });
        } else {
          await prisma.laborWorker.update({ where: { id: p.id }, data: { deviceUserId: p.new } });
        }
        updated++;
      }
    }
    console.log(`\nCloud deviceUserId updated: ${updated}/${pairs.length}`);

    // 8. Report failures
    if (failures.length > 0) {
      console.warn(`\n${failures.length} device-level failure(s) — these workers were NOT cloud-updated:`);
      const byPair = new Map<string, typeof failures>();
      for (const f of failures) {
        const k = `${f.pair.old} → ${f.pair.new}`;
        if (!byPair.has(k)) byPair.set(k, []);
        byPair.get(k)!.push(f);
      }
      for (const [k, fs] of byPair) {
        console.warn(`  ${k} (${fs[0].pair.label})`);
        for (const f of fs) console.warn(`    [${f.device}] ${f.status}${f.error ? ': ' + f.error : ''}`);
      }
      console.warn('Re-run the script after investigating to retry these.');
    } else {
      console.log('\nAll pairs renamed successfully on all devices.');
    }
  } finally {
    // 9. Restart factory-server unconditionally (so autoPush resumes)
    console.log('\nRestarting factory-server...');
    try {
      ssh('"schtasks /run /tn FactoryServer"');
      console.log('  ✓ schtask triggered (factory-server back up within ~10s)');
    } catch (e) {
      console.error('  FAILED to restart factory-server:', e);
      console.error('  Run: schtasks /run /tn FactoryServer  on the factory PC manually.');
    }
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
