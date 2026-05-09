#!/usr/bin/env bash
# Factory Server Env Deploy — update env vars without code redeploy
# ================================================================
# Usage (from repo root):
#   ./factory-server/scripts/deploy-env.sh CLOUD_DATABASE_URL
#   ./factory-server/scripts/deploy-env.sh CLOUD_DATABASE_URL --from-railway
#
# Modes:
#   default            : reads value from local factory-server/.env
#   --from-railway     : reads value from `railway variables --service Postgres`
#                        (specifically DATABASE_PUBLIC_URL when key=CLOUD_DATABASE_URL)
#
# Safety:
#   1. Backs up factory PC's existing .env to .env.bak.YYYYMMDD-HHMMSS
#   2. Writes ONLY the requested key — every other line untouched
#   3. Confirms exactly 1 line replaced before restarting
#   4. Restarts FactoryServer scheduled task and verifies recovery
#
# Why this exists:
#   2026-05-07 → 2026-05-09 outage: Railway DB host was migrated; factory
#   PC's .env still pointed at the dead host for 48 hours because deploy.sh
#   ships code only, not env. Operators saw "Cloud data stale" banner but
#   nobody monitored. This script makes env-only updates a 30-second job.

set -euo pipefail

KEY="${1:-}"
SOURCE="${2:-}"

if [[ -z "$KEY" ]]; then
  echo "Usage: $0 KEY_NAME [--from-railway]"
  echo "  KEY_NAME: env var to update (e.g. CLOUD_DATABASE_URL)"
  echo "  --from-railway: pull DATABASE_PUBLIC_URL from Railway 'Postgres' service"
  exit 1
fi

FACTORY_HOST="100.126.101.7"
FACTORY_USER="Administrator"
FACTORY_PASS="Mspil@1212"
REMOTE_DIR="C:/mspil/factory-server"
HEALTH_URL="http://${FACTORY_HOST}:5000/api/master-data/status"

SSH="sshpass -p ${FACTORY_PASS} ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${FACTORY_USER}@${FACTORY_HOST}"
SCP="sshpass -p ${FACTORY_PASS} scp -o StrictHostKeyChecking=no -o ConnectTimeout=10"

R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; B=$'\033[0;34m'; N=$'\033[0m'
say() { echo -e "${B}[env]${N} $*"; }
ok()  { echo -e "${G}[ok ]${N} $*"; }
die() { echo -e "${R}[FAIL]${N} $*" >&2; exit 1; }

# Cwd must be repo root
cd "$(dirname "$0")/../.."
[[ -d factory-server ]] || die "not in repo root (factory-server/ missing)"

# ---------- 1. Build the new env line (never echoes the value) ----------
TMPLINE="$(mktemp -t deploy-env.XXXXXX)"
trap "rm -f $TMPLINE" EXIT

if [[ "$SOURCE" == "--from-railway" ]]; then
  command -v railway >/dev/null || die "railway CLI not installed"
  say "Pulling $KEY from Railway Postgres service..."
  RAILWAY_KV="$(mktemp -t pg-vars.XXXXXX)"
  trap "rm -f $TMPLINE $RAILWAY_KV" EXIT
  railway variables --service Postgres --kv > "$RAILWAY_KV" 2>&1 || die "railway variables failed (run 'railway login' / 'railway link')"
  if [[ "$KEY" == "CLOUD_DATABASE_URL" ]]; then
    grep "^DATABASE_PUBLIC_URL=" "$RAILWAY_KV" | sed 's|^DATABASE_PUBLIC_URL=|CLOUD_DATABASE_URL="|; s|$|"|' > "$TMPLINE"
  else
    grep "^${KEY}=" "$RAILWAY_KV" | sed "s|^${KEY}=|${KEY}=\"|; s|\$|\"|" > "$TMPLINE"
  fi
  rm -f "$RAILWAY_KV"
else
  say "Reading $KEY from local factory-server/.env..."
  [[ -f factory-server/.env ]] || die "factory-server/.env not found"
  grep "^${KEY}=" factory-server/.env > "$TMPLINE" || die "$KEY not found in local factory-server/.env"
