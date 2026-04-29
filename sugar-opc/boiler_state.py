"""
Shared helper — detect whether the boiler is genuinely running.
Used by alarm_checker + fuel_starvation to suppress alarms during shutdowns
(when pressure / temp / drum readings fluctuate naturally and aren't real events).
"""
import logging
import sqlite3
from datetime import datetime, timedelta, timezone

log = logging.getLogger("boiler_state")

PRESSURE_TAG = "#/R1C1I4_M"
PRESSURE_RUNNING_BAR = 20.0   # if pressure > this, boiler is running
LOOKBACK_MIN = 5              # require sustained for this many minutes


def is_boiler_running(db_path: str) -> bool:
    """
    True if pressure has been > PRESSURE_RUNNING_BAR at any point in the last
    LOOKBACK_MIN minutes. False = boiler is off / cooling down — alarms should
    be suppressed because readings are unreliable / not meaningful.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=LOOKBACK_MIN)).isoformat()
    db = sqlite3.connect(db_path)
    try:
        row = db.execute(
            "SELECT MAX(value) FROM tag_readings "
            "WHERE tag = ? AND property = 'PV' AND scanned_at >= ?",
            (PRESSURE_TAG, cutoff),
        ).fetchone()
    except sqlite3.OperationalError as e:
        log.debug(f"boiler_state query failed: {e}")
        return True  # If we can't tell, default to RUNNING (don't suppress alarms — fail-safe)
    finally:
        db.close()
    if not row or row[0] is None:
        return True  # No data — fail-safe to running
    return float(row[0]) > PRESSURE_RUNNING_BAR
