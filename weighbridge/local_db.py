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

            -- ERP integration
            purchase_type TEXT DEFAULT 'PO',  -- PO, SPOT, OUTBOUND
            po_id TEXT,
            po_line_id TEXT,

            -- Spot purchase fields
            seller_phone TEXT,
            seller_village TEXT,
            seller_aadhaar TEXT,
            rate REAL,
            deductions REAL DEFAULT 0,
            deduction_reason TEXT,
            payment_mode TEXT DEFAULT 'CASH',
            payment_ref TEXT,

            -- Weights (always in KG)
            weight_first REAL,
            weight_second REAL,
            weight_gross REAL,
            weight_tare REAL,
            weight_net REAL,
            weight_source TEXT DEFAULT 'SERIAL',

            -- Status: GATE_ENTRY → FIRST_DONE → COMPLETE
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

        -- PO cache (pulled from cloud ERP)
        CREATE TABLE IF NOT EXISTS po_cache (
            id TEXT PRIMARY KEY,
            po_no INTEGER,
            vendor_id TEXT,
            vendor_name TEXT,
            status TEXT,
            lines_json TEXT,  -- JSON array of PO lines
            synced_at TEXT
        );

        -- Customer cache (for outbound)
        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            short_name TEXT,
            synced_at TEXT
        );

        -- Vehicle history (for auto-complete)
        CREATE TABLE IF NOT EXISTS vehicle_history (
            vehicle_no TEXT PRIMARY KEY,
            last_seen TEXT
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
                      remarks: str = "", operator_name: str = "",
                      purchase_type: str = "PO", po_id: str = "",
                      po_line_id: str = "",
                      seller_phone: str = "", seller_village: str = "",
                      seller_aadhaar: str = "", rate: float = 0.0,
                      deductions: float = 0.0, deduction_reason: str = "",
                      payment_mode: str = "CASH", payment_ref: str = "") -> dict:
    """Step 1: Create gate entry (no weight yet). Returns weighment with QR-scannable ID."""
    conn = _get_conn()
    wid = str(uuid.uuid4())
    ticket_no = _next_ticket_no()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Determine shift
    hour = datetime.now().hour
    if 6 <= hour < 14:
        shift = "First Shift"
    elif 14 <= hour < 22:
        shift = "Second Shift"
    else:
        shift = "Third Shift"

    # Track vehicle for auto-complete
    conn.execute("""
        INSERT OR REPLACE INTO vehicle_history (vehicle_no, last_seen) VALUES (?, ?)
    """, (vehicle_no.upper().strip(), now))

    conn.execute("""
        INSERT INTO weighments
            (id, ticket_no, direction, vehicle_no, supplier_name, material,
             po_number, transporter, driver_mobile, vehicle_type, shift,
             operator_name, purchase_type, po_id, po_line_id,
             seller_phone, seller_village, seller_aadhaar,
             rate, deductions, deduction_reason, payment_mode, payment_ref,
             status, bags, remarks, gate_entry_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GATE_ENTRY', ?, ?, ?)
    """, (wid, ticket_no, direction.upper(), vehicle_no.upper().strip(),
          supplier_name, material, po_number, transporter, driver_mobile,
          vehicle_type, shift, operator_name, purchase_type, po_id, po_line_id,
          seller_phone, seller_village, seller_aadhaar,
          rate, deductions, deduction_reason, payment_mode, payment_ref,
          bags, remarks, now))
    conn.commit()

    log.info("Gate entry created: ticket=%d vehicle=%s type=%s", ticket_no, vehicle_no, purchase_type)
    return get_weighment(wid)


def capture_first_weight(weighment_id: str, weight: float,
                         weight_source: str = "SERIAL") -> dict:
    """Step 2: Capture first weight.
    INBOUND: first weight = gross (heavy truck with load)
    OUTBOUND: first weight = tare (empty truck before loading)
    """
    conn = _get_conn()
    row = conn.execute("SELECT * FROM weighments WHERE id = ?", (weighment_id,)).fetchone()
    if not row:
        raise ValueError(f"Weighment {weighment_id} not found")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    direction = row["direction"]

    if direction == "IN":
        # Inbound: first weight is gross (loaded truck)
        conn.execute("""
            UPDATE weighments SET
                weight_first = ?, weight_gross = ?, weight_source = ?,
                status = 'FIRST_DONE', first_weight_at = ?
            WHERE id = ?
        """, (weight, weight, weight_source, now, weighment_id))
        log.info("First weight (GROSS) captured: ticket=%d weight=%.0f kg", row["ticket_no"], weight)
    else:
        # Outbound: first weight is tare (empty truck)
        conn.execute("""
            UPDATE weighments SET
                weight_first = ?, weight_tare = ?, weight_source = ?,
                status = 'FIRST_DONE', first_weight_at = ?
            WHERE id = ?
        """, (weight, weight, weight_source, now, weighment_id))
        log.info("First weight (TARE) captured: ticket=%d weight=%.0f kg", row["ticket_no"], weight)

    conn.commit()
    return get_weighment(weighment_id)


