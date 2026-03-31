"""
MSPIL Weighbridge — Local Web UI (Flask)
Serves on localhost:8098 for plant operators.
Big weight display, simple forms, receipt printing.
"""

import logging
import threading
from datetime import datetime

from flask import Flask, render_template, request, jsonify, redirect, url_for

from config import WEB_HOST, WEB_PORT, WEB_DEBUG
import local_db as db

log = logging.getLogger("web_ui")

app = Flask(__name__,
            template_folder="templates",
            static_folder="static")

# Global reference to weight reader (set by run.py)
_weight_reader = None


def set_weight_reader(reader):
    """Called by run.py to inject the weight reader instance."""
    global _weight_reader
    _weight_reader = reader


# =========================================================================
#  API ENDPOINTS (JSON)
# =========================================================================

@app.route('/api/weight')
def api_get_weight():
    """Get current live weight from scale. Polled by AJAX every 500ms."""
    if _weight_reader:
        weight, stable, connected = _weight_reader.get_weight()
        return jsonify({
            "weight": round(weight, 0),
            "stable": stable,
            "connected": connected,
        })
    return jsonify({"weight": 0, "stable": False, "connected": False})


@app.route('/api/weighments/today')
def api_todays_weighments():
    """Get all weighments for today."""
    return jsonify(db.get_todays_weighments())


@app.route('/api/weighments/pending')
def api_pending_weighments():
    """Get weighments waiting for second weight."""
    return jsonify(db.get_pending_weighments())


@app.route('/api/weighments/summary')
def api_summary():
    """Get daily summary stats."""
    date = request.args.get('date', '')
    return jsonify(db.get_daily_summary(date))


@app.route('/api/weighments/search')
def api_search():
    """Search weighments."""
    return jsonify(db.search_weighments(
        vehicle_no=request.args.get('vehicle', ''),
        from_date=request.args.get('from', ''),
        to_date=request.args.get('to', ''),
        limit=int(request.args.get('limit', '100')),
    ))


@app.route('/api/sync-stats')
def api_sync_stats():
    """Get sync queue statistics."""
    return jsonify(db.get_sync_stats())


@app.route('/api/suppliers')
def api_suppliers():
    """Get supplier list for dropdown."""
    return jsonify(db.get_suppliers())


@app.route('/api/materials')
def api_materials():
    """Get material list for dropdown."""
    return jsonify(db.get_materials())


@app.route('/api/pos')
def api_pos():
    """Get active POs, optionally filtered by vendor."""
    vendor = request.args.get('vendor', '')
    return jsonify(db.get_pos(vendor))


@app.route('/api/pos/<po_id>')
def api_po_detail(po_id):
    """Get a single PO with lines."""
    po = db.get_po_by_id(po_id)
    if not po:
        return jsonify({"error": "PO not found"}), 404
    return jsonify(po)


@app.route('/api/customers')
def api_customers():
    """Get customer list for outbound dropdown."""
    return jsonify(db.get_customers())


@app.route('/api/vehicles')
def api_vehicles():
    """Get vehicle suggestions for auto-complete."""
    prefix = request.args.get('q', '')
    return jsonify(db.get_vehicle_suggestions(prefix))


# =========================================================================
#  ACTION ENDPOINTS (POST)
# =========================================================================

# --- Step 1: Gate Entry (no weight) ---
@app.route('/api/gate-entry', methods=['POST'])
def api_gate_entry():
    """Create gate entry — prints slip with QR code. No weight captured yet."""
    data = request.json or {}
    vehicle_no = data.get('vehicle_no', '').strip()
    if not vehicle_no:
        return jsonify({"error": "Vehicle number is required"}), 400

    try:
        result = db.create_gate_entry(
            vehicle_no=vehicle_no,
            direction=data.get('direction', 'IN'),
            supplier_name=data.get('supplier_name', ''),
            material=data.get('material', ''),
            po_number=data.get('po_number', ''),
            transporter=data.get('transporter', ''),
            driver_mobile=data.get('driver_mobile', ''),
            vehicle_type=data.get('vehicle_type', ''),
            bags=int(data.get('bags', 0)),
            remarks=data.get('remarks', ''),
            operator_name=data.get('operator_name', ''),
            purchase_type=data.get('purchase_type', 'PO'),
            po_id=data.get('po_id', ''),
            po_line_id=data.get('po_line_id', ''),
            seller_phone=data.get('seller_phone', ''),
            seller_village=data.get('seller_village', ''),
            seller_aadhaar=data.get('seller_aadhaar', ''),
            rate=float(data.get('rate', 0)),
            deductions=float(data.get('deductions', 0)),
            deduction_reason=data.get('deduction_reason', ''),
            payment_mode=data.get('payment_mode', 'CASH'),
            payment_ref=data.get('payment_ref', ''),
        )
        return jsonify(result), 201
    except Exception as e:
        log.error("Failed to create gate entry: %s", e)
        return jsonify({"error": str(e)}), 500


# --- Step 2: Capture Gross Weight ---
@app.route('/api/weighments/<weighment_id>/gross', methods=['POST'])
def api_capture_gross(weighment_id):
    """Capture gross weight (truck + load). Scan QR to get weighment_id."""
    data = request.json or {}

    weight = data.get('weight')
    weight_source = 'MANUAL'

    if weight is None and _weight_reader:
        w, stable, connected = _weight_reader.get_weight()
        if connected:
            weight = w
            weight_source = 'SERIAL'

    if weight is None:
        return jsonify({"error": "No weight available. Enter manually or check scale connection."}), 400

    try:
        result = db.capture_gross(weighment_id, weight, weight_source)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        log.error("Failed to capture gross: %s", e)
        return jsonify({"error": str(e)}), 500


