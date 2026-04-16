#!/usr/bin/env node
/**
 * Weighment Sync Audit
 * --------------------
 * Compares the FACTORY Weighment table against the CLOUD Weighment mirror,
 * row-by-row, to detect every kind of desync:
 *
 *   1. Counter burns       → ticketNo gone in BOTH (rare; old non-tx Counter)
 *   2. Real lost data      → on factory, NOT on cloud (mirror failed to push)
 *   3. Phantom rows        → on cloud, NOT on factory (rare; orphan from old pushes)
 *   4. localId mismatches  → same ticketNo on both, different localId (worst case)
 *   5. Stale rows          → cloud factoryUpdatedAt < factory updatedAt (mirror behind)
 *
 * UNLIKE audit_lost_v2.js, this audit:
 *   - Does NOT pre-filter by `cloudSynced=true` (the old script's blind spot)
 *   - Compares the FULL set of ticketNos on both sides
 *   - Reports every gap and mismatch directly
 *
 * Usage:
 *   node backend/scripts/audit_weighment_sync.js
 *
 * Environment:
 *   CLOUD_DATABASE_URL  — required (Railway DB URL)
 *   FACTORY_SSH_HOST    — optional, default 100.126.101.7 (Tailscale)
 *   FACTORY_SSH_USER    — optional, default Administrator
 *   FACTORY_SSH_PASS    — optional, default Mspil@1212  (or supply via env)
 *   FACTORY_DB_PASS     — optional, default mspil2026
 *
 * Read-only. Safe to run anytime.
 */

const { execSync } = require('child_process');
const { Client } = require('pg');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLOUD_URL = process.env.CLOUD_DATABASE_URL;
if (!CLOUD_URL) {
  console.error('CLOUD_DATABASE_URL is required');
  process.exit(1);
}

const FACTORY_HOST = process.env.FACTORY_SSH_HOST || '100.126.101.7';
const FACTORY_USER = process.env.FACTORY_SSH_USER || 'Administrator';
const FACTORY_SSH_PASS = process.env.FACTORY_SSH_PASS || 'Mspil@1212';
const FACTORY_DB_PASS = process.env.FACTORY_DB_PASS || 'mspil2026';

function pad(n, w) { return String(n).padStart(w); }

