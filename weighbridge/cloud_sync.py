"""
MSPIL Weighbridge — Cloud Sync Module
Pushes completed weighments to cloud ERP, pulls master data.
Uses exponential backoff on failure. Never loses data.
"""

import json
import time
import logging
import threading
import urllib.request
import urllib.error

from config import (
    CLOUD_API_URL, CLOUD_API_KEY,
    SYNC_INTERVAL_SECONDS, SYNC_RETRY_MAX,
    MASTER_PULL_INTERVAL_SECONDS,
    PC_ID, PC_NAME, SERVICE_VERSION,
    WEB_PORT, SERIAL_PROTOCOL,
    BACKOFF_INITIAL_SECONDS, BACKOFF_MAX_SECONDS, BACKOFF_MULTIPLIER,
    DB_PATH,
)
import local_db as db

log = logging.getLogger("cloud_sync")


class CloudSync:
    """Handles all cloud communication."""

    def __init__(self, shutdown_event: threading.Event = None):
        self._shutdown = shutdown_event or threading.Event()
        self._backoff = BACKOFF_INITIAL_SECONDS
        self._last_master_pull = 0
        self._cloud_reachable = False
        self._start_time = time.time()

    @property
    def is_cloud_reachable(self) -> bool:
        return self._cloud_reachable

    def _post(self, path: str, payload: dict) -> dict | None:
        """POST JSON to cloud API. Returns parsed response or None on failure."""
        url = CLOUD_API_URL.rstrip("/") + path
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=body,
            headers={
                "Content-Type": "application/json",
                "X-WB-Key": CLOUD_API_KEY,
            },
            method="POST",
        )
        try:
            resp = urllib.request.urlopen(req, timeout=15)
            data = json.loads(resp.read().decode("utf-8"))
            resp.close()
            self._cloud_reachable = True
            self._backoff = BACKOFF_INITIAL_SECONDS  # Reset backoff on success
            return data
        except Exception as e:
            self._cloud_reachable = False
            log.warning("POST %s failed: %s", path, e)
            return None

    def _get(self, path: str) -> dict | None:
        """GET from cloud API. Returns parsed response or None on failure."""
        url = CLOUD_API_URL.rstrip("/") + path
        req = urllib.request.Request(
            url,
            headers={"X-WB-Key": CLOUD_API_KEY},
            method="GET",
        )
        try:
            resp = urllib.request.urlopen(req, timeout=15)
            data = json.loads(resp.read().decode("utf-8"))
            resp.close()
            self._cloud_reachable = True
            self._backoff = BACKOFF_INITIAL_SECONDS
            return data
        except Exception as e:
            self._cloud_reachable = False
            log.warning("GET %s failed: %s", path, e)
            return None

    # =====================================================================
    #  PUSH — send completed weighments to cloud
    # =====================================================================

    def push_weighments(self):
        """Push pending weighments from sync queue to cloud."""
        pending = db.get_pending_sync()
        if not pending:
            return

        log.info("Pushing %d weighment(s) to cloud", len(pending))
        success_count = 0

        for entry in pending:
            payload = json.loads(entry["payload"])
            result = self._post("/push", {"weighments": [payload]})

            if result and not result.get("error"):
                cloud_id = ""
                if isinstance(result, dict):
                    ids = result.get("ids", [])
                    if ids:
                        cloud_id = ids[0]
                db.mark_synced(entry["id"], cloud_id)
                success_count += 1
            else:
                db.mark_sync_failed(entry["id"])

        if success_count > 0:
            log.info("Pushed %d/%d weighment(s) successfully", success_count, len(pending))

    # =====================================================================
    #  PULL — get master data from cloud
    # =====================================================================

    def pull_master_data(self):
        """Pull suppliers, materials, POs, customers, vehicles from cloud ERP."""
        data = self._get("/master-data")
        if not data:
            return

        suppliers = data.get("suppliers", [])
        materials = data.get("materials", [])
        pos = data.get("pos", [])
        customers = data.get("customers", [])
        vehicles = data.get("vehicles", [])

        if suppliers:
            db.upsert_suppliers(suppliers)
        if materials:
            db.upsert_materials(materials)
        if pos:
            db.upsert_pos(pos)
        if customers:
            db.upsert_customers(customers)
        if vehicles:
            db.upsert_vehicles(vehicles)

        log.info("Pulled master data: %d suppliers, %d materials, %d POs, %d customers, %d vehicles",
                 len(suppliers), len(materials), len(pos), len(customers), len(vehicles))

    # =====================================================================
    #  HEARTBEAT — tell cloud we're alive
    # =====================================================================

    def send_heartbeat(self, extra: dict = None):
        """Send heartbeat to cloud with status info."""
        import os, platform, socket

        sync_stats = db.get_sync_stats()
        db_size = 0
        try:
            db_size = round(os.path.getsize(DB_PATH) / 1024 / 1024, 1)
        except OSError:
            pass

        # Count today's weighments
        summary = db.get_daily_summary()

        # System metrics
        cpu, mem_mb, disk_gb = 0.0, 0, 0.0
        try:
            import psutil
            cpu = psutil.cpu_percent(interval=0)
            mem_mb = round(psutil.virtual_memory().used / 1024 / 1024)
            disk_gb = round(psutil.disk_usage("C:\\").free / 1024 / 1024 / 1024, 1)
        except Exception:
            pass

        # Get Tailscale IP
        tailscale_ip = ''
        try:
            for addr in socket.getaddrinfo(socket.gethostname(), None):
                ip = addr[4][0]
                if ip.startswith('100.'):
                    tailscale_ip = ip
                    break
        except Exception:
            pass

        payload = {
            "pcId": PC_ID,
            "pcName": PC_NAME,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "uptimeSeconds": int(time.time() - self._start_time) if hasattr(self, '_start_time') else 0,
            "queueDepth": sync_stats["pending"],
            "dbSizeMb": db_size,
            "serialProtocol": SERIAL_PROTOCOL,
            "webPort": WEB_PORT,
            "tailscaleIp": tailscale_ip,
            "weightsToday": summary.get("completed", 0),
            "lastTicket": summary.get("total_trucks", 0),
            "version": SERVICE_VERSION,
            "localUrl": f"http://localhost:{WEB_PORT}",
            "system": {
                "cpuPercent": cpu,
                "memoryMb": mem_mb,
                "diskFreeGb": disk_gb,
                "hostname": platform.node(),
                "os": platform.platform(),
            },
        }
        if extra:
            payload.update(extra)

        result = self._post("/heartbeat", payload)
        if result:
            log.debug("Heartbeat OK")
        return result is not None

    # =====================================================================
    #  MAIN LOOP
    # =====================================================================

    def run_loop(self):
        """Main sync loop — push, pull, heartbeat on schedule."""
        log.info("Cloud sync loop started (interval=%ds)", SYNC_INTERVAL_SECONDS)

        # Initial master data pull
        self.pull_master_data()
        self._last_master_pull = time.time()

        while not self._shutdown.is_set():
            try:
                # Push pending weighments
                self.push_weighments()

                # Pull master data periodically
                if time.time() - self._last_master_pull > MASTER_PULL_INTERVAL_SECONDS:
                    self.pull_master_data()
                    self._last_master_pull = time.time()

                # Send heartbeat
                self.send_heartbeat()

                # Cleanup old sync entries
                db.cleanup_old_sync_queue()

                # Wait for next cycle
                self._shutdown.wait(timeout=SYNC_INTERVAL_SECONDS)

            except Exception as e:
                log.error("Sync loop error: %s", e, exc_info=True)
                # Exponential backoff on repeated failures
                self._shutdown.wait(timeout=self._backoff)
                self._backoff = min(self._backoff * BACKOFF_MULTIPLIER, BACKOFF_MAX_SECONDS)

    def sync_now(self):
        """One-shot sync (for CLI usage)."""
        log.info("Running one-shot sync...")
        self.push_weighments()
        self.pull_master_data()
        self.send_heartbeat()
        log.info("One-shot sync complete")
