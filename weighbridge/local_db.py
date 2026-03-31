"""
MSPIL Weighbridge — Local SQLite Database
Schema, CRUD operations, and sync queue management.
WAL mode for crash safety and concurrent read/write.
"""

import sqlite3
import uuid
import json
import logging
import threading
from datetime import datetime

from config import DB_PATH, DB_RETENTION_DAYS

log = logging.getLogger("db")

_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """Get thread-local SQLite connection with WAL mode."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH, timeout=10)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA busy_timeout=5000")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_db():
    """Create tables if they don't exist."""
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS suppliers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS materials (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT,
            synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS weighments (
            id TEXT PRIMARY KEY,
            ticket_no INTEGER UNIQUE,
            direction TEXT NOT NULL DEFAULT 'IN',
            vehicle_no TEXT NOT NULL,
            supplier_name TEXT,
            material TEXT,

            -- Gate entry fields
            po_number TEXT,
            transporter TEXT,
            driver_mobile TEXT,
            vehicle_type TEXT,
            shift TEXT,
            operator_name TEXT,

            -- Weights (always in KG)
            weight_first REAL,
            weight_second REAL,
            weight_gross REAL,
            weight_tare REAL,
            weight_net REAL,
            weight_source TEXT DEFAULT 'SERIAL',

            -- Status: GATE_ENTRY → GROSS_DONE → COMPLETE
            status TEXT DEFAULT 'GATE_ENTRY',

            moisture REAL,
            bags INTEGER,
            remarks TEXT,

            -- Timestamps for each step
            gate_entry_at TEXT,
            first_weight_at TEXT,
            second_weight_at TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')),

            synced INTEGER DEFAULT 0,
            synced_at TEXT,
            cloud_id TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            weighment_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            last_attempt TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        -- Ticket number sequence (auto-increment workaround)
        CREATE TABLE IF NOT EXISTS counters (
            name TEXT PRIMARY KEY,
            value INTEGER DEFAULT 0
        );

        INSERT OR IGNORE INTO counters (name, value) VALUES ('ticket_no', 0);

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_weighments_date ON weighments(created_at);
        CREATE INDEX IF NOT EXISTS idx_weighments_vehicle ON weighments(vehicle_no);
        CREATE INDEX IF NOT EXISTS idx_weighments_status ON weighments(status);
        CREATE INDEX IF NOT EXISTS idx_weighments_synced ON weighments(synced);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
    """)
    conn.commit()
    log.info("Database initialized at %s", DB_PATH)


def _next_ticket_no() -> int:
    """Atomically increment and return next ticket number."""
    conn = _get_conn()
    conn.execute("UPDATE counters SET value = value + 1 WHERE name = 'ticket_no'")
    row = conn.execute("SELECT value FROM counters WHERE name = 'ticket_no'").fetchone()
    return row[0]


# =========================================================================
#  WEIGHMENT CRUD
# =========================================================================

def create_gate_entry(vehicle_no: str, direction: str, supplier_name: str = "",
                      material: str = "", po_number: str = "",
                      transporter: str = "", driver_mobile: str = "",
                      vehicle_type: str = "", bags: int = 0,
                      remarks: str = "", operator_name: str = "") -> dict:
    """Step 1: Create gate entry (no weight yet). Returns weighment with QR-scannable ID."""
    conn = _get_conn()
    wid = str(uuid.uuid4())
    ticket_no = _next_ticket_no()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Determine shift (First: 6AM-2PM, Second: 2PM-10PM, Third: 10PM-6AM)
    hour = datetime.now().hour
    if 6 <= hour < 14:
        shift = "First Shift"
    elif 14 <= hour < 22:
        shift = "Second Shift"
    else:
        shift = "Third Shift"

    conn.execute("""
        INSERT INTO weighments
            (id, ticket_no, direction, vehicle_no, supplier_name, material,
             po_number, transporter, driver_mobile, vehicle_type, shift,
             operator_name, status, bags, remarks, gate_entry_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GATE_ENTRY', ?, ?, ?)
    """, (wid, ticket_no, direction.upper(), vehicle_no.upper().strip(),
          supplier_name, material, po_number, transporter, driver_mobile,
          vehicle_type, shift, operator_name, bags, remarks, now))
    conn.commit()

    log.info("Gate entry created: ticket=%d vehicle=%s", ticket_no, vehicle_no)
    return get_weighment(wid)


def capture_gross(weighment_id: str, weight: float,
                  weight_source: str = "SERIAL") -> dict:
    """Step 2: Capture gross weight (truck + load)."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM weighments WHERE id = ?", (weighment_id,)).fetchone()
    if not row:
        raise ValueError(f"Weighment {weighment_id} not found")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn.execute("""
        UPDATE weighments SET
            weight_first = ?, weight_gross = ?, weight_source = ?,
            status = 'GROSS_DONE', first_weight_at = ?
        WHERE id = ?
    """, (weight, weight, weight_source, now, weighment_id))
    conn.commit()

    log.info("Gross captured: ticket=%d gross=%.0f kg", row["ticket_no"], weight)
    return get_weighment(weighment_id)


def capture_tare(weighment_id: str, weight: float,
                 weight_source: str = "SERIAL") -> dict:
    """Step 3: Capture tare weight (empty truck). Calculate net. Enqueue for sync."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM weighments WHERE id = ?", (weighment_id,)).fetchone()
    if not row:
        raise ValueError(f"Weighment {weighment_id} not found")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    gross = row["weight_gross"]
    tare = weight
    net = gross - tare

    if net < 0:
        raise ValueError(f"Tare ({tare:.0f}) cannot be greater than gross ({gross:.0f})")

    conn.execute("""
        UPDATE weighments SET
            weight_second = ?, weight_tare = ?, weight_net = ?,
            status = 'COMPLETE', second_weight_at = ?
        WHERE id = ?
    """, (weight, tare, net, now, weighment_id))

    # Enqueue for cloud sync
    w = get_weighment(weighment_id)
    payload = json.dumps(dict(w))
    conn.execute("""
        INSERT INTO sync_queue (weighment_id, payload) VALUES (?, ?)
    """, (weighment_id, payload))

    conn.commit()
    log.info("Tare captured: ticket=%d tare=%.0f net=%.0f kg", row["ticket_no"], tare, net)
    return get_weighment(weighment_id)


# Backward compat aliases
def create_weighment(vehicle_no, direction, supplier_name="", material="",
                     weight=0.0, weight_source="SERIAL", bags=0, remarks=""):
    """Legacy: create gate entry + capture gross in one step."""
    w = create_gate_entry(vehicle_no, direction, supplier_name, material, bags=bags, remarks=remarks)
    if weight > 0:
        w = capture_gross(w["id"], weight, weight_source)
    return w


def complete_weighment(weighment_id, weight, weight_source="SERIAL"):
    """Legacy: capture tare weight."""
    return capture_tare(weighment_id, weight, weight_source)


def get_weighment(weighment_id: str) -> dict | None:
    """Get a single weighment by ID."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM weighments WHERE id = ?", (weighment_id,)).fetchone()
    return dict(row) if row else None


def get_weighment_by_ticket(ticket_no: int) -> dict | None:
    """Get a weighment by ticket number."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM weighments WHERE ticket_no = ?", (ticket_no,)).fetchone()
    return dict(row) if row else None


def get_pending_weighments() -> list[dict]:
    """Get weighments waiting for gross or tare weight."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT * FROM weighments WHERE status IN ('GATE_ENTRY', 'GROSS_DONE')
        ORDER BY created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_gate_entries() -> list[dict]:
    """Get gate entries waiting for gross weight."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT * FROM weighments WHERE status = 'GATE_ENTRY'
        ORDER BY created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_gross_done() -> list[dict]:
    """Get weighments with gross done, waiting for tare."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT * FROM weighments WHERE status = 'GROSS_DONE'
        ORDER BY created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_todays_weighments() -> list[dict]:
    """Get all weighments from today (local time)."""
    conn = _get_conn()
    today = datetime.now().strftime("%Y-%m-%d")
    rows = conn.execute("""
        SELECT * FROM weighments
        WHERE date(created_at) = ?
        ORDER BY created_at DESC
    """, (today,)).fetchall()
    return [dict(r) for r in rows]


def get_weighments_by_date(date_str: str) -> list[dict]:
    """Get weighments for a specific date (YYYY-MM-DD)."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT * FROM weighments
        WHERE date(created_at) = ?
        ORDER BY created_at DESC
    """, (date_str,)).fetchall()
    return [dict(r) for r in rows]


