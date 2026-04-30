import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.data import router as data_router
from .routes.sync import router as sync_router
from .routes.preprocessing import router as preprocess_router
from .routes.training import router as training_router
from .routes.evaluation import router as evaluation_router

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
WEIGHTS_DIR = BASE_DIR / "weights"
CONFIG_DIR = BASE_DIR / "backend" / "config"

for d in [RAW_DIR, PROCESSED_DIR / "crops", PROCESSED_DIR / "splits", WEIGHTS_DIR, CONFIG_DIR]:
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="WB Vision", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data_router, prefix="/api")
app.include_router(sync_router, prefix="/api")
app.include_router(preprocess_router, prefix="/api")
app.include_router(training_router, prefix="/api")
app.include_router(evaluation_router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "data_dir": str(DATA_DIR), "raw_cycles": len(list(RAW_DIR.glob("*/*/manifest.json")))}
