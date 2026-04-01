@echo off
echo === MSPIL Weight Reader Installer ===
echo.

REM Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Install Python 3.11+ first.
    pause
    exit /b 1
)

REM Install pyserial
pip install pyserial
echo.

REM Create NSSM service (if nssm available)
where nssm >nul 2>&1
if %errorlevel% equ 0 (
    echo Installing as Windows service...
    nssm install "MSPIL Weight Reader" python "%~dp0weight_reader.py"
    nssm set "MSPIL Weight Reader" AppDirectory "%~dp0"
    nssm set "MSPIL Weight Reader" Start SERVICE_AUTO_START
    nssm start "MSPIL Weight Reader"
    echo Service installed and started!
) else (
    echo NSSM not found. To run manually:
    echo   python weight_reader.py
    echo.
    echo To install as service, download NSSM from nssm.cc
)

echo.
echo Config via environment variables:
echo   WB_SERIAL_PORT=COM1
echo   WB_SERIAL_BAUD=2400
echo   WB_SERIAL_PROTOCOL=serial  (serial/file/simulated)
echo   WB_HTTP_PORT=8099
echo   WB_PC_ID=WB-1
echo.
pause
