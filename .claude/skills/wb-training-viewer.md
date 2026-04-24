# WB Training Data Viewer

**Trigger**: "show training data" or "pull training events"

## What it does

Pulls weighment training events from the factory server and organizes them on Desktop as human-readable folders:

```
~/Desktop/wb-training-events/
├── T576_KA01AN1742_Ethanol_OUTBOUND/
│   ├── _EVENT_INFO.txt          ← human-readable summary + ML labels
│   ├── manifest.json            ← raw manifest
│   ├── arrival_cam1_burst1.jpg
│   ├── arrival_cam2_burst1.jpg
│   ├── departure_cam1_burst1.jpg
│   └── departure_cam2_burst1.jpg
├── T577_POWERTRAC440_BAGASSE_INBOUND/
│   ├── _EVENT_INFO.txt
│   ├── manifest.json
│   └── ...
```

## How to invoke

```bash
# Pull all events from a date (default: today)
node scripts/pull-training-events.js

# Pull specific date
node scripts/pull-training-events.js --date 2026-04-18

# Pull only enriched (labeled) events
node scripts/pull-training-events.js --labeled-only
```

## _EVENT_INFO.txt format

```
WEIGHMENT TRAINING EVENT
========================
Cycle ID:      20260418_042554_8c04
Date:          2026-04-18
Ticket #:      576
Vehicle:       KA01AN1742
Vehicle Type:  40 KL
Direction:     OUTBOUND
Phase:         tare
Material:      Ethanol
Category:      OUTBOUND
Supplier:      MASH BIO-FUELS PRIVATE LIMITED
Transporter:   L M R
Driver:        SOHEL AHMAD
Shift:         First Shift
Duration:      249 sec
Max Weight:    14,910 kg
Gross Weight:  -- kg
Tare Weight:   14,810 kg
Net Weight:    -- kg
Bags:          --
Label Source:  active_session (direct) | fuzzy_match (legacy)
Match Delta:   100 kg

ML TRAINING LABELS (what models learn from this)
================================================
① TRUCK RE-ID:      KA01AN1742 → anchor identity for triplet loss
② DIRECTION:        OUTBOUND → arrival=forward-in, departure=forward-out
③ VEHICLE TYPE:     40 KL → classifier target
④ MATERIAL:         Ethanol → cargo classifier target
⑤ WEIGHT:           14,810 kg → regression target
⑥ PLATE OCR:        KA01AN1742 → OCR ground truth
⑦ DRIVER PRESENT:   NOT LABELED

FILES IN THIS EVENT
===================
arrival:   20 photos (cam1×10 + cam2×10)
motion:    4 files (2 videos + 2 stills) — 1 motion event(s)
departure: 20 photos (cam1×10 + cam2×10)
Total:     44 files
```

## Script location

`factory-server/scripts/pull-training-events.js`

## Dependencies

- SSH access to factory server (sshpass)
- Factory server running with training capture active
