"""
MSPIL Weighbridge — Weight Reader Module
Abstract interface with multiple implementations:
  - SerialReader: Direct RS-232 communication with indicator
  - FileReader: Reads from a file written by existing software
  - SimulatedReader: For testing without hardware
  - ManualReader: Operator types weight (ultimate fallback)

The concrete implementation is selected based on config.SERIAL_PROTOCOL.
After Tailscale investigation, the right reader will be wired in.
"""

import time
import logging
import threading
import re

from config import (
    SERIAL_PORT, SERIAL_BAUDRATE, SERIAL_BYTESIZE, SERIAL_PARITY, SERIAL_STOPBITS,
    SERIAL_TIMEOUT, WEIGHT_POLL_INTERVAL, WEIGHT_STABLE_COUNT, WEIGHT_STABLE_TOLERANCE,
    WEIGHT_FILE_PATH,
)

log = logging.getLogger("weight_reader")


# ──────────────────────────────────────────────────────────────────────────
# Staleness threshold
#
# If no new serial frame arrives in this many seconds, the reader is treated
# as STALE. The last weight is NOT displayed; we return weight=0, stable=False,
# stale=True. This prevents the "ghost value" bug where a loose cable makes
# the UI show an old reading as if it were live.
#
# 3 seconds is the sweet spot: most indicators send >= 1 frame/sec, so 3s
# survives normal hiccups but surfaces a dead cable quickly.
#
# FROZEN DETECTION — INTENTIONALLY REMOVED:
# Our load cell resolution is ~10 kg, so a legitimately parked truck reports
# identical integer values for minutes on end. Any heuristic that flags
# "zero variance" as stuck will false-positive on every normal weighment.
# Financial safety against frozen digitizers lives in the backend rules
# engine (DUPLICATE_WEIGHT_WINDOW_MINUTES), which compares the captured
# weight against recent captured weighments — far more reliable than
# inspecting raw serial frames.
# ──────────────────────────────────────────────────────────────────────────
STALE_THRESHOLD_S = 3.0


