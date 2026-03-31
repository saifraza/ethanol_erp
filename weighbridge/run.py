"""
MSPIL Weighbridge — Main Entry Point
  python run.py              # Start full service (serial + web + sync)
  python run.py --web-only   # Only web UI (for testing without serial)
  python run.py --sync-once  # Single cloud sync push
  python run.py --test-db    # Test database operations

Robustness:
  - RotatingFileHandler (5MB x 3 files)
  - Graceful shutdown on SIGTERM / Ctrl+C / Windows shutdown
  - Watchdog with restart-rate limiting (max 10/hour per thread)
  - PID file to prevent duplicate instances
  - Survives SSH disconnect (Windows console close event)
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
    SERIAL_PROTOCOL,
)

# =============================================================================
#  PID FILE — prevent duplicate instances
# =============================================================================
PID_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "weighbridge.pid")


def check_and_write_pid():
    """Write PID file. Warn if another instance may be running."""
    os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE) as f:
                old_pid = int(f.read().strip())
            try:
                os.kill(old_pid, 0)
                print(f"WARNING: Another instance may be running (PID {old_pid})")
                print("If not, delete data/weighbridge.pid and retry.")
            except Exception:
                pass  # Old process is dead or check failed, safe to continue
        except Exception:
            pass

    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))


def remove_pid():
    try:
        os.remove(PID_FILE)
    except OSError:
        pass


def write_heartbeat():
    """Write current timestamp to heartbeat file."""
    try:
        os.makedirs(os.path.dirname(HEARTBEAT_FILE), exist_ok=True)
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

file_handler = logging.handlers.RotatingFileHandler(
    LOG_FILE, maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT, encoding="utf-8"
)
file_handler.setFormatter(formatter)
root_logger.addHandler(file_handler)

console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
root_logger.addHandler(console_handler)

# Suppress noisy Flask/werkzeug logs
logging.getLogger("werkzeug").setLevel(logging.WARNING)

log = logging.getLogger("main")

# =============================================================================
#  GRACEFUL SHUTDOWN
# =============================================================================
_shutdown_event = threading.Event()


def _shutdown_handler(signum, frame):
    sig_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else str(signum)
    log.info(f"Shutdown signal received ({sig_name})")
    _shutdown_event.set()


signal.signal(signal.SIGTERM, _shutdown_handler)
signal.signal(signal.SIGINT, _shutdown_handler)

# Windows-specific: handle console close, logoff, shutdown
if sys.platform == "win32":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32

        @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_uint)
        def _console_handler(event):
            if event in (0, 1):  # CTRL_C, CTRL_BREAK
                log.info(f"Console Ctrl event {event}, shutting down...")
                _shutdown_event.set()
                time.sleep(3)
                return True
            if event == 2:  # CTRL_CLOSE (SSH disconnect)
                log.info("Console close event (SSH disconnect?) — ignoring, service continues")
                return True
            if event in (5, 6):  # LOGOFF, SHUTDOWN
                log.info(f"System event {event} (logoff/shutdown), shutting down...")
                _shutdown_event.set()
                time.sleep(3)
                return True
            return False

        kernel32.SetConsoleCtrlHandler(_console_handler, True)
    except Exception:
        pass


# =============================================================================
#  WATCHDOG with restart-rate limiting
# =============================================================================
class ThreadWatchdog:
    """Monitors threads and restarts them, with rate limiting."""

    def __init__(self):
        self._restart_counts = {}
        self._lock = threading.Lock()

    def can_restart(self, name: str) -> bool:
        with self._lock:
            now = time.time()
            if name not in self._restart_counts:
                self._restart_counts[name] = []
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

    # ---- CLI modes ----
    if "--test-db" in args:
        import local_db as db
        db.init_db()
        w = db.create_weighment("TEST-001", "IN", "Test Supplier", "Test Material", 15000)
        print(f"Created: ticket #{w['ticket_no']}, first weight = 15000 KG")
        w2 = db.complete_weighment(w["id"], 5000)
        print(f"Completed: net = {w2['weight_net']} KG (gross={w2['weight_gross']}, tare={w2['weight_tare']})")
        print(f"Today's summary: {db.get_daily_summary()}")
        db.delete_weighment(w["id"])
        print("Test weighment deleted")
        return

    if "--sync-once" in args:
        import local_db as db
        db.init_db()
        from cloud_sync import CloudSync
        sync = CloudSync()
        sync.sync_now()
        return

    if "--web-only" in args:
        import local_db as db
        db.init_db()
        from web_ui import start_web
        print(f"Starting web UI only at http://localhost:8098")
        start_web()
        return

    # =====================================================================
    #  Full service mode
    # =====================================================================
    check_and_write_pid()
    atexit.register(remove_pid)
    atexit.register(remove_heartbeat)

    log.info("=" * 60)
    log.info("  MSPIL WEIGHBRIDGE — Starting (production mode)")
    log.info("  PID: %d", os.getpid())
    log.info("  Serial: %s (protocol: %s)", os.environ.get("WB_SERIAL_PORT", "COM3"), SERIAL_PROTOCOL)
    log.info("=" * 60)

    # Initialize database
    import local_db as db
    db.init_db()

    watchdog = ThreadWatchdog()
    _start_time = time.time()

    # ---- Weight reader (shared across threads) ----
    from weight_reader import get_reader
    reader = get_reader(SERIAL_PROTOCOL)

    # ---- Thread factories ----
    def serial_thread():
        try:
            log.info("Weight reader thread ready")
            reader.run_loop(_shutdown_event)
        except Exception as e:
            log.error(f"Weight reader thread crashed: {e}", exc_info=True)

    def web_thread():
        try:
            from web_ui import start_web, set_weight_reader
            set_weight_reader(reader)
            log.info("Web UI thread ready")
            start_web(_shutdown_event)
        except Exception as e:
            log.error(f"Web UI thread crashed: {e}", exc_info=True)

    def sync_thread():
        try:
            # Wait for web UI to initialize DB
            for _ in range(6):
                if _shutdown_event.is_set():
                    return
                time.sleep(5)
            from cloud_sync import CloudSync
            sync = CloudSync(shutdown_event=_shutdown_event)
            log.info("Cloud sync thread ready")
            sync.run_loop()
        except Exception as e:
            log.error(f"Cloud sync thread crashed: {e}", exc_info=True)

    # ---- Start threads ----
    threads = {
        "WeightReader": threading.Thread(target=serial_thread, name="WeightReader", daemon=True),
        "WebUI": threading.Thread(target=web_thread, name="WebUI", daemon=True),
        "CloudSync": threading.Thread(target=sync_thread, name="CloudSync", daemon=True),
    }

    for t in threads.values():
        t.start()
    log.info("All threads started (weight reader + web UI + cloud sync); heartbeat in watchdog loop")

    # ---- Cloud heartbeat (called from main loop, not sync thread) ----
    _hb_log = logging.getLogger("heartbeat")
    _hb_cycle = [0]

    def send_cloud_heartbeat():
        """Send heartbeat to cloud. Called from main watchdog loop every 60s."""
        import json
        import urllib.request
        _hb_cycle[0] += 1
        try:
            from config import CLOUD_API_URL, CLOUD_API_KEY, PC_ID, PC_NAME, SERVICE_VERSION, WEB_PORT, SERIAL_PROTOCOL
            import local_db as db_mod

            sync_stats = db_mod.get_sync_stats()
            summary = db_mod.get_daily_summary()
            db_size = 0
            try:
                db_size = round(os.path.getsize(DB_PATH) / 1024 / 1024, 1)
            except OSError:
                pass

            payload = {
                "pcId": PC_ID,
                "pcName": PC_NAME,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "uptimeSeconds": int(time.time() - _start_time),
                "queueDepth": sync_stats.get("pending", 0),
                "dbSizeMb": db_size,
                "serialProtocol": SERIAL_PROTOCOL,
                "webPort": WEB_PORT,
                "weightsToday": summary.get("completed", 0),
                "lastTicket": summary.get("total_trucks", 0),
                "version": SERVICE_VERSION,
                "health": {
                    n: t.is_alive() for n, t in threads.items()
                },
            }

            url = CLOUD_API_URL.rstrip("/") + "/heartbeat"
            body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url, data=body,
                headers={"Content-Type": "application/json", "X-WB-Key": CLOUD_API_KEY},
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=15)
            resp.close()
            _hb_log.info(f"Heartbeat #{_hb_cycle[0]} OK (uptime={payload['uptimeSeconds']}s)")
        except Exception:
            import traceback
            _hb_log.warning(f"Heartbeat #{_hb_cycle[0]} failed: {traceback.format_exc()}")

    # ---- Main watchdog loop (same pattern as OPC bridge) ----
    try:
        while not _shutdown_event.is_set():
            write_heartbeat()
            send_cloud_heartbeat()

            _shutdown_event.wait(timeout=WATCHDOG_CHECK_SECONDS)
            if _shutdown_event.is_set():
                break

            for name, t in list(threads.items()):
                if not t.is_alive():
                    restarts = watchdog.get_restart_count(name)
                    if watchdog.can_restart(name):
                        log.warning(f"{name} thread died (restart #{restarts + 1}/hr), restarting...")
                        factory = {
                            "WeightReader": serial_thread,
                            "WebUI": web_thread,
                            "CloudSync": sync_thread,
                        }
                        new_t = threading.Thread(target=factory[name], name=name, daemon=True)
                        new_t.start()
                        threads[name] = new_t
                    else:
                        log.error(
                            f"{name} thread died but hit restart limit "
                            f"({MAX_THREAD_RESTARTS}/hr). NOT restarting. "
                            f"Manual intervention needed."
                        )
    except KeyboardInterrupt:
        log.info("Keyboard interrupt received")

    # ---- Cleanup ----
    log.info("Shutting down gracefully...")
    _shutdown_event.set()
    reader.cleanup()
    deadline = time.time() + 5
    for name, t in threads.items():
        remaining = max(0, deadline - time.time())
        t.join(timeout=remaining)
        if t.is_alive():
            log.warning(f"{name} thread did not exit in time")
    log.info("Weighbridge service stopped.")


if __name__ == "__main__":
    main()
