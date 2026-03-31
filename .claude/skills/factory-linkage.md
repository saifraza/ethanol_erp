# Factory Linkage — Remote PC Management Guide

## Overview
All factory PCs are managed remotely from Mac via Tailscale. This document is the single reference for connecting to, deploying to, and troubleshooting each factory computer.

## Factory Network Map

```
Internet (Tailscale VPN)
│
├── Mac (your computer) — saifraza's MacBook Air
│   Tailscale IP: 100.99.123.94
│
├── Weighbridge PC (ethanolwb)
│   Tailscale IP: 100.91.152.57
│   LAN IP: 192.168.0.83
│   OS: Windows 10 Pro
│   User: abc / Password: acer@123
│   SSH: port 22 (OpenSSH)
│   Service: C:\mspil\weighbridge\ (Flask on :8098)
│   Hardware: COM1 (weighbridge indicator), TVS-E RP 3230 printer
│
├── Lab Computer (ethanollab) — OPC Bridge
│   Tailscale IP: 100.74.209.72
│   OS: Windows
│   Service: D:\opc\WindowsOPC\ (Python on :8099)
│   Hardware: OPC UA connection to ABB 800xA DCS (172.16.4.11)
│
└── Factory Server (LAN only)
    LAN IP: 192.168.0.10
    OS: Windows Server
    Terminal password: Mspil@1212
    Services: Oracle XE (port 1521), Print Consol (gate entry)
    SSH: NOT enabled — pending IT team
    Access: via weighbridge PC as jump host
```

## How to Connect

### Weighbridge PC
```bash
# Direct SSH
ssh abc@100.91.152.57
# Password: acer@123

# Or with sshpass (automated)
sshpass -p 'acer@123' ssh -o StrictHostKeyChecking=no abc@100.91.152.57 "command"

# Copy files TO the PC
scp file.py abc@100.91.152.57:C:/mspil/weighbridge/

# Copy files FROM the PC
scp abc@100.91.152.57:C:/Users/abc/file.txt ./
```

### Lab Computer (OPC)
```bash
# Direct SSH
ssh user@100.74.209.72

# Copy files
scp file.py user@100.74.209.72:D:/opc/WindowsOPC/
```

### Factory Server (via jump host)
```bash
# SSH not enabled yet. When IT enables it:
ssh -J abc@100.91.152.57 user@192.168.0.10

# For now, reach it from weighbridge PC:
sshpass -p 'acer@123' ssh abc@100.91.152.57 "ping 192.168.0.10"
```

## Services Running

### Weighbridge Service (ethanolwb)
**Location:** `C:\mspil\weighbridge\`
**Start:** `schtasks /run /tn "MSPIL Weighbridge"` or `pythonw C:\mspil\weighbridge\run.py`
**Stop:** `taskkill /F /IM pythonw.exe`
**Config:** `C:\mspil\weighbridge\config.py`
**Logs:** `C:\mspil\weighbridge\logs\weighbridge.log`
**DB:** `C:\mspil\weighbridge\data\weighbridge.db` (SQLite)
**Port:** 8098 (Flask web UI)
**Serial:** file mode (reads D:\WT\new weight.txt) — WtService owns COM1
**Protocol:** Set via `WB_PROTOCOL` env var (default: `file`)

**Common commands:**
```bash
# Check status
curl -s http://100.91.152.57:8098/api/weight

# View logs
sshpass -p 'acer@123' ssh abc@100.91.152.57 "type C:\mspil\weighbridge\logs\weighbridge.log | Select-Object -Last 20"

# Restart service
sshpass -p 'acer@123' ssh abc@100.91.152.57 "taskkill /F /IM pythonw.exe 2>&1"
sleep 2
sshpass -p 'acer@123' ssh abc@100.91.152.57 "powershell -Command \"Remove-Item 'C:\mspil\weighbridge\data\weighbridge.pid' -Force -ErrorAction SilentlyContinue; \$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); Start-Process -FilePath 'pythonw' -ArgumentList 'C:\mspil\weighbridge\run.py' -WorkingDirectory 'C:\mspil\weighbridge' -WindowStyle Hidden\""

# Force sync (master data + heartbeat)
sshpass -p 'acer@123' ssh abc@100.91.152.57 "powershell -Command \"\$env:Path = ...; cd C:\mspil\weighbridge; python run.py --sync-once\""