class WeightReader:
    """Abstract base class for reading weight from weighbridge."""

    def __init__(self):
        import time as _t
        self._weight = 0.0
        self._stable = False
        self._connected = False
        self._lock = threading.Lock()
        self._recent_readings = []
        # Track when we last successfully parsed a serial frame. Initialize to
        # "now" so that stale=False at startup — the UI shouldn't flash NO
        # SIGNAL during the first few seconds before the first frame arrives.
        self._last_frame_at = _t.monotonic()
        self._ever_received = False   # True after the first successful frame
        self._frame_count = 0         # monotonically increasing, for observability

    def get_weight(self) -> tuple:
        """Returns (weight_kg, is_stable, is_connected). Thread-safe.

        If the reader is STALE (no frames for STALE_THRESHOLD_S seconds), we
        return weight=0, stable=False regardless of the last known value. This
        guarantees the UI never shows a ghost reading from a disconnected
        scale. Use is_stale() to surface the reason.
        """
        import time as _t
        with self._lock:
            if self._is_stale_unlocked(_t.monotonic()):
                return 0.0, False, self._connected
            return self._weight, self._stable, self._connected

    def is_stale(self) -> bool:
        """True if no serial frame has arrived in STALE_THRESHOLD_S seconds
        AND the reader has received at least one frame at some point. Before
        the first-ever frame we report stale=False (reader is still warming
        up)."""
        import time as _t
        with self._lock:
            return self._is_stale_unlocked(_t.monotonic())

    def _is_stale_unlocked(self, now: float) -> bool:
        if not self._ever_received:
            return False
        return (now - self._last_frame_at) > STALE_THRESHOLD_S

    def is_frozen(self) -> bool:
        """Deprecated — kept for backwards compat. Always False.

        See the STALE_THRESHOLD_S comment block for why we no longer detect
        frozen values at the serial layer. The backend DUPLICATE_WEIGHT_WINDOW
        rule is the authoritative safety net for stuck digitizers.
        """
        return False

    def get_status(self) -> dict:
        """Full status dict for observability / JSON API."""
        import time as _t
        with self._lock:
            now = _t.monotonic()
            stale = self._is_stale_unlocked(now)
            age_ms = int((now - self._last_frame_at) * 1000) if self._ever_received else None
            return {
                "weight": 0.0 if stale else self._weight,
                "stable": False if stale else self._stable,
                "connected": self._connected,
                "stale": stale,
                "frozen": False,   # kept for API shape compat; always false now
                "lastFrameAgeMs": age_ms,
                "frameCount": self._frame_count,
                "port": getattr(self, "_active_port", None),
            }

    def _update_weight(self, raw_kg: float):
        """Record a fresh serial frame. Recomputes stability."""
        import time as _t
        with self._lock:
            now = _t.monotonic()
            self._weight = raw_kg
            self._last_frame_at = now
            self._ever_received = True
            self._frame_count += 1

            self._recent_readings.append(raw_kg)
            if len(self._recent_readings) > WEIGHT_STABLE_COUNT:
                self._recent_readings = self._recent_readings[-WEIGHT_STABLE_COUNT:]

            # Stable = within tolerance over last WEIGHT_STABLE_COUNT samples.
            # Because our load cell is ~10 kg resolution, a parked truck will
            # typically report exactly the same integer, so the spread check
            # is effectively "last N readings within WEIGHT_STABLE_TOLERANCE kg"
            # which is exactly the definition of "ready to capture".
            if len(self._recent_readings) >= WEIGHT_STABLE_COUNT:
                recent = self._recent_readings[-WEIGHT_STABLE_COUNT:]
                spread = max(recent) - min(recent)
                self._stable = spread <= WEIGHT_STABLE_TOLERANCE
            else:
                self._stable = False

    def run_loop(self, shutdown_event: threading.Event):
        """Main loop — override in subclass."""
        raise NotImplementedError

    def cleanup(self):
        """Cleanup resources. Override if needed."""
        pass


