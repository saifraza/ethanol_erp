"""
MSPIL Sugar OPC Bridge — Tag Scanner (Fuji DCS)
Uses asyncua for Fuji XDS3000 OPC-UA server.
Reads tags via direct node ID (ns=2;s=#/R1C1I1_M.PV) — no tree navigation.
Stores readings in local SQLite. Auto-purges after 7 days.

Key differences from ethanol (ABB 800xA) scanner:
  - asyncua instead of opcua (Fuji needs async client)
  - No auth, no certs (Fuji DCS is open)
  - Direct node ID reads instead of tree path navigation
  - Tags read .PV property (Module TAGs) — same property name, different read method
"""

import sqlite3
import time
import asyncio
import logging
import os
import threading
from datetime import datetime, timedelta
from typing import Optional
from collections import OrderedDict

from config import (
    OPC_SERVER, DB_PATH, LOCAL_RETENTION_DAYS, SCAN_INTERVAL_SECONDS,
    OPC_CACHE_MAX_SIZE, BACKOFF_INITIAL_SECONDS,
    BACKOFF_MAX_SECONDS, BACKOFF_MULTIPLIER,
    QUEUE_RETENTION_HOURS, OPC_CONNECT_TIMEOUT_MS,
    SOURCE,
)

log = logging.getLogger("scanner")


def init_db() -> sqlite3.Connection:
    """Create all tables."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = sqlite3.connect(DB_PATH, check_same_thread=False)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")

    db.execute("""
        CREATE TABLE IF NOT EXISTS monitored_tags (
            tag TEXT PRIMARY KEY,
            area TEXT NOT NULL,
            folder TEXT NOT NULL,
            tag_type TEXT NOT NULL DEFAULT 'analog',
            label TEXT DEFAULT '',
            added_at TEXT NOT NULL,
            hh_alarm REAL,
            ll_alarm REAL,
            push_to_cloud INTEGER NOT NULL DEFAULT 1
        )
    """)
    for col, dtype, default in [("hh_alarm", "REAL", None), ("ll_alarm", "REAL", None), ("push_to_cloud", "INTEGER NOT NULL", "1")]:
        try:
            defstr = f" DEFAULT {default}" if default else ""
            db.execute(f"ALTER TABLE monitored_tags ADD COLUMN {col} {dtype}{defstr}")
        except Exception:
            pass

    db.execute("""
        CREATE TABLE IF NOT EXISTS tag_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag TEXT NOT NULL,
            area TEXT NOT NULL,
            tag_type TEXT NOT NULL,
            property TEXT NOT NULL,
            value REAL,
            scanned_at TEXT NOT NULL,
            scan_batch TEXT NOT NULL
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_readings_tag ON tag_readings(tag)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_readings_time ON tag_readings(scanned_at)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_readings_batch ON tag_readings(scan_batch)")

    db.execute("""
        CREATE TABLE IF NOT EXISTS tag_latest (
            tag TEXT NOT NULL,
            property TEXT NOT NULL,
            value REAL,
            area TEXT NOT NULL,
            tag_type TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (tag, property)
        )
    """)

    db.execute("""
        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hour_bucket TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            attempts INTEGER DEFAULT 0,
            synced INTEGER DEFAULT 0
        )
    """)

    db.commit()
    return db


class LRUCache:
    def __init__(self, max_size: int):
        self._cache: OrderedDict = OrderedDict()
        self._max_size = max_size

    def get(self, key: str):
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        return None

    def put(self, key: str, value):
        if key in self._cache:
            self._cache.move_to_end(key)
        self._cache[key] = value
        while len(self._cache) > self._max_size:
            self._cache.popitem(last=False)

    def clear(self):
        self._cache.clear()

    def __len__(self):
        return len(self._cache)


