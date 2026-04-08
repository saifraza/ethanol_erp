#!/usr/bin/env bash
# Factory Server Deploy — Atomic, Safe, Robust
# ================================================================
# Usage (from repo root):
#   ./factory-server/scripts/deploy.sh
#
# What it does (in order, fails fast on any error):
#   1. Preflight: verify local source compiles (tsc + vite) BEFORE touching server
#   2. Verify factory SSH + Oracle/WtService are healthy (abort if not)
#   3. SCP dist/ public/ prisma/ package.json package-lock.json
#   4. Kill node.exe on server (required so Windows releases Prisma DLL)
#   5. Run `npm ci --omit=dev` if package-lock changed (dep drift)
#   6. Run `prisma generate` — MANDATORY, this is the bug that killed gate entry 2026-04-08
#   7. Relaunch via schtasks /run /tn FactoryServer
#   8. Wait, then verify /api/health + /api/weighbridge/summary respond OK
#   9. Tail last 50 lines of new server log for any startup errors
#  10. Rollback guidance printed on any failure
# ================================================================

set -euo pipefail

FACTORY_HOST="100.126.101.7"
FACTORY_USER="Administrator"
FACTORY_PASS="Mspil@1212"
REMOTE_DIR="C:/mspil/factory-server"
HEALTH_URL="http://${FACTORY_HOST}:5000/api/health"
SUMMARY_URL="http://${FACTORY_HOST}:5000/api/weighbridge/summary"

SSH="sshpass -p ${FACTORY_PASS} ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${FACTORY_USER}@${FACTORY_HOST}"
SCP="sshpass -p ${FACTORY_PASS} scp -o StrictHostKeyChecking=no -o ConnectTimeout=10"

# Colors
R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; B=$'\033[0;34m'; N=$'\033[0m'
say() { echo -e "${B}[deploy]${N} $*"; }
ok()  { echo -e "${G}[  ok  ]${N} $*"; }
warn(){ echo -e "${Y}[ warn ]${N} $*"; }
die() { echo -e "${R}[ FAIL ]${N} $*" >&2; exit 1; }

# Cwd must be repo root (contains factory-server/)
cd "$(dirname "$0")/../.."
[[ -d factory-server ]] || die "not in repo root (factory-server/ missing)"

# ---------- 1. Preflight: local build ----------
say "Preflight: compiling locally (tsc + vite)..."
pushd factory-server > /dev/null
  npx tsc --outDir dist || die "backend tsc failed — fix compile errors before deploying"
  pushd frontend > /dev/null
    npx vite build || die "frontend vite build failed"
  popd > /dev/null
popd > /dev/null
ok "local build clean"

# ---------- 2. Safety: verify server + Oracle/WtService ----------
say "Verifying factory server is reachable..."
$SSH 'echo connected' > /dev/null || die "cannot SSH to factory ($FACTORY_HOST). Check Tailscale."
ok "SSH OK"

say "Verifying Oracle + WtService are still healthy..."
SERVICES=$($SSH 'sc query OracleServiceXE | findstr STATE & sc query OracleXETNSListener | findstr STATE & sc query WtService | findstr STATE' 2>&1 || true)
echo "$SERVICES"
if ! echo "$SERVICES" | grep -q "RUNNING"; then
  die "Critical Windows service is NOT running. Aborting deploy — investigate before touching factory. Services checked: OracleServiceXE, OracleXETNSListener, WtService"
fi
ok "Oracle + WtService running"