def capture_second_weight(weighment_id: str, weight: float,
                          weight_source: str = "SERIAL") -> dict:
    """Step 3: Capture second weight. Calculate net. Enqueue for sync.
    INBOUND: second weight = tare (empty truck after unloading)
    OUTBOUND: second weight = gross (loaded truck after loading)
    """
    conn = _get_conn()
    row = conn.execute("SELECT * FROM weighments WHERE id = ?", (weighment_id,)).fetchone()
    if not row:
        raise ValueError(f"Weighment {weighment_id} not found")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    direction = row["direction"]
    first = row["weight_first"]

    if direction == "IN":
        # Inbound: second weight is tare, first was gross
        gross = first
        tare = weight
    else:
        # Outbound: second weight is gross, first was tare
        gross = weight
        tare = first

    net = gross - tare

    if net < 0:
        raise ValueError(f"Net weight cannot be negative (Gross: {gross:.0f}, Tare: {tare:.0f})")

    conn.execute("""
        UPDATE weighments SET
            weight_second = ?, weight_gross = ?, weight_tare = ?, weight_net = ?,
            status = 'COMPLETE', second_weight_at = ?
        WHERE id = ?
    """, (weight, gross, tare, net, now, weighment_id))

    # Enqueue for cloud sync
    w = get_weighment(weighment_id)
    payload = json.dumps(dict(w))
    conn.execute("""
        INSERT INTO sync_queue (weighment_id, payload) VALUES (?, ?)
    """, (weighment_id, payload))

    conn.commit()
    log.info("Tare captured: ticket=%d tare=%.0f net=%.0f kg", row["ticket_no"], tare, net)
    return get_weighment(weighment_id)


# Aliases for backward compat and clearer naming
capture_gross = capture_first_weight
capture_tare = capture_second_weight


def create_weighment(vehicle_no, direction, supplier_name="", material="",
                     weight=0.0, weight_source="SERIAL", bags=0, remarks=""):
    """Legacy: create gate entry + capture first weight in one step."""
    w = create_gate_entry(vehicle_no, direction, supplier_name, material, bags=bags, remarks=remarks)
    if weight > 0:
        w = capture_first_weight(w["id"], weight, weight_source)
    return w


def complete_weighment(weighment_id, weight, weight_source="SERIAL"):
    """Legacy: capture second weight."""
    return capture_second_weight(weighment_id, weight, weight_source)


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
    """Get weighments waiting for first or second weight."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT * FROM weighments WHERE status IN ('GATE_ENTRY', 'FIRST_DONE')
        ORDER BY created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_gate_entries() -> list[dict]:
    """Get gate entries waiting for first weight."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT * FROM weighments WHERE status = 'GATE_ENTRY'
        ORDER BY created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_first_done() -> list[dict]:
    """Get weighments with first weight done, waiting for second."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT * FROM weighments WHERE status = 'FIRST_DONE'
        ORDER BY created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


# Alias
get_gross_done = get_first_done


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
#  PO CACHE (synced from cloud)
# =========================================================================

def upsert_pos(pos: list[dict]):
    """Bulk upsert POs from cloud."""
    conn = _get_conn()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for po in pos:
        conn.execute("""
            INSERT INTO po_cache (id, po_no, vendor_id, vendor_name, status, lines_json, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                vendor_name = excluded.vendor_name, status = excluded.status,
                lines_json = excluded.lines_json, synced_at = excluded.synced_at
        """, (po["id"], po.get("po_no", 0), po.get("vendor_id", ""),
              po.get("vendor_name", ""), po.get("status", ""),
              json.dumps(po.get("lines", [])), now))
    conn.commit()
    log.info("Upserted %d POs from cloud", len(pos))


def get_pos(vendor_name: str = "") -> list[dict]:
    """Get cached POs, optionally filtered by vendor."""
    conn = _get_conn()
    if vendor_name:
        rows = conn.execute("""
            SELECT * FROM po_cache
            WHERE vendor_name LIKE ? AND status IN ('APPROVED', 'SENT', 'PARTIAL_RECEIVED')
            ORDER BY po_no DESC
        """, (f"%{vendor_name}%",)).fetchall()
    else:
        rows = conn.execute("""
            SELECT * FROM po_cache
            WHERE status IN ('APPROVED', 'SENT', 'PARTIAL_RECEIVED')
            ORDER BY po_no DESC
        """).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["lines"] = json.loads(d.get("lines_json", "[]"))
        del d["lines_json"]
        result.append(d)
    return result


def get_po_by_id(po_id: str) -> dict | None:
    """Get a single cached PO by ID."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM po_cache WHERE id = ?", (po_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["lines"] = json.loads(d.get("lines_json", "[]"))
    del d["lines_json"]
    return d


# =========================================================================
#  CUSTOMERS (synced from cloud, for outbound)
# =========================================================================

def upsert_customers(customers: list[dict]):
    """Bulk upsert customers from cloud."""
    conn = _get_conn()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for c in customers:
        conn.execute("""
            INSERT INTO customers (id, name, short_name, synced_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name,
                                          synced_at = excluded.synced_at
        """, (c["id"], c["name"], c.get("short_name", ""), now))
    conn.commit()
    log.info("Upserted %d customers from cloud", len(customers))


def get_customers() -> list[dict]:
    """Get all customers (for outbound dropdown)."""
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM customers ORDER BY name").fetchall()
    return [dict(r) for r in rows]


# =========================================================================
#  VEHICLE HISTORY (for auto-complete)
# =========================================================================

def upsert_vehicles(vehicles: list[str]):
    """Add vehicle numbers from cloud history."""
    conn = _get_conn()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for v in vehicles:
        conn.execute("""
            INSERT OR IGNORE INTO vehicle_history (vehicle_no, last_seen) VALUES (?, ?)
        """, (v, now))
    conn.commit()


def get_vehicle_suggestions(prefix: str = "") -> list[str]:
    """Get vehicle numbers for auto-complete."""
    conn = _get_conn()
    if prefix:
        rows = conn.execute("""
            SELECT vehicle_no FROM vehicle_history
            WHERE vehicle_no LIKE ?
            ORDER BY last_seen DESC LIMIT 20
        """, (f"%{prefix.upper()}%",)).fetchall()
    else:
        rows = conn.execute("""
            SELECT vehicle_no FROM vehicle_history
            ORDER BY last_seen DESC LIMIT 50
        """).fetchall()
    return [r["vehicle_no"] for r in rows]


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
