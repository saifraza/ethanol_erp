"""
MSPIL Sugar OPC Bridge — Local API Server
Same as ethanol API but browse uses Fuji's direct node IDs.
Runs on port 8099.

Endpoints:
  GET  /health                  — Service status
  GET  /browse                  — List all tags in Fuji DCS (Module TAGs)
  GET  /read/<tag>              — Read a single tag value live
  GET  /monitor                 — List monitored tags
  POST /monitor                 — Add tag to watch list
  DELETE /monitor/<tag>         — Remove tag from watch list
  GET  /live                    — Latest values for all monitored tags
  GET  /live/<tag>              — Latest value for one monitored tag
  GET  /history/<tag>?hours=24  — Historical readings for a tag
  GET  /stats                   — DB statistics
"""

import json
import sqlite3
import logging
import time
import asyncio
import threading
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict

from config import (
    DB_PATH, API_HOST, API_PORT, OPC_SERVER,
    API_RATE_LIMIT_PER_MINUTE, SOURCE,
)

log = logging.getLogger("api_server")

_rate_lock = threading.Lock()
_rate_buckets: dict = defaultdict(list)
_rate_last_cleanup = time.time()


def _check_rate_limit(ip: str) -> bool:
    global _rate_last_cleanup
    now = time.time()
    with _rate_lock:
        if now - _rate_last_cleanup > 300:
            stale_ips = [k for k, v in _rate_buckets.items() if not v or now - v[-1] > 120]
            for k in stale_ips:
                del _rate_buckets[k]
            _rate_last_cleanup = now
        cutoff = now - 60
        _rate_buckets[ip] = [t for t in _rate_buckets[ip] if t > cutoff]
        if len(_rate_buckets[ip]) >= API_RATE_LIMIT_PER_MINUTE:
            return False
        _rate_buckets[ip].append(now)
        return True


# Browse client for Fuji (asyncua)
_browse_client = None
_browse_client_time = 0
_browse_lock = threading.Lock()
_browse_loop = None


def _get_browse_loop():
    global _browse_loop
    if _browse_loop is None:
        _browse_loop = asyncio.new_event_loop()
    return _browse_loop


async def _get_fuji_client():
    global _browse_client, _browse_client_time
    now = time.time()
    if _browse_client and (now - _browse_client_time) < 300:
        return _browse_client
    if _browse_client:
        try:
            await _browse_client.disconnect()
        except Exception:
            pass
    from asyncua import Client
    client = Client(OPC_SERVER["endpoint"])
    client.timeout = 15000
    await client.connect()
    _browse_client = client
    _browse_client_time = now
    log.info("Browse client connected to Fuji DCS")
    return client


async def _read_tag_live_async(tag_name: str, properties: list = None):
    client = await _get_fuji_client()
    if properties is None:
        properties = ["PV"]
    values = {}
    for prop in properties:
        node_id = f"ns=2;s={tag_name}.{prop}"
        try:
            node = client.get_node(node_id)
            value = await node.read_value()
            if value is not None:
                values[prop] = round(float(value), 4)
        except Exception:
            pass
    if not values:
        return {"tag": tag_name, "error": "No readable properties"}
    return {
        "tag": tag_name,
        "source": SOURCE,
        "values": values,
        "readAt": datetime.utcnow().isoformat() + "Z",
    }


_start_time = time.time()


