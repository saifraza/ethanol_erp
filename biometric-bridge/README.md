# biometric-bridge

HTTP wrapper around `pyzk` for eSSL/ZKTeco fingerprint devices. Cloud backend
on Railway can't reach plant-LAN devices directly, so this small service runs
on the LAN (factory-server PC, or a dev Mac) and exposes a REST API the cloud
backend calls when an admin pushes/pulls data from a device.

## Why a separate service?

- `pyzk` is the most battle-tested ZKTeco/eSSL protocol library in the wild.
  Equivalent Node libraries (`node-zklib`) have known issues with newer
  firmware versions.
- Keeps the cloud backend pure Node + Prisma. The bridge is a 200-line Python
  service with only one job — talk to devices.
- Multiple devices behind one bridge.

## Run (dev — on this Mac)

```bash
cd biometric-bridge
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
BIOMETRIC_BRIDGE_KEY=devsecret .venv/bin/uvicorn bridge:app --host 0.0.0.0 --port 5005
```

Then in `backend/.env`:
```
BIOMETRIC_BRIDGE_URL=http://localhost:5005
BIOMETRIC_BRIDGE_KEY=devsecret
```

Smoke test:
```bash
curl -sX POST http://localhost:5005/devices/info \
  -H 'X-Bridge-Key: devsecret' \
  -H 'Content-Type: application/json' \
  -d '{"device":{"ip":"192.168.0.25"}}'
```

## Run (prod — factory-server)

Deploy alongside the existing factory-server Node app. Use a systemd unit:

```ini
# /etc/systemd/system/biometric-bridge.service
[Unit]
Description=MSPIL biometric bridge
After=network.target

[Service]
WorkingDirectory=/opt/mspil/biometric-bridge
Environment="BIOMETRIC_BRIDGE_KEY=<production-secret>"
ExecStart=/opt/mspil/biometric-bridge/.venv/bin/uvicorn bridge:app --host 0.0.0.0 --port 5005
Restart=always
User=mspil

[Install]
WantedBy=multi-user.target
```

Cloud backend's `BIOMETRIC_BRIDGE_URL` then points to the factory-server's
internal URL (or via Tailscale tunnel).

## Endpoints

All endpoints accept `POST` with a JSON body. All require header
`X-Bridge-Key: <BIOMETRIC_BRIDGE_KEY>`. Common body field:

```json
{ "device": { "ip": "192.168.0.25", "port": 4370, "password": 0, "timeout": 10 } }
```

| Endpoint | Body adds | Returns |
|---|---|---|
| `POST /devices/info` | — | firmware, serial, time, counts |
| `POST /devices/users/list` | — | array of users (uid, user_id, name, card, privilege) |
| `POST /devices/users/upsert` | `user_id`, `name`, `card`, `privilege` | `{ok, uid, user_id}` |
| `POST /devices/users/delete` | `user_id` | `{ok, deleted_uid}` |
| `POST /devices/users/enroll` | `user_id`, `finger_id` | puts device in enrollment mode |
| `POST /devices/punches/pull` | `since?`, `clear_after?` | array of punches with UTC `punch_at` |
| `POST /devices/time/sync` | `set_to?` | sets device clock |
| `POST /devices/templates/copy` | `src_device`, `dst_device`, `user_id`, `finger_ids?` | replicate fingerprint across devices |

## Notes

- Device clocks are kept in IST (the device shows IST on screen). The bridge
  converts to UTC for `punch_at` so the cloud only deals with UTC.
- `device_user_id` is always a string in our API even though the device
  uses small integers — keeps types consistent with cloud Prisma.
- `clear_after=true` on `/punches/pull` is destructive — only use after
  successfully ingesting into cloud. Default is false.
