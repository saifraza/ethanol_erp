---
name: wb-vision
description: Pull and view weighbridge truck-vision training data from the factory server, and explain the truck-identity anti-cheat model being built from it. Use when the user says "show training data", "pull training events", "wb vision", "truck identity", "truck re-ID", "anti-cheat", or asks about the RTSP/camera capture pipeline at the ethanol weighbridge.
when_to_use: "show training data; pull training events; wb-training-events folder; weighment training event; truck re-ID / re-identification; truck-identity verification; anti-cheat / truck swap / reverse-on-scale; RTSP / Dahua camera capture; YOLOv8 / DINOv2 / PaddleOCR plate OCR; what models the captured frames train"
---

# WB Vision — training-data viewer + truck-identity anti-cheat

Two things live here:
1. **LIVE action** (this file): pull weighment training events off the factory server onto Desktop as human-readable folders, so you can eyeball them.
2. **DESIGN** (`reference.md`): the truck-identity verification / anti-cheat architecture that those frames train. **Not yet built** beyond Step 1 (operator photo viewer). Read `reference.md` before proposing any vision/ML code.

## Hard rules

- **Operator path is sacred.** The training/RTSP capture path is added in parallel and its failure must NEVER block a weighment, a snapshot, or the operator UI. Fire-and-forget only.
- **No operator UI change for ethanol.** Ethanol WB is the trusted training-data source while operators are in training. No score badges / PIN gates here — enforcement is a future sugar-WB concern.
- **No cloud dependency.** Everything runs on the factory server, offline-survivable. No Gemini/OpenAI vision.
- **`vision/` is gitignored — never re-add it to origin.** ML weights, `.venv`, training data, research code stay local (see root `CLAUDE.md` → "Local-only directories"). Share via SCP/shared drive, not this repo.
- **Factory DB is read-only for Claude.** Don't INSERT/UPDATE/DELETE on factory data while poking around.

## LIVE action — pull / show training events

Pulls weighment training events from the factory server and lays them out on Desktop as readable folders:

```
~/Desktop/wb-training-events/
├── T576_KA01AN1742_Ethanol_OUTBOUND/
│   ├── _EVENT_INFO.txt          ← human-readable summary + ML labels
│   ├── manifest.json            ← raw manifest (the labels file for ALL models)
│   ├── arrival_cam1_burst1.jpg
│   ├── arrival_cam2_burst1.jpg
│   ├── departure_cam1_burst1.jpg
│   └── departure_cam2_burst1.jpg
├── T577_POWERTRAC440_BAGASSE_INBOUND/
│   ├── _EVENT_INFO.txt
│   ├── manifest.json
│   └── ...
```

### How to invoke

```bash
# Pull all events from a date (default: today)
node scripts/pull-training-events.js

# Pull a specific date
node scripts/pull-training-events.js --date 2026-04-18

# Pull only enriched (labeled) events
node scripts/pull-training-events.js --labeled-only
```

Script: `factory-server/scripts/pull-training-events.js`
Dependencies: SSH access to the factory server (sshpass) + factory server running with training capture active. SSH/connection details: see `.claude/skills/factory-operations/reference.md` (credentials live out-of-git in `~/Desktop/infra/fleet.md`).

### `_EVENT_INFO.txt` format

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

## Anti-cheat goal (summary — full design in `reference.md`)

Build a **truck-identity verification model** that scores 0–100 how confident we are the truck on the scale at the 2nd weighment is the same one as at the 1st. Ethanol WB = passive, trusted **training-data source** (no enforcement). The eventual **enforcement target is sugar WB** (~6 months out): direct farmer suppliers, plateless trolleys, tractor swaps — the real fraud surface.

The same captured manifest is the labels file for **multiple models** (truck re-ID, direction, vehicle-type, material, weight regression, bag-count, plate OCR) — no re-collection, just richer labels.

Key facts (do not paraphrase — see `reference.md` for the rest):
- Cameras are **Dahua** (NOT Hikvision): `192.168.0.233` (Ethanol Kata Back) + `192.168.0.239` (Ethanol Kata Front). Main stream 2560×1440 H.265 25fps via RTSP; snap endpoint firmware-locked to 1080p.
- Primary signal for sugar is **vision re-ID on the trolley body**, not the plate (plates dirty/missing) and not the tractor cab (tractor swaps between gross/tare are NORMAL, not fraud).
- Mandatory pre-step before YOLO/embedding = **scale-platform ROI mask** (a busy yard has 5+ queued trucks in frame; only one is on the scale).
- Model stack: **YOLOv8-n** (crop) → **DINOv2-base** (embed) → triplet-loss **re-ID head** (~10 MB) → **PaddleOCR** as an orthogonal plate signal. ffmpeg for frame extraction.

Read **`reference.md`** for the full architecture: multi-task scope, Indian-plate OCR format, ethanol-tanker special case, sugar-specific reality, the two parallel data paths, weight-triggered motion capture, phasing (A–E), storage/retention, failure modes, and open questions.
