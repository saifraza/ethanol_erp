# Weighbridge — Hardware, Serial Protocol, Production Setup

Hardware-facing details for the truck-scale PC. See SKILL.md for the overview and the Hard rules (especially: NEVER stop WtService, NEVER set serial mode on the factory PC).

## Serial protocol (indicator → PC)

**Frame:** `\x02 NNNNNN\x03\r\n` — STX + space + 6-digit weight in KG + ETX + CRLF.
**Example:** `\x02 005260\x03\r\n` = 5260 KG.

**COM settings (confirmed live 2026-03-31):**
- Port: **COM1** (owned by WtService)
- Baud: **2400**
- Data bits: **7** (WtService wrongly uses 8 — see bug below)
- Parity: **None**
- Stop bits: **1**
- i.e. **COM1 2400 / 7 / N / 1**

## Production weight-reading mode — FILE mode via WtService

Production reads weight from a file, not the serial port directly:
- WtService (`WTReadingNew`, .NET, at `D:\WT\` on the WB PC) owns COM1 and writes weight to `D:\WT\new weight.txt`.
- Our Python service reads that file via **FileReader** (`weight_reader.py`).
- `SERIAL_PROTOCOL=file` is the production mode (default in `config.py`). The PC carries `WB_PROTOCOL` as a system env override.
- **WtService 8-bit bug**: it uses 8 data bits instead of 7, so the weight file can stay empty → weight reads 0 → operators use **manual weight entry** as the fallback.
- Serial mode (reading COM1 directly) was tested 2026-04-01 and works, but conflicts with WtService on COM1. **Only enable serial after WtService is officially decommissioned (needs factory coordination).** Reverted to file mode for Oracle compatibility.

Incidents: 2026-03-31 disabling WtService halted old gate entry; 2026-04-01 multiple SSH retries locked `abc` (fixed by hard reboot); 2026-04-01 serial tested then reverted to file mode.

## Hardware on the weighbridge PC

| Component | Details |
|-----------|---------|
| PC | Acer desktop, Windows 10 Pro (10.0.19045), hostname `ethanolwb` |
| Serial card | WCH PCI Express DUAL SERIAL + PARALLEL |
| COM1 | Weighbridge indicator (owned by WtService) |
| COM3 | Second serial port (unused) |
| USB-to-Serial | 5× Prolific PL2303 (COM4–8, not currently connected) |
| Thermal printer | TVS-E RP 3230 (receipt, 80mm) — gate pass / gross / final slips |
| Dot matrix | EPSON FX-2175II (A4 weighbridge slips) |
| CCTV | `Challenge.exe` (Smart Professional Surveillance System) |

## Existing factory systems — DO NOT TOUCH

| System | Location | Purpose |
|--------|----------|---------|
| WtService.exe | `D:\WT\` on WB PC | .NET service reading COM1, writes `new weight.txt` |
| Print Consol (`DirectPrinting.exe`) | `C:\Users\abc\Desktop\Print Consol\` | Connects to Oracle, prints gate passes |
| Oracle XE | `192.168.0.10:1521` | Factory DB for the legacy gate-entry system |

The legacy system prints gate passes with: Entry No, Shift, Entry Type (Inward/Outward), P.O. No, Item, Supplier, Transporter, Mobile, Vehicle Type, Vehicle No, Operator, Date Time, QR.

## Weighbridge PC service architecture

| Thread | Module | Role |
|--------|--------|------|
| WeightReader | `weight_reader.py` → FileReader | Reads `D:\WT\new weight.txt` |
| WebUI | `web_ui.py` | Flask on `0.0.0.0:8098` |
| CloudSync | `cloud_sync.py` | Push weighments, pull master data + lab results |

`ThreadWatchdog` monitors all threads (max 10 restarts/hour). Entry point `run.py` (PID, watchdog, 3 threads). Settings in `config.py`. SQLite CRUD in `local_db.py`.

### Local Flask API (LAN-only, no auth — accepted risk)

`GET /api/weight` live weight · `POST /api/gate-entry` (step 1) · `POST /api/weighments/:id/gross` (step 2) · `POST /api/weighments/:id/tare` (step 3) · `GET /api/weighments/lookup/:id` (QR scan by ticket# or UUID) · `gate-entries` / `gross-done` / `today` / `pending` / `summary` / `search` · `GET /api/sync-stats` · `GET /api/suppliers` · `GET /api/materials` · `DELETE /api/weighments/:id`. Print: `/gate-pass/:id`, `/gross-slip/:id`, `/slip/:id`. `/history`.

### SQLite schema (per PC)

- **weighments** — `id` (UUID), `ticket_no` (autoinc), `direction` (IN/OUT), vehicle/supplier/material, `po_number`, transporter, driver_mobile, vehicle_type, shift, operator_name, `weight_first/second/gross/tare/net`, `weight_source` (SERIAL/MANUAL), `status` (GATE_ENTRY → GROSS_DONE → COMPLETE), timestamps, `synced`/`synced_at`/`cloud_id`.
- **sync_queue** — reliable delivery to cloud. **suppliers/materials** — master-data cache. **counters** — ticket sequence.

### Templates (in `weighbridge/templates/`)

`index.html` (3-tab UI: Gate Entry / Weighbridge / Today), `history.html`, `gate_pass.html`, `gross_slip.html`, `slip.html` (thermal 80mm with QR).

## Current deployment state

**Weighbridge PC (`ethanolwb`):** LAN `192.168.0.83`; user `abc`; SSH port 22 (OpenSSH); service at `C:\mspil\weighbridge\`; Task Scheduler job "MSPIL Weighbridge" auto-starts on boot.

**Factory server:** `192.168.0.10` / Tailscale **`100.126.101.7`** :5000 (Node Express, local Postgres + read-only cloud client). NOTE: older docs cite `100.91.152.57` for the WB PC's Tailscale — that address is stale; use `100.126.101.7` for the factory server. Verify the WB-PC Tailscale address before relying on it.

Credentials (WB PC `abc`, factory unlock password) are NOT stored here — see the out-of-git fleet doc `~/Desktop/infra/fleet.md`.

## Management from Mac (via Tailscale)

Deploy: **always use `./factory-server/scripts/deploy.sh`** (never manual scp for factory-server). For the WB-PC Python reader, copy to `C:/mspil/weighbridge/`. Check live weight: `curl http://<wb-pc>:8098/api/weight`. Check service: `schtasks /query /tn "MSPIL Weighbridge"`. Logs: `C:\mspil\weighbridge\logs\weighbridge.log`.

**NEVER run** `sc stop WTReadingNew` or `sc config WTReadingNew start= disabled` — halts the factory.

## Cloud sync robustness

- Items retried up to **10 times** then dead-lettered (logged ALERT each cycle, shown as "stuck (need attention)" in the status bar).
- 3+ consecutive push failures → early break to avoid blocking the loop.
- Stale PO cache auto-pruned when cloud sends an updated active-PO list.
- UI: unstable-scale confirm dialog before capturing; cloud status shows actual reachability, not just queue depth.
