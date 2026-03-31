@echo off
echo ============================================
echo   MSPIL Weighbridge — Installation
echo ============================================
echo.

:: Get the directory where this script is located
set SCRIPT_DIR=%~dp0
cd /d %SCRIPT_DIR%

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Install Python 3.11+: winget install Python.Python.3.11
    pause
    exit /b 1
)

echo [1/4] Installing Python dependencies...
pip install flask pyserial --quiet
if errorlevel 1 (
    echo WARNING: pip install had issues, continuing anyway...
)

echo [2/4] Creating data and log directories...
if not exist "%SCRIPT_DIR%data" mkdir "%SCRIPT_DIR%data"
if not exist "%SCRIPT_DIR%logs" mkdir "%SCRIPT_DIR%logs"

echo [3/4] Testing database...
python run.py --test-db
if errorlevel 1 (
    echo ERROR: Database test failed.
    pause
    exit /b 1
)

echo [4/4] Creating Windows Task Scheduler job...
:: Remove existing task if any
schtasks /delete /tn "MSPIL Weighbridge" /f >nul 2>&1

:: Create task that starts on boot, runs as current user
:: Using pythonw.exe to run without console window
schtasks /create ^
    /tn "MSPIL Weighbridge" ^
    /tr "pythonw.exe \"%SCRIPT_DIR%run.py\"" ^
    /sc onstart ^
    /rl HIGHEST ^
    /f

if errorlevel 1 (
    echo WARNING: Could not create scheduled task. You may need to run as Administrator.
    echo Alternative: Create task manually in Task Scheduler.
) else (
    echo Task Scheduler job created: "MSPIL Weighbridge"
    echo   - Runs on system startup
    echo   - Uses pythonw.exe (no console window)
)

echo.
echo ============================================
echo   Installation complete!
echo.
echo   To start now:  python run.py
echo   To test web:   python run.py --web-only
echo   Web UI:        http://localhost:8098
echo.
echo   Configure serial port in config.py
echo   (currently set to COM3, 9600 baud)
echo ============================================
pause
