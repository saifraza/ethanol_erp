#!/bin/bash
# Vault Sync — Pull pending vault notes from ERP API to local Obsidian vault.
#
# Usage: ./scripts/vault-sync.sh
# Cron:  */5 * * * * /path/to/vault-sync.sh  (every 5 min)
#
# Requires: curl, jq
# Config: Set API_URL and AUTH_TOKEN below

API_URL="${VAULT_API_URL:-https://app.mspil.in}"
AUTH_TOKEN="${VAULT_AUTH_TOKEN}"
VAULT_DIR="$HOME/Documents/mspil-brain"

if [ -z "$AUTH_TOKEN" ]; then
  echo "Error: VAULT_AUTH_TOKEN not set"
  exit 1
fi

# Fetch pending notes
RESPONSE=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/api/vault/pending")
COUNT=$(echo "$RESPONSE" | jq -r '.count')

if [ "$COUNT" = "0" ] || [ "$COUNT" = "null" ]; then
  exit 0
fi

echo "[$COUNT] vault notes to sync..."

SYNCED_IDS="[]"

# Process each note
echo "$RESPONSE" | jq -c '.notes[]' | while read -r NOTE; do
  VAULT_PATH=$(echo "$NOTE" | jq -r '.vaultPath')
  SUMMARY=$(echo "$NOTE" | jq -r '.summary')
  NOTE_ID=$(echo "$NOTE" | jq -r '.id')
  TITLE=$(echo "$NOTE" | jq -r '.title')

  # Create directory if needed
  DIR="$VAULT_DIR/$(dirname "$VAULT_PATH")"
  mkdir -p "$DIR"

  # Write markdown file
  echo "$SUMMARY" > "$VAULT_DIR/$VAULT_PATH"
  echo "  Written: $VAULT_PATH ($TITLE)"

  # Collect ID for marking synced
  SYNCED_IDS=$(echo "$SYNCED_IDS" | jq --arg id "$NOTE_ID" '. + [$id]')
done

# Mark as synced
if [ "$SYNCED_IDS" != "[]" ]; then
  ALL_IDS=$(echo "$RESPONSE" | jq '[.notes[].id]')
  curl -s -X POST \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"ids\": $ALL_IDS}" \
    "$API_URL/api/vault/mark-synced" > /dev/null

  echo "Marked $COUNT notes as synced."
fi
