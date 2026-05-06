# biometric-bridge watchdog. Runs every 5 min via the BiometricBridgeWatchdog
# scheduled task. If TCP 5005 isn't LISTEN-ing, kicks the BiometricBridge task.
#
# Mirrors factory-server\scripts\watchdog.ps1 — same incident-driven pattern:
# the start-bridge schtask is one-shot (Status=Ready, no auto-restart). If
# uvicorn crashes we'd stay dead until a human intervened. This watchdog
# self-heals within 5 min.

$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$logFile = Join-Path $logDir 'watchdog.log'

function Write-Log {
    param([string]$msg)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $logFile -Value "$ts $msg"
}

$listening = @(Get-NetTCPConnection -LocalPort 5005 -State Listen -ErrorAction SilentlyContinue).Count -gt 0

if ($listening) {
    # Healthy. Log only first ~5 min of each hour to avoid log noise.
    $minute = (Get-Date).Minute
    if ($minute -lt 5) {
        Write-Log "OK :5005 listening"
    }
    exit 0
}

Write-Log "DOWN :5005 not listening -- triggering BiometricBridge task"

# Defensive: kill any stuck python.exe holding the port (rare but possible
# if uvicorn hung on shutdown). Match by working dir to avoid killing other
# Python processes on the box.
try {
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
        Where-Object { $_.CommandLine -match 'uvicorn.*bridge:app' } |
        ForEach-Object {
            Write-Log "killing stale uvicorn pid=$($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
} catch {
    Write-Log "stale-process kill failed: $($_.Exception.Message)"
}

$result = schtasks /run /tn BiometricBridge 2>&1
Write-Log "schtasks /run output: $result"

Start-Sleep -Seconds 15
$nowListening = @(Get-NetTCPConnection -LocalPort 5005 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
if ($nowListening) {
    Write-Log "RECOVERED :5005 listening after restart"
} else {
    Start-Sleep -Seconds 15
    $nowListening = @(Get-NetTCPConnection -LocalPort 5005 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
    if ($nowListening) {
        Write-Log "RECOVERED :5005 listening after 30s"
    } else {
        Write-Log "STILL DOWN after 30s -- next watchdog tick will retry"
    }
}

exit 0