class SerialReader(WeightReader):
    """
    Direct RS-232 serial port reading.

    Robustness rules (this code runs on a 24/7 factory gate):
    1. Short read timeout (500ms) so the loop is responsive.
    2. Auto-reconnect on any exception.
    3. SILENT PORT DETECTION: if no frame arrives for SILENT_CYCLE_THRESHOLD
       seconds, close and reopen the port. Some USB-serial adapters lose
       sync after the digitizer is power-cycled; reopening fixes it.
    4. PORT AUTO-DISCOVERY: if the configured port stays silent for
       AUTO_DISCOVER_AFTER_S, probe every other listed COM port and switch
       to whichever starts producing data. The active port is tracked so
       the JSON API can surface it.
    5. Every state transition is logged loud.

    Common Indian weighbridge indicator output format:
      "ST,GS,+  24850 kg\\r\\n"  or  "  24850\\r\\n"  or  "+24850 kg\\r\\n"
      STX (\\x02) + 6-digit weight + ETX (\\x03)
    """

    SILENT_CYCLE_THRESHOLD_S = 2.0     # reopen same port if silent this long
    AUTO_DISCOVER_AFTER_S = 6.0        # after this long, try other ports too
    PROBE_TIMEOUT_S = 1.0              # per-port probe window
    RECONNECT_BACKOFF_S = 0.5          # wait between failed opens (short = fast recovery)

    def __init__(self):
        super().__init__()
        self._serial = None
        self._active_port = None
        self._last_successful_read_at = 0.0  # monotonic

    def _open_port(self, port: str):
        """Open a specific serial port. Returns a Serial handle or raises."""
        import serial
        s = serial.Serial(
            port=port,
            baudrate=SERIAL_BAUDRATE,
            timeout=0.5,  # short so the loop stays responsive
            bytesize=SERIAL_BYTESIZE,
            parity=SERIAL_PARITY,
            stopbits=SERIAL_STOPBITS,
        )
        return s

    def _connect(self, preferred_port: str = None):
        """Open the preferred serial port; update self._active_port."""
        port = preferred_port or SERIAL_PORT
        try:
            self._serial = self._open_port(port)
            with self._lock:
                self._connected = True
                self._active_port = port
            log.info("Serial port %s opened (baud=%d)", port, SERIAL_BAUDRATE)
        except Exception as e:
            with self._lock:
                self._connected = False
                self._active_port = None
            log.error("Failed to open serial port %s: %s", port, e)
            raise

    def _list_all_ports(self) -> list:
        """Return every serial port the OS knows about. Safe on Windows/Linux."""
        try:
            from serial.tools import list_ports
            return [p.device for p in list_ports.comports()]
        except Exception as e:
            log.warning("list_ports failed: %s", e)
            return []

    def _probe_port(self, port: str) -> bool:
        """Open a port briefly and listen for any bytes. Returns True if data arrived."""
        try:
            s = self._open_port(port)
            import time as _t
            deadline = _t.monotonic() + self.PROBE_TIMEOUT_S
            got_data = False
            while _t.monotonic() < deadline:
                chunk = s.read(64)
                if chunk:
                    got_data = True
                    break
            s.close()
            return got_data
        except Exception as e:
            log.warning("probe %s failed: %s", port, e)
            return False

    def _auto_discover(self) -> str:
        """Probe every known COM port. Return the first one that produces data,
        or None if all are silent."""
        ports = self._list_all_ports()
        log.warning("auto-discover: probing ports %s", ports)
        for p in ports:
            if self._probe_port(p):
                log.warning("auto-discover: %s is producing data — switching to it", p)
                return p
        log.error("auto-discover: no port produced data; all are silent")
        return None

    def _close_port(self):
        try:
            if self._serial:
                self._serial.close()
        except Exception:
            pass
        self._serial = None
        with self._lock:
            self._connected = False

    def _parse_weight(self, line: str) -> float | None:
        """Parse weight from serial line. See class docstring for formats."""
        if not line or not line.strip():
            return None
        cleaned = line.replace('\x02', '').replace('\x03', '').strip()
        match = re.search(r'[+-]?\s*(\d+\.?\d*)', cleaned)
        if match:
            try:
                return float(match.group(0).replace(' ', ''))
            except ValueError:
                return None
        return None

    def run_loop(self, shutdown_event: threading.Event):
        """Main reader loop with staleness-aware reconnect + auto-discovery."""
        import time as _t

        # Initial connect attempt. If it fails, the loop below will retry.
        try:
            self._connect()
        except Exception:
            pass

        self._last_successful_read_at = _t.monotonic()
        last_silent_warn_at = 0.0
        last_discover_at = 0.0
        log.info("Serial reader loop started (poll=%.2fs, stale=%.1fs)",
                 WEIGHT_POLL_INTERVAL, STALE_THRESHOLD_S)

        while not shutdown_event.is_set():
            try:
                if not self._serial or not self._serial.is_open:
                    # Port is down. Try the configured port first. If that
                    # fails, immediately try auto-discovery so a re-plugged
                    # cable on a different COM number comes back online
                    # without a manual restart.
                    try:
                        self._connect(preferred_port=self._active_port or SERIAL_PORT)
                    except Exception:
                        new_port = self._auto_discover()
                        if new_port:
                            try:
                                self._connect(preferred_port=new_port)
                            except Exception:
                                shutdown_event.wait(self.RECONNECT_BACKOFF_S)
                                continue
                        else:
                            shutdown_event.wait(self.RECONNECT_BACKOFF_S)
                            continue

                # Read one line (short timeout in self._open_port = 500ms)
                line = self._serial.readline()
                if line:
                    decoded = line.decode('ascii', errors='ignore').strip()
                    weight = self._parse_weight(decoded)
                    if weight is not None and weight >= 0:
                        self._update_weight(weight)
                        self._last_successful_read_at = _t.monotonic()

                now = _t.monotonic()
                silent_for = now - self._last_successful_read_at

                # Reopen same port if silent > SILENT_CYCLE_THRESHOLD_S.
                # USB-serial adapters sometimes need a reopen to re-sync.
                if silent_for > self.SILENT_CYCLE_THRESHOLD_S:
                    if now - last_silent_warn_at > 5:
                        log.warning("serial port %s silent for %.1fs — reopening",
                                    self._active_port, silent_for)
                        last_silent_warn_at = now
                    self._close_port()
                    try:
                        self._connect(preferred_port=self._active_port or SERIAL_PORT)
                    except Exception:
                        pass

                # Auto-discovery: if silent longer than AUTO_DISCOVER_AFTER_S
                # AND we haven't tried discovery in the last 30s, probe every
                # port and switch to whichever is actually talking.
                if silent_for > self.AUTO_DISCOVER_AFTER_S and (now - last_discover_at) > 30:
                    last_discover_at = now
                    log.error("serial port %s silent for %.1fs — running auto-discovery",
                              self._active_port, silent_for)
                    self._close_port()
                    new_port = self._auto_discover()
                    if new_port and new_port != SERIAL_PORT:
                        log.warning("switching active port from %s to %s", SERIAL_PORT, new_port)
                    try:
                        self._connect(preferred_port=new_port or SERIAL_PORT)
                    except Exception:
                        pass

            except Exception as e:
                log.error("serial loop error: %s — reconnecting", e)
                self._close_port()
                shutdown_event.wait(1)

            shutdown_event.wait(WEIGHT_POLL_INTERVAL)

            shutdown_event.wait(WEIGHT_POLL_INTERVAL)

    def cleanup(self):
        if self._serial and self._serial.is_open:
            self._serial.close()
            log.info("Serial port closed")


