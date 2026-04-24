#!/usr/bin/env node
// Backfill already-unmatched cycle manifests under the new enrichment rules
// (widened tolerance 750 kg, noise classification for short pass-throughs).
//
// Runs on the factory server. Safe to re-run — idempotent.
//
// Usage (from C:\mspil\factory-server):
//   node scripts/backfill-unlabeled-cycles.js

const fs = require('fs');
const path = require('path');

// Must match the thresholds in src/services/cycleManifest.ts
const NOISE_DURATION_THRESHOLD_SEC = 20;

const { enrichManifestFromWeighment } = require('../dist/services/cycleManifest');

async function main() {
  const root = path.join(__dirname, '..', 'data', 'videos', 'motion');
  if (!fs.existsSync(root)) {
    console.log('No motion root — nothing to backfill');
    return;
  }

  const dates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let alreadyLabeled = 0;
  let alreadyNoise = 0;
  let reclassifiedNoise = 0;
  let tried = 0;
  let recovered = 0;
  let stillUnmatched = 0;

  for (const date of dates) {
    const datePath = path.join(root, date);
    const cycles = fs
      .readdirSync(datePath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const cycleId of cycles) {
      const mfPath = path.join(datePath, cycleId, 'manifest.json');
      if (!fs.existsSync(mfPath)) continue;

      let m;
      try {
        m = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
      } catch {
        continue;
      }

      if (m.weighment && m.weighment.weighment_id) {
        alreadyLabeled++;
        continue;
      }
      if (m.noise) {
        alreadyNoise++;
        continue;
      }

      // Noise classification for short pass-throughs
      if (m.duration_sec != null && m.duration_sec < NOISE_DURATION_THRESHOLD_SEC) {
        m.noise = {
          reason: `cycle duration ${m.duration_sec}s < ${NOISE_DURATION_THRESHOLD_SEC}s (pass-through, not a weighment)`,
          classified_at: new Date().toISOString(),
        };
        fs.writeFileSync(mfPath, JSON.stringify(m, null, 2));
        reclassifiedNoise++;
        console.log(`  ${date}/${cycleId}: NOISE (${m.duration_sec}s)`);
        continue;
      }

      // Re-run enrichment with new tolerance
      tried++;
      try {
        await enrichManifestFromWeighment(cycleId);
      } catch (err) {
        console.error(`  ${date}/${cycleId}: enrichment threw — ${err.message}`);
        continue;
      }
      const after = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
      if (after.weighment && after.weighment.weighment_id) {
        recovered++;
        console.log(
          `  ${date}/${cycleId}: RECOVERED ticket=${after.weighment.ticket_no} vehicle=${after.weighment.vehicle_no} delta=${after.weighment.weight_match_delta_kg}kg`,
        );
      } else {
        stillUnmatched++;
      }
    }
  }

  console.log('');
  console.log('Backfill summary');
  console.log('================');
  console.log(`Already labeled:     ${alreadyLabeled}`);
  console.log(`Already noise:       ${alreadyNoise}`);
  console.log(`New noise:           ${reclassifiedNoise}`);
  console.log(`Re-enrichment tried: ${tried}`);
  console.log(`  recovered:         ${recovered}`);
  console.log(`  still unmatched:   ${stillUnmatched}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
