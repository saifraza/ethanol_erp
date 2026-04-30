import subprocess
import json
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()

RAW_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw"

FACTORY_IP = "100.126.101.7"
FACTORY_USER = "Administrator"
FACTORY_PASS = "Mspil@1212"
REMOTE_BASE = "/cygdrive/c/mspil/factory-server/data/videos/motion"


@router.get("/sync/status")
def sync_status():
    local_dates = sorted([d.name for d in RAW_DIR.iterdir() if d.is_dir()]) if RAW_DIR.exists() else []
    local_cycles = sum(1 for _ in RAW_DIR.glob("*/*/manifest.json")) if RAW_DIR.exists() else 0

    reachable = False
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", "2", FACTORY_IP],
            capture_output=True, timeout=5,
        )
        reachable = result.returncode == 0
    except Exception:
        pass

    last_sync_file = RAW_DIR / ".last_sync"
    last_sync = last_sync_file.read_text().strip() if last_sync_file.exists() else None

    return {
        "factory_reachable": reachable,
        "local_cycles": local_cycles,
        "local_dates": local_dates,
        "last_sync": last_sync,
    }


@router.get("/sync/check")
def check_connection():
    try:
        result = subprocess.run(
            ["sshpass", "-p", FACTORY_PASS, "ssh",
             "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5",
             f"{FACTORY_USER}@{FACTORY_IP}",
             "ls /cygdrive/c/mspil/factory-server/data/videos/motion/"],
            capture_output=True, text=True, timeout=15,
        )
        dates = [d.strip() for d in result.stdout.strip().split("\n") if d.strip()]
        return {"connected": True, "remote_dates": dates}
    except Exception as e:
        return {"connected": False, "error": str(e)}


@router.post("/sync/pull")
def pull_data():
    def stream():
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        yield "Starting rsync from factory...\n"

        cmd = [
            "sshpass", "-p", FACTORY_PASS,
            "rsync", "-avz", "--progress",
            "-e", "ssh -o StrictHostKeyChecking=no",
            f"{FACTORY_USER}@{FACTORY_IP}:{REMOTE_BASE}/",
            str(RAW_DIR) + "/",
        ]

        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in proc.stdout:
                yield line
            proc.wait()

            if proc.returncode == 0:
                from datetime import datetime
                (RAW_DIR / ".last_sync").write_text(datetime.now().isoformat())
                cycle_count = sum(1 for _ in RAW_DIR.glob("*/*/manifest.json"))
                yield f"\nDone! {cycle_count} cycles available locally.\n"
            else:
                yield f"\nrsync exited with code {proc.returncode}\n"
        except Exception as e:
            yield f"\nError: {e}\n"

    return StreamingResponse(stream(), media_type="text/plain")
