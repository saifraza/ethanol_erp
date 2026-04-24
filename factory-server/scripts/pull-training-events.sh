#!/bin/bash
# Pull training events from factory server → organized Desktop folders
# Usage: ./pull-training-events.sh [date] [--labeled-only] [--photos N]
#   date: YYYY-MM-DD (default: all dates)
#   --labeled-only: skip events without weighment match
#   --photos N: download N burst photos per camera per event (default: 2, max: 10)

set -euo pipefail

FACTORY_IP="100.126.101.7"
FACTORY_USER="Administrator"
FACTORY_PASS="Mspil@1212"
REMOTE_BASE="C:/mspil/factory-server/data/videos/motion"
LOCAL_BASE="$HOME/Desktop/wb-training-events"

DATE_FILTER=""
LABELED_ONLY=false
PHOTOS_PER_CAM=2

for arg in "$@"; do
  case "$arg" in
    --labeled-only) LABELED_ONLY=true ;;
    --photos) shift; PHOTOS_PER_CAM="${1:-2}" ;;
    20*) DATE_FILTER="$arg" ;;
  esac
done

SSH_CMD="sshpass -p '$FACTORY_PASS' ssh -o StrictHostKeyChecking=no $FACTORY_USER@$FACTORY_IP"
SCP_CMD="sshpass -p '$FACTORY_PASS' scp -o StrictHostKeyChecking=no"

echo "=== WB Training Data Viewer ==="
echo "Pulling from factory server $FACTORY_IP..."
echo "Output: $LOCAL_BASE"
echo ""

# Get list of manifest files
if [ -n "$DATE_FILTER" ]; then
  MANIFESTS=$(eval $SSH_CMD "dir \"C:\\mspil\\factory-server\\data\\videos\\motion\\$DATE_FILTER\\*\\manifest.json\" /s /b 2>nul" 2>/dev/null || true)
else
  MANIFESTS=$(eval $SSH_CMD "dir C:\\mspil\\factory-server\\data\\videos\\motion\\*\\*\\manifest.json /s /b 2>nul" 2>/dev/null || true)
fi

if [ -z "$MANIFESTS" ]; then
  echo "No events found."
  exit 0
fi

mkdir -p "$LOCAL_BASE"

EVENT_COUNT=0
LABELED_COUNT=0
UNLABELED_COUNT=0

