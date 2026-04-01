# Factory Linkage — Complete System Documentation

## 1. Architecture Overview

MSPIL Distillery has a **factory-local system** that runs alongside the cloud ERP (app.mspil.in). The factory server is the **central hub** — it runs its own database, serves a role-based web UI, monitors all factory PCs via LAN, and syncs data to the cloud.

### Data Flow
```
┌─────────────────────────────────────────────────────────────────┐
│                        CLOUD (Internet)                         │
│   Railway: app.mspil.in — Main ERP, PostgreSQL, WhatsApp        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ heartbeats + weighment sync
                               │ master data pull (suppliers, POs)
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│               FACTORY SERVER (Central Hub)                       │
│   192.168.0.10 / Tailscale 100.126.101.7                        │
│   Windows Server 2019, 65GB RAM, Node.js 18                     │
│   ┌──────────────┐ ┌──────────────┐ ┌────────────────┐          │
│   │ PostgreSQL   │ │ Express API  │ │ React Frontend │          │
│   │ :5432        │ │ :5000        │ │ (served :5000) │          │
│   └──────────────┘ └──────────────┘ └────────────────┘          │
│   ┌──────────────────────────────────────────────┐              │
│   │ PC Monitor — polls all PCs via LAN HTTP      │              │
│   │ every 30s, forwards heartbeats to cloud      │              │
│   └──────────────────────────────────────────────┘              │
│   Legacy: Oracle XE :1521 (DO NOT TOUCH)                        │
└────────┬──────────────────┬─────────────────┬──────────────────┘
         │ LAN              │ LAN             │ LAN
┌────────▼────────┐ ┌──────▼───────┐ ┌───────▼────────┐
│ Weighbridge PC  │ │ Lab/OPC PC   │ │ Future PCs     │
│ 192.168.0.83    │ │ 100.74.209.72│ │ Gate Entry,    │
│ Flask :8098     │ │ Python :8099 │ │ Fuel Yard etc  │
│ COM1 (scale)    │ │ ABB 800xA    │ │ Just open      │
│ Thermal printer │ │ DCS          │ │ Chrome to      │
│ QR scanner      │ │              │ │ 192.168.0.10   │
└─────────────────┘ └──────────────┘ └────────────────┘
```

### Key Principles
- **Factory PCs do NOT need Tailscale or internet** — factory server is the only bridge
- **Factory server polls PCs via LAN HTTP** — no SSH needed for monitoring
- **Local-first** — factory operations never blocked by internet outage
- **Role-based access** — each PC user sees only their pages
- **WtService is DISABLED** — our Python service reads COM1 directly in serial mode

## 2. Current System Status (2026-04-01)

### What's Working
| Component | Status | Details |
|-----------|--------|---------|
| Factory Server API | Running | Port 5000, auto-start on boot |
| PostgreSQL 16 | Running | Port 5432, DB: `mspil_factory`, auto-start |
| Factory Frontend | Running | Role-based React app at `:5000` |
| PC Monitor | Running | Polls weighbridge PC every 30s |
| Heartbeat forwarding | Working | All 3 PCs show ONLINE on cloud ERP |
| Weighbridge Flask UI | Running | Port 8098, COM1 serial mode |
| Weight reading | Working | `connected: true`, direct serial (2400/7/N/1) |
| Cloud sync (weighments) | Working | Tested end-to-end, cloud correctly filters weight=0 |
| Master data sync | Working | 16 suppliers, 16 materials, 1 PO, 5 customers |
| OPC Bridge | Running | Port 8099, ABB 800xA connected |
| Cloud ERP monitoring | Working | app.mspil.in/weighment-system shows all PCs |

### Known Issues
| Issue | Impact | Resolution |
|-------|--------|------------|
| WtService was using 8-bit instead of 7-bit serial | Weight file always empty | **FIXED**: WtService disabled, Python reads COM1 directly |
| Account lockout on too many SSH attempts | abc user gets locked out for 30 min | **MITIGATED**: Reboot clears lockout. Be careful with SSH retries |
| Factory server schtask needs correct working dir | `.env` not found on boot | **FIXED**: schtask uses `cmd /c cd /d C:\mspil\factory-server && node dist\server.js` |
| Cloud skips weighments with weight=0 | Test entries don't create GRN | **By design**: Only real weights create cloud records |
| SQLite schema changes require DB delete | Old DB missing new columns | **Known**: Delete `weighbridge.db` and restart when schema changes |

