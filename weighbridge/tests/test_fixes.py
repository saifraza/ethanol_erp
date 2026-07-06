"""
Unit tests for the 2026-07-06 review fixes.
No hardware, no network — runs anywhere:

    cd weighbridge && python3 tests/test_fixes.py

Covers:
  Fix #1 — sync-queue failure classification: transient failures must NOT
           consume retry attempts; only deterministic 4xx rejections do;
           stuck rows are requeued at startup.
  Fix #3 — serial drain: all buffered frames are consumed per pass and the
           newest valid frame wins.
"""

import io
import os
import sys
import socket
import tempfile
import unittest
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import local_db
import cloud_sync
from cloud_sync import CloudSync, is_permanent_rejection
from weight_reader import SerialReader


def _http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("http://x/push", code, "err", {}, io.BytesIO(b""))


class TestFailureClassification(unittest.TestCase):
    """Fix #1a — is_permanent_rejection()."""

    def test_network_errors_are_transient(self):
        self.assertFalse(is_permanent_rejection(urllib.error.URLError("refused")))
        self.assertFalse(is_permanent_rejection(socket.timeout("timed out")))
        self.assertFalse(is_permanent_rejection(ConnectionResetError()))
        self.assertFalse(is_permanent_rejection(OSError("network unreachable")))

    def test_5xx_and_retryable_4xx_are_transient(self):
        for code in (500, 502, 503, 504, 408, 429, 401, 403):
            self.assertFalse(is_permanent_rejection(_http_error(code)), code)

    def test_deterministic_4xx_is_permanent(self):
        for code in (400, 404, 409, 422):
            self.assertTrue(is_permanent_rejection(_http_error(code)), code)


class _TempDbCase(unittest.TestCase):
    """Point local_db at a throwaway SQLite file."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old_db_path = local_db.DB_PATH
        local_db.DB_PATH = os.path.join(self._tmp.name, "test.db")
        local_db._local.conn = None  # drop any cached connection
        local_db.init_db()

    def tearDown(self):
        try:
            if getattr(local_db._local, "conn", None):
                local_db._local.conn.close()
        except Exception:
            pass
        local_db._local.conn = None
        local_db.DB_PATH = self._old_db_path
        self._tmp.cleanup()

    def _enqueue(self, wid="w-1") -> int:
        conn = local_db._get_conn()
        cur = conn.execute(
            "INSERT INTO sync_queue (weighment_id, payload) VALUES (?, ?)",
            (wid, "{}"))
        conn.commit()
        return cur.lastrowid

    def _attempts(self, qid: int) -> int:
        row = local_db._get_conn().execute(
            "SELECT attempts FROM sync_queue WHERE id = ?", (qid,)).fetchone()
        return row["attempts"]


class TestSyncQueueRetries(_TempDbCase):
    """Fix #1 — attempts accounting, requeue_stuck, startup recovery."""

    def test_transient_failures_never_burn_attempts(self):
        qid = self._enqueue()
        for _ in range(50):  # a long outage worth of failures
            local_db.mark_sync_failed(qid, count_attempt=False)
        self.assertEqual(self._attempts(qid), 0)
        self.assertEqual(len(local_db.get_pending_sync()), 1)

    def test_permanent_failures_burn_attempts_and_dead_letter(self):
        qid = self._enqueue()
        for _ in range(local_db.SYNC_MAX_ATTEMPTS):
            local_db.mark_sync_failed(qid, count_attempt=True)
        self.assertEqual(self._attempts(qid), local_db.SYNC_MAX_ATTEMPTS)
        self.assertEqual(local_db.get_pending_sync(), [])

    def test_requeue_stuck_heals_dead_lettered_rows(self):
        qid = self._enqueue()
        for _ in range(local_db.SYNC_MAX_ATTEMPTS):
            local_db.mark_sync_failed(qid, count_attempt=True)
        self.assertEqual(local_db.get_pending_sync(), [])
        self.assertEqual(local_db.requeue_stuck(), 1)
        self.assertEqual(self._attempts(qid), 0)
        self.assertEqual(len(local_db.get_pending_sync()), 1)

    def test_init_db_requeues_on_boot(self):
        qid = self._enqueue()
        for _ in range(local_db.SYNC_MAX_ATTEMPTS):
            local_db.mark_sync_failed(qid, count_attempt=True)
        local_db.init_db()  # simulates service restart
        self.assertEqual(self._attempts(qid), 0)

    def test_sent_rows_are_not_requeued(self):
        qid = self._enqueue()
        local_db.mark_synced(qid)
        conn = local_db._get_conn()
        conn.execute("UPDATE sync_queue SET attempts = 99 WHERE id = ?", (qid,))
        conn.commit()
        self.assertEqual(local_db.requeue_stuck(), 0)


class TestPushClassification(_TempDbCase):
    """Fix #1 — push_weighments end-to-end with a stubbed HTTP layer."""

    def _push_with(self, exc):
        sync = CloudSync()
        def _raise(*a, **k):
            raise exc
        sync._do_request = _raise
        sync.push_weighments()

    def test_network_outage_does_not_burn_attempts(self):
        qid = self._enqueue()
        for _ in range(3):
            self._push_with(urllib.error.URLError("connection refused"))
        self.assertEqual(self._attempts(qid), 0)

    def test_server_rejection_burns_attempts(self):
        qid = self._enqueue()
        self._push_with(_http_error(400))
        self.assertEqual(self._attempts(qid), 1)

    def test_error_body_burns_attempts(self):
        qid = self._enqueue()
        sync = CloudSync()
        sync._do_request = lambda *a, **k: {"error": "duplicate ticket"}
        sync.push_weighments()
        self.assertEqual(self._attempts(qid), 1)


class _FakeSerial:
    """Stands in for serial.Serial in _drain_frames tests."""

    def __init__(self, lines):
        self._lines = list(lines)
        self.is_open = True

    def readline(self):
        if not self._lines:
            return b""
        return self._lines.pop(0)

    @property
    def in_waiting(self):
        return sum(len(l) for l in self._lines)


class TestSerialDrain(unittest.TestCase):
    """Fix #3 — drain all buffered lines, newest valid frame wins."""

    def _reader(self, lines) -> SerialReader:
        r = SerialReader()
        r._serial = _FakeSerial(lines)
        return r

    def test_drains_backlog_and_keeps_newest_frame(self):
        lines = [b"\x02 010000\x03\r\n", b"\x02 015000\x03\r\n",
                 b"\x02 024850\x03\r\n"]
        r = self._reader(lines)
        self.assertTrue(r._drain_frames())
        weight, _, _ = r.get_weight()
        self.assertEqual(weight, 24850.0)
        self.assertEqual(r.get_status()["frameCount"], 3)

    def test_skips_garbage_lines(self):
        lines = [b"\x02 020000\x03\r\n", b"\xff\xfe\r\n", b"\x02 021000\x03\r\n"]
        r = self._reader(lines)
        self.assertTrue(r._drain_frames())
        weight, _, _ = r.get_weight()
        self.assertEqual(weight, 21000.0)

    def test_empty_port_returns_no_frame(self):
        r = self._reader([])
        self.assertFalse(r._drain_frames())

    def test_drain_is_capped_per_pass(self):
        lines = [b"\x02 010000\x03\r\n"] * (SerialReader.MAX_FRAMES_PER_DRAIN + 40)
        r = self._reader(lines)
        r._drain_frames()
        self.assertEqual(r.get_status()["frameCount"],
                         SerialReader.MAX_FRAMES_PER_DRAIN)


if __name__ == "__main__":
    unittest.main(verbosity=2)
