"""
MSPIL OPC Bridge — Main Entry Point (Production-Hardened)
  python run.py              # Start scanner + API + cloud sync
  python run.py --scan-once  # Single scan of monitored tags
  python run.py --api-only   # Only API server (for testing)
  python run.py --sync-once  # Single cloud sync push

Robustness:
  - RotatingFileHandler (5MB x 3 files)
  - Graceful shutdown on SIGTERM / Ctrl+C / Windows shutdown
  - Watchdog with restart-rate limiting (max 10/hour per thread)
  - PID file to prevent duplicate instances
"""

import sys
import time
import signal
import logging
import logging.handlers
import threading
import os
import atexit

from config import (
    LOG_FILE, LOG_LEVEL, DB_PATH, LOG_MAX_BYTES, LOG_BACKUP_COUNT,
    WATCHDOG_CHECK_SECONDS, MAX_THREAD_RESTARTS, HEARTBEAT_FILE,
    CLOUD_API_URL, CLOUD_API_KEY,
)

# =============================================================================
#  PID FILE — prevent duplicate instances
# =============================================================================
PID_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "opc_bridge.pid")


def check_and_write_pid():
    """Write PID file. Warn if another instance may be running."""
    os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE) as f:
                old_pid = int(f.read().strip())
            # On Windows, check if process exists
            try:
                os.kill(old_pid, 0)  # Signal 0 = just check existence
                print(f"WARNING: Another instance may be running (PID {old_pid})")
                print("If not, delete data/opc_bridge.pid and retry.")
                # Don't exit — old PID may be stale after a crash
            except (OSError, ProcessLookupError):
                pass  # Old process is dead, safe to continue
        except (ValueError, IOError):
            pass

    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))


def remove_pid():
    try:
        os.remove(PID_FILE)
    except OSError:
        pass


def write_heartbeat():
    """Write current timestamp to heartbeat file. OS-level watchdog checks this."""
    try:
        with open(HEARTBEAT_FILE, "w") as f:
            f.write(str(time.time()))
    except OSError:
        pass


def remove_heartbeat():
    try:
        os.remove(HEARTBEAT_FILE)
    except OSError:
        pass


# =============================================================================
#  LOGGING — RotatingFileHandler (5MB x 3 files)
# =============================================================================
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

root_logger = logging.getLogger()
root_logger.setLevel(getattr(logging, LOG_LEVEL))
formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# Rotating file handler
file_handler = logging.handlers.RotatingFileHandler(
    LOG_FILE, maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT, encoding="utf-8"
)
file_handler.setFormatter(formatter)
root_logger.addHandler(file_handler)

# Console handler
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
root_logger.addHandler(console_handler)

# Suppress noisy asyncua/opcua library logs
logging.getLogger("asyncua").setLevel(logging.WARNING)
logging.getLogger("opcua").setLevel(logging.WARNING)

log = logging.getLogger("main")

# =============================================================================
#  GRACEFUL SHUTDOWN
# =============================================================================
_shutdown_event = threading.Event()


def _shutdown_handler(signum, frame):
    """Handle SIGTERM, SIGINT, and Windows console events."""
    sig_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else str(signum)
    log.info(f"Shutdown signal received ({sig_name})")
    _shutdown_event.set()


# Register signal handlers
signal.signal(signal.SIGTERM, _shutdown_handler)
signal.signal(signal.SIGINT, _shutdown_handler)

# Windows-specific: handle console close, logoff, shutdown
if sys.platform == "win32":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32

        @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_uint)
        def _console_handler(event):
            # 0=CTRL_C, 1=CTRL_BREAK → shut down
            # 2=CTRL_CLOSE → console window closing (SSH disconnect) → IGNORE to keep running
            # 5=LOGOFF, 6=SHUTDOWN → system shutting down → shut down
            if event in (0, 1):
                log.info(f"Console Ctrl event {event}, shutting down...")
                _shutdown_event.set()
                time.sleep(3)
                return True
            if event == 2:
                log.info("Console close event (SSH disconnect?) — ignoring, bridge continues")
                return True  # Return True to prevent default termination
            if event in (5, 6):
                log.info(f"System event {event} (logoff/shutdown), shutting down...")
                _shutdown_event.set()
                time.sleep(3)
                return True
            return False

        kernel32.SetConsoleCtrlHandler(_console_handler, True)
    except Exception:
        pass  # Not on Windows or ctypes issue


# =============================================================================
#  WATCHDOG with restart-rate limiting
# =============================================================================
class ThreadWatchdog:
    """Monitors threads and restarts them, with rate limiting."""

    def __init__(self):
        self._restart_counts = {}  # thread_name -> [(timestamp, ...)]
        self._lock = threading.Lock()

    def can_restart(self, name: str) -> bool:
        """Check if we can restart this thread (max MAX_THREAD_RESTARTS per hour)."""
        with self._lock:
            now = time.time()
            if name not in self._restart_counts:
                self._restart_counts[name] = []

            # Prune entries older than 1 hour
            self._restart_counts[name] = [
                t for t in self._restart_counts[name] if now - t < 3600
            ]

            if len(self._restart_counts[name]) >= MAX_THREAD_RESTARTS:
                return False

            self._restart_counts[name].append(now)
            return True

    def get_restart_count(self, name: str) -> int:
        with self._lock:
            now = time.time()
            entries = self._restart_counts.get(name, [])
            return len([t for t in entries if now - t < 3600])