## 3. All Machines

### Factory Server (Central Hub)
| Field | Value |
|-------|-------|
| **Hostname** | WIN-PBMJ9RMTO6L |
| **OS** | Windows Server 2019 Standard (Build 17763) |
| **RAM** | 65 GB |
| **Disk C:** | 307 GB (194 GB free) |
| **Disk E:** | 586 GB (313 GB free) |
| **LAN IP** | 192.168.0.10 (NIC2), 192.168.0.92 (NIC1) |
| **Tailscale IP** | 100.126.101.7 |
| **User** | Administrator / Mspil@1212 |
| **SSH** | Port 22 (OpenSSH, auto-start) |
| **Our services** | PostgreSQL :5432, Express+React :5000 |
| **Legacy** | Oracle XE :1521, unknown on :8070/:8080/:8888 |
| **Sleep** | Disabled |
| **Auto-start** | schtask "MSPIL Factory Server" |
| **Service dir** | `C:\mspil\factory-server\` |
| **Logs** | stdout (no file logging yet) |

### Weighbridge PC (ethanolwb)
| Field | Value |
|-------|-------|
| **OS** | Windows 10 Pro |
| **LAN IP** | 192.168.0.83 |
| **Tailscale IP** | 100.91.152.57 (may be off — not required) |
| **User** | abc / acer@123 (admin) |
| **SSH** | Port 22 (OpenSSH) |
| **Service** | Python Flask on :8098 |
| **Serial** | COM1, 2400/7/N/1, **direct serial mode** |
| **WtService** | **DISABLED** (was interfering with COM1) |
| **Printers** | TVS-E RP 3230 (thermal 80mm), EPSON FX-2175II (dot matrix) |
| **Service dir** | `C:\mspil\weighbridge\` |
| **SQLite DB** | `C:\mspil\weighbridge\data\weighbridge.db` |
| **Logs** | `C:\mspil\weighbridge\logs\weighbridge.log` |
| **Auto-start** | schtask "MSPIL Weighbridge" |
| **Sleep** | Disabled |

### Lab Computer (ethanollab) — OPC Bridge
| Field | Value |
|-------|-------|
| **OS** | Windows 10 |
| **Tailscale IP** | 100.74.209.72 |
| **User** | abc / 123 |
| **SSH** | Port 22 |
| **Service** | Python on :8099 |
| **OPC** | ABB 800xA at 172.16.4.11:44683 |
| **Service dir** | `C:\Users\abc\Desktop\OPC\` |
| **Auto-start** | schtask "MSPIL OPC Bridge" |

### Cameras (Dahua)
| Camera | IP | Location |
|--------|-----|----------|
| Camera 233 | 192.168.0.233 | Ethanol Kata Back |
| Camera 239 | 192.168.0.239 | Ethanol Kata Front |
| **Login** | admin / admin123 | Ports 80, 554 (RTSP), 37777 |

## 4. User Access & Role-Based UI

The factory server serves a React web app at `http://192.168.0.10:5000`. Users login and see only pages matching their role.

### Default Users
| Username | Password | Role | What they see |
|----------|----------|------|---------------|
| `admin` | `admin123` | ADMIN | All pages: dashboard, gate entry, weighment, user management |
| `gate1` | `gate123` | GATE_ENTRY | Gate entry page only |
| `wb1` | `wb123` | WEIGHBRIDGE | Weighment monitoring page only |

### Available Roles
| Role | Access | Use case |
|------|--------|----------|
| ADMIN | Everything | Plant manager, IT admin |
| GATE_ENTRY | Gate entry page | Gate operator PC |
| WEIGHBRIDGE | Weighment page | Weighbridge operator (monitoring only — actual weighing uses Flask UI at :8098) |
| FUEL_YARD | (planned) | Fuel intake tracking |
| LAB | (planned) | Lab data entry |

