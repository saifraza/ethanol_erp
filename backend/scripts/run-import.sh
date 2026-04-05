#!/bin/bash
# Run this after deploy to import 153 historical MASH liftings
# Usage: bash scripts/run-import.sh

# Login first to get token
TOKEN=$(curl -s https://app.mspil.in/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@distillery.com","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

if [ -z "$TOKEN" ]; then
  echo "Login failed"
  exit 1
fi

echo "Got token, importing..."

CONTRACT_ID="c2a9f488-3017-4448-b4ee-fecaa08e5326"

curl -s "https://app.mspil.in/api/ethanol-contracts/${CONTRACT_ID}/import-history" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d @scripts/import-data.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Imported: {d.get(\"imported\",0)}, Skipped: {d.get(\"skipped\",0)}, Total: {d.get(\"totalLiftings\",0)}, KL: {d.get(\"totalKL\",0)}')"
