# WB Vision — Truck-Identity Verification (architecture, not yet built)

> **Status (2026-04-17)**: Step 1 (side-by-side photo viewer for operator) DEPLOYED to factory PCs. Step 2 (model + score) DESIGN ONLY. Architecture below was settled after looking at real photos and probing the cameras tonight.
>
> **Origin**: distilled from sugar-WB anti-cheat brainstorm (`.claude/plans/serene-inventing-babbage.md` + memory `project_sugar_wb_anticheat.md`). Ethanol WB is the proving ground / training-data source. Sugar WB is the eventual enforcement target.

---

## 1. Goals

1. **Build a truck-identity verification model** that scores how confident we are that the truck on the scale at the 2nd weighment is the same truck that was on the scale at the 1st weighment. Score 0–100.
2. **Collect MSPIL-specific training data** passively from ethanol WB while operators are still being trained on the new system. Ethanol = trusted, no enforcement, just dataset accumulation.
3. **Deploy the model to enforcement** at sugar WB when sugar goes live (~6 months). Sugar = direct farmer suppliers, fraud risk, enforcement matters.

### 1.1 Multi-task training scope (added 2026-04-18 per Saif)

**Same captured data trains multiple models** — we're not changing what we capture, just labeling more things from the same manifest. Each cycle's `manifest.json` becomes the labels file for ALL of these:

| Model | Input frames | Label source (from manifest.weighment) | Use case |
|---|---|---|---|
| **Truck Re-ID** (primary) | crop of truck/trolley body | `vehicle_no` (anchor=positive same id, negative=different id) | Sugar-WB anti-cheat |
| **Direction classifier** | event-tagged clip | `events[].type` (arrival = forward in, departure = forward out) | Reverse-on-scale fraud (T6) |
| **Truck-type classifier** | crop of full vehicle | `vehicle_type` (Truck 14W / 10W / 6W / Tractor Trolley / Pickup) | Auto-fill gate entry, audit anomalies |
| **Material classifier** | crop of trailer / load | `material_name` + `material_category` | Cross-check operator-entered material |
| **Weight regression** | crop of loaded trailer (gross-phase only) | `weight_loaded_kg` | Sanity-check the scale reading |
| **Bag-count regression** | top-down cargo view | `bags` | Catch count fraud (declared vs visible bags) |
| **Plate OCR** | crop of plate region | `vehicle_no` | Bonus signal when plate is readable |

#### Indian plate format (use for OCR validation)

All Indian commercial plates follow a fixed pattern. Reject any OCR read that doesn't match — kills 90% of false positives without ML:

```
[A-Z]{2}  \d{1,2}  [A-Z]{1,3}  \d{1,4}
state    district   series      number

Examples:
  UP 71 AT 0207     Uttar Pradesh, district 71, series AT, plate 0207
  HR 39 F 0791      Haryana, district 39, series F, plate 0791
  MP 04 BC 4662     Madhya Pradesh, district 04, series BC, plate 4662
  RJ 09 KL 1234     Rajasthan, district 09, series KL, plate 1234
```

**Use cases**:
- Reject OCR reads that don't match (e.g. "ZZ## ZZ ####" = bad read, retry/skip)
- Disambiguate confusable chars (`0` vs `O`, `1` vs `I`, `8` vs `B`) using positional rules — letters in slots 1-2, 5-7; digits in 3-4, 8-11
- Cross-check vehicle_no entered by operator at gate entry against OCR result — flag mismatch as fraud signal

#### Ethanol-tanker special case (added 2026-04-18 per Saif)

Ethanol outbound trucks at MSPIL are **road tankers** — distinct from box trailers (sugar/grain inbound). They have unique training characteristics:

| Aspect | Tanker | Box trailer |
|---|---|---|
| Body shape | Cylindrical, horizontal | Rectangular, painted decoration |
| Capacity painted on side | Usually yes (e.g. "40000 LTR") | No |
| Tricolor flag | Common (interstate) | Common |
| Cargo always | Liquid (ethanol here) | Variable (corn, DDGS, etc.) |
| Material classifier needed | NO (always ethanol) | YES |

