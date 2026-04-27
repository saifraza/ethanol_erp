"""
MSPIL Sugar OPC Bridge — Configuration
Fuji DCS (XDS3000/XOS3000) sugar plant connection.
Same architecture as ethanol ABB bridge, adapted for Fuji OPC-UA.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# =============================================================================
#  OPC UA CONNECTION — Fuji DCS (no auth, no certs)
# =============================================================================
OPC_SERVER = {
    "endpoint": "opc.tcp://192.168.0.64:4841",
    # Fuji DCS has open access — no username/password/certs needed
}

# Source identifier — sent to cloud to distinguish from ethanol bridge
SOURCE = "SUGAR"

# Fuji tag reading: direct node ID, not tree navigation
# Tags are read as ns=2;s=#/R1C1I1_M.PV (Module TAGs)
# or ns=2;s=#/R1C1X3_D.VAL (User TAGs)
OPC_NAMESPACE = 2
OPC_TAG_PREFIX = "#/"  # All Fuji tags start with #/

# =============================================================================
#  SCANNER SETTINGS
# =============================================================================
SCAN_INTERVAL_SECONDS = 120          # Scan every 2 minutes
OPC_CONNECT_TIMEOUT_MS = 15000      # Connection timeout (ms for asyncua)
OPC_CACHE_MAX_SIZE = 600             # Max cached OPC node refs

# =============================================================================
#  LOCAL DATABASE (SQLite)
# =============================================================================
DB_PATH = os.path.join(BASE_DIR, "data", "opc.db")
LOCAL_RETENTION_DAYS = 7
QUEUE_RETENTION_HOURS = 48

# =============================================================================
#  CLOUD SYNC
# =============================================================================
CLOUD_API_URL = "https://app.mspil.in/api/opc"
CLOUD_API_KEY = os.environ.get("OPC_CLOUD_KEY", "mspil-opc-2026")
SYNC_INTERVAL_SECONDS = 150
SYNC_RETRY_MAX = 5
TAG_PULL_ENABLED = True

# =============================================================================
#  BACKOFF SETTINGS
# =============================================================================
BACKOFF_INITIAL_SECONDS = 10
BACKOFF_MAX_SECONDS = 600
BACKOFF_MULTIPLIER = 2

# =============================================================================
#  LOCAL API SERVER
# =============================================================================
API_HOST = "0.0.0.0"
API_PORT = 8099
API_RATE_LIMIT_PER_MINUTE = 120

# =============================================================================
#  LOGGING
# =============================================================================
LOG_FILE = os.path.join(BASE_DIR, "logs", "opc_bridge.log")
LOG_LEVEL = "INFO"
LOG_MAX_BYTES = 5 * 1024 * 1024
LOG_BACKUP_COUNT = 3

# =============================================================================
#  WATCHDOG
# =============================================================================
WATCHDOG_CHECK_SECONDS = 60
MAX_THREAD_RESTARTS = 10

# =============================================================================
#  HEARTBEAT
# =============================================================================
HEARTBEAT_FILE = os.path.join(BASE_DIR, "data", "heartbeat")
HEARTBEAT_STALE_SECONDS = 300