class FileReader(WeightReader):
    """
    Reads weight from D:\\WT\\new weight.txt written by WtService.exe.
    WtService is a .NET Windows service that reads COM1 (2400/8/N/1)
    and writes the current weight to this text file continuously.
    """

    def __init__(self, file_path: str = None):
        super().__init__()
        self.file_path = file_path or WEIGHT_FILE_PATH

    def run_loop(self, shutdown_event: threading.Event):
        """Poll the weight file."""
        log.info("File reader started, watching: %s", self.file_path)
        with self._lock:
            self._connected = True

        while not shutdown_event.is_set():
            try:
                with open(self.file_path, 'r') as f:
                    content = f.read().strip()
                match = re.search(r'[+-]?\s*(\d+\.?\d*)', content)
                if match:
                    weight = float(match.group(0).replace(' ', ''))
                    if weight >= 0:
                        self._update_weight(weight)
                        with self._lock:
                            self._connected = True
            except FileNotFoundError:
                with self._lock:
                    self._connected = False
                log.warning("Weight file not found: %s", self.file_path)
            except Exception as e:
                log.error("File read error: %s", e)

            shutdown_event.wait(WEIGHT_POLL_INTERVAL)


class SimulatedReader(WeightReader):
    """
    Simulated weight reader for testing without hardware.
    Generates a random stable weight around 15-25 tons.
    """

    def run_loop(self, shutdown_event: threading.Event):
        import random
        log.info("Simulated reader started (testing mode)")
        with self._lock:
            self._connected = True

        base = random.uniform(15000, 25000)  # Base weight in KG
        while not shutdown_event.is_set():
            # Simulate slight fluctuations
            noise = random.uniform(-10, 10)
            self._update_weight(base + noise)
            shutdown_event.wait(WEIGHT_POLL_INTERVAL)


def get_reader(protocol: str = "file") -> WeightReader:
    """Factory function to get the right reader based on config."""
    readers = {
        "serial": SerialReader,
        "generic": SerialReader,
        "file": FileReader,          # Default — reads from WtService output
        "simulated": SimulatedReader,
    }
    reader_cls = readers.get(protocol, SerialReader)
    log.info("Using weight reader: %s", reader_cls.__name__)
    return reader_cls()
