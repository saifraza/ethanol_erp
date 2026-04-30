import json
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter()

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "backend" / "config"
RAW_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw"
PROCESSED_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "processed"


@router.get("/roi")
def get_roi():
    roi_file = CONFIG_DIR / "camera_roi.json"
    if roi_file.exists():
        return json.loads(roi_file.read_text())
    return {"cam1": {"roi_polygon": []}, "cam2": {"roi_polygon": []}}


@router.get("/roi/frame/{cam}")
def get_roi_frame(cam: str):
    for date_dir in sorted(RAW_DIR.iterdir(), reverse=True):
        if not date_dir.is_dir():
            continue
        for cycle_dir in date_dir.iterdir():
            for f in cycle_dir.iterdir():
                if f.suffix == ".jpg" and cam in f.name:
                    return FileResponse(f, media_type="image/jpeg")
    return {"error": "No sample frame found. Pull data from factory first."}


@router.post("/roi/save")
def save_roi(data: dict):
    roi_file = CONFIG_DIR / "camera_roi.json"
    existing = json.loads(roi_file.read_text()) if roi_file.exists() else {}
    existing[data["camera"]] = {"roi_polygon": data["roi_polygon"]}
    roi_file.write_text(json.dumps(existing, indent=2))
    return {"saved": True}


@router.get("/preprocess/status")
def preprocess_status():
    crops_dir = PROCESSED_DIR / "crops"
    total_crops = sum(1 for _ in crops_dir.rglob("*.jpg")) if crops_dir.exists() else 0
    vehicles = [d.name for d in crops_dir.iterdir() if d.is_dir()] if crops_dir.exists() else []
    trainable = sum(1 for v in vehicles if len(list((crops_dir / v).glob("*.jpg"))) >= 3)

    total_frames = 0
    for mf in RAW_DIR.glob("*/*/manifest.json"):
        data = json.loads(mf.read_text())
        for ev in data.get("events", []):
            total_frames += len([f for f in ev.get("files", []) if f.endswith(".jpg")])

    return {
        "running": False,
        "progress": 0,
        "stage": "",
        "total_frames": total_frames,
        "selected_frames": 0,
        "total_crops": total_crops,
        "vehicles_with_crops": len(vehicles),
        "trainable_vehicles": trainable,
    }


@router.post("/preprocess/run")
def run_preprocessing():
    # TODO: implement full pipeline (frame selection → YOLO → crop → triplets)
    from fastapi.responses import StreamingResponse

    def stream():
        yield "Preprocessing pipeline not yet implemented.\n"
        yield "Steps to build:\n"
        yield "  1. Frame selection (sharpness scoring)\n"
        yield "  2. YOLOv8 truck detection + ROI masking\n"
        yield "  3. Crop extraction (518x518)\n"
        yield "  4. Triplet building (train/val/test splits)\n"

    return StreamingResponse(stream(), media_type="text/plain")