**Tanker capacity OCR** is a free additional signal:
- Format: `\d{3,5}\s*(LTR|L)` painted on tanker side, often with "CAPACITY" prefix
- Cross-validate against operator-entered `quantity_bl` (volume in BL): if `quantity_bl > capacity_ltr`, fraud signal (overload claim)
- Capacity is fixed per tanker — repeat trucks accumulate confidence in the OCR read

**Manifest fields for ethanol tankers** (now populated by enrichment):
- `quantity_bl` — bulk litres loaded (operator entered)
- `strength_pct` — alcohol strength %
- `seal_no` — tanker seal number (chain-of-custody label, also OCR-able from seal photo)

**Visual classifier — `vehicle_type` values** to expect from training:
- `Tanker` (cylindrical, ethanol/liquid)
- `Truck 14W`, `Truck 10W`, `Truck 6W` (axle-count distinct from above)
- `Tractor Trolley` (open trolley + tractor, plateless usually)
- `Pickup` (small light vehicle, rare on this WB)

**Implication for capture**: zero — the existing Phase A capture pipeline already produces enough data for ALL these models. Just label richer in the manifest.

Models trained later from the SAME corpus, no re-collection needed.

**Non-goals (explicit)**:
- Not building cloud AI. Everything runs on the factory server (offline-survivable).
- Not changing the ethanol operator workflow. Operators are being trained — adding score badges/PIN gates would confuse them.
- Not solving plate-only ID. Plates are an additional signal, not the primary one (many plates dirty/missing).
- Not pre-registering carts. Greenfield sugar WB doesn't have control over empty cart access.

---

## 1.5 Sugar-specific reality (added 2026-04-17 per Saif)

**The dominant sugar case is the hardest case for vision.** Most sugar cane at MSPIL arrives on:
- **Plateless trolleys** — bullock carts, small farmer trolleys with no number plate, or plates so dirty/old they're unreadable.
- **Tractor + trolley combos** where the **tractor changes between 1st and 2nd weighment** — normal workflow, not fraud. Farmer drops trolley, tractor goes home, different tractor returns later (or the same tractor returns hours/days later).
- **Long time gaps** between weighments — plant stops, monsoon, power trip, queue. Hours to days, not minutes.
- **Decoration / load state changes** — cane piled high at gross, trolley empty + tarp loose at tare.

**Implications for the model design**:

| What this kills | What it forces |
|---|---|
| Plate OCR as primary signal — most sugar trolleys have no readable plate. Drops to "rare bonus when it fires". | **Vision re-ID on the trolley body** is the SOLE primary signal. Cart wheels, side panels, paint, dents, bracket positions. |
| Naive "same vehicle" assumption — tractor at gross ≠ tractor at tare is **normal** for sugar, not fraud. | Model must compare **TROLLEY** features (the load-carrying vehicle), explicitly ignoring the tractor cab. YOLOv8 detection class needs to be "trolley" or "rear-of-vehicle", not just "vehicle". |
| Short-time-gap simplifications — sugar weighment can span days, not hours. | Robustness to lighting, weather, dust accumulation. Storage retention must keep gross embedding for at least 7 days. |
| "Truck pulls onto scale and stays" assumption from ethanol. | Sugar workflow: trolley dropped on scale, tractor leaves, returns later. Weight goes 0 → max → 0 (tractor leaves) → max again later (tractor returns to take empty trolley). State machine must handle multi-arrival pattern. |

**Why this is also the highest-value case**: this is where the fraud happens. Plateless trolleys + tractor swaps is exactly the surface where T3 (truck swap) and T7 (same trolley + 2 tokens) attacks live. If we crack this, we crack sugar.

**Critical training-data implication**: ethanol photos (mostly plated trucks, mostly same-tractor) UNDER-REPRESENT this case. We may need to specifically collect sugar-trolley training data once sugar WB is at the testing stage. Start that earlier than Phase E if possible.

---

## 1.7 Focus on the SCALE PLATFORM, not the frame (added 2026-04-17 per Saif)

**The problem in one image**: cam2 ("Ethanol Kata Front") catches a 5+ truck queue parked nose-to-tail in the background. Only ONE of those vehicles is actually ON the scale platform at any given time. Naive YOLO on the full frame returns 6 truck bboxes and has no idea which is the one we're weighing.

