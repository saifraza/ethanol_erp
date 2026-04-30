from pathlib import Path
from fastapi import APIRouter

router = APIRouter()

WEIGHTS_DIR = Path(__file__).resolve().parent.parent.parent / "weights"


@router.get("/training/status")
def training_status():
    checkpoints = []
    for cp in sorted(WEIGHTS_DIR.glob("reid_head_v*.pt")):
        checkpoints.append({
            "version": cp.stem,
            "accuracy": 0,
            "created_at": cp.stat().st_mtime,
        })

    return {
        "running": False,
        "epoch": 0,
        "total_epochs": 0,
        "loss": 0,
        "val_accuracy": 0,
        "best_accuracy": 0,
        "history": [],
        "checkpoints": checkpoints,
    }


@router.post("/training/start")
def start_training():
    # TODO: implement DINOv2 embedding + triplet loss training
    return {"started": False, "message": "Training pipeline not yet implemented"}


@router.post("/training/stop")
def stop_training():
    return {"stopped": True}
