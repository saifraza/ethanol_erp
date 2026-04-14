#!/usr/bin/env bash
# smoke-test.sh — Critical path safety net
# Run BEFORE every git push. Safe: read-only, no DB writes, no test data.
# Usage: ./scripts/smoke-test.sh [--quick]  (--quick skips vite build)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUICK=false
[[ "${1:-}" == "--quick" ]] && QUICK=true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
WARN=0

pass() { echo -e "  ${GREEN}PASS${NC}  $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; FAIL=$((FAIL + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; WARN=$((WARN + 1)); }

echo -e "\n${BOLD}SMOKE TEST — Critical Path Safety Net${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Backend TypeScript compilation ──
echo -e "\n${BOLD}1. Backend TypeScript${NC}"
if (cd "$ROOT/backend" && npx tsc --noEmit 2>&1 | tail -5); then
  pass "tsc --noEmit"
else
  fail "tsc --noEmit — type errors found"
fi

# ── 2. Frontend build ──
echo -e "\n${BOLD}2. Frontend Build${NC}"
if $QUICK; then
  echo "  SKIP  (--quick mode)"
else
  if (cd "$ROOT/frontend" && npx vite build 2>&1 | tail -3); then
    pass "vite build"
  else
    fail "vite build — frontend broken"
  fi
fi

# ── 3. Prisma schema validation (all 3 schemas) ──
echo -e "\n${BOLD}3. Prisma Schemas${NC}"
if (cd "$ROOT/backend" && npx prisma validate 2>/dev/null); then
  pass "backend/prisma/schema.prisma"
else
  fail "backend/prisma/schema.prisma invalid"
fi

if (cd "$ROOT/factory-server" && npx prisma validate 2>/dev/null); then
  pass "factory-server/prisma/schema.prisma"
else
  fail "factory-server/prisma/schema.prisma invalid"
fi

if (cd "$ROOT/factory-server" && npx prisma validate --schema=prisma/cloud/schema.prisma 2>/dev/null); then
  pass "factory-server/prisma/cloud/schema.prisma"
else
  fail "factory-server/prisma/cloud/schema.prisma invalid"
fi

# ── 4. Banned patterns in changed files ──
echo -e "\n${BOLD}4. Banned Patterns (changed files only)${NC}"
CHANGED=$(git -C "$ROOT" diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx)$' || true)
if [[ -z "$CHANGED" ]]; then
  echo "  SKIP  no changed .ts/.tsx files"
else
  # Check each banned pattern
  FOUND_BANNED=false

  # (req as any).user — must use AuthRequest
  HITS=$(echo "$CHANGED" | xargs grep -Hn '(req as any)\.user' 2>/dev/null || true)
  if [[ -n "$HITS" ]]; then
    fail "(req as any).user — use AuthRequest instead"
    echo "$HITS" | head -3 | sed 's/^/         /'
    FOUND_BANNED=true
  fi

  # catch (err: any) with err.message in response
  HITS=$(echo "$CHANGED" | xargs grep -Hn 'catch.*err: any' 2>/dev/null || true)
  if [[ -n "$HITS" ]]; then
    warn "catch (err: any) — use asyncHandler + typed errors"
    echo "$HITS" | head -3 | sed 's/^/         /'
  fi

  # console.log in routes/services/pages (not scripts)
  ROUTE_FILES=$(echo "$CHANGED" | grep -E '(routes|services|pages)/' || true)
  if [[ -n "$ROUTE_FILES" ]]; then
    HITS=$(echo "$ROUTE_FILES" | xargs grep -Hn 'console\.log' 2>/dev/null || true)
    if [[ -n "$HITS" ]]; then
      warn "console.log in production code"
      echo "$HITS" | head -3 | sed 's/^/         /'
    fi
  fi

  # : any type annotations
  HITS=$(echo "$CHANGED" | xargs grep -Hn ': any[^A-Za-z]' 2>/dev/null | grep -v 'node_modules' || true)
  if [[ -n "$HITS" ]]; then
    warn ": any type found — consider proper types"
    echo "$HITS" | head -3 | sed 's/^/         /'
  fi

  if [[ "$FOUND_BANNED" == false ]]; then
    pass "no hard-banned patterns"
  fi
fi

# ── 5. Critical path files — warn if modified ──
echo -e "\n${BOLD}5. Critical Path Check${NC}"
CRITICAL_FILES=(
  "backend/src/routes/weighbridge"
  "backend/src/routes/purchaseOrders.ts"
  "backend/src/routes/goodsReceipts.ts"
  "backend/src/services/autoJournal.ts"
  "factory-server/src/routes/weighbridge.ts"
  "factory-server/src/routes/gateEntry.ts"
  "factory-server/src/services/syncWorker.ts"
  "factory-server/src/services/masterDataCache.ts"
  "factory-server/src/services/ruleEngine.ts"
  "backend/src/middleware/auth.ts"
  "backend/src/config/prisma.ts"
)

CRITICAL_TOUCHED=false
for cf in "${CRITICAL_FILES[@]}"; do
  HITS=$(echo "$CHANGED" | grep "$cf" || true)
  if [[ -n "$HITS" ]]; then
    warn "CRITICAL PATH modified: $cf"
    CRITICAL_TOUCHED=true
  fi
done

if [[ "$CRITICAL_TOUCHED" == false ]]; then
  pass "no critical path files modified"
else
  echo -e "  ${YELLOW}^^^${NC} Critical files changed. Double-check weighbridge + PO/GRN flow."
fi

# ── 6. Endpoint checks (only if dev server running) ──
echo -e "\n${BOLD}6. Endpoint Health (localhost:3001)${NC}"
if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
  pass "health endpoint"

  # Weighbridge master-data
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/weighbridge/master-data 2>/dev/null || echo "000")
  if [[ "$STATUS" == "200" ]]; then
    pass "weighbridge master-data"
  elif [[ "$STATUS" == "401" || "$STATUS" == "403" ]]; then
    pass "weighbridge master-data (auth required, not crashing)"
  elif [[ "$STATUS" == "000" ]]; then
    fail "weighbridge master-data — connection refused"
  else
    warn "weighbridge master-data — HTTP $STATUS"
  fi

  # PO list
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/purchase-orders 2>/dev/null || echo "000")
  if [[ "$STATUS" == "200" || "$STATUS" == "401" ]]; then
    pass "purchase-orders endpoint (HTTP $STATUS)"
  else
    fail "purchase-orders endpoint — HTTP $STATUS"
  fi

  # GRN list
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/goods-receipts 2>/dev/null || echo "000")
  if [[ "$STATUS" == "200" || "$STATUS" == "401" ]]; then
    pass "goods-receipts endpoint (HTTP $STATUS)"
  else
    fail "goods-receipts endpoint — HTTP $STATUS"
  fi
else
  echo "  SKIP  dev server not running on :3001"
fi

# ── 7. Factory server check (if reachable) ──
echo -e "\n${BOLD}7. Factory Server (Tailscale)${NC}"
if curl -sf --connect-timeout 3 http://100.126.101.7:5000/api/health >/dev/null 2>&1; then
  pass "factory health endpoint"

  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 http://100.126.101.7:5000/api/weighbridge/summary 2>/dev/null || echo "000")
  if [[ "$STATUS" == "200" ]]; then
    pass "factory weighbridge summary"
  else
    warn "factory weighbridge summary — HTTP $STATUS"
  fi
else
  echo "  SKIP  factory not reachable (Tailscale down?)"
fi

# ── VERDICT ──
echo -e "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}RESULTS${NC}: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${WARN} warnings${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}${BOLD}BLOCKED${NC} — fix failures before pushing"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo -e "${YELLOW}${BOLD}CAUTION${NC} — review warnings, push if intentional"
  exit 0
else
  echo -e "${GREEN}${BOLD}SAFE TO PUSH${NC}"
  exit 0
fi
