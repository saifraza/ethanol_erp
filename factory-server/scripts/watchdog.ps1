# Factory Server watchdog. Runs every 5 min via scheduled task.
# If port 5000 is not listening, kicks the FactoryServer scheduled task.
#
# Why: 2026-04-29 a third-party Oracle backup tool blanket-killed our node.exe.
# The FactoryServer schtask is one-shot (Status=Ready, no auto-restart), so it
# stayed dead for ~2h until a human ran `schtasks /run /tn FactoryServer`.
# This watchdog self-heals within 5 min of any future kill.

$ErrorActionPreference = 'SilentlyContinue'

$logDir = 'C:\mspil\factory-server\logs'
$logFile = Join-Path $logDir 'watchdog.log'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$msg)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $logFile -Value "$ts $msg"
}

# Check if anything is LISTENING on port 5000
$listening = @(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0

if ($listening) {
    # Healthy. Log only every ~hour to avoid log noise.
    $minute = (Get-Date).Minute
    if ($minute -lt 5) {
        Write-Log "OK :5000 listening"
    }
    exit 0
}

Write-Log "DOWN :5000 not listening -- triggering FactoryServer task"

# Belt + braces: stop any zombie factory node first (in case it's stuck not-listening)
try {
    & "C:\mspil\factory-server\scripts\stop-factory-node.ps1" 2>&1 | ForEach-Object { Write-Log "stop-factory-node: $_" }
} catch {
    Write-Log "stop-factory-node failed: $($_.Exception.Message)"
}

# Kick the scheduled task
$result = schtasks /run /tn FactoryServer 2>&1
Write-Log "schtasks /run output: $result"

# Verify within 30s
Start-Sleep -Seconds 15
$nowListening = @(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
if ($nowListening) {
    Write-Log "RECOVERED :5000 listening after restart"
} else {
    Start-Sleep -Seconds 15
    $nowListening = @(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
    if ($nowListening) {
        Write-Log "RECOVERED :5000 listening after 30s"
    } else {
        Write-Log "STILL DOWN after 30s -- next watchdog tick will retry"
    }
}

exit 0