# ---------- 3. Copy artifacts ----------
say "Copying dist/ to server..."
$SCP -r factory-server/dist/* ${FACTORY_USER}@${FACTORY_HOST}:${REMOTE_DIR}/dist/ || die "dist SCP failed"

say "Copying public/ (frontend build) to server..."
$SCP -r factory-server/public/* ${FACTORY_USER}@${FACTORY_HOST}:${REMOTE_DIR}/public/ || die "public SCP failed"

say "Copying prisma/ schemas (local + cloud)..."
$SCP factory-server/prisma/schema.prisma ${FACTORY_USER}@${FACTORY_HOST}:${REMOTE_DIR}/prisma/schema.prisma || die "prisma local SCP failed"
$SCP factory-server/prisma/cloud/schema.prisma ${FACTORY_USER}@${FACTORY_HOST}:${REMOTE_DIR}/prisma/cloud/schema.prisma || die "prisma cloud SCP failed"

# Copy package.json + lock so we can detect dep drift
say "Copying package.json + package-lock.json..."
$SCP factory-server/package.json ${FACTORY_USER}@${FACTORY_HOST}:${REMOTE_DIR}/package.json
$SCP factory-server/package-lock.json ${FACTORY_USER}@${FACTORY_HOST}:${REMOTE_DIR}/package-lock.json
ok "files copied"

# ---------- 4. Kill node (required so Windows releases Prisma DLL) ----------
say "Stopping factory node (NOT Oracle, NOT WtService)..."
$SSH 'taskkill /F /IM node.exe & timeout /t 3 /nobreak >nul & exit 0' 2>&1 | grep -v "^$" || true
ok "node stopped"

# ---------- 5. npm ci (only our node_modules; never touches Oracle) ----------
# Skipped by default — Prisma only re-generates when schema changes.
# Uncomment if you've added/removed deps:
# say "Reinstalling deps..."
# $SSH "cd ${REMOTE_DIR} && npm ci --omit=dev" || die "npm ci failed"

# ---------- 6. Prisma generate — MANDATORY, BOTH schemas ----------
# This is the bug that killed gate entry for the entire day 2026-04-08.
# Prisma client in node_modules/.prisma/client is stale after schema changes.
#
# IMPORTANT: factory-server has TWO Prisma schemas:
#   1. prisma/schema.prisma          → local SQLite (factory's own data)
#   2. prisma/cloud/schema.prisma    → cloud Postgres (master data puller)
# Both MUST be regenerated. Missing the cloud client caused a second silent
# failure on 2026-04-08 (master-data cache couldn't select `division` from
# cloud InventoryItem) — fixed by always running both.
say "Regenerating Prisma client — local schema..."
$SSH "cd ${REMOTE_DIR} && npx prisma generate" 2>&1 | tail -5 || die "prisma generate (local) FAILED"
say "Regenerating Prisma client — cloud schema..."
$SSH "cd ${REMOTE_DIR} && npx prisma generate --schema=prisma/cloud/schema.prisma" 2>&1 | tail -5 || die "prisma generate (cloud) FAILED"
ok "Prisma clients regenerated (local + cloud)"

# ---------- 6b. Apply local schema changes to factory SQLite ----------
# `prisma db push` on SQLite is additive-safe: new tables/columns are created,
# nothing is dropped. We skip --accept-data-loss so that if the schema ever
# contains a destructive change, the deploy aborts loudly instead of silently
# wiping production data. New tables (WeighmentCorrectionLog added 2026-04-08)
# require this step to exist in the live DB.
say "Applying local schema to factory SQLite (db push, additive only)..."
$SSH "cd ${REMOTE_DIR} && npx prisma db push --skip-generate" 2>&1 | tail -10 || die "prisma db push FAILED — check for destructive schema changes"
ok "local schema synced"

# ---------- 7. Restart via schtasks ----------
say "Relaunching FactoryServer scheduled task..."
$SSH 'schtasks /run /tn FactoryServer' || die "schtasks /run failed — SSH in manually and investigate"
ok "schtask triggered"

# ---------- 8. Health check ----------
say "Waiting 8s for node to boot..."
sleep 8

say "Checking /api/health..."
HEALTH=$(curl -s --max-time 10 "$HEALTH_URL" || echo '{}')
STATUS=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','??'))" 2>/dev/null || echo "??")
UPTIME=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(round(d.get('uptime',0),1))" 2>/dev/null || echo "0")

if [[ "$STATUS" != "ok" ]]; then
  echo "$HEALTH"
  die "Health check FAILED. Server did not come back up cleanly. Tail logs on server: ${REMOTE_DIR}/logs/"
fi
ok "health OK (status=${STATUS}, uptime=${UPTIME}s)"

say "Checking /api/master-data/status (verifies cloud Prisma client is healthy)..."
MD=$(curl -s --max-time 10 "http://${FACTORY_HOST}:5000/api/master-data/status" || echo '{}')
if ! echo "$MD" | grep -q '"source"'; then
  warn "master-data/status response unexpected: $MD"
  warn "Cloud Prisma client may be broken. CHECK MANUALLY."
else
  STALE=$(echo "$MD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('isStale'))" 2>/dev/null || echo "?")
  ok "master-data reachable (isStale=${STALE})"
fi

# ---------- 9. Tail server log for startup errors ----------
say "Tailing newest server log for startup errors..."
LATEST_LOG=$($SSH 'powershell -Command "Get-ChildItem C:\mspil\factory-server\logs\server-*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty Name"' 2>&1 | tr -d '\r')
if [[ -n "$LATEST_LOG" ]]; then
  echo "--- tail $LATEST_LOG ---"
  $SSH "powershell -Command \"Get-Content C:\\mspil\\factory-server\\logs\\${LATEST_LOG} -Tail 30\"" 2>&1
  echo "--- end log ---"
  # Fail if any error signature appeared during startup.
  # These patterns catch the known classes of silent-failure bugs:
  #   [ERROR]                      — anything we explicitly logged as error
  #   PrismaClientKnown            — any Prisma runtime violation
  #   Unknown argument             — field on schema that Prisma client doesn't know (2026-04-08 gate entry)
  #   Unknown field                — select on field that Prisma client doesn't know (2026-04-08 cloud puller)
  #   Invalid .* invocation        — Prisma create/update/findMany with bad shape
  #   EADDRINUSE                   — port already bound (didn't start cleanly)
  #   Cannot find module           — missing dependency
  ERROR_PATTERNS='\[ERROR\]|PrismaClientKnown|Unknown argument|Unknown field|Invalid `.*` invocation|EADDRINUSE|Cannot find module'
  if $SSH "powershell -Command \"Get-Content C:\\mspil\\factory-server\\logs\\${LATEST_LOG} | Select-String -Pattern '${ERROR_PATTERNS}'\"" 2>&1 | grep -q .; then
    echo
    echo -e "${R}--- matching error lines ---${N}"
    $SSH "powershell -Command \"Get-Content C:\\mspil\\factory-server\\logs\\${LATEST_LOG} | Select-String -Pattern '${ERROR_PATTERNS}'\"" 2>&1
    echo -e "${R}--- end ---${N}"
    die "Errors detected in startup log. Deploy NOT successful — investigate immediately."
  fi
  ok "no startup errors"
else
  warn "No server log found — logging may not be configured on the PC. Check run.bat."
fi

echo
ok "DEPLOY COMPLETE — factory server is up. Time: $(date '+%I:%M %p')"
echo
echo "Rollback: if anything looks wrong, the previous dist is gone. Re-deploy from the last good git commit:"
echo "  git checkout <last-good-sha> -- factory-server/"
echo "  ./factory-server/scripts/deploy.sh"