**Mandatory pre-step before YOLO/embedding**: **scale-platform region-of-interest (ROI) mask.**

The scale platform is a **fixed rectangle / polygon** in each camera's frame (the camera doesn't move). We define this ROI ONCE per camera (a one-time calibration step) and then:

```
RAW FRAME → mask everything outside platform ROI → YOLO detect → embed
```

**Why this works**:
- Camera is bolted in place — platform pixels never move (until someone repositions the camera, in which case re-calibrate).
- Anything outside the ROI is queue / wall / sky / dirt — definitionally not the truck being weighed.
- Drops false positives by ~80% in a busy yard.
- Drops compute too — YOLO runs on ~30% of the image instead of 100%.

**Alternative (post-YOLO filter, simpler but less clean)**: detect all vehicles, keep only those whose bbox bottom-edge intersects the platform polygon. Same effect, slightly higher compute, easier to tune visually.

### Calibration UX

Quick web tool at `factory-server` route `/admin/camera-roi`:
- Show latest snapshot from each camera
- Operator draws polygon over the scale platform with mouse
- Save 4-corner polygon to `data/cam-roi/{camera}.json`
- Re-runs whenever someone clicks "redraw" (after camera maintenance)

Format:
```json
{
  "camera": "192.168.0.239",
  "roi_polygon": [[820, 380], [1750, 280], [2400, 1100], [600, 1380]],
  "calibrated_at": "2026-04-17T22:55:00+05:30",
  "calibrated_by": "saif"
}
```

### Bonus signal — HUD overlay OCR

The cam2 frame has a **burnt-in HUD at the bottom**:
```
GROSS  TARE  NET           TIME
10,750 6,220 4,530         05:17 pm
```

This appears to come from a Dahua "Smart Encode" overlay tied to the live weight feed (not from our cameraCapture code). If we OCR this HUD region (fixed pixel coords, easy), we get a SECOND independent reading of the scale weight at the moment of capture — a sanity check against our serial scale reading. Mismatch = something wrong with one of the two systems.

Drops to "investigate later" — not core to vision matching, but free signal.

### Re: bf48de98 (the tractor-only-tare from earlier)

This image confirms it: at MSPIL ethanol the **tractor is the puller, the trolley/truck-body is the weight carrier**. Tractor on its own on the scale is a legitimate "tare the tractor independently" event. Not fraud. Add to training-data labels: tractor↔trolley swaps within a weighment_id are NORMAL, not anomalous.

(Sugar same: tractor swaps between gross and tare are normal. Trolley identity is what we re-ID.)

---

## 2. Hard constraints (non-negotiable, learned tonight)

| Constraint | Source / why |
|---|---|
| **Snap endpoint = 1080P max** | Dahua firmware caps `SnapFormat[*].Video.ResolutionTypes=1080P`. Cannot bump via ISAPI. |
| **Snap endpoint = quality 5/6 fixed** | setConfig silently rejects `Quality=6` on SnapFormat (admin perms confirmed). |
| **Cameras can do 2560×1440** | MainFormat runs 2560×1440 @ H.265 @ 25fps, exposed via RTSP. Only path to 4MP frames. |
| **Factory runs 24/7, no maintenance window** | Per `factory-operations.md`. Anything we add must be fire-and-forget, never block weighment. |
| **No cloud dependency** | Vision must work even if internet is down. Cloud is post-facto sync only. |
| **Operator UX must not change for ethanol** | Per Saif 2026-04-17. Ethanol team is in training mode. |
| **No new operator-facing UI on the factory app yet** | Score badge / PIN gate comes later, when sugar goes live. Now = silent dataset collection only. |

---

## 3. Two parallel data paths (the core architecture decision)

