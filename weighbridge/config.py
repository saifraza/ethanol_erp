"""
MSPIL Weighbridge — Configuration
All settings for serial port, local DB, web UI, and cloud sync.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# =============================================================================
#  WEIGHBRIDGE HARDWARE (Serial / COM port)
# =============================================================================
SERIAL_PORT = os.environ.get("WB_SERIAL_PORT", "COM1")
SERIAL_BAUDRATE = int(os.environ.get("WB_BAUDRATE", "2400"))
SERIAL_BYTESIZE = 7         # 7 data bits (confirmed live from indicator)
SERIAL_PARITY = "N"         # No parity
SERIAL_STOPBITS = 1         # 1 stop bit
SERIAL_TIMEOUT = 1          # Seconds
SERIAL_PROTOCOL = os.environ.get("WB_PROTOCOL", "file")  # 'file' (default) or 'serial'

# File-based weight reading (WtService writes weight to this file)
WEIGHT_FILE_PATH = os.environ.get("WB_WEIGHT_FILE", r"D:\WT\new weight.txt")

# Weight reading settings
WEIGHT_POLL_INTERVAL = 0.1    # Read serial every 100ms (fast response)
WEIGHT_STABLE_COUNT = 3       # Readings must match N times to be "stable"
WEIGHT_STABLE_TOLERANCE = 20  # KG — readings within this range = stable

# =============================================================================
#  LOCAL DATABASE (SQLite)
# =============================================================================
DB_PATH = os.path.join(BASE_DIR, "data", "weighbridge.db")
DB_RETENTION_DAYS = 365       # Keep weighments for 1 year locally

# =============================================================================
#  LOCAL WEB UI (Flask)
# =============================================================================
WEB_HOST = "0.0.0.0"         # Accessible from any local network device
WEB_PORT = 8098              # One below OPC's 8099
WEB_DEBUG = False            # Never True in production

# =============================================================================
#  CLOUD SYNC
# =============================================================================
CLOUD_API_URL = os.environ.get("WB_CLOUD_URL", "https://app.mspil.in/api/weighbridge")
CLOUD_API_KEY = os.environ.get("WB_CLOUD_KEY", "mspil-wb-2026")
SYNC_INTERVAL_SECONDS = 5            # Push every 5 seconds (fast — skips if no data)
SYNC_RETRY_MAX = 5                   # Retry failed syncs
MASTER_PULL_INTERVAL_SECONDS = 1800  # Pull master data every 30 min

# =============================================================================
#  BACKOFF SETTINGS (exponential backoff for cloud failures)
# =============================================================================
BACKOFF_INITIAL_SECONDS = 10
BACKOFF_MAX_SECONDS = 600
BACKOFF_MULTIPLIER = 2

# =============================================================================
#  LOGGING
# =============================================================================
LOG_FILE = os.path.join(BASE_DIR, "logs", "weighbridge.log")
LOG_LEVEL = "INFO"
LOG_MAX_BYTES = 5 * 1024 * 1024      # 5 MB per log file
LOG_BACKUP_COUNT = 3                 # Keep 3 rotated log files

# =============================================================================
#  WATCHDOG
# =============================================================================
WATCHDOG_CHECK_SECONDS = 60
MAX_THREAD_RESTARTS = 10             # Max restarts per hour per thread

# =============================================================================
#  HEARTBEAT
# =============================================================================
HEARTBEAT_FILE = os.path.join(BASE_DIR, "data", "heartbeat")
HEARTBEAT_STALE_SECONDS = 300        # 5 min = frozen

# =============================================================================
#  COMPANY INFO (for receipts)
# =============================================================================
COMPANY_NAME = "Mahakaushal Sugar & Power Industries Ltd"
PLANT_ADDRESS = "Village Bachai, Dist. Narsinghpur, MP"
RECEIPT_WIDTH = 40  # Characters for thermal receipt (80mm paper)

# =============================================================================
#  PC IDENTITY (for multi-PC tracking)
# =============================================================================
PC_ID = os.environ.get("WB_PC_ID", "weighbridge-1")
PC_NAME = os.environ.get("WB_PC_NAME", "Weighbridge Gate 1")
SERVICE_VERSION = "1.0.0"
