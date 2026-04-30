import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()

RAW_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw"
WEIGHTS_DIR = Path(__file__).resolve().parent.parent.parent / "weights"


def _load_manifests() -> list[dict]:
    manifests = []
    for mf in sorted(RAW_DIR.glob("*/*/manifest.json")):
        try:
            data = json.loads(mf.read_text())
            manifests.append(data)
        except Exception:
            continue
    return manifests


@router.get("/stats")
def get_stats():
    manifests = _load_manifests()
    labeled = [m for m in manifests if m.get("weighment")]
    unlabeled = [m for m in manifests if not m.get("weighment") and not m.get("noise")]
    noise = [m for m in manifests if m.get("noise")]

    vehicles = set()
    for m in labeled:
        vno = m["weighment"].get("vehicle_no")
        if vno:
            vehicles.add(vno)

    total_photos = 0
    for m in manifests:
        for ev in m.get("events", []):
            total_photos += len([f for f in ev.get("files", []) if f.endswith(".jpg")])

    dates = sorted(set(m.get("date", "") for m in manifests if m.get("date")))

    reid_version = None
    reid_accuracy = None
    latest_checkpoint = sorted(WEIGHTS_DIR.glob("reid_head_v*.pt"))
    if latest_checkpoint:
        reid_version = latest_checkpoint[-1].stem

    return {
        "total_cycles": len(manifests),
        "labeled_cycles": len(labeled),
        "unlabeled_cycles": len(unlabeled),
        "noise_cycles": len(noise),
        "unique_vehicles": len(vehicles),
        "total_photos": total_photos,
        "date_range": {"first": dates[0] if dates else "", "last": dates[-1] if dates else ""},
        "model_status": {"reid": {"version": reid_version, "accuracy": reid_accuracy}},
    }


@router.get("/events")
def list_events():
    manifests = _load_manifests()
    events = []
    for m in manifests:
        w = m.get("weighment", {})
        d = m.get("direct_weighment", {})
        photo_count = sum(
            len([f for f in ev.get("files", []) if f.endswith(".jpg")])
            for ev in m.get("events", [])
        )
        events.append({
            "cycle_id": m["cycle_id"],
            "date": m.get("date", ""),
            "vehicle_no": w.get("vehicle_no") or d.get("vehicle_no"),
            "ticket_no": w.get("ticket_no") or d.get("ticket_no"),
            "direction": w.get("direction") or d.get("direction"),
            "vehicle_type": w.get("vehicle_type"),
            "material_name": w.get("material_name") or d.get("material_name"),
            "phase": w.get("phase") or d.get("phase"),
            "photo_count": photo_count,
            "labeled": bool(w),
            "weight_kg": w.get("weight_loaded_kg") or m.get("captured_max_kg"),
        })
    return events


@router.get("/events/{cycle_id}")
def get_event(cycle_id: str):
    for mf in RAW_DIR.glob(f"*/{cycle_id}/manifest.json"):
        data = json.loads(mf.read_text())
        cycle_dir = mf.parent
        photos = sorted([f.name for f in cycle_dir.iterdir() if f.suffix in (".jpg", ".jpeg", ".png")])
        return {"manifest": data, "photos": photos}
    raise HTTPException(404, "Cycle not found")


@router.get("/events/{cycle_id}/photos/{filename}")
def get_photo(cycle_id: str, filename: str):
    for cycle_dir in RAW_DIR.glob(f"*/{cycle_id}"):
        photo_path = cycle_dir / filename
        if photo_path.exists():
            return FileResponse(photo_path, media_type="image/jpeg")
    raise HTTPException(404, "Photo not found")