```
                     ┌─────────────── OPERATOR PATH (already live, unchanged) ──────────────┐
                     │                                                                       │
                     │  HTTP snapshot.cgi  →  1080p JPEG (~250KB)  →  data/snapshots/{id}/  │
                     │       ↑                                                ↓               │
                     │  (4 photos per weighment — gross_camN, tare_camN)                     │
                     │                                                                       │
                     │  Used by:  FirstWeighmentPhotos.tsx (TareWeighment, GrossWeighment)  │
                     │  Status:   shipped tonight, no changes                                │
                     └───────────────────────────────────────────────────────────────────────┘

                     ┌─────────────── TRAINING PATH (to build, hidden from operator) ──────┐
                     │                                                                       │
                     │  RTSP main stream  →  ffmpeg 2-sec clip  →  data/videos/{id}/        │
                     │       ↑                                                ↓               │
                     │  (4 clips per weighment — gross_camN.mp4, tare_camN.mp4)             │
                     │                                                                       │
                     │  Storage: ~6 MB/weighment. ~600 MB/day @ 100 trucks.                  │
                     │  Retention: rolling 90 days on factory C: drive (~55 GB total).      │
                     │                                                                       │
                     │  Nightly job:  ffmpeg extracts best 5 frames per clip                │
                     │                → data/training-corpus/{date}/{weighmentId}/...        │
                     │                + manifest CSV (weighmentId, vehicleNo, gross↔tare)    │
                     │                                                                       │
                     │  Then later (offline, on dev machine):                                │
                     │    YOLOv8-n  → crop trucks                                            │
                     │    DINOv2-base + re-ID head → embed                                   │
                     │    Triplet loss training: anchor=gross, positive=tare same id,        │
                     │                           negative=different id same day              │
                     │    Output: fine-tuned re-ID head (~10 MB)                             │
                     │                                                                       │
                     │  Deploy fine-tuned model → factory-server vision microservice         │
                     │   (Python Flask, runs on factory's idle CPU, ~65 GB RAM headroom)     │
                     └───────────────────────────────────────────────────────────────────────┘
```

**Key separation**: operator path stays exactly as it is today. Training path is added in parallel. Failure of training path NEVER affects operator path. If RTSP capture is broken, weighment still completes, snapshots still save, operator UI still works.

---

## 4. Files to be added (proposed, not yet written)

```
factory-server/
├── src/
│   └── services/
│       ├── cameraCapture.ts          (existing — UNCHANGED)
│       └── videoCapture.ts           (NEW — RTSP capture via ffmpeg)
├── prisma/schema.prisma              (additive: Weighment.videoPaths Json?)
└── data/
    ├── snapshots/                    (existing — UNCHANGED)
    └── videos/                       (NEW)
        └── {weighmentId}/
            ├── gross_cam1.mp4
            ├── gross_cam2.mp4
            ├── tare_cam1.mp4
            └── tare_cam2.mp4

factory-server/scripts/
└── extract-training-frames.ps1       (NEW — nightly cron, ffmpeg frame extract)

factory-server/vision/                (NEW Python microservice — Phase 3 deploy time)
├── app.py                            (Flask, /embed /compare /health)
├── embedder.py                       (DINOv2 + fine-tuned re-ID head)
├── yolo_crop.py                      (YOLOv8-n truck detection)
├── ocr_plate.py                      (PaddleOCR plate text — orthogonal signal)
├── requirements.txt
└── models/                           (downloaded weights, ~500 MB total)
    ├── dinov2-base/
    ├── yolov8n.pt
    └── reid_head_v1.pt               (fine-tuned on MSPIL data)
```

---

## 5. Phasing — what gets built when

### Phase A — DATA COLLECTION (next 7 days)
- Add `videoCapture.ts` to factory-server. Fire-and-forget RTSP pull alongside existing `captureSnapshots()`.
- Add `Weighment.videoPaths Json?` column (nullable, additive — safe per `prisma db push` rules).
- Verify ffmpeg present on factory PC; install if not (~30 MB).
- Deploy. Verify videos saving to `data/videos/`. **No operator UI changes.**
- After 3 days, eyeball ~5 weighments' worth of video to confirm capture quality.

### Phase B — DATASET BUILD (~30-60 days passive)
- Cron job runs nightly: `extract-training-frames.ps1`
  - For each video clip: ffmpeg picks 5 frames (sharpness-scored, evenly spaced).
  - Build `data/training-corpus/{date}/manifest.csv`:
    ```
    weighmentId, vehicleNo, gross_frames[], tare_frames[], same_truck_label=true
    ```
- Weekly rsync corpus snapshot to dev machine (Mac) — keeps factory disk clean.
- Target: ~10K labelled pairs after 30 days, ~30K after 90 days.