### How Each PC Accesses the System
| PC | What to open | Login as |
|----|-------------|----------|
| **Weighbridge PC** | `http://localhost:8098` for weighing (Flask UI) | No login needed |
| **Any PC for gate entry** | `http://192.168.0.10:5000` (factory server) | `gate1` / `gate123` |
| **Any PC for admin** | `http://192.168.0.10:5000` (factory server) | `admin` / `admin123` |
| **Your Mac (remote)** | `http://100.126.101.7:5000` (via Tailscale) | `admin` / `admin123` |

### Creating New Users
Admin users can create new users from the Admin Dashboard > Users tab, or via API:
```bash
curl -X POST http://192.168.0.10:5000/api/auth/users \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"username":"gate2","password":"gate123","name":"Gate Entry 2","role":"GATE_ENTRY"}'
```

## 5. Weighbridge Workflow (3-Step)

The weighbridge PC runs its own Flask UI at `http://localhost:8098` (or `http://192.168.0.83:8098` from LAN).

### Step 1 — Gate Entry
- Operator enters vehicle number, selects supplier/PO, direction (IN/OUT)
- System creates a weighment record with status `GATE_ENTRY`
- Gate pass prints on thermal printer

### Step 2 — First Weight (Gross)
- Truck drives onto scale
- Operator clicks "Capture Gross Weight"
- System reads live weight from COM1, records it
- Status changes to `FIRST_DONE`
- Weight slip prints

### Step 3 — Second Weight (Tare)
- Empty truck returns to scale (or loaded truck for outbound)
- Operator clicks "Capture Tare Weight"
- System calculates net weight (gross - tare)
- Status changes to `COMPLETE`
- Final weight slip prints
- Weighment syncs to cloud ERP within 30 seconds

### Cloud Sync Rules
- Only `COMPLETE` weighments with `weight_net > 0` sync to cloud
- Cloud auto-creates: **GRN** (if PO linked), **DirectPurchase** (if SPOT), **DDGSDispatch** (if outbound)
- Duplicate detection via `WB:uuid` in remarks field

## 6. SSH Connection Guide

### From Mac (via Tailscale)
```bash
# Factory Server (always available)
sshpass -p 'Mspil@1212' ssh -o StrictHostKeyChecking=no Administrator@100.126.101.7

# Weighbridge PC (only if Tailscale is on)
sshpass -p 'acer@123' ssh -o StrictHostKeyChecking=no abc@100.91.152.57

# Lab PC
sshpass -p '123' ssh -o StrictHostKeyChecking=no abc@100.74.209.72
```

### From Factory Server to PCs (via LAN — always works)
```bash
# SSH to factory server first, then:
ssh abc@192.168.0.83    # Weighbridge PC (needs password: acer@123)
curl http://192.168.0.83:8098/api/weight   # HTTP check (no auth needed)
```

### Deploy Code to Weighbridge PC
```bash
# From Mac (Tailscale must be on for weighbridge PC)
cd ~/Desktop/distillery-erp/weighbridge
sshpass -p 'acer@123' scp -o StrictHostKeyChecking=no *.py abc@100.91.152.57:C:/mspil/weighbridge/
sshpass -p 'acer@123' scp -o StrictHostKeyChecking=no templates/*.html abc@100.91.152.57:C:/mspil/weighbridge/templates/

# Restart
sshpass -p 'acer@123' ssh abc@100.91.152.57 "taskkill /F /IM pythonw.exe 2>&1"
sleep 2
sshpass -p 'acer@123' ssh abc@100.91.152.57 "schtasks /run /tn \"MSPIL Weighbridge\""
sleep 8
curl -s http://100.91.152.57:8098/api/weight
```