fi

[[ -s "$TMPLINE" ]] || die "could not derive value for $KEY (empty)"
LINE_COUNT=$(wc -l < "$TMPLINE" | tr -d ' ')
[[ "$LINE_COUNT" == "1" ]] || die "expected 1 line for $KEY, got $LINE_COUNT"
ok "value derived (length: $(wc -c < "$TMPLINE" | tr -d ' ') bytes)"

# ---------- 2. Verify factory reachable ----------
say "Checking factory reachability..."
$SSH 'echo connected' > /dev/null || die "cannot SSH to factory ($FACTORY_HOST). Check Tailscale."
ok "SSH OK"

# ---------- 3. Backup factory .env ----------
STAMP=$(date +%Y%m%d-%H%M%S)
say "Backing up factory .env → .env.bak.$STAMP..."
$SSH "powershell -Command \"Copy-Item ${REMOTE_DIR}/.env ${REMOTE_DIR}/.env.bak.${STAMP} -Force; Write-Host BACKED_UP\"" 2>&1 | grep -q BACKED_UP || die "backup failed"
ok "backed up"

# ---------- 4. Copy new line to factory ----------
say "Copying new value to factory..."
$SCP "$TMPLINE" "${FACTORY_USER}@${FACTORY_HOST}:${REMOTE_DIR}/.env-line.tmp" || die "SCP failed"

# ---------- 5. Replace the line atomically (PowerShell, no bypass needed) ----------
say "Replacing $KEY in factory .env..."
REPLACE_CMD=$(cat <<EOF
\$envPath='${REMOTE_DIR}/.env';
\$newLine=(Get-Content '${REMOTE_DIR}/.env-line.tmp' -Raw).Trim();
\$content=Get-Content \$envPath;
\$matched=(\$content | Where-Object { \$_ -match '^${KEY}=' }).Count;
if (\$matched -ne 1) { Write-Host (\"KEY_COUNT_MISMATCH=\" + \$matched); exit 1 }
\$updated=\$content | ForEach-Object { if (\$_ -match '^${KEY}=') { \$newLine } else { \$_ } };
\$updated | Set-Content \$envPath -Encoding ASCII;
\$after=(\$updated | Where-Object { \$_ -match '^${KEY}=' }).Count;
Write-Host ('REPLACED=' + \$after + ' TOTAL=' + \$updated.Count);
Remove-Item '${REMOTE_DIR}/.env-line.tmp'
EOF
)
RESULT=$($SSH "powershell -Command \"$REPLACE_CMD\"" 2>&1 | tail -3)
echo "$RESULT" | grep -q "REPLACED=1" || die "line replace failed: $RESULT"
ok "$KEY updated on factory"

# ---------- 6. Restart factory node ----------
say "Restarting FactoryServer scheduled task..."
$SSH 'schtasks /End /TN FactoryServer' >/dev/null 2>&1 || true
sleep 2
$SSH 'schtasks /Run /TN FactoryServer' >/dev/null 2>&1 || die "schtasks /Run failed"
ok "restart triggered"

# ---------- 7. Verify recovery (poll up to 30s) ----------
say "Waiting for factory-server to reconnect..."
for i in $(seq 1 8); do
  sleep 4
  RESPONSE=$(curl -s -m 4 "$HEALTH_URL" 2>/dev/null || echo "")
  if echo "$RESPONSE" | grep -q '"isStale":false'; then
    SOURCE_VAL=$(echo "$RESPONSE" | sed -n 's/.*"source":"\([^"]*\)".*/\1/p')
    AGE=$(echo "$RESPONSE" | sed -n 's/.*"ageMinutes":\([0-9]*\).*/\1/p')
    ok "factory recovered (source=$SOURCE_VAL, age=${AGE}min)"
    echo
    echo "Done. Factory PC env updated and verified."
    echo "Backup retained at: ${REMOTE_DIR}/.env.bak.${STAMP}"
    exit 0
  fi
  echo -e "${Y}[..]${N} attempt $i/8 — still stale, waiting..."
done

die "factory-server did not recover within 32s — investigate logs at ${REMOTE_DIR}/logs/"
