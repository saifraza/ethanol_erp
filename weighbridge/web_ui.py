"""
MSPIL Weighbridge — Local Web UI (Flask)
Serves on localhost:8098 for plant operators.
Big weight display, simple forms, receipt printing.
Auth via factory server JWT — role-based tab visibility.
"""

import logging
import threading
import json
import os
from datetime import datetime
from functools import wraps

import requests
from flask import Flask, render_template, request, jsonify, redirect, url_for, make_response

from config import WEB_HOST, WEB_PORT, WEB_DEBUG
import local_db as db

log = logging.getLogger("web_ui")

# Factory server URL for auth (LAN)
FACTORY_SERVER_URL = os.environ.get("FACTORY_SERVER_URL", "http://192.168.0.10:5000")

app = Flask(__name__,
            template_folder="templates",
            static_folder="static")
app.secret_key = "mspil-wb-session-2026"

# Global references (set by run.py)
_weight_reader = None
_cloud_sync = None


def set_weight_reader(reader):
    """Called by run.py to inject the weight reader instance."""
    global _weight_reader
    _weight_reader = reader


def set_cloud_sync(sync):
    """Called by run.py to inject the cloud sync instance."""
    global _cloud_sync
    _cloud_sync = sync


def get_current_user():
    """Get current user from JWT cookie. Returns dict or None."""
    token = request.cookies.get("factory_token")
    if not token:
        return None
    try:
        resp = requests.get(
            f"{FACTORY_SERVER_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=3,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass
    # If factory server unreachable, decode JWT locally (offline mode)
    try:
        import jwt
        payload = jwt.decode(token, options={"verify_signature": False})
        return {"username": payload.get("username", ""), "name": payload.get("name", ""), "role": payload.get("role", "ADMIN")}
    except Exception:
        pass
    return None


def has_role(user, *roles):
    """Check if user has any of the specified roles. ADMIN has all roles."""
    if not user:
        return False
    user_role = user.get("role", "")
    if user_role == "ADMIN":
        return True
    user_roles = [r.strip() for r in user_role.split(",")]
    return any(r in user_roles for r in roles)


# =========================================================================
#  AUTH ROUTES
# =========================================================================

@app.route('/login', methods=['GET'])
def login_page():
    """Login page."""
    return render_template('login.html')


@app.route('/api/login', methods=['POST'])
def api_login():
    """Login via factory server."""
    data = request.json or {}
    username = data.get("username", "")
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    try:
        resp = requests.post(
            f"{FACTORY_SERVER_URL}/api/auth/login",
            json={"username": username, "password": password},
            timeout=5,
        )
        if resp.status_code == 200:
            result = resp.json()
            response = make_response(jsonify(result))
            response.set_cookie("factory_token", result["token"], max_age=30 * 24 * 3600, httponly=False, samesite="Lax")
            return response
        else:
            return jsonify({"error": "Invalid credentials"}), 401
    except requests.ConnectionError:
        return jsonify({"error": "Factory server unreachable. Check network."}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/logout', methods=['POST'])
def api_logout():
    """Clear session."""
    response = make_response(jsonify({"ok": True}))
    response.delete_cookie("factory_token")
    return response


@app.route('/api/me')
def api_me():
    """Get current user info."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401
    return jsonify(user)


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
    """Get sync queue statistics + cloud reachability."""
    stats = db.get_sync_stats()
    # Add cloud reachability from sync instance
    stats["cloud_reachable"] = _cloud_sync.is_cloud_reachable if _cloud_sync else False
    return jsonify(stats)


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
    stable = True  # Manual weights are considered stable

    if weight is None and _weight_reader:
        w, stable, connected = _weight_reader.get_weight()
        if connected:
            weight = w
            weight_source = 'SERIAL'

    if weight is None:
        return jsonify({"error": "No weight available. Enter manually or check scale connection."}), 400

    try:
        result = db.capture_gross(weighment_id, weight, weight_source)
        # Include stability warning in response (UI can show caution)
        result["weight_stable"] = stable
        if not stable:
            result["stability_warning"] = "Weight was captured while scale reading was unstable"
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
    stable = True

    if weight is None and _weight_reader:
        w, stable, connected = _weight_reader.get_weight()
        if connected:
            weight = w
            weight_source = 'SERIAL'

    if weight is None:
        return jsonify({"error": "No weight available. Enter manually or check scale connection."}), 400

    try:
        result = db.capture_tare(weighment_id, weight, weight_source)
        result["weight_stable"] = stable
        if not stable:
            result["stability_warning"] = "Weight was captured while scale reading was unstable"
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


@app.route('/api/weighments/pending-lab')
def api_pending_lab():
    """Get weighments waiting for lab results."""
    return jsonify(db.get_pending_lab())


@app.route('/api/weighments/<weighment_id>/lab-result', methods=['POST'])
def api_lab_result(weighment_id):
    """Record lab quality result for a weighment."""
    data = request.json or {}
    status = data.get('status', '').upper()
    if status not in ('PASS', 'FAIL'):
        return jsonify({"error": "status must be PASS or FAIL"}), 400

    try:
        result = db.update_lab_result(
            weighment_id=weighment_id,
            status=status,
            moisture=data.get('moisture'),
            starch=data.get('starch'),
            damaged=data.get('damaged'),
            foreign_matter=data.get('foreign_matter'),
            remarks=data.get('remarks', ''),
            tested_by=data.get('tested_by', ''),
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        log.error("Failed to update lab result: %s", e)
        return jsonify({"error": str(e)}), 500


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
    user = get_current_user()
    if not user:
        return redirect('/login')
    return render_template('index.html',
        user=user,
        show_gate_entry=has_role(user, 'GATE_ENTRY', 'ADMIN'),
        show_weighing=has_role(user, 'WEIGHBRIDGE', 'ADMIN'),
        show_all=user.get('role') == 'ADMIN',
    )


@app.route('/history')
def history():
    """History / search page."""
    user = get_current_user()
    if not user:
        return redirect('/login')
    return render_template('history.html', user=user)


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