echo "$MANIFESTS" | while IFS= read -r manifest_path; do
  [ -z "$manifest_path" ] && continue

  # Get the cycle dir (parent of manifest.json)
  cycle_dir=$(echo "$manifest_path" | sed 's|\\manifest.json||' | tr '\\' '/')
  cycle_id=$(basename "$cycle_dir")

  # Download manifest
  tmp_manifest="/tmp/manifest_${cycle_id}.json"
  eval $SCP_CMD "\"$FACTORY_USER@$FACTORY_IP:$cycle_dir/manifest.json\"" "$tmp_manifest" 2>/dev/null || continue

  # Parse manifest
  has_weighment=$(python3 -c "
import json, sys
m = json.load(open('$tmp_manifest'))
w = m.get('weighment', {})
d = m.get('direct_weighment', {})
if not w and not d:
    print('NONE')
else:
    tno = w.get('ticket_no') or d.get('ticket_no') or '?'
    vno = w.get('vehicle_no') or d.get('vehicle_no') or 'UNKNOWN'
    mat = w.get('material_name') or d.get('material_name') or 'UNKNOWN'
    dirn = w.get('direction') or d.get('direction') or 'UNKNOWN'
    print(f'{tno}|{vno}|{mat}|{dirn}')
" 2>/dev/null)

  if [ "$has_weighment" = "NONE" ]; then
    UNLABELED_COUNT=$((UNLABELED_COUNT + 1))
    if [ "$LABELED_ONLY" = true ]; then
      rm -f "$tmp_manifest"
      continue
    fi
    folder_name="${cycle_id}_UNLABELED"
  else
    LABELED_COUNT=$((LABELED_COUNT + 1))
    IFS='|' read -r tno vno mat dirn <<< "$has_weighment"
    # Clean names for folder
    vno_clean=$(echo "$vno" | tr ' /' '_')
    mat_clean=$(echo "$mat" | tr ' /' '_' | cut -c1-20)
    folder_name="T${tno}_${vno_clean}_${mat_clean}_${dirn}"
  fi

  EVENT_COUNT=$((EVENT_COUNT + 1))
  event_dir="$LOCAL_BASE/$folder_name"
  mkdir -p "$event_dir"

  # Copy manifest
  cp "$tmp_manifest" "$event_dir/manifest.json"

  # Generate _EVENT_INFO.txt
  python3 -c "
import json, sys

m = json.load(open('$tmp_manifest'))
w = m.get('weighment', {})
d = m.get('direct_weighment', {})

# Count files by type
arrivals = departures = motions = 0
for e in m.get('events', []):
    n = len(e.get('files', []))
    if e['type'] == 'arrival': arrivals = n
    elif e['type'] == 'departure': departures = n
    elif e['type'] == 'motion': motions += n

motion_events = m.get('motion_event_count', 0)
total = arrivals + departures + motions
label_source = 'active_session (direct)' if d else ('fuzzy_match (legacy)' if w else 'NONE')

def fmt_wt(v):
    if v is None: return '--'
    return f'{v:,.0f}'

lines = []
lines.append('WEIGHMENT TRAINING EVENT')
lines.append('=' * 60)
lines.append(f\"Cycle ID:      {m['cycle_id']}\")
lines.append(f\"Date:          {m.get('date', '?')}\")
lines.append(f\"Ticket #:      {w.get('ticket_no') or d.get('ticket_no') or '--'}\")
lines.append(f\"Vehicle:       {w.get('vehicle_no') or d.get('vehicle_no') or '--'}\")
lines.append(f\"Vehicle Type:  {w.get('vehicle_type') or '--'}\")
lines.append(f\"Direction:     {w.get('direction') or d.get('direction') or '--'}\")
lines.append(f\"Phase:         {w.get('phase') or d.get('phase') or '--'}\")
lines.append(f\"Material:      {w.get('material_name') or d.get('material_name') or '--'}\")
lines.append(f\"Category:      {w.get('material_category') or d.get('material_category') or '--'}\")
lines.append(f\"Supplier:      {w.get('supplier_name') or '--'}\")
lines.append(f\"Transporter:   {w.get('transporter') or '--'}\")
lines.append(f\"Driver:        {w.get('driver_name') or '--'}\")
lines.append(f\"PO Number:     {w.get('po_number') or '--'}\")
lines.append(f\"Purchase Type: {w.get('purchase_type') or '--'}\")
lines.append(f\"Shift:         {w.get('shift') or '--'}\")
lines.append(f\"Duration:      {m.get('duration_sec', '?')} sec\")
lines.append(f\"Max Weight:    {fmt_wt(m.get('captured_max_kg'))} kg\")
lines.append(f\"Gross Weight:  {fmt_wt(w.get('weight_loaded_kg'))} kg\")
lines.append(f\"Tare Weight:   {fmt_wt(w.get('weight_empty_kg'))} kg\")
lines.append(f\"Net Weight:    {fmt_wt(w.get('net_weight_kg'))} kg\")
lines.append(f\"Bags:          {w.get('bags') or '--'}\")
if w.get('quantity_bl'): lines.append(f\"Quantity BL:   {w['quantity_bl']}\")
if w.get('strength_pct'): lines.append(f\"Strength %:    {w['strength_pct']}\")
if w.get('seal_no'): lines.append(f\"Seal No:       {w['seal_no']}\")
lines.append(f\"Label Source:  {label_source}\")
lines.append(f\"Match Delta:   {w.get('weight_match_delta_kg', '--')} kg\")
lines.append('')
lines.append('ML TRAINING LABELS (what models learn from this)')
lines.append('=' * 60)
vno = w.get('vehicle_no') or d.get('vehicle_no') or '?'
vtype = w.get('vehicle_type') or '?'
mat = w.get('material_name') or '?'
dirn = w.get('direction') or '?'
wt = w.get('weight_empty_kg') or w.get('weight_loaded_kg') or '?'
lines.append(f'  1. TRUCK RE-ID:      {vno} -> anchor identity for triplet loss')
lines.append(f'  2. DIRECTION:        {dirn} -> classify forward/reverse movement')
lines.append(f'  3. VEHICLE TYPE:     {vtype} -> classifier target')
lines.append(f'  4. MATERIAL:         {mat} -> cargo classifier target')
lines.append(f'  5. WEIGHT:           {fmt_wt(wt) if isinstance(wt, (int,float)) else wt} kg -> regression target')
lines.append(f'  6. PLATE OCR:        {vno} -> OCR ground truth')
lines.append(f'  7. DRIVER PRESENT:   NOT LABELED YET')
lines.append('')
lines.append('FILES IN THIS EVENT')
lines.append('=' * 60)
lines.append(f'  Arrival:    {arrivals} photos (cam1 + cam2)')
lines.append(f'  Motion:     {motions} files — {motion_events} motion event(s)')
lines.append(f'  Departure:  {departures} photos (cam1 + cam2)')
lines.append(f'  Total:      {total} files')
lines.append('')
lines.append('EVENT TIMELINE')
lines.append('=' * 60)
for e in m.get('events', []):
    t = e.get('at', '?')[:19].replace('T', ' ')
    etype = e['type'].upper()
    wkg = e.get('weight_kg', '?')
    delta = f\" (delta {e['delta_kg']}kg)\" if 'delta_kg' in e else ''
    seq = f\" #{e['seq']}\" if 'seq' in e else ''
    lines.append(f'  {t} UTC  {etype}{seq}  {wkg} kg{delta}')

print('\n'.join(lines))
" > "$event_dir/_EVENT_INFO.txt" 2>/dev/null

  # Download sample photos (2 per camera per event type)
  for burst_n in $(seq 1 $PHOTOS_PER_CAM); do
    for cam in cam1 cam2; do
      for etype in arrival departure; do
        # Find matching file
        fname=$(eval $SSH_CMD "dir \"$(echo $cycle_dir | tr '/' '\\')\\${etype}*${cam}_burst${burst_n}.jpg\" /b 2>nul" 2>/dev/null | head -1 | tr -d '\r\n')
        if [ -n "$fname" ]; then
          eval $SCP_CMD "\"$FACTORY_USER@$FACTORY_IP:$cycle_dir/$fname\"" "$event_dir/${etype}_${cam}_${burst_n}.jpg" 2>/dev/null || true
        fi
      done
    done
  done

  rm -f "$tmp_manifest"
  echo "  [$EVENT_COUNT] $folder_name — $(ls "$event_dir"/*.jpg 2>/dev/null | wc -l | tr -d ' ') photos"

done

echo ""
echo "Done. $EVENT_COUNT events pulled ($LABELED_COUNT labeled, $UNLABELED_COUNT unlabeled)"
echo "Location: $LOCAL_BASE"
