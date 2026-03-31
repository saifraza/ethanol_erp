================================================================================
  MSPIL WEIGHBRIDGE SYSTEM — Factory PC Quick Reference
  Last Updated: 2026-04-01
================================================================================

WHAT THIS SYSTEM DOES:
  - Reads truck weight from the weighbridge indicator (via WtService → file)
  - Provides a web UI at http://localhost:8098 for gate entry, weighing, receipts
  - Syncs completed weighments to cloud ERP (app.mspil.in)
  - Prints gate passes, gross slips, and final weight slips

================================================================================
  CRITICAL SAFETY RULES
================================================================================

  DO NOT stop or disable WtService (WTReadingNew Windows service)
    → It feeds BOTH this system AND the existing Oracle gate entry system
    → Stopping it halts the entire factory weighbridge
    → Incident on 2026-03-31: Disabling WtService froze the factory

  DO NOT open COM1 directly or change serial port settings
    → WtService owns COM1 — our system reads via file (D:\WT\new weight.txt)

  DO NOT modify the Oracle database at 192.168.0.10/XE
    → The old Print Consol system depends on it

  DO NOT stop/modify Print Consol (DirectPrinting.exe)
    → It runs alongside our system, not instead of it

================================================================================
  SYSTEM ARCHITECTURE
================================================================================

  Weighbridge Indicator
       ↓ (COM1 serial, 2400/7/N/1)
  WtService.exe (.NET service, always running)
       ↓ (writes weight to D:\WT\new weight.txt)
  Our Python Service (reads file, runs web UI + cloud sync)
       ↓ (HTTPS via Tailscale)
  Cloud ERP (app.mspil.in)

================================================================================
  HOW TO CHECK IF SYSTEM IS RUNNING
================================================================================

  1. Open browser → http://localhost:8098
     → If it loads with live weight display, system is OK

  2. Check Task Scheduler:
     → Open Task Scheduler → find "MSPIL Weighbridge"
     → Status should be "Running"

  3. Check live weight:
     → The green number at the top of the web page should change
     → If it shows "SCALE DISCONNECTED" in red → WtService may be stopped

  4. Check cloud sync:
     → Top-right corner shows sync status (green dot = OK)
     → "Cloud offline" (red) = internet/Tailscale issue, weighments queue locally
     → "X stuck (need attention)" = items failed 10+ times, need manual help

================================================================================
  COMMON ISSUES AND FIXES
================================================================================

  ISSUE: "SCALE DISCONNECTED" on web UI
  FIX:   Check WtService is running:
         → Open Services (services.msc) → find "WTReadingNew" → should be Running
         → Check D:\WT\new weight.txt exists and has a number in it
         → If WtService stopped, START it (don't restart our service)

  ISSUE: Web UI not loading (http://localhost:8098 doesn't work)
  FIX:   Check Task Scheduler → "MSPIL Weighbridge" task
         → If stopped, right-click → Run
         → Check logs: C:\mspil\weighbridge\logs\weighbridge.log

  ISSUE: "Cloud offline" status (red dot)
  FIX:   Check Tailscale is connected (tray icon should be active)
         → Weighments still save locally, they'll sync when connection returns
         → This is NORMAL during internet outages — no data is lost

  ISSUE: "X stuck (need attention)" in sync status
  FIX:   These weighments failed to sync 10 times. Options:
         → Wait for network to stabilize, stuck items won't auto-retry
         → Contact Saif to manually re-queue from SQLite
         → Data is safe in local database at C:\mspil\weighbridge\data\weighbridge.db

  ISSUE: Printer not working
  FIX:   Gate/gross/final slips open in browser print dialog
         → Make sure TVS-E RP 3230 (thermal) is set as default printer
         → For dot matrix: EPSON FX-2175II must be selected manually

  ISSUE: QR scanner not reading
  FIX:   The QR scanner is a USB barcode reader that types the ticket number
         → Make sure cursor is in the "Scan QR / Enter Ticket" input box
         → Try typing the ticket number manually as a test

================================================================================
  FILE LOCATIONS
================================================================================

  Service code:      C:\mspil\weighbridge\
  Database:          C:\mspil\weighbridge\data\weighbridge.db
  Logs:              C:\mspil\weighbridge\logs\weighbridge.log
  PID file:          C:\mspil\weighbridge\data\weighbridge.pid
  WtService weight:  D:\WT\new weight.txt
  Task Scheduler:    "MSPIL Weighbridge" (runs python run.py on boot)

================================================================================
  CONTACT
================================================================================

  For technical issues: Saif Raza
  Cloud ERP: https://app.mspil.in
  Weighbridge PC Tailscale IP: 100.91.152.57
  PC Login: abc / acer@123

================================================================================
  FOR AI ASSISTANTS (Claude/Codex)
================================================================================

  If you are an AI assistant troubleshooting this system:
  1. Read .claude/skills/weighbridge-system.md for full technical reference
  2. Read .claude/skills/factory-linkage.md for remote management guide
  3. NEVER stop WtService — see incident note in weighbridge-system.md
  4. NEVER set SERIAL_PROTOCOL=serial — use file mode (default)
  5. The Python service reads weight from D:\WT\new weight.txt (FileReader)
  6. Cloud sync pushes to https://app.mspil.in/api/weighbridge/push
  7. SQLite WAL mode — safe for crash recovery

================================================================================