def search_weighments(vehicle_no: str = "", from_date: str = "",
                      to_date: str = "", limit: int = 100) -> list[dict]:
    """Search weighments with filters."""
    conn = _get_conn()
    conditions = []
    params = []

    if vehicle_no:
        conditions.append("vehicle_no LIKE ?")
        params.append(f"%{vehicle_no.upper()}%")
    if from_date:
        conditions.append("date(created_at) >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("date(created_at) <= ?")
        params.append(to_date)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    params.append(limit)

    rows = conn.execute(f"""
        SELECT * FROM weighments {where}
        ORDER BY created_at DESC LIMIT ?
    """, params).fetchall()
    return [dict(r) for r in rows]


def delete_weighment(weighment_id: str) -> bool:
    """Delete a weighment (admin only)."""
    conn = _get_conn()
    conn.execute("DELETE FROM weighments WHERE id = ?", (weighment_id,))
    conn.execute("DELETE FROM sync_queue WHERE weighment_id = ?", (weighment_id,))
    conn.commit()
    return True


# =========================================================================
#  SYNC QUEUE
# =========================================================================

def get_pending_sync() -> list[dict]:
    """Get queued weighments to push to cloud."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT * FROM sync_queue
        WHERE status = 'pending' AND attempts < 10
        ORDER BY created_at ASC LIMIT 50
    """).fetchall()
    return [dict(r) for r in rows]


