from pathlib import Path
from fastapi import APIRouter, UploadFile, File

router = APIRouter()


@router.get("/evaluate/results")
def get_results():
    # TODO: implement evaluation after training is done
    return None


@router.post("/evaluate/run")
def run_evaluation():
    return {"message": "Evaluation not yet implemented — train a model first"}


@router.post("/compare")
async def compare(image_a: UploadFile = File(...), image_b: UploadFile = File(...)):
    # TODO: implement after embedder + re-ID head are trained
    return {
        "score": 0,
        "verdict": "UNCERTAIN",
        "embedding_distance": 0,
        "truck_detected_a": False,
        "truck_detected_b": False,
    }
