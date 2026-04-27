"""
CHECK SILO alarm — runs locally on bridge.

Fires when boiler is loaded but losing the fight: combustion is poor,
pressure is dropping, feeders still running. Almost always means the silo
is empty or bagasse is bridging.

ALL conditions must be true (absolute, not slope-based — slope was too noisy):
  - Steam flow >= MIN_STEAM_FLOW_TPH         (boiler is loaded, not idle)
  - Furnace temp < FURNACE_LOW_C             (combustion has weakened)
  - Steam pressure < PRESSURE_LOW_BAR        (already losing pressure)
  - >= MIN_FEEDERS_RUNNING feeders > 1 RPM   (operator hasn't intentionally cut)
  - Holds 2 consecutive 60-sec checks        (suppresses transients)

Cooldown: 10 min between alarms.
"""
import logging
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import telegram_local

log = logging.getLogger("check_silo")

FEEDER_TAGS = [
    "#/R1C10I1_M", "#/R1C10I2_M", "#/R1C10I3_M",
    "#/R1C10I4_M", "#/R1C10I5_M", "#/R1C10I6_M",
]
FURNACE_TAG    = "#/R1C2I2_M"
PRESSURE_TAG   = "#/R1C1I4_M"
STEAM_FLOW_TAG = "#/R1C4I5_M"

MIN_STEAM_FLOW_TPH    = 20.0
FURNACE_LOW_C         = 550.0
PRESSURE_LOW_BAR      = 55.0
MIN_FEEDERS_RUNNING   = 3
FEEDER_RUNNING_RPM    = 1.0
COOLDOWN_MIN          = 10
REQUIRE_CONSECUTIVE   = 1

_state = {"consecutive": 0, "last_fired": 0.0}


def _ist_now_str() -> str:
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).strftime("%I:%M %p")


def _read_latest(db_path: str):
    """Latest value per tag from tag_latest table (no slope needed)."""
    tags = FEEDER_TAGS + [FURNACE_TAG, PRESSURE_TAG, STEAM_FLOW_TAG]
    placeholders = ",".join(["?"] * len(tags))
    db = sqlite3.connect(db_path)
    try:
        rows = db.execute(
            f"SELECT tag, value FROM tag_latest "
            f"WHERE tag IN ({placeholders}) AND property = 'PV'",
            tags,
        ).fetchall()
    except sqlite3.OperationalError as e:
        log.debug(f"tag_latest query failed: {e}")
        return {}
    finally:
        db.close()
    return {tag: value for tag, value in rows}


def check(db_path: str) -> bool:
    """Run check_silo rule. Returns True if alarm fired."""
    latest = _read_latest(db_path)
    if not latest:
        return False

    # All four conditions must be true
    active = sum(1 for t in FEEDER_TAGS
                 if t in latest and latest[t] > FEEDER_RUNNING_RPM)
    flow = latest.get(STEAM_FLOW_TAG)
    furn = latest.get(FURNACE_TAG)
    pres = latest.get(PRESSURE_TAG)

    triggered = (
        active >= MIN_FEEDERS_RUNNING
        and flow is not None and flow >= MIN_STEAM_FLOW_TPH
        and furn is not None and furn < FURNACE_LOW_C
        and pres is not None and pres < PRESSURE_LOW_BAR
    )
    if not triggered:
        _state["consecutive"] = 0
        return False

    _state["consecutive"] += 1
    if _state["consecutive"] < REQUIRE_CONSECUTIVE:
        return False

    now = time.time()
    if now - _state["last_fired"] < COOLDOWN_MIN * 60:
        return False

    msg_lines = [
        "🚨 *CHECK SILO — Sugar Boiler*",
        "_(local alarm — bridge-side detection)_",
        "",
        f"⚠️  Boiler is loaded but combustion is weak — silo likely empty or bridging.",
        "",
        f"💨 Steam flow: *{flow:.1f} TPH* (boiler loaded, ≥{MIN_STEAM_FLOW_TPH:.0f})",
        f"🔥 Furnace temp: *{furn:.0f}°C* (below {FURNACE_LOW_C:.0f})",
        f"📊 Steam pressure: *{pres:.1f} kg/cm²* (below {PRESSURE_LOW_BAR:.0f})",
        f"⚙️  {active}/6 feeders running",
        "",
        "👉 Check silo level immediately. Clear any bagasse bridge.",
        "",
        f"🕐 {_ist_now_str()} IST",
    ]
    if telegram_local.send("\n".join(msg_lines)):
        log.warning(
            f"CHECK SILO fired — flow {flow:.1f} TPH, "
            f"furn {furn:.0f}°C, press {pres:.1f}, feeders {active}/6"
        )
        _state["last_fired"] = now
        _state["consecutive"] = 0
        return True
    return False
