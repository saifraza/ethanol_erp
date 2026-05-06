# biometric-bridge

HTTP wrapper around `pyzk` for eSSL/ZKTeco fingerprint devices. Cloud backend
on Railway can't reach plant-LAN devices directly, so this small service runs
on the LAN (factory-server PC) and exposes a REST API the cloud backend calls
when an admin pushes/pulls data from a device.

## Why a separate service?

- `pyzk` is the most battle-tested ZKTeco/eSSL protocol library in the wild.
  Equivalent Node libraries (`node-zklib`) have known issues with newer
  firmware versions.
- Keeps the cloud backend pure Node + Prisma. The bridge is a 200-line Python
  service with only one job — talk to devices.
- Multiple devices behind one bridge — each `BiometricDevice` row in the cloud
  carries its own LAN IP/port/password and the bridge fans out per request.

## Production deployment (factory-server PC, Windows)

This is the path used in prod. Single bridge serving all eSSL devices on the
plant LAN, reachable from cloud via the factory-server's Tailscale IP.

See [`DEPLOY.md`](./DEPLOY.md) for the full step-by-step. Short version:

```powershell
# On the factory-server PC, as Administrator
cd C:\mspil\biometric-bridge
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
```

Then on Railway set:
```
BIOMETRIC_BRIDGE_URL=http://100.126.101.7:5005
BIOMETRIC_BRIDGE_KEY=<value from .env on factory-server>
```

After that, every `BiometricDevice` row created via the cloud HR UI
(BiometricDevices page → Devices tab → "Add Device") is reachable through
this single bridge. No per-device tunneling, no Mac required.

## Dev (on a Mac, for testing without factory access)

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

To temporarily expose to Railway-hosted cloud (e.g. testing before factory
deploy), run cloudflared in front:
```bash
cloudflared tunnel --url http://localhost:5005
```
…then point Railway's `BIOMETRIC_BRIDGE_URL` at the printed `*.trycloudflare.com`
URL. This is intentionally throwaway — the prod path is the factory-server PC.

Smoke test:
```bash
curl -sX POST http://localhost:5005/devices/info \
  -H 'X-Bridge-Key: devsecret' \
  -H 'Content-Type: application/json' \
  -d '{"device":{"ip":"192.168.0.25"}}'
```

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
| `POST /devices/users/bulk-upsert` | `users: [...]` | `{ok, failed, results}` |
| `POST /devices/users/delete` | `user_id` | `{ok, deleted_uid}` |
| `POST /devices/users/enroll` | `user_id`, `finger_id` | puts device in enrollment mode |
| `POST /devices/punches/pull` | `since?`, `clear_after?` | array of punches with UTC `punch_at` |
| `POST /devices/punches/clear` | — | wipes attendance log on device |
| `POST /devices/time/sync` | `set_to?` | sets device clock |
| `POST /devices/templates/copy` | `src_device`, `dst_device`, `user_id`, `finger_ids?` | replicate fingerprint across devices |

## Notes

- Device clocks are kept in IST (the device shows IST on screen). The bridge
  converts to UTC for `punch_at` so the cloud only deals with UTC.
- `device_user_id` is always a string in our API even though the device
  uses small integers — keeps types consistent with cloud Prisma.
- `clear_after=true` on `/punches/pull` is destructive — only use after
  successfully ingesting into cloud. Default is false.
- Names are sanitized to Latin-1 by the bridge (the device firmware truncates
  on first non-ASCII char otherwise).