# Deploy updated code
cd ~/Desktop/distillery-erp/weighbridge
scp *.py abc@100.91.152.57:C:/mspil/weighbridge/
scp templates/*.html abc@100.91.152.57:C:/mspil/weighbridge/templates/

# Test DB
sshpass -p 'acer@123' ssh abc@100.91.152.57 "...; python run.py --test-db"

# Delete DB (fresh start — loses local data)
sshpass -p 'acer@123' ssh abc@100.91.152.57 "powershell -Command \"Remove-Item 'C:\mspil\weighbridge\data\weighbridge.db*' -Force\""
```

**CRITICAL SAFETY:**
- NEVER stop WtService (WTReadingNew) — it feeds the existing Oracle gate entry system
- NEVER touch COM1 — WtService owns it
- NEVER modify Oracle DB at 192.168.0.10
- Always delete weighbridge.pid before starting if service crashed
- Sleep/hibernate is disabled on this PC (powercfg)

### OPC Bridge Service (ethanollab)
**Location:** `D:\opc\WindowsOPC\`
**Start:** Task Scheduler or `python run.py`
**Config:** `D:\opc\WindowsOPC\config.py`
**Logs:** `D:\opc\WindowsOPC\logs\opc_bridge.log`
**DB:** `D:\opc\WindowsOPC\data\opc.db` (SQLite)
**Port:** 8099 (local API)
**OPC:** Connects to ABB 800xA at 172.16.4.11:44683

**Common commands:**
```bash
# Check status
curl -s http://100.74.209.72:8099/status

# View logs
ssh user@100.74.209.72 "type D:\opc\WindowsOPC\logs\opc_bridge.log | Select-Object -Last 20"
```

### Cameras (Dahua)
**Camera 233:** 192.168.0.233 (Ethanol Kata Back)
**Camera 239:** 192.168.0.239 (Ethanol Kata Front)
**Login:** admin / admin123
**Ports:** 80 (HTTP), 554 (RTSP), 37777 (Dahua)
**Snapshot URL:** `http://admin:admin123@192.168.0.233/cgi-bin/snapshot.cgi?channel=1` (use digest auth)

### Other LAN Devices
```
192.168.0.10  — Factory Server (Oracle XE, Print Consol)
192.168.0.50  — Unknown device
192.168.0.70  — Unknown device
192.168.0.74  — Unknown device
192.168.0.83  — Weighbridge PC
192.168.0.120 — Unknown device
192.168.0.200 — Unknown device
192.168.0.201 — Unknown device
192.168.0.209 — Unknown device (08:ed:ed MAC — could be camera/NVR)
192.168.0.225 — Unknown device (08:ed:ed MAC)
192.168.0.233 — Dahua Camera (Kata Back)
192.168.0.239 — Dahua Camera (Kata Front)
192.168.0.245 — Unknown device (08:ed:ed MAC)
```

## Deploying Code Updates

### Weighbridge — deploy from Mac
```bash
cd ~/Desktop/distillery-erp/weighbridge

# 1. Copy Python files
scp *.py abc@100.91.152.57:C:/mspil/weighbridge/
scp templates/*.html abc@100.91.152.57:C:/mspil/weighbridge/templates/

# 2. Restart service
sshpass -p 'acer@123' ssh abc@100.91.152.57 "taskkill /F /IM pythonw.exe 2>&1"
sleep 2
sshpass -p 'acer@123' ssh abc@100.91.152.57 "powershell -Command \"Remove-Item 'C:\mspil\weighbridge\data\weighbridge.pid' -Force -ErrorAction SilentlyContinue; \$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); Start-Process -FilePath 'pythonw' -ArgumentList 'C:\mspil\weighbridge\run.py' -WorkingDirectory 'C:\mspil\weighbridge' -WindowStyle Hidden\""

# 3. Verify
sleep 8 && curl -s http://100.91.152.57:8098/api/weight
```

**IMPORTANT:** config.py uses `WB_PROTOCOL` env var (default: `file`). Deploying config.py won't change the serial mode — safe to deploy anytime.

**If schema changed (new SQLite tables):** Delete the DB first:
```bash
sshpass -p 'acer@123' ssh abc@100.91.152.57 "powershell -Command \"Remove-Item 'C:\mspil\weighbridge\data\weighbridge.db*' -Force\""
```

### OPC — deploy from Mac
```bash
cd ~/Desktop/opc/WindowsOPC
scp *.py user@100.74.209.72:D:/opc/WindowsOPC/
# Restart via Task Scheduler on the PC
```

## Troubleshooting

### Weighbridge service won't start
1. Check PID file: `Remove-Item weighbridge.pid`
2. Check config: `SERIAL_PROTOCOL` must be `file` (WtService owns COM1)
3. Check DB schema: if new columns added, delete DB and restart
4. Run with `python run.py` (not pythonw) to see errors

### Weighbridge shows 0 weight
- In file mode: WtService doesn't write to `new weight.txt` (known bug)
- To get live weight: stop WtService, switch to serial mode — BUT this stops their old gate system
- Solution: wait for factory server setup (tomorrow), or use second serial port

### Factory PC not showing on Weighment System page
1. PC heartbeat not reaching cloud — check if service is running
2. Force sync: `python run.py --sync-once`
3. Cloud redeployed — heartbeats are in-memory, cleared on Railway redeploy
4. Check logs for heartbeat errors

### Can't SSH into a PC
- Check Tailscale: `tailscale status`
- PC might be off or disconnected from Tailscale
- Factory server: SSH not enabled — need IT to run 3 PowerShell commands

## Future PCs (as they come online)

When adding a new factory PC:
1. Install Tailscale on the PC
2. Install Python 3.11 + pyserial + flask
3. Copy `weighbridge/` folder from repo
4. Set `WB_PC_ID` and `WB_PC_NAME` in config or env vars
5. Create Task Scheduler job for auto-start
6. Disable sleep: `powercfg /change standby-timeout-ac 0`
7. Open firewall: `netsh advfirewall firewall add rule name='MSPIL' dir=in action=allow protocol=tcp localport=8098`
8. The PC will auto-appear on the Weighment System page after first heartbeat

### Planned PCs:
- **Gate Entry PC** — dedicated to gate entry only
- **Weighbridge PC 2** — second scale (if added)
- **Fuel Yard PC** — for fuel intake tracking
- **Camera Server** — when ANPR cameras are added
- **Factory Server** — central hub (pending SSH enablement)
