---
name: Weighbridge System Status
description: Local weighbridge system on factory Windows PC — file-mode reader via WtService, 3-step QR workflow, cloud sync
type: project
---

Weighbridge local system deployed to factory Windows PC (ethanolwb, 100.91.152.57) on 2026-03-31.

**Why:** Factory needs offline-capable truck weighing — trucks can't wait for internet.

**Current setup (CRITICAL — do not change without factory coordination):**
- WtService (.NET) owns COM1 and writes weight to `D:\WT\new weight.txt`
- Our Python service reads weight via FileReader (reads that text file)
- SERIAL_PROTOCOL=file (default in config.py) — this is the PRODUCTION mode
- NEVER disable WtService — it feeds both our system AND Oracle gate-entry
- NEVER set SERIAL_PROTOCOL=serial on the factory PC (would conflict with WtService on COM1)
- COM1 settings: 2400/7/N/1, indicator format: `\x02 NNNNNN\x03\r\n`
- Task Scheduler job "MSPIL Weighbridge" auto-starts on boot
- Web UI at http://100.91.152.57:8098 (via Tailscale)
- Printers: TVS-E RP 3230 (thermal 80mm), EPSON FX-2175II (dot matrix)
- Old Print Consol app connected to Oracle DB at 192.168.0.10/XE

**How to apply:**
- For any weighbridge troubleshooting, read `.claude/skills/factory-linkage.md` first
- The serial reader mode exists for future use ONLY after WtService is officially decommissioned
- Any changes to the weighbridge service must be tested WITHOUT stopping WtService
