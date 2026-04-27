"""
MSPIL Sugar OPC Bridge — Cloud Sync
Same as ethanol cloud_sync.py but sends source=SUGAR in all payloads
and pulls tags filtered by ?source=SUGAR.
"""

import json
import sqlite3
import time
import logging
import threading
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from typing import Optional

from config import (
    DB_PATH, CLOUD_API_URL, CLOUD_API_KEY,
    SYNC_INTERVAL_SECONDS, SYNC_RETRY_MAX, TAG_PULL_ENABLED,
    BACKOFF_INITIAL_SECONDS, BACKOFF_MAX_SECONDS, BACKOFF_MULTIPLIER,
    SOURCE,
)

log = logging.getLogger("cloud_sync")


class CloudSync:
    def __init__(self, db: sqlite3.Connection = None,
                 shutdown_event: Optional[threading.Event] = None):
        self.db = db or sqlite3.connect(DB_PATH, check_same_thread=False)
        self.last_synced_hour: str = ""
        self.last_push_batch: str = ""
        self._shutdown = shutdown_event or threading.Event()
        self._consecutive_failures = 0
        self._cloud_available = True
        self._last_tag_pull = 0

    def _post(self, path: str, payload: dict) -> bool:
        url = CLOUD_API_URL.rstrip("/") + path
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=body,
            headers={"Content-Type": "application/json", "X-OPC-Key": CLOUD_API_KEY},
            method="POST",
        )
        try:
            resp = urllib.request.urlopen(req, timeout=30)
            if resp.getcode() in (200, 201):
                self._on_cloud_success()
                return True
            log.warning(f"Cloud returned {resp.getcode()}")
            return False
        except urllib.error.URLError as e:
            self._on_cloud_failure(f"Cloud unreachable: {e}")
            return False
        except Exception as e:
            self._on_cloud_failure(f"Cloud error: {e}")
            return False

    def _get(self, path: str) -> Optional[dict]:
        url = CLOUD_API_URL.rstrip("/") + path
        req = urllib.request.Request(
            url, headers={"X-OPC-Key": CLOUD_API_KEY}, method="GET",
        )
        try:
            resp = urllib.request.urlopen(req, timeout=15)
            if resp.getcode() == 200:
                self._on_cloud_success()
                return json.loads(resp.read().decode("utf-8"))
            return None
        except Exception as e:
            log.debug(f"GET {path} failed: {e}")
            return None

    def _on_cloud_success(self):
        if not self._cloud_available:
            log.info("Cloud connection restored!")
        self._cloud_available = True
        self._consecutive_failures = 0

    def _on_cloud_failure(self, msg: str):
        self._consecutive_failures += 1
        self._cloud_available = False
        log.error(f"{msg} (failure #{self._consecutive_failures})")

    def _get_backoff_seconds(self) -> float:
        return min(
            BACKOFF_INITIAL_SECONDS * (BACKOFF_MULTIPLIER ** self._consecutive_failures),
            BACKOFF_MAX_SECONDS,
        )

    def push_readings(self, batch_id: str = None):
        if batch_id and batch_id == self.last_push_batch:
            return

        PUSH_BATCH_SIZE = 500
        is_backfill = False

        if not self.last_push_batch:
            cursor = self.db.execute(
                "SELECT tag, property, value, scanned_at, scan_batch FROM tag_readings "
                "ORDER BY scan_batch DESC LIMIT ?", (PUSH_BATCH_SIZE,)
            )
            rows = cursor.fetchall()
            if rows:
                rows.reverse()
                last_batch = rows[-1][4]
                first_batch = rows[0][4]
                self._backfill_before = first_batch
                log.info(f"Restart recovery: pushing {len(rows)} latest readings first")
            else:
                return
        else:
            cursor = self.db.execute(
                "SELECT tag, property, value, scanned_at, scan_batch FROM tag_readings "
                "WHERE scan_batch > ? ORDER BY scanned_at LIMIT ?",
                (self.last_push_batch, PUSH_BATCH_SIZE)
            )
            rows = cursor.fetchall()
            if rows:
                last_batch = rows[-1][4]
            else:
                if hasattr(self, '_backfill_before') and self._backfill_before:
                    cursor = self.db.execute(
                        "SELECT tag, property, value, scanned_at, scan_batch FROM tag_readings "
                        "WHERE scan_batch < ? ORDER BY scanned_at DESC LIMIT ?",
                        (self._backfill_before, PUSH_BATCH_SIZE)
                    )
                    rows = cursor.fetchall()
                    if rows:
                        rows.reverse()
                        is_backfill = True
                        last_batch = rows[-1][4]
                        self._backfill_before = rows[0][4]
                        log.info(f"Backfilling {len(rows)} old readings")
                    else:
                        self._backfill_before = None
                        log.info("Backfill complete")
                        return
                if not rows:
                    return

        try:
            push_cursor = self.db.execute("SELECT tag FROM monitored_tags WHERE push_to_cloud = 1")
            push_tags = set(r[0] for r in push_cursor.fetchall())
        except Exception:
            push_tags = set(r[0] for r in self.db.execute("SELECT tag FROM monitored_tags").fetchall())

        readings = [{"tag": r[0], "property": r[1], "value": r[2], "scannedAt": r[3]} for r in rows if r[0] in push_tags]

        if not readings:
            if not is_backfill:
                self.last_push_batch = last_batch
            return

        tag_cursor = self.db.execute("SELECT tag, area, folder, tag_type, label FROM monitored_tags")
        tags = [{"tag": r[0], "area": r[1], "folder": r[2], "tagType": r[3], "label": r[4] or r[0]} for r in tag_cursor.fetchall()]

        payload = {"source": SOURCE, "readings": readings}
        if tags:
            payload["tags"] = tags

        if self._post("/push", payload):
            if not is_backfill:
                self.last_push_batch = last_batch
            log.info(f"Pushed {len(readings)} readings to cloud (source={SOURCE}){' (backfill)' if is_backfill else ''}")
        else:
            self._queue("readings", last_batch, payload)

    def _ist_hour(self, offset_hours: int = 0) -> str:
        ist = datetime.utcnow() + timedelta(hours=5, minutes=30) + timedelta(hours=offset_hours)
        return ist.strftime("%Y-%m-%dT%H")

    def push_hourly(self):
        hour_bucket = self._ist_hour(-1)
        if hour_bucket == self.last_synced_hour:
            return

        ist_start = datetime.strptime(hour_bucket, "%Y-%m-%dT%H")
        utc_start = ist_start - timedelta(hours=5, minutes=30)
        utc_end = utc_start + timedelta(hours=1)

        cursor = self.db.execute("""
            SELECT tag, property, AVG(value), MIN(value), MAX(value), COUNT(*)
            FROM tag_readings
            WHERE scanned_at >= ? AND scanned_at < ? AND value IS NOT NULL
            GROUP BY tag, property
        """, (utc_start.isoformat() + "Z", utc_end.isoformat() + "Z"))

        hourly = []
        for r in cursor.fetchall():
            hourly.append({
                "tag": r[0], "property": r[1],
                "hour": utc_start.isoformat() + "Z",
                "avg": round(r[2], 4), "min": round(r[3], 4),
                "max": round(r[4], 4), "count": r[5],
            })

        if not hourly:
            self.last_synced_hour = hour_bucket
            return

        if self._post("/push-hourly", {"source": SOURCE, "hourly": hourly}):
            self.last_synced_hour = hour_bucket
            log.info(f"Pushed {len(hourly)} hourly aggregates for {hour_bucket} IST (source={SOURCE})")
        else:
            self._queue("hourly", hour_bucket, {"source": SOURCE, "hourly": hourly})

    def pull_tags_from_cloud(self):
        if not TAG_PULL_ENABLED:
            return
        now = time.time()
        if now - self._last_tag_pull < SYNC_INTERVAL_SECONDS:
            return

        # Pull tags filtered by source=SUGAR
        data = self._get(f"/monitor/pull?source={SOURCE}")
        if data is None:
            log.debug("Tag pull skipped (cloud unreachable)")
            return

        self._last_tag_pull = now
        cloud_tags = data.get("tags", [])
        if not isinstance(cloud_tags, list):
            log.warning("Invalid tag pull response")
            return

        cloud_tag_map = {}
        for t in cloud_tags:
            tag = t.get("tag", "").strip()
            if tag:
                cloud_tag_map[tag] = {
                    "area": t.get("area", ""),
                    "folder": t.get("folder", ""),
                    "tag_type": t.get("tagType", "analog"),
                    "label": t.get("label", "") or tag,
                    "hh_alarm": t.get("hhAlarm"),
                    "ll_alarm": t.get("llAlarm"),
                    "push_to_cloud": 1 if t.get("pushToCloud", True) else 0,
                }

        cursor = self.db.execute("SELECT tag FROM monitored_tags")
        local_tags = set(r[0] for r in cursor.fetchall())

        now_str = datetime.utcnow().isoformat() + "Z"
        added = removed = updated = 0

        for tag, info in cloud_tag_map.items():
            if tag in local_tags:
                try:
                    self.db.execute(
                        "UPDATE monitored_tags SET area=?, folder=?, tag_type=?, label=?, hh_alarm=?, ll_alarm=?, push_to_cloud=? WHERE tag=?",
                        (info["area"], info["folder"], info["tag_type"], info["label"], info["hh_alarm"], info["ll_alarm"], info["push_to_cloud"], tag)
                    )
                except Exception:
                    self.db.execute(
                        "UPDATE monitored_tags SET area=?, folder=?, tag_type=?, label=? WHERE tag=?",
                        (info["area"], info["folder"], info["tag_type"], info["label"], tag)
                    )
                updated += 1
            else:
                try:
                    self.db.execute(
                        "INSERT INTO monitored_tags (tag, area, folder, tag_type, label, added_at, hh_alarm, ll_alarm, push_to_cloud) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (tag, info["area"], info["folder"], info["tag_type"], info["label"], now_str, info["hh_alarm"], info["ll_alarm"], info["push_to_cloud"])
                    )
                except Exception:
                    self.db.execute(
                        "INSERT INTO monitored_tags (tag, area, folder, tag_type, label, added_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (tag, info["area"], info["folder"], info["tag_type"], info["label"], now_str)
                    )
                added += 1

        for local_tag in local_tags:
            if local_tag not in cloud_tag_map:
                self.db.execute("DELETE FROM monitored_tags WHERE tag = ?", (local_tag,))
                removed += 1

        if added or removed or updated:
            self.db.commit()
            log.info(f"Tag sync: {added} added, {removed} removed, {updated} updated (cloud has {len(cloud_tag_map)} tags)")
        else:
            log.debug(f"Tag sync: no changes ({len(cloud_tag_map)} tags)")

    def _queue(self, sync_type: str, batch: str, payload: dict):
        self.db.execute(
            "INSERT INTO sync_queue (hour_bucket, payload, created_at) VALUES (?, ?, ?)",
            (f"{sync_type}:{batch}", json.dumps(payload), datetime.utcnow().isoformat() + "Z"),
        )
        self.db.commit()
        log.info(f"Queued {sync_type}:{batch} for retry")

    def retry_queued(self):
        if not self._cloud_available and self._consecutive_failures > 2:
            return

        dead = self.db.execute(
            "SELECT COUNT(*) FROM sync_queue WHERE synced = 0 AND attempts >= ?", (SYNC_RETRY_MAX,),
        ).fetchone()
        if dead and dead[0] > 0:
            log.error(f"ALERT: {dead[0]} OPC sync items stuck in queue (>= {SYNC_RETRY_MAX} failed attempts)")

        cursor = self.db.execute(
            "SELECT id, hour_bucket, payload, attempts FROM sync_queue "
            "WHERE synced = 0 AND attempts < ? ORDER BY created_at LIMIT 10",
            (SYNC_RETRY_MAX,),
        )
        rows = cursor.fetchall()
        if not rows:
            return

        for row in rows:
            if self._shutdown.is_set():
                break
            qid, bucket, payload_json, attempts = row
            payload = json.loads(payload_json)
            sync_type = bucket.split(":")[0] if ":" in bucket else "hourly"
            path = "/push" if sync_type == "readings" else "/push-hourly"

            log.info(f"Retrying {bucket} (attempt {attempts + 1}/{SYNC_RETRY_MAX})")
            if self._post(path, payload):
                self.db.execute("UPDATE sync_queue SET synced = 1 WHERE id = ?", (qid,))
            else:
                self.db.execute("UPDATE sync_queue SET attempts = attempts + 1 WHERE id = ?", (qid,))
                self.db.commit()
                break
            self.db.commit()

    def sync_now(self):
        self.push_readings()
        self.push_hourly()
        self.pull_tags_from_cloud()
        self.retry_queued()

    def _sleep_with_shutdown(self, seconds: float):
        self._shutdown.wait(timeout=seconds)

    def run_loop(self):
        log.info(f"Cloud sync loop starting (source={SOURCE})")
        while not self._shutdown.is_set():
            try:
                self.sync_now()
            except Exception as e:
                log.error(f"Sync error: {e}")

            if self._cloud_available:
                self._sleep_with_shutdown(SYNC_INTERVAL_SECONDS)
            else:
                backoff = self._get_backoff_seconds()
                log.debug(f"Cloud down, backing off {backoff:.0f}s")
                self._sleep_with_shutdown(backoff)

        log.info("Cloud sync shutting down...")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    sync = CloudSync()
    sync.sync_now()