# --- Step 3: Capture Tare Weight ---
@app.route('/api/weighments/<weighment_id>/tare', methods=['POST'])
def api_capture_tare(weighment_id):
    """Capture tare weight (empty truck). Calculate product weight."""
    data = request.json or {}

    weight = data.get('weight')
    weight_source = 'MANUAL'

    if weight is None and _weight_reader:
        w, stable, connected = _weight_reader.get_weight()
        if connected:
            weight = w
            weight_source = 'SERIAL'

    if weight is None:
        return jsonify({"error": "No weight available. Enter manually or check scale connection."}), 400

    try:
        result = db.capture_tare(weighment_id, weight, weight_source)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        log.error("Failed to capture tare: %s", e)
        return jsonify({"error": str(e)}), 500


# --- Lookup by ticket or ID (for QR scan) ---
@app.route('/api/weighments/lookup/<identifier>')
def api_lookup(identifier):
    """Lookup weighment by ID or ticket number (from QR scan)."""
    # Try as ticket number first (shorter, more likely from QR)
    try:
        ticket_no = int(identifier)
        w = db.get_weighment_by_ticket(ticket_no)
        if w:
            return jsonify(w)
    except ValueError:
        pass

    # Try as UUID
    w = db.get_weighment(identifier)
    if w:
        return jsonify(w)

    return jsonify({"error": "Not found"}), 404


# --- Legacy endpoints (backward compat) ---
@app.route('/api/weighments/first', methods=['POST'])
def api_first_weight():
    """Legacy: create gate entry + capture gross in one step."""
    data = request.json or {}
    vehicle_no = data.get('vehicle_no', '').strip()
    if not vehicle_no:
        return jsonify({"error": "Vehicle number is required"}), 400

    weight = data.get('weight')
    weight_source = 'MANUAL'
    if weight is None and _weight_reader:
        w, stable, connected = _weight_reader.get_weight()
        if connected and w > 0:
            weight = w
            weight_source = 'SERIAL'
    if weight is None or weight <= 0:
        return jsonify({"error": "No weight available."}), 400

    try:
        result = db.create_weighment(
            vehicle_no=vehicle_no, direction=data.get('direction', 'IN'),
            supplier_name=data.get('supplier_name', ''),
            material=data.get('material', ''),
            weight=weight, weight_source=weight_source,
            bags=int(data.get('bags', 0)), remarks=data.get('remarks', ''),
        )
        return jsonify(result), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/weighments/<weighment_id>/second', methods=['POST'])
def api_second_weight(weighment_id):
    """Legacy: capture tare weight."""
    data = request.json or {}
    weight = data.get('weight')
    weight_source = 'MANUAL'
    if weight is None and _weight_reader:
        w, stable, connected = _weight_reader.get_weight()
        if connected and w > 0:
            weight = w
            weight_source = 'SERIAL'
    if weight is None or weight <= 0:
        return jsonify({"error": "No weight available."}), 400

    try:
        result = db.complete_weighment(weighment_id, weight, weight_source)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- Additional API endpoints ---
@app.route('/api/weighments/gate-entries')
def api_gate_entries():
    """Get gate entries waiting for gross weight."""
    return jsonify(db.get_gate_entries())


@app.route('/api/weighments/gross-done')
def api_gross_done():
    """Get weighments with gross done, waiting for tare."""
    return jsonify(db.get_gross_done())


@app.route('/api/weighments/<weighment_id>', methods=['DELETE'])
def api_delete_weighment(weighment_id):
    """Delete a weighment."""
    db.delete_weighment(weighment_id)
    return jsonify({"ok": True})


# =========================================================================
#  PAGE ROUTES
# =========================================================================

@app.route('/')
def index():
    """Main weighbridge screen."""
    return render_template('index.html')


@app.route('/history')
def history():
    """History / search page."""
    return render_template('history.html')


@app.route('/slip/<weighment_id>')
def slip(weighment_id):
    """Print-friendly weighment slip (final with all weights)."""
    w = db.get_weighment(weighment_id)
    if not w:
        return "Weighment not found", 404
    return render_template('slip.html', w=w)


@app.route('/gate-pass/<weighment_id>')
def gate_pass(weighment_id):
    """Print gate entry pass with QR code."""
    w = db.get_weighment(weighment_id)
    if not w:
        return "Weighment not found", 404
    return render_template('gate_pass.html', w=w)


@app.route('/gross-slip/<weighment_id>')
def gross_slip(weighment_id):
    """Print gross weight slip."""
    w = db.get_weighment(weighment_id)
    if not w:
        return "Weighment not found", 404
    return render_template('gross_slip.html', w=w)


# =========================================================================
#  START SERVER
# =========================================================================

def start_web(shutdown_event: threading.Event = None):
    """Start Flask in a thread-safe way."""
    log.info("Starting web UI on %s:%d", WEB_HOST, WEB_PORT)

    # Initialize database
    db.init_db()

    # Use werkzeug server (not Flask's dev server)
    from werkzeug.serving import make_server
    server = make_server(WEB_HOST, WEB_PORT, app, threaded=True)

    if shutdown_event:
        # Run in a way that can be stopped
        server_thread = threading.Thread(target=server.serve_forever)
        server_thread.daemon = True
        server_thread.start()
        log.info("Web UI ready at http://localhost:%d", WEB_PORT)
        shutdown_event.wait()
        server.shutdown()
    else:
        log.info("Web UI ready at http://localhost:%d", WEB_PORT)
        server.serve_forever()
