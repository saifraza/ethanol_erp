/**
 * Rescue pass for the ~50 numeric stragglers left after the main cleanup.
 *
 * State on each device after cleanup:
 *   - 545 MS-/LW- user records (the desired final state)
 *   - ~13-20 leftover numeric user_ids that still have fingerprints AND whose
 *     MS-XXX twin on the device has NO fingerprints. The earlier rename
 *     ceremony's template-copy step failed for these (probably hit the
 *     pyzk delete-silent-fail bug we've since worked around).
 *
 * What this script does, per device:
 *   1. Fetch user list + template list
 *   2. For each numeric user_id with templates:
 *      a. Look at its `name` on the device
 *      b. Find the MS-XXX user with the SAME name AND no templates
 *      c. If a unique match → that's the rescue pair
 *      d. If 0 matches or >1 → log + skip (ambiguous, manual review)
 *   3. Call the bridge's /devices/users/rename for each pair (handles the
 *      template-copy + delete cleanly)
 *   4. Verify by re-listing
 *
 * Doesn't need cloud DB access — the device's stored `name` is the pivot.
 *
 * Usage:
 *   tsx backend/scripts/rescue-numeric-stragglers.ts             # dry-run
 *   tsx backend/scripts/rescue-numeric-stragglers.ts --apply
 */
import { execSync } from 'child_process';

const FACTORY_HOST = '100.126.101.7';
const FACTORY_USER = 'Administrator';
const FACTORY_PASS = 'Mspil@1212';
const BRIDGE_URL = `http://${FACTORY_HOST}:5005`;
const APPLY = process.argv.includes('--apply');

interface DeviceCfg {
  code: string;
  ip: string;
  port: number;
  password: number;
}

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
  if (!m) throw new Error(`could not parse BIOMETRIC_BRIDGE_KEY`);
  return m[1].trim();
}

async function bridgePost(path: string, body: any, key: string, timeoutMs = 60_000) {
  const r = await fetch(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${path} ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

async function processDevice(d: DeviceCfg, key: string): Promise<{
  pairs: Array<{ old: string; new: string; name: string }>;
  ambiguous: Array<{ user_id: string; name: string; reason: string }>;
}> {
  const ref = { ip: d.ip, port: d.port, password: d.password, timeout: 30 };
  const usersRes = await bridgePost('/devices/users/list', { device: ref }, key) as any;
  const tplRes = await bridgePost('/devices/templates/list', { device: ref }, key) as any;

  const users = usersRes.users as Array<{ uid: number; user_id: string; name: string }>;
  const templates: Record<string, number[]> = tplRes.templates;
  const tplKeys = new Set(Object.keys(templates));

  // Index MS-XXX users by name (lowercased + trimmed)
  const norm = (s: string) => (s || '').trim().toLowerCase();
  const msUsersByName = new Map<string, Array<{ user_id: string; uid: number }>>();
  for (const u of users) {
    if (!String(u.user_id).startsWith('MS-') && !String(u.user_id).startsWith('LW-')) continue;
    if (tplKeys.has(String(u.user_id))) continue; // already has templates — skip
    const k = norm(u.name);
    if (!k) continue;
    if (!msUsersByName.has(k)) msUsersByName.set(k, []);
    msUsersByName.get(k)!.push({ user_id: String(u.user_id), uid: u.uid });
  }

  const pairs: Array<{ old: string; new: string; name: string }> = [];
  const ambiguous: Array<{ user_id: string; name: string; reason: string }> = [];

  for (const u of users) {
    const id = String(u.user_id);
    if (id.startsWith('MS-') || id.startsWith('LW-')) continue;
    if (!tplKeys.has(id)) continue; // numeric without templates already cleaned up
    const matches = msUsersByName.get(norm(u.name)) ?? [];
    if (matches.length === 0) {
      ambiguous.push({ user_id: id, name: u.name, reason: 'no MS-/LW- twin found by name' });
    } else if (matches.length > 1) {
      ambiguous.push({ user_id: id, name: u.name, reason: `${matches.length} MS-/LW- twins matched (ambiguous): ${matches.map(m => m.user_id).join(', ')}` });
    } else {
      pairs.push({ old: id, new: matches[0].user_id, name: u.name });
    }
  }

  return { pairs, ambiguous };
}

async function main() {
  console.log('Fetching bridge key...');
  const key = await fetchBridgeKey();
  console.log('  ✓ fetched\n');

  // Per-device discovery
  const allPlans = await Promise.all(DEVICES.map(async (d) => {
    const r = await processDevice(d, key);
    console.log(`[${d.code}] rescue pairs: ${r.pairs.length}, ambiguous: ${r.ambiguous.length}`);
    for (const p of r.pairs.slice(0, 10)) {
      console.log(`  ${p.old.padEnd(8)} → ${p.new.padEnd(8)} (${p.name})`);
    }
    if (r.pairs.length > 10) console.log(`  ...and ${r.pairs.length - 10} more`);
    if (r.ambiguous.length > 0) {
      console.log(`  --- ambiguous (NOT fixed) ---`);
      for (const a of r.ambiguous) console.log(`  ${a.user_id} "${a.name}" → ${a.reason}`);
    }
    return { device: d, ...r };
  }));

  if (!APPLY) {
    console.log('\n[DRY-RUN] Re-run with --apply to commit.');
    return;
  }

  console.log('\n--- APPLYING (3 devices in parallel) ---');
  const t0 = Date.now();
  await Promise.all(allPlans.map(async (plan) => {
    if (plan.pairs.length === 0) {
      console.log(`[${plan.device.code}] nothing to rescue`);
      return;
    }
    const ref = { ip: plan.device.ip, port: plan.device.port, password: plan.device.password, timeout: 30 };
    const r = await bridgePost(
      '/devices/users/rename',
      { device: ref, pairs: plan.pairs.map(p => ({ old_user_id: p.old, new_user_id: p.new })) },
      key,
      15 * 60_000,
    ) as any;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${plan.device.code}] DONE ${elapsed}s · renamed=${r.renamed} already=${r.already_renamed} failed=${r.failed}`);
    for (const item of r.results) {
      if (!['ok', 'ok_recovered', 'ok_resolved_conflict', 'already_renamed'].includes(item.status)) {
        console.warn(`  [${plan.device.code}] ${item.old}→${item.new}: ${item.status} ${item.error ?? ''}`);
      }
    }
  }));

  console.log('\n--- VERIFY ---');
  await Promise.all(DEVICES.map(async (d) => {
    const ref = { ip: d.ip, port: d.port, password: d.password, timeout: 30 };
    const u = await bridgePost('/devices/users/list', { device: ref }, key) as any;
    const total = u.count;
    const ms = u.users.filter((x: any) => String(x.user_id).startsWith('MS-') || String(x.user_id).startsWith('LW-')).length;
    console.log(`[${d.code}] total ${total} (MS-/LW- ${ms}, stale numeric ${total - ms})`);
  }));
}

main().catch(e => { console.error(e); process.exit(1); });