async function fetchFactory() {
  // Write a SQL file, SCP, run via PowerShell on factory PC
  const sqlFile = path.join(os.tmpdir(), 'audit_factory.sql');
  fs.writeFileSync(sqlFile,
    `COPY (
       SELECT "ticketNo", "localId", "vehicleNo", "direction", "status",
              "cloudSynced",
              extract(epoch from "updatedAt") AS upd_epoch,
              to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS created_ist
       FROM "Weighment"
       WHERE "ticketNo" IS NOT NULL
       ORDER BY "ticketNo"
     ) TO STDOUT WITH CSV HEADER;\n`);
  execSync(`sshpass -p '${FACTORY_SSH_PASS}' scp -o StrictHostKeyChecking=no ${sqlFile} ${FACTORY_USER}@${FACTORY_HOST}:C:/Windows/Temp/audit_factory.sql`,
    { stdio: 'pipe' });
  const csv = execSync(
    `sshpass -p '${FACTORY_SSH_PASS}' ssh -o StrictHostKeyChecking=no ${FACTORY_USER}@${FACTORY_HOST} ` +
    `'powershell -Command "[Environment]::SetEnvironmentVariable(\\"PGPASSWORD\\", \\"${FACTORY_DB_PASS}\\", \\"Process\\"); ` +
    `& \\"C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe\\" -U postgres -h 127.0.0.1 -d mspil_factory -f C:\\Windows\\Temp\\audit_factory.sql"'`,
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

  const map = new Map();
  const lines = csv.split('\n').filter(Boolean);
  const header = lines.shift().split(',');
  for (const line of lines) {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    const t = parseInt(row.ticketNo, 10);
    if (Number.isFinite(t)) {
      map.set(t, {
        localId: row.localId,
        vehicleNo: row.vehicleNo,
        direction: row.direction,
        status: row.status,
        cloudSynced: row.cloudSynced === 't' || row.cloudSynced === 'true',
        updatedAtMs: Math.round(parseFloat(row.upd_epoch) * 1000),
        createdIst: row.created_ist,
      });
    }
  }
  return map;
}

async function fetchCloud() {
  const c = new Client({ connectionString: CLOUD_URL });
  await c.connect();
  const r = await c.query(
    `SELECT "ticketNo", "localId", "vehicleNo", "status",
            extract(epoch from "factoryUpdatedAt") AS upd_epoch
     FROM "Weighment"
     WHERE "ticketNo" IS NOT NULL
     ORDER BY "ticketNo"`);
  await c.end();
  const map = new Map();
  for (const row of r.rows) {
    map.set(row.ticketNo, {
      localId: row.localId,
      vehicleNo: row.vehicleNo,
      status: row.status,
      updatedAtMs: row.upd_epoch ? Math.round(parseFloat(row.upd_epoch) * 1000) : null,
    });
  }
  return map;
}

(async () => {
  console.log('Fetching factory...');
  const factory = await fetchFactory();
  console.log(`Factory: ${factory.size} weighments (max T-${Math.max(...factory.keys())})`);

  console.log('Fetching cloud...');
  const cloud = await fetchCloud();
  console.log(`Cloud:   ${cloud.size} weighments (max T-${Math.max(...cloud.keys())})`);

  const fSet = new Set(factory.keys());
  const cSet = new Set(cloud.keys());

  // 1. Counter burns — in NEITHER DB
  const maxT = Math.max(...fSet, ...cSet);
  const burns = [];
  for (let t = 1; t <= maxT; t++) {
    if (!fSet.has(t) && !cSet.has(t)) burns.push(t);
  }

  // 2. Real lost — in factory, NOT in cloud
  const lost = [...fSet].filter(t => !cSet.has(t)).sort((a, b) => a - b);

  // 3. Phantoms — in cloud, NOT in factory
  const phantoms = [...cSet].filter(t => !fSet.has(t)).sort((a, b) => a - b);

  // 4. localId mismatch — same ticketNo, different localId
  const mismatches = [];
  for (const t of fSet) {
    if (!cSet.has(t)) continue;
    if (factory.get(t).localId !== cloud.get(t).localId) {
      mismatches.push({ t, fLocal: factory.get(t).localId, cLocal: cloud.get(t).localId });
    }
  }

  // 5. Stale — cloud factoryUpdatedAt < factory updatedAt (>5s tolerance)
  const stale = [];
  for (const t of fSet) {
    if (!cSet.has(t)) continue;
    const f = factory.get(t).updatedAtMs;
    const c = cloud.get(t).updatedAtMs;
    if (c == null) { stale.push({ t, kind: 'cloud-null', fUpd: f }); continue; }
    if (f - c > 5000) stale.push({ t, kind: 'cloud-behind', behindMs: f - c });
  }

  console.log('');
  console.log('═══ AUDIT REPORT ═══');
  console.log(`  Counter burns:       ${pad(burns.length, 4)}  (in NO database — old non-tx Counter)`);
  console.log(`  Real lost data:      ${pad(lost.length, 4)}  (factory yes, cloud no — mirror push failed)`);
  console.log(`  Phantom rows:        ${pad(phantoms.length, 4)}  (cloud yes, factory no — orphan)`);
  console.log(`  localId mismatches:  ${pad(mismatches.length, 4)}  (same T-#, different row)`);
  console.log(`  Stale (cloud < fac): ${pad(stale.length, 4)}  (mirror behind by >5s)`);

  if (burns.length) {
    console.log(`\n  Burned tickets: T-${burns[0]}..T-${burns[burns.length - 1]} (${burns.length} numbers)`);
    if (burns.length <= 30) console.log(`    ${burns.join(', ')}`);
  }
  if (lost.length) {
    console.log('\n=== REAL LOST DATA — needs investigation ===');
    for (const t of lost.slice(0, 50)) {
      const f = factory.get(t);
      console.log(`  T-${t} | ${f.vehicleNo.padEnd(15)} | ${f.status.padEnd(10)} | cloudSynced=${f.cloudSynced} | ${f.createdIst}`);
    }
  }
  if (phantoms.length) {
    console.log('\n=== PHANTOM ROWS — cloud has rows factory doesn\'t ===');
    for (const t of phantoms.slice(0, 50)) {
      const c = cloud.get(t);
      console.log(`  T-${t} | ${c.vehicleNo.padEnd(15)} | ${c.status} | localId=${c.localId}`);
    }
  }
  if (mismatches.length) {
    console.log('\n=== LOCALID MISMATCHES — different rows under same ticketNo ===');
    for (const m of mismatches.slice(0, 50)) {
      console.log(`  T-${m.t} | factory=${m.fLocal} | cloud=${m.cLocal}`);
    }
  }
  if (stale.length) {
    console.log('\n=== STALE — cloud row older than factory row ===');
    for (const s of stale.slice(0, 50)) {
      console.log(`  T-${s.t} | ${s.kind} | behind=${s.behindMs ?? 'n/a'}ms`);
    }
  }

  const healthy = lost.length === 0 && phantoms.length === 0 && mismatches.length === 0 && stale.length === 0;
  console.log('');
  console.log(healthy ? '✓ HEALTHY: factory and cloud are in perfect sync.' : '✗ ISSUES FOUND — see above.');
  process.exit(healthy ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(2);
});
