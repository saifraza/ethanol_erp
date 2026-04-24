@echo off
REM ============================================================
REM Factory Local DB Backup — runs hourly via scheduled task
REM Keeps last 3 backups (rolling 3-hour window)
REM ============================================================

set PGBIN=C:\Program Files\PostgreSQL\16\bin
set BACKUP_DIR=C:\mspil\backups
set DB_NAME=mspil_factory
set DB_USER=postgres
set DB_PASS=mspil2026
set DB_HOST=127.0.0.1
set DB_PORT=5432

REM Create backup dir if missing
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

REM Generate timestamped filename
for /f "tokens=1-6 delims=/:. " %%a in ("%date:~-10% %time: =0%") do (
    set TIMESTAMP=%%c%%b%%a_%%d%%e%%f
)
set FILENAME=%BACKUP_DIR%\factory_db_%TIMESTAMP%.dump

REM Run pg_dump (custom format, compressed)
set PGPASSWORD=%DB_PASS%
"%PGBIN%\pg_dump.exe" -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% --format=custom --compress=9 -f "%FILENAME%"

if %ERRORLEVEL% NEQ 0 (
    echo [BACKUP] FAILED at %date% %time% >> "%BACKUP_DIR%\backup.log"
    exit /b 1
)

REM Log success with file size
for %%F in ("%FILENAME%") do set FSIZE=%%~zF
set /a FSIZE_KB=%FSIZE% / 1024
echo [BACKUP] OK %FILENAME% (%FSIZE_KB% KB) at %date% %time% >> "%BACKUP_DIR%\backup.log"

REM Delete old backups — keep only the 3 newest .dump files
REM Uses PowerShell for reliable sorting
powershell -Command "Get-ChildItem '%BACKUP_DIR%\factory_db_*.dump' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -Force"

exit /b 0
