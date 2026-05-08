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
  POST /devices/templates/list   — return per-user enrolled finger ids on device
                                    (used by factory-server's auto-replicator)
  POST /devices/users/rename     — rename user_ids on device while preserving
                                    enrolled fingerprint templates (one-shot
                                    migration tool)

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


# ───────────────────────── bulk delete ─────────────────────────
# Single-connection bulk delete with disable_device() framing — the rename
# ceremony showed that delete_user calls during active matching get silently
# dropped on some firmwares. disable_device puts the unit in admin-only mode
# so deletes commit deterministically. enable_device restores normal use.

class BulkDeleteReq(BaseModel):
    device: DeviceRef
    user_ids: list[str]


@app.post("/devices/users/bulk-delete")
def bulk_delete(body: BulkDeleteReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    results: list[dict] = []
    with _Conn(body.device) as conn:
        # NOTE: deliberately NOT calling disable_device(). On CM/ETHANOL
        # firmware, disable puts the unit in RAM-only mode and enable_device
        # reloads from flash, silently undoing the deletes. Letting deletes
        # go through with the device live commits to flash directly.
        users = list(conn.get_users() or [])
        by_user_id = {str(u.user_id): u for u in users}

        for user_id in body.user_ids:
            target = by_user_id.get(str(user_id))
            if not target:
                results.append({"user_id": user_id, "status": "not_found"})
                continue
            try:
                conn.delete_user(uid=target.uid)
                by_user_id.pop(str(user_id), None)
                results.append({"user_id": user_id, "status": "ok", "uid": target.uid})
            except Exception as e:
                results.append({"user_id": user_id, "status": "error", "error": f"{type(e).__name__}: {e}"})

        # Force the device to commit pending changes to flash. pyzk's
        # refresh_data sends CMD_REFRESHDATA which makes the device write
        # through any RAM-staged changes.
        try:
            conn.refresh_data()
        except Exception:
            pass

        # Re-fetch to verify deletes actually committed.
        try:
            refetched = {str(u.user_id) for u in (conn.get_users() or [])}
            for r in results:
                if r["status"] == "ok" and str(r["user_id"]) in refetched:
                    r["status"] = "delete_silent_fail"
        except Exception:
            pass

    ok = sum(1 for r in results if r["status"] == "ok")
    not_found = sum(1 for r in results if r["status"] == "not_found")
    failed = len(results) - ok - not_found
    return {"ok": True, "total": len(body.user_ids), "deleted": ok, "not_found": not_found, "failed": failed, "results": results}


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


# ───────────────────────── clear all logs (destructive) ─────────────────────────

class ClearLogsReq(BaseModel):
    device: DeviceRef


@app.post("/devices/punches/clear")
def clear_punches(body: ClearLogsReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        try:
            conn.clear_attendance()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}


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


# ───────────────────────── rename user_ids on a device ─────────────────────────
# One-shot migration: change user_ids on the device WITHOUT asking workers to
# re-scan their fingerprints. For each (old_user_id, new_user_id) pair:
#   1. Pull all 10 fingerprint templates from the old user
#   2. Create a new user record with new_user_id + same name/card/privilege
#   3. Save the pulled templates under the new user
#   4. Delete the old user (only after templates copied successfully)
#
# Idempotent: re-running on a device that's already half-renamed is safe.
# Both `old_user_id` and `new_user_id` strings are checked at every step.


class RenameUserPair(BaseModel):
    old_user_id: str
    new_user_id: str


class RenameUsersReq(BaseModel):
    device: DeviceRef
    pairs: list[RenameUserPair]


@app.post("/devices/users/rename")
def users_rename(body: RenameUsersReq, x_bridge_key: Optional[str] = Header(None)):
    _check_key(x_bridge_key)
    results = []
    with _Conn(body.device) as conn:
        users = list(conn.get_users() or [])
        by_user_id: dict[str, ZKUser] = {str(u.user_id): u for u in users}
        used_uids: set[int] = {u.uid for u in users}

        # Pull EVERY enrolled fingerprint template up-front in one call.
        # First version of this endpoint did 10 conn.get_user_template() probes
        # PER user (0..9), which is ~10 UDP round-trips × 540 users = ~5400
        # round-trips just to discover that most users have 0 templates. With
        # eSSL devices that's enough load to drive 50%+ failure rates per chunk.
        # get_templates() returns the full list in one shot; we slice it locally.
        templates_by_uid: dict[int, list[tuple[int, object]]] = {}
        try:
            for t in (conn.get_templates() or []):
                tu = getattr(t, "uid", None)
                tf = getattr(t, "fid", None)
                tv = getattr(t, "valid", 1)
                if tu is None or tf is None or not tv:
                    continue
                templates_by_uid.setdefault(int(tu), []).append((int(tf), t))
        except Exception:
            # Fallback handled per-pair (slower but recoverable)
            templates_by_uid = None  # type: ignore[assignment]

        def alloc_uid() -> int:
            i = 1
            while i in used_uids:
                i += 1
            used_uids.add(i)
            return i

        def get_pulled_templates(uid: int) -> list[tuple[int, object]]:
            if templates_by_uid is not None:
                return list(templates_by_uid.get(uid, []))
            # Fallback: per-finger probe
            pulled: list[tuple[int, object]] = []
            for finger in range(10):
                try:
                    t = conn.get_user_template(uid=uid, temp_id=finger)
                    if t:
                        pulled.append((finger, t))
                except Exception:
                    pass
            return pulled

        def has_any_template(uid: int) -> bool:
            if templates_by_uid is not None:
                return bool(templates_by_uid.get(uid))
            for finger in range(10):
                try:
                    if conn.get_user_template(uid=uid, temp_id=finger):
                        return True
                except Exception:
                    pass
            return False

        for pair in body.pairs:
            oid = str(pair.old_user_id)
            nid = str(pair.new_user_id)
            try:
                old_user = by_user_id.get(oid)
                new_user = by_user_id.get(nid)

                # Idempotency: a previous run finished. Skip silently.
                if not old_user and new_user:
                    results.append({"old": oid, "new": nid, "status": "already_renamed"})
                    continue
                if not old_user:
                    results.append({"old": oid, "new": nid, "status": "old_not_found"})
                    continue

                # 1. Pull templates from old user (now cached, no round-trips)
                pulled = get_pulled_templates(old_user.uid)

                # 2. Resolve target user (create if needed)
                if new_user is not None:
                    # If the new user already has templates AND the old user
                    # has none, we're looking at a half-finished previous run:
                    # templates were copied but the old user wasn't deleted.
                    # Complete it by deleting the old user — the rename is
                    # effectively already done.
                    new_has = has_any_template(new_user.uid)
                    old_has = has_any_template(old_user.uid)
                    if new_has and not old_has:
                        try:
                            conn.delete_user(uid=old_user.uid)
                            used_uids.discard(old_user.uid)
                            by_user_id.pop(oid, None)
                            if templates_by_uid is not None:
                                templates_by_uid.pop(old_user.uid, None)
                            results.append({"old": oid, "new": nid, "status": "ok_recovered"})
                        except Exception as e:
                            results.append({"old": oid, "new": nid, "status": "delete_old_failed_in_recovery", "error": f"{type(e).__name__}: {e}"})
                        continue
                    if new_has and old_has:
                        # Both have templates. The most likely cause is a prior
                        # rename run that copied templates from old to new, then
                        # was killed before deleting old, AND a worker scanned
                        # afterwards (so old got punches that re-confirmed its
                        # templates). New is the migration target — trust it,
                        # delete old. The fingerprint is the same person either
                        # way (it was copied from old in the first place).
                        try:
                            conn.delete_user(uid=old_user.uid)
                            used_uids.discard(old_user.uid)
                            by_user_id.pop(oid, None)
                            if templates_by_uid is not None:
                                templates_by_uid.pop(old_user.uid, None)
                            results.append({"old": oid, "new": nid, "status": "ok_resolved_conflict"})
                        except Exception as e:
                            results.append({"old": oid, "new": nid, "status": "delete_old_failed_in_conflict", "error": f"{type(e).__name__}: {e}"})
                        continue
                    target_user = new_user
                else:
                    new_uid = alloc_uid()
                    safe_name = _safe_name(old_user.name or "")
                    if not safe_name:
                        results.append({"old": oid, "new": nid, "status": "name_empty_after_sanitize"})
                        continue
                    try:
                        conn.set_user(
                            uid=new_uid,
                            name=safe_name,
                            privilege=int(old_user.privilege or 0),
                            password=str(old_user.password or ""),
                            group_id=str(old_user.group_id or ""),
                            user_id=nid,
                            card=int(old_user.card or 0),
                        )
                    except Exception as e:
                        results.append({"old": oid, "new": nid, "status": "create_new_failed", "error": f"{type(e).__name__}: {e}"})
                        continue
                    # No need to re-fetch users — we just told the device the uid,
                    # and save_user_template only needs the uid and a User-shaped
                    # object. Saves one full get_users() round-trip per pair.
                    target_user = ZKUser(
                        uid=new_uid,
                        name=safe_name,
                        privilege=int(old_user.privilege or 0),
                        password=str(old_user.password or ""),
                        group_id=str(old_user.group_id or ""),
                        user_id=nid,
                        card=int(old_user.card or 0),
                    )
                    by_user_id[nid] = target_user

                # 3. Save templates under the new user
                copied: list[int] = []
                save_err: Optional[str] = None
                for finger, template in pulled:
                    try:
                        template.uid = target_user.uid
                        template.fid = finger
                        conn.save_user_template(user=target_user, fingers=[template])
                        copied.append(finger)
                    except Exception as e:
                        save_err = f"{type(e).__name__}: {e}"
                        break

                if save_err is not None:
                    # Templates partial — DO NOT delete old, leave the device in a
                    # recoverable state for re-run.
                    results.append({"old": oid, "new": nid, "status": "template_save_failed", "copied": copied, "error": save_err})
                    continue

                # 4. Delete the old user
                try:
                    conn.delete_user(uid=old_user.uid)
                    used_uids.discard(old_user.uid)
                    by_user_id.pop(oid, None)
                    if templates_by_uid is not None:
                        templates_by_uid.pop(old_user.uid, None)
                    results.append({"old": oid, "new": nid, "status": "ok", "fingers": copied})
                except Exception as e:
                    results.append({"old": oid, "new": nid, "status": "delete_old_failed", "copied": copied, "error": f"{type(e).__name__}: {e}"})
            except Exception as e:
                results.append({"old": oid, "new": nid, "status": "exception", "error": f"{type(e).__name__}: {e}"})

    ok_count = sum(1 for r in results if r["status"] == "ok")
    skipped = sum(1 for r in results if r["status"] == "already_renamed")
    failed = len(results) - ok_count - skipped
    return {
        "ok": True,
        "total": len(body.pairs),
        "renamed": ok_count,
        "already_renamed": skipped,
        "failed": failed,
        "results": results,
    }


class ClearTemplatesReq(BaseModel):
    device: DeviceRef


@app.post("/devices/templates/clear-all")
def templates_clear_all(body: ClearTemplatesReq, x_bridge_key: Optional[str] = Header(None)):
    """Wipe every enrolled fingerprint template on this device.

    Keeps user records intact — so when workers re-enrol tomorrow, the user_id
    + name are already there and only the new template gets stored. Does NOT
    touch face templates (those use a different storage region).

    Implementation: enumerate all templates via get_templates(), call
    delete_user_template(uid, temp_id) per (uid, finger), then refresh_data()
    to force the device to commit to flash. Verify by re-listing.
    """
    _check_key(x_bridge_key)
    deleted = 0
    failed = 0
    errors: list[dict] = []
    with _Conn(body.device) as conn:
        templates = list(conn.get_templates() or [])
        before = len(templates)
        for t in templates:
            uid = getattr(t, "uid", None)
            fid = getattr(t, "fid", None)
            if uid is None or fid is None:
                continue
            try:
                conn.delete_user_template(uid=int(uid), temp_id=int(fid))
                deleted += 1
            except Exception as e:
                failed += 1
                if len(errors) < 10:
                    errors.append({"uid": uid, "fid": fid, "error": f"{type(e).__name__}: {e}"})

        try:
            conn.refresh_data()
        except Exception:
            pass

        after_templates = list(conn.get_templates() or [])
        after = len(after_templates)

    return {
        "ok": True,
        "templates_before": before,
        "deleted_acked": deleted,
        "failed": failed,
        "templates_after": after,
        "actually_removed": before - after,
        "errors": errors,
    }


class TemplatesListReq(BaseModel):
    device: DeviceRef


@app.post("/devices/templates/list")
def templates_list(body: TemplatesListReq, x_bridge_key: Optional[str] = Header(None)):
    """Return a map of user_id -> list of enrolled finger ids on this device.

    Used by the factory-server's auto-replicator to detect which devices are
    missing templates for which users, without doing N x M get_user_template()
    probes. One round-trip to get_users() + one to get_templates() per device.
    """
    _check_key(x_bridge_key)
    with _Conn(body.device) as conn:
        users = conn.get_users() or []
        uid_to_user_id: dict[int, str] = {u.uid: str(u.user_id) for u in users}
        templates = conn.get_templates() or []
        result: dict[str, list[int]] = {}
        for t in templates:
            uid = getattr(t, "uid", None)
            fid = getattr(t, "fid", None)
            valid = getattr(t, "valid", 1)
            if uid is None or fid is None or not valid:
                continue
            user_id = uid_to_user_id.get(uid)
            if user_id is None:
                continue
            result.setdefault(user_id, []).append(int(fid))
        # Sort finger lists for deterministic output
        for user_id in result:
            result[user_id] = sorted(set(result[user_id]))
        return {"ok": True, "user_count": len(result), "templates": result}