### Deploy Code to Factory Server
```bash
cd ~/Desktop/distillery-erp/factory-server
npx tsc --outDir dist
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 "taskkill /F /IM node.exe 2>&1"
sshpass -p 'Mspil@1212' scp -r -o StrictHostKeyChecking=no dist/* Administrator@100.126.101.7:C:/mspil/factory-server/dist/
sshpass -p 'Mspil@1212' scp -o StrictHostKeyChecking=no prisma/schema.prisma Administrator@100.126.101.7:C:/mspil/factory-server/prisma/
sshpass -p 'Mspil@1212' scp -o StrictHostKeyChecking=no package.json Administrator@100.126.101.7:C:/mspil/factory-server/
# If new npm deps:
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 "cd C:\mspil\factory-server && npm install --production"
# If schema changed:
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 "cd C:\mspil\factory-server && npx prisma db push"
# Start
sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7 "cd C:\mspil\factory-server && node dist/server.js &"
```

### Deploy Frontend to Factory Server
```bash
cd ~/Desktop/distillery-erp/factory-server/frontend
npx vite build   # builds to ../public/
sshpass -p 'Mspil@1212' scp -r -o StrictHostKeyChecking=no ../public/* Administrator@100.126.101.7:C:/mspil/factory-server/public/
```

## 7. Adding a New Factory PC — Setup Guide

### Prerequisites
- PC on factory LAN (192.168.0.x)
- Windows 10 or later
- Network cable connected

### Step 1 — Basic Setup (at the PC)
```powershell
# 1. Disable sleep
powercfg /change standby-timeout-ac 0
powercfg /hibernate off

# 2. Install OpenSSH (if not present)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22

# 3. Open firewall for web service
netsh advfirewall firewall add rule name="MSPIL" dir=in action=allow protocol=tcp localport=8098
```

### Step 2 — Install Tailscale (optional, for remote management)
Download from `https://tailscale.com/download/windows`, install, login with `saifraza9@` account.

### Step 3 — For Weighbridge PCs (hardware connected)
```bash
# Install Python 3.11
# Install deps: pip install flask pyserial requests

# Copy weighbridge code
scp -r ~/Desktop/distillery-erp/weighbridge/* user@<PC_IP>:C:/mspil/weighbridge/

# Set PC identity in config.py
# WB_PC_ID = "weighbridge-2"
# WB_PC_NAME = "Weighbridge Gate 2"
# SERIAL_PROTOCOL = "serial"  (if reading COM port directly)

# Create Task Scheduler job
schtasks /create /tn "MSPIL Weighbridge" /tr "pythonw C:\mspil\weighbridge\run.py" /sc onstart /ru <username> /rp <password> /f
```

### Step 4 — For Non-Hardware PCs (gate entry, admin, etc.)
No software installation needed! Just open Chrome:
```
http://192.168.0.10:5000
```
Login with the appropriate user account (created by admin).

### Step 5 — Register in Factory Server PC Monitor
Edit `factory-server/src/services/pcMonitor.ts`:
```typescript
const FACTORY_PCS: FactoryPC[] = [
  { pcId: 'weighbridge-1', pcName: 'Weighbridge Gate 1', lanIp: '192.168.0.83', port: 8098, role: 'WEIGHBRIDGE' },
  // Add new PC here:
  { pcId: 'weighbridge-2', pcName: 'Weighbridge Gate 2', lanIp: '192.168.0.XX', port: 8098, role: 'WEIGHBRIDGE' },
];
```
Deploy updated code to factory server. The new PC will appear on the cloud ERP monitoring page automatically.

## 8. Safety Rules

