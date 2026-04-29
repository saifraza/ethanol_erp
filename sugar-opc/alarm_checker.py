"""
MSPIL OPC Bridge — Local Alarm Checker (v2)

Runs LOCALLY on bridge. Sends Telegram directly (cloud-independent).
HH/LL alarm limits are still set from ERP (cloud) and pulled by the bridge.
Cloud is notified for audit logging only.

Also runs the multi-condition fuel-starvation detector on each scan.
"""
import time
import json
import logging
import urllib.request
import urllib.error

import telegram_local
import fuel_starvation
import boiler_state
from config import CLOUD_API_URL, CLOUD_API_KEY, SOURCE, DB_PATH

log = logging.getLogger("alarm_checker")

ALARM_COOLDOWN_SECONDS = 600  # 10 minutes per HH/LL alarm


class AlarmChecker:
    def __init__(self):
        self._cooldowns: dict = {}
        self._cloud_url = CLOUD_API_URL.rstrip("/")
        self._cloud_key = CLOUD_API_KEY

    def check_readings(self, readings: list, tag_config: dict) -> list:
        # Suppress all alarms when boiler is off (pressure < 20 bar for 5+ min)
        # Avoids alarm spam during shutdowns / restarts when readings are unreliable
        if not boiler_state.is_boiler_running(DB_PATH):
            log.debug("Boiler off (pressure < 20 bar sustained) — alarms suppressed")
            return []

        # First — multi-condition fuel-starvation (uses recent SQLite history)
        try:
            fuel_starvation.check(DB_PATH)
        except Exception as e:
            log.error(f"fuel_starvation check failed: {e}")

        # Then — simple HH/LL on each tag
        fired = []
        for tag, prop, value in readings:
            config = tag_config.get(tag)
            if not config:
                continue
            hh = config.get("hh_alarm")
            ll = config.get("ll_alarm")
            label = config.get("label", tag)
            if hh is not None and value >= hh:
                alert = self._try_fire("HH", tag, value, hh, label)
                if alert: fired.append(alert)
            if ll is not None and value <= ll:
                alert = self._try_fire("LL", tag, value, ll, label)
                if alert: fired.append(alert)
        return fired

    def _try_fire(self, alarm_type: str, tag: str, value: float, limit: float, label: str):
        now = time.time()
        key = f"{tag}:{alarm_type}"
        if now - self._cooldowns.get(key, 0) < ALARM_COOLDOWN_SECONDS:
            return None
        self._cooldowns[key] = now
        log.warning(f"ALARM {alarm_type}: {label} ({tag}) = {value:.2f} (limit: {limit})")

        # Direct Telegram (cloud-independent path)
        emoji = "🔥" if alarm_type == "HH" else "❄️"
        ist = time.strftime("%I:%M %p", time.gmtime(now + 5.5 * 3600))
        msg = (
            f"⚠️ *{alarm_type} ALARM — Sugar Boiler*\n"
            f"_(local alarm — bridge-side detection)_\n\n"
            f"{emoji} *{label}*\n"
            f"   Value: `{value:.2f}` (limit: `{limit}`)\n\n"
            f"🕐 {ist} IST"
        )
        telegram_local.send(msg)

        return {
            "tag": tag, "label": label,
            "value": round(value, 4), "limit": limit,
            "alarmType": alarm_type, "source": SOURCE,
        }

    def notify_cloud(self, alerts: list) -> int:
        """Best-effort cloud notification for audit logging only — Telegram already sent."""
        sent = 0
        for alert in alerts:
            try:
                body = json.dumps(alert).encode("utf-8")
                req = urllib.request.Request(
                    f"{self._cloud_url}/alarm-notify",
                    data=body,
                    headers={"Content-Type": "application/json", "X-OPC-Key": self._cloud_key},
                    method="POST",
                )
                resp = urllib.request.urlopen(req, timeout=15)
                if resp.getcode() in (200, 201):
                    sent += 1
                else:
                    log.warning(f"Cloud returned {resp.getcode()} for alarm notify")
            except Exception as e:
                log.error(f"Cloud notify failed (Telegram already sent direct): {e}")
        return sent
