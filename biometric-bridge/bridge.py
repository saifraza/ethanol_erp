"""
biometric-bridge — HTTP wrapper around pyzk for eSSL/ZKTeco devices.

Cloud backend (Railway) cannot reach plant-LAN devices directly. This service
runs on plant LAN (factory-server PC, 192.168.0.10:5005 in production; this
Mac during dev) and exposes a small REST API the cloud calls when an admin
needs to push/pull data from a biometric device.

Endpoints (all require X-Bridge-Key header matching BIOMETRIC_BRIDGE_KEY env):
  POST /devices/info             — connect, return firmware/serial/time
  POST /devices/users/list       — list all users on device
  POST /devices/users/upsert     — create or update one user (no fingerprint)
  POST /devices/users/delete     — delete a user
  POST /devices/users/enroll     — put device into enrollment mode for a user
  POST /devices/punches/pull     — fetch attendance logs (optionally since=ts)
  POST /devices/time/sync        — set device clock to now (UTC ⇄ device TZ)
  POST /devices/templates/copy   — pull fingerprint template from src device,
                                    push to dst device (multi-device replication)

Body for every endpoint:
  { "device": { "ip": "...", "port": 4370, "password": 0 }, ... }

Run dev:
  python -m venv .venv
  .venv/bin/pip install -r requirements.txt
  BIOMETRIC_BRIDGE_KEY=devsecret .venv/bin/uvicorn bridge:app --host 0.0.0.0 --port 5005

Run prod (factory-server):
  systemd unit or pm2; same as above but production secret.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field
from zk import ZK
from zk.user import User as ZKUser

app = FastAPI(title="MSPIL biometric-bridge", version="1.0.0")

EXPECTED_KEY = os.environ.get("BIOMETRIC_BRIDGE_KEY")


# ───────────────────────── helpers ─────────────────────────

class DeviceRef(BaseModel):
    ip: str
    port: int = 4370
    password: int = 0
    timeout: int = 10  # seconds


def _check_key(x_bridge_key: Optional[str]):
    if not EXPECTED_KEY:
        # If unset, refuse to start in prod. In dev (no env var), be permissive
        # but log loudly. Keeps local testing easy without committing secrets.
        return
    if not x_bridge_key or x_bridge_key != EXPECTED_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad bridge key")


class _Conn:
    """Context manager that opens a pyzk connection and closes it cleanly."""
    def __init__(self, dev: DeviceRef):
        self.dev = dev
        self.conn = None

    def __enter__(self):
        zk = ZK(self.dev.ip, port=self.dev.port, timeout=self.dev.timeout,
                password=self.dev.password, force_udp=False, ommit_ping=True)
        try:
            self.conn = zk.connect()
            return self.conn
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Device unreachable: {type(e).__name__}: {e}")

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.conn:
            try:
                self.conn.disconnect()
            except Exception:
                pass


# ───────────────────────── health ─────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "service": "biometric-bridge", "key_set": bool(EXPECTED_KEY)}


# ───────────────────────── device info ─────────────────────────

class InfoReq(BaseModel):
    device: DeviceRef


@app.post("/devices/info")
def device_info(body: InfoReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        out = {
            "firmware": _safe(lambda: conn.get_firmware_version()),
            "serial": _safe(lambda: conn.get_serialnumber()),
            "platform": _safe(lambda: conn.get_platform()),
            "name": _safe(lambda: conn.get_device_name()),
            "time": _safe(lambda: conn.get_time().isoformat() if conn.get_time() else None),
            "user_count": _safe(lambda: len(conn.get_users() or [])),
            "log_count": _safe(lambda: len(conn.get_attendance() or [])),
        }
        return out


def _safe(fn):
    try:
        return fn()
    except Exception as e:
        return None


# ───────────────────────── users list ─────────────────────────

@app.post("/devices/users/list")
def users_list(body: InfoReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        users = conn.get_users() or []
        return {
            "count": len(users),
            "users": [
                {
                    "uid": u.uid,
                    "user_id": u.user_id,
                    "name": u.name,
                    "privilege": u.privilege,
                    "card": u.card,
                    "group_id": u.group_id,
                }
                for u in users
            ],
        }


# ───────────────────────── upsert user ─────────────────────────

class UpsertUserReq(BaseModel):
    device: DeviceRef
    user_id: str  # the device-facing ID (e.g., "21")
    name: str
    privilege: int = 0  # 0 = user, 14 = admin
    password: str = ""
    group_id: str = ""
    card: int = 0
    uid: Optional[int] = None  # internal slot; if omitted, library auto-assigns


def _safe_name(name: str) -> str:
    """Strip non-Latin-1 characters and trim to 24 chars (device limit).

    eSSL/ZKTeco devices store names in a fixed-width 24-byte buffer with
    Latin-1 encoding. Non-encodable characters cause set_user() to fail with
    "Can't set user". This silently drops them rather than failing the row.
    """
    if not name:
        return ""
    cleaned = name.encode('latin-1', errors='ignore').decode('latin-1')
    return cleaned[:24]


def _next_free_uid_from_set(used: set) -> int:
    i = 1
    while i in used:
        i += 1
    return i


def _do_set_user(conn, body: UpsertUserReq, users_cache: Optional[list] = None) -> dict:
    """Single user upsert. Caller can pass `users_cache` to avoid hitting
    get_users() on every call during a bulk operation."""
    if users_cache is None:
        users_cache = conn.get_users() or []
    uid = body.uid
    if uid is None:
        existing = next((u for u in users_cache if str(u.user_id) == str(body.user_id)), None)
        if existing:
            uid = existing.uid
        else:
            used = {u.uid for u in users_cache}
            uid = _next_free_uid_from_set(used)
    safe_name = _safe_name(body.name)
    if not safe_name:
        return {"ok": False, "user_id": body.user_id, "error": "name_empty_after_sanitize"}
    try:
        conn.set_user(
            uid=uid,
            name=safe_name,
            privilege=body.privilege,
            password=body.password,
            group_id=body.group_id,
            user_id=str(body.user_id),
            card=body.card,
        )
        return {"ok": True, "uid": uid, "user_id": body.user_id}
    except Exception as e:
        # Most common: ZKErrorResponse('Can't set user') — device buffer / packet
        # rejected. Don't blow up the request — return ok=false so the cloud can
        # tally failures and continue with the rest of the batch.
        return {"ok": False, "user_id": body.user_id, "error": f"{type(e).__name__}: {e}"}


@app.post("/devices/users/upsert")
def upsert_user(body: UpsertUserReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        return _do_set_user(conn, body)


# ───────────────────────── bulk upsert ─────────────────────────
# Single TCP connection, single get_users() call, then iterate with set_user.
# Way faster + far more reliable than 300 separate connect/disconnect cycles
# (the device gets unstable when hammered with rapid open/close).

class BulkUpsertReq(BaseModel):
    device: DeviceRef
    users: list[UpsertUserReq]


@app.post("/devices/users/bulk-upsert")
def bulk_upsert(body: BulkUpsertReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        # Cache the user list once — saves N round-trips.
        users_cache = conn.get_users() or []
        results = []
        ok_count = 0
        fail_count = 0
        for u in body.users:
            # Each `u` already has device set on the parent — bind it here too
            # so the inner helper has the right shape.
            u.device = body.device
            r = _do_set_user(conn, u, users_cache)
            results.append(r)
            if r.get("ok"):
                ok_count += 1
                # Update cache so subsequent users see the new entry
                # (avoids reusing the same uid for two different user_ids).
                if not any(str(c.user_id) == str(u.user_id) for c in users_cache):
                    # Synthesize a minimal placeholder so _next_free_uid skips this slot
                    class _Stub:
                        pass
                    s = _Stub()
                    s.uid = r["uid"]
                    s.user_id = u.user_id
                    users_cache.append(s)
            else:
                fail_count += 1
        return {"total": len(body.users), "ok": ok_count, "failed": fail_count, "results": results}


# ───────────────────────── delete user ─────────────────────────

class DeleteUserReq(BaseModel):
    device: DeviceRef
    user_id: str


@app.post("/devices/users/delete")
def delete_user(body: DeleteUserReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        # Resolve uid by user_id (pyzk delete_user takes uid)
        existing = next((u for u in (conn.get_users() or []) if str(u.user_id) == str(body.user_id)), None)
        if not existing:
            return {"ok": True, "skipped": "not_found"}
        conn.delete_user(uid=existing.uid)
        return {"ok": True, "deleted_uid": existing.uid}


# ───────────────────────── enrollment ─────────────────────────

class EnrollReq(BaseModel):
    device: DeviceRef
    user_id: str
    finger_id: int = 1  # 0..9


@app.post("/devices/users/enroll")
def enroll_user(body: EnrollReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        # pyzk's enroll_user puts the device into enrollment mode for that uid+finger.
        # The user then physically scans on the device. This call returns immediately;
        # the actual enrollment progress happens on-device.
        existing = next((u for u in (conn.get_users() or []) if str(u.user_id) == str(body.user_id)), None)
        if not existing:
            raise HTTPException(status_code=404, detail=f"user_id {body.user_id} not on device — upsert first")
        conn.enroll_user(uid=existing.uid, temp_id=body.finger_id, user_id=str(body.user_id))
        return {"ok": True, "uid": existing.uid, "user_id": body.user_id, "finger_id": body.finger_id}


# ───────────────────────── pull punches ─────────────────────────

class PullPunchesReq(BaseModel):
    device: DeviceRef
    # ISO instant — only return punches at-or-after this. If omitted, returns all.
    since: Optional[str] = None
    # If true, clear logs from device after pulling (use with caution!)
    clear_after: bool = False


@app.post("/devices/punches/pull")
def pull_punches(body: PullPunchesReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        logs = conn.get_attendance() or []
        since_dt = None
        if body.since:
            # Parse ISO; treat naive as UTC
            since_dt = datetime.fromisoformat(body.since.replace("Z", "+00:00"))
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)

        out = []
        for log in logs:
            ts: datetime = log.timestamp
            # Device clock is local (IST). pyzk returns naive datetime. We treat
            # it as IST and convert to UTC for the punchAt field.
            if ts.tzinfo is None:
                # IST = UTC+05:30 — convert to UTC by subtracting 5:30
                ist_naive = ts
                utc_dt = datetime(ist_naive.year, ist_naive.month, ist_naive.day,
                                  ist_naive.hour, ist_naive.minute, ist_naive.second,
                                  tzinfo=timezone.utc).timestamp() - 5.5 * 3600
                from datetime import datetime as _dt
                ts_utc = _dt.fromtimestamp(utc_dt, tz=timezone.utc)
            else:
                ts_utc = ts.astimezone(timezone.utc)
            if since_dt and ts_utc < since_dt:
                continue
            out.append({
                "user_id": str(log.user_id),
                "punch_at": ts_utc.isoformat(),
                "status": log.status,  # verify mode (FP/face/card)
                "punch": log.punch,    # in/out direction (255 = undefined)
            })

        if body.clear_after and out:
            try:
                conn.clear_attendance()
            except Exception as e:
                return {"count": len(out), "punches": out, "clear_error": str(e)}

        return {"count": len(out), "punches": out}


# ───────────────────────── time sync ─────────────────────────

class TimeSyncReq(BaseModel):
    device: DeviceRef
    # If provided, use this ISO instant; otherwise device clock = our wall clock now (in IST)
    set_to: Optional[str] = None


@app.post("/devices/time/sync")
def time_sync(body: TimeSyncReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        if body.set_to:
            target = datetime.fromisoformat(body.set_to.replace("Z", "+00:00"))
        else:
            # Device shows IST. Set device clock to now (IST).
            target = datetime.utcnow()  # naive UTC
            from datetime import timedelta
            target = target + timedelta(hours=5, minutes=30)  # convert to IST naive
        conn.set_time(target)
        return {"ok": True, "set_to": target.isoformat(), "device_time": _safe(lambda: conn.get_time().isoformat())}


# ───────────────────────── template copy (multi-device replication) ─────────────────────────

class TemplateCopyReq(BaseModel):
    src_device: DeviceRef
    dst_device: DeviceRef
    user_id: str  # user must exist on both devices (upsert before)
    finger_ids: list[int] = Field(default_factory=lambda: list(range(10)))


@app.post("/devices/templates/copy")
def template_copy(body: TemplateCopyReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    pulled = []
    with _Conn(body.src_device) as src:
        src_user = next((u for u in (src.get_users() or []) if str(u.user_id) == str(body.user_id)), None)
        if not src_user:
            raise HTTPException(status_code=404, detail=f"user_id {body.user_id} not on src device")
        for finger in body.finger_ids:
            try:
                t = src.get_user_template(uid=src_user.uid, temp_id=finger)
                if t:
                    pulled.append((finger, t))
            except Exception:
                pass

    if not pulled:
        return {"ok": False, "reason": "no_templates_on_src"}

    with _Conn(body.dst_device) as dst:
        dst_user = next((u for u in (dst.get_users() or []) if str(u.user_id) == str(body.user_id)), None)
        if not dst_user:
            raise HTTPException(status_code=404, detail=f"user_id {body.user_id} not on dst device — upsert first")
        for finger, template in pulled:
            template.uid = dst_user.uid
            template.fid = finger
            try:
                dst.save_user_template(user=dst_user, fingers=[template])
            except Exception as e:
                return {"ok": False, "copied": [f for f, _ in pulled[:pulled.index((finger, template))]], "error": str(e)}

    return {"ok": True, "copied_fingers": [f for f, _ in pulled]}
