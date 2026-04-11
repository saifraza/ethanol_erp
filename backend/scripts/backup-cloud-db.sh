#!/bin/bash
# Quick manual backup before risky DB operations
# Usage: ./backend/scripts/backup-cloud-db.sh
#
# Run this BEFORE:
#   - prisma db push (schema changes)
#   - manual SQL migrations
#   - any destructive operation on cloud DB
#
# Restore:
#   pg_restore --no-owner --no-acl --clean --if-exists -d "$DATABASE_URL" <backup-file>

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

# Load DATABASE_URL from backend/.env
if [ -f "$BACKEND_DIR/.env" ] && [ -z "$DATABASE_URL" ]; then
  DATABASE_URL=$(grep '^DATABASE_URL=' "$BACKEND_DIR/.env" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
  export DATABASE_URL
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set. Check backend/.env or export it."
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$HOME/backups/mspil-erp"
mkdir -p "$BACKUP_DIR"

BACKUP_FILE="$BACKUP_DIR/mspil-erp-${TIMESTAMP}.dump"

# Use pg_dump v17+ to match Railway server version
PG_DUMP="pg_dump"
if [ -x "/opt/homebrew/opt/postgresql@17/bin/pg_dump" ]; then
  PG_DUMP="/opt/homebrew/opt/postgresql@17/bin/pg_dump"
elif [ -x "/usr/local/opt/postgresql@17/bin/pg_dump" ]; then
  PG_DUMP="/usr/local/opt/postgresql@17/bin/pg_dump"
fi

echo "Dumping cloud DB..."
"$PG_DUMP" "$DATABASE_URL" \
  --no-owner --no-acl \
  --format=custom \
  --compress=9 \
  -f "$BACKUP_FILE"

SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
echo ""
echo "Backup saved: $BACKUP_FILE ($SIZE)"
echo ""
echo "To restore:"
echo "  pg_restore --no-owner --no-acl --clean --if-exists -d \"\$DATABASE_URL\" $BACKUP_FILE"

# Cleanup: keep last 30 backups, delete older ones
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/mspil-erp-*.dump 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 30 ]; then
  ls -1t "$BACKUP_DIR"/mspil-erp-*.dump | tail -n +31 | xargs rm -f
  echo ""
  echo "Cleaned up old backups (kept last 30)"
fi
