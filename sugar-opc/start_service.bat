@echo off
REM ============================================================
REM  MSPIL Sugar OPC Bridge -- Service Starter / Watchdog
REM
REM  Called by:
REM   - SugarOPC task on boot (starts the bridge once)
REM   - SugarOPC_Watchdog task every 5 min (checks + respawns)
REM
REM  Process detection uses PowerShell + Get-CimInstance because
REM  WMIC was deprecated/removed on Windows Server 2022. The old
REM  WMIC-based check kept logging "already running" even when no
REM  python existed, so the bridge stayed dead from 2026-05-02
REM  11:28 IST until manual restart on 2026-05-03 10:36 IST.
REM
REM  We trust the process: if a python.exe is alive AND its command
REM  line contains "sugar-opc...run.py", we leave it alone. run.py
REM  has its own internal force-exit on >10min scan staleness, so
REM  zombification is handled at the process level (os._exit(2)
REM  inside run.py main loop).
REM ============================================================

set OPC_DIR=C:\mspil\sugar-opc
set LOG_FILE=%OPC_DIR%\logs\autostart.log

if not exist "%OPC_DIR%\logs" mkdir "%OPC_DIR%\logs"
if not exist "%OPC_DIR%\data" mkdir "%OPC_DIR%\data"

set PS_CHECK=Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" ^| Where-Object { $_.CommandLine -match 'sugar-opc.*run\.py' } ^| Select-Object -First 1 -ExpandProperty ProcessId

set BRIDGE_PID=
for /f "tokens=*" %%P in ('powershell -NoProfile -Command "%PS_CHECK%" 2^>NUL') do set BRIDGE_PID=%%P

if defined BRIDGE_PID (
    echo %date% %time% - OK pid=%BRIDGE_PID% trigger=%~1 >> "%LOG_FILE%"
    exit /b 0
)

echo %date% %time% - DEAD respawning via SugarOPC task trigger=%~1 >> "%LOG_FILE%"
schtasks /run /tn SugarOPC >> "%LOG_FILE%" 2>&1
exit /b 0
