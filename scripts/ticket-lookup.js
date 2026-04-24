#!/usr/bin/env node
// ticket-lookup.js — full 360° view of any weighbridge ticket
//
// Usage:
//   node scripts/ticket-lookup.js <ticketNo>
//
// Pulls:
//   - Factory Weighment (local DB via SSH)
//   - Cloud Weighment mirror
//   - Photos → ~/Desktop/ticket-NNNN/
//   - Training cycle manifest (post-2026-04-17 only)
//   - GRN + PO + Vendor (inbound)  OR  DispatchTruck + SO + Invoice (outbound)
//   - WeighmentCorrectionLog (factory)
//
// Requires:
//   - sshpass (brew install sshpass)
//   - backend/.env has a live DATABASE_URL for Railway cloud
//   - Tailscale up (factory SSH via 100.126.101.7)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TICKET_NO = parseInt(process.argv[2], 10);
if (!TICKET_NO || Number.isNaN(TICKET_NO)) {
  console.error('Usage: node scripts/ticket-lookup.js <ticketNo>');
  process.exit(1);
}

const FACTORY_HOST = 'Administrator@100.126.101.7';
const FACTORY_PASS = 'Mspil@1212';
const REMOTE_DIR = 'C:/mspil/factory-server';
const DESKTOP_DIR = path.join(process.env.HOME, 'Desktop', `ticket-${String(TICKET_NO).padStart(4, '0')}`);

const BACKEND = path.join(__dirname, '..', 'backend');
const { PrismaClient } = require(path.join(BACKEND, 'node_modules', '@prisma', 'client'));
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const p = new PrismaClient();

// ─── helpers ────────────────────────────────────────────────────────────
const fmtIST = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  });
};
const fmtINR = (n) =>
  n == null
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtKg = (n) => (n == null ? '—' : `${Number(n).toLocaleString('en-IN')} kg`);

