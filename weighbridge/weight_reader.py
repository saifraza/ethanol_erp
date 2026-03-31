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


class WeightReader:
    """Abstract base class for reading weight from weighbridge."""

    def __init__(self):
        self._weight = 0.0
        self._stable = False
        self._connected = False
        self._lock = threading.Lock()
        self._recent_readings = []

    def get_weight(self) -> tuple:
        """Returns (weight_kg: float, is_stable: bool, is_connected: bool). Thread-safe."""
        with self._lock:
            return self._weight, self._stable, self._connected

    def _update_weight(self, raw_kg: float):
        """Update weight and calculate stability. Called by subclasses."""
        with self._lock:
            self._weight = raw_kg
            self._recent_readings.append(raw_kg)
            # Keep only last N readings
            if len(self._recent_readings) > WEIGHT_STABLE_COUNT:
                self._recent_readings = self._recent_readings[-WEIGHT_STABLE_COUNT:]

            # Stable if all recent readings are within tolerance
            if len(self._recent_readings) >= WEIGHT_STABLE_COUNT:
                spread = max(self._recent_readings) - min(self._recent_readings)
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
    Common Indian weighbridge indicator output format:
      Many indicators continuously send weight like:
        "ST,GS,+  24850 kg\\r\\n"  or  "  24850\\r\\n"  or  "+24850 kg\\r\\n"
    We extract the numeric part.
    """

    def __init__(self):
        super().__init__()
        self._serial = None

    def _connect(self):
        """Open serial port."""
        try:
            import serial
            self._serial = serial.Serial(
                port=SERIAL_PORT,
                baudrate=SERIAL_BAUDRATE,
                timeout=SERIAL_TIMEOUT,
                bytesize=SERIAL_BYTESIZE,
                parity=SERIAL_PARITY,
                stopbits=SERIAL_STOPBITS,
            )
            with self._lock:
                self._connected = True
            log.info("Serial port %s opened (baud=%d)", SERIAL_PORT, SERIAL_BAUDRATE)
        except Exception as e:
            with self._lock:
                self._connected = False
            log.error("Failed to open serial port %s: %s", SERIAL_PORT, e)
            raise

    def _parse_weight(self, line: str) -> float | None:
        """
        Parse weight from serial line.
        MSPIL indicator format: STX + space + 6-digit weight + ETX
          b'\\x02 005260\\x03' → 5260.0
        Also handles generic formats:
          "ST,GS,+  24850 kg" → 24850.0
          "  24850.5 kg"      → 24850.5
        Returns None if unparseable.
        """
        if not line or not line.strip():
            return None

        # Remove STX (\x02), ETX (\x03), and whitespace
        cleaned = line.replace('\x02', '').replace('\x03', '').strip()

        # Extract numeric part
        match = re.search(r'[+-]?\s*(\d+\.?\d*)', cleaned)
        if match:
            try:
                return float(match.group(0).replace(' ', ''))
            except ValueError:
                return None
        return None

    def run_loop(self, shutdown_event: threading.Event):
        """Continuously read serial port."""
        self._connect()
        log.info("Serial reader loop started")

        while not shutdown_event.is_set():
            try:
                if self._serial and self._serial.is_open:
                    line = self._serial.readline()
                    if line:
                        decoded = line.decode('ascii', errors='ignore').strip()
                        weight = self._parse_weight(decoded)
                        if weight is not None and weight >= 0:
                            self._update_weight(weight)
                else:
                    # Try to reconnect
                    with self._lock:
                        self._connected = False
                    time.sleep(5)
                    self._connect()

            except Exception as e:
                log.error("Serial read error: %s — closing and reconnecting", e)
                with self._lock:
                    self._connected = False
                # Close the broken port completely
                try:
                    if self._serial:
                        self._serial.close()
                        self._serial = None
                except Exception:
                    pass
                # Wait before reconnect
                shutdown_event.wait(3)
                if not shutdown_event.is_set():
                    try:
                        self._connect()
                    except Exception:
                        shutdown_event.wait(5)  # Backoff on reconnect failure

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