### Phase C — MODEL TRAINING (offline, on dev machine, repeatable)
- Notebook `notebooks/train_truck_reid.ipynb` (NEW, in repo).
- Pipeline: YOLOv8 crop → DINOv2-base embed → re-ID head → triplet loss.
- Train on rolling 30-day window, eval on held-out latest 7 days.
- Metric: Top-1 accuracy on "same truck" pairs vs random "different truck" pairs.
- Target: ≥95% Top-1 by Day 30, ≥98% by Day 90.

### Phase D — FACTORY DEPLOY (when accuracy good, ~Day 60-90)
- Build Python microservice `factory-server/vision/`.
- Background scoring: at 2nd weighment, score the 4 fresh photos against the 4 first-weighment photos. Store score. **Still no operator-facing change** — score logged silently.
- Daily report: how many weighments would have flagged YELLOW / RED if enforcement was on. Eyeball with Saif. Tune bands.

### Phase E — SUGAR WB ENFORCEMENT (when sugar WB commissions, ~Day 180+)
- Operator UI (the new sugar WB app, separate codebase TBD) shows the score badge.
- RED triggers existing `enforceWeighmentRules` PIN gate.
- Plate-OCR sidecheck wired in.
- Audit + retraining loop active.

---

## 6. Why each model choice

| Model | Why this one |
|---|---|
| **YOLOv8-n** | Tiny (~6 MB), CPU-fast (~50ms/frame), best-of-class for general object detection. We just need "find the truck box" — n-size is plenty. |
| **DINOv2-base** | Self-supervised vision transformer from Meta, 768-dim features. Best general-purpose image embedding for re-ID-style tasks where we don't have huge labelled data. Bigger than DINOv2-small but worth it for cross-time-of-day lighting tolerance (the e84b0cd7 case: gross daylight, tare night). |
| **Triplet loss re-ID head** | Tiny MLP on top of DINOv2 features. Trains on (anchor, positive, negative) tuples. Frozen DINOv2 base means we don't need GPU for fine-tuning. Standard person/vehicle re-ID approach. |
| **PaddleOCR (plate text)** | Best-in-class open-source for Indian/Latin plates. Runs on CPU. Treated as orthogonal signal, not primary — many MSPIL trucks have dirty/obscured plates. |
| **ffmpeg** | Standard, runs everywhere, well-known frame extraction. Sharpness scoring via Laplacian variance is one line of OpenCV. |

**Explicitly NOT using**:
- Cloud APIs (Gemini Vision, OpenAI) — design constraint
- Custom CNNs from scratch — no labelled data at scale, would waste effort vs DINOv2 features
- ANPR-as-primary — plate visibility too inconsistent

---

## 7. Storage plan (factory C: drive)

| Item | Per weighment | Per day @ 100 trucks | Per 90 days | Notes |
|---|---|---|---|---|
| Existing snapshots | ~1 MB | ~100 MB | ~9 GB | Current — no change |
| New videos (2 sec ×4 cams) | ~6 MB | ~600 MB | ~54 GB | NEW |
| Training corpus (extracted frames, dedup, JPEG) | ~2 MB | ~200 MB | ~18 GB | NEW, generated nightly from videos |
| **Total new** | ~8 MB | ~800 MB | ~72 GB | Free on C: per skill doc: ~194 GB → headroom OK |

**Retention** (revised 2026-04-18 per Saif — train and delete, don't hoard):
- **Active rolling corpus**: 21 days (~42 GB at full quality). Enough for training pass + buffer for new patterns.
- **Validation/regression sample**: 5–10% random sample kept FOREVER (~5 GB). Required to catch model regression after re-training.
- **Model files**: ~350 MB (DINOv2 base + tiny re-ID head). Kept forever, version-tagged.
- **Cleanup cron**: nightly script deletes anything in `data/videos/motion/` older than 21 days that wasn't sampled into the validation set. NOT YET BUILT — implement before disk hits 50%.

Total long-term footprint after first training pass: ~5–6 GB (validation + model), down from the original 200 GB plan.

**Backup**: validation sample rsync'd to dev machine weekly. Bulk video corpus NOT backed up (it's intentionally short-lived — recreatable in the next 21 days if model needs re-training).

---

## 8. Failure modes and fallbacks

