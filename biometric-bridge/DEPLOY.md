# Deploying biometric-bridge to the factory-server PC

End-to-end runbook. Target: a single biometric-bridge instance on the
factory-server (Windows), serving every eSSL device on the plant LAN. Cloud
ERP on Railway hits the bridge via the factory-server's Tailscale IP.

## Prerequisites on the factory-server PC

- Windows 10/11 or Windows Server (existing factory-server box).
- **Python 3.10+** on PATH. Install from <https://www.python.org/downloads/windows/>;
  during install tick **"Add Python to PATH"**. Verify in PowerShell:
  ```powershell
  python --version
  ```
- **Tailscale** already running and authed to the team net (the box's IP
  shows up in `tailscale ip -4`; e.g. `100.126.101.7`). The cloud backend
  on Railway is also on this tailnet — that's how it'll reach the bridge.
- All eSSL devices on the same LAN as the factory-server (typical:
  `192.168.0.x/24`). Confirm by pinging each device's IP from the
  factory-server PC before continuing.

## Step 1 — copy the code to the factory-server

From your dev machine:

```bash
# From the ethanol_erp repo root
sshpass -p Mspil@1212 scp -o StrictHostKeyChecking=no -r \
  biometric-bridge/ \
  Administrator@100.126.101.7:C:/mspil/
```

(or copy the folder via RDP / a USB stick / git clone on the box — whatever
works for you. End state: `C:\mspil\biometric-bridge\` contains `bridge.py`,
`requirements.txt`, `scripts\`, etc.)

## Step 2 — install (one time)

RDP into the factory-server PC, open PowerShell **as Administrator**:

```powershell
cd C:\mspil\biometric-bridge
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

This:
- Verifies Python is on PATH.
- Creates `.venv\` and installs `pyzk`, `fastapi`, `uvicorn`.
- Generates a random `BIOMETRIC_BRIDGE_KEY` and writes it to `.env`.
- Adds a Windows Firewall rule for inbound TCP 5005.

**Copy the printed `BIOMETRIC_BRIDGE_KEY` value** — you'll paste it into
Railway in step 4.

## Step 3 — register the scheduled tasks (one time)

Same PowerShell-as-Administrator session:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
```

This creates two scheduled tasks:
- `BiometricBridge` — runs `start-bridge.ps1` at boot. Blocks on uvicorn so
  the task stays in `Running` state while the bridge is alive.
- `BiometricBridgeWatchdog` — runs `watchdog.ps1` every 5 min. If TCP 5005
  isn't listening, kicks the bridge task. Mirrors the pattern used by
  `factory-server\scripts\watchdog.ps1` (born from the 2026-04-29 incident
  where Oracle's backup tool blanket-killed our node.exe).

The script triggers the bridge immediately and reports whether port 5005 is
listening. If it isn't yet, wait 10s and check `logs\bridge-<date>.log`.

## Step 4 — point Railway at the new bridge

In the Railway dashboard, set on the **backend** service:

```
BIOMETRIC_BRIDGE_URL=http://100.126.101.7:5005
BIOMETRIC_BRIDGE_KEY=<the value printed in step 2>
```

(Substitute the actual factory-server Tailscale IP if it's different.)

Redeploy the backend (Railway does this automatically on env-var change).

## Step 5 — verify from the cloud admin UI

1. Log in to <https://app.mspil.in> as admin.
2. HR module → Biometric Devices → click **Bridge Health** at the top.
3. Should return `{ "ok": true, "version": "0.1.0", ... }`.
4. Add each eSSL device via **Add Device** (just IP, port 4370, password 0
   are the typical defaults).
5. On any device row, click **Test** — confirms the bridge can reach that
   specific device on the LAN.
6. Set **Auto Pull (min)** = 5, **Auto Push (min)** = 5 on each device. The
   `biometricScheduler.ts` background loop on Railway picks these up within
   60 seconds.

After that the system runs itself — punches stream into the
`AttendancePunch` table, employees + labor get pushed to every device every
5 min, and the device-user-id allocator (PR #35) self-heals collisions.

## Troubleshooting

**Bridge not listening on :5005**
- `Get-Content C:\mspil\biometric-bridge\logs\bridge-<date>.log -Tail 30` — read the uvicorn output.
- Most common: `BIOMETRIC_BRIDGE_KEY missing — check .env` → the .env file
  didn't survive the copy. Recreate manually (one line: `BIOMETRIC_BRIDGE_KEY=...`).

**Bridge listening locally but cloud says "ECONNREFUSED" / timeout**
- Tailscale not running on the factory-server, OR Railway's `BIOMETRIC_BRIDGE_URL`
  points at the wrong IP. From a Mac on the tailnet, run:
  ```bash
  curl -v http://100.126.101.7:5005/health
  ```
  to verify reachability outside Railway.
- If it works from a Mac on the tailnet but not from Railway, check that
  Railway's deployment has Tailscale subnet routes active (or use the
  Tailscale OAuth integration on the Railway side).

**Device unreachable from bridge**
- From the factory-server PowerShell:
  ```powershell
  Test-NetConnection -ComputerName 192.168.0.25 -Port 4370
  ```
- If this fails, the eSSL device isn't on the same VLAN as the
  factory-server. Get IT to put them on the same subnet (or set up a
  static route).

**Watchdog spamming "STILL DOWN"**
- Read `logs\watchdog.log`. If uvicorn is being killed repeatedly, check for
  Antivirus quarantining `python.exe` or `pyzk` — some EDR tools flag pyzk's
  raw socket use as suspicious. Whitelist `C:\mspil\biometric-bridge\.venv\`.

## Removal / rollback

```powershell
schtasks /Delete /TN BiometricBridge /F
schtasks /Delete /TN BiometricBridgeWatchdog /F
Remove-NetFirewallRule -DisplayName 'BiometricBridge :5005'
# Optionally:
Remove-Item -Recurse -Force C:\mspil\biometric-bridge
```

Cloud backend tolerates the bridge being gone — every device sync logs a
warning but never crashes. Set `BIOMETRIC_BRIDGE_URL=` (empty) on Railway
to silence the warnings.
