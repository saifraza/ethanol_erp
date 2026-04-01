"""
MSPIL Tiny Weight Reader — runs on each weighbridge PC.
Reads scale via serial port (or file mode) and serves HTTP.

Usage:
    python weight_reader.py

Config via environment variables:
    WB_SERIAL_PORT=COM1      (default: COM1)
    WB_SERIAL_BAUD=2400      (default: 2400)
    WB_SERIAL_PROTOCOL=serial (serial|file|simulated)
    WB_WEIGHT_FILE=D:\\WT\\new weight.txt
    WB_HTTP_PORT=8099        (default: 8099)
    WB_PC_ID=WB-1            (default: WB-1)

Endpoints:
    GET /weight  → {"weight": 4250, "stable": true, "connected": true, "pc_id": "WB-1"}
    GET /health  → {"status": "ok", "pc_id": "WB-1", "uptime": 123.4}
"""

import os
import re
import time
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# --- Config ---
SERIAL_PORT = os.environ.get('WB_SERIAL_PORT', 'COM1')
SERIAL_BAUD = int(os.environ.get('WB_SERIAL_BAUD', '2400'))
SERIAL_PROTOCOL = os.environ.get('WB_SERIAL_PROTOCOL', 'file')
WEIGHT_FILE = os.environ.get('WB_WEIGHT_FILE', r'D:\WT\new weight.txt')
HTTP_PORT = int(os.environ.get('WB_HTTP_PORT', '8099'))
PC_ID = os.environ.get('WB_PC_ID', 'WB-1')

STABLE_COUNT = 3
STABLE_TOLERANCE = 20  # KG

# --- Shared state ---
_lock = threading.Lock()
_weight = 0.0
_stable = False
_connected = False
_readings = []
_start_time = time.time()


def parse_weight(raw: str) -> float:
    """Extract weight in KG from various indicator formats."""
    raw = raw.strip()
    if not raw:
        return 0.0
    # Format: STX + space + digits + ETX (MSPIL indicator)
    m = re.search(r'[\x02]?\s*(\d+\.?\d*)', raw)
    if m:
        return float(m.group(1))
    # Format: ST,GS,+ 24850 kg
    m = re.search(r'[+-]?\s*(\d+\.?\d*)\s*kg', raw, re.IGNORECASE)
    if m:
        return float(m.group(1))
    # Plain number
    m = re.search(r'(\d+\.?\d*)', raw)
    if m:
        return float(m.group(1))
    return 0.0


def check_stable(readings: list, tolerance: float = STABLE_TOLERANCE) -> bool:
    """Check if last N readings are within tolerance."""
    if len(readings) < STABLE_COUNT:
        return False
    recent = readings[-STABLE_COUNT:]
    return (max(recent) - min(recent)) <= tolerance


# --- Serial reader thread ---
def serial_reader_loop():
    global _weight, _stable, _connected, _readings
    try:
        import serial
    except ImportError:
        print("[ERROR] pyserial not installed. Run: pip install pyserial")
        return

    while True:
        try:
            with serial.Serial(SERIAL_PORT, SERIAL_BAUD, bytesize=7,
                               parity='N', stopbits=1, timeout=1) as ser:
                print(f"[SERIAL] Connected to {SERIAL_PORT} at {SERIAL_BAUD} baud")
                with _lock:
                    _connected = True
                while True:
                    line = ser.readline().decode('ascii', errors='ignore')
                    w = parse_weight(line)
                    if w > 0:
                        with _lock:
                            _weight = w
                            _readings.append(w)
                            if len(_readings) > 10:
                                _readings = _readings[-10:]
                            _stable = check_stable(_readings)
        except Exception as e:
            print(f"[SERIAL] Error: {e} — reconnecting in 2s")
            with _lock:
                _connected = False
            time.sleep(2)


# --- File reader thread ---
def file_reader_loop():
    global _weight, _stable, _connected, _readings
    print(f"[FILE] Reading from {WEIGHT_FILE}")
    with _lock:
        _connected = True

    while True:
        try:
            with open(WEIGHT_FILE, 'r') as f:
                raw = f.read()
            w = parse_weight(raw)
            with _lock:
                _weight = w
                _connected = True
                _readings.append(w)
                if len(_readings) > 10:
                    _readings = _readings[-10:]
                _stable = check_stable(_readings)
        except FileNotFoundError:
            with _lock:
                _connected = False
        except Exception:
            pass
        time.sleep(0.1)


# --- Simulated reader thread ---
def simulated_reader_loop():
    global _weight, _stable, _connected, _readings
    import random
    base = random.randint(15000, 25000)
    with _lock:
        _connected = True
    while True:
        w = base + random.randint(-5, 5)
        with _lock:
            _weight = float(w)
            _readings.append(float(w))
            if len(_readings) > 10:
                _readings = _readings[-10:]
            _stable = check_stable(_readings)
        time.sleep(0.2)


# --- HTTP server ---
class WeightHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/weight':
            with _lock:
                data = {
                    'weight': _weight,
                    'stable': _stable,
                    'connected': _connected,
                    'pc_id': PC_ID,
                }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())

        elif self.path == '/health':
            data = {
                'status': 'ok',
                'pc_id': PC_ID,
                'protocol': SERIAL_PROTOCOL,
                'uptime': round(time.time() - _start_time, 1),
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress request logs


def main():
    # Start weight reader thread
    readers = {
        'serial': serial_reader_loop,
        'file': file_reader_loop,
        'simulated': simulated_reader_loop,
    }
    reader_fn = readers.get(SERIAL_PROTOCOL, file_reader_loop)
    t = threading.Thread(target=reader_fn, daemon=True)
    t.start()
    print(f"[READER] Started {SERIAL_PROTOCOL} reader")

    # Start HTTP server
    server = HTTPServer(('0.0.0.0', HTTP_PORT), WeightHandler)
    print(f"[HTTP] Weight reader on http://0.0.0.0:{HTTP_PORT}/weight")
    print(f"[CONFIG] PC_ID={PC_ID} PROTOCOL={SERIAL_PROTOCOL}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == '__main__':
    main()