const ssh = (cmd) =>
  execSync(
    `sshpass -p '${FACTORY_PASS}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${FACTORY_HOST} "${cmd.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

const scp = (remote, local) =>
  execSync(
    `sshpass -p '${FACTORY_PASS}' scp -r -o StrictHostKeyChecking=no ${FACTORY_HOST}:${remote} ${local}`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

// ─── 1. Factory Weighment ───────────────────────────────────────────────
async function getFactoryWeighment() {
  const out = ssh(`cd ${REMOTE_DIR} && node scripts/ticket-query.js ${TICKET_NO}`);
  return JSON.parse(out);
}

// ─── 2. Training cycle manifest ─────────────────────────────────────────
async function getTrainingCycle(weighmentId) {
  try {
    const out = ssh(
      `powershell -Command "Get-ChildItem '${REMOTE_DIR.replace(/\//g, '\\\\')}\\\\data\\\\videos\\\\motion' -Recurse -Filter manifest.json | ForEach-Object { $c = Get-Content $_.FullName -Raw; if ($c -match '${weighmentId}') { $_.FullName } }"`,
    );
    const match = out.trim().split(/\r?\n/)[0];
    if (!match) return null;
    const content = ssh(`type "${match.trim()}"`);
    return { path: match.trim(), manifest: JSON.parse(content) };
  } catch {
    return null;
  }
}

// ─── 3. Photos ──────────────────────────────────────────────────────────
function pullPhotos(weighmentId) {
  fs.mkdirSync(DESKTOP_DIR, { recursive: true });
  try {
    scp(
      `/C:/mspil/factory-server/data/snapshots/${weighmentId}/*`,
      DESKTOP_DIR,
    );
    const files = fs.readdirSync(DESKTOP_DIR).filter((f) => f.endsWith('.jpg'));
    return files;
  } catch {
    return [];
  }
}

// ─── 4. Cloud chain (direction-aware) ───────────────────────────────────
async function getCloudChain(w) {
  const mirror = await p.weighment.findFirst({
    where: { OR: [{ ticketNo: TICKET_NO }, { localId: w.localId }] },
  });

  if (w.direction === 'INBOUND') {
    // Primary match: remarks contains "Ticket #NNN" (set by auto-GRN from weighbridge).
    // Fallback: remarks contains the factory weighmentId (WB:<uuid>).
    // Belt-and-suspenders: also include any row with ticketNo=NNN (rarely set, but free).
    const grns = await p.goodsReceipt.findMany({
      where: {
        OR: [
          { ticketNo: TICKET_NO },
          { remarks: { contains: `Ticket #${TICKET_NO}` } },
          { remarks: { contains: `WB:${w.localId}` } },
          { remarks: { contains: w.id.slice(0, 8) } },
        ],
      },
      include: {
        lines: { select: { description: true, receivedQty: true, acceptedQty: true, unit: true } },
        vendor: { select: { name: true, pan: true, city: true } },
        po: { select: { poNo: true } },
        vendorInvoices: {
          select: { id: true, vendorInvNo: true, vendorInvDate: true, totalAmount: true, paidAmount: true, balanceAmount: true, matchStatus: true },
        },
      },
    });

    const po = w.poId
      ? await p.purchaseOrder.findUnique({
          where: { id: w.poId },
          include: { vendor: { select: { name: true, pan: true } } },
        })
      : null;

    return { type: 'INBOUND', mirror, grns, po };
  }

  // OUTBOUND — ethanol / DDGS / other outbound
  const dispatch = await p.dispatchTruck
    .findMany({
      where: { OR: [{ ticketNo: TICKET_NO }, { vehicleNo: w.vehicleNo }] },
      take: 5,
    })
    .catch(() => []);

  return { type: 'OUTBOUND', mirror, dispatch };
}

// ─── main ───────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nTicket ${String(TICKET_NO).padStart(4, '0')} — full 360° view`);
  console.log('='.repeat(60));

  const { weighments, corrections } = await getFactoryWeighment();
  if (!weighments.length) {
    console.log(`\nNo weighment found for ticket ${TICKET_NO} on factory.`);
    await p.$disconnect();
    return;
  }
  const w = weighments[0];

  console.log('\n## Weighment (factory)');
  console.log(`Vehicle:      ${w.vehicleNo} (${w.vehicleType || '?'})`);
  console.log(`Direction:    ${w.direction} · ${w.materialName || '?'} (${w.materialCategory || '?'})`);
  console.log(`Supplier:     ${w.supplierName || w.shipToName || '—'}`);
  console.log(`Transporter:  ${w.transporter || '—'} · Driver ${w.driverPhone || '—'}`);
  console.log(`Gate entry:   ${fmtIST(w.gateEntryAt)}`);
  console.log(`Gross:        ${fmtKg(w.grossWeight)} @ ${fmtIST(w.grossTime)}`);
  console.log(`Tare:         ${fmtKg(w.tareWeight)} @ ${fmtIST(w.tareTime)}`);
  console.log(`Net:          ${fmtKg(w.netWeight)}`);
  console.log(`Lab:          ${w.labStatus || '—'}${w.labMoisture != null ? ` · Moisture ${w.labMoisture}%` : ''}`);
  console.log(`Status:       ${w.status}${w.cancelled ? ' · CANCELLED' : ''}`);
  console.log(`Remarks:      ${w.remarks || '—'}`);
  console.log(`Shift/Op:     ${w.shift || '—'} · ${w.operatorName || '—'}`);
  console.log(`Cloud sync:   ${w.cloudSynced ? fmtIST(w.cloudSyncedAt) : 'NOT SYNCED'} (${w.syncAttempts} attempts)`);

  console.log('\n## Photos');
  const photos = pullPhotos(w.id);
  if (photos.length) {
    console.log(`${photos.length} pulled to ~/Desktop/ticket-${String(TICKET_NO).padStart(4, '0')}/`);
    photos.forEach((f) => console.log(`  ${f}`));
  } else {
    console.log('no photos on factory for this weighmentId');
  }

  console.log('\n## Training cycle (ML corpus)');
  const cycle = await getTrainingCycle(w.id);
  if (cycle) {
    const m = cycle.manifest;
    console.log(`cycle_id:    ${m.cycle_id}`);
    console.log(`duration:    ${m.duration_sec}s · motion_events=${m.motion_event_count} · captured_max=${m.captured_max_kg} kg`);
    if (m.weighment) console.log(`DIRECT label: ticket=${m.weighment.ticket_no} delta=${m.weighment.weight_match_delta_kg}kg`);
    if (m.noise) console.log(`NOISE:        ${m.noise.reason}`);
    if (m.weighment_unmatched) console.log(`UNMATCHED:    ${m.weighment_unmatched.reason}`);
  } else {
    console.log('no training cycle (likely predates 2026-04-17 corpus start)');
  }

  console.log('\n## Weighment corrections (factory audit log)');
  if (corrections.length) {
    for (const c of corrections) {
      console.log(`  ${fmtIST(c.appliedAt)} · field=${c.fieldName}`);
      if (c.oldValueJson) console.log(`    old: ${c.oldValueJson}`);
      if (c.newValueJson) console.log(`    new: ${c.newValueJson}`);
    }
  } else {
    console.log('none — weighment was never corrected');
  }

  console.log('\n## Cloud chain');
  const cloud = await getCloudChain(w);
  console.log(`Mirror version: ${cloud.mirror?.mirrorVersion ?? 'NOT MIRRORED'}`);

  if (cloud.type === 'INBOUND') {
    if (cloud.grns.length) {
      for (const g of cloud.grns) {
        console.log(`\nGRN #${g.grnNo} · ${fmtIST(g.grnDate)} · ${g.status}`);
        console.log(`  Vendor:   ${g.vendor.name.trim()} (${g.vendor.city || '?'})`);
        console.log(`  PO:       #${g.po.poNo}`);
        console.log(`  Qty:      ${g.totalQty} ${g.lines[0]?.unit || ''} of ${g.lines[0]?.description || '?'}`);
        console.log(`  Amount:   ${fmtINR(g.totalAmount)}`);
        console.log(`  Quality:  ${g.qualityStatus}`);
        console.log(`  Paid:     ${g.fullyPaid ? 'YES' : 'NO'}${g.paymentLinkedAt ? ` (linked ${fmtIST(g.paymentLinkedAt)})` : ''}`);
        if (g.vendorInvoices.length) {
          for (const inv of g.vendorInvoices) {
            console.log(`  Invoice:  ${inv.vendorInvNo || '?'} ${fmtIST(inv.vendorInvDate)} · ${fmtINR(inv.totalAmount)} · paid ${fmtINR(inv.paidAmount)} · match=${inv.matchStatus}`);
          }
        } else {
          console.log(`  Invoice:  NOT BILLED YET`);
        }
        if (g.remarks && g.remarks.includes('CORRECTION')) {
          console.log(`  \n  Correction note from GRN remarks:`);
          const corrLine = g.remarks.split('\n').find((l) => l.includes('CORRECTION'));
          if (corrLine) console.log(`    ${corrLine.trim()}`);
        }
      }
    } else {
      console.log('\nNo GRN linked — GRN auto-create may have failed');
    }
    if (cloud.po) {
      console.log(`\nPO #${cloud.po.poNo} · status=${cloud.po.status} · ${cloud.po.vendor.name.trim()}`);
      console.log(`  Grand total: ${fmtINR(cloud.po.grandTotal)} · TDS ${cloud.po.tdsApplicable ? `${cloud.po.tdsPercent}%` : 'N/A'}`);
    }
  } else {
    console.log(`\nOUTBOUND · dispatch rows: ${cloud.dispatch.length}`);
    for (const d of cloud.dispatch) {
      console.log(`  ${d.ticketNo || '?'} · ${d.vehicleNo} · ${fmtIST(d.dispatchDate || d.createdAt)}`);
    }
  }

  // ─── Audit trail (chronological) ─────────────────────────────────────
  console.log('\n## Audit trail (chronological)');
  const events = [];
  const push = (at, label, detail) => {
    if (!at) return;
    events.push({ at: new Date(at), label, detail: detail || '' });
  };

  push(w.createdAt, 'Weighment created', `factoryId=${w.id.slice(0, 8)}`);
  push(w.gateEntryAt, 'Gate entry', w.operatorName ? `operator=${w.operatorName}` : '');
  push(w.firstWeightAt || w.grossTime, 'Gross captured', `${fmtKg(w.grossWeight)}${w.grossPcId ? ` @ ${w.grossPcId}` : ''}`);
  push(w.labTestedAt, 'Lab tested', `${w.labStatus}${w.labMoisture != null ? ` · Moisture ${w.labMoisture}%` : ''}${w.labTestedBy ? ` by ${w.labTestedBy}` : ''}`);
  push(w.secondWeightAt || w.tareTime, 'Tare captured', `${fmtKg(w.tareWeight)}${w.tarePcId ? ` @ ${w.tarePcId}` : ''}`);
  for (const c of corrections) {
    let detail = `field=${c.fieldName}`;
    try {
      const oldV = c.oldValueJson ? JSON.parse(c.oldValueJson) : null;
      const newV = c.newValueJson ? JSON.parse(c.newValueJson) : null;
      if (oldV || newV) {
        detail += ` · ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`;
      }
    } catch {
      detail += c.newValueJson ? ` · ${c.newValueJson.slice(0, 120)}` : '';
    }
    push(c.appliedAt, 'Correction applied', detail);
  }
  push(w.cloudSyncedAt, 'Cloud sync', `attempts=${w.syncAttempts}${w.cloudError ? ` · ERROR: ${w.cloudError}` : ''}`);
  push(w.mirrorPushedAt, 'Mirror pushed', `v${cloud.mirror?.mirrorVersion || '?'}`);

  if (cloud.type === 'INBOUND') {
    for (const g of cloud.grns) {
      push(g.createdAt, `GRN #${g.grnNo} created`, `${g.totalQty}${g.lines[0]?.unit || ''} · ${fmtINR(g.totalAmount)} · status=${g.status}`);
      if (g.updatedAt && new Date(g.updatedAt) - new Date(g.createdAt) > 60_000) {
        push(g.updatedAt, `GRN #${g.grnNo} updated`, 'last modified');
      }
      if (g.paymentLinkedAt) push(g.paymentLinkedAt, `GRN #${g.grnNo} payment linked`, '');
      for (const inv of g.vendorInvoices) {
        push(inv.vendorInvDate || inv.createdAt, `Invoice ${inv.vendorInvNo || inv.id.slice(0, 8)}`, `${fmtINR(inv.totalAmount)} · paid ${fmtINR(inv.paidAmount)} · match=${inv.matchStatus}`);
      }
    }
  }

  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    console.log(`  ${fmtIST(e.at).padEnd(24)} · ${e.label.padEnd(24)} · ${e.detail}`);
  }

  await p.$disconnect();
  console.log('\n' + '='.repeat(60));
})().catch((e) => {
  console.error('\nticket-lookup failed:', e.message);
  p.$disconnect().finally(() => process.exit(1));
});