class OPCAPIHandler(BaseHTTPRequestHandler):
    db: sqlite3.Connection = None

    def _json(self, data, status=200):
        body = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}

    def _extract_tag(self, path: str, prefix: str, params: dict) -> str:
        """Extract tag name from query param (?tag=) or URL path, handling # encoding."""
        if "tag" in params:
            return params["tag"][0]
        raw = path.split(prefix)[1] if prefix in path else ""
        return unquote(raw)

    def do_GET(self):
        if not _check_rate_limit(self.client_address[0]):
            self._json({"error": "Rate limited"}, 429)
            return
        parsed = urlparse(self.path)
        path = unquote(parsed.path).rstrip("/")
        params = parse_qs(parsed.query)

        try:
            if path == "/health":
                self._handle_health()
            elif path.startswith("/read/"):
                tag = self._extract_tag(path, "/read/", params)
                self._handle_read_tag(tag)
            elif path == "/monitor":
                self._handle_list_monitored()
            elif path == "/live":
                tag_param = params.get("tag", [None])[0]
                if tag_param:
                    self._handle_live_tag(tag_param)
                else:
                    self._handle_live_all()
            elif path.startswith("/live/"):
                tag = self._extract_tag(path, "/live/", params)
                self._handle_live_tag(tag)
            elif path == "/history":
                tag = params.get("tag", [None])[0]
                if not tag:
                    self._json({"error": "tag param required"}, 400)
                    return
                hours = int(params.get("hours", ["24"])[0])
                self._handle_history(tag, hours)
            elif path.startswith("/history/"):
                tag = self._extract_tag(path, "/history/", params)
                hours = int(params.get("hours", ["24"])[0])
                self._handle_history(tag, hours)
            elif path == "/stats":
                self._handle_stats()
            else:
                self._json({"error": "Not found", "source": SOURCE}, 404)
        except Exception as e:
            log.error(f"API error on {path}: {e}")
            self._json({"error": "Internal server error"}, 500)

    def do_POST(self):
        if not _check_rate_limit(self.client_address[0]):
            self._json({"error": "Rate limited"}, 429)
            return
        path = urlparse(self.path).path.rstrip("/")
        try:
            if path == "/monitor":
                self._handle_add_monitor()
            else:
                self._json({"error": "Not found"}, 404)
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def do_DELETE(self):
        if not _check_rate_limit(self.client_address[0]):
            self._json({"error": "Rate limited"}, 429)
            return
        parsed = urlparse(self.path)
        path = unquote(parsed.path).rstrip("/")
        params = parse_qs(parsed.query)
        try:
            if path.startswith("/monitor/"):
                tag = self._extract_tag(path, "/monitor/", params)
                self._handle_remove_monitor(tag)
            else:
                self._json({"error": "Not found"}, 404)
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def _handle_read_tag(self, tag_name):
        is_pid = "PID" in tag_name.upper()
        props = ["PV", "SV", "MV"] if is_pid else ["PV"]
        loop = _get_browse_loop()
        with _browse_lock:
            try:
                result = loop.run_until_complete(_read_tag_live_async(tag_name, props))
                self._json(result)
            except Exception as e:
                self._json({"error": f"Cannot connect to OPC: {e}"}, 502)

    def _handle_list_monitored(self):
        cursor = self.db.execute(
            "SELECT tag, area, folder, tag_type, label, added_at FROM monitored_tags ORDER BY area, tag"
        )
        tags = [{"tag": r[0], "area": r[1], "folder": r[2], "tagType": r[3], "label": r[4], "addedAt": r[5]} for r in cursor.fetchall()]
        self._json({"tags": tags, "count": len(tags), "source": SOURCE})

    def _handle_add_monitor(self):
        body = self._read_body()
        tag = body.get("tag", "").strip()
        area = body.get("area", "Sugar").strip()
        folder = body.get("folder", "Module").strip()
        tag_type = body.get("tagType", "analog").strip()
        label = body.get("label", "").strip() or tag
        if not tag:
            self._json({"error": "tag is required"}, 400)
            return
        now = datetime.utcnow().isoformat() + "Z"
        self.db.execute(
            "INSERT OR REPLACE INTO monitored_tags (tag, area, folder, tag_type, label, added_at) VALUES (?, ?, ?, ?, ?, ?)",
            (tag, area, folder, tag_type, label, now),
        )
        self.db.commit()
        log.info(f"Monitoring started: {tag}")
        self._json({"ok": True, "tag": tag}, 201)

    def _handle_remove_monitor(self, tag_name):
        cursor = self.db.execute("DELETE FROM monitored_tags WHERE tag = ?", (tag_name,))
        self.db.commit()
        if cursor.rowcount:
            self._json({"ok": True})
        else:
            self._json({"error": "Not monitored"}, 404)

    def _handle_live_all(self):
        cursor = self.db.execute(
            "SELECT tl.tag, tl.property, tl.value, tl.area, tl.tag_type, tl.updated_at, mt.label "
            "FROM tag_latest tl JOIN monitored_tags mt ON tl.tag = mt.tag ORDER BY tl.area, tl.tag"
        )
        tags = {}
        for row in cursor.fetchall():
            tag, prop, val, area, ttype, updated, label = row
            if tag not in tags:
                tags[tag] = {"tag": tag, "area": area, "type": ttype, "label": label, "updatedAt": updated, "values": {}}
            tags[tag]["values"][prop] = val
        self._json({"tags": list(tags.values()), "count": len(tags), "source": SOURCE})

    def _handle_live_tag(self, tag_name):
        cursor = self.db.execute(
            "SELECT property, value, area, tag_type, updated_at FROM tag_latest WHERE tag = ?", (tag_name,),
        )
        rows = cursor.fetchall()
        if not rows:
            self._json({"error": f"No data for '{tag_name}'"}, 404)
            return
        values = {row[0]: row[1] for row in rows}
        self._json({"tag": tag_name, "area": rows[0][2], "type": rows[0][3], "updatedAt": rows[0][4], "values": values})

    def _handle_history(self, tag_name, hours):
        hours = min(hours, 168)
        cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat() + "Z"
        cursor = self.db.execute(
            "SELECT property, value, scanned_at FROM tag_readings WHERE tag = ? AND scanned_at > ? ORDER BY scanned_at",
            (tag_name, cutoff),
        )
        readings = [{"property": r[0], "value": r[1], "time": r[2]} for r in cursor.fetchall()]
        self._json({"tag": tag_name, "hours": hours, "readings": readings, "count": len(readings)})

    def _handle_health(self):
        monitored = self.db.execute("SELECT COUNT(*) FROM monitored_tags").fetchone()[0]
        cached = self.db.execute("SELECT COUNT(*) FROM tag_latest").fetchone()[0]
        last = self.db.execute("SELECT MAX(updated_at) FROM tag_latest").fetchone()[0]
        pending = self.db.execute("SELECT COUNT(*) FROM sync_queue WHERE synced = 0").fetchone()[0]
        self._json({
            "status": "ok", "source": SOURCE,
            "monitoredTags": monitored, "cachedValues": cached,
            "lastScan": last, "pendingSyncs": pending,
            "uptimeSeconds": int(time.time() - _start_time), "pid": os.getpid(),
        })

    def _handle_stats(self):
        stats = {"source": SOURCE}
        for q, k in [
            ("SELECT COUNT(*) FROM tag_readings", "totalReadings"),
            ("SELECT COUNT(*) FROM monitored_tags", "monitoredTags"),
            ("SELECT COUNT(*) FROM tag_latest", "cachedValues"),
            ("SELECT COUNT(*) FROM sync_queue WHERE synced = 0", "pendingSyncs"),
        ]:
            stats[k] = self.db.execute(q).fetchone()[0]
        self._json(stats)

    def log_message(self, fmt, *args):
        log.debug(f"API: {args[0]}")


class ShutdownHTTPServer(HTTPServer):
    def __init__(self, *args, shutdown_event=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._shutdown_event = shutdown_event

    def service_actions(self):
        if self._shutdown_event and self._shutdown_event.is_set():
            raise KeyboardInterrupt("Shutdown requested")


def start_api(db=None, shutdown_event=None):
    if db is None:
        from opc_scanner import init_db
        db = init_db()
    OPCAPIHandler.db = db
    server = ShutdownHTTPServer((API_HOST, API_PORT), OPCAPIHandler, shutdown_event=shutdown_event)
    server.timeout = 1
    log.info(f"API server on {API_HOST}:{API_PORT} (source={SOURCE})")
    try:
        server.serve_forever(poll_interval=1)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        global _browse_client
        if _browse_client:
            try:
                loop = _get_browse_loop()
                loop.run_until_complete(_browse_client.disconnect())
            except Exception:
                pass
            _browse_client = None
        log.info("API server stopped")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    start_api()