### NEVER DO
- **NEVER stop/disable Oracle XE** on the factory server — Print Consol legacy system depends on it
- **NEVER use ports** 1521, 8070, 8080, 8888 on factory server — already in use
- **NEVER re-enable WtService** (WTReadingNew) — it conflicts with our serial reader on COM1
- **NEVER rapidly retry SSH** to a PC — causes Windows account lockout (30 min wait or reboot to fix)
- **NEVER delete** `C:\mspil\weighbridge\certs\` on OPC PC — kills OPC-UA auth

### ALWAYS DO
- **ALWAYS restart service after deploying templates or Python files** — Flask caches templates in memory, SCP alone doesn't take effect
- **ALWAYS use schtasks** to start services (survives SSH disconnect, unlike foreground `python run.py`)
- **ALWAYS delete weighbridge.pid** before restart if service crashed
- **ALWAYS delete weighbridge.db** when schema changes (SQLite has no migrations)
- **ALWAYS check service is running** after deploy: `curl -s http://<IP>:8098/api/weight`
- **ALWAYS use pure black (#000) text in slip templates** — thermal printers can't print gray (#555) or white-on-black. No `background: #000; color: #fff`
- **NEVER deploy config.py without checking SERIAL_PROTOCOL** — if default reverts to `file`, weight reading breaks. The PC has `WB_PROTOCOL=serial` set as system env var to prevent this, but still check.
- **Critical settings are in SYSTEM env vars** on the weighbridge PC (override config.py defaults): `WB_PROTOCOL=serial`
- **ALWAYS keep sleep disabled** on all factory PCs: `powercfg /change standby-timeout-ac 0`

## 9. Troubleshooting

### Weighbridge shows weight=0 but connected=true
- No truck on scale — weight 0 is correct for empty scale
- Scale indicator powered off — check the physical display

### Weighbridge shows connected=false
- COM1 conflict — check if WtService somehow restarted: `sc query WTReadingNew`
- Service crashed — restart: `schtasks /run /tn "MSPIL Weighbridge"`
- Delete PID file first: `Remove-Item C:\mspil\weighbridge\data\weighbridge.pid -Force`

### "table weighments has no column named X"
- SQLite schema outdated — delete DB and restart:
```bash
sshpass -p 'acer@123' ssh abc@100.91.152.57 "taskkill /F /IM pythonw.exe 2>&1"
sshpass -p 'acer@123' ssh abc@100.91.152.57 "powershell -Command \"Remove-Item 'C:\mspil\weighbridge\data\weighbridge.db*' -Force\""
sshpass -p 'acer@123' ssh abc@100.91.152.57 "schtasks /run /tn \"MSPIL Weighbridge\""
```

### Account locked out ("referenced account is currently locked out")
- Too many failed SSH/login attempts
- **Quick fix**: Hard reboot the PC (hold power 10s, wait, power on)
- **Wait fix**: Account auto-unlocks after 30 minutes

### PC not showing on cloud ERP monitoring page
- Factory server PC Monitor needs the PC in its registry (`pcMonitor.ts`)
- Factory server may have restarted — heartbeats are in-memory
- Check: `curl -s http://100.126.101.7:5000/api/factory-pcs`

### Factory server won't start after reboot
- Check schtask: `schtasks /query /tn "MSPIL Factory Server"`
- Manual start: `cd C:\mspil\factory-server && node dist\server.js`
- Port 5000 in use: `netstat -an | findstr 5000` — kill the other process

## 10. File Locations Summary

### Factory Server (`C:\mspil\factory-server\`)
```
C:\mspil\factory-server\
├── dist/           # Compiled JS (deployed from Mac)
├── prisma/         # Schema
├── node_modules/   # Dependencies
├── public/         # Built React frontend
├── .env            # Database URL, API keys
└── package.json
```

### Weighbridge PC (`C:\mspil\weighbridge\`)
```
C:\mspil\weighbridge\
├── run.py          # Main entry point
├── config.py       # Serial port, cloud URL, PC identity
├── weight_reader.py # COM1 serial reader
├── web_ui.py       # Flask web UI and API
├── cloud_sync.py   # Cloud sync and heartbeat
├── local_db.py     # SQLite database
├── templates/      # HTML templates
├── data/
│   ├── weighbridge.db    # SQLite database
│   └── weighbridge.pid   # PID file
└── logs/
    └── weighbridge.log   # Rotating log (5MB x 3)
```

### Source Code (Mac)
```
~/Desktop/distillery-erp/
├── factory-server/     # Factory server source (TypeScript)
│   ├── src/            # Source code
│   ├── frontend/       # React frontend source
│   └── prisma/         # Schema
├── weighbridge/        # Weighbridge Python source
├── backend/            # Cloud ERP backend
└── frontend/           # Cloud ERP frontend
```