| Failure | Fallback | Notes |
|---|---|---|
| RTSP camera unreachable at capture time | Skip silently, log warning, snapshot still works | Operator workflow unaffected. |
| ffmpeg crash on a clip | Mark clip corrupt in manifest, exclude from training | Training pipeline tolerant of missing clips. |
| Disk fills up | Rotate oldest 7-day window of videos, alert via Telegram | Set hard cap at 80% disk. |
| Vision microservice down | Score = NULL on Weighment row, no enforcement | Phase E only — no operator block. |
| Model accuracy drops below 90% on golden test | Auto-revert to previous model checkpoint | Versioned model files, git-style. |
| Camera stream config drifts (someone changes via web UI) | Daily script re-asserts known-good config via setConfig | Idempotent self-heal. |

---

## 9. Open questions (need Saif's call before Phase A code)

1. **Video duration: 2 sec or 5 sec?** 2 = lighter (~1.5 MB/clip), captures arrival. 5 = heavier (~4 MB/clip), captures full settle + plate-readable angles. Recommend **2 sec for v0, evaluate after 3 days of capture**.

2. **RTSP main stream or sub stream?**
   - Main: 2560×1440 H.265 25fps (rich, what we want)
   - Sub: D1/CIF (low-res, useless)
   - Recommend **main**. If CPU on factory server gets pegged during ffmpeg, fall back to sub at deploy time.

3. **Where does ffmpeg run — at capture time or nightly?**
   - **At capture time**: ffmpeg pulls 2 sec from RTSP, saves clip. Background, fire-and-forget.
   - **Nightly**: pulls clip from disk, extracts 5 frames, saves to corpus.
   - Recommend **both** — capture writes the .mp4, nightly batch extracts frames.

4. **Should we also save 1 high-res still per camera per weighment** (via RTSP `-frames:v 1`), independent of the video? Backup in case video extraction fails. Storage: +1 MB per weighment. Recommend **yes**, cheap insurance.

5. **bf48de98 tractor-only-tare from earlier — legitimate or fraud-ish?** Affects how we label that pair in training. If legitimate, it's a hard "same truck" example (model must learn cab-only ≈ trailer+cab). If fraud, exclude from training set.

---

## 10. What we're NOT doing in Phase A (deliberately)

- Not training the model. Just collecting.
- Not changing the operator UI. Just collecting.
- Not running DINOv2 / YOLO / PaddleOCR on the factory server. Just collecting.
- Not pushing scores to cloud. Just collecting.

Phase A is the boring foundation. If we get this right, Phases B-E are mechanical.

---

## 11. Pre-flight checks before any Phase A code change

- `factory-operations.md` Part A — read every incident
- `prisma db push` will be additive (1 nullable JSON column) — safe per CLAUDE.md rules
- Local tsc + vite build must pass (deploy.sh does this anyway)
- Verify ffmpeg presence: `where ffmpeg` on factory PC. Install if missing.
- Verify RTSP URL works from factory: `ffmpeg -y -t 2 -rtsp_transport tcp -i rtsp://admin:admin123@192.168.0.233:554/cam/realmonitor?channel=1&subtype=0 test.mp4` (Dahua URL pattern, may need adjustment).
- Capture test from one weighment, eyeball clip quality before scaling.

---

## 12. Weight-triggered motion capture (added 2026-04-17 per Saif)

**The insight**: snapshots and 2-sec clips are STATIC samples. The most information-dense moment is when the truck is **moving** onto / off the scale. Capture those by triggering on the weight stream itself, not on operator button click.

### State machine (runs on factory-server, listens to existing `/api/scale/weight`)

```
state: IDLE
loop every 200ms:
  read weight w
  IDLE       (w < 50)        → ok
  IDLE       w crosses 1000  → state=RISING, ffmpeg start "arrival.mp4"
  RISING     w stable 1+ sec → state=PEAK, ffmpeg stop "arrival.mp4", save
  PEAK       (await operator gross capture in main flow — separate event)
  PEAK       w drops past peak/2 → state=FALLING, ffmpeg start "departure.mp4"
  FALLING    w < 50          → state=DONE, ffmpeg stop "departure.mp4", save
  DONE       associate both clips with most-recent gross weighment (best-effort match)
```