def mark_synced(queue_id: int, cloud_id: str = ""):
    """Mark a sync queue entry as sent."""
    conn = _get_conn()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("""
        UPDATE sync_queue SET status = 'sent', last_attempt = ? WHERE id = ?
    """, (now, queue_id))

    # Also update the weighment record
    row = conn.execute("SELECT weighment_id FROM sync_queue WHERE id = ?", (queue_id,)).fetchone()
    if row:
        conn.execute("""
            UPDATE weighments SET synced = 1, synced_at = ?, cloud_id = ?
            WHERE id = ?
        """, (now, cloud_id, row["weighment_id"]))
    conn.commit()


def mark_sync_failed(queue_id: int):
    """Increment attempt count on failed sync."""
    conn = _get_conn()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("""
        UPDATE sync_queue SET attempts = attempts + 1, last_attempt = ? WHERE id = ?
    """, (now, queue_id))
    conn.commit()


def get_sync_stats() -> dict:
    """Get sync queue statistics."""
    conn = _get_conn()
    pending = conn.execute("SELECT COUNT(*) FROM sync_queue WHERE status='pending'").fetchone()[0]
    sent = conn.execute("SELECT COUNT(*) FROM sync_queue WHERE status='sent'").fetchone()[0]
    failed = conn.execute("SELECT COUNT(*) FROM sync_queue WHERE status='pending' AND attempts >= 10").fetchone()[0]
    return {"pending": pending, "sent": sent, "failed": failed}


# =========================================================================
#  MASTER DATA (synced from cloud)
# =========================================================================

def upsert_suppliers(suppliers: list[dict]):
    """Bulk upsert suppliers from cloud."""
    conn = _get_conn()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for s in suppliers:
        conn.execute("""
            INSERT INTO suppliers (id, name, synced_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, synced_at = excluded.synced_at
        """, (s["id"], s["name"], now))
    conn.commit()
    log.info("Upserted %d suppliers from cloud", len(suppliers))


def upsert_materials(materials: list[dict]):
    """Bulk upsert materials from cloud."""
    conn = _get_conn()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for m in materials:
        conn.execute("""
            INSERT INTO materials (id, name, category, synced_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category,
                                          synced_at = excluded.synced_at
        """, (m["id"], m["name"], m.get("category", ""), now))
    conn.commit()
    log.info("Upserted %d materials from cloud", len(materials))


def get_suppliers() -> list[dict]:
    """Get all suppliers (for dropdown)."""
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM suppliers ORDER BY name").fetchall()
    return [dict(r) for r in rows]


def get_materials() -> list[dict]:
    """Get all materials (for dropdown)."""
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM materials ORDER BY name").fetchall()
    return [dict(r) for r in rows]


# =========================================================================
#  DAILY SUMMARY
# =========================================================================

def get_daily_summary(date_str: str = "") -> dict:
    """Get summary stats for a date."""
    conn = _get_conn()
    if not date_str:
        date_str = datetime.now().strftime("%Y-%m-%d")

    row = conn.execute("""
        SELECT
            COUNT(*) as total_trucks,
            COUNT(CASE WHEN status = 'COMPLETE' THEN 1 END) as completed,
            COUNT(CASE WHEN status = 'FIRST_WEIGHT' THEN 1 END) as pending,
            COALESCE(SUM(CASE WHEN status = 'COMPLETE' THEN weight_net ELSE 0 END), 0) as total_net_kg,
            COALESCE(SUM(CASE WHEN status = 'COMPLETE' AND direction = 'IN' THEN weight_net ELSE 0 END), 0) as inbound_kg,
            COALESCE(SUM(CASE WHEN status = 'COMPLETE' AND direction = 'OUT' THEN weight_net ELSE 0 END), 0) as outbound_kg,
            COALESCE(SUM(bags), 0) as total_bags
        FROM weighments
        WHERE date(created_at) = ?
    """, (date_str,)).fetchone()
    return dict(row)


# =========================================================================
#  CLEANUP
# =========================================================================

def cleanup_old_sync_queue():
    """Remove sent sync entries older than 7 days."""
    conn = _get_conn()
    conn.execute("""
        DELETE FROM sync_queue
        WHERE status = 'sent'
        AND created_at < datetime('now', 'localtime', '-7 days')
    """)
    conn.commit()
