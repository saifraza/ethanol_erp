@echo off
REM ============================================================
REM Factory Local DB Backup — runs hourly via scheduled task
REM Keeps last 48 backups (rolling 48-hour window)
REM
REM NOTE (2026-07-06): the Node backup worker
REM   factory-server/src/services/backupWorker.ts
REM is now the PRIMARY backup mechanism (gzipped plain-SQL dumps,
REM 48-hourly + 30-daily retention, optional S3 offsite, status in
REM /api/health). This .bat stays as belt-and-braces only.
REM
REM Credentials: DB_PASS comes from a gitignored env file, never
REM committed here. Create C:\mspil\backup-env.bat containing:
REM   set DB_PASS=<the postgres password>
REM ============================================================

set PGBIN=C:\Program Files\PostgreSQL\16\bin
set BACKUP_DIR=C:\mspil\backups
set DB_NAME=mspil_factory
set DB_USER=postgres
set DB_HOST=127.0.0.1
set DB_PORT=5432

REM Load password from gitignored env file (out of source control)
if exist "C:\mspil\backup-env.bat" call "C:\mspil\backup-env.bat"
if not defined DB_PASS (
    if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
    echo [BACKUP] FAILED: DB_PASS not set — create C:\mspil\backup-env.bat at %date% %time% >> "%BACKUP_DIR%\backup.log"
    exit /b 1
)

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

REM Delete old backups — keep only the 48 newest .dump files
REM Uses PowerShell for reliable sorting
powershell -Command "Get-ChildItem '%BACKUP_DIR%\factory_db_*.dump' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 48 | Remove-Item -Force"

exit /b 0