### Why this is the most valuable training data

- **Identity** signal: snapshots (we have today)
- **Texture/perspective** signal: 2-sec video clips at gross/tare (Section 3)
- **Motion/direction** signal: arrival.mp4 + departure.mp4 (this section)

The motion signal is what kills T6 (reverse-on-scale attack) directly — the model literally learns what forward vs backward motion looks like in MSPIL's specific camera angles.

### v0 scope (storage-optimized)

- **1 camera only** (cam2 = "Ethanol Kata Front") — catches cab→trailer arrival sequence
- **Sub-stream** (D1, ~700×576 H.265) — sub-stream gives plenty of resolution for motion vectors
- **~3 sec clips** typical (truck takes 2-4 sec to settle / depart)
- **2 clips per weighment**: arrival + departure
- **~1.5 MB per clip** = ~3 MB per weighment
- **~300 MB/day @ 100 trucks** = ~27 GB / 90 days. Comfortable on factory C: drive.

Storage trap (the version we are NOT building):
- 4 cams × 5 sec × 2560×1440 main stream → ~80 MB/weighment → 720 GB / 90 days. Disk dies.

### Where it stores

```
data/videos/{weighmentId}/
  ├── arrival.mp4         (NEW, weight-triggered, sub-stream front cam)
  ├── departure.mp4       (NEW, weight-triggered, sub-stream front cam)
  ├── gross_cam1.mp4      (existing plan from Section 3, button-triggered, 2-sec main stream)
  ├── gross_cam2.mp4
  ├── tare_cam1.mp4
  └── tare_cam2.mp4
```

Plus existing `data/snapshots/{weighmentId}/` (4 stills, unchanged).

### Edge cases

| Case | Behavior |
|---|---|
| Truck pulls on, backs off, pulls on again | Two RISING events. Save both as `arrival_1.mp4`, `arrival_2.mp4`. Audit signal — fraud indicator. |
| Weight oscillates around 50 kg threshold (windy day) | Hysteresis: enter RISING at 1000 kg, exit IDLE at 100 kg. Wider band kills jitter. |
| ffmpeg fails to start | Log warning, set state forward anyway. Operator capture still works. |
| Weight stream stale (no data from scale for 5+ sec) | State machine pauses. Resumes when fresh data returns. |
| Two weighments overlap (one truck on, another at gate) | Single state machine = one truck at a time. The plant flow guarantees this — only one truck on scale at a time. |

### Implementation notes

- New module: `factory-server/src/services/weightTriggeredCapture.ts` — runs alongside `syncWorker.ts` etc.
- Polls `/api/scale/weight` (proxies to weighbridge Flask) every 200ms — same cadence as frontend.
- Uses ffmpeg subprocess via `child_process.spawn`.
- RTSP sub-stream URL: `rtsp://admin:admin123@192.168.0.239:554/cam/realmonitor?channel=1&subtype=1` (subtype=1 for sub-stream on Dahua).
- Match clips to weighmentId via timestamp window (clip ended within ±60s of operator capture event).
- Same fire-and-forget rule: failures NEVER block the operator flow.

### Why we still need the button-triggered captures from Section 3

Weight-triggered video captures only the MOVING phase. Static plate-readable, full-truck-visible frames come from the button-triggered RTSP grab + existing snapshot.cgi. Both layers feed the training corpus.

---

## 13. Appendix — what we learned about the cameras tonight

- **Brand**: Dahua (not Hikvision as previously assumed in `weighbridge.md` Part A.6 — DOC NEEDS UPDATE).
- **Model capabilities**: 2560×1440 main stream, 1080p snap (firmware-locked).
- **Auth**: digest auth on all endpoints, basic auth works on /cgi-bin/snapshot.cgi only.
- **Configuration API**: `/cgi-bin/configManager.cgi?action=getConfig&name=Encode` (works), `setConfig` works for some configs (LocalNo) but silently rejects Snap.Quality changes.
- **RTSP URL pattern**: `rtsp://admin:admin123@{ip}:554/cam/realmonitor?channel=1&subtype=0` (Dahua standard, untested for these specific units yet).
- **Both cameras**: 192.168.0.233 (Ethanol Kata Back) and 192.168.0.239 (Ethanol Kata Front).