class OPCScanner:
    def __init__(self, shutdown_event: Optional[threading.Event] = None):
        self.client = None
        self.connected = False
        self._cache = LRUCache(OPC_CACHE_MAX_SIZE)
        self.db: Optional[sqlite3.Connection] = None
        self.scan_count = 0
        self._shutdown = shutdown_event or threading.Event()
        self._backoff = BACKOFF_INITIAL_SECONDS
        self._consecutive_failures = 0
        self._last_reconnect = 0
        self._reconnect_interval = 1800  # Force reconnect every 30 min
        self.last_scan_completed_at: float = time.time()
        self.last_scan_value_count: int = 0
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # Local alarm checker
        try:
            from alarm_checker import AlarmChecker
            self._alarm_checker = AlarmChecker()
            log.info("Alarm checker initialized")
        except ImportError:
            self._alarm_checker = None
            log.warning("alarm_checker.py not found — local alarms disabled")

    def _get_db(self) -> sqlite3.Connection:
        if self.db is None:
            self.db = init_db()
        return self.db

    async def _connect_async(self) -> bool:
        """Connect to Fuji OPC-UA server (no auth, no certs)."""
        if self.connected:
            if time.time() - self._last_reconnect > self._reconnect_interval:
                log.info("Periodic reconnect (30 min)")
                await self._disconnect_async()
            else:
                return True
        try:
            from asyncua import Client
            self.client = Client(OPC_SERVER["endpoint"])
            self.client.timeout = OPC_CONNECT_TIMEOUT_MS
            await self.client.connect()
            self.connected = True
            self._cache.clear()
            self._last_reconnect = time.time()
            self._backoff = BACKOFF_INITIAL_SECONDS
            self._consecutive_failures = 0
            log.info("OPC connected to Fuji DCS")
            return True
        except Exception as e:
            self._consecutive_failures += 1
            log.error(f"OPC connect failed (attempt #{self._consecutive_failures}): {e}")
            return False

    async def _disconnect_async(self):
        if self.connected and self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.connected = False
            self._cache.clear()

    def disconnect(self):
        """Sync disconnect for cleanup."""
        if self._loop and self.connected:
            try:
                self._loop.run_until_complete(self._disconnect_async())
            except Exception:
                pass
        if self._loop:
            try:
                self._loop.close()
            except Exception:
                pass
            self._loop = None

    def _get_monitored_tags(self) -> list:
        db = self._get_db()
        try:
            cursor = db.execute("SELECT tag, area, folder, tag_type, label, hh_alarm, ll_alarm, push_to_cloud FROM monitored_tags")
            return [{"tag": r[0], "area": r[1], "folder": r[2], "type": r[3], "label": r[4] or r[0], "hh_alarm": r[5], "ll_alarm": r[6], "push_to_cloud": bool(r[7])} for r in cursor.fetchall()]
        except Exception:
            cursor = db.execute("SELECT tag, area, folder, tag_type FROM monitored_tags")
            return [{"tag": r[0], "area": r[1], "folder": r[2], "type": r[3], "label": r[0], "hh_alarm": None, "ll_alarm": None, "push_to_cloud": True} for r in cursor.fetchall()]

    async def _read_tag_value(self, tag_name: str) -> Optional[float]:
        """Read .PV from a Fuji tag using direct node ID.

        Fuji tags: ns=2;s=#/R1C1I1_M.PV (Module tags)
        The tag_name in our DB is the full tag like #/R1C1I1_M
        """
        node_id = f"ns=2;s={tag_name}.PV"
        try:
            node = self.client.get_node(node_id)
            value = await node.read_value()
            if value is not None:
                return round(float(value), 4)
            return None
        except Exception:
            return None

    async def scan_monitored_async(self) -> dict:
        """Scan only user-monitored tags."""
        tags = self._get_monitored_tags()
        if not tags:
            log.debug("No monitored tags, skipping scan")
            return {}

        if not self.connected and not await self._connect_async():
            return {}

        batch = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        now_str = datetime.utcnow().isoformat() + "Z"
        results = {}
        rows = []
        latest_rows = []

        log.info(f"Scanning {len(tags)} monitored tags...")
        t0 = time.time()

        for t in tags:
            if self._shutdown.is_set():
                break
            tag_name = t["tag"]  # e.g. #/R1C1I1_M
            try:
                val = await self._read_tag_value(tag_name)
            except Exception as e:
                log.debug(f"  {tag_name}: read error: {e}")
                self.connected = False
                break

            if val is not None:
                prop = "PV"
                results[tag_name] = {prop: val}
                rows.append((tag_name, t["area"], t["type"], prop, val, now_str, batch))
                latest_rows.append((tag_name, prop, val, t["area"], t["type"], now_str))

        if rows:
            db = self._get_db()
            db.executemany(
                "INSERT INTO tag_readings (tag, area, tag_type, property, value, scanned_at, scan_batch) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
            db.executemany(
                "INSERT OR REPLACE INTO tag_latest (tag, property, value, area, tag_type, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)", latest_rows)
            db.commit()

        elapsed = time.time() - t0
        self.scan_count += 1
        self.last_scan_completed_at = time.time()
        self.last_scan_value_count = len(rows)
        log.info(f"Scan #{self.scan_count}: {len(results)}/{len(tags)} tags, {len(rows)} values, {elapsed:.1f}s")

        # Local alarm check
        if rows and self._alarm_checker:
            tag_config = {t["tag"]: t for t in tags}
            readings_for_alarm = [(r[0], r[3], r[4]) for r in rows]
            try:
                alerts = self._alarm_checker.check_readings(readings_for_alarm, tag_config)
                if alerts:
                    sent = self._alarm_checker.notify_cloud(alerts)
                    log.info(f"Alarms: {len(alerts)} fired, {sent} notified to cloud")
            except Exception as e:
                log.error(f"Alarm check failed: {e}")

        # Zero results with tags = stale connection
        if len(results) == 0 and len(tags) > 0 and self.connected:
            log.warning("Scan returned 0 values — OPC connection likely stale, forcing reconnect")
            await self._disconnect_async()

        return results

    def scan_monitored(self) -> dict:
        """Sync wrapper for async scan."""
        if self._loop is None:
            self._loop = asyncio.new_event_loop()
        return self._loop.run_until_complete(self.scan_monitored_async())

    def purge_old(self):
        db = self._get_db()
        cutoff = (datetime.utcnow() - timedelta(days=LOCAL_RETENTION_DAYS)).isoformat() + "Z"
        cur = db.execute("DELETE FROM tag_readings WHERE scanned_at < ?", (cutoff,))
        if cur.rowcount:
            log.info(f"Purged {cur.rowcount} old readings (>{LOCAL_RETENTION_DAYS}d)")

        queue_cutoff = (datetime.utcnow() - timedelta(hours=QUEUE_RETENTION_HOURS)).isoformat() + "Z"
        cur2 = db.execute("DELETE FROM sync_queue WHERE synced = 1 AND created_at < ?", (queue_cutoff,))
        if cur2.rowcount:
            log.info(f"Cleaned {cur2.rowcount} old synced queue entries")

        failed_cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat() + "Z"
        cur3 = db.execute(
            "DELETE FROM sync_queue WHERE synced = 0 AND attempts >= ? AND created_at < ?",
            (10, failed_cutoff)
        )
        if cur3.rowcount:
            log.info(f"Removed {cur3.rowcount} permanently failed queue entries")

        cur4 = db.execute("DELETE FROM tag_latest WHERE tag NOT IN (SELECT tag FROM monitored_tags)")
        if cur4.rowcount:
            log.info(f"Cleaned {cur4.rowcount} stale tag_latest entries")

        db.commit()

        try:
            db_size = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
            if db_size > 50 * 1024 * 1024:
                log.info(f"DB size {db_size / 1024 / 1024:.1f}MB, running VACUUM...")
                db.execute("VACUUM")
        except Exception as e:
            log.debug(f"VACUUM skipped: {e}")

    def _sleep_with_shutdown(self, seconds: float):
        self._shutdown.wait(timeout=seconds)

    def _get_backoff_seconds(self) -> float:
        return min(
            BACKOFF_INITIAL_SECONDS * (BACKOFF_MULTIPLIER ** self._consecutive_failures),
            BACKOFF_MAX_SECONDS,
        )

    def run_loop(self):
        log.info(f"Scanner loop starting (interval={SCAN_INTERVAL_SECONDS}s, source={SOURCE})")
        last_purge = time.time()
        while not self._shutdown.is_set():
            try:
                self.scan_monitored()
                self._backoff = BACKOFF_INITIAL_SECONDS
            except Exception as e:
                log.error(f"Scan error: {e}")
                self.connected = False
                backoff = self._get_backoff_seconds()
                log.info(f"Backing off {backoff:.0f}s before next scan attempt")
                self._sleep_with_shutdown(backoff)
                continue

            if time.time() - last_purge > 3600:
                try:
                    self.purge_old()
                except Exception as e:
                    log.error(f"Purge error: {e}")
                last_purge = time.time()

            self._sleep_with_shutdown(SCAN_INTERVAL_SECONDS)

        log.info("Scanner shutting down...")
        self.disconnect()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    s = OPCScanner()
    s.run_loop()