def main():
    args = sys.argv[1:]

    if "--scan-once" in args:
        from opc_scanner import OPCScanner
        scanner = OPCScanner()
        results = scanner.scan_monitored()
        print(f"\nScanned {len(results)} monitored tags")
        for tag, vals in results.items():
            print(f"  {tag}: {vals}")
        scanner.disconnect()
        return

    if "--api-only" in args:
        from api_server import start_api
        start_api()
        return

    if "--sync-once" in args:
        from cloud_sync import CloudSync
        sync = CloudSync()
        sync.sync_now()
        return

    # =================================================================
    #  Full service mode
    # =================================================================
    check_and_write_pid()
    atexit.register(remove_pid)
    atexit.register(remove_heartbeat)

    log.info("=" * 60)
    log.info("  MSPIL SUGAR OPC BRIDGE — Starting (Fuji DCS)")
    log.info("  PID: %d", os.getpid())
    log.info("=" * 60)

    watchdog = ThreadWatchdog()

    _start_time = time.time()
    # 2026-04-08 hardening: scanner instance shared with main loop for
    # liveness detection. Outer watchdog reads scanner.last_scan_completed_at
    # and force-exits the process if scans go stale (>10 min) so start_service.bat
    # can respawn a fresh process. Plain thread.is_alive() is not enough — a
    # thread blocked in opcua TCP read is "alive" but produces no scans.
    _scanner_ref = {"instance": None}
    SCAN_STALE_SECONDS = 10 * 60  # exit if no scan completed in 10 min

    # ----- Heartbeat: called from main watchdog loop (not a separate thread) -----
    _hb_log = logging.getLogger("heartbeat")
    _hb_cycle = [0]

    # Import optional modules once
    _psutil = None
    try:
        import psutil as _psutil
    except ImportError:
        _hb_log.warning("psutil not installed — run: pip install psutil")

    _sleep_cache = {"value": True, "checked": 0.0}

    def send_heartbeat():
        """Send one heartbeat to cloud. Called from main watchdog loop every 60s."""
        import json
        import urllib.request

        _hb_cycle[0] += 1
        cycle = _hb_cycle[0]
        try:
            # System metrics
            cpu, mem_mb, disk_gb = 0.0, 0, 0.0
            if _psutil:
                try:
                    cpu = _psutil.cpu_percent(interval=0)
                    mem_mb = round(_psutil.virtual_memory().used / 1024 / 1024)
                    disk_gb = round(_psutil.disk_usage("C:\\").free / 1024 / 1024 / 1024, 1)
                except Exception:
                    pass

            # Sleep check (cached 10 min)
            if time.time() - _sleep_cache["checked"] > 600:
                try:
                    import subprocess
                    r = subprocess.run(
                        ["powercfg", "/query", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"],
                        capture_output=True, text=True, timeout=10
                    )
                    parts = r.stdout.split("Current AC Power Setting Index:")
                    _sleep_cache["value"] = "0x00000000" in parts[-1].split("\n")[0] if len(parts) > 1 else False
                    _sleep_cache["checked"] = time.time()
                except Exception:
                    pass

            # Queue depth (sync_queue uses synced=0 for pending, not status='pending')
            queue_depth, db_mb = 0, 0.0
            try:
                import sqlite3 as _sq
                _c = _sq.connect(DB_PATH, timeout=5)
                _r = _c.execute("SELECT COUNT(*) FROM sync_queue WHERE synced = 0").fetchone()
                queue_depth = _r[0] if _r else 0
                db_mb = round(os.path.getsize(DB_PATH) / 1024 / 1024, 1) if os.path.exists(DB_PATH) else 0
                _c.close()
            except Exception as e:
                _hb_log.debug(f"Queue/DB size check failed: {e}")

            # Liveness proof from scanner instance, NOT just thread.is_alive()
            scanner_inst = _scanner_ref.get("instance")
            last_scan_iso = None
            last_scan_age = None
            if scanner_inst is not None and getattr(scanner_inst, "last_scan_completed_at", None):
                last_scan_age = int(time.time() - scanner_inst.last_scan_completed_at)
                last_scan_iso = time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                    time.gmtime(scanner_inst.last_scan_completed_at),
                )

            payload = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": "SUGAR",
                "uptimeSeconds": int(time.time() - _start_time),
                "opcConnected": threads.get("Scanner", threading.Thread()).is_alive(),
                "queueDepth": queue_depth,
                "dbSizeMb": db_mb,
                "health": {
                    "scannerAlive": threads.get("Scanner", threading.Thread()).is_alive(),
                    "syncAlive": threads.get("CloudSync", threading.Thread()).is_alive(),
                    "apiAlive": threads.get("API", threading.Thread()).is_alive(),
                    "threadRestarts": {},
                },
                "system": {
                    "cpuPercent": cpu,
                    "memoryMb": mem_mb,
                    "diskFreeGb": disk_gb,
                    "sleepDisabled": _sleep_cache["value"],
                },
                "version": "1.0.0",
                "lastScanCompletedAt": last_scan_iso,
                "lastScanAgeSeconds": last_scan_age,
            }

            try:
                payload["health"]["threadRestarts"] = {
                    n: watchdog.get_restart_count(n) for n in list(threads.keys())
                }
            except Exception:
                pass

            url = CLOUD_API_URL.rstrip("/") + "/heartbeat"
            body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url, data=body,
                headers={"Content-Type": "application/json", "X-OPC-Key": CLOUD_API_KEY},
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=15)
            resp.close()
            _hb_log.info(f"Heartbeat #{cycle} OK (uptime={payload['uptimeSeconds']}s)")

        except Exception:
            import traceback
            _hb_log.warning(f"Heartbeat #{cycle} failed: {traceback.format_exc()}")

    # ----- Thread factories -----
    def scanner_thread():
        try:
            from opc_scanner import OPCScanner
            scanner = OPCScanner(shutdown_event=_shutdown_event)
            _scanner_ref["instance"] = scanner  # expose for liveness check
            log.info("Scanner thread ready")
            scanner.run_loop()
        except Exception as e:
            log.error(f"Scanner thread crashed: {e}", exc_info=True)

    def sync_thread():
        try:
            # Wait for scanner to collect first data, but respect shutdown
            for _ in range(12):  # 12 x 5s = 60s max
                if _shutdown_event.is_set():
                    return
                time.sleep(5)
            from cloud_sync import CloudSync
            sync = CloudSync(shutdown_event=_shutdown_event)
            log.info("Cloud sync thread ready")
            sync.run_loop()
        except Exception as e:
            log.error(f"Sync thread crashed: {e}", exc_info=True)

    def api_thread():
        try:
            from api_server import start_api
            start_api(db=None, shutdown_event=_shutdown_event)
        except Exception as e:
            log.error(f"API thread crashed: {e}", exc_info=True)

    # ----- Start threads -----
    threads = {
        "Scanner": threading.Thread(target=scanner_thread, name="Scanner", daemon=True),
        "CloudSync": threading.Thread(target=sync_thread, name="CloudSync", daemon=True),
        "API": threading.Thread(target=api_thread, name="API", daemon=True),
    }

    for t in threads.values():
        t.start()
    log.info("All threads started (scanner + sync + API); heartbeat in watchdog loop")

    # ----- Main watchdog loop -----
    _hb_log.info("Heartbeat running from main watchdog loop (every 60s)")
    try:
        while not _shutdown_event.is_set():
            # Write heartbeat so OS-level watchdog knows we're alive
            write_heartbeat()

            # Phone home to cloud
            send_heartbeat()

            _shutdown_event.wait(timeout=WATCHDOG_CHECK_SECONDS)
            if _shutdown_event.is_set():
                break

            for name, t in list(threads.items()):
                if not t.is_alive():
                    restarts = watchdog.get_restart_count(name)
                    if watchdog.can_restart(name):
                        log.warning(f"{name} thread died (restart #{restarts + 1}/hr), restarting...")
                        factory = {"Scanner": scanner_thread, "CloudSync": sync_thread, "API": api_thread}
                        new_t = threading.Thread(target=factory[name], name=name, daemon=True)
                        new_t.start()
                        threads[name] = new_t
                    else:
                        log.error(
                            f"{name} thread died but hit restart limit "
                            f"({MAX_THREAD_RESTARTS}/hr). NOT restarting. "
                            f"Manual intervention needed."
                        )

            # 2026-04-08 hardening: stuck-scanner detection
            # If scanner thread is technically alive but no scan has completed
            # in SCAN_STALE_SECONDS, force-exit so start_service.bat respawns us.
            # This catches opcua TCP hangs and other zombification paths that
            # leave the thread alive but unproductive.
            scanner_inst = _scanner_ref.get("instance")
            if scanner_inst is not None and getattr(scanner_inst, "last_scan_completed_at", None):
                age = time.time() - scanner_inst.last_scan_completed_at
                if age > SCAN_STALE_SECONDS:
                    log.error(
                        "STUCK SCANNER DETECTED — last scan completed %.0f seconds ago "
                        "(threshold %d). Force-exiting so start_service.bat can respawn.",
                        age, SCAN_STALE_SECONDS,
                    )
                    remove_heartbeat()  # ensure OS watchdog sees stale heartbeat
                    remove_pid()
                    os._exit(2)
    except KeyboardInterrupt:
        log.info("Keyboard interrupt received")

    # ----- Cleanup -----
    log.info("Shutting down gracefully...")
    _shutdown_event.set()
    # Give threads 5 seconds to finish
    deadline = time.time() + 5
    for name, t in threads.items():
        remaining = max(0, deadline - time.time())
        t.join(timeout=remaining)
        if t.is_alive():
            log.warning(f"{name} thread did not exit in time")
    log.info("OPC Bridge stopped.")


if __name__ == "__main__":
    main()
